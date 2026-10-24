/**
 * Where the water-table symbols (▽ with ≡ below) go along a water line,
 * shared by the canvas and the PDF.
 *
 * Candidate spots are taken along the line and scored: a spot is out when
 * the symbol would touch something the reader must see (the slip or a
 * prescribed surface, a vertex marker, the search-range dots and
 * markers, a load, reinforcement, another symbol) or sits on a steep
 * part; of the rest, open water above the ground with room for the ≡ is
 * best, then a shallow spot (the ≡ left out, as drawings do at a
 * shoreline), then the line in the soil, then the line on the ground
 * surface, and inside the sliding mass only when there is nowhere else. Each line gets about one symbol per
 * PIEZO_SYMBOL_SPACING_PX of its length from the best class it has, and at
 * least one.
 *
 * Everything works in drawing units (canvas px or PDF mm) with y down;
 * `unit` converts the canvas pixel sizes of the style spec to them.
 */
import { isPointInPolygon } from "@cslope/engine";
import type { AnalysisLimitsState, CustomSearchPlane } from "../../store/types";
import { surfacePoints, type DrawableSurface } from "../../utils/arc";
import { groundBetween, slipMassPolygon } from "../../utils/slip-mass";
import { surfaceYAtX } from "../view/surface";
import { boxesOverlap, type Box } from "../canvas/label-layout";
import { ARROW_HEAD_PX, ARROW_HEIGHT_PX } from "../canvas/constants";
import { polylineSegments, segmentHitsBox, type Seg } from "./overlay-layout";
import { layoutLimitMarkers, layoutRangeDots } from "./search-markers";
import {
  ENTRY_EXIT_DOT_RADIUS_PX,
  PIEZO_BAR_GAP2_PX,
  PIEZO_BAR_W_PX,
  PIEZO_TRI_HALF_PX,
  PIEZO_TRI_H_PX,
} from "./style-spec";

type Pt = [number, number];

/** A water-table symbol: tip of the ▽ at (x, y); `bars` false where the ≡ is left out. */
export interface PiezoSymbol {
  x: number;
  y: number;
  bars: boolean;
}

export interface PiezoLayoutOptions {
  /** Drawing units per canvas pixel (paper zoom on the canvas, mm per px in the PDF). */
  unit: number;
  /** External boundary of the model (world). */
  model: readonly Pt[];
  /** Critical slip surface, kept clear of symbols. */
  critical?: DrawableSurface | null;
  /** Symbols already placed (other lines); new ones are added. */
  taken?: Pt[];
  /** Boxes and lines to keep clear of. */
  avoid?: readonly Box[];
  avoidLines?: readonly Seg[];
  /** The sliding mass (drawing units): symbols inside it only as a last resort. */
  slipMass?: readonly Pt[] | null;
  /** Lines a symbol had better not cross (material boundaries). */
  softLines?: readonly Seg[];
  /** The line number is drawn above the ▽ (several lines). */
  numbered?: boolean;
}

/** Arc length between symbols, in canvas pixels. */
export const PIEZO_SYMBOL_SPACING_PX = 200;
/** Steepest segment (|dy/dx|) a symbol is put on. */
const PIEZO_MAX_SLOPE = 1;
/** Height of a line number above the ▽, canvas px. */
const NUMBER_H_PX = 14;

/** Spot classes, best first. */
const OPEN_WATER = 0;
const SHALLOW = 1;
const IN_SOIL = 2;
const AT_GROUND = 3;
const IN_MASS = 4;

/** The ground's highest world y between two x (null where there is none). */
function groundTop(model: readonly Pt[], xa: number, xb: number): number | null {
  const pts = groundBetween(model, xa, xb);
  if (pts.length === 0) return surfaceYAtX(model as Pt[], (xa + xb) / 2);
  return Math.max(...pts.map(([, y]) => y));
}

