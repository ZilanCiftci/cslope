import type { ReinforcementForce } from "@cslope/engine";
import type { PileRow, ReinforcementRow } from "../../store/types";

export const REINFORCEMENT_COLOR = "#8e44ad";

/** Label of a reinforcement force: kN/m, "/F" when divided by the FOS. */
export function formatReinforcementForce(f: Pick<ReinforcementForce, "force" | "passive">): string {
  return `${f.force.toFixed(f.force >= 100 ? 0 : 1)} kN/m${f.passive ? " /F" : ""}`;
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

/**
 * Reinforcement forces on the critical surface: an arrow from the crossing
 * in the direction of the force on the sliding mass, labelled with its
 * size (kN/m; "/F" when it is divided by the factor of safety).
 */
export function drawReinforcementForces(
  ctx: CanvasRenderingContext2D,
  forces: readonly ReinforcementForce[],
  toCanvas: (x: number, y: number) => [number, number],
  zoom = 1,
): void {
  const ARROW = 28 * zoom;
  const HEAD = 6 * zoom;
  ctx.save();
  ctx.strokeStyle = REINFORCEMENT_COLOR;
  ctx.fillStyle = REINFORCEMENT_COLOR;
  ctx.lineWidth = 2 * zoom;
  ctx.font = `bold ${10 * zoom}px sans-serif`;
  for (const f of forces) {
    const [px, py] = toCanvas(f.x, f.y);
    const n = Math.hypot(f.fx, f.fy);
    if (!(n > 0)) continue;
    // Canvas y grows downwards.
    const ux = f.fx / n;
    const uy = -f.fy / n;
    const ex = px + ux * ARROW;
    const ey = py + uy * ARROW;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * HEAD - uy * HEAD * 0.6, ey - uy * HEAD + ux * HEAD * 0.6);
    ctx.lineTo(ex - ux * HEAD + uy * HEAD * 0.6, ey - uy * HEAD - ux * HEAD * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = ux >= 0 ? "left" : "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatReinforcementForce(f), ex + (ux >= 0 ? 4 : -4) * zoom, ey);
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
