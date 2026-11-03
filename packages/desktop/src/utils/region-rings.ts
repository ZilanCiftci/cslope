import { isPointInPolygon, polygonizeRegions } from "@cslope/engine";
import { regionInteriorPoint, type Region } from "./regions";

type Pt = [number, number];

/**
 * The regions with every region that surrounds another (has holes) split
 * into pieces without holes, for formats whose regions are single rings
 * that may not overlap. Each such region is cut by a vertical line through
 * the middle of each hole's horizontal extent, so that every piece wraps
 * part of a hole; the pieces keep the region's material. Regions without
 * holes are returned as they are. A piece the cut leaves with a hole (it
 * should not happen) keeps it, so that callers can still tell.
 */
export function holeFreeRegions(regions: readonly Region[]): Region[] {
  return regions.flatMap((r) => {
    if (!r.holes || r.holes.length === 0) return [r];
    const y0 = Math.min(...r.py), y1 = Math.max(...r.py);
    const reach = (y1 - y0) * 0.1 + 1;
    const cuts: [number, number][][] = r.holes.map((h) => {
      const x = (Math.min(...h.px) + Math.max(...h.px)) / 2;
      return [[x, y0 - reach], [x, y1 + reach]];
    });
    const holeRings = r.holes.map((h) => h.px.map((x, i) => [x, h.py[i]] as Pt));
    const faces = polygonizeRegions(r.px, r.py, [...holeRings, ...cuts]);
    const inHole = (p: Pt) => r.holes!.some((h) => isPointInPolygon(p[0], p[1], h.px, h.py));
    const pieces: Region[] = [];
    for (const f of faces) {
      const px = f.outer.map((c) => c[0]), py = f.outer.map((c) => c[1]);
      const holes = f.holes.map((h) => ({ px: h.map((c) => c[0]), py: h.map((c) => c[1]) }));
      if (inHole(regionInteriorPoint(px, py, holes))) continue;
      pieces.push({ px, py, materialId: r.materialId, regionKey: `${r.regionKey}-${pieces.length + 1}`, ...(holes.length > 0 ? { holes } : {}) });
    }
    return pieces.length > 0 ? pieces : [r];
  });
}

/** Twice the signed area of a ring (positive: counter-clockwise, y up). */
export function ringArea2(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/**
 * The regions as rings of shared, numbered corner points (1-based ids into
 * `points`), for formats that describe each region by its corners: a corner
 * of a neighbouring region that lies on an edge is inserted into that edge,
 * so that adjacent regions have the same points along their common edge.
 */
export function sharedRings(regions: readonly Region[]): { points: Pt[]; rings: { ids: number[]; materialId: string }[] } {
  const points: Pt[] = [];
  const pid = (p: Pt) => {
    const tol = 1e-6;
    let i = points.findIndex((q) => Math.abs(q[0] - p[0]) < tol && Math.abs(q[1] - p[1]) < tol);
    if (i < 0) {
      points.push([p[0], p[1]]);
      i = points.length - 1;
    }
    return i + 1;
  };
  const rings = regions.map((r) => {
    const pts: Pt[] = r.px.map((x, i) => [x, r.py[i]] as Pt);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return { ids: pts.map(pid), materialId: r.materialId };
  });
  for (const ring of rings) {
    const out: number[] = [];
    for (let i = 0; i < ring.ids.length; i++) {
      const a = points[ring.ids[i] - 1], b = points[ring.ids[(i + 1) % ring.ids.length] - 1];
      out.push(ring.ids[i]);
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const on = points
        .map((p, k) => ({ k: k + 1, t: ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len2 || 1), p }))
        .filter(({ t, p }) => {
          if (t <= 1e-9 || t >= 1 - 1e-9) return false;
          const qx = a[0] + t * (b[0] - a[0]) - p[0], qy = a[1] + t * (b[1] - a[1]) - p[1];
          return qx * qx + qy * qy < 1e-10;
        })
        .sort((u, v) => u.t - v.t);
      out.push(...on.map((o) => o.k));
    }
    ring.ids = out;
  }
  return { points, rings };
}
