/**
 * regions.ts — Shared region computation for slope material zones.
 *
 * Splits the exterior polygon by interior boundaries to produce
 * material regions (sub-polygons) that can be independently assigned materials.
 *
 * Supports two kinds of interior boundary:
 *   1. Open polylines that cross the exterior — split via splitPolygonByPolyline
 *   2. Closed polygons entirely inside the exterior — split via polygon subtraction
 */

import { splitPolygonByPolyline } from "../engine/model/geometry-ops";
import { isPointInPolygon } from "../engine/math/polygon";
import type { MaterialBoundaryRow, RegionMaterials } from "../store/app-store";

export interface Region {
  px: number[];
  py: number[];
  materialId: string;
  regionKey: string;
  /** Inner holes (closed polygons) to cut out when rendering. */
  holes?: { px: number[]; py: number[] }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Check whether a boundary forms a closed loop (first ≈ last point). */
function isClosedBoundary(coords: [number, number][]): boolean {
  if (coords.length < 3) return false;
  const [x0, y0] = coords[0];
  const [xn, yn] = coords[coords.length - 1];
  return Math.abs(x0 - xn) < 1e-9 && Math.abs(y0 - yn) < 1e-9;
}

/**
 * Evaluate a polyline's Y at a given X by linear interpolation.
 * Returns undefined if X is outside the polyline's range.
 */
function polylineYAtX(
  lx: number[],
  ly: number[],
  x: number,
): number | undefined {
  for (let i = 0; i < lx.length - 1; i++) {
    const x1 = lx[i],
      x2 = lx[i + 1];
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    if (x >= lo - 1e-9 && x <= hi + 1e-9) {
      if (Math.abs(x2 - x1) < 1e-12) continue; // vertical segment
      const t = (x - x1) / (x2 - x1);
      return ly[i] + t * (ly[i + 1] - ly[i]);
    }
  }
  return undefined;
}

/** Twice the signed area of a closed polygon (positive → CCW). */
function signedArea2(px: number[], py: number[]): number {
  const n = px.length - 1; // closed: last = first
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += px[i] * py[i + 1] - px[i + 1] * py[i];
  }
  return sum;
}

/** Absolute area of a closed polygon. */
function polyArea(px: number[], py: number[]): number {
  return Math.abs(signedArea2(px, py)) / 2;
}

/** Ensure a coordinate array is closed. */
function ensureClosed(
  arrX: number[],
  arrY: number[],
): { px: number[]; py: number[] } {
  let px = arrX;
  let py = arrY;
  if (
    Math.abs(px[0] - px[px.length - 1]) > 1e-12 ||
    Math.abs(py[0] - py[py.length - 1]) > 1e-12
  ) {
    px = [...px, px[0]];
    py = [...py, py[0]];
  }
  return { px, py };
}

/**
 * Subtract an inner closed polygon from an outer polygon using a bridge-cut.
 *
 * Returns the donut-shaped remainder as a single simple-polygon ring with a
 * zero-width slit connecting the outer boundary to the inner hole.
 *
 * Both inputs must be closed (last vertex == first vertex).
 */
