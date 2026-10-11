/**
 * DXF import: polylines and lines from an ASCII DXF drawing, turned into
 * a slope model's geometry.
 *
 * - The closed polyline with the largest area is the model boundary.
 * - Polylines on a layer whose name suggests water (water, piezo, gw,
 *   grundvatten, vatten, wt) become piezometric lines.
 * - All other polylines become material boundaries.
 * LINE entities are chained end to end into polylines; arcs, splines and
 * blocks are not read (they are counted so the user can be told).
 */

export type Pt = [number, number];

export interface DxfPolyline {
  layer: string;
  points: Pt[];
  closed: boolean;
}

export interface DxfDrawing {
  polylines: DxfPolyline[];
  /** Entities that were skipped (ARC, SPLINE, INSERT, …) by type. */
  skipped: Record<string, number>;
  /** Drawing units to metres ($INSUNITS), 1 when unknown. */
  unitScale: number;
  /** How the units were interpreted, for the user (if not plain metres). */
  unitNote?: string;
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
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) {
      throw new Error("Not an ASCII DXF file (binary DXF is not supported).");
    }
    pairs.push([code, lines[i + 1].trim()]);
  }

  let unitScale = 1;
  const polylines: DxfPolyline[] = [];
  const segments: { layer: string; a: Pt; b: Pt }[] = [];
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
      const units = Number.parseInt(pairs[i + 1]?.[1] ?? "", 10);
      unitScale = UNIT_SCALES[units] ?? 1;
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

  polylines.push(...chainSegments(segments));

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
      unitNote = `The drawing says its units are ${unitName(unitScale)}, but the slope would then be ${(extent * unitScale).toPrecision(2)} m across; it was imported as drawn in metres.`;
      unitScale = 1;
    } else {
      unitNote = `Drawing units: ${unitName(unitScale)}, converted to metres.`;
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
  };
}

function unitName(scale: number): string {
  return (
    { 0.0254: "inches", 0.3048: "feet", 0.001: "millimetres", 0.01: "centimetres", 1000: "kilometres" } as Record<number, string>
  )[scale] ?? "metres";
}

const TOL = 1e-6;
const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < TOL && Math.abs(a[1] - b[1]) < TOL;

function dedupe(points: Pt[]): Pt[] {
  return points.filter((p, i) => i === 0 || !near(p, points[i - 1]));
}

/** Chain LINE segments of a layer end to end into polylines. */
function chainSegments(segments: { layer: string; a: Pt; b: Pt }[]): DxfPolyline[] {
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

function polygonArea(points: Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

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
