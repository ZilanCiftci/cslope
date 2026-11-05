/**
 * DXF import: polylines and lines from an ASCII DXF drawing, turned into
 * a slope model's geometry. The DWG import (src/features/project/
 * importDwg.ts) reads the same structure (`RawDrawing`) from a DWG file and
 * shares everything after the parsing (`finishDrawing`, `dxfToGeometry`).
 *
 * - The closed polyline with the largest area is the model boundary.
 * - Polylines on a layer whose name suggests water (water, piezo, gw,
 *   grundvatten, vatten, wt) become piezometric lines.
 * - All other polylines become material boundaries.
 * LINE entities are chained end to end into polylines; arcs, splines and
 * blocks are not read (they are counted so the user can be told).
 */

import { calculatePolygonArea } from "@cslope/engine";

export type Pt = [number, number];

export interface DxfPolyline {
  layer: string;
  points: Pt[];
  closed: boolean;
}

export interface DxfSegment {
  layer: string;
  a: Pt;
  b: Pt;
}

/** A drawing as read from the file, before units and chaining. */
export interface RawDrawing {
  polylines: DxfPolyline[];
  /** LINE entities, chained into polylines by `finishDrawing`. */
  segments: DxfSegment[];
  /** Entities that were skipped (ARC, SPLINE, INSERT, …) by type. */
  skipped: Record<string, number>;
  /** $INSUNITS (0 when the file does not say). */
  insunits: number;
  /** Further notices for the user (what the reader left out or recovered). */
  notes?: string[];
}

export interface DxfDrawing {
  polylines: DxfPolyline[];
  /** Entities that were skipped (ARC, SPLINE, INSERT, …) by type. */
  skipped: Record<string, number>;
  /** Drawing units to metres ($INSUNITS), 1 when unknown. */
  unitScale: number;
  /** How the units were interpreted, for the user (if not plain metres). */
  unitNote?: string;
  /** Further notices for the user, from the reader. */
  notes?: string[];
}

const UNIT_SCALES: Record<number, number> = {
  1: 0.0254, // inches
  2: 0.3048, // feet
  4: 0.001, // millimetres
  5: 0.01, // centimetres
  6: 1, // metres
  7: 1000, // kilometres
};

/** Parse the ENTITIES of an ASCII DXF file. */
export function parseDxf(text: string): DxfDrawing {
  return finishDrawing(readDxf(text));
}

