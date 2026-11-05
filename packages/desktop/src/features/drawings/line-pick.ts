/**
 * Picking lines of a placed drawing and making model objects of them
 * ("Use as boundaries"): the polyline under a click, chained with the
 * lines that continue it end to end (through points where exactly two
 * lines meet, not past a junction); the lines inside a window; and the
 * picked lines joined, clipped to the placement's crop and taken into the
 * model through its transform. Pure functions over source coordinates.
 */
import type { BackgroundImage } from "../../store/types";
import { apply, invert, type Crop, type Pt } from "./transform";
import { nearestOnSegment, type SnapSource } from "./snap";
import { hiddenLayerSet, pathLength, pathPoint, type VectorDrawing } from "./vectors";

/** A picked polyline in source coordinates, and the drawing's paths it is made of. */
export interface PickedChain {
  points: Pt[];
  closed: boolean;
  paths: number[];
}

/** Ends closer than this (source units) are one point: a millionth of the drawing's size. */
export function chainTolerance(drawing: Pick<VectorDrawing, "extent">): number {
  const e = drawing.extent;
  return Math.max(Math.hypot(e.x1 - e.x0, e.y1 - e.y0) * 1e-6, 1e-9);
}

const near = (a: Pt, b: Pt, tol: number) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/** The path under the model point (wx, wy) within `tol` metres (its nearest one), or null. */
export function pathAt(src: SnapSource, wx: number, wy: number, tol: number): number | null {
  const { placement, drawing, index } = src;
  const m = placement.transform;
  const inv = invert(m);
  if (!inv) return null;
  const corners = [apply(inv, [wx - tol, wy - tol]), apply(inv, [wx + tol, wy - tol]), apply(inv, [wx + tol, wy + tol]), apply(inv, [wx - tol, wy + tol])];
  const win = {
    x0: Math.min(...corners.map((c) => c[0])),
    y0: Math.min(...corners.map((c) => c[1])),
    x1: Math.max(...corners.map((c) => c[0])),
    y1: Math.max(...corners.map((c) => c[1])),
  };
  const hidden = hiddenLayerSet(drawing, placement.hiddenLayers);
  const crop = placement.crop;
  let best: number | null = null;
  let bestD = tol;
  index.query(win, (s) => {
    const path = index.path[s];
    if (hidden.has(drawing.paths[path].layer)) return;
    const a = apply(m, [index.x0[s], index.y0[s]]);
    const b = apply(m, [index.x1[s], index.y1[s]]);
    const q = nearestOnSegment([wx, wy], a, b);
    const d = Math.hypot(q[0] - wx, q[1] - wy);
    if (d > bestD) return;
    if (crop) {
      const [u, v] = apply(inv, q);
      if (u < crop.x0 || u > crop.x1 || v < crop.y0 || v > crop.y1) return;
    }
    bestD = d;
    best = path;
  });
  return best;
}

/** The end points of every path, by a grid of cells of the tolerance, for chaining. */
function endpointGrid(drawing: VectorDrawing, hidden: Set<number>, tol: number) {
  const cells = new Map<string, { path: number; end: 0 | 1 }[]>();
  const key = (p: Pt) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  drawing.paths.forEach((p, i) => {
    if (p.closed || hidden.has(p.layer)) return;
    const n = pathLength(p);
    for (const end of [0, 1] as const) {
      const k = key(pathPoint(p, end === 0 ? 0 : n - 1));
      const list = cells.get(k) ?? [];
      list.push({ path: i, end });
      cells.set(k, list);
    }
  });
  /** The path ends at p (within the tolerance). */
  const at = (p: Pt): { path: number; end: 0 | 1 }[] => {
    const cx = Math.round(p[0] / tol);
    const cy = Math.round(p[1] / tol);
    const out: { path: number; end: 0 | 1 }[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const e of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const path = drawing.paths[e.path];
          const q = pathPoint(path, e.end === 0 ? 0 : pathLength(path) - 1);
          if (near(p, q, tol)) out.push(e);
        }
      }
    }
    return out;
  };
  return at;
}

const pointsOf = (drawing: VectorDrawing, path: number): Pt[] => {
  const p = drawing.paths[path];
  return Array.from({ length: pathLength(p) }, (_, i) => pathPoint(p, i));
};