function subtractInnerPolygon(
  outerPx: number[],
  outerPy: number[],
  innerPx: number[],
  innerPy: number[],
): { px: number[]; py: number[] } {
  const outerN = outerPx.length - 1; // number of unique vertices
  const innerN = innerPx.length - 1;

  // 1. Find the closest pair (inner vertex, point on outer edge)
  let bestIV = 0;
  let bestOE = 0;
  let bestT = 0;
  let bestD2 = Infinity;

  for (let iv = 0; iv < innerN; iv++) {
    for (let oe = 0; oe < outerN; oe++) {
      const dx = outerPx[oe + 1] - outerPx[oe];
      const dy = outerPy[oe + 1] - outerPy[oe];
      const len2 = dx * dx + dy * dy;
      const t =
        len2 < 1e-24
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((innerPx[iv] - outerPx[oe]) * dx +
                  (innerPy[iv] - outerPy[oe]) * dy) /
                  len2,
              ),
            );
      const cx = outerPx[oe] + t * dx;
      const cy = outerPy[oe] + t * dy;
      const d2 = (innerPx[iv] - cx) ** 2 + (innerPy[iv] - cy) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIV = iv;
        bestOE = oe;
        bestT = t;
      }
    }
  }

  const bx = outerPx[bestOE] + bestT * (outerPx[bestOE + 1] - outerPx[bestOE]);
  const by = outerPy[bestOE] + bestT * (outerPy[bestOE + 1] - outerPy[bestOE]);

  const onVertex = bestT < 1e-9 || bestT > 1 - 1e-9;
  const startEdge = bestT > 1 - 1e-9 ? bestOE + 1 : bestOE;

  // Inner ring should wind opposite to outer; reverse if same sign.
  const outerSign = signedArea2(outerPx, outerPy);
  const innerSign = signedArea2(innerPx, innerPy);
  const reverseInner = outerSign > 0 === innerSign > 0;

  const rpx: number[] = [];
  const rpy: number[] = [];

  // 2a. Bridge point on outer
  rpx.push(bx);
  rpy.push(by);

  // 2b. Walk outer ring back to bridge point
  for (let k = 1; k <= outerN; k++) {
    const idx = (startEdge + k) % outerN;
    rpx.push(outerPx[idx]);
    rpy.push(outerPy[idx]);
  }
  if (!onVertex) {
    rpx.push(bx);
    rpy.push(by);
  }

  // 3. Bridge to inner vertex
  rpx.push(innerPx[bestIV]);
  rpy.push(innerPy[bestIV]);

  // 4. Walk inner ring (reversed or forward to get opposite winding)
  if (reverseInner) {
    for (let k = 1; k < innerN; k++) {
      const idx = (((bestIV - k) % innerN) + innerN) % innerN;
      rpx.push(innerPx[idx]);
      rpy.push(innerPy[idx]);
    }
  } else {
    for (let k = 1; k < innerN; k++) {
      const idx = (bestIV + k) % innerN;
      rpx.push(innerPx[idx]);
      rpy.push(innerPy[idx]);
    }
  }

  // 5. Close inner loop + bridge back to outer
  rpx.push(innerPx[bestIV]);
  rpy.push(innerPy[bestIV]);
  rpx.push(bx);
  rpy.push(by);

  return { px: rpx, py: rpy };
}

// ── Main ──────────────────────────────────────────────────────────────────

/**
 * Find a point guaranteed to be inside a polygon (not on or outside it).
 *
 * The simple vertex-average centroid can fall inside a hole for donut
 * polygons created by bridge-cut. This function tries the centroid first
 * and falls back to edge-midpoint probing.
 */
function findInteriorPoint(px: number[], py: number[]): [number, number] {
  const [cx, cy] = regionCentroid(px, py);
  if (isPointInPolygon(cx, cy, px, py)) return [cx, cy];

  // Try midpoints of polygon edges, nudged slightly toward the centroid
  const n = px.length - 1; // closed polygon: last == first
  for (let i = 0; i < n; i++) {
    const mx = (px[i] + px[i + 1]) / 2;
    const my = (py[i] + py[i + 1]) / 2;
    // Nudge 5% toward centroid to avoid landing exactly on the edge
    const tx = mx + (cx - mx) * 0.05;
    const ty = my + (cy - my) * 0.05;
    if (isPointInPolygon(tx, ty, px, py)) return [tx, ty];
  }

  // Last resort: try polygon vertices nudged toward centroid
  for (let i = 0; i < n; i++) {
    const tx = px[i] + (cx - px[i]) * 0.05;
    const ty = py[i] + (cy - py[i]) * 0.05;
    if (isPointInPolygon(tx, ty, px, py)) return [tx, ty];
  }

  // Absolute fallback
  return [cx, cy];
}