/** The polylines, lines and units of an ASCII DXF file. */
function readDxf(text: string): RawDrawing {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) {
      throw new Error("Not an ASCII DXF file (binary DXF is not supported).");
    }
    pairs.push([code, lines[i + 1].trim()]);
  }

  let insunits = 0;
  const polylines: DxfPolyline[] = [];
  const segments: DxfSegment[] = [];
  const skipped: Record<string, number> = {};

  let section = "";
  let i = 0;
  const num = (v: string) => Number.parseFloat(v);
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "SECTION") {
      section = pairs[i + 1]?.[1] ?? "";
      i += 2;
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      section = "";
      i++;
      continue;
    }
    if (section === "HEADER" && code === 9 && value === "$INSUNITS") {
      insunits = Number.parseInt(pairs[i + 1]?.[1] ?? "", 10) || 0;
      i += 2;
      continue;
    }
    if (section !== "ENTITIES" || code !== 0) {
      i++;
      continue;
    }

    // Entity: collect its group codes up to the next 0.
    const type = value;
    let j = i + 1;
    const body: [number, string][] = [];
    while (j < pairs.length && pairs[j][0] !== 0) body.push(pairs[j++]);
    const layer = body.find((p) => p[0] === 8)?.[1] ?? "0";

    if (type === "LWPOLYLINE") {
      const flags = Number.parseInt(body.find((p) => p[0] === 70)?.[1] ?? "0", 10);
      const points: Pt[] = [];
      for (let k = 0; k < body.length; k++) {
        if (body[k][0] !== 10) continue;
        // The vertex's y follows its x, before the next vertex.
        for (let m = k + 1; m < body.length && body[m][0] !== 10; m++) {
          if (body[m][0] === 20) {
            points.push([num(body[k][1]), num(body[m][1])]);
            break;
          }
        }
      }
      polylines.push({ layer, points, closed: (flags & 1) === 1 });
      i = j;
    } else if (type === "POLYLINE") {
      const flags = Number.parseInt(body.find((p) => p[0] === 70)?.[1] ?? "0", 10);
      const points: Pt[] = [];
      // VERTEX entities follow until SEQEND.
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === "SEQEND")) {
        if (pairs[j][0] === 0 && pairs[j][1] === "VERTEX") {
          let k = j + 1;
          let x = Number.NaN;
          let y = Number.NaN;
          while (k < pairs.length && pairs[k][0] !== 0) {
            if (pairs[k][0] === 10) x = num(pairs[k][1]);
            if (pairs[k][0] === 20) y = num(pairs[k][1]);
            k++;
          }
          if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
          j = k;
        } else {
          j++;
        }
      }
      polylines.push({ layer, points, closed: (flags & 1) === 1 });
      i = j + 1;
    } else if (type === "LINE") {
      const get = (c: number) => num(body.find((p) => p[0] === c)?.[1] ?? "NaN");
      const a: Pt = [get(10), get(20)];
      const b: Pt = [get(11), get(21)];
      if ([...a, ...b].every(Number.isFinite)) segments.push({ layer, a, b });
      i = j;
    } else {
      if (type !== "EOF") skipped[type] = (skipped[type] ?? 0) + 1;
      i = j;
    }
  }

  return { polylines, segments, skipped, insunits };
}

/**
 * A drawing in meters: lines chained into polylines, the units of
 * $INSUNITS applied (see below), repeated points dropped, and polylines
 * drawn back to their start closed.
 */
export function finishDrawing(raw: RawDrawing): DxfDrawing {
  const { skipped } = raw;
  let unitScale = UNIT_SCALES[raw.insunits] ?? 1;
  // Copies: the raw drawing is left as it was.
  const polylines: DxfPolyline[] = raw.polylines.map((p) => ({ ...p, points: [...p.points] }));
  polylines.push(...chainSegments(raw.segments));

  // Templates often set $INSUNITS (e.g. mm in acadiso) for drawings made
  // in metres: a slope that would come out smaller than a metre is taken
  // as drawn in metres.
  let unitNote: string | undefined;
  if (unitScale !== 1) {
    const xs = polylines.flatMap((p) => p.points.map((q) => q[0]));
    const ys = polylines.flatMap((p) => p.points.map((q) => q[1]));
    const extent = xs.length
      ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      : 0;
    if (extent * unitScale < 1 && extent >= 1) {
      unitNote = `The drawing says its units are ${unitName(unitScale)}, but the slope would then be ${(extent * unitScale).toPrecision(2)} m across; it was imported as drawn in meters.`;
      unitScale = 1;
    } else {
      unitNote = `Drawing units: ${unitName(unitScale)}, converted to meters.`;
    }
  }
  for (const p of polylines) {
    p.points = dedupe(p.points.map(([x, y]) => [x * unitScale, y * unitScale] as Pt));
    // A polyline drawn back to its start is closed.
    const n = p.points.length;
    if (n > 2 && near(p.points[0], p.points[n - 1])) {
      p.points.pop();
      p.closed = true;
    }
  }
  return {
    polylines: polylines.filter((p) => p.points.length >= 2),
    skipped,
    unitScale,
    unitNote,
    notes: raw.notes,
  };
}

function unitName(scale: number): string {
  return (
    { 0.0254: "inches", 0.3048: "feet", 0.001: "millimeters", 0.01: "centimeters", 1000: "kilometers" } as Record<number, string>
  )[scale] ?? "meters";
}

const TOL = 1e-6;
const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < TOL && Math.abs(a[1] - b[1]) < TOL;

function dedupe(points: Pt[]): Pt[] {
  return points.filter((p, i) => i === 0 || !near(p, points[i - 1]));
}

