/**
 * A drawing's line work (a DWG or DXF file's model space, or the vector
 * paths of a PDF page) in source coordinates, as the canvas draws it,
 * snaps to it and picks lines of it.
 *
 * Source coordinates of a DWG or DXF drawing: u = x, v = −y in drawing
 * units (the drawing's own coordinates with y turned downwards, as every
 * source has it), so "Use the drawing's coordinates" is the transform
 * x = k·u, y = −k·v with k the metres per drawing unit ($INSUNITS). The
 * page is the extent of the line work (its corner is not at 0, 0). PDF
 * paths are in the page's points, as the page is shown.
 */
import type { Crop, Pt } from "./transform";

/** What a reader gives (packages/dwg-rs/src/vectors.rs, or dxf.ts for a DXF file): drawing coordinates, y up. */
export interface NeutralVectors {
  insunits: number;
  layers: { name: string; off: boolean }[];
  paths: { layer: string; points: Pt[]; closed: boolean }[];
  texts: { layer: string; text: string; x: number; y: number; height: number; rotation: number }[];
  skipped?: Record<string, number>;
  expandedInserts?: number;
  paperSpaceEntities?: number;
  truncated?: boolean;
  warnings?: string[];
  /** The file's version (DWG), for the notes. */
  version?: string;
}

/** A polyline of the drawing: its layer (an index of `layers`) and its points (u0, v0, u1, v1, …). */
export interface VectorPath {
  layer: number;
  pts: Float64Array;
  closed: boolean;
}

/** A text: where it starts, its height (source units) and its angle (radians, clockwise on the page). */
export interface VectorText {
  layer: number;
  text: string;
  u: number;
  v: number;
  height: number;
  rotation: number;
}

export interface VectorDrawing {
  layers: string[];
  /** Layers that are off or frozen in the file (shown hidden at first). */
  layersOff: string[];
  paths: VectorPath[];
  texts: VectorText[];
  /** The extent of the line work and the texts (source units). */
  extent: Crop;
  /** Metres per source unit from the file's units, null when it does not say. */
  metersPerUnit: number | null;
  /** The source unit's name ("millimeter", "point", "drawing unit"). */
  unitName: string;
  segmentCount: number;
  /** What the reader left out or recovered, for the user. */
  notes: string[];
}

/** $INSUNITS: metres per unit and the unit's name. */
export const INSUNITS: Record<number, { meters: number; name: string }> = {
  1: { meters: 0.0254, name: "inch" },
  2: { meters: 0.3048, name: "foot" },
  4: { meters: 0.001, name: "millimeter" },
  5: { meters: 0.01, name: "centimeter" },
  6: { meters: 1, name: "meter" },
  7: { meters: 1000, name: "kilometer" },
  10: { meters: 0.9144, name: "yard" },
  14: { meters: 0.1, name: "decimeter" },
};

/** The units the window offers for a drawing whose file does not say ($INSUNITS 0). */
export const DRAWING_UNIT_CHOICES: { insunits: number; label: string }[] = [
  { insunits: 4, label: "mm" },
  { insunits: 5, label: "cm" },
  { insunits: 6, label: "m" },
  { insunits: 7, label: "km" },
  { insunits: 1, label: "in" },
  { insunits: 2, label: "ft" },
];

const EMPTY: Crop = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** The extent of paths and texts, with a margin of 2 % (an empty drawing: a unit square). */
export function extentOf(paths: readonly VectorPath[], texts: readonly VectorText[]): Crop {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of paths) {
    const a = p.pts;
    for (let i = 0; i < a.length; i += 2) {
      if (a[i] < x0) x0 = a[i];
      if (a[i] > x1) x1 = a[i];
      if (a[i + 1] < y0) y0 = a[i + 1];
      if (a[i + 1] > y1) y1 = a[i + 1];
    }
  }
  for (const t of texts) {
    x0 = Math.min(x0, t.u);
    x1 = Math.max(x1, t.u + t.height * Math.max(1, t.text.length) * 0.6);
    y0 = Math.min(y0, t.v - t.height);
    y1 = Math.max(y1, t.v);
  }
  if (!Number.isFinite(x0)) return { ...EMPTY };
  const m = Math.max(x1 - x0, y1 - y0, 1e-9) * 0.02;
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

/** The line work of a DWG or DXF file in source coordinates (y turned downwards). */
export function fromDrawingCoordinates(n: NeutralVectors, kind: "DWG" | "DXF"): VectorDrawing {
  const layerIndex = new Map<string, number>();
  const layers: string[] = [];
  const layerOf = (name: string) => {
    let i = layerIndex.get(name);
    if (i === undefined) {
      i = layers.length;
      layers.push(name);
      layerIndex.set(name, i);
    }
    return i;
  };
  for (const l of n.layers) layerOf(l.name);
  const paths: VectorPath[] = [];
  let segmentCount = 0;
  for (const p of n.paths) {
    const pts = new Float64Array(p.points.length * 2);
    let k = 0;
    for (const [x, y] of p.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts[k++] = x;
      pts[k++] = -y;
    }
    if (k < 4) continue;
    const used = k === pts.length ? pts : pts.slice(0, k);
    paths.push({ layer: layerOf(p.layer), pts: used, closed: p.closed });
    segmentCount += used.length / 2 - 1 + (p.closed ? 1 : 0);
  }
  const texts: VectorText[] = n.texts
    .filter((t) => [t.x, t.y, t.height, t.rotation].every(Number.isFinite) && t.text.trim())
    .map((t) => ({ layer: layerOf(t.layer), text: t.text.trim(), u: t.x, v: -t.y, height: Math.max(t.height, 0), rotation: -t.rotation }));
  const unit = INSUNITS[n.insunits];
  const notes: string[] = [];
  if (n.paperSpaceEntities) {
    notes.push(`The layouts (paper space, ${n.paperSpaceEntities} entities) are not shown: only the model space is.`);
  }
  const skipped = Object.entries(n.skipped ?? {}).filter(([t]) => t !== "VIEWPORT");
  if (skipped.length > 0) notes.push(`Not shown: ${skipped.map(([t, c]) => `${c} ${t}`).join(", ")}.`);
  if (n.truncated) notes.push(`The ${kind} drawing is very large and was cut short.`);
  for (const w of n.warnings ?? []) notes.push(w);
  return {
    layers,
    layersOff: n.layers.filter((l) => l.off).map((l) => l.name),
    paths,
    texts,
    extent: extentOf(paths, texts),
    metersPerUnit: unit?.meters ?? null,
    unitName: unit?.name ?? "drawing unit",
    segmentCount,
    notes,
  };
}

/** The transform of "Use the drawing's coordinates": model = k · (u, −v). */
export function drawingCoordinatesTransform(metersPerUnit: number) {
  return { a: metersPerUnit, b: 0, c: 0, d: -metersPerUnit, e: 0, f: 0 };
}

/** The path's i-th point. */
export function pathPoint(p: VectorPath, i: number): Pt {
  return [p.pts[2 * i], p.pts[2 * i + 1]];
}

/** The number of points of a path. */
export function pathLength(p: VectorPath): number {
  return p.pts.length / 2;
}

/** The layer indices hidden by a placement's `hiddenLayers` (names). */
export function hiddenLayerSet(drawing: VectorDrawing, hidden: readonly string[] | undefined): Set<number> {
  const out = new Set<number>();
  if (!hidden || hidden.length === 0) return out;
  const names = new Set(hidden);
  drawing.layers.forEach((name, i) => {
    if (names.has(name)) out.add(i);
  });
  return out;
}
