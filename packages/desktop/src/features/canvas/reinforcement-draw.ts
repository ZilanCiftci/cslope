import type { ReinforcementForce } from "@cslope/engine";
import type { PileRow, ReinforcementRow } from "../../store/types";
import { placeLabel, pointSegmentDistance, polylineSegments, type Seg } from "../rendering/overlay-layout";
import { boxAround, type Box } from "./label-layout";

export const REINFORCEMENT_COLOR = "#8e44ad";

/**
 * Label of a reinforcement force in kN/m. A passive force is an ultimate
 * capacity that the analysis divides by the factor of safety: "÷ FOS".
 */
export function formatReinforcementForce(f: Pick<ReinforcementForce, "force" | "passive">): string {
  // Decimals from the rounded value: 99.96 is "100", not "100.0".
  const oneDecimal = f.force.toFixed(1);
  const text = Number(oneDecimal) >= 100 ? f.force.toFixed(0) : oneDecimal;
  return `${text} kN/m${f.passive ? " ÷ FOS" : ""}`;
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
 * Draw reinforcement elements: the bar, a plate at the head (end 1), the
 * bonded part as a wider translucent band and, without pullout, anchor
 * blocks at both ends; numbered at the head.
 */
export function drawReinforcements(
  ctx: CanvasRenderingContext2D,
  rows: readonly ReinforcementRow[],
  toCanvas: (x: number, y: number) => [number, number],
  zoom = 1,
): void {
  ctx.save();
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
    ctx.fillText(String(i + 1), ax - ux * 10 * zoom, ay - uy * 10 * zoom);
  });
  ctx.restore();
}

/** What force labels must keep clear of, in drawing units. */
export interface ForceLabelContext {
  /** Lines labels should not cross: elements, piles, the slip surface. */
  obstacles: Seg[];
  /** Boxes already taken (element numbers, pile names); placed labels are added. */
  placed: Box[];
}

/**
 * Obstacles for the force labels: the reinforcement and pile lines, the
 * critical slip surface, and the element numbers and pile names as boxes
 * (`numberSize`: their size and distance from the head, in drawing units).
 */
export function forceLabelContext(
  toScreen: (x: number, y: number) => [number, number],
  opts: {
    reinforcements?: readonly ReinforcementRow[];
    piles?: readonly PileRow[];
    surface?: readonly [number, number][];
    numberSize: number;
  },
): ForceLabelContext {
  const obstacles: Seg[] = [];
  const placed: Box[] = [];
  const s = opts.numberSize;
  for (const r of opts.reinforcements ?? []) {
    const [ax, ay] = toScreen(r.x1, r.y1);
    const [bx, by] = toScreen(r.x2, r.y2);
    obstacles.push([ax, ay, bx, by]);
    placed.push(boxAround(ax, ay, s / 2)); // head plate
    const len = Math.hypot(bx - ax, by - ay);
    if (len > 0) {
      const cx = ax - ((bx - ax) / len) * s;
      const cy = ay - ((by - ay) / len) * s;
      placed.push(boxAround(cx, cy, s / 2));
    }
  }
  for (const p of opts.piles ?? []) {
    const [ax, ay] = toScreen(p.x1, p.y1);
    const [bx, by] = toScreen(p.x2, p.y2);
    obstacles.push([ax, ay, bx, by]);
    placed.push({ left: ax - s, top: ay - s * 1.4, right: ax + s, bottom: ay - s * 0.4 });
  }
  if (opts.surface) obstacles.push(...polylineSegments(opts.surface.map(([x, y]) => toScreen(x, y))));
  return { obstacles, placed };
}

/** A force as drawn: its arrow and its label box (null when no room was found). */
export interface ForceLayout {
  text: string;
  /** Arrow start and tip, and its unit direction. */
  from: [number, number];
  to: [number, number];
  ux: number;
  uy: number;
  label: Box | null;
}

/**
 * Lays out the force arrows and labels. Each arrow starts at the crossing
 * with the slip surface, in the direction of the force, moved `offset`
 * sideways so the element or slip line it lies along stays visible. Its
 * label sits beside the arrow, clear of the elements, the slip line, the
 * other arrows and the labels placed before it: greedy over a few
 * candidate positions, left out when none is free. Forces that round to
 * 0.0 kN/m are not drawn.
 */