/** Chain LINE segments of a layer end to end into polylines. */
function chainSegments(segments: DxfSegment[]): DxfPolyline[] {
  const out: DxfPolyline[] = [];
  const left = [...segments];
  while (left.length > 0) {
    const first = left.shift()!;
    const pts: Pt[] = [first.a, first.b];
    let grown = true;
    while (grown) {
      grown = false;
      for (let k = 0; k < left.length; k++) {
        const s = left[k];
        if (s.layer !== first.layer) continue;
        const head = pts[0];
        const tail = pts[pts.length - 1];
        if (near(s.a, tail)) pts.push(s.b);
        else if (near(s.b, tail)) pts.push(s.a);
        else if (near(s.b, head)) pts.unshift(s.a);
        else if (near(s.a, head)) pts.unshift(s.b);
        else continue;
        left.splice(k, 1);
        grown = true;
        break;
      }
    }
    out.push({ layer: first.layer, points: pts, closed: false });
  }
  return out;
}

export interface DxfGeometry {
  coordinates: Pt[];
  materialBoundaries: Pt[][];
  waterLines: Pt[][];
}

const WATER_LAYER = /water|piezo|(^|[^a-z])gw([^a-z]|$)|grundvatten|vatten|(^|[^a-z])wt([^a-z]|$)/i;

const polygonArea = (points: Pt[]): number => calculatePolygonArea(points.map((p) => p[0]), points.map((p) => p[1]));

/** Model geometry from a parsed drawing (see the module comment). */
export function dxfToGeometry(drawing: DxfDrawing): DxfGeometry {
  const closed = drawing.polylines.filter((p) => p.closed && p.points.length >= 3);
  if (closed.length === 0) {
    throw new Error(
      "The drawing has no closed polyline for the model boundary. Draw the outline of the slope as one closed polyline.",
    );
  }
  const boundary = closed.reduce((a, b) => (polygonArea(b.points) > polygonArea(a.points) ? b : a));
  const others = drawing.polylines.filter((p) => p !== boundary);
  const waterLines = others
    .filter((p) => !p.closed && WATER_LAYER.test(p.layer))
    .map((p) => [...p.points].sort((a, b) => a[0] - b[0]));
  const materialBoundaries = others
    .filter((p) => p.closed || !WATER_LAYER.test(p.layer))
    // A closed boundary (a lens) repeats its first point at the end.
    .map((p) => (p.closed ? [...p.points, p.points[0]] : p.points));
  return { coordinates: boundary.points, materialBoundaries, waterLines };
}

// ── Line work for an underlay ───────────────────────────────────────

/** The line work of a DXF file, in drawing coordinates (src/features/drawings/vectors.ts, `NeutralVectors`). */
export interface DxfVectors {
  insunits: number;
  layers: { name: string; off: boolean }[];
  paths: { layer: string; points: Pt[]; closed: boolean }[];
  texts: { layer: string; text: string; x: number; y: number; height: number; rotation: number }[];
  skipped: Record<string, number>;
  expandedInserts: number;
  paperSpaceEntities: number;
  truncated: boolean;
}

interface DxfEntity {
  type: string;
  body: [number, string][];
  /** A POLYLINE's VERTEX entities; an INSERT's ATTRIBs. */
  children: DxfEntity[];
}