/**
 * The polyline a click on `path` picks: the path, continued at each end by
 * the one other path that ends there (not past a point where three or more
 * meet), until it closes or stops.
 */
export function connectedChain(
  drawing: VectorDrawing,
  path: number,
  hiddenLayers: readonly string[] | undefined,
  tol = chainTolerance(drawing),
): PickedChain {
  const start = drawing.paths[path];
  if (start.closed) return { points: pointsOf(drawing, path), closed: true, paths: [path] };
  const hidden = hiddenLayerSet(drawing, hiddenLayers);
  const at = endpointGrid(drawing, hidden, tol);
  const used = new Set([path]);
  let points = pointsOf(drawing, path);
  // Grow at the tail, then at the head (the list reversed).
  for (let side = 0; side < 2; side++) {
    for (;;) {
      const tail = points[points.length - 1];
      if (points.length > 2 && near(tail, points[0], tol)) break;
      const ends = at(tail);
      // A junction (three or more ends) or a dead end: stop.
      if (ends.length !== 2) break;
      const next = ends.find((e) => !used.has(e.path));
      if (!next) break;
      used.add(next.path);
      const pts = pointsOf(drawing, next.path);
      if (next.end === 1) pts.reverse();
      points = points.concat(pts.slice(1));
    }
    points.reverse();
  }
  let closed = false;
  if (points.length > 3 && near(points[0], points[points.length - 1], tol)) {
    points.pop();
    closed = true;
  }
  return { points, closed, paths: [...used] };
}

/** The paths (of shown layers) with every point inside the model rectangle, each as a chain of its own. */
export function chainsInWindow(src: SnapSource, rect: Crop): PickedChain[] {
  const { placement, drawing, index } = src;
  const m = placement.transform;
  const inv = invert(m);
  if (!inv) return [];
  const corners = [apply(inv, [rect.x0, rect.y0]), apply(inv, [rect.x1, rect.y0]), apply(inv, [rect.x1, rect.y1]), apply(inv, [rect.x0, rect.y1])];
  const win = {
    x0: Math.min(...corners.map((c) => c[0])),
    y0: Math.min(...corners.map((c) => c[1])),
    x1: Math.max(...corners.map((c) => c[0])),
    y1: Math.max(...corners.map((c) => c[1])),
  };
  const hidden = hiddenLayerSet(drawing, placement.hiddenLayers);
  const seen = new Set<number>();
  const out: PickedChain[] = [];
  index.query(win, (s) => {
    const path = index.path[s];
    if (seen.has(path)) return;
    seen.add(path);
    if (hidden.has(drawing.paths[path].layer)) return;
    const pts = pointsOf(drawing, path);
    const inside = pts.every((q) => {
      const [x, y] = apply(m, q);
      return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    });
    if (inside) out.push({ points: pts, closed: drawing.paths[path].closed, paths: [path] });
  });
  return out;
}

/** Picked chains joined end to end where their ends meet (within `tol`), as few polylines as that gives. */
export function joinChains(chains: readonly PickedChain[], tol: number): { points: Pt[]; closed: boolean }[] {
  const out: { points: Pt[]; closed: boolean }[] = [];
  const open: Pt[][] = [];
  for (const c of chains) {
    if (c.closed) out.push({ points: [...c.points], closed: true });
    else if (c.points.length >= 2) open.push([...c.points]);
  }
  while (open.length > 0) {
    let pts = open.shift()!;
    let grown = true;
    while (grown) {
      grown = false;
      for (let k = 0; k < open.length; k++) {
        const o = open[k];
        const head = pts[0];
        const tail = pts[pts.length - 1];
        if (near(o[0], tail, tol)) pts = pts.concat(o.slice(1));
        else if (near(o[o.length - 1], tail, tol)) pts = pts.concat([...o].reverse().slice(1));
        else if (near(o[o.length - 1], head, tol)) pts = o.slice(0, -1).concat(pts);
        else if (near(o[0], head, tol)) pts = [...o].reverse().slice(0, -1).concat(pts);
        else continue;
        open.splice(k, 1);
        grown = true;
        break;
      }
    }
    if (pts.length > 3 && near(pts[0], pts[pts.length - 1], tol)) out.push({ points: pts.slice(0, -1), closed: true });
    else out.push({ points: pts, closed: false });
  }
  return out;
}

