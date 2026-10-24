/**
 * Where the search-limit markers go, shared by the canvas and the PDF:
 * at each limit a bar on the ground with a triangle outside the range
 * pointing into it, and dots along the ground over each range.
 *
 * In the edit view the markers stand on the ground. Over a result they
 * must not cover it: each triangle is lifted clear of the ground (and so
 * of the sliding mass below it), a limit shared by both ranges is drawn
 * once, and no dots are put over the sliding mass.
 *
 * Everything is in drawing units (canvas px or PDF mm) with y down;
 * `unit` converts the canvas pixel sizes of the style spec to them.
 */
import type { AnalysisLimitsState } from "../../store/types";
import { surfaceYAtX } from "../view/surface";
import { groundBetween, sameRange, searchRange } from "../../utils/slip-mass";
import { limitMarkerGeometry, rangeMarkerEnds } from "../canvas/marker-geometry";
import {
  ENTRY_EXIT_DOT_SPACING_PX,
  MARKER_BAR_H_PX,
  MARKER_SZ_PX,
} from "./style-spec";

type Pt = [number, number];

export type LimitHandle = "entryLeftX" | "entryRightX" | "exitLeftX" | "exitRightX";

/** A search-limit marker in drawing units. */
export interface LimitMarker {
  /** The limit (world x) and the handles at it. */
  x: number;
  handles: LimitHandle[];
  /** Whether it ends the entry range, the exit range or both. */
  entry: boolean;
  exit: boolean;
  /** The bar: at x = cx from barTop to barBottom. */
  cx: number;
  barTop: number;
  barBottom: number;
  /** Triangles pointing into the range: tip, then the two base corners. */
  triangles: [Pt, Pt, Pt][];
}

export interface LimitMarkerOptions {
  /** Over a result: triangles lifted clear of the ground, shared limits once. */
  lifted: boolean;
}

/** Same limit when this close (world units, relative). */
const SAME_X = 1e-9;

/** The ground's highest point (smallest drawing y) between two world x. */
function groundTopBetween(
  coordinates: readonly Pt[],
  toD: (x: number, y: number) => Pt,
  x1: number,
  x2: number,
): number | null {
  const pts = groundBetween(coordinates, x1, x2);
  if (pts.length === 0) return null;
  return Math.min(...pts.map(([x, y]) => toD(x, y)[1]));
}

/**
 * The markers of both search ranges. The ends and their geometry come
 * from marker-geometry.ts (rangeMarkerEnds, limitMarkerGeometry), as the
 * edit-view labels reserve them: a bar across the ground and a triangle
 * outside the range pointing into it, only the bar for a range of zero
 * width. Lifted (over a result), the triangles move up until they clear
 * the ground under them, the bar running up to them from the ground like
 * a flag, and markers at the same x (a limit both ranges share) merge.
 */
