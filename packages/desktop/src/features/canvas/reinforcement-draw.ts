import type { ReinforcementForce } from "@cslope/engine";
import type { AnalysisLimitsState, PileRow, ReinforcementRow } from "../../store/types";
import {
  pointSegmentDistance,
  polylineSegments,
  segmentBoxGap,
  segmentDistance,
  segmentHitsBox,
  stackPositions,
  type Seg,
} from "../rendering/overlay-layout";
import { layoutLimitMarkers } from "../rendering/search-markers";
import { surfaceYAtX } from "../view/surface";
import { boxAround, boxesOverlap, type Box } from "./label-layout";

export const REINFORCEMENT_COLOR = "#8e44ad";

/** Least distance of force labels from the plot frame, in canvas px. */
export const FORCE_LABEL_MARGIN_PX = 12;

/**
 * Label of a reinforcement force in kN/m. A passive force is an ultimate
 * capacity that the analysis divides by the factor of safety: "÷ FOS".
 */
export function formatReinforcementForce(f: Pick<ReinforcementForce, "force" | "passive">): string {
  return `${formatForceValue(f)}${f.passive ? " ÷ FOS" : ""}`;
}

/** The size of a force in kN/m, without the passive marker. */
export function formatForceValue(f: Pick<ReinforcementForce, "force">): string {
  // Decimals from the rounded value: 99.96 is "100", not "100.0".
  const oneDecimal = f.force.toFixed(1);
  return `${Number(oneDecimal) >= 100 ? f.force.toFixed(0) : oneDecimal} kN/m`;
}

/** Whether a force shows as 0.0 kN/m: it is not drawn. */
export function forceRoundsToZero(f: Pick<ReinforcementForce, "force">): boolean {
  return !(Math.abs(Number(f.force.toFixed(1))) > 0);
}

/** Part of an element that develops pullout, as fractions [from, to] of its length. */
export function bondedSpan(r: ReinforcementRow): [number, number] | null {
  if (r.pullout === "none") return null;
  const length = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
  if (!(length > 0)) return null;
  if (r.pullout === "bond" && r.bondedLength > 0 && r.bondedLength < length) {
    return [1 - r.bondedLength / length, 1];
  }
  return [0, 1];
}

/**
 * Where an element's number goes: out from the head (`ox`, `oy`: unit
 * vector away from the element) on its line, far enough that the number
 * (text size `size`) clears a vertex dot at the head, as the head often is
 * a vertex of the model. Centre, its distance from the head, half sizes
 * and box.
 */
export function elementNumberBox(
  ax: number,
  ay: number,
  ox: number,
  oy: number,
  index: number,
  size: number,
): { x: number; y: number; d: number; hw: number; hh: number; box: Box } {
  const hw = size * (0.15 * String(index + 1).length + 0.35);
  const hh = size / 2;
  // Vertex dot (6 px for 11 px text) and a gap, then half the number.
  const d = 0.7 * size + Math.abs(ox) * hw + Math.abs(oy) * hh;
  const x = ax + ox * d;
  const y = ay + oy * d;
  return { x, y, d, hw, hh, box: boxAround(x, y, hw, hh) };
}

type WorldPt = readonly [number, number];

/**
 * What element numbers keep off: lines (world polylines: the model
 * boundary, material boundaries inside the model, water lines), the vertex
 * dots of the edit view (world points) and boxes (drawing units: the
 * search-limit markers over a result).
 */
export interface NumberScene {
  lines: readonly (readonly WorldPt[])[];
  dots: readonly WorldPt[];
  boxes?: readonly Box[];
}

/**
 * The NumberScene of a model, built the same way wherever element numbers
 * are drawn or reserved: `edit` adds the vertex dots of the edit view
 * (model, material boundary and water line points), `boxes` the markers.
 */
export function elementNumberScene(
  m: {
    coordinates: readonly WorldPt[];
    materialBoundaries?: readonly { coordinates: readonly WorldPt[] }[];
    piezometricLine?: { lines: readonly { coordinates: readonly WorldPt[] }[] };
  },
  edit: boolean,
  boxes: readonly Box[] = [],
): NumberScene {
  const model = m.coordinates;
  const lines: WorldPt[][] = [];
  if (model.length > 2) lines.push([...model, model[0]]);
  const water = (m.piezometricLine?.lines ?? []).map((l) => l.coordinates);
  lines.push(...water.map((l) => [...l]));
  // Only the part of a boundary inside the model divides the soil (and is drawn).
  for (const b of m.materialBoundaries ?? []) {
    for (let i = 1; i < b.coordinates.length; i++) {
      const [x1, y1] = b.coordinates[i - 1];
      const [x2, y2] = b.coordinates[i];
      if (model.length < 3 || pointInPolygon((x1 + x2) / 2, (y1 + y2) / 2, model as Pt[])) {
        lines.push([b.coordinates[i - 1], b.coordinates[i]]);
      }
    }
  }
  const dots = edit ? [...model, ...(m.materialBoundaries ?? []).flatMap((b) => b.coordinates), ...water.flat()] : [];
  return { lines, dots, boxes };
}

/**
 * Where each element's number goes (elementNumberBox), keeping off the
 * lines, dots and boxes of `scene` and the other elements: of a few spots (on the element's line farther out, then
 * to either side of it) the first that is clear, else the usual one.
 * Without a scene, always the usual one. Null for an element of zero length.
 */
