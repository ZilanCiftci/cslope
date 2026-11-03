/**
 * A model of a .sli file (or a scenario of a .slmd) as a cSlope slope
 * definition: the cells merged into material regions (the outline, the
 * boundaries between materials and a point in each region), the materials
 * (Mohr-Coulomb, undrained with a constant Su or Su increasing with depth,
 * the shear-normal function, generalised Hoek-Brown, SHANSEP, the
 * anisotropic and generalised anisotropic strengths as an anisotropic
 * function; the unit weight below the water, φb), the water table and
 * piezometric lines per material (with their Hu), rapid drawdown with an R
 * envelope, distributed and line loads, the seismic coefficients,
 * end-anchored bars, grouted tiebacks and geosynthetics, the tension crack,
 * the method, the slices, a non-circular search, the direction of sliding
 * and the given circles and surfaces; imperial units are converted to SI.
 * What does not carry over is listed in the notes.
 */

import type { AnalysisOptions, MaterialModel, SlopeDefinition } from "@cslope/engine";
import { fields, num, vertexLists, type Fields, type Pt, type SliFile, type SliScenario } from "./sli-read";

export interface SliImport {
  name: string;
  definition: SlopeDefinition;
  options: Partial<AnalysisOptions>;
  notes: string[];
}

/** The methods of the "methods" bit mask, in the order one is chosen for the model. */
const METHOD_BITS: { bit: number; label: string; options: Partial<AnalysisOptions> }[] = [
  { bit: 2, label: "Bishop simplified", options: { method: "Bishop" } },
  { bit: 8, label: "Spencer", options: { method: "Morgenstern-Price", intersliceFunction: "constant" } },
  { bit: 128, label: "GLE / Morgenstern-Price", options: { method: "Morgenstern-Price", intersliceFunction: "half-sine" } },
  { bit: 4, label: "Janbu simplified", options: { method: "Janbu" } },
  { bit: 16, label: "Janbu corrected", options: { method: "Janbu", janbuCorrection: true } },
];
const OTHER_METHOD_BITS: [number, string][] = [[1, "ordinary (Fellenius)"], [32, "Corps of Engineers #1"], [64, "Corps of Engineers #2"], [256, "Lowe-Karafiath"], [512, "Sarma"]];

// ── geometry ────────────────────────────────────────────────────

const area2 = (ring: Pt[]) => ring.reduce((s, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0);

/** Whether p lies on the segment ab (not at its ends). */
function inside(p: Pt, a: Pt, b: Pt, tol: number): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  if (l2 === 0) return false;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  if (t <= 1e-9 || t >= 1 - 1e-9) return false;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) <= tol;
}

/** Whether p lies inside the ring (ray casting; on the edge counts either way). */
function inRing(p: Pt, ring: Pt[]): boolean {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** A point inside a cell: the centroid of the first of its fan triangles whose centroid lies in it. */
function pointInCell(ring: Pt[]): Pt {
  for (let i = 1; i + 1 < ring.length; i++) {
    const [a, b, c] = [ring[0], ring[i], ring[i + 1]];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) continue;
    const g: Pt = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    if (ring.length === 3 || inRing(g, ring)) return g;
  }
  let sx = 0, sy = 0;
  for (const p of ring) [sx, sy] = [sx + p[0], sy + p[1]];
  return [sx / ring.length, sy / ring.length];
}

/** The extent of a set of points (the larger of width and height, at least 1e-9). */
function extentOf(points: Iterable<Pt>): number {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return Math.max(1e-9, x1 - x0, y1 - y0);
}

/**
 * The cells merged into regions: cells of the same material that share an
 * edge make one region. The edges of a region not shared within it are its
 * rings (the outer one counter-clockwise, those around other materials
 * clockwise), from which the outline and the boundaries between materials
 * follow; a point inside a region's largest cell is a point inside it.
 * Loops of the outline inside the model are voids (`voids`, with the
 * material of a cell next to them); loops outside it are separate bodies.
 */