export function piezoSymbolLayout(
  line: readonly Pt[],
  toScreen: (x: number, y: number) => Pt,
  opts: PiezoLayoutOptions,
): PiezoSymbol[] {
  const u = opts.unit;
  const triH = PIEZO_TRI_H_PX * u;
  const triHalf = PIEZO_TRI_HALF_PX * u;
  const barW = PIEZO_BAR_W_PX * u;
  const barGap2 = PIEZO_BAR_GAP2_PX * u;
  const numberH = opts.numbered ? NUMBER_H_PX * u : 0;
  const crossGap = 4 * triHalf;
  const ownGap = 0.4 * PIEZO_SYMBOL_SPACING_PX * u;
  const step = 3 * u;
  const taken = opts.taken ?? [];
  const pts = line.map(([x, y]) => toScreen(x, y));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  if (pts.length < 2 || !(total > 0)) return [];
  // Drawing units per world unit along x and y (signed).
  const sx = toScreen(1, 0)[0] - toScreen(0, 0)[0];
  const sy = toScreen(0, 1)[1] - toScreen(0, 0)[1];

  const critSegs = opts.critical ? polylineSegments(surfacePoints(opts.critical).map(([x, y]) => toScreen(x, y))) : [];
  const critDots = opts.critical ? [opts.critical.entryPoint, opts.critical.exitPoint].map(([x, y]) => toScreen(x, y)) : [];
  const ground = opts.model.length >= 3 ? polylineSegments([...opts.model, opts.model[0]].map(([x, y]) => toScreen(x, y))) : [];
  const soft = [...ground, ...(opts.softLines ?? [])];
  const mass = opts.slipMass && opts.slipMass.length >= 3 ? opts.slipMass : null;
  const massX = mass?.map((p) => p[0]) ?? [];
  const massY = mass?.map((p) => p[1]) ?? [];
  const inMass = (x: number, y: number) => mass !== null && isPointInPolygon(x, y, massX, massY);

  interface Spot {
    s: number;
    x: number;
    y: number;
    blocked: boolean;
    tier: number;
    /** Lower is better (crossed lines). */
    cost: number;
    bars: boolean;
  }
  const at = (s: number): Spot => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    while (i < cum.length - 1 && cum[i] === cum[i - 1]) i++;
    const segLen = cum[i] - cum[i - 1];
    const t = segLen > 0 ? Math.max(0, Math.min(1, (s - cum[i - 1]) / segLen)) : 0;
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const x = ax + t * (bx - ax);
    const y = ay + t * (by - ay);
    const wx = line[i - 1][0] + t * (line[i][0] - line[i - 1][0]);
    const steep = Math.abs(by - ay) > PIEZO_MAX_SLOPE * Math.abs(bx - ax);

    // Where the ground is under the ▽ and under the ≡.
    const dwBar = sx !== 0 ? barW / Math.abs(sx) : 0;
    const gC = surfaceYAtX(opts.model as Pt[], wx);
    const gBars = groundTop(opts.model, wx - dwBar, wx + dwBar);
    const toY = (gy: number) => toScreen(wx, gy)[1];
    let tier: number;
    let bars = true;
    if (gC === null || gBars === null) {
      tier = IN_SOIL;
    } else {
      // Depth of free water above the ground (negative: the line is in the soil).
      const depth = sy < 0 ? toY(gC) - y : y - toY(gC);
      if (depth > u) {
        // The ≡ needs room above the ground under it.
        const room = sy < 0 ? toY(gBars) - y : y - toY(gBars);
        if (room >= barGap2 + 2 * u) tier = OPEN_WATER;
        else {
          tier = SHALLOW;
          bars = false;
        }
      } else {
        // In the soil; on the ground itself (the ▽ on the ground line) only
        // where there is no better spot, without the ≡ (it would go into it).
        tier = IN_SOIL;
        if (depth >= -u) {
          tier = AT_GROUND;
          bars = false;
        } else if (sy < 0 ? toY(gC) > y - triH : toY(gC) < y + triH) {
          // The ▽ reaches up through the ground surface.
          tier = AT_GROUND;
        }
      }
    }
    if (
      inMass(x, y - triH / 2) ||
      inMass(x - triHalf, y - triH) ||
      inMass(x + triHalf, y - triH) ||
      (bars && inMass(x, y + barGap2 / 2))
    ) {
      tier = IN_MASS;
    }

    const tri: Box = { left: x - triHalf - u, top: y - triH - numberH - u, right: x + triHalf + u, bottom: y };
    const ticks: Box = { left: x - barW - u, top: y, right: x + barW + u, bottom: y + (bars ? barGap2 + u : 0) };
    const hits = (sg: Seg) => segmentHitsBox(sg, tri) || (bars && segmentHitsBox(sg, ticks));
    // Lines the reader must see (slip and prescribed surfaces) keep a clear gap.
    const grow = (b: Box, d: number): Box => ({ left: b.left - d, top: b.top - d, right: b.right + d, bottom: b.bottom + d });
    const triFar = grow(tri, 3 * u);
    const ticksFar = grow(ticks, 3 * u);
    const near = (sg: Seg) => segmentHitsBox(sg, triFar) || (bars && segmentHitsBox(sg, ticksFar));
    const overlaps = (b: Box) => boxesOverlap(b, tri, 0) || (bars && boxesOverlap(b, ticks, 0));
    const dotR = 5 * u;
    const blocked =
      steep ||
      critSegs.some(near) ||
      (opts.avoidLines ?? []).some(near) ||
      (opts.avoid ?? []).some(overlaps) ||
      critDots.some(([dx, dy]) => dx > tri.left - dotR && dx < tri.right + dotR && dy > tri.top - dotR && dy < ticks.bottom + dotR);
    // The symbol crossing the ground or a boundary line hides a little of it.
    let cost = 0;
    for (const sg of soft) if (hits(sg)) cost += 30;
    return { s, x, y, blocked, tier, cost, bars };
  };

  const spots: Spot[] = [];
  for (let s = 0; s <= total; s += step) spots.push(at(s));
  const free = (p: Spot, own: readonly Pt[]) =>
    taken.every(([tx, ty]) => Math.hypot(tx - p.x, ty - p.y) >= crossGap) &&
    own.every(([tx, ty]) => Math.hypot(tx - p.x, ty - p.y) >= ownGap);

  const out: PiezoSymbol[] = [];
  const own: Pt[] = [];
  const add = (p: Spot) => {
    out.push({ x: p.x, y: p.y, bars: p.bars });
    own.push([p.x, p.y]);
  };
  const open = spots.filter((p) => !p.blocked && free(p, []));
  const best = Math.min(...open.map((p) => p.tier));
  const n = Math.max(1, Math.round(total / (PIEZO_SYMBOL_SPACING_PX * u)));
  const win = total / n;
  // Inside the sliding mass only the one symbol a line must have (below).
  for (let k = 0; k < n && best < IN_MASS; k++) {
    const centre = (k + 0.5) * win;
    let pick: Spot | null = null;
    let pickScore = Infinity;
    for (const p of open) {
      if (p.s < k * win || p.s > (k + 1) * win || p.tier > best || !free(p, own)) continue;
      // Crossed lines first, then nearness to the window's centre.
      const score = p.tier * 1000 + p.cost + 0.05 * Math.abs(p.s - centre) / u;
      if (score < pickScore) {
        pick = p;
        pickScore = score;
      }
    }
    if (pick) add(pick);
  }
  if (out.length === 0) {
    // At least one symbol per line: the least bad spot, else the middle.
    let pick: Spot | null = null;
    let pickScore = Infinity;
    for (const p of spots) {
      if (!free(p, [])) continue;
      const score = (p.blocked ? 1e6 : 0) + p.tier * 1000 + p.cost + 0.05 * Math.abs(p.s - total / 2) / u;
      if (score < pickScore) {
        pick = p;
        pickScore = score;
      }
    }
    add(pick ?? at(total / 2));
  }
  taken.push(...own);
  return out;
}

