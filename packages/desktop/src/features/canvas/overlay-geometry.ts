/**
 * Where the canvas draws loads and water-table symbols: one computation
 * shared by the drawing and by the edit-view label layout (which keeps
 * vertex labels clear of them), so the two cannot drift apart.
 */
import type { AppState } from "../../store/types";
import type { DrawableSurface } from "../../utils/arc";
import { ARROW_HEAD_LEN_PX, ARROW_HEAD_PX, ARROW_HEIGHT_PX } from "./constants";
import { boxAround, type Box } from "./label-layout";
import { forceLabelContext } from "./reinforcement-draw";
import type { PointHit } from "./types";
import {
  arrowEdges,
  formatMagnitude,
  formatRange,
  groupTouchingStrips,
  loadHeightFraction,
  piezoSymbolLayout,
  placeLabel,
  type PiezoSymbol,
} from "../rendering/overlay-layout";
import {
  PIEZO_BAR_GAP2_PX,
  PIEZO_BAR_W_PX,
  PIEZO_TRI_H_PX,
} from "../rendering/style-spec";

type Pt = [number, number];

/** The view: canvas size, world → canvas transform and the ground surface. */
export interface CanvasView {
  w: number;
  h: number;
  coordinates: AppState["coordinates"];
  worldToCanvas: (wx: number, wy: number, w: number, h: number) => Pt;
  surfaceYAtX: (x: number) => number | null;
}

/** A downward load arrow: tip on the ground at (cx, cy), shaft up to `top`. */
export interface LoadArrow {
  cx: number;
  cy: number;
  top: number;
  hover: boolean;
}

export interface UdlGroupGeometry {
  /** Each strip's ground line and top edge, left to right (canvas). */
  strips: { ground: Pt[]; top: Pt[] }[];
  arrows: LoadArrow[];
}

export interface LoadLabelGeometry {
  text: string;
  kind: "udl" | "lineLoad";
  hover: boolean;
  /** Centre x and the box the text fills (baseline at its bottom). */
  cx: number;
  box: Box;
}

export interface LoadLayout {
  udlGroups: UdlGroupGeometry[];
  lineLoads: LoadArrow[];
  labels: LoadLabelGeometry[];
}

export const LOAD_LABEL_FONT_PX = 13;
const LOAD_LABEL_LINE_PX = 15;

/**
 * UDLs and line loads as drawn. UDL strips that touch end to end (a ramp
 * entered as many strips) are one load: an outline around the whole,
 * arrows at its ends and at a readable spacing, one label ("q = 20–40
 * kPa" when the strips differ). Heights follow the magnitude relative to
 * the largest load of the kind (at least 40 %), so overlapping surcharges
 * stay apart. A label that would overlap one placed before moves up, at
 * most three lines, else is left out. `zoom` scales the pixel sizes.
 */