export function layoutReinforcementForces(
  forces: readonly ReinforcementForce[],
  toScreen: (x: number, y: number) => [number, number],
  size: { arrow: number; offset: number; gap: number; pad: number; textH: number; measure: (text: string) => number },
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
    return [{ px, py, ux, uy, nx, ny, text: formatReinforcementForce(f) }];
  });
  const arrows: Seg[] = items.map((it) => [it.px, it.py, it.px + it.ux * size.arrow, it.py + it.uy * size.arrow]);
  const obstacles = [...context.obstacles, ...arrows];
  return items.map((it, k) => {
    const w = size.measure(it.text) + 2 * size.pad;
    const h = size.textH + 2 * size.pad;
    const boxAt = (cx: number, cy: number): Box => boxAround(cx, cy, w / 2, h / 2);
    const candidates: Box[] = [];
    const sideOf: number[] = [];
    const beside = (side: number, along: number, extra: number) => {
      const nx = it.nx * side;
      const ny = it.ny * side;
      // Half the box's extent across the arrow, so its edge clears the arrow.
      const d = size.offset + size.gap + (Math.abs(nx) * w) / 2 + (Math.abs(ny) * h) / 2 + extra;
      candidates.push(boxAt(it.px + it.ux * size.arrow * along + nx * d, it.py + it.uy * size.arrow * along + ny * d));
      sideOf.push(side);
    };
    for (const side of [1, -1]) for (const along of [0.5, 1, 1.5, 0, 2]) beside(side, along, 0);
    for (const side of [1, -1]) beside(side, 0.5, h / 2);
    // Last resort: beyond the tip, along the arrow.
    const beyond = size.arrow + size.gap + (Math.abs(it.ux) * w) / 2 + (Math.abs(it.uy) * h) / 2;
    candidates.push(boxAt(it.px + it.ux * beyond, it.py + it.uy * beyond));
    sideOf.push(1);
    // A label must sit nearer its own arrow than any other, so it is not
    // read as another's (arrows as drawn: this one on the candidate's side,
    // the others on their first side).
    const shifted = (a: Seg, nx: number, ny: number): Seg => [
      a[0] + nx * size.offset,
      a[1] + ny * size.offset,
      a[2] + nx * size.offset,
      a[3] + ny * size.offset,
    ];
    const drawnArrows = arrows.map((a, j) => shifted(a, items[j].nx, items[j].ny));
    const ownArrow = (b: Box) => {
      const cx = (b.left + b.right) / 2;
      const cy = (b.top + b.bottom) / 2;
      const side = sideOf[candidates.indexOf(b)];
      const own = pointSegmentDistance(cx, cy, shifted(arrows[k], it.nx * side, it.ny * side));
      const same = (a: Seg) => a.every((v, i) => Math.abs(v - arrows[k][i]) < 1e-6);
      return arrows.every((a, j) => j === k || same(a) || pointSegmentDistance(cx, cy, drawnArrows[j]) > own);
    };
    const label = placeLabel(candidates, context.placed, obstacles, 0, ownArrow);
    const side = label ? sideOf[candidates.indexOf(label)] : 1;
    const ox = it.nx * side * size.offset;
    const oy = it.ny * side * size.offset;
    return {
      text: it.text,
      from: [it.px + ox, it.py + oy],
      to: [it.px + ox + it.ux * size.arrow, it.py + oy + it.uy * size.arrow],
      ux: it.ux,
      uy: it.uy,
      label,
    };
  });
}

/**
 * Reinforcement forces on the critical surface: an arrow from the crossing
 * in the direction of the force on the sliding mass, labelled with its
 * size on a plate of the background colour (see layoutReinforcementForces).
 */
export function drawReinforcementForces(
  ctx: CanvasRenderingContext2D,
  forces: readonly ReinforcementForce[],
  toCanvas: (x: number, y: number) => [number, number],
  zoom = 1,
  options: { context?: ForceLabelContext; plate?: string } = {},
): void {
  const HEAD = 6 * zoom;
  ctx.save();
  ctx.font = `bold ${10 * zoom}px sans-serif`;
  const layout = layoutReinforcementForces(
    forces,
    toCanvas,
    {
      arrow: 28 * zoom,
      offset: 4 * zoom,
      gap: 3 * zoom,
      pad: 2 * zoom,
      textH: 10 * zoom,
      measure: (t) => ctx.measureText(t).width,
    },
    options.context,
  );
  ctx.strokeStyle = REINFORCEMENT_COLOR;
  ctx.fillStyle = REINFORCEMENT_COLOR;
  ctx.lineWidth = 2 * zoom;
  for (const { from, to, ux, uy } of layout) {
    const [ex, ey] = to;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * HEAD - uy * HEAD * 0.6, ey - uy * HEAD + ux * HEAD * 0.6);
    ctx.lineTo(ex - ux * HEAD + uy * HEAD * 0.6, ey - uy * HEAD - ux * HEAD * 0.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { label, text } of layout) {
    if (!label) continue;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = options.plate ?? "#ffffff";
    ctx.fillRect(label.left, label.top, label.right - label.left, label.bottom - label.top);
    ctx.globalAlpha = 1;
    ctx.fillStyle = REINFORCEMENT_COLOR;
    ctx.fillText(text, (label.left + label.right) / 2, (label.top + label.bottom) / 2 + 0.5 * zoom);
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