/** x' = a·x + c·y + e, y' = b·x + d·y + f */
type M2 = [number, number, number, number, number, number];
const ID2: M2 = [1, 0, 0, 1, 0, 0];
const mul2 = (o: M2, n: M2): M2 => [
  o[0] * n[0] + o[2] * n[1],
  o[1] * n[0] + o[3] * n[1],
  o[0] * n[2] + o[2] * n[3],
  o[1] * n[2] + o[3] * n[3],
  o[0] * n[4] + o[2] * n[5] + o[4],
  o[1] * n[4] + o[3] * n[5] + o[5],
];
const ap2 = (m: M2, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Points along an arc (angles in radians, counter-clockwise), about one per 5°. */
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const n = Math.min(360, Math.max(4, Math.ceil((sweep / (2 * Math.PI)) * 72)));
  return Array.from({ length: n + 1 }, (_, k): Pt => {
    const a = a0 + (sweep * k) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** The points of a polyline segment p → q with a bulge (tan of a quarter of its angle), without p. */
export function bulgePoints(p: Pt, q: Pt, b: number): Pt[] {
  const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (Math.abs(b) < 1e-12 || chord < 1e-12) return [q];
  const theta = 4 * Math.atan(b);
  const r = chord / Math.abs(2 * Math.sin(theta / 2));
  const d = Math.sqrt(Math.max(r * r - (chord * chord) / 4, 0));
  const ux = (q[0] - p[0]) / chord;
  const uy = (q[1] - p[1]) / chord;
  const side = b > 0 === Math.abs(theta) < Math.PI ? 1 : -1;
  const cx = (p[0] + q[0]) / 2 - uy * d * side;
  const cy = (p[1] + q[1]) / 2 + ux * d * side;
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  const n = Math.min(360, Math.max(2, Math.ceil((Math.abs(theta) / (2 * Math.PI)) * 72)));
  return Array.from({ length: n }, (_, k): Pt => {
    const a = a0 + (theta * (k + 1)) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

function bulgedPolyline(v: { p: Pt; b: number }[], closed: boolean): Pt[] {
  if (v.length === 0) return [];
  const pts: Pt[] = [v[0].p];
  const segs = closed ? v.length : v.length - 1;
  for (let k = 0; k < segs; k++) pts.push(...bulgePoints(v[k].p, v[(k + 1) % v.length].p, v[k].b));
  if (closed && pts.length > 1) pts.pop();
  return pts;
}

/** Points along a B-spline of `degree` with `knots` and its control points (unweighted, de Boor). */
function splinePoints(ctrl: Pt[], knots: number[], degree: number): Pt[] {
  const n = ctrl.length;
  if (n < 2 || degree < 1 || knots.length !== n + degree + 1) return ctrl;
  const t0 = knots[degree];
  const t1 = knots[n];
  if (!(t1 > t0)) return ctrl;
  const samples = Math.min(2000, Math.max(16, n * 8));
  const out: Pt[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? t1 : t0 + ((t1 - t0) * s) / samples;
    let k = degree;
    while (k < n - 1 && t >= knots[k + 1]) k++;
    const d = Array.from({ length: degree + 1 }, (_, j): Pt => [ctrl[k - degree + j][0], ctrl[k - degree + j][1]]);
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const idx = k - degree + j;
        const den = knots[idx + degree - r + 1] - knots[idx];
        const alpha = den === 0 ? 0 : (t - knots[idx]) / den;
        d[j] = [(1 - alpha) * d[j - 1][0] + alpha * d[j][0], (1 - alpha) * d[j - 1][1] + alpha * d[j][1]];
      }
    }
    out.push(d[degree]);
  }
  return out;
}

/** MTEXT's text without its formatting codes. */
export function plainMtext(s: string): string {
  return s
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;\\{}]*;/g, "")
    .replace(/\\~/g, " ")
    .replace(/\\([\\{}])/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The most points one drawing gives (a block bomb is cut short). */
const MAX_VECTOR_POINTS = 4_000_000;
const MAX_INSERT_DEPTH = 12;

/**
 * The line work of an ASCII DXF file's model space, as the DWG reader
 * gives it for an underlay: lines, polylines with their arcs (bulges),
 * arcs, circles, ellipses, splines (their fit points, else the curve of
 * their control points), solids and 3D faces as polylines; TEXT, MTEXT
 * and block attributes as texts; block references (INSERT, MINSERT
 * arrays) expanded with their insertion point, scale, rotation and
 * extrusion, nested ones too, to a depth of 12; a dimension's block
 * drawn as it is. Layers that are off or frozen are listed as such.
 * Paper space is not drawn.
 */
export function readDxfVectors(text: string): DxfVectors {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) throw new Error("Not an ASCII DXF file (binary DXF is not supported).");
    pairs.push([code, lines[i + 1].trim()]);
  }
  const readBody = (start: number): [[number, string][], number] => {
    const body: [number, string][] = [];
    let j = start;
    while (j < pairs.length && pairs[j][0] !== 0) body.push(pairs[j++]);
    return [body, j];
  };
  let insunits = 0;
  const layers: { name: string; off: boolean }[] = [];
  const blocks = new Map<string, { base: Pt; entities: DxfEntity[] }>();
  const entities: DxfEntity[] = [];
  let section = "";
  let table = "";
  let block: { name: string; base: Pt; entities: DxfEntity[] } | null = null;
  let i = 0;
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "SECTION") {
      section = pairs[i + 1]?.[1] ?? "";
      i += 2;
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      section = "";
      i++;
      continue;
    }
    if (section === "HEADER") {
      if (code === 9 && value === "$INSUNITS") insunits = Number.parseInt(pairs[i + 1]?.[1] ?? "", 10) || 0;
      i++;
      continue;
    }
    if (section === "TABLES") {
      if (code === 0 && value === "TABLE") {
        table = pairs[i + 1]?.[1] ?? "";
        i += 2;
        continue;
      }
      if (code === 0 && value === "LAYER" && table === "LAYER") {
        const [body, j] = readBody(i + 1);
        const name = body.find((p) => p[0] === 2)?.[1];
        const color = Number.parseInt(body.find((p) => p[0] === 62)?.[1] ?? "7", 10);
        const flags = Number.parseInt(body.find((p) => p[0] === 70)?.[1] ?? "0", 10);
        if (name) layers.push({ name, off: color < 0 || (flags & 1) === 1 });
        i = j;
        continue;
      }
      i++;
      continue;
    }
    if ((section !== "ENTITIES" && section !== "BLOCKS") || code !== 0) {
      i++;
      continue;
    }
    if (value === "BLOCK") {
      const [body, j] = readBody(i + 1);
      const g = (c: number) => Number.parseFloat(body.find((p) => p[0] === c)?.[1] ?? "0") || 0;
      block = { name: body.find((p) => p[0] === 2)?.[1] ?? "", base: [g(10), g(20)], entities: [] };
      i = j;
      continue;
    }
    if (value === "ENDBLK") {
      if (block) blocks.set(block.name, { base: block.base, entities: block.entities });
      block = null;
      i = readBody(i + 1)[1];
      continue;
    }
    if (value === "EOF") break;
    const [body, j] = readBody(i + 1);
    const ent: DxfEntity = { type: value, body, children: [] };
    i = j;
    const followed = value === "POLYLINE" || (value === "INSERT" && body.some((p) => p[0] === 66 && p[1] === "1"));
    if (followed) {
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "SEQEND")) {
        if (pairs[i][0] === 0) {
          const [cb, cj] = readBody(i + 1);
          ent.children.push({ type: pairs[i][1], body: cb, children: [] });
          i = cj;
        } else {
          i++;
        }
      }
      i = readBody(i + 1)[1];
    }
    (section === "BLOCKS" && block ? block.entities : entities).push(ent);
  }

  const out: DxfVectors = {
    insunits,
    layers,
    paths: [],
    texts: [],
    skipped: {},
    expandedInserts: 0,
    paperSpaceEntities: 0,
    truncated: false,
  };
  for (const [name, b] of blocks) if (/^\*paper_space/i.test(name)) out.paperSpaceEntities += b.entities.length;
  let budget = MAX_VECTOR_POINTS;

  const num = (body: [number, string][], c: number, d = 0) => {
    const v = Number.parseFloat(body.find((p) => p[0] === c)?.[1] ?? "");
    return Number.isFinite(v) ? v : d;
  };
  const all = (body: [number, string][], c: number) => body.filter((p) => p[0] === c).map((p) => Number.parseFloat(p[1]));
  const skip = (t: string) => (out.skipped[t] = (out.skipped[t] ?? 0) + 1);
  // The object coordinate system of extrusion (0, 0, −1): x mirrored.
  const ocs = (body: [number, string][]): M2 => (num(body, 230, 1) < -0.999999 ? [-1, 0, 0, 1, 0, 0] : ID2);
  const push = (m: M2, layer: string, pts: Pt[], closed: boolean) => {
    if (pts.length < 2) return;
    if (pts.length > budget) {
      out.truncated = true;
      budget = 0;
      return;
    }
    budget -= pts.length;
    out.paths.push({ layer, points: pts.map((p) => ap2(m, p)), closed });
  };
  const textOut = (m: M2, layer: string, value: string, at: Pt, height: number, rotDeg: number) => {
    const t = value.trim();
    if (!t) return;
    const [x, y] = ap2(m, at);
    out.texts.push({
      layer,
      text: t,
      x,
      y,
      height: height * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])),
      rotation: (rotDeg * Math.PI) / 180 + Math.atan2(m[1], m[0]),
    });
  };

  const emit = (e: DxfEntity, m: M2, inherit: string | null, depth: number): void => {
    if (budget <= 0) {
      out.truncated = true;
      return;
    }
    const b = e.body;
    const own = b.find((p) => p[0] === 8)?.[1] ?? "0";
    const layer = inherit !== null && (own === "0" || own === "") ? inherit : own;
    if (b.some((p) => p[0] === 60 && p[1] === "1")) return; // invisible
    const o = mul2(m, ocs(b));
    switch (e.type) {
      case "LINE":
        push(m, layer, [[num(b, 10), num(b, 20)], [num(b, 11), num(b, 21)]], false);
        return;
      case "LWPOLYLINE": {
        const closed = (num(b, 70) & 1) === 1;
        const v: { p: Pt; b: number }[] = [];
        for (const [c, s] of b) {
          if (c === 10) v.push({ p: [Number.parseFloat(s), 0], b: 0 });
          else if (c === 20 && v.length) v[v.length - 1].p[1] = Number.parseFloat(s);
          else if (c === 42 && v.length) v[v.length - 1].b = Number.parseFloat(s) || 0;
        }
        push(o, layer, bulgedPolyline(v, closed), closed);
        return;
      }
      case "POLYLINE": {
        const flags = num(b, 70);
        const closed = (flags & 1) === 1;
        const v = e.children
          .filter((c) => c.type === "VERTEX" && (num(c.body, 70) & 16) === 0)
          .map((c) => ({ p: [num(c.body, 10), num(c.body, 20)] as Pt, b: num(c.body, 42) }));
        // (3D polylines and meshes are in world coordinates: their x and y)
        push((flags & (8 | 16 | 64)) !== 0 ? m : o, layer, bulgedPolyline(v, closed), closed);
        return;
      }
      case "ARC":
        push(o, layer, arcPoints(num(b, 10), num(b, 20), num(b, 40), (num(b, 50) * Math.PI) / 180, (num(b, 51) * Math.PI) / 180), false);
        return;
      case "CIRCLE": {
        const pts = arcPoints(num(b, 10), num(b, 20), num(b, 40), 0, 2 * Math.PI);
        pts.pop();
        push(o, layer, pts, true);
        return;
      }
      case "ELLIPSE": {
        const [cx, cy, mx, my, ratio] = [num(b, 10), num(b, 20), num(b, 11), num(b, 21), num(b, 40, 1)];
        const sign = num(b, 230, 1) < 0 ? -1 : 1;
        const t0 = num(b, 41, 0);
        let t1 = num(b, 42, 2 * Math.PI);
        while (t1 <= t0) t1 += 2 * Math.PI;
        const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9;
        const n = Math.min(360, Math.max(4, Math.ceil(((t1 - t0) / (2 * Math.PI)) * 72)));
        const pts = Array.from({ length: n + 1 }, (_, k): Pt => {
          const t = t0 + ((t1 - t0) * k) / n;
          return [cx + Math.cos(t) * mx - Math.sin(t) * my * sign * ratio, cy + Math.cos(t) * my + Math.sin(t) * mx * sign * ratio];
        });
        if (full) pts.pop();
        push(m, layer, pts, full);
        return;
      }
      case "SPLINE": {
        const fx = all(b, 11);
        const fy = all(b, 21);
        const closed = (num(b, 70) & 1) === 1;
        if (fx.length >= 2 && fx.length === fy.length) {
          push(m, layer, fx.map((x, k): Pt => [x, fy[k]]), closed);
        } else {
          const cx = all(b, 10);
          const cy = all(b, 20);
          push(m, layer, splinePoints(cx.map((x, k): Pt => [x, cy[k] ?? 0]), all(b, 40), num(b, 71, 3)), closed);
        }
        return;
      }
      case "SOLID":
      case "TRACE":
      case "3DFACE": {
        const c: Pt[] = [10, 11, 12, 13].map((k): Pt => [num(b, k), num(b, k + 10)]);
        const pts = e.type === "3DFACE" ? c : [c[0], c[1], c[3], c[2]];
        const uniq = pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1][0] || p[1] !== pts[k - 1][1]);
        push(e.type === "3DFACE" ? m : o, layer, uniq, uniq.length > 2);
        return;
      }
      case "TEXT":
        textOut(o, layer, b.find((p) => p[0] === 1)?.[1] ?? "", [num(b, 10), num(b, 20)], num(b, 40), num(b, 50));
        return;
      case "ATTRIB":
        if ((num(b, 70) & 1) === 0) textOut(o, layer, b.find((p) => p[0] === 1)?.[1] ?? "", [num(b, 10), num(b, 20)], num(b, 40), num(b, 50));
        return;
      case "MTEXT": {
        const raw = b.filter((p) => p[0] === 3).map((p) => p[1]).join("") + (b.find((p) => p[0] === 1)?.[1] ?? "");
        const dir = b.some((p) => p[0] === 11) ? (Math.atan2(num(b, 21), num(b, 11)) * 180) / Math.PI : num(b, 50);
        textOut(m, layer, plainMtext(raw), [num(b, 10), num(b, 20)], num(b, 40), dir);
        return;
      }
      case "ATTDEF":
      case "SEQEND":
      case "VIEWPORT":
        return;
      case "INSERT":
      case "DIMENSION": {
        for (const c of e.children) emit(c, m, layer, depth);
        const def = blocks.get(b.find((p) => p[0] === 2)?.[1] ?? "");
        if (!def) {
          if (e.type === "INSERT") skip("INSERT");
          return;
        }
        if (depth >= MAX_INSERT_DEPTH) {
          out.truncated = true;
          skip(e.type);
          return;
        }
        // A dimension's block is drawn where it is.
        if (e.type === "DIMENSION") {
          for (const c of def.entities) emit(c, m, layer, depth + 1);
          return;
        }
        out.expandedInserts++;
        const sx = num(b, 41, 1);
        const sy = num(b, 42, 1);
        const rot = (num(b, 50) * Math.PI) / 180;
        const cols = Math.min(1000, Math.max(1, num(b, 70, 1)));
        const rows = Math.min(1000, Math.max(1, num(b, 71, 1)));
        const cs = num(b, 44);
        const rs = num(b, 45);
        const [cos, sin] = [Math.cos(rot), Math.sin(rot)];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            // insertion point · rotation · array offset · scale · (− base point), in the reference's OCS
            const local = mul2(
              [cos, sin, -sin, cos, num(b, 10), num(b, 20)],
              mul2([1, 0, 0, 1, c * cs, r * rs], [sx, 0, 0, sy, -sx * def.base[0], -sy * def.base[1]]),
            );
            const full = mul2(o, local);
            for (const child of def.entities) emit(child, full, layer, depth + 1);
          }
        }
        return;
      }
      default:
        skip(e.type);
    }
  };
  for (const e of entities) emit(e, ID2, null, 0);
  return out;
}