export function cellRegions(sc: Pick<SliScenario, "vertices" | "cells">, notes: string[]) {
  const pts = sc.vertices;
  const usedPts = new Set(sc.cells.flatMap((c) => c.ids.filter((id) => pts.has(id))));
  const tol = 1e-7 * extentOf([...usedPts].map((id) => pts.get(id)!));
  let skipped = 0;
  const cells = sc.cells.flatMap((c) => {
    const ids = c.ids.filter((id, i) => pts.has(id) && id !== c.ids[(i + 1) % c.ids.length]);
    const ring = ids.map((id) => pts.get(id)!);
    const a = ids.length >= 3 ? area2(ring) : 0;
    if (Math.abs(a) <= tol * tol) {
      skipped++;
      return [];
    }
    return [{ ids: a > 0 ? ids : [...ids].reverse(), material: c.material, area: Math.abs(a) / 2, ring: a > 0 ? ring : [...ring].reverse() }];
  });
  if (skipped > 0) notes.push(`${skipped} cell(s) without area or with unknown vertices are left out.`);
  if (cells.length === 0) throw new Error("The model has no cells (material regions).");
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const edgeCount = () => {
    const m = new Map<string, number[]>();
    cells.forEach((c, k) => c.ids.forEach((a, i) => {
      const e = key(a, c.ids[(i + 1) % c.ids.length]);
      const l = m.get(e);
      if (l) l.push(k);
      else m.set(e, [k]);
    }));
    return m;
  };
  // vertices on another cell's edge become corners of that edge too (only
  // edges on one cell can have them; the vertices sorted by x for the search)
  {
    const once = edgeCount();
    const used = [...new Set(cells.flatMap((c) => c.ids))].sort((p, q) => pts.get(p)![0] - pts.get(q)![0]);
    const xs = used.map((id) => pts.get(id)![0]);
    const lowerBound = (x: number) => {
      let lo = 0, hi = xs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    for (const c of cells) {
      if (!c.ids.some((a, i) => once.get(key(a, c.ids[(i + 1) % c.ids.length]))!.length === 1)) continue;
      const out: number[] = [];
      for (let i = 0; i < c.ids.length; i++) {
        const a = c.ids[i], b = c.ids[(i + 1) % c.ids.length];
        out.push(a);
        if (once.get(key(a, b))!.length !== 1) continue;
        const pa = pts.get(a)!, pb = pts.get(b)!;
        const on: number[] = [];
        for (let k = lowerBound(Math.min(pa[0], pb[0]) - tol); k < used.length && xs[k] <= Math.max(pa[0], pb[0]) + tol; k++) {
          const q = used[k];
          if (q !== a && q !== b && inside(pts.get(q)!, pa, pb, tol)) on.push(q);
        }
        const d = (q: number) => (pts.get(q)![0] - pa[0]) ** 2 + (pts.get(q)![1] - pa[1]) ** 2;
        out.push(...on.sort((p, q) => d(p) - d(q)));
      }
      c.ids = out;
    }
  }
  // regions: cells of one material joined across their shared edges
  const byEdge = edgeCount();
  const parent = cells.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (const ks of byEdge.values()) {
    for (let i = 1; i < ks.length; i++) if (cells[ks[i]].material === cells[ks[0]].material) parent[find(ks[i])] = find(ks[0]);
  }
  const groups = new Map<number, number[]>();
  cells.forEach((_, k) => {
    const g = groups.get(find(k));
    if (g) g.push(k);
    else groups.set(find(k), [k]);
  });
  const regions: { id: number; material: string; point: Pt; area: number; loops: number[][] }[] = [];
  let nextId = 0;
  for (const members of groups.values()) {
    const inGroup = new Set(members);
    // directed edges on the region's edge
    const next = new Map<number, number[]>();
    for (const k of members) {
      const ids = cells[k].ids;
      ids.forEach((a, i) => {
        const b = ids[(i + 1) % ids.length];
        if ((byEdge.get(key(a, b)) ?? []).some((q) => q !== k && inGroup.has(q))) return;
        const l = next.get(a);
        if (l) l.push(b);
        else next.set(a, [b]);
      });
    }
    const loops: number[][] = [];
    for (const start of [...next.keys()]) {
      while ((next.get(start)?.length ?? 0) > 0) {
        const loop = [start];
        let cur = next.get(start)!.shift()!;
        while (cur !== start) {
          loop.push(cur);
          const n = next.get(cur);
          if (!n || n.length === 0) break;
          cur = n.shift()!;
        }
        if (loop.length >= 3) loops.push(loop);
      }
    }
    const largest = members.reduce((m, k) => (cells[k].area > cells[m].area ? k : m), members[0]);
    const area = members.reduce((t, k) => t + cells[k].area, 0);
    regions.push({ id: nextId++, material: cells[members[0]].material, point: pointInCell(cells[largest].ring), area, loops });
  }
  // the edges of the regions: on one region the outline, on two a boundary between materials
  const count = new Map<string, [number, number, number]>();
  for (const r of regions) for (const loop of r.loops) loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length];
    const k = key(a, b);
    const had = count.get(k);
    count.set(k, had ? [had[0], had[1], had[2] + 1] : [a, b, 1]);
  });
  const adjacency = (edges: [number, number][]) => {
    const adj = new Map<number, number[]>();
    for (const [a, b] of edges) {
      for (const [p, q] of [[a, b], [b, a]]) {
        const l = adj.get(p);
        if (l) l.push(q);
        else adj.set(p, [q]);
      }
    }
    return adj;
  };
  /** Chains of edges from an end (where `isEnd`) to the next, then the closed loops left. */
  const chains = (edges: [number, number][], isEnd: (p: number, adj: Map<number, number[]>) => boolean) => {
    const adj = adjacency(edges);
    const seen = new Set<string>();
    const out: number[][] = [];
    const walk = (start: number, first: number) => {
      const chain = [start];
      let prev = start, cur = first;
      seen.add(key(start, first));
      for (;;) {
        chain.push(cur);
        if (cur === start || isEnd(cur, adj)) break;
        const nxt = (adj.get(cur) ?? []).find((q) => q !== prev && !seen.has(key(cur, q))) ?? (adj.get(cur) ?? []).find((q) => !seen.has(key(cur, q)));
        if (nxt === undefined) break;
        seen.add(key(cur, nxt));
        [prev, cur] = [cur, nxt];
      }
      out.push(chain);
    };
    for (const p of adj.keys()) if (isEnd(p, adj)) for (const q of adj.get(p)!) if (!seen.has(key(p, q))) walk(p, q);
    for (const [a, b] of edges) if (!seen.has(key(a, b))) walk(a, b);
    return out;
  };
  const outer = [...count.values()].filter((e) => e[2] === 1).map(([a, b]): [number, number] => [a, b]);
  const inner = [...count.values()].filter((e) => e[2] > 1).map(([a, b]): [number, number] => [a, b]);
  const loops = chains(outer, () => false).filter((l) => l.length >= 4 && l[0] === l[l.length - 1]).map((l) => l.slice(0, -1));
  if (loops.length === 0) throw new Error("The cells do not form a closed outline.");
  const ringOf = (ids: number[]) => ids.map((id) => pts.get(id)!);
  loops.sort((p, q) => Math.abs(area2(ringOf(q))) - Math.abs(area2(ringOf(p))));
  const main = ringOf(loops[0]);
  const onMain = new Set(loops[0]);
  // the other loops: voids inside the model (filled by the material around them) or separate bodies
  const voids: { at: Pt; material: string }[] = [];
  let bodies = 0;
  for (const l of loops.slice(1)) {
    const free = l.find((id) => !onMain.has(id));
    if (free !== undefined && inRing(pts.get(free)!, main)) {
      const cell = byEdge.get(key(l[0], l[1]))?.[0];
      const r = ringOf(l);
      voids.push({ at: [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length], material: cell !== undefined ? cells[cell].material : "" });
    } else bodies++;
  }
  if (bodies > 0) notes.push(`The cells form ${bodies + 1} separate bodies; the largest is the model, the other ${bodies} left out.`);
  const boundaries = chains(inner, (p, adj) => onMain.has(p) || (adj.get(p)?.length ?? 0) !== 2).map(ringOf);
  return { outline: area2(main) < 0 ? [...main].reverse() : main, boundaries, regions, voids, at: (id: number) => pts.get(id)! };
}

/** y of a polyline at x (x increasing), constant beyond its ends. */
function lineAt(l: Pt[], x: number): number {
  if (x <= l[0][0]) return l[0][1];
  if (x >= l[l.length - 1][0]) return l[l.length - 1][1];
  let k = 1;
  while (k < l.length - 1 && l[k][0] < x) k++;
  const [a, ay] = l[k - 1], [b, by] = l[k];
  return b > a ? ay + ((x - a) / (b - a)) * (by - ay) : by;
}

/** The outline at x: the lowest crossing above y (by default the highest crossing, the ground). */
function groundAt(outline: Pt[], x: number, y = -Infinity): number | undefined {
  let best: number | undefined;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) return;
    const yc = a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    if (y === -Infinity ? best === undefined || yc > best : yc >= y - 1e-9 && (best === undefined || yc < best)) best = yc;
  });
  return best;
}

// ── materials ───────────────────────────────────────────────────

/** Points of the shear-normal function named `name` ("strength functions": "n: σ s: τ"). */
function strengthFunction(sc: SliScenario, name: string | undefined, u: Units = SI): [number, number][] | undefined {
  if (!name) return undefined;
  const lines = sc.sections.get("strength functions") ?? [];
  let on = false;
  const out: [number, number][] = [];
  for (const l of lines) {
    const head = l.match(/^\s*\d+\s+type:\s*\d+\s+num:\s*\d+\s+name:\s*(.*)$/);
    if (head) {
      if (on) break;
      on = head[1].trim() === name.trim();
      continue;
    }
    if (!on) continue;
    const f = fields(l);
    const n = num(f.n), s = num(f.s);
    if (n !== undefined && s !== undefined) out.push([n * u.P, Math.max(0, s) * u.P]);
  }
  return out.length >= 2 ? out.sort((a, b) => a[0] - b[0]) : undefined;
}

/** The fields of material number k of a "num: k …" section (generalised Hoek-Brown). */
function numbered(sc: SliScenario, section: string, k: number): Fields | undefined {
  for (const l of sc.sections.get(section) ?? []) {
    const f = fields(l);
    if (num(f.num) === k) return f;
  }
  return undefined;
}

/** The "shansep variable functions" table of material k: [[x, y], …]. */
function shansepFunction(sc: SliScenario, k: number): [number, number][] | undefined {
  let on = false;
  const out: [number, number][] = [];
  for (const l of sc.sections.get("shansep variable functions") ?? []) {
    const head = l.match(/^\s*soil:\s*(\d+)/);
    if (head) {
      if (on) break;
      on = Number(head[1]) === k;
      continue;
    }
    const f = fields(l);
    const x = num(f.x), y = num(f.y);
    if (on && x !== undefined && y !== undefined) out.push([x, y]);
  }
  return out.length > 0 ? out : undefined;
}