export function elementNumberLayout(
  rows: readonly Pick<ReinforcementRow, "x1" | "y1" | "x2" | "y2">[],
  toScreen: (x: number, y: number) => [number, number],
  size: number,
  scene?: NumberScene,
): ({ x: number; y: number; hw: number; hh: number; box: Box } | null)[] {
  const ends = rows.map((r) => [toScreen(r.x1, r.y1), toScreen(r.x2, r.y2)] as const);
  const segs: Seg[] = scene
    ? [
        ...ends.map(([[ax, ay], [bx, by]]): Seg => [ax, ay, bx, by]),
        ...scene.lines.flatMap((l) => polylineSegments(l.map(([x, y]) => toScreen(x, y)))),
      ]
    : [];
  const dotR = 0.55 * size;
  const taken: readonly Box[] = scene
    ? [...(scene.boxes ?? []), ...scene.dots.map(([x, y]) => boxAround(...toScreen(x, y), dotR))]
    : [];
  const inset = 0.1 * size;
  const coreOf = (b: Box): Box => ({ left: b.left + inset, top: b.top + inset, right: b.right - inset, bottom: b.bottom - inset });
  const clear = (b: Box) => {
    const core = coreOf(b);
    return !segs.some((sg) => segmentHitsBox(sg, core)) && !taken.some((t) => boxesOverlap(core, t, 0));
  };
  const bases = ends.map(([[ax, ay], [bx, by]], i) => {
    const len = Math.hypot(bx - ax, by - ay);
    return len > 0 ? elementNumberBox(ax, ay, (ax - bx) / len, (ay - by) / len, i, size) : null;
  });
  if (!scene) return bases;
  // Numbers of close, parallel elements may touch at their usual spots
  // (they line up, in order); one that has to move keeps off the others.
  const numbers = bases.flatMap((b) => (b ? [b.box] : []));
  return ends.map(([[ax, ay], [bx, by]], i) => {
    const base = bases[i];
    if (!base) return null;
    if (clear(base.box)) return base;
    const len = Math.hypot(bx - ax, by - ay);
    const ox = (ax - bx) / len;
    const oy = (ay - by) / len;
    const { hw, hh } = base;
    const at = (x: number, y: number) => ({ x, y, hw, hh, box: boxAround(x, y, hw, hh) });
    // Beside the usual spot (up the page first) or a little farther out
    // on the line, before farther out still: close to the head.
    let px = -oy;
    let py = ox;
    if (py > 0 || (py === 0 && px < 0)) {
      px = -px;
      py = -py;
    }
    const across = 0.6 * (Math.abs(px) * 2 * hw + Math.abs(py) * 2 * hh);
    const spot = (e: number, sd: number) =>
      at(base.x + ox * e * size + px * sd * across, base.y + oy * e * size + py * sd * across);
    const cands = [spot(0, 1), spot(0.5, 0), spot(0, -1), spot(0.5, 1), spot(1, 0), spot(0.5, -1), spot(1.5, 0)];
    const free = (b: Box) => clear(b) && !numbers.some((n) => n !== base.box && boxesOverlap(coreOf(b), coreOf(n), 0));
    const pick = cands.find((c) => free(c.box));
    if (!pick) return base;
    numbers[numbers.indexOf(base.box)] = pick.box;
    return pick;
  });
}

