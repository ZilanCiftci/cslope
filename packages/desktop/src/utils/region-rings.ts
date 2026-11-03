import type { Region } from "./regions";

type Pt = [number, number];

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
