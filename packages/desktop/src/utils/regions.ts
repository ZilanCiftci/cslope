/**
 * regions.ts — Shared region computation for slope material zones.
 *
 * Splits the exterior polygon by interior boundaries to produce
 * material regions (sub-polygons) that can be independently assigned materials.
 *
 * Open polylines and closed loops (lenses) are noded together with the
 * exterior by the engine's polygonizeRegions, which the analysis uses too.
 *
 * Material assignment is point-based: each region is assigned the material
 * from the first RegionAssignment whose point falls inside the region polygon.
 */

import { polygonizeRegions, isPointInPolygon } from "@cslope/engine";
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
export function isClosedBoundary(coords: [number, number][]): boolean {
  // A loop needs three distinct corners: [a, b, a] is a line folded back.
  if (coords.length < 4) return false;
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

  // Faces of the slope cut by all boundaries at once — the same function
  // the engine uses, so the regions shown are the regions analysed.
  const faces = polygonizeRegions(
    px,
    py,
    materialBoundaries.map((b) => b.coordinates),
  );
  const regions: Region[] = faces.map((face, idx) => {
    const holes = face.holes.map((h) => ({
      px: h.map((c) => c[0]),
      py: h.map((c) => c[1]),
    }));
    const rpx = face.outer.map((c) => c[0]);
    const rpy = face.outer.map((c) => c[1]);
    const inFace = (x: number, y: number) =>
      isPointInPolygon(x, y, rpx, rpy) &&
      !holes.some((h) => isPointInPolygon(x, y, h.px, h.py));
    const hit = regionMaterials.find((a) => inFace(a.point[0], a.point[1]));
    return {
      px: rpx,
      py: rpy,
      materialId: hit ? hit.materialId : defaultMaterialId,
      regionKey: `region-${idx}`,
      ...(holes.length > 0 ? { holes } : {}),
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

/**
 * A point strictly inside a region (outer polygon minus holes), for
 * placing a material assignment.  The vertex average used before can lie
 * in a hole (ring regions) or outside a concave region.  Scans a few
 * horizontal lines and returns the middle of the widest interior span.
 */
export function regionInteriorPoint(
  px: number[],
  py: number[],
  holes: { px: number[]; py: number[] }[] = [],
): [number, number] {
  const rings = [{ px, py }, ...holes];
  const yMin = Math.min(...py);
  const yMax = Math.max(...py);
  let best: { x: number; y: number; w: number } | null = null;
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
    const y = yMin + (yMax - yMin) * f;
    const xs: number[] = [];
    for (const r of rings) {
      const n = r.px.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [x1, y1, x2, y2] = [r.px[j], r.py[j], r.px[i], r.py[i]];
        if (y1 === y2) continue;
        if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      if (!best || w > best.w) best = { x: (xs[k] + xs[k + 1]) / 2, y, w };
    }
  }
  return best ? [best.x, best.y] : regionCentroid(px, py);
}