/** Where segment a→b is inside the rectangle: the parameters (t0, t1), or null (Liang–Barsky). */
function clipSegment(a: Pt, b: Pt, r: Crop): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] - r.x0],
    [dx, r.x1 - a[0]],
    [-dy, a[1] - r.y0],
    [dy, r.y1 - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/**
 * A polyline clipped to the crop: the pieces inside it (a closed one that
 * stays whole stays closed).
 */
export function clipToCrop(points: Pt[], closed: boolean, crop: Crop | undefined): { points: Pt[]; closed: boolean }[] {
  if (!crop || points.every(([u, v]) => u >= crop.x0 && u <= crop.x1 && v >= crop.y0 && v <= crop.y1)) {
    return [{ points, closed }];
  }
  const pts = closed ? [...points, points[0]] : points;
  const pieces: Pt[][] = [];
  let cur: Pt[] | null = null;
  const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = clipSegment(pts[i], pts[i + 1], crop);
    if (!c) {
      cur = null;
      continue;
    }
    const a = lerp(pts[i], pts[i + 1], c[0]);
    const b = lerp(pts[i], pts[i + 1], c[1]);
    if (!cur || c[0] > 0) {
      cur = [a];
      pieces.push(cur);
    }
    cur.push(b);
    if (c[1] < 1) cur = null;
  }
  // A closed polyline cut once: its last piece continues into its first.
  if (closed && pieces.length > 1) {
    const first = pieces[0];
    const last = pieces[pieces.length - 1];
    if (near(last[last.length - 1], first[0], 1e-12)) {
      pieces[0] = last.concat(first.slice(1));
      pieces.pop();
    }
  }
  return pieces.filter((p) => p.length >= 2).map((p) => ({ points: p, closed: false }));
}

/** Drop points repeated one after the other. */
function dedupe(points: Pt[], tol: number): Pt[] {
  return points.filter((p, i) => i === 0 || !near(p, points[i - 1], tol));
}

/** The picked lines as model polylines: joined, clipped to the crop, through the transform. */
export function pickedToModel(
  chains: readonly PickedChain[],
  placement: Pick<BackgroundImage, "transform" | "crop">,
  tol: number,
): { points: Pt[]; closed: boolean }[] {
  return joinChains(chains, tol)
    .flatMap((c) => clipToCrop(c.points, c.closed, placement.crop))
    .map((c) => ({ points: dedupe(c.points, tol).map((q) => apply(placement.transform, q)), closed: c.closed }))
    .filter((c) => c.points.length >= 2);
}

export type ExteriorResult =
  | { ok: true; coordinates: Pt[] }
  | { ok: false; gap: number; coordinates: Pt[] }
  | { ok: false; error: string };

/**
 * The exterior boundary the picked lines give: one closed loop. One open
 * polyline whose ends are `closeTol` metres or less apart can be closed
 * (the result says how far apart they are); otherwise why not.
 */
export function exteriorFrom(polylines: { points: Pt[]; closed: boolean }[], closeTol: number): ExteriorResult {
  if (polylines.length === 0) return { ok: false, error: "No lines are picked inside the drawing's crop." };
  if (polylines.length > 1) {
    const closed = polylines.filter((p) => p.closed);
    if (closed.length === 1 && polylines.length > 1) {
      return { ok: false, error: `The picked lines form ${polylines.length} separate pieces. Pick only the lines of the outline: one closed loop.` };
    }
    return { ok: false, error: `The picked lines form ${polylines.length} separate pieces, not one closed loop. Pick lines that join end to end around the slope.` };
  }
  const [p] = polylines;
  if (p.points.length < 3) return { ok: false, error: "The exterior boundary needs at least three points." };
  if (p.closed) return { ok: true, coordinates: p.points };
  const a = p.points[0];
  const b = p.points[p.points.length - 1];
  const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (gap <= closeTol) {
    const pts = gap === 0 ? p.points.slice(0, -1) : p.points;
    return { ok: false, gap, coordinates: pts };
  }
  return {
    ok: false,
    error: `The picked lines do not close: their ends are ${gap.toFixed(2)} m apart. Pick the lines all around the slope (Shift+click adds), or draw the missing part.`,
  };
}