/** What else is drawn where the water-table symbols could go (world data). */
export interface PiezoScene {
  /** External boundary. */
  coordinates: readonly Pt[];
  /** Material boundaries: better not crossed. */
  materialBoundaries?: readonly { coordinates: readonly Pt[] }[];
  udls?: readonly { x1: number; x2: number; magnitude: number }[];
  lineLoads?: readonly { x: number; magnitude: number }[];
  /** The search limits as drawn (null or disabled: none). */
  analysisLimits?: AnalysisLimitsState | null;
  /** Prescribed surfaces drawn (the edit view). */
  prescribed?: readonly CustomSearchPlane[];
  /** Points drawn with a marker (vertices in the edit view). */
  vertices?: readonly Pt[];
  /** The tension-crack depth dimension drawn on the crest (the edit view; world). */
  crackMarker?: { x: number; top: number; bottom: number } | null;
  /** The critical surface of a result: its sliding mass and the search markers lifted over it. */
  critical?: (DrawableSurface & { crack?: unknown }) | null;
}

export interface PiezoObstacles {
  avoid: Box[];
  avoidLines: Seg[];
  softLines: Seg[];
  slipMass: Pt[] | null;
}

/**
 * The obstacles of a scene for piezoSymbolLayout, in drawing units: the
 * loads (arrows, bands and the room for their labels), the search-limit
 * markers and dotted ranges (as layoutLimitMarkers and layoutRangeDots
 * draw them), the vertex markers, the parts of the prescribed surfaces
 * inside the model, the material boundaries and the sliding mass.
 */
