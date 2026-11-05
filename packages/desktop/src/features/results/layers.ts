/**
 * The layers of the result sheet: what the result view and the PDF draw
 * over the model, in an order the user can change (Properties › Layers).
 *
 * A layer is an annotation (by its id), a placed drawing shown in results
 * ("drawing:" and its id) or one of the display layers the Results ribbon
 * turns on and off (a fixed key). Only the layers that are drawn are in
 * the list: a display layer turned off is not, a drawing not shown in
 * results is not.
 *
 * The order is the model's `resultViewSettings.layerOrder`, bottom first
 * (the drawing order). Absent: the default order below, which is the order
 * the result was always drawn in. Keys it lacks are put in place: a new
 * paper annotation on top, anything else at its default place (after the
 * nearest layer that comes before it by default). Keys of layers that are
 * not drawn now stay in it, so a display layer turned on again comes back
 * where it was.
 */
import type { AnalysisResult } from "@cslope/engine";
import type { Annotation, BackgroundImage, ResultViewSettings } from "../../store/types";
import { sortedBackgrounds } from "../../store/slices/backgroundsSlice";

/** The display layers, in their default order (bottom first). */
export const DISPLAY_LAYER_KEYS = [
  "soilColor",
  "femMesh",
  "femPlasticZone",
  "surfaces",
  "customSurfaces",
  "criticalSurface",
  "slices",
  "center",
  "fosLabel",
] as const;

export type DisplayLayerKey = (typeof DISPLAY_LAYER_KEYS)[number];

/** The prefix of a drawing's layer key. */
export const DRAWING_LAYER_PREFIX = "drawing:";

/** A drawing's layer key. */
export const drawingLayerKey = (id: string) => `${DRAWING_LAYER_PREFIX}${id}`;

export function isDisplayLayerKey(key: string): key is DisplayLayerKey {
  return (DISPLAY_LAYER_KEYS as readonly string[]).includes(key);
}

/** What the list of layers depends on (a model's view, its result and drawings). */
export interface LayerSource {
  resultViewSettings: Pick<
    ResultViewSettings,
    | "annotations"
    | "layerOrder"
    | "surfaceDisplay"
    | "showSlices"
    | "showFosLabel"
    | "showCentreMarker"
    | "showSoilColor"
    | "showFemPlasticZone"
    | "showFemMesh"
    | "showCustomSurfaces"
  >;
  result?: Pick<AnalysisResult, "fem" | "criticalSurface" | "customSurfaces"> | null;
  backgrounds?: readonly BackgroundImage[];
}

export type ResultLayer =
  | { key: string; kind: "annotation"; annotation: Annotation }
  | { key: string; kind: "drawing"; drawing: BackgroundImage }
  | { key: DisplayLayerKey; kind: "display"; layer: DisplayLayerKey };

/** Whether a display layer is drawn (turned on, and there is something to draw). */
export function displayLayerShown(key: DisplayLayerKey, src: LayerSource): boolean {
  const rvs = src.resultViewSettings;
  const result = src.result ?? null;
  switch (key) {
    case "soilColor":
      return rvs.showSoilColor !== false;
    case "femMesh":
      return !!result?.fem && rvs.showFemMesh === true;
    case "femPlasticZone":
      return !!result?.fem && rvs.showFemPlasticZone !== false;
    case "surfaces":
      return rvs.surfaceDisplay !== "critical";
    case "customSurfaces":
      return rvs.showCustomSurfaces === true && (result?.customSurfaces ?? []).some((c) => !!c.surface);
    case "criticalSurface":
      return !!result?.criticalSurface;
    case "slices":
      return rvs.showSlices;
    case "center":
      return rvs.showCentreMarker;
    case "fosLabel":
      return rvs.showFosLabel;
  }
}

/** The drawings shown in results, in their own order (lowest first). */
function resultDrawings(src: LayerSource): BackgroundImage[] {
  return sortedBackgrounds(src.backgrounds ?? []).filter((b) => b.visible && b.showInResults === true);
}