/** The strength (c, φ) at an absolute base inclination a (°, counter-clockwise from +x, −90…90). */
type StrengthAt = (a: number) => { c: number; phi: number };

/**
 * An anisotropic strength as cSlope's anisotropic function: the base
 * (c, φ) times a factor of the base inclination relative to the direction
 * of sliding (positive where the base dips down in the direction of
 * sliding: the base's own angle when sliding to the left, its negative
 * when sliding to the right). The factor is φ/φ_base (c/c_base without
 * friction), exact between the given break angles where the strength
 * varies linearly; it scales c too, so a c that does not vary in
 * proportion is noted.
 */
function anisotropicModel(name: string, unitWeight: number, base: { c: number; phi: number }, at: StrengthAt, breaks: number[], rtl: boolean, notes: string[], what: string): MaterialModel {
  const byPhi = base.phi > 0;
  const factorAt = (a: number) => {
    const s = at(a);
    return byPhi ? s.phi / base.phi : base.c > 0 ? s.c / base.c : 1;
  };
  const wrap = (x: number) => ((((x + 90) % 180) + 180) % 180) - 90;
  const xs = new Set<number>([-90, 90]);
  // (the breaks are absolute angles; α is the negative of one when sliding to the right)
  for (const b of breaks) for (const d of [-1e-3, 0, 1e-3]) {
    const x = wrap((rtl ? b : -b) + d);
    if (x > -90 && x < 90) xs.add(Math.round(x * 1e6) / 1e6);
  }
  const pts = [...xs].sort((p, q) => p - q).map((al): [number, number] => [al, +factorAt(rtl ? al : -al).toFixed(6)]);
  // drop points on a straight line between their neighbours
  const fn = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const [a, b] = [pts[i - 1], pts[i + 1]];
    return Math.abs(a[1] + ((p[0] - a[0]) / (b[0] - a[0])) * (b[1] - a[1]) - p[1]) > 1e-9;
  });
  // where c (or φ) does not follow the factor: the largest difference
  let worst: { d: number; text: string } | undefined;
  for (let a = -89.5; a < 90; a += 0.5) {
    const s = at(a), f = factorAt(a);
    const c = byPhi ? base.c * f : s.c;
    const phi = byPhi ? s.phi : base.phi * f;
    const d = Math.abs(c - s.c) + Math.abs(phi - s.phi);
    if (d > 1e-6 && (!worst || d > worst.d)) worst = { d, text: `c = ${+c.toFixed(3)} kPa, φ = ${+phi.toFixed(2)}° where the file has c = ${+s.c.toFixed(3)} kPa, φ = ${+s.phi.toFixed(2)}°` };
  }
  notes.push(
    `Material "${name}": ${what} is imported as an anisotropic function on c = ${base.c} kPa, φ = ${base.phi}° with a factor of the base inclination` +
      (worst ? `; the factor scales c and φ together, so the strength differs from the file's where they do not vary in proportion (at most: ${worst.text}).` : "."),
  );
  return { kind: "anisotropic-function", unitWeight, cohesion: base.c, frictionAngle: base.phi, modifierFunction: fn };
}