export function layoutLoads(
  ctx: CanvasRenderingContext2D,
  view: CanvasView,
  udls: AppState["udls"],
  lineLoads: AppState["lineLoads"],
  hoverHit: PointHit | null,
  zoom = 1,
): LoadLayout {
  const out: LoadLayout = { udlGroups: [], lineLoads: [], labels: [] };
  const { w, h, coordinates, surfaceYAtX } = view;
  if (coordinates.length < 3) return out;
  const toC = (x: number, y: number) => view.worldToCanvas(x, y, w, h);
  const placed: Box[] = [];
  ctx.save();
  ctx.font = `bold ${LOAD_LABEL_FONT_PX * zoom}px sans-serif`;
  const label = (text: string, kind: LoadLabelGeometry["kind"], hover: boolean, cx: number, bottom: number) => {
    const tw = ctx.measureText(text).width;
    const lh = LOAD_LABEL_LINE_PX * zoom;
    const candidates: Box[] = [0, 1, 2, 3].map((k) => ({
      left: cx - tw / 2,
      top: bottom - lh * (k + 1),
      right: cx + tw / 2,
      bottom: bottom - lh * k,
    }));
    const box = placeLabel(candidates, placed, [], 2 * zoom);
    if (box) out.labels.push({ text, kind, hover, cx, box });
  };

  const onModel = udls.filter((u) => surfaceYAtX(u.x1) !== null && surfaceYAtX(u.x2) !== null);
  const qMaxAll = Math.max(0, ...onModel.map((u) => Math.abs(u.magnitude)));
  const ground = (lo: number, hi: number): Pt[] =>
    [lo, ...coordinates.map(([cx]) => cx).filter((cx) => cx > lo && cx < hi), hi]
      .sort((a, b) => a - b)
      .map((x) => toC(x, surfaceYAtX(x)!));
  for (const g of groupTouchingStrips(onModel)) {
    const strips = g.strips.map((u) => {
      const lo = Math.min(u.x1, u.x2);
      const hi = Math.max(u.x1, u.x2);
      const gr = ground(lo, hi);
      const lift = ARROW_HEIGHT_PX * zoom * loadHeightFraction(u.magnitude, qMaxAll);
      return { u, lo, hi, lift, ground: gr, top: gr.map(([sx, sy]) => [sx, sy - lift] as Pt) };
    });
    const edges = [strips[0].lo, ...strips.map((s) => s.hi)];
    const edgeLift = (i: number) => Math.max(i > 0 ? strips[i - 1].lift : 0, i < strips.length ? strips[i].lift : 0);
    const edgeC = edges.map((x) => toC(x, surfaceYAtX(x)!));
    // A hovered handle is drawn wherever it is, also between arrows.
    const hovered = hoverHit?.kind === "udl" ? strips.find((s) => s.u.id === hoverHit.udlId) : undefined;
    const hoverX = hovered && hoverHit?.kind === "udl" ? (hoverHit.handle === "x1" ? hovered.u.x1 : hovered.u.x2) : null;
    const tol = 1e-6 * Math.max(1, Math.abs(g.lo), Math.abs(g.hi));
    const hoverEdge = hoverX === null ? -1 : edges.findIndex((x) => Math.abs(x - hoverX) <= tol);
    const arrowAt = (i: number, hover: boolean): LoadArrow => ({ cx: edgeC[i][0], cy: edgeC[i][1], top: edgeC[i][1] - edgeLift(i), hover });
    const arrows = arrowEdges(edgeC.map(([x]) => x), 60 * zoom)
      .filter((i) => i !== hoverEdge)
      .map((i) => arrowAt(i, false));
    if (hoverEdge >= 0) arrows.push(arrowAt(hoverEdge, true));
    out.udlGroups.push({ strips: strips.map((s) => ({ ground: s.ground, top: s.top })), arrows });
    const topMost = Math.min(...strips.flatMap((s) => s.top.map(([, y]) => y)));
    label(
      formatRange(g.qMin, g.qMax, "q", "kPa"),
      "udl",
      false,
      (edgeC[0][0] + edgeC[edgeC.length - 1][0]) / 2,
      topMost - 8 * zoom,
    );
  }

  const pMaxAll = Math.max(0, ...lineLoads.map((ll) => Math.abs(ll.magnitude)));
  for (const ll of lineLoads) {
    const sy = surfaceYAtX(ll.x);
    if (sy === null) continue;
    const [cx, cy] = toC(ll.x, sy);
    const top = cy - ARROW_HEIGHT_PX * zoom * loadHeightFraction(ll.magnitude, pMaxAll);
    const hover = hoverHit?.kind === "lineLoad" && hoverHit.loadId === ll.id;
    out.lineLoads.push({ cx, cy, top, hover });
    label(`P = ${formatMagnitude(ll.magnitude)} kN/m`, "lineLoad", hover, cx, top - 4 * zoom);
  }
  ctx.restore();
  return out;
}

/** Boxes covering a load arrow: its shaft and its head. */
export function loadArrowBoxes(a: LoadArrow, zoom = 1): Box[] {
  return [
    { left: a.cx - 1.5 * zoom, top: a.top, right: a.cx + 1.5 * zoom, bottom: a.cy },
    {
      left: a.cx - ARROW_HEAD_PX * zoom,
      top: a.cy - ARROW_HEAD_LEN_PX * zoom,
      right: a.cx + ARROW_HEAD_PX * zoom,
      bottom: a.cy,
    },
  ];
}

/**
 * Water-table symbols of each line (see piezoSymbolLayout): spaced along
 * the line, clear of the critical surface (when given), of the elements
 * and their numbers, and of each other.
 */
export function layoutPiezoSymbols(
  view: CanvasView,
  piezometricLine: AppState["piezometricLine"],
  reinforcements: AppState["reinforcements"] | undefined,
  piles: AppState["piles"] | undefined,
  zoom = 1,
  critical: DrawableSurface | null = null,
): PiezoSymbol[][] {
  const toC = (x: number, y: number) => view.worldToCanvas(x, y, view.w, view.h);
  const avoid = forceLabelContext(toC, { reinforcements, piles, numberSize: 11 * zoom });
  const taken: Pt[] = [];
  return piezometricLine.lines.map((line) =>
    line.coordinates.length < 2
      ? []
      : piezoSymbolLayout(line.coordinates, toC, {
          unit: zoom,
          model: view.coordinates,
          critical,
          taken,
          avoid: avoid.placed,
          avoidLines: avoid.obstacles,
        }),
  );
}

/** Box covering a water-table symbol (and its line number when `numbered`). */
export function piezoSymbolBox(s: PiezoSymbol, zoom = 1, numbered = false): Box {
  const b = boxAround(s.x, s.y, PIEZO_BAR_W_PX * zoom, 0);
  return {
    ...b,
    top: s.y - (PIEZO_TRI_H_PX + (numbered ? 14 : 0)) * zoom,
    bottom: s.y + (s.bars ? PIEZO_BAR_GAP2_PX + 1 : 0) * zoom,
  };
}