/** The layers drawn, in the default order (bottom first). */
export function defaultLayers(src: LayerSource): ResultLayer[] {
  const annotations = src.resultViewSettings.annotations;
  const display = (key: DisplayLayerKey): ResultLayer[] =>
    displayLayerShown(key, src) ? [{ key, kind: "display", layer: key }] : [];
  const annos = (reference: boolean): ResultLayer[] =>
    annotations
      .filter((a) => (a.type === "reference") === reference)
      .map((a) => ({ key: a.id, kind: "annotation", annotation: a }));
  return [
    ...display("soilColor"),
    ...resultDrawings(src).map((d): ResultLayer => ({ key: drawingLayerKey(d.id), kind: "drawing", drawing: d })),
    ...display("femMesh"),
    ...display("femPlasticZone"),
    // reference lines: in the model, under the surfaces
    ...annos(true),
    ...display("surfaces"),
    ...display("customSurfaces"),
    ...display("criticalSurface"),
    ...display("slices"),
    ...display("center"),
    ...display("fosLabel"),
    // paper annotations: on the sheet, over the drawing
    ...annos(false),
  ];
}

/**
 * The stored order `stored` (bottom first) applied to the layers drawn by
 * default (`defaults`): the stored keys of layers that are drawn, then
 * each other layer put in place (a new paper annotation on top, anything
 * else after the nearest layer before it by default).
 */
export function mergeLayerOrder(
  stored: readonly string[] | undefined,
  defaults: readonly string[],
  onTop: (key: string) => boolean,
): string[] {
  if (!stored || stored.length === 0) return [...defaults];
  const present = new Set(defaults);
  const out: string[] = [];
  const placed = new Set<string>();
  for (const key of stored) {
    if (present.has(key) && !placed.has(key)) {
      out.push(key);
      placed.add(key);
    }
  }
  defaults.forEach((key, i) => {
    if (placed.has(key)) return;
    let at = -1;
    if (!onTop(key)) {
      for (let j = i - 1; j >= 0 && at < 0; j--) {
        const p = out.indexOf(defaults[j]);
        if (p >= 0) at = p + 1;
      }
      for (let j = i + 1; j < defaults.length && at < 0; j++) {
        const p = out.indexOf(defaults[j]);
        if (p >= 0) at = p;
      }
    }
    if (at < 0) out.push(key);
    else out.splice(at, 0, key);
    placed.add(key);
  });
  return out;
}

/** The layers drawn, in the model's order (bottom first). */
export function resultLayers(src: LayerSource): ResultLayer[] {
  const defaults = defaultLayers(src);
  const stored = src.resultViewSettings.layerOrder;
  if (!stored || stored.length === 0) return defaults;
  const byKey = new Map(defaults.map((l) => [l.key, l]));
  const order = mergeLayerOrder(
    stored,
    defaults.map((l) => l.key),
    (key) => {
      const l = byKey.get(key);
      return l?.kind === "annotation" && l.annotation.type !== "reference";
    },
  );
  return order.map((k) => byKey.get(k)!);
}

/** The keys of the layers drawn, in the model's order (bottom first). */
export function resultLayerKeys(src: LayerSource): string[] {
  return resultLayers(src).map((l) => l.key);
}

/** The annotations in the order they are drawn (bottom first): the topmost is hit first. */
export function annotationsInLayerOrder(src: LayerSource): Annotation[] {
  return resultLayers(src).flatMap((l) => (l.kind === "annotation" ? [l.annotation] : []));
}

/**
 * The stored order (bottom first) with the layer `key` moved to `index`
 * of the layers drawn (bottom first, after the move). The keys of layers
 * not drawn now keep their place after the key they followed; those of
 * annotations and drawings that no longer exist are dropped.
 */
export function movedLayerOrder(src: LayerSource, key: string, index: number): string[] {
  const keys = resultLayerKeys(src);
  const from = keys.indexOf(key);
  if (from < 0) return storedLayerOrder(src, keys);
  const next = keys.filter((k) => k !== key);
  next.splice(Math.max(0, Math.min(next.length, index)), 0, key);
  return storedLayerOrder(src, next);
}

