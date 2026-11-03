/** Facade shim of math/polygon.ts (see facade/internal.ts). */
import { wasm } from "../internal";

export function calculatePolygonArea(x: number[], y: number[]): number {
  return wasm().calculate_polygon_area(x, y);
}

export function isPointInPolygon(px: number, py: number, polyX: number[], polyY: number[]): boolean {
  return wasm().is_point_in_polygon(px, py, polyX, polyY);
}

export function clipPolygonHalfplane(px: number[], py: number[], a: number, b: number, c: number): [number[], number[]] {
  return wasm().clip_polygon_halfplane(px, py, a, b, c);
}

export function clipPolygonVertical(polyX: number[], polyY: number[], xMin: number, xMax: number): [number[], number[]] {
  return wasm().clip_polygon_vertical(polyX, polyY, xMin, xMax);
}