export function layoutLimitMarkers(
  limits: AnalysisLimitsState,
  coordinates: readonly Pt[],
  toD: (x: number, y: number) => Pt,
  unit: number,
  { lifted }: LimitMarkerOptions,
): LimitMarker[] {
  const sz = MARKER_SZ_PX * unit;
  const barH = MARKER_BAR_H_PX * unit;
  // Drawing units per world unit along x (signed: a mirrored view is negative).
  const sx = toD(1, 0)[0] - toD(0, 0)[0];
  const out: LimitMarker[] = [];
  /** Each marker's triangles as limitMarkerGeometry gives them (on the ground). */
  const tris = new Map<LimitMarker, [Pt, Pt, Pt][]>();
  const addRange = (a: LimitHandle, b: LimitHandle, kind: "entry" | "exit") => {
    for (const end of rangeMarkerEnds(limits[a], limits[b])) {
      const gy = surfaceYAtX(coordinates as Pt[], end.x);
      if (gy === null) continue;
      const [cx, cy] = toD(end.x, gy);
      const g = limitMarkerGeometry(cx, cy, end.toward === null ? null : toD(end.toward, gy)[0], unit);
      const tol = SAME_X * Math.max(1, Math.abs(end.x));
      const same = lifted ? out.find((m) => Math.abs(m.x - end.x) <= tol) : undefined;
      const m: LimitMarker = same ?? {
        x: end.x,
        handles: [],
        entry: false,
        exit: false,
        cx,
        barTop: cy - g.barH,
        barBottom: cy + g.barH,
        triangles: [],
      };
      if (!same) {
        out.push(m);
        tris.set(m, []);
      }
      m.handles.push(...(end.toward === null ? [a, b] : [end.end === 0 ? a : b]));
      if (kind === "entry") m.entry = true;
      else m.exit = true;
      // A triangle pointing the same way as one already there is the same triangle.
      const t = g.triangle;
      const list = tris.get(m)!;
      if (t && !list.some((o) => Math.sign(o[1][0] - o[0][0]) === Math.sign(t[1][0] - t[0][0]))) list.push(t);
    }
  };
  addRange("entryLeftX", "entryRightX", "entry");
  addRange("exitLeftX", "exitRightX", "exit");

  for (const m of out) {
    const list = tris.get(m)!;
    if (!lifted) {
      m.triangles = list;
      continue;
    }
    // Lift the triangles until their lower edge clears the ground under
    // them (with a small gap); the bar runs from the ground up past them.
    const cy = (m.barTop + m.barBottom) / 2;
    const gap = 2 * unit;
    let ty = cy - sz - gap;
    for (const [tip, base] of list) {
      const top = groundTopBetween(coordinates, toD, m.x, m.x + (base[0] - tip[0]) / sx);
      if (top !== null) ty = Math.min(ty, top - sz - gap);
    }
    m.triangles = list.map((t) => t.map(([x, y]): Pt => [x, y + ty - cy]) as [Pt, Pt, Pt]);
    m.barBottom = cy;
    m.barTop = list.length > 0 ? ty - sz - gap / 2 : cy - 2 * barH;
  }
  return out;
}

/** A dot of a dotted search range: position and the range it marks. */
export interface RangeDot {
  x: number;
  y: number;
  range: "entry" | "exit";
}

export interface RangeDotOptions {
  /** No dots over this world x interval (the sliding mass over a result). */
  skip?: readonly [number, number] | null;
  /** Kept this far (drawing units) from `skip` and from the range ends. */
  radius?: number;
}

/**
 * Dots along the ground over each search range, one spacing apart and
 * not on the ends (where the markers are). Where the entry and exit
 * ranges coincide one row of dots alternates between the two.
 */
export function layoutRangeDots(
  limits: AnalysisLimitsState,
  coordinates: readonly Pt[],
  toD: (x: number, y: number) => Pt,
  unit: number,
  { skip = null, radius = 0 }: RangeDotOptions = {},
): RangeDot[] {
  const entry = searchRange(limits.entryLeftX, limits.entryRightX);
  const exit = searchRange(limits.exitLeftX, limits.exitRightX);
  const coincide = sameRange(entry, exit);
  const spacing = ENTRY_EXIT_DOT_SPACING_PX * unit;
  const sx = Math.abs(toD(1, 0)[0] - toD(0, 0)[0]);
  const margin = sx > 0 ? radius / sx : 0;
  const out: RangeDot[] = [];
  const dotted = (lo: number, hi: number, kinds: RangeDot["range"][]) => {
    const world = groundBetween(coordinates, lo, hi);
    if (world.length < 2) return;
    const pts = world.map(([x, y]) => toD(x, y));
    let k = 0;
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      if (segLen === 0) continue;
      for (let t = spacing - carry; t < segLen - 0.1 * unit; t += spacing) {
        const f = t / segLen;
        const wx = world[i][0] + f * (world[i + 1][0] - world[i][0]);
        const range = kinds[k++ % kinds.length];
        if (skip && wx >= Math.min(...skip) - margin && wx <= Math.max(...skip) + margin) continue;
        out.push({ x: x1 + f * (x2 - x1), y: y1 + f * (y2 - y1), range });
      }
      carry = (carry + segLen) % spacing;
    }
  };
  const onGround = (r: ReturnType<typeof searchRange>) =>
    !r.point && surfaceYAtX(coordinates as Pt[], r.lo) !== null && surfaceYAtX(coordinates as Pt[], r.hi) !== null;
  if (onGround(entry)) dotted(entry.lo, entry.hi, coincide ? ["entry", "exit"] : ["entry"]);
  if (!coincide && onGround(exit)) dotted(exit.lo, exit.hi, ["exit"]);
  return out;
}