/** Compute material regions by splitting the exterior polygon with boundaries. */
export function computeRegions(
  coordinates: [number, number][],
  materialBoundaries: MaterialBoundaryRow[],
  regionMaterials: RegionMaterials,
  defaultMaterialId: string,
): Region[] {
  if (coordinates.length < 3) return [];

  const closed = ensureClosed(
    coordinates.map((c) => c[0]),
    coordinates.map((c) => c[1]),
  );
  const { px, py } = closed;

  if (materialBoundaries.length === 0) {
    const topMatId = regionMaterials["top"] ?? defaultMaterialId;
    return [{ px, py, materialId: topMatId, regionKey: "top" }];
  }

  // Sort boundaries by ID for stable composite-key ordering
  const sorted = [...materialBoundaries].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  // Separate open (polyline) and closed (polygon) boundaries
  const openBoundaries = sorted.filter((b) => !isClosedBoundary(b.coordinates));
  const closedBoundaries = sorted.filter((b) =>
    isClosedBoundary(b.coordinates),
  );

  // Phase 1: Split all pieces by every open boundary
  let pieces: { px: number[]; py: number[] }[] = [{ px, py }];

  for (const b of openBoundaries) {
    const lx = b.coordinates.map((c) => c[0]);
    const ly = b.coordinates.map((c) => c[1]);
    const next: { px: number[]; py: number[] }[] = [];
    for (const piece of pieces) {
      try {
        const splits = splitPolygonByPolyline(piece.px, piece.py, lx, ly);
        next.push(...splits);
      } catch {
        next.push(piece);
      }
    }
    pieces = next;
  }

  // Phase 2: Split by closed (polygon) boundaries using subtraction
  // Track holes per piece so rendering can use evenodd fill
  // Also track original outer boundary (before bridge-cut) for clean rendering
  const pieceHoles = new Map<number, { px: number[]; py: number[] }[]>();
  const pieceOuter = new Map<number, { px: number[]; py: number[] }>();
  let nextPieceId = 0;
  const pieceIds = pieces.map(() => nextPieceId++);

  for (const b of closedBoundaries) {
    const inner = ensureClosed(
      b.coordinates.map((c) => c[0]),
      b.coordinates.map((c) => c[1]),
    );

    // Find which piece contains the centroid of this closed boundary
    const [icx, icy] = regionCentroid(inner.px, inner.py);
    const containerIdx = pieces.findIndex((p) =>
      isPointInPolygon(icx, icy, p.px, p.py),
    );
    if (containerIdx < 0) continue; // boundary not inside any piece

    const container = pieces[containerIdx];
    // Save the container's clean outer boundary before bridge-cut
    const outerBoundary = pieceOuter.get(pieceIds[containerIdx]) ?? {
      px: [...container.px],
      py: [...container.py],
    };

    // Subtract inner from container → donut (for hit-testing) + inner piece
    const donut = subtractInnerPolygon(
      container.px,
      container.py,
      inner.px,
      inner.py,
    );

    // Track the hole on the donut piece for rendering
    const donutId = nextPieceId++;
    const existingHoles = pieceHoles.get(pieceIds[containerIdx]) ?? [];
    existingHoles.push({ px: inner.px, py: inner.py });
    pieceHoles.set(donutId, existingHoles);
    pieceOuter.set(donutId, outerBoundary);

    const innerId = nextPieceId++;
    pieces.splice(containerIdx, 1, donut, { px: inner.px, py: inner.py });
    pieceIds.splice(containerIdx, 1, donutId, innerId);
  }

  // Phase 3: Classify each piece by a guaranteed-interior sample point
  const classified = pieces.map((piece, idx) => {
    const [cx, cy] = findInteriorPoint(piece.px, piece.py);
    const ids: string[] = [];

    for (const b of sorted) {
      if (isClosedBoundary(b.coordinates)) {
        // For closed boundaries: inside?
        const bpx = b.coordinates.map((c) => c[0]);
        const bpy = b.coordinates.map((c) => c[1]);
        if (isPointInPolygon(cx, cy, bpx, bpy)) {
          ids.push(b.id);
        }
      } else {
        // For open boundaries: below?
        const lx = b.coordinates.map((c) => c[0]);
        const ly = b.coordinates.map((c) => c[1]);
        const yAtCx = polylineYAtX(lx, ly, cx);
        if (yAtCx !== undefined && cy < yAtCx) {
          ids.push(b.id);
        }
      }
    }

    const baseKey = ids.length === 0 ? "top" : `below-${ids.join("+")}`;
    return { piece, idx, baseKey };
  });

  // Deduplicate region keys — a concave polygon can produce multiple pieces
  // on the same side of a boundary, all getting the same base key.  Append
  // a suffix (-2, -3, …) to make each key unique while keeping the largest
  // piece as the canonical (un-suffixed) key for backward-compat.
  // First, group by baseKey and sort each group by area descending so the
  // largest piece keeps the bare key.
  type ClassifiedEntry = (typeof classified)[number];
  const keyGroups = new Map<string, ClassifiedEntry[]>();
  for (const entry of classified) {
    const group = keyGroups.get(entry.baseKey) ?? [];
    group.push(entry);
    keyGroups.set(entry.baseKey, group);
  }
  for (const group of keyGroups.values()) {
    group.sort(
      (a, b) =>
        polyArea(b.piece.px, b.piece.py) - polyArea(a.piece.px, a.piece.py),
    );
  }

  const regions = classified.map((entry) => {
    const group = keyGroups.get(entry.baseKey)!;
    const rank = group.indexOf(entry); // 0 = largest
    const regionKey =
      rank === 0 ? entry.baseKey : `${entry.baseKey}-${rank + 1}`;
    const materialId = regionMaterials[regionKey] ?? defaultMaterialId;
    const holes = pieceHoles.get(pieceIds[entry.idx]);
    // Use the clean outer boundary (without bridge-cut slit) for rendering
    const outer = pieceOuter.get(pieceIds[entry.idx]);
    const rpx = outer ? outer.px : entry.piece.px;
    const rpy = outer ? outer.py : entry.piece.py;
    return { px: rpx, py: rpy, materialId, regionKey, holes };
  });

  // Sort so smaller regions come last (drawn on top, matched first in reverse)
  regions.sort((a, b) => polyArea(b.px, b.py) - polyArea(a.px, a.py));
  return regions;
}

