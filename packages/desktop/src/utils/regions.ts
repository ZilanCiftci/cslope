/**
 * regions.ts — Shared region computation for slope material zones.
 *
 * Splits the exterior polygon by interior boundaries to produce
 * material regions (sub-polygons) that can be independently assigned materials.
 *
 * Supports two kinds of interior boundary:
 *   1. Open polylines that cross the exterior — split via splitPolygonByPolyline
 *   2. Closed polygons entirely inside the exterior — split via polygon subtraction
 *
 * Material assignment is point-based: each region is assigned the material
 * from the first RegionAssignment whose point falls inside the region polygon.
 */

import { splitPolygonByPolyline, isPointInPolygon } from "@cslope/engine";
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
 * Apply all open-boundary splits repeatedly until the piece set stabilizes.
 *
 * This makes results independent from boundary ordering. A boundary that does
 * not split the original polygon (for example, one endpoint starts inside) may
 * split a derived piece after another boundary has already cut the model.
 */
function splitPiecesByOpenBoundaries(
  sourcePieces: { px: number[]; py: number[] }[],
  openBoundaries: MaterialBoundaryRow[],
): { px: number[]; py: number[] }[] {
  if (openBoundaries.length === 0) return sourcePieces;

  let pieces = sourcePieces;
  const maxPasses = Math.max(1, openBoundaries.length + 2);

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    for (const b of openBoundaries) {
      const lx = b.coordinates.map((c) => c[0]);
      const ly = b.coordinates.map((c) => c[1]);
      const next: { px: number[]; py: number[] }[] = [];

      for (const piece of pieces) {
        try {
          const splits = splitPolygonByPolyline(piece.px, piece.py, lx, ly);
          if (splits.length > 1) changed = true;
          next.push(...splits);
        } catch {
          next.push(piece);
        }
      }

      pieces = next;
    }

    if (!changed) break;
  }

  return pieces;
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
    const matId = findMaterialForPiece(
      px,
      py,
      regionMaterials,
      defaultMaterialId,
    );
    return [{ px, py, materialId: matId, regionKey: "region-0" }];
  }

  // Sort boundaries by ID for stable ordering
  const sorted = [...materialBoundaries].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  // Separate open (polyline) and closed (polygon) boundaries
  const openBoundaries = sorted.filter((b) => !isClosedBoundary(b.coordinates));
  const closedBoundaries = sorted.filter((b) =>
    isClosedBoundary(b.coordinates),
  );

  // Phase 1: Split by open boundaries until stable (order-independent).
  let pieces: { px: number[]; py: number[] }[] = splitPiecesByOpenBoundaries(
    [{ px, py }],
    openBoundaries,
  );

  // Phase 2: Split by closed (polygon) boundaries using subtraction.
  //
  // Pre-split each closed boundary by the open boundary polylines so that
  // when a closed polygon crosses an open boundary, each resulting
  // sub-polygon sits entirely inside one piece from Phase 1.
  const closedSubPolygons: { px: number[]; py: number[] }[] = [];
  for (const b of closedBoundaries) {
    const inner = ensureClosed(
      b.coordinates.map((c) => c[0]),
      b.coordinates.map((c) => c[1]),
    );
    const subPieces = splitPiecesByOpenBoundaries([inner], openBoundaries);
    closedSubPolygons.push(...subPieces);
  }

  const pieceHoles = new Map<number, { px: number[]; py: number[] }[]>();
  const pieceOuter = new Map<number, { px: number[]; py: number[] }>();
  let nextPieceId = 0;
  const pieceIds = pieces.map(() => nextPieceId++);

  for (const inner of closedSubPolygons) {
    const [icx, icy] = regionCentroid(inner.px, inner.py);
    const containerIdx = pieces.findIndex((p) =>
      isPointInPolygon(icx, icy, p.px, p.py),
    );
    if (containerIdx < 0) continue;

    const container = pieces[containerIdx];
    const outerBoundary = pieceOuter.get(pieceIds[containerIdx]) ?? {
      px: [...container.px],
      py: [...container.py],
    };

    const donut = subtractInnerPolygon(
      container.px,
      container.py,
      inner.px,
      inner.py,
    );

    const donutId = nextPieceId++;
    const existingHoles = pieceHoles.get(pieceIds[containerIdx]) ?? [];
    existingHoles.push({ px: inner.px, py: inner.py });
    pieceHoles.set(donutId, existingHoles);
    pieceOuter.set(donutId, outerBoundary);

    const innerId = nextPieceId++;
    pieces.splice(containerIdx, 1, donut, { px: inner.px, py: inner.py });
    pieceIds.splice(containerIdx, 1, donutId, innerId);
  }

  // Phase 3: Point-based material assignment
  // For each piece, find which stored assignment point falls inside it.
  const regions = pieces.map((piece, idx) => {
    const materialId = findMaterialForPiece(
      piece.px,
      piece.py,
      regionMaterials,
      defaultMaterialId,
    );
    const holes = pieceHoles.get(pieceIds[idx]);
    const outer = pieceOuter.get(pieceIds[idx]);
    const rpx = outer ? outer.px : piece.px;
    const rpy = outer ? outer.py : piece.py;
    return {
      px: rpx,
      py: rpy,
      materialId,
      regionKey: `region-${idx}`,
      holes,
    };
  });

  // Sort so smaller regions come last (drawn on top, matched first in reverse)
  regions.sort((a, b) => polyArea(b.px, b.py) - polyArea(a.px, a.py));
  return regions;
}

/**
 * Find the material for a polygon piece by checking which stored
 * RegionAssignment point falls inside it.
 */
function findMaterialForPiece(
  px: number[],
  py: number[],
  regionMaterials: RegionMaterials,
  defaultMaterialId: string,
): string {
  for (const assignment of regionMaterials) {
    if (isPointInPolygon(assignment.point[0], assignment.point[1], px, py)) {
      return assignment.materialId;
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