/** The circular distance (°) between two directions (lines, modulo 180°). */
function angleBetween(a: number, b: number): number {
  const d = (((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
}

/** The inclination (°) of the anisotropic surface with this id or unique id where it passes x. */
function surfaceAngle(sc: SliScenario, id: { id?: number; uid?: string }, x: number): number | undefined {
  const s = vertexLists(sc.sections.get("anisotropic surfaces")).find((v) => (id.uid ? v.fields.unique_id === id.uid : num(v.fields.id) === id.id));
  if (!s) return undefined;
  const l = s.ids.flatMap((k) => (sc.vertices.has(k) ? [sc.vertices.get(k)!] : [])).sort((p, q) => p[0] - q[0]);
  if (l.length < 2) return undefined;
  let k = 1;
  while (k < l.length - 1 && l[k][0] < x) k++;
  const [a, b] = [l[k - 1], l[k]];
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/** A generalised anisotropic function of the shared part: ranges of angles with a material each, or an angle (or surface) with A, B, the base and the weak material. */
function generalisedFunction(sc: SliScenario, name: string | undefined):
  | { kind: "ranges"; ranges: { to: number; mat: number }[] }
  | { kind: "angle"; angle: number; a: number; b: number; base: number; mat: number; surface?: string }
  | undefined {
  if (!name) return undefined;
  const lines = sc.sections.get("generalized anisotropic strength functions") ?? [];
  for (let i = 0; i < lines.length; i++) {
    const head = fields(lines[i]);
    if (head.input_type === undefined || lines[i].match(/name:\s*(.*)$/)?.[1].trim() !== name.trim()) continue;
    const body: Fields[] = [];
    for (let k = i + 1; k < lines.length && !/input_type:/.test(lines[k]) && lines[k].trim() !== ""; k++) body.push(fields(lines[k]));
    if (num(head.input_type) === 0) return { kind: "ranges", ranges: body.flatMap((b) => (num(b.ang) !== undefined && num(b.matid) !== undefined ? [{ to: num(b.ang)!, mat: num(b.matid)! }] : [])).sort((p, q) => p.to - q.to) };
    const b = body[0] ?? {};
    return {
      kind: "angle", angle: num(b.ang) ?? 0, a: num(b.A) ?? 0, b: Math.max(num(b.A) ?? 0, num(b.B) ?? 0), base: num(head.basematid) ?? 0, mat: num(b.matid) ?? 0,
      ...(num(head.anisotropy_definition) === 1 && b.surfuid ? { surface: b.surfuid } : {}),
    };
  }
  return undefined;
}

interface MaterialContext {
  sc: SliScenario;
  index: number;
  name: string;
  notes: string[];
  rtl: boolean;
  /** The top of the material's highest region (for depths below it). */
  top: number;
  /** x of a point in the material's largest region (where an anisotropic surface gives its direction). */
  x: number;
  /** Factors to SI. */
  u: Units;
}

/** The strength model of one material. */
function strength(f: Fields, ctx: MaterialContext): MaterialModel {
  const { name, notes } = ctx;
  const type = num(f.type) ?? 0;
  const u = ctx.u;
  const unitWeight = (num(f.uw) ?? 0) * u.G;
  if (!(unitWeight > 0)) notes.push(`Material "${name}" has no unit weight in the file; 0 is used.`);
  const c = (num(f.c) ?? 0) * u.P, phi = num(f.phi) ?? 0;
  const mc = (cohesion: number, frictionAngle: number): MaterialModel => {
    if (!(cohesion > 0) && !(frictionAngle > 0)) {
      notes.push(`Material "${name}" has no strength (c = 0, φ = 0); a placeholder c = 0.001 kPa is used.`);
      return { kind: "mohr-coulomb", unitWeight, cohesion: 0.001, frictionAngle: 0 };
    }
    return { kind: "mohr-coulomb", unitWeight, cohesion, frictionAngle };
  };
  switch (type) {
    case 0:
      return mc(c, phi);
    case 1: {
      const ctype = num(f.ctype) ?? 0;
      if (ctype === 1) {
        const rate = (num(f.dc) ?? 0) * u.G;
        notes.push(`Material "${name}": Su = ${+c.toFixed(3)} kPa increasing by ${+rate.toFixed(4)} kPa/m with depth, measured from the top of the material's layer.`);
        return { kind: "s-f-depth", unitWeight, suRef: c, depthRef: 0, rate, depthReference: "layer-top" };
      }
      if (ctype !== 0) notes.push(`Material "${name}": the undrained strength type ${ctype} is not known; a constant Su = ${c} kPa is used.`);
      return { kind: "undrained", unitWeight, undrainedShearStrength: c };
    }
    case 5: {
      const points = strengthFunction(ctx.sc, f.name, u);
      if (points) return { kind: "shear-normal", unitWeight, points };
      notes.push(`Material "${name}": its shear-normal function "${f.name ?? ""}" is missing; Mohr-Coulomb with c = ${c}, φ = ${phi} is used.`);
      return mc(c, phi);
    }
    case 8: {
      const hb = numbered(ctx.sc, "material gen. hoek-brown", ctx.index);
      const ucs = (num(f.sigc) ?? 0) * u.P;
      const model: MaterialModel = {
        kind: "hoek-brown", unitWeight, ucs,
        gsi: num(hb?.gsi) ?? 50, mi: num(hb?.mi) ?? 10, disturbance: num(hb?.disturbance) ?? 0,
        ...(num(f.mb) !== undefined && num(f.s) !== undefined ? { mb: num(f.mb)!, s: num(f.s)!, a: num(f.a) ?? 0.5 } : {}),
      };
      return model;
    }
    case 15: {
      // the anisotropic strength: (c, φ) within A of the weak direction, (c2, φ2) beyond B, linear between
      const c2 = num(f.c2) !== undefined ? num(f.c2)! * u.P : c, phi2 = num(f.phi2) ?? phi;
      let angle = num(f.ang) ?? 0;
      const a = num(f.snowA) ?? 0, b = Math.max(a, num(f.snowB) ?? a);
      let what = `the anisotropic strength (c = ${c}, φ = ${phi}° within ${a}° of ${angle}°, c = ${c2}, φ = ${phi2}° beyond ${b}°)`;
      if ((num(f.anisoDef) ?? 0) === 1) {
        const sa = surfaceAngle(ctx.sc, { id: num(f.aniso_surface) }, ctx.x);
        if (sa === undefined) notes.push(`Material "${name}": its anisotropic surface is missing; the direction ${angle}° is used.`);
        else {
          angle = +sa.toFixed(3);
          what = `the anisotropic strength along a surface (c = ${c}, φ = ${phi}° within ${a}°, c = ${c2}, φ = ${phi2}° beyond ${b}°; one direction per material, ${angle}° where the surface passes the material at x = ${+ctx.x.toFixed(2)})`;
        }
      }
      const at: StrengthAt = (al) => {
        const d = angleBetween(al, angle);
        const t = d <= a ? 0 : d >= b || b <= a ? 1 : (d - a) / (b - a);
        return { c: c + t * (c2 - c), phi: phi + t * (phi2 - phi) };
      };
      return anisotropicModel(name, unitWeight, { c: c2, phi: phi2 }, at, [angle - a, angle + a, angle - b, angle + b, angle + 90], ctx.rtl, notes, what);
    }
    case 16: {
      // the generalised anisotropic strength: other materials' strengths by base inclination
      const fn = generalisedFunction(ctx.sc, f.name);
      const ref = (id: number) => {
        const m = ctx.sc.materials.get(`soil${id + 1}`) ?? {};
        if ((num(m.type) ?? 0) !== 0) notes.push(`Material "${name}": the material ${ctx.sc.materialNames[id] ?? id + 1} it refers to is not Mohr-Coulomb; its c and φ are used.`);
        return { c: (num(m.c) ?? 0) * u.P, phi: num(m.phi) ?? 0 };
      };
      if (fn?.kind === "ranges" && fn.ranges.length > 0) {
        const at: StrengthAt = (al) => ref((fn.ranges.find((r) => al <= r.to + 1e-9) ?? fn.ranges[fn.ranges.length - 1]).mat);
        // the base: the material over the widest range of angles
        const width = new Map<number, number>();
        fn.ranges.forEach((r, i) => width.set(r.mat, (width.get(r.mat) ?? 0) + r.to - (i === 0 ? -90 : fn.ranges[i - 1].to)));
        const baseMat = [...width.entries()].sort((p, q) => q[1] - p[1])[0][0];
        return anisotropicModel(name, unitWeight, ref(baseMat), at, fn.ranges.map((r) => r.to), ctx.rtl, notes, `the generalised anisotropic strength "${f.name}" (by ranges of the base inclination)`);
      }
      if (fn?.kind === "angle") {
        let angle = fn.angle;
        if (fn.surface !== undefined) {
          const sa = surfaceAngle(ctx.sc, { uid: fn.surface }, ctx.x);
          if (sa === undefined) notes.push(`Material "${name}": its anisotropic surface is missing; the direction ${angle}° is used.`);
          else angle = +sa.toFixed(3);
        }
        const [base, weak] = [ref(fn.base), ref(fn.mat)];
        const at: StrengthAt = (al) => {
          const d = angleBetween(al, angle);
          const t = d <= fn.a ? 0 : d >= fn.b || fn.b <= fn.a ? 1 : (d - fn.a) / (fn.b - fn.a);
          return { c: weak.c + t * (base.c - weak.c), phi: weak.phi + t * (base.phi - weak.phi) };
        };
        return anisotropicModel(name, unitWeight, base, at, [angle - fn.a, angle + fn.a, angle - fn.b, angle + fn.b, angle + 90], ctx.rtl, notes,
          `the generalised anisotropic strength "${f.name}" (${fn.surface !== undefined ? `along a surface, one direction per material: ${angle}° at x = ${+ctx.x.toFixed(2)}` : `direction ${angle}°`}, A = ${fn.a}°, B = ${fn.b}°)`);
      }
      notes.push(`Material "${name}": its generalised anisotropic function "${f.name ?? ""}" is missing; Mohr-Coulomb with c = ${c}, φ = ${phi} is used.`);
      return mc(c, phi);
    }
    case 18: {
      const ratio = num(f.shansepS) ?? 0, exponent = num(f.shansepm) ?? 0.8;
      if ((num(f.shansepA) ?? 0) !== 0) notes.push(`Material "${name}": the SHANSEP term A = ${f.shansepA} (stress) is not imported.`);
      if ((num(f.shansepmd) ?? 0) !== 0) notes.push(`Material "${name}": the material-dependent vertical stress (the part of each fill's weight that reaches the effective stress) is not imported; the full weight acts.`);
      const table = (num(f.histype) ?? 0) === 0 ? shansepFunction(ctx.sc, ctx.index) : undefined;
      if (table) {
        // the OCR against elevation (shansepcon 2), else taken as against depth below the material's top
        const byElevation = (num(f.shansepcon) ?? 2) === 2;
        if (!byElevation) notes.push(`Material "${name}": the OCR is given against depth; it is taken below the material's top (y = ${+ctx.top.toFixed(3)}).`);
        const ocrByElevation = table.map(([x, ocr]): [number, number] => [byElevation ? x * u.L : ctx.top - x * u.L, ocr]).sort((p, q) => p[0] - q[0]);
        return { kind: "shansep", unitWeight, ratio, exponent, ocrByElevation };
      }
      if ((num(f.histype) ?? 0) !== 0) notes.push(`Material "${name}": the SHANSEP stress history type ${f.histype} is not imported; OCR = 1.`);
      return { kind: "shansep", unitWeight, ratio, exponent, ocr: 1 };
    }
    default: {
      notes.push(`Material "${name}": the strength type ${type} is not imported; Mohr-Coulomb with c = ${c}, φ = ${phi} from the file is used.`);
      return mc(c, phi);
    }
  }
}

// ── the model ───────────────────────────────────────────────────

/** A line from vertex numbers, x increasing (the order of a line drawn right to left is reversed); undefined under two points. */
function lineOf(sc: SliScenario, ids: number[]): Pt[] | undefined {
  const l = ids.flatMap((id) => (sc.vertices.has(id) ? [sc.vertices.get(id)!] : []));
  if (l.length < 2) return undefined;
  return l[0][0] > l[l.length - 1][0] ? l.reverse() : l;
}

/** A line extended (constant) to the model's x range and cut to it. */
function spanning(l: Pt[], x0: number, x1: number): Pt[] {
  const out = l.filter((p) => p[0] > x0 && p[0] < x1);
  return [[x0, lineAt(l, x0)], ...out, [x1, lineAt(l, x1)]];
}

/**
 * The vertices with the model's sides made vertical where they lean by
 * less than 1/1000 of its width (a side drawn by hand): a leaning side
 * would be part of the ground for the search.
 */
function squareSides(sc: SliScenario, notes: string[]): Map<number, Pt> {
  const used = new Set(sc.cells.flatMap((c) => c.ids.filter((id) => sc.vertices.has(id))));
  if (used.size === 0) return sc.vertices;
  let x0 = Infinity, x1 = -Infinity;
  for (const id of used) {
    const x = sc.vertices.get(id)![0];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
  }
  const tol = 1e-3 * (x1 - x0);
  let moved = 0;
  const out = new Map<number, Pt>();
  for (const [id, [x, y]] of sc.vertices) {
    // only the cells' vertices just inside a side (a water line may run past it)
    const nx = !used.has(id) ? x : x > x0 && x - x0 < tol ? x0 : x < x1 && x1 - x < tol ? x1 : x;
    if (nx !== x) moved = Math.max(moved, Math.abs(nx - x));
    out.set(id, [nx, y]);
  }
  if (moved > 0) notes.push(`The sides of the model lean a little (up to ${+moved.toPrecision(2)} m); they are made vertical.`);
  return out;
}

/** Factors to SI of a model's units: length, stress, unit weight and force. */
interface Units {
  L: number;
  P: number;
  G: number;
  F: number;
}
const SI: Units = { L: 1, P: 1, G: 1, F: 1 };
/** Feet, psf, pcf and lbf to m, kPa, kN/m³ and kN. */
const IMPERIAL: Units = { L: 0.3048, P: 0.0478802589803, G: 0.157087463844, F: 0.00444822161526 };

/** One model of a .sli file (or one scenario of a .slmd) as a slope definition. */
export function sliToDefinition(file: SliFile, index: number, fileName = "model.sli"): SliImport {
  const raw = file.scenarios[index];
  if (!raw) throw new Error(`The file has no model ${index + 1}.`);
  // imperial units to SI
  // (a file marked imperial whose water weighs 9.81 has metric numbers)
  const gw = num(raw.description.get("gammaw"));
  const metricWater = gw !== undefined && Math.abs(gw - 9.81) < 0.5;
  const u = raw.description.get("units") === "imperial" && !metricWater ? IMPERIAL : SI;
  const sc: SliScenario = u === SI ? raw : { ...raw, vertices: new Map([...raw.vertices].map(([k, [x, y]]) => [k, [x * u.L, y * u.L] as Pt])) };
  const notes: string[] = [];
  const d = (k: string) => sc.description.get(k);
  const dn = (k: string) => num(d(k));
  const label = sc.name ? `Scenario "${sc.name}"` : "The model";
  if (sc.cells.length === 0) {
    throw new Error(`${label} has no cells${dn("use_profile") ? " (its soils are given as a profile from boreholes, which is not imported)" : ""}.`);
  }
  const units = d("units");
  if (units === "imperial" && u === IMPERIAL) notes.push("The model is in imperial units; it is converted to SI (ft to m, psf to kPa, pcf to kN/m³, lbf to kN).");
  else if (units === "imperial") notes.push("The file is marked as in imperial units, but its unit weight of water is 9.81; its numbers are taken as SI (kN, kPa, m) as they are.");
  else if (units && units !== "metric") notes.push(`The model is in ${units} units; the numbers are imported as they are (cSlope works in kN, kPa and m).`);

  const geo = cellRegions({ vertices: squareSides(sc, notes), cells: sc.cells }, notes);
  const outline = geo.outline;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
  for (const [x, y] of outline) [x0, x1, y0] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y)];
  const direction = d("direction");
  const orientation: SlopeDefinition["orientation"] = direction === "right to left" ? "rtl" : direction === "left to right" ? "ltr" : undefined;

  // water lines: the water table and the piezometric lines
  const waterMode = d("water") ?? "hu";
  const wt = vertexLists(sc.sections.get("water table"))[0];
  const waterTableLine = wt ? lineOf(sc, wt.ids) : undefined;
  const piezos = vertexLists(sc.sections.get("piezos")).map((p) => lineOf(sc, p.ids));
  const drawdown = vertexLists(sc.sections.get("drawdown line"))[0];
  const drawdownLine = drawdown ? lineOf(sc, drawdown.ids) : undefined;
  const waterUsed = waterMode === "hu";
  if (!waterUsed && waterMode !== "ru") {
    const what: Record<string, string> = { groundwater: "a finite element groundwater analysis", "total head": "a grid of total heads", "pressure head": "a grid of pressure heads", "pore pressure": "a grid of pore pressures", ru: "ru coefficients" };
    notes.push(`The pore pressures come from ${what[waterMode] ?? `the method "${waterMode}"`}, which is not imported; the model has no pore pressure.`);
  }
  if (waterUsed && (sc.sections.get("pore pressures") ?? []).some((l) => /\bv:/.test(l))) notes.push("The grid of pore pressure points is not imported.");
  const gammaW = dn("gammaw");
  if (gammaW !== undefined && Math.abs(gammaW * u.G - 9.81) > 0.02) notes.push(`The unit weight of water is ${+(gammaW * u.G).toFixed(3)} kN/m³ in the file; cSlope uses 9.81.`);

  // materials: one per material key used by the cells
  const usedKeys = [...new Set(geo.regions.map((r) => r.material))].sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  const nameOf = new Map<string, string>();
  const materials: SlopeDefinition["materials"] = [];
  const waterOf = new Map<string, { line?: number; hu: number; auto: boolean }>();
  const rtl = orientation === "rtl";
  const drawdownMaterials: string[] = [];
  for (const key of usedKeys) {
    const k = Number(key.replace(/\D/g, ""));
    const f = sc.materials.get(key);
    let name = sc.materialNames[k - 1] || key;
    for (let n = 2; materials.some((m) => m.name === name); n++) name = `${sc.materialNames[k - 1] || key} (${n})`;
    nameOf.set(key, name);
    if (!f) {
      notes.push(`Material "${name}" (${key}) is not defined in the file; a placeholder Mohr-Coulomb material is used.`);
      materials.push({ name, model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0.001, frictionAngle: 0 } });
      continue;
    }
    const own = geo.regions.filter((r) => r.material === key);
    let top = -Infinity;
    for (const r of own) for (const loop of r.loops) for (const id of loop) top = Math.max(top, geo.at(id)[1]);
    const largest = own.reduce((m, r) => (r.area > m.area ? r : m), own[0]);
    let model = strength(f, { sc, index: k, name, notes, rtl, top, x: largest?.point[0] ?? 0, u });
    const uw = num(f.uw), sat = num(f.uwbwt);
    if (sat !== undefined && sat > 0 && sat !== uw) model = { ...model, unitWeightSat: sat * u.G } as MaterialModel;
    // strength from suction
    const phiB = num(f.gw_phi_b) ?? 0;
    if (phiB > 0 && (model.kind === "mohr-coulomb" || model.kind === "anisotropic-function")) {
      const cap = dn("usemaxnegporepressure") ? (dn("maxnegporepressure") ?? 0) * u.P : undefined;
      if (cap === 0) notes.push(`Material "${name}": φb = ${phiB}° is not imported; the model limits the negative pore pressure to 0 (no suction).`);
      else model = { ...model, phiB, ...(cap !== undefined ? { maxSuction: cap } : {}) } as MaterialModel;
    }
    if ((num(f.rd_undrained) ?? 0) !== 0) {
      if (model.kind === "mohr-coulomb" && drawdownLine && ((num(f.rd_cr) ?? 0) > 0 || (num(f.rd_phir) ?? 0) > 0)) {
        model = { ...model, drawdownStrength: { cohesion: (num(f.rd_cr) ?? 0) * u.P, frictionAngle: num(f.rd_phir) ?? 0 } };
        drawdownMaterials.push(name);
      } else if (drawdownLine) notes.push(`Material "${name}": its undrained strength in rapid drawdown is not imported${(num(f.rd_cr) ?? 0) === 0 && (num(f.rd_phir) ?? 0) === 0 ? " (no R envelope is given; the file's drawdown procedure is not cSlope's)" : ""}.`);
    }
    if ((num(f.bbar) ?? 0) !== 0) notes.push(`Material "${name}": the B-bar pore pressure is not imported.`);
    // an ru coefficient: the water method ru (the `water` value is ru), or
    // with "with_ru" one on top of the water line's pressure
    const ru = waterMode === "ru" ? num(f.water) ?? 0 : dn("with_ru") !== 0 ? num(f.withru) ?? 0 : 0;
    if (ru > 0 && ru < 1) model = { ...model, ru } as MaterialModel;
    else if (ru !== 0) notes.push(`Material "${name}": its ru coefficient ${ru} is outside 0–1 and is not imported.`);
    if ((num(f.mat_tensile) ?? 0) !== 0) notes.push(`Material "${name}": the tensile strength (cut-off) is not imported.`);
    if ((num(f.use_alternate_strength) ?? 0) !== 0) notes.push(`Material "${name}": the alternate strength is not imported.`);
    if ((num(f.spatially_variable_material) ?? 0) !== 0) notes.push(`Material "${name}": the spatial variability is not imported (the mean values are used).`);
    const colour = sc.materialColours[k - 1];
    materials.push({ name, model, ...(colour ? { color: colour } : {}) });
    // water: Hu (`water`), the water surface (`wtable`: 0 none, 1 the water table, 2… the piezometric lines)
    const surface = num(f.wtable) ?? 0;
    const hu = num(f.water) ?? 1;
    const auto = (num(f.hutype) ?? 0) === 1;
    if (waterUsed && surface > 0 && (auto || hu > 0)) waterOf.set(name, { line: surface, hu, auto });
  }

  // materials the file defines but no cell uses
  const unused = [...sc.materials.keys()].filter((k) => !usedKeys.includes(k) && sc.materialNames[Number(k.replace(/\D/g, "")) - 1] !== undefined && sc.cells.length > 0);
  const defaultNames = /^(Material \d+|Soil)$/;
  const namedUnused = unused.map((k) => sc.materialNames[Number(k.replace(/\D/g, "")) - 1]).filter((n) => n && !defaultNames.test(n));
  if (namedUnused.length > 0) notes.push(`Materials the file defines but no region uses are not imported: ${namedUnused.join(", ")}.`);
  // voids: filled by the material around them (cSlope has no empty regions)
  for (const v of geo.voids) notes.push(`The model has a void around (${+v.at[0].toFixed(2)}, ${+v.at[1].toFixed(2)}); cSlope has no empty regions, so it is filled with "${nameOf.get(v.material) ?? v.material}".`);

  // the water of each material: the main line (the water table, else the first piezometric line used) and the others by id
  let waterTable: SlopeDefinition["waterTable"];
  const waterTables: NonNullable<SlopeDefinition["waterTables"]> = [];
  const lineFor = (s: number) => (s === 1 ? waterTableLine : piezos[s - 2]);
  const wet = [...waterOf.entries()].filter(([name, w]) => {
    const l = lineFor(w.line!);
    if (!l) {
      notes.push(`Material "${name}" uses ${w.line === 1 ? "the water table" : `piezometric line ${w.line! - 1}`}, which the model does not have; it is imported dry.`);
      return false;
    }
    return true;
  });
  const lines = [...new Set(wet.map(([, w]) => w.line!))];
  const materialsOut = [...materials];
  if (lines.length > 0) {
    const main = lines.includes(1) ? 1 : lines[0];
    waterTable = { mode: "custom", value: spanning(lineFor(main)!, x0, x1), followBoundary: false };
    for (const s of lines) if (s !== main) waterTables.push({ id: `piezo-${s - 1}`, coordinates: spanning(lineFor(s)!, x0, x1), followBoundary: false });
    const dryNames = materials.filter((m) => !wet.some(([n]) => n === m.name)).map((m) => m.name);
    if (dryNames.length > 0) waterTables.push({ id: "no-water", coordinates: [[x0, y0 - 100], [x1, y0 - 100]], followBoundary: false });
    for (let i = 0; i < materialsOut.length; i++) {
      const m = materialsOut[i];
      const w = waterOf.get(m.name);
      const id = !w || !wet.some(([n]) => n === m.name) ? "no-water" : w.line === main ? undefined : `piezo-${w.line! - 1}`;
      if (id) materialsOut[i] = { ...m, waterTableId: id };
    }
    const partial = wet.filter(([, w]) => !w.auto && w.hu > 0 && w.hu < 1).map(([n, w]) => `${n} (Hu = ${w.hu})`);
    if (partial.length > 0) notes.push(`A head below the water of less than its full height (Hu < 1) is not imported; full hydrostatic pressure is used for ${partial.join(", ")}.`);
  } else if (waterTableLine && waterUsed) {
    notes.push("The model has a water table that no material uses; it is not imported.");
  }
  const unusedPiezos = piezos.filter((l, i) => l && !lines.includes(i + 2)).length;
  if (unusedPiezos > 0) notes.push(`${unusedPiezos} piezometric line(s) that no material uses are not imported.`);
  // Hu: automatic (cos² of the water line's inclination) or the given value
  const options: Partial<AnalysisOptions> = {};
  const autos = wet.filter(([, w]) => w.auto).map(([n]) => n);
  if (autos.length > 0) {
    if (autos.length === wet.length) options.porePressureHead = "phreatic-correction";
    else notes.push(`Hu is automatic (cos² of the water line's inclination) for ${autos.join(", ")} and given for the other materials; cSlope has one setting for all, so the full head (Hu = 1) is used throughout.`);
  }

  // rapid drawdown: the water table before it, the drawdown line after it
  let rapidDrawdown: SlopeDefinition["rapidDrawdown"];
  if (drawdownLine) {
    // (only with the water table as the main line: the drawdown line replaces it, not a piezometric line)
    if (drawdownMaterials.length > 0 && waterTableLine && lines.includes(1)) {
      rapidDrawdown = { waterBefore: spanning(waterTableLine, x0, x1) };
      waterTable = { mode: "custom", value: spanning(drawdownLine, x0, x1), followBoundary: false };
      const m = d("advanced_options_rdd_method");
      notes.push(
        `Rapid drawdown: the water table is the water before it and the drawdown line the water after it; ${drawdownMaterials.join(", ")} take their undrained (R) envelope in cSlope's three-stage procedure` +
          `${m && m !== "0" ? ` (the file's procedure is number ${m}, not the three-stage one)` : ""}; the interpolation between the envelopes may differ from the file's.`,
      );
    } else if (d("advanced_options") !== "yes") notes.push("Rapid drawdown is not imported (no material has an undrained R envelope for cSlope's three-stage procedure); the model has the water before drawdown (the drawdown line is left out).");
  }

  if (d("advanced_options") === "yes" && !rapidDrawdown) {
    const methods: Record<string, string> = { "3": "effective stress with B-bar" };
    notes.push(`The rapid drawdown analysis (${methods[d("advanced_options_rdd_method") ?? ""] ?? `method ${d("advanced_options_rdd_method") ?? "?"}`}) is not imported; the model has the water before drawdown, without drawdown.`);
  }

  // loads: distributed loads (type 0) and line loads (type 1)
  const udls: NonNullable<SlopeDefinition["udls"]> = [];
  const lineLoads: NonNullable<SlopeDefinition["lineLoads"]> = [];
  for (const l of sc.sections.get("forces") ?? []) {
    const f = fields(l);
    if (f.type === undefined) continue;
    const type = num(f.type);
    const angle = num(f.angle) ?? 270;
    const L = (v: string | undefined) => (num(v) !== undefined ? num(v)! * u.L : undefined);
    // a distributed load is a stress, a line load a force per metre
    const qs = type === 1 ? u.F / u.L : u.P;
    const q = (num(f.load) ?? 0) * qs, q2 = num(f.load2) !== undefined ? num(f.load2)! * qs : q;
    const ax = L(f.x1), ay = L(f.y1), bx = L(f.x2);
    const down = Math.abs(((angle % 360) + 360) % 360 - 270) < 1e-6;
    if (type === 0 && ax !== undefined && bx !== undefined && ax !== bx) {
      const [a, b, qa, qb] = ax < bx ? [ax, bx, q, q2] : [bx, ax, q2, q];
      // the vertical part of an inclined load (the angle is the direction, ° counter-clockwise from +x)
      const v = down ? 1 : Math.max(0, -Math.sin((angle * Math.PI) / 180));
      if (!down) notes.push(`Distributed load ${udls.length + 1} acts at ${angle}° (270° is vertical); its vertical part is imported.`);
      if (Math.abs(qa - qb) < 1e-9) udls.push({ magnitude: qa * v, x1: a, x2: b });
      else {
        // a linearly varying load as ten uniform steps
        const n = 10;
        for (let i = 0; i < n; i++) udls.push({ magnitude: (qa + ((i + 0.5) / n) * (qb - qa)) * v, x1: a + ((b - a) * i) / n, x2: a + ((b - a) * (i + 1)) / n });
        notes.push(`A distributed load from ${+qa.toFixed(3)} to ${+qb.toFixed(3)} kPa over x = ${+a.toFixed(3)}–${+b.toFixed(3)} is imported as ten uniform steps.`);
      }
    } else if (type === 1 && ax !== undefined) {
      // a line load: its direction (° counter-clockwise from +x) as the angle from the downward vertical
      let tilt = angle - 270;
      while (tilt > 180) tilt -= 360;
      while (tilt <= -180) tilt += 360;
      lineLoads.push({ magnitude: q, x: ax, ...(Math.abs(tilt) > 1e-9 ? { angle: tilt, ...(ay !== undefined ? { y: ay } : {}) } : {}) });
    } else notes.push(`The load "${l.trim().slice(0, 60)}" is not imported.`);
  }
  if (dn("seismic") || dn("seismicv")) {
    if (dn("seismic")) options.seismicHorizontal = Math.abs(dn("seismic")!);
    if (dn("seismicv")) {
      options.seismicVertical = dn("seismicv")!;
      notes.push(`The vertical seismic coefficient ${dn("seismicv")} is imported with its sign as given (cSlope: positive downward); check its direction.`);
    }
  }
  if (dn("seismic_advanced") || dn("seismic_pseudostatic")) notes.push("The advanced seismic analysis (pseudo-static from a record, Newmark) is not imported.");

  // support: end-anchored bars (type 1) and grouted tiebacks (type 2)
  const anchorTypes = new Map<string, Fields>();
  for (const l of sc.sections.get("anchor types") ?? []) {
    const m = l.match(/^\s*(anchor\d+)\s*=\s*(.*)$/);
    if (m) anchorTypes.set(m[1], fields(m[2]));
  }
  const reinforcements: NonNullable<SlopeDefinition["reinforcements"]> = [];
  const unsupported = new Map<string, number>();
  for (const l of sc.sections.get("anchors") ?? []) {
    const f = fields(l);
    const [ax, ay, bx, by] = [f.x1, f.y1, f.x2, f.y2].map((v) => (num(v) !== undefined ? num(v)! * u.L : undefined));
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    const t = anchorTypes.get(f.material ?? "") ?? {};
    const type = num(t.type) ?? 1;
    const cap = (num(t.cap) ?? 0) * u.F, sp = (num(t.sp) ?? 1) * u.L;
    const application = (num(t.fa) ?? 0) === 1 ? ("passive" as const) : ("active" as const);
    // the force's orientation: 1 along the element, 0 along the surface, 2 between them
    const fo = num(t.fo_flag) ?? 1;
    const direction = fo === 0 ? ("tangent" as const) : fo === 2 ? ("bisector" as const) : ("axial" as const);
    if (fo > 2) notes.push(`Support "${f.material}": its force orientation (${fo}) is taken along the element.`);
    if (type === 1) reinforcements.push({ x1: ax, y1: ay, x2: bx, y2: by, tensileCapacity: cap, spacing: sp, direction, application });
    else if (type === 4) {
      // a geosynthetic (per metre): its long-term strength, pullout by adhesion and friction on both faces, the connection at the face
      const cover = (num(t.cov_perc) ?? 100) / 100;
      const anch = num(t.anch) ?? 0;
      if (anch !== 0 && anch !== 2) notes.push(`Support "${f.material}": its anchorage (${anch}) is taken as none; only an anchorage at the slope face (the first end) is imported.`);
      reinforcements.push({
        x1: ax, y1: ay, x2: bx, y2: by, tensileCapacity: ((num(t.ts) ?? 0) * cover * u.F) / u.L, spacing: 1, direction, application,
        // (the coverage on the pullout as a lower adhesion and friction: 2·(a + σ′v·tan δ)·A; the model takes no coverage of its own)
        pullout: { kind: "interface", adhesion: (num(t.po_adh) ?? 0) * u.P * cover, frictionAngle: (Math.atan(Math.tan(((num(t.po_fric) ?? 0) * Math.PI) / 180) * cover) * 180) / Math.PI },
        ...(anch === 2 ? { end1Capacity: ((num(t.conn_strength) ?? num(t.ts) ?? 0) * cover * u.F) / u.L } : {}),
      });
    }
    else if (type === 2) {
      const len = Math.hypot(bx - ax, by - ay);
      const bonded = (num(t.bt) ?? 1) === 1 ? ((num(t.bl) ?? 100) / 100) * len : num(t.bl) !== undefined ? num(t.bl)! * u.L : len;
      reinforcements.push({
        x1: ax, y1: ay, x2: bx, y2: by, tensileCapacity: cap, spacing: sp, direction, application,
        pullout: { kind: "bond", strength: ((num(t.bs) ?? 0) * u.F) / u.L, bondedLength: Math.min(len, bonded) },
        end1Capacity: (num(t.pc) ?? 0) * u.F,
      });
    } else unsupported.set(String(type), (unsupported.get(String(type)) ?? 0) + 1);
  }
  const supportNames: Record<string, string> = { "3": "soil nail", "5": "pile", "6": "user-defined" };
  for (const [type, n] of unsupported) notes.push(`${n} support element(s) of type ${supportNames[type] ?? type} are not imported.`);
  if (reinforcements.length > 0) notes.push(`${reinforcements.length} support element(s) imported (end-anchored bars, grouted tiebacks and geosynthetics); check their capacities.`);

  // method, slices, tension crack
  const mask = dn("methods") ?? 2;
  const chosen = METHOD_BITS.find((m) => (mask & m.bit) !== 0);
  Object.assign(options, chosen?.options ?? { method: "Bishop" });
  const others = [...METHOD_BITS.filter((m) => m !== chosen && (mask & m.bit) !== 0).map((m) => m.label), ...OTHER_METHOD_BITS.filter(([bit]) => (mask & bit) !== 0).map(([, l]) => l)];
  if (others.length > 0) notes.push(`The file also runs ${others.join(", ")}; the model uses ${chosen?.label ?? "Bishop simplified"} (change the method to compare).`);
  const sliceLine = (sc.sections.get("circular analysis") ?? []).concat(sc.sections.get("noncircular analysis") ?? []).map(fields).find((f) => num(f.slices) !== undefined);
  const slices = num(sliceLine?.slices);
  if (slices !== undefined) {
    options.slices = Math.max(10, Math.min(500, Math.round(slices)));
    if (slices < 10) notes.push(`The file uses ${slices} slices; cSlope uses at least 10 (and divides slices at the corners of the ground and the materials), so the factor of safety differs a little from a ${slices}-slice result.`);
  }
  const crack = vertexLists(sc.sections.get("tension crack"))[0];
  if (crack) {
    const props = fields((sc.sections.get("tension crack properties") ?? []).join(" "));
    // the depth of each corner below the outline just above it (at a vertical step, the lower ground)
    const depths = (lineOf(sc, crack.ids) ?? []).map(([x, y]) => (groundAt(outline, x, y) ?? y) - y).filter((v) => v > 0);
    if (depths.length > 0) {
      options.tensionCrackDepth = depths.reduce((m, v) => Math.max(m, v), 0);
      options.tensionCrackWater = props.type === "filled" ? 1 : 0;
      notes.push(`The tension crack line is imported as a crack ${+options.tensionCrackDepth.toFixed(3)} m deep everywhere (its greatest depth below the ground)${props.type === "filled" ? ", full of water" : ""}.`);
    }
  }

  // given circles and surfaces; a grid search without a grid analyses only these
  const customSearchPlanes: NonNullable<SlopeDefinition["customSearchPlanes"]> = [];
  for (const l of sc.sections.get("centers") ?? []) {
    const f = fields(l);
    const cx = num(f.x), cy = num(f.y), r = num(f.r);
    if (cx !== undefined && cy !== undefined && r !== undefined && r > 0) customSearchPlanes.push({ cx: cx * u.L, cy: cy * u.L, radius: r * u.L });
  }
  const customSurfaces: NonNullable<SlopeDefinition["customSurfaces"]> = vertexLists(sc.sections.get("surfaces"))
    .flatMap((s) => {
      const points = lineOf(sc, s.ids);
      return points ? [{ points }] : [];
    });
  const grids = (sc.sections.get("grids") ?? []).some((l) => /\bnx:/.test(l));
  const search = dn("search") ?? 0;
  const customPlanesOnly = (customSearchPlanes.length > 0 || customSurfaces.length > 0) && search === 0 && !grids;
  // a non-circular search: cSlope optimises its best circles as polylines
  if (dn("mode") === 1 && !customPlanesOnly) {
    options.nonCircularOptimization = true;
    notes.push("The file searches non-circular surfaces; cSlope optimises its best circles as non-circular surfaces (non-circular optimisation is on).");
  }
  // the search's limits on the ground: two ranges (entry and exit) carry over
  const limits = fields((sc.sections.get("slope limits") ?? []).join(" "));
  const lx = ["x1", "x2", "x3", "x4"].map((k) => (num(limits[k]) !== undefined ? num(limits[k])! * u.L : undefined));
  let analysisLimits: SlopeDefinition["analysisLimits"];
  if (lx.every((v) => v !== undefined)) {
    const [a, b, c, e] = lx as number[];
    const left: [number, number] = [Math.min(a, b), Math.max(a, b)], right: [number, number] = [Math.min(c, e), Math.max(c, e)];
    const [entry, exit] = rtl ? [right, left] : [left, right];
    analysisLimits = { entryLeftX: entry[0], entryRightX: entry[1], exitLeftX: exit[0], exitRightX: exit[1] };
  }

  // what is not imported
  const has = (s: string) => (sc.sections.get(s) ?? []).some((l) => l.trim() !== "");
  if (has("weak layers")) notes.push("The weak layers (thin layers the surfaces may follow) are not imported.");
  if (vertexLists(sc.sections.get("anisotropic surfaces")).length > 0) notes.push("The anisotropic surfaces are not imported.");
  if (dn("probability_analysis")) notes.push("The probabilistic analysis is not imported; the model takes the mean values.");
  if (d("sensitivity analysis") && d("sensitivity analysis") !== "no") notes.push("The sensitivity analysis is not imported.");
  if (dn("design_selection")) notes.push("The design standard (partial factors) is not imported; the analysis uses the given values.");
  if (d("transient") && d("transient") !== "no") notes.push("The transient groundwater analysis is not imported.");
  if (dn("slices_type")) notes.push("The non-vertical (Sarma) slices are not imported; cSlope uses vertical slices.");
  if (search !== 0 || grids) notes.push("The file's search (grid, auto refine, block or path search and their settings) is not imported; cSlope's own search is used.");

  const definition: SlopeDefinition = {
    ...(orientation ? { orientation } : {}),
    coordinates: outline,
    materials: materialsOut,
    materialBoundaries: geo.boundaries.map((c) => ({ coordinates: c, materialName: "" })),
    regionAssignments: geo.regions.map((r) => ({ point: r.point, materialName: nameOf.get(r.material) ?? r.material })),
    ...(waterTable ? { waterTable } : {}),
    ...(waterTables.length > 0 ? { waterTables } : {}),
    ...(rapidDrawdown ? { rapidDrawdown } : {}),
    udls,
    lineLoads,
    ...(reinforcements.length > 0 ? { reinforcements } : {}),
    ...(analysisLimits ? { analysisLimits } : {}),
    ...(customSearchPlanes.length > 0 ? { customSearchPlanes } : {}),
    ...(customSurfaces.length > 0 ? { customSurfaces } : {}),
    ...(customPlanesOnly ? { customPlanesOnly: true } : {}),
  };
  const base = fileName.replace(/\.(sli|slim|slmd)$/i, "");
  // scenarios of the same name are told apart by their number
  const same = file.scenarios.filter((q) => q.name === sc.name).length > 1;
  const label_ = `${sc.name || "Scenario"}${same ? ` ${index + 1}` : ""}`;
  const name = file.scenarios.length > 1 || (file.kind === "slmd" && sc.name && sc.name !== "Master Scenario") ? `${base} – ${label_}` : base;
  return { name, definition, options, notes: [...new Set(notes)] };
}