/**
 * For a given boundary, find its material by checking which computed region
 * contains a point just below / inside the boundary's midpoint.
 * Checks smallest regions first so inner regions take precedence.
 */
export function findMaterialBelowBoundary(
  boundary: MaterialBoundaryRow,
  regions: Region[],
  defaultMaterialId: string,
): string {
  const midIdx = Math.floor(boundary.coordinates.length / 2);
  const midPt = boundary.coordinates[midIdx];

  let testX: number;
  let testY: number;

  if (isClosedBoundary(boundary.coordinates)) {
    // Move test point slightly toward centroid (guaranteed inside)
    const bpx = boundary.coordinates.map((c) => c[0]);
    const bpy = boundary.coordinates.map((c) => c[1]);
    const [cx, cy] = regionCentroid(bpx, bpy);
    testX = midPt[0] + (cx - midPt[0]) * 0.01;
    testY = midPt[1] + (cy - midPt[1]) * 0.01;
  } else {
    testX = midPt[0];
    testY = midPt[1] - 0.01;
  }

  // Iterate backward (smallest regions last in the sorted array → first here)
  for (let i = regions.length - 1; i >= 0; i--) {
    if (isPointInPolygon(testX, testY, regions[i].px, regions[i].py)) {
      return regions[i].materialId;
    }
  }
  return defaultMaterialId;
}

/** Compute the centroid of a polygon defined by parallel x/y arrays. */
export function regionCentroid(px: number[], py: number[]): [number, number] {
  const n = px.length;
  if (n === 0) return [0, 0];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += px[i];
    cy += py[i];
  }
  return [cx / n, cy / n];
}