/** A light outline of the background colour behind text, so it reads on dark fills and over lines. */
export function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, halo: string, width: number): void {
  ctx.save();
  ctx.strokeStyle = halo;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

/**
 * Draw reinforcement elements: the bar, a plate at the head (end 1), the
 * bonded part as a wider translucent band and, without pullout, anchor
 * blocks at both ends; numbered at the head.
 */
export function drawReinforcements(
  ctx: CanvasRenderingContext2D,
  rows: readonly ReinforcementRow[],
  toCanvas: (x: number, y: number) => [number, number],
  zoom = 1,
  /** What the numbers keep off (elementNumberLayout) and the colour of their halo. */
  numbers: { scene?: NumberScene; halo?: string } = {},
): void {
  ctx.save();
  const nums = elementNumberLayout(rows, toCanvas, 11 * zoom, numbers.scene);
  rows.forEach((r, i) => {
    const [ax, ay] = toCanvas(r.x1, r.y1);
    const [bx, by] = toCanvas(r.x2, r.y2);
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 0)) return;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const span = bondedSpan(r);
    if (span) {
      ctx.strokeStyle = REINFORCEMENT_COLOR;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 7 * zoom;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ax + ux * len * span[0], ay + uy * len * span[0]);
      ctx.lineTo(ax + ux * len * span[1], ay + uy * len * span[1]);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = REINFORCEMENT_COLOR;
    ctx.lineWidth = (r.type === "geosynthetic" ? 1.5 : 2) * zoom;
    ctx.setLineDash(r.type === "geosynthetic" ? [6 * zoom, 3 * zoom] : []);
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    // Head plate across the bar.
    const p = 5 * zoom;
    ctx.lineWidth = 2.5 * zoom;
    ctx.beginPath();
    ctx.moveTo(ax - uy * p, ay + ux * p);
    ctx.lineTo(ax + uy * p, ay - ux * p);
    ctx.stroke();
    if (r.pullout === "none") {
      ctx.fillStyle = REINFORCEMENT_COLOR;
      const s = 3.5 * zoom;
      ctx.fillRect(bx - s, by - s, 2 * s, 2 * s);
    }
    ctx.fillStyle = REINFORCEMENT_COLOR;
    ctx.font = `bold ${11 * zoom}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const num = nums[i];
    if (num) haloText(ctx, String(i + 1), num.x, num.y, numbers.halo ?? "#ffffff", 3 * zoom);
  });
  ctx.restore();
}

type Pt = [number, number];

/** An element as its force labels see it, in drawing units. */
export interface ElementHead {
  head: Pt;
  tail: Pt;
  /** Unit vector from the tail out through the head. */
  out: Pt;
  /** Where its force labels attach: on the line out of the head, beyond the number (or pile name). */
  anchor: Pt;
}

/** What force arrows and labels must keep clear of, in drawing units. */
export interface ForceLabelContext {
  /** Lines labels should not cross: elements, piles, the slip surface. */
  obstacles: Seg[];
  /** Boxes already taken (head plates, element numbers, pile names, loads); placed labels are added. */
  placed: Box[];
  /** Each element's head by its index: its force labels go there. */
  heads?: { reinforcements: (ElementHead | null)[]; piles: (ElementHead | null)[] };
  /** Element and pile lines, so an arrow keeps clear of all but its own. */
  lines?: { seg: Seg; pile: boolean; index: number }[];
  /** The critical slip surface: arrows keep clear of it. */
  slip?: Seg[];
  /** More lines arrows and labels keep clear of: the model boundary, water lines. */
  extra?: Seg[];
  /** Material boundaries: arrows keep clear of them (labels, mostly outside the model, need not). */
  boundaries?: Seg[];
  /** Labels stay inside this box (the plot frame). */
  bounds?: Box;
  /** The model outline: labels prefer the open space in front of it. */
  area?: Pt[];
}

/** Whether (x, y) lies inside a polygon (even-odd rule). */
function pointInPolygon(x: number, y: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Obstacles and anchors for the force labels: the reinforcement and pile
 * lines, the critical slip surface, the element numbers and pile names as
 * boxes (`numberSize`: their text size, the number centred 0.9 of it out
 * from the head, the pile name above the head), and each element's label
 * anchor beyond them. Optionally the model boundary and water lines (lines
 * to keep clear of), loads (boxes) and the plot frame (`bounds`).
 */
export function forceLabelContext(
  toScreen: (x: number, y: number) => [number, number],
  opts: {
    reinforcements?: readonly ReinforcementRow[];
    piles?: readonly PileRow[];
    surface?: readonly [number, number][];
    numberSize: number;
    model?: readonly (readonly [number, number])[];
    water?: readonly (readonly (readonly [number, number])[])[];
    /** Material boundaries: lines the arrows keep clear of. */
    boundaries?: readonly (readonly (readonly [number, number])[])[];
    loads?: readonly Box[];
    /** More boxes to keep clear of (the search-limit markers). */
    markers?: readonly Box[];
    bounds?: Box;
    /** What the element numbers keep off, as where they are drawn (elementNumberLayout). */
    numberScene?: NumberScene;
  },
): ForceLabelContext {
  const obstacles: Seg[] = [];
  const placed: Box[] = [];
  const lines: { seg: Seg; pile: boolean; index: number }[] = [];
  const s = opts.numberSize;
  const gap = 0.3 * s;
  const nums = elementNumberLayout(opts.reinforcements ?? [], toScreen, s, opts.numberScene);
  const reinforcements = (opts.reinforcements ?? []).map((r, i): ElementHead | null => {
    const [ax, ay] = toScreen(r.x1, r.y1);
    const [bx, by] = toScreen(r.x2, r.y2);
    const seg: Seg = [ax, ay, bx, by];
    obstacles.push(seg);
    lines.push({ seg, pile: false, index: i });
    placed.push(boxAround(ax, ay, s / 2)); // head plate
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 0)) return null;
    const ox = (ax - bx) / len;
    const oy = (ay - by) / len;
    const num = nums[i]!;
    placed.push(num.box);
    // Beyond the number, out along the element's line.
    const d = Math.abs(ox) * num.hw + Math.abs(oy) * num.hh + gap;
    return { head: [ax, ay], tail: [bx, by], out: [ox, oy], anchor: [num.x + ox * d, num.y + oy * d] };
  });
  const piles = (opts.piles ?? []).map((p, i): ElementHead | null => {
    const [ax, ay] = toScreen(p.x1, p.y1);
    const [bx, by] = toScreen(p.x2, p.y2);
    const seg: Seg = [ax, ay, bx, by];
    obstacles.push(seg);
    lines.push({ seg, pile: true, index: i });
    placed.push({ left: ax - s, top: ay - s * 1.4, right: ax + s, bottom: ay - s * 0.4 });
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 0)) return null;
    const ox = (ax - bx) / len;
    const oy = (ay - by) / len;
    // Beyond the name when the pile stands up from its head, else just out of the head.
    const d = oy < -0.3 ? (1.4 * s + gap) / -oy : 0.5 * s + gap;
    return { head: [ax, ay], tail: [bx, by], out: [ox, oy], anchor: [ax + ox * d, ay + oy * d] };
  });
  const slip = opts.surface ? polylineSegments(opts.surface.map(([x, y]) => toScreen(x, y))) : [];
  obstacles.push(...slip);
  const extra: Seg[] = [];
  const area = opts.model && opts.model.length > 2 ? opts.model.map(([x, y]) => toScreen(x, y)) : undefined;
  if (area) extra.push(...polylineSegments([...area, area[0]]));
  for (const w of opts.water ?? []) extra.push(...polylineSegments(w.map(([x, y]) => toScreen(x, y))));
  const boundaries = (opts.boundaries ?? []).flatMap((b) => polylineSegments(b.map(([x, y]) => toScreen(x, y))));
  placed.push(...(opts.loads ?? []), ...(opts.markers ?? []));
  return { obstacles, placed, heads: { reinforcements, piles }, lines, slip, extra, boundaries, bounds: opts.bounds, area };
}

/** The box around some points. */
export function pointsBox(pts: readonly (readonly [number, number])[]): Box {
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/**
 * Boxes over the loads on the ground, `height` (drawing units) high: one
 * per ground segment under a UDL, a narrow one along a line load arrow.
 * Force labels keep out of them.
 */
export function loadObstacleBoxes(
  toScreen: (x: number, y: number) => [number, number],
  coordinates: readonly [number, number][],
  udls: readonly { x1: number; x2: number }[],
  lineLoads: readonly { x: number }[],
  height: number,
): Box[] {
  if (coordinates.length < 3) return [];
  const ground = (x: number): [number, number] | null => {
    const y = surfaceYAtX(coordinates as [number, number][], x);
    return y === null ? null : toScreen(x, y);
  };
  const out: Box[] = [];
  for (const u of udls) {
    const lo = Math.min(u.x1, u.x2);
    const hi = Math.max(u.x1, u.x2);
    const xs = [lo, ...coordinates.map(([x]) => x).filter((x) => x > lo && x < hi), hi].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const a = ground(xs[i - 1]);
      const b = ground(xs[i]);
      if (!a || !b) continue;
      const box = pointsBox([a, b]);
      out.push({ ...box, top: box.top - height });
    }
  }
  for (const l of lineLoads) {
    const g = ground(l.x);
    if (g) out.push({ left: g[0] - height * 0.15, top: g[1] - height, right: g[0] + height * 0.15, bottom: g[1] });
  }
  return out;
}

/**
 * Boxes over the search-limit markers as drawn over a result (lifted
 * triangles and their bars, from layoutLimitMarkers), padded by `pad`:
 * force labels keep out of them.
 */
export function limitMarkerObstacles(
  limits: AnalysisLimitsState,
  coordinates: readonly [number, number][],
  toScreen: (x: number, y: number) => [number, number],
  unit: number,
  pad = 0,
): Box[] {
  if (!limits.enabled || coordinates.length < 3) return [];
  const out: Box[] = [];
  for (const m of layoutLimitMarkers(limits, coordinates, toScreen, unit, { lifted: true })) {
    out.push({ left: m.cx - pad, top: m.barTop - pad, right: m.cx + pad, bottom: m.barBottom + pad });
    for (const t of m.triangles) {
      const b = pointsBox(t);
      out.push({ left: b.left - pad, top: b.top - pad, right: b.right + pad, bottom: b.bottom + pad });
    }
  }
  return out;
}

/** Sizes of the force arrows and labels, in drawing units. */
export interface ForceSize {
  /** Longest arrow. */
  arrow: number;
  /** Arrowhead length and half width. */
  head: number;
  headHalf: number;
  /** Distance of the arrow from the line it acts along. */
  offset: number;
  /** Least space between an arrow and the other lines. */
  clear: number;
  /** Space around labels. */
  gap: number;
  /** Plate padding. */
  pad: number;
  /** Text size (em). */
  textH: number;
  measure: (text: string) => number;
}

/** A force as drawn: its arrow, its label box and the leader from the label to its element. */
export interface ForceLayout {
  /** Full label text ("12.3 kN/m ÷ FOS"); drawn as `value` and, when passive, a ÷ sign and "FOS". */
  text: string;
  value: string;
  passive: boolean;
  /** Arrow start and tip, and its unit direction. */
  from: [number, number];
  to: [number, number];
  ux: number;
  uy: number;
  /** Arrowhead length and half width (smaller between close elements). */
  head: number;
  headHalf: number;
  label: Box;
  /** Thin line from the label to the element head, when the label is not on the head's line. */
  leader: Seg | null;
}

/** Width of the ÷ sign, in em. */
const DIVIDE_EM = 0.6;

/** Width of a force label's text (see forceLabelPieces). */
export function forceLabelWidth(value: string, passive: boolean, measure: (t: string) => number, em: number): number {
  return measure(value) + (passive ? 2 * measure(" ") + DIVIDE_EM * em + measure("FOS") : 0);
}

/**
 * Where the parts of a label go: the value from the left of the plate and,
 * for a passive force, the ÷ sign (its centre) and "FOS". The ÷ is drawn
 * as a bar and two dots (divideSign) so it cannot read as "+" at screen
 * size, where a font's ÷ glyph at label size often does.
 */
export function forceLabelPieces(
  l: Pick<ForceLayout, "label" | "value" | "passive">,
  pad: number,
  measure: (t: string) => number,
  em: number,
): { valueX: number; divideX: number | null; fosX: number | null } {
  const x0 = l.label.left + pad;
  if (!l.passive) return { valueX: x0, divideX: null, fosX: null };
  const after = x0 + measure(l.value) + measure(" ");
  return { valueX: x0, divideX: after + (DIVIDE_EM * em) / 2, fosX: after + DIVIDE_EM * em + measure(" ") };
}

/** The ÷ sign centred at (cx, cy): a bar (with its stroke width) and two dots. */
export function divideSign(cx: number, cy: number, em: number): { bar: Seg; width: number; dots: Pt[]; r: number } {
  const half = 0.27 * em;
  return {
    bar: [cx - half, cy, cx + half, cy],
    width: 0.12 * em,
    dots: [
      [cx, cy - 0.33 * em],
      [cx, cy + 0.33 * em],
    ],
    r: 0.13 * em,
  };
}

/**
 * Lays out the force arrows and labels.
 *
 * Arrow: from the crossing with the slip surface in the direction of the
 * force, moved `offset` to the side (up the page first; between close
 * parallel elements at most 30 % of their spacing, the arrow smaller) so
 * the element and the slip line stay visible, and along to just past the
 * slip line or its own element where those cross it; on the other side,
 * moved a little along, or shortened when it would come closer than
 * `clear` to the slip line, its own or other elements, boundaries or
 * arrows. It never runs past the ends of its element.
 *
 * Label: as engineering drawings label many parallel members, each value
 * sits at its element's head, outside, on the element's line extended
 * beyond its number (pile: above its name), so it pairs with its element
 * by position. Where the arrows are far from the heads (and not crowded)
 * the values go beside their arrows instead, see below. Labels on the same side are stacked in element order at
 * least a label height apart with the least movement; a crowd that had to
 * move (rows closer than the label height, or a label moved off a line,
 * load or the frame edge) becomes a column just outside the heads, with a
 * thin leader from each label to its own head's number (not repeated in
 * the label); the order keeps leaders from crossing. No value is ever left out. Forces without an element
 * (stale results) are labelled beyond the arrow tip. Forces that round to
 * 0.0 kN/m are not drawn.
 */
export function layoutReinforcementForces(
  forces: readonly ReinforcementForce[],
  toScreen: (x: number, y: number) => [number, number],
  size: ForceSize,
  context: ForceLabelContext = { obstacles: [], placed: [] },
): ForceLayout[] {
  const items = forces.flatMap((f) => {
    const n = Math.hypot(f.fx, f.fy);
    if (!(n > 0) || forceRoundsToZero(f)) return [];
    const [px, py] = toScreen(f.x, f.y);
    // Screen y grows downwards.
    const ux = f.fx / n;
    const uy = -f.fy / n;
    // The normal pointing up the page (to +x for a vertical arrow) first.
    let nx = uy;
    let ny = -ux;
    if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const head = (f.pile ? context.heads?.piles : context.heads?.reinforcements)?.[f.index] ?? null;
    return [{ f, px, py, ux, uy, nx, ny, head, value: formatForceValue(f) }];
  });

  // ── Arrows ──
  const slip = context.slip ?? [];
  const lines = context.lines ?? [];
  const arrows: Seg[] = [];
  /** Each arrow's head length and half width (smaller between close elements). */
  const heads: [number, number][] = [];
  /** Distance from each crossing to the nearest other element. */
  const spacings: number[] = [];
  for (const it of items) {
    const { px, py, ux, uy, nx, ny, head } = it;
    const own = (l: { pile: boolean; index: number }) => l.pile === !!it.f.pile && l.index === it.f.index;
    let spacing = Infinity;
    for (const l of lines) if (!own(l)) spacing = Math.min(spacing, pointSegmentDistance(px, py, l.seg));
    spacings.push(spacing);
    const ownSegs = head ? lines.filter(own).map((l) => l.seg) : [];
    let len = Infinity;
    let ue = 0;
    let sP = 0;
    if (head) {
      const dx = head.tail[0] - head.head[0];
      const dy = head.tail[1] - head.head[1];
      len = Math.hypot(dx, dy);
      if (len > 0) {
        ue = (ux * dx + uy * dy) / len;
        sP = ((px - head.head[0]) * dx + (py - head.head[1]) * dy) / len;
      }
    }
    // An arrow along its element between close elements (a dense wall)
    // stays within about 30 % of the spacing of its own element, so it
    // cannot read as the neighbour's; it and its head shrink to fit.
    const k = Math.abs(ue) >= 0.9 ? Math.max(0.45, Math.min(1, (0.3 * spacing) / size.offset)) : 1;
    const offset = size.offset * k;
    const headLen = size.head * Math.max(0.7, k);
    const headHalf = size.headHalf * k;
    const along = Math.abs(ue) > 1e-6;
    // Arrow parameters t (from the crossing along u) that stay on the element.
    const tLo = !along ? -Infinity : ue > 0 ? -sP / ue : (len - sP) / ue;
    const tHi = !along ? Infinity : ue > 0 ? (len - sP) / ue : -sP / ue;
    const lMax = Math.min(size.arrow, len);
    const lMin = Math.min(2 * headLen, lMax);
    const base = Math.max(lMin, Math.min(lMax, tHi));
    const lengths = [base, base * 0.7, base * 0.5].filter((l, i) => i === 0 || l >= lMin);
    const others = [...slip, ...lines.filter((l) => !own(l)).map((l) => l.seg), ...arrows];
    const extra = [...(context.extra ?? []), ...(context.boundaries ?? [])];
    const step = 2 * size.headHalf;
    /** Where the line from (fx, fy) along the force crosses a segment (parameter along it, and the sine of the angle). */
    const crossings = (fx: number, fy: number, segs: readonly Seg[]): { t: number; sin: number }[] => {
      const out: { t: number; sin: number }[] = [];
      for (const [x1, y1, x2, y2] of segs) {
        const ex = x2 - x1;
        const ey = y2 - y1;
        const den = ux * ey - uy * ex;
        const el = Math.hypot(ex, ey);
        if (!(el > 0) || Math.abs(den) < 1e-9 * el) continue;
        const t = ((x1 - fx) * ey - (y1 - fy) * ex) / den;
        const s = ((x1 - fx) * uy - (y1 - fy) * ux) / den;
        if (s >= -0.05 && s <= 1.05) out.push({ t, sin: Math.abs(den) / el });
      }
      return out;
    };
    const sideCandidates = (side: number): Seg[] => {
      const sx = px + nx * side * offset;
      const sy = py + ny * side * offset;
      // Moved along the force a few steps and, where its own line or the
      // slip line crosses it, to just past the crossing (starting on that
      // line would hide its tail).
      const shifts = [0, step, 2 * step, 3 * step];
      for (const c of crossings(sx, sy, [...slip, ...ownSegs])) {
        const past = c.t + (size.clear + 0.5 * size.headHalf) / Math.max(c.sin, 0.25);
        if (past > 0 && c.t < 3 * step + size.arrow) shifts.push(past, past + step / 2);
      }
      shifts.sort((a, b) => a - b);
      const out: Seg[] = [];
      for (const L of lengths) {
        for (const a of shifts) {
          // Back off when the arrow would run past the element's end.
          const shift = Math.max(tLo, Math.min(a, tHi - L));
          const fx = sx + ux * shift;
          const fy = sy + uy * shift;
          out.push([fx, fy, fx + ux * L, fy + uy * L]);
        }
      }
      return out;
    };
    const up = sideCandidates(1);
    const down = sideCandidates(-1);
    /**
     * Clearance from the lines, beyond what the shaft and the head need,
     * strict and relaxed (half for boundary and water lines). Its own
     * element counts too: an arrow across it (a force at an angle to a
     * pile) or on it hides it. Worked out once a candidate; a line whose
     * box is farther off than the clearance found so far is passed over.
     */
    const scores = new Map<Seg, { strict: number; relaxed: number }>();
    const scoreOf = (c: Seg): { strict: number; relaxed: number } => {
      const known = scores.get(c);
      if (known) return known;
      const [fx, fy, tx, ty] = c;
      const neckX = tx - ux * headLen;
      const neckY = ty - uy * headLen;
      const shaft: Seg = [fx, fy, neckX, neckY];
      const tip: Seg = [neckX, neckY, tx, ty];
      // Least clearance to a line, kept clear by kc times the clearance.
      const near = (o: Seg, kc: number, sc: number): number => {
        if (segmentBoxGap(c, o) - kc * (headHalf + size.clear) >= sc) return sc;
        return Math.min(sc, segmentDistance(shaft, o) - kc * size.clear, segmentDistance(tip, o) - kc * (headHalf + size.clear));
      };
      let base = Infinity;
      for (const o of others) base = near(o, 1, base);
      for (const o of ownSegs) base = near(o, 0.5 * k, base);
      let strict = base;
      let relaxed = base;
      for (const o of extra) {
        strict = near(o, 1, strict);
        relaxed = near(o, 0.5, relaxed);
      }
      const s = { strict, relaxed };
      scores.set(c, s);
      return s;
    };
    // Up the page where it is clear, or only touches a boundary or water
    // line (all arrows on the same side of their elements read best); else
    // down; else the clearest.
    const best =
      up.find((c) => scoreOf(c).strict >= 0) ??
      up.find((c) => scoreOf(c).relaxed >= 0) ??
      down.find((c) => scoreOf(c).strict >= 0) ??
      down.find((c) => scoreOf(c).relaxed >= 0) ??
      [...up, ...down].reduce((a, b) => (scoreOf(b).relaxed > scoreOf(a).relaxed ? b : a));
    arrows.push(best);
    heads.push([headLen, headHalf]);
  }

  // ── Labels ──
  const h = size.textH + 2 * size.pad;
  const pitch = h;
  const lineSegs = [...context.obstacles, ...(context.extra ?? [])];
  const segs = [...lineSegs, ...arrows];
  const bounds = context.bounds;
  const area = context.area;
  interface Lab {
    k: number;
    w: number;
    anchor: Pt;
    /** Labels stack along y (beside a head pointing left or right) or along x (above or below). */
    alongY: boolean;
    /** Outward along the other axis. */
    sign: number;
    /** Centre on the other axis: on the anchor, and in a column just outside it (with a leader). */
    cross: number;
    colCross: number;
    /** Wanted and final centre along the stacking axis. */
    c0: number;
    c: number;
    /** Moved inside the frame on the other axis: always with a leader. */
    clamped: boolean;
  }
  const boxAt = (l: Lab, cross: number, c: number): Box =>
    l.alongY ? boxAround(cross, c, l.w / 2, h / 2) : boxAround(c, cross, l.w / 2, h / 2);
  const done: Box[] = [];
  /** Moves a centre on the cross axis so the box lies inside the bounds. */
  const clampCross = (l: Lab, cross: number): number => {
    if (!bounds) return cross;
    const half = l.alongY ? l.w / 2 : h / 2;
    const lo = (l.alongY ? bounds.left : bounds.top) + half;
    const hi = (l.alongY ? bounds.right : bounds.bottom) - half;
    return lo > hi ? cross : Math.max(lo, Math.min(hi, cross));
  };
  /** Off its own line by more than a search step: shown in a column with a leader. */
  const movedAt = (l: Lab, c: number) => l.clamped || Math.abs(c - l.c0) > 0.4 * h;
  const crossAt = (l: Lab, c: number) => (movedAt(l, c) && !l.clamped ? l.colCross : l.cross);
  /** Leader from the label's edge facing the anchor to the anchor. */
  const leaderOf = (l: Lab, b: Box): Seg | null => {
    const [ax, ay] = l.anchor;
    const c = l.alongY ? (b.top + b.bottom) / 2 : (b.left + b.right) / 2;
    let sx: number;
    let sy: number;
    if (l.alongY) {
      sx = l.sign < 0 ? b.right : b.left;
      sy = c;
      if (l.sign < 0 ? sx > ax : sx < ax) {
        sx = Math.max(b.left, Math.min(b.right, ax));
        sy = ay < b.top ? b.top : ay > b.bottom ? b.bottom : c;
      }
    } else {
      sx = c;
      sy = l.sign < 0 ? b.bottom : b.top;
      if (l.sign < 0 ? sy > ay : sy < ay) {
        sy = Math.max(b.top, Math.min(b.bottom, ay));
        sx = ax < b.left ? b.left : ax > b.right ? b.right : c;
      }
    }
    return Math.hypot(ax - sx, ay - sy) > size.gap / 2 ? [sx, sy, ax, ay] : null;
  };
  /**
   * How bad a label is at `c`: lines through it, boxes under it, outside
   * the frame, inside the soil (labels belong in front of the face), and
   * lines its leader crosses.
   */
  const labelCost = (l: Lab, c: number): number => {
    const b = boxAt(l, crossAt(l, c), c);
    let n = 0;
    for (const s of segs) if (segmentHitsBox(s, b)) n++;
    for (const p of context.placed) if (boxesOverlap(b, p, 0)) n += 2;
    for (const p of done) if (boxesOverlap(b, p, 0)) n += 2;
    for (const p of fixed) if (boxesOverlap(b, p, 0)) n += 2;
    if (bounds && (b.left < bounds.left || b.right > bounds.right || b.top < bounds.top || b.bottom > bounds.bottom)) {
      n += 4;
    }
    if (area && pointInPolygon((b.left + b.right) / 2, (b.top + b.bottom) / 2, area)) n += 1;
    if (movedAt(l, c)) {
      const leader = leaderOf(l, b);
      if (leader) {
        // Short of the anchor, which may itself lie on a line (an element along the ground).
        const [sx, sy, ax, ay] = leader;
        const len = Math.hypot(ax - sx, ay - sy);
        const t = Math.max(0, 1 - size.gap / len);
        const run: Seg = [sx, sy, sx + (ax - sx) * t, sy + (ay - sy) * t];
        for (const s of lineSegs) if (segmentBoxGap(run, s) < 1e-9 && segmentDistance(run, s) < 1e-9) n++;
      }
    }
    return n;
  };
  const leaders = new Map<number, Seg | null>();
  const finalBox = new Map<number, Box>();
  const widthOf = (k: number) => forceLabelWidth(items[k].value, items[k].f.passive, size.measure, size.textH) + 2 * size.pad;

  // Where the arrow is far from its element's head (the slip surface
  // crosses a long element far from its head), a value at the head pairs
  // poorly with the arrow: those values go beside their arrows instead,
  // unless the elements or the arrows are too close for a label beside
  // each arrow (a dense wall), where the stack at the heads reads better. One rule for
  // all labels on one side of the heads: at the arrows when most of their
  // arrows (their middles) are farther than `far` from the heads, with room
  // around them.
  const far = 9 * size.textH;
  const sideOf = (k: number) => {
    const [ox, oy] = items[k].head?.out ?? [items[k].ux, items[k].uy];
    return Math.abs(ox) >= Math.abs(oy) ? (ox < 0 ? "l" : "r") : oy < 0 ? "u" : "d";
  };
  const isFar = items.map(
    (it, k) =>
      !!it.head &&
      spacings[k] >= 2 * h &&
      arrows.every((a, j) => j === k || segmentDistance(a, arrows[k]) >= 3 * h) &&
      Math.hypot((arrows[k][0] + arrows[k][2]) / 2 - it.head.head[0], (arrows[k][1] + arrows[k][3]) / 2 - it.head.head[1]) > far,
  );
  const sideVotes = new Map<string, number>();
  items.forEach((it, k) => {
    if (it.head) sideVotes.set(sideOf(k), (sideVotes.get(sideOf(k)) ?? 0) + (isFar[k] ? 1 : -1));
  });
  const atArrow = items.map((it, k) => !!it.head && (sideVotes.get(sideOf(k)) ?? 0) > 0);
  /** Boxes of the labels placed beside their arrows. */
  const fixed: Box[] = [];
  const boxCost = (b: Box): number => {
    let n = 0;
    for (const s of segs) if (segmentHitsBox(s, b)) n++;
    for (const p of context.placed) if (boxesOverlap(b, p, 0)) n += 2;
    for (const p of fixed) if (boxesOverlap(b, p, 0)) n += 2;
    if (bounds && (b.left < bounds.left || b.right > bounds.right || b.top < bounds.top || b.bottom > bounds.bottom)) {
      n += 4;
    }
    return n;
  };
  items.forEach((it, k) => {
    if (!atArrow[k]) return;
    const [fx, fy, tx, ty] = arrows[k];
    const w = widthOf(k);
    const { ux, uy } = it;
    // Away from the element: the side the arrow was moved to.
    const sd = (fx - it.px) * it.nx + (fy - it.py) * it.ny >= 0 ? 1 : -1;
    const mx = it.nx * sd;
    const my = it.ny * sd;
    const reachU = Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2);
    const reachM = Math.abs(mx) * (w / 2) + Math.abs(my) * (h / 2);
    const cx = (fx + tx) / 2;
    const cy = (fy + ty) / 2;
    // Slid along the arrow: from its tail on, centred, up to its tip.
    const slide = Math.max(0, reachU - Math.hypot(tx - fx, ty - fy) / 2);
    let best: { b: Box; cost: number; ring: number } | null = null;
    for (let ring = 0; ring < 7 && !(best && best.cost === 0); ring++) {
      const d = size.gap + (ring * h) / 2;
      const centres: Pt[] = [];
      // Beside the arrow, away from the element.
      for (const s of [slide, 0, -slide]) {
        centres.push([cx + mx * (d + reachM) + ux * s, cy + my * (d + reachM) + uy * s]);
      }
      // Beyond the tip, on the arrow's side of the element; behind the tail.
      centres.push([tx + ux * (d + reachU) + mx * reachM, ty + uy * (d + reachU) + my * reachM]);
      centres.push([tx + ux * (d + reachU), ty + uy * (d + reachU)]);
      centres.push([fx - ux * (d + reachU) + mx * reachM, fy - uy * (d + reachU) + my * reachM]);
      // Across the element.
      for (const s of [slide, 0, -slide]) {
        const e = d + reachM + 2 * size.offset;
        centres.push([cx - mx * e + ux * s, cy - my * e + uy * s]);
      }
      for (const [x, y] of centres) {
        const b = boxAround(x, y, w / 2, h / 2);
        const cost = boxCost(b);
        if (!best || cost < best.cost) best = { b, cost, ring };
        if (cost === 0) break;
      }
    }
    const b = best!.b;
    fixed.push(b);
    finalBox.set(k, b);
    // Moved out from the arrow: a leader to the arrow's middle.
    if (best!.ring > 0) {
      const sx = Math.max(b.left, Math.min(b.right, cx));
      const sy = Math.max(b.top, Math.min(b.bottom, cy));
      leaders.set(k, Math.hypot(cx - sx, cy - sy) > size.gap ? [sx, sy, cx, cy] : null);
    }
  });

  const place = () => {
    done.length = 0;
    const labs: Lab[] = items.flatMap((it, k) => {
      if (atArrow[k]) return [];
      const w = widthOf(k);
      const tip: Pt = [arrows[k][2], arrows[k][3]];
      const anchor: Pt = it.head ? it.head.anchor : [tip[0] + it.ux * size.gap, tip[1] + it.uy * size.gap];
      const [ox, oy] = it.head ? it.head.out : [it.ux, it.uy];
      const alongY = Math.abs(ox) >= Math.abs(oy);
      const sign = (alongY ? ox : oy) < 0 ? -1 : 1;
      const half = alongY ? w / 2 : h / 2;
      const a = alongY ? anchor[0] : anchor[1];
      const c0 = alongY ? anchor[1] : anchor[0];
      const l: Lab = { k, w, anchor, alongY, sign, cross: 0, colCross: 0, c0, c: c0, clamped: false };
      // The label's near edge on the anchor (or a leader's run further out).
      l.cross = clampCross(l, a + sign * half);
      l.clamped = Math.abs(l.cross - (a + sign * half)) > 1e-9;
      l.colCross = clampCross(l, a + sign * (h + half));
      return [l];
    });

    // Each label alone: the nearest spot along its stacking axis clear of lines, boxes and the frame edge.
    const stepC = h / 3;
    const K = 9;
    for (const l of labs) {
      let bestD = 0;
      let bestCost = Infinity;
      search: for (let i = 0; i <= K; i++) {
        for (const sgn of i === 0 ? [1] : [-1, 1]) {
          const d = sgn * i * stepC;
          const c = labelCost(l, l.c0 + d);
          if (c < bestCost) {
            bestCost = c;
            bestD = d;
            if (c === 0) break search;
          }
        }
      }
      l.c = l.c0 + bestD;
    }

    // Labels on the same side of their heads: stacked in order, then crowds
    // moved off lines and boxes as a whole, pushing their neighbours along.
    const groups = new Map<string, Lab[]>();
    for (const l of labs) {
      const key = `${l.alongY ? "y" : "x"}${l.sign}`;
      groups.set(key, [...(groups.get(key) ?? []), l]);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.c - b.c || a.k - b.k);
      const n = group.length;
      let pos = stackPositions(
        group.map((l) => l.c),
        pitch,
      );
      const clustersOf = (p: number[]): [number, number][] => {
        const out: [number, number][] = [];
        p.forEach((c, i) => {
          if (i > 0 && c - p[i - 1] < pitch + 1e-6) out[out.length - 1][1] = i;
          else out.push([i, i]);
        });
        return out;
      };
      let costs = pos.map((c, i) => labelCost(group[i], c));
      for (let iter = 0; iter < 2 * n; iter++) {
        let improved = false;
        for (const [i0, i1] of clustersOf(pos)) {
          let here = 0;
          for (let i = i0; i <= i1; i++) here += costs[i];
          if (here === 0) continue;
          let best: { pos: number[]; costs: number[]; gain: number } | null = null;
          for (let s = 1; s <= K + n; s++) {
            for (const sgn of [-1, 1]) {
              const d = sgn * s * stepC;
              const next = pos.slice();
              for (let i = i0; i <= i1; i++) next[i] += d;
              if (d < 0) for (let i = i0 - 1; i >= 0; i--) next[i] = Math.min(pos[i], next[i + 1] - pitch);
              else for (let i = i1 + 1; i < n; i++) next[i] = Math.max(pos[i], next[i - 1] + pitch);
              const nextCosts = costs.slice();
              let gain = 0;
              for (let i = 0; i < n; i++) {
                if (next[i] === pos[i]) continue;
                nextCosts[i] = labelCost(group[i], next[i]);
                gain += costs[i] - nextCosts[i];
              }
              if (gain > 0 && (!best || gain > best.gain)) best = { pos: next, costs: nextCosts, gain };
            }
            if (best && best.gain >= here) break;
          }
          if (best) {
            pos = best.pos;
            costs = best.costs;
            improved = true;
            break;
          }
        }
        if (!improved) break;
      }
      group.forEach((l, i) => (l.c = pos[i]));
      // A cluster with a label off its line: all in one column just outside
      // the heads, each with a leader to its own head.
      for (const [i0, i1] of clustersOf(pos)) {
        const cl = group.slice(i0, i1 + 1);
        const moved = cl.some((l) => movedAt(l, l.c));
        if (moved) {
          const edge =
            cl[0].sign < 0
              ? Math.min(...cl.map((l) => (l.alongY ? l.anchor[0] : l.anchor[1]))) - h
              : Math.max(...cl.map((l) => (l.alongY ? l.anchor[0] : l.anchor[1]))) + h;
          for (const l of cl) {
            if (!l.clamped) l.cross = clampCross(l, edge + (l.sign * (l.alongY ? l.w : h)) / 2);
          }
        }
        for (const l of cl) {
          const b = boxAt(l, l.cross, l.c);
          finalBox.set(l.k, b);
          leaders.set(l.k, moved ? leaderOf(l, b) : null);
          done.push(b);
        }
      }
    }
  };
  place();
  context.placed.push(...fixed, ...done);

  // A label in a column has a leader to its element's number, which it
  // does not repeat.
  return items.map((it, k) => ({
    text: formatReinforcementForce(it.f),
    value: it.value,
    passive: it.f.passive,
    from: [arrows[k][0], arrows[k][1]],
    to: [arrows[k][2], arrows[k][3]],
    ux: it.ux,
    uy: it.uy,
    head: heads[k][0],
    headHalf: heads[k][1],
    label: finalBox.get(k)!,
    leader: leaders.get(k) ?? null,
  }));
}

/** Sizes of the force arrows and labels on the canvas; the labels are measured in the font `ctx` has. */
function canvasForceSize(ctx: CanvasRenderingContext2D, zoom: number): ForceSize {
  return {
    arrow: 28 * zoom,
    head: 5.5 * zoom,
    headHalf: 2.5 * zoom,
    offset: 5.5 * zoom,
    clear: 1.5 * zoom,
    gap: 3 * zoom,
    pad: 1 * zoom,
    textH: 10 * zoom,
    measure: (t) => ctx.measureText(t).width,
  };
}

/** The force arrows and labels as drawReinforcementForces draws them (layoutReinforcementForces at canvas sizes). */
export function canvasForceLayout(
  ctx: CanvasRenderingContext2D,
  forces: readonly ReinforcementForce[],
  toCanvas: (x: number, y: number) => [number, number],
  zoom = 1,
  context?: ForceLabelContext,
): ForceLayout[] {
  ctx.save();
  ctx.font = `bold ${10 * zoom}px sans-serif`;
  const layout = layoutReinforcementForces(forces, toCanvas, canvasForceSize(ctx, zoom), context);
  ctx.restore();
  return layout;
}

/**
 * Reinforcement forces on the critical surface: an arrow beside the
 * element in the direction of the force on the sliding mass, and its size
 * on a plate of the background colour at the element's head, with a
 * leader when it had to move (see layoutReinforcementForces; `layout`:
 * from canvasForceLayout, laid out before).
 */
export function drawReinforcementForces(
  ctx: CanvasRenderingContext2D,
  forces: readonly ReinforcementForce[],
  toCanvas: (x: number, y: number) => [number, number],
  zoom = 1,
  options: { context?: ForceLabelContext; plate?: string; layout?: readonly ForceLayout[] } = {},
): void {
  const em = 10 * zoom;
  ctx.save();
  ctx.font = `bold ${em}px sans-serif`;
  const size = canvasForceSize(ctx, zoom);
  const layout = options.layout ?? layoutReinforcementForces(forces, toCanvas, size, options.context);
  ctx.strokeStyle = REINFORCEMENT_COLOR;
  ctx.fillStyle = REINFORCEMENT_COLOR;
  ctx.lineCap = "butt";
  for (const { from, to, ux, uy, head, headHalf } of layout) {
    const [ex, ey] = to;
    const neckX = ex - ux * head;
    const neckY = ey - uy * head;
    ctx.lineWidth = 1.75 * zoom;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(neckX, neckY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(neckX - uy * headHalf, neckY + ux * headHalf);
    ctx.lineTo(neckX + uy * headHalf, neckY - ux * headHalf);
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineWidth = 0.75 * zoom;
  for (const { leader } of layout) {
    if (!leader) continue;
    ctx.beginPath();
    ctx.moveTo(leader[0], leader[1]);
    ctx.lineTo(leader[2], leader[3]);
    ctx.stroke();
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const l of layout) {
    const { label } = l;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = options.plate ?? "#ffffff";
    ctx.fillRect(label.left, label.top, label.right - label.left, label.bottom - label.top);
    ctx.globalAlpha = 1;
    ctx.fillStyle = REINFORCEMENT_COLOR;
    const cy = (label.top + label.bottom) / 2 + 0.5 * zoom;
    const p = forceLabelPieces(l, size.pad, size.measure, em);
    ctx.fillText(l.value, p.valueX, cy);
    if (p.divideX !== null && p.fosX !== null) {
      const d = divideSign(p.divideX, cy - 0.04 * em, em);
      ctx.lineWidth = d.width;
      ctx.beginPath();
      ctx.moveTo(d.bar[0], d.bar[1]);
      ctx.lineTo(d.bar[2], d.bar[3]);
      ctx.stroke();
      for (const [dx, dy] of d.dots) {
        ctx.beginPath();
        ctx.arc(dx, dy, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillText("FOS", p.fosX, cy);
    }
  }
  ctx.restore();
}

export const PILE_COLOR = "#5d4037";

/** Piles and sheet piles: a thick bar (dashed for a wall), labelled P1… at the head. */
export function drawPiles(
  ctx: CanvasRenderingContext2D,
  rows: readonly PileRow[],
  toCanvas: (x: number, y: number) => [number, number],
  zoom = 1,
): void {
  ctx.save();
  rows.forEach((p, i) => {
    const [ax, ay] = toCanvas(p.x1, p.y1);
    const [bx, by] = toCanvas(p.x2, p.y2);
    ctx.strokeStyle = PILE_COLOR;
    ctx.lineWidth = (p.type === "sheet-pile" ? 4 : 3) * zoom;
    ctx.setLineDash(p.type === "sheet-pile" ? [8 * zoom, 2 * zoom] : []);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PILE_COLOR;
    ctx.font = `bold ${11 * zoom}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`P${i + 1}`, ax, ay - 4 * zoom);
  });
  ctx.restore();
}
