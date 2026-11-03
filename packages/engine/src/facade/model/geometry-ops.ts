/** Facade shim of model/geometry-ops.ts (see facade/internal.ts). */
import { list, testCall, wasm } from "../internal";
import type { GeometryWithMaterial } from "../../types/geometry";
import type { Material } from "../../types/material";
import type { RegionFace, RegionFacesResult, SplitPolygonResult } from "../../model/geometry-ops";

export function lineSegmentIntersection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): [number, number] | null {
  const p = wasm().line_segment_intersection(x1, y1, x2, y2, x3, y3, x4, y4);
  return p ? [p[0], p[1]] : null;
}

export function getSurfaceLine(px: number[], py: number[]): { x: number[]; y: number[] } {
  return wasm().get_surface_line(px, py);
}

export function splitPolygonByPolyline(px: number[], py: number[], lx: number[], ly: number[]): { px: number[]; py: number[] }[] {
  return wasm().split_polygon_by_polyline(px, py, lx, ly);
}

export function polygonizeRegions(px: number[], py: number[], lines: [number, number][][]): RegionFace[] {
  return wasm().polygonize_regions(px, py, lines);
}

export function createGeometryWithMaterial(px: number[], py: number[], material: Material, calculateBounds = true): GeometryWithMaterial {
  const gm: GeometryWithMaterial = { px: [...px], py: [...py], material };
  if (calculateBounds) {
    const b = list(wasm().geometry_bounds(px, py));
    if (b.length === 3) [gm.xMin, gm.xMax, gm.yMax] = b;
  }
  return gm;
}

// ── internal (testing build) ─────────────────────────────────────

export function polylineYAtX(lx: number[], ly: number[], x: number): number | undefined {
  return testCall("model/geometry-ops::polylineYAtX", [lx, ly, x]);
}

export function polylineYAtSide(px: number[], py: number[], x: number, side: "left" | "right"): number {
  return testCall("model/geometry-ops::polylineYAtSide", [px, py, x, side]);
}

export function polylineYFrom(px: number[], py: number[], x: number, side: "left" | "right"): number {
  return testCall("model/geometry-ops::polylineYFrom", [px, py, x, side]);
}

export function clipLineToSurface(wx: number[], wy: number[], sx: number[], sy: number[]): { x: number[]; y: number[] } | null {
  return testCall("model/geometry-ops::clipLineToSurface", [wx, wy, sx, sy]);
}

export function splitPolygonByPolylineDetailed(px: number[], py: number[], lx: number[], ly: number[]): SplitPolygonResult {
  return testCall("model/geometry-ops::splitPolygonByPolylineDetailed", [px, py, lx, ly]);
}

/** Materials cross as indices: their order of first appearance in `geometries`. */
export function materialLayerTopAt(geometries: readonly GeometryWithMaterial[], material: Material, x: number, y: number): number | null {
  const index = new Map<Material, number>();
  const wire = geometries.map((g) => {
    if (!index.has(g.material)) index.set(g.material, index.size);
    return { px: g.px, py: g.py, material: index.get(g.material), xMin: g.xMin, xMax: g.xMax, yMax: g.yMax };
  });
  return testCall("model/geometry-ops::materialLayerTopAt", [wire, index.get(material) ?? index.size, x, y]);
}

export function keyholeRing(outer: [number, number][], holes: [number, number][][]): [number, number][] {
  return testCall("model/geometry-ops::keyholeRing", [outer, holes]);
}

export function polygonizeRegionsDetailed(px: number[], py: number[], lines: [number, number][][]): RegionFacesResult {
  return testCall("model/geometry-ops::polygonizeRegionsDetailed", [px, py, lines]);
}