export function piezoObstacles(scene: PiezoScene, toD: (x: number, y: number) => Pt, unit: number): PiezoObstacles {
  const { coordinates } = scene;
  const avoid: Box[] = [];
  const avoidLines: Seg[] = [];
  const pad = 2 * unit;
  const box = (x1: number, y1: number, x2: number, y2: number): Box => ({
    left: Math.min(x1, x2) - pad,
    top: Math.min(y1, y2) - pad,
    right: Math.max(x1, x2) + pad,
    bottom: Math.max(y1, y2) + pad,
  });
  const labelRoom = 18 * unit;
  const arrowH = ARROW_HEIGHT_PX * unit;
  for (const q of scene.udls ?? []) {
    const g = groundBetween(coordinates, q.x1, q.x2).map(([x, y]) => toD(x, y));
    if (g.length < 2) continue;
    const ys = g.map((p) => p[1]);
    const xs = g.map((p) => p[0]);
    // The end arrows' heads reach past the band.
    const head = ARROW_HEAD_PX * unit;
    avoid.push(box(Math.min(...xs) - head, Math.min(...ys) - arrowH - labelRoom, Math.max(...xs) + head, Math.max(...ys)));
  }
  for (const l of scene.lineLoads ?? []) {
    const gy = surfaceYAtX(coordinates as Pt[], l.x);
    if (gy === null) continue;
    const [cx, cy] = toD(l.x, gy);
    avoid.push(box(cx - ARROW_HEAD_PX * unit, cy - arrowH - labelRoom, cx + ARROW_HEAD_PX * unit, cy));
  }
  const lim = scene.analysisLimits;
  if (lim?.enabled && coordinates.length >= 3) {
    const lifted = !!scene.critical;
    for (const m of layoutLimitMarkers(lim, coordinates, toD, unit, { lifted })) {
      avoid.push(box(m.cx, m.barTop, m.cx, m.barBottom));
      for (const t of m.triangles) avoid.push(box(Math.min(...t.map((p) => p[0])), Math.min(...t.map((p) => p[1])), Math.max(...t.map((p) => p[0])), Math.max(...t.map((p) => p[1]))));
    }
    const skip: [number, number] | null = scene.critical ? [scene.critical.entryPoint[0], scene.critical.exitPoint[0]] : null;
    const r = ENTRY_EXIT_DOT_RADIUS_PX * unit;
    for (const d of layoutRangeDots(lim, coordinates, toD, unit, { skip, radius: r })) avoid.push(box(d.x - r, d.y - r, d.x + r, d.y + r));
  }
  for (const [x, y] of scene.vertices ?? []) {
    const [cx, cy] = toD(x, y);
    avoid.push(box(cx - 6 * unit, cy - 6 * unit, cx + 6 * unit, cy + 6 * unit));
  }
  // Prescribed surfaces are drawn clipped to the model: only the part
  // through the soil is in the way.
  const mx = coordinates.map((c) => c[0]);
  const my = coordinates.map((c) => c[1]);
  for (const s of scene.prescribed ?? []) {
    let world: Pt[];
    if (s.points) world = s.points;
    else if (s.radius > 0) {
      world = Array.from({ length: 121 }, (_, k): Pt => {
        const a = (k / 120) * 2 * Math.PI;
        return [s.cx + s.radius * Math.cos(a), s.cy + s.radius * Math.sin(a)];
      });
    } else continue;
    for (let i = 1; i < world.length; i++) {
      const [x0, y0] = world[i - 1];
      const [x1, y1] = world[i];
      if (coordinates.length >= 3 && !isPointInPolygon((x0 + x1) / 2, (y0 + y1) / 2, mx, my)) continue;
      const a = toD(x0, y0);
      const b = toD(x1, y1);
      avoidLines.push([a[0], a[1], b[0], b[1]]);
    }
  }
  // The crack-depth dimension and its end ticks.
  if (scene.crackMarker) {
    const { x, top, bottom } = scene.crackMarker;
    const [cx, ct] = toD(x, top);
    const [, cb] = toD(x, bottom);
    avoid.push(box(cx - 4 * unit, Math.min(ct, cb), cx + 4 * unit, Math.max(ct, cb)));
  }
  const softLines = (scene.materialBoundaries ?? []).flatMap((b) =>
    b.coordinates.length < 2 ? [] : polylineSegments(b.coordinates.map(([x, y]) => toD(x, y))),
  );
  const slipMass =
    scene.critical && coordinates.length >= 3
      ? slipMassPolygon(coordinates, scene.critical, surfacePoints(scene.critical)).map(([x, y]) => toD(x, y))
      : null;
  return { avoid, avoidLines, softLines, slipMass };
}