/** `visible` (the layers drawn, bottom first) with the remembered keys of the others put back. */
function storedLayerOrder(src: LayerSource, visible: readonly string[]): string[] {
  const annotationIds = new Set(src.resultViewSettings.annotations.map((a) => a.id));
  const drawingKeys = new Set((src.backgrounds ?? []).map((b) => drawingLayerKey(b.id)));
  const known = (k: string) =>
    isDisplayLayerKey(k) || annotationIds.has(k) || (k.startsWith(DRAWING_LAYER_PREFIX) ? drawingKeys.has(k) : false);
  const out = [...visible];
  let last = -1;
  for (const k of src.resultViewSettings.layerOrder ?? []) {
    const p = out.indexOf(k);
    if (p >= 0) {
      last = p;
      continue;
    }
    if (!known(k)) continue;
    out.splice(last + 1, 0, k);
    last += 1;
  }
  return out;
}

/**
 * A stored layer order as read from a file: strings only, each once, of
 * the display layers, drawings and the given annotations; absent when
 * nothing is left.
 */
export function normalizeLayerOrder(raw: unknown, annotations: readonly Annotation[]): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set(annotations.map((a) => a.id));
  const out: string[] = [];
  for (const k of raw) {
    if (typeof k !== "string" || out.includes(k)) continue;
    if (isDisplayLayerKey(k) || ids.has(k) || (k.startsWith(DRAWING_LAYER_PREFIX) && k.length > DRAWING_LAYER_PREFIX.length)) out.push(k);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * The steps of a drawing in the layer order, for the renderers: the
 * critical surface draws the slices, the center and the FOS label in
 * its own steps (between its fill, its line and its forces) when they
 * follow it directly in their default order, as they always were;
 * otherwise each is drawn on its own, where it stands.
 */
export type LayerStep =
  | { kind: "critical"; withSlices: boolean; withCenter: boolean; withFosLabel: boolean }
  | { kind: "display"; layer: Exclude<DisplayLayerKey, "criticalSurface"> }
  | { kind: "references"; annotations: Annotation[] }
  | { kind: "paper"; annotation: Annotation }
  | { kind: "drawings"; drawings: BackgroundImage[] };

const CRITICAL_COMPANIONS = ["slices", "center", "fosLabel"] as const;

/** `layers` (bottom first) as drawing steps; runs of reference lines and of drawings are one step each. */
export function layerSteps(layers: readonly ResultLayer[]): LayerStep[] {
  const steps: LayerStep[] = [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const last = steps.at(-1);
    if (l.kind === "drawing") {
      if (last?.kind === "drawings") last.drawings.push(l.drawing);
      else steps.push({ kind: "drawings", drawings: [l.drawing] });
    } else if (l.kind === "annotation") {
      if (l.annotation.type !== "reference") steps.push({ kind: "paper", annotation: l.annotation });
      else if (last?.kind === "references") last.annotations.push(l.annotation);
      else steps.push({ kind: "references", annotations: [l.annotation] });
    } else if (l.layer === "criticalSurface") {
      const fused = new Set<string>();
      let rank = -1;
      while (i + 1 < layers.length) {
        const n = layers[i + 1];
        const r = n.kind === "display" ? (CRITICAL_COMPANIONS as readonly string[]).indexOf(n.layer) : -1;
        if (r <= rank) break;
        fused.add(n.key);
        rank = r;
        i++;
      }
      steps.push({ kind: "critical", withSlices: fused.has("slices"), withCenter: fused.has("center"), withFosLabel: fused.has("fosLabel") });
    } else {
      steps.push({ kind: "display", layer: l.layer });
    }
  }
  return steps;
}

/** Whether a step draws on the paper (over the plot frame) rather than in the model. */
export const isPaperStep = (s: LayerStep) => s.kind === "paper";

/**
 * The layers drawn with the model's base drawing, under the grid and the
 * lines: the soil colours and drawings at the bottom of the order, as by
 * default. The rest are drawn over the model's lines, where they stand.
 */
export function baseLayerCount(layers: readonly ResultLayer[]): number {
  let n = 0;
  while (n < layers.length && (layers[n].kind === "drawing" || layers[n].key === "soilColor")) n++;
  return n;
}
