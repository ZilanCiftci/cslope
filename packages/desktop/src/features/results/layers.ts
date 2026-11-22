/**
 * The layers of the result sheet: what the result view and the PDF draw
 * over the model, in an order the user can change (Properties › Layers).
 *
 * A layer is an annotation (by its id), a placed drawing shown in results
 * ("drawing:" and its id) or one of the display layers (a fixed key),
 * turned on and off in Properties › Layers. The renderers take only the layers that
 * are drawn; Properties › Layers also lists the display layers turned off
 * (and the material table turned off), greyed, so they can be turned on
 * again there (`listedLayers`). A drawing not shown in results is not
 * listed.
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
import { BUILT_IN_ANNOTATION_TYPES, isBuiltInAnnotationType, type Annotation, type BackgroundImage, type BuiltInAnnotationType, type ResultViewSettings } from "../../store/types";
import { sortedBackgrounds } from "../../store/slices/backgroundsSlice";

/** The display layers, in their default order (bottom first). */
export const DISPLAY_LAYER_KEYS = [
  "soilColor",
  "femMesh",
  "femPlasticZone",
  "customSurfaces",
  "surfaces",
  "slices",
  "center",
  "fosLabel",
] as const;

/**
 * The key of the critical surface's own layer before it was one with the
 * other surfaces ("surfaces"): a stored order that names it reads as the
 * surfaces layer, in the place of the first of the two.
 */
export const LEGACY_CRITICAL_SURFACE_KEY = "criticalSurface";

export type DisplayLayerKey = (typeof DISPLAY_LAYER_KEYS)[number];

/** A display layer's name (its row in Layers; the heading of its properties). */
export const DISPLAY_LAYER_NAMES: Record<DisplayLayerKey, string> = {
  soilColor: "Soil colors",
  femMesh: "FE mesh",
  femPlasticZone: "Plastic zone",
  surfaces: "Surfaces",
  customSurfaces: "Custom surfaces",
  slices: "Slices",
  center: "Center",
  fosLabel: "F label",
};

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
    | "showSurfaces"
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
  /** Whether the model has custom search planes (their layer is listed before a run). */
  hasCustomPlanes?: boolean;
  /**
   * The built-in annotations (material table, color bar) of the model
   * turned off this session (the store's `offAnnotations`), listed greyed
   * where they stood. A built-in type with none on the sheet and none here
   * is listed as one row on top (`builtInLayerKey`).
   */
  offBuiltIns?: readonly Annotation[];
}

/**
 * A layer. `off` (listed layers only): turned off, not drawn, listed
 * greyed so it can be turned on again.
 */
export type ResultLayer =
  | { key: string; kind: "annotation"; annotation: Annotation; off?: boolean }
  | { key: string; kind: "drawing"; drawing: BackgroundImage; off?: boolean }
  | { key: DisplayLayerKey; kind: "display"; layer: DisplayLayerKey; off?: boolean };

/**
 * The key of the row of a built-in annotation (its type: "material-table",
 * "color-bar") in a model that has none, turned off: it has no place in
 * the stored order of its own.
 */
export const builtInLayerKey = (type: BuiltInAnnotationType) => type;

/** Whether a key is that of such a row. */
export const isBuiltInPlaceholderKey = (key: string) => isBuiltInAnnotationType(key);

/**
 * Whether a display layer is listed in Layers (on or off): the finite
 * element layers with a finite element result, the custom surfaces when
 * the model has custom search planes or the result has custom surfaces;
 * the others always.
 */
export function displayLayerAvailable(key: DisplayLayerKey, src: LayerSource): boolean {
  const result = src.result ?? null;
  switch (key) {
    case "femMesh":
    case "femPlasticZone":
      return !!result?.fem;
    case "customSurfaces":
      return src.hasCustomPlanes === true || (result?.customSurfaces ?? []).some((c) => !!c.surface);
    default:
      return true;
  }
}

/** Whether a display layer is turned on (its setting; drawn when there is something to draw). */
export function displayLayerOn(key: DisplayLayerKey, rvs: LayerSource["resultViewSettings"]): boolean {
  switch (key) {
    case "soilColor":
      return rvs.showSoilColor !== false;
    case "femMesh":
      return rvs.showFemMesh === true;
    case "femPlasticZone":
      return rvs.showFemPlasticZone !== false;
    case "surfaces":
      return rvs.showSurfaces !== false;
    case "customSurfaces":
      return rvs.showCustomSurfaces === true;
    case "slices":
      return rvs.showSlices;
    case "center":
      return rvs.showCentreMarker;
    case "fosLabel":
      return rvs.showFosLabel;
  }
}

/** Whether a display layer is drawn (turned on, and there is something to draw). */
export function displayLayerShown(key: DisplayLayerKey, src: LayerSource): boolean {
  if (!displayLayerOn(key, src.resultViewSettings)) return false;
  const result = src.result ?? null;
  switch (key) {
    case "femMesh":
    case "femPlasticZone":
      return !!result?.fem;
    case "customSurfaces":
      return (result?.customSurfaces ?? []).some((c) => !!c.surface);
    default:
      return true;
  }
}

/** The drawings shown in results, in their own order (lowest first). */
function resultDrawings(src: LayerSource): BackgroundImage[] {
  return sortedBackgrounds(src.backgrounds ?? []).filter((b) => b.visible && b.showInResults === true);
}

/**
 * The layers drawn, in the default order (bottom first); with `listed`,
 * also the layers turned off that Properties › Layers lists (`off`).
 */
export function defaultLayers(src: LayerSource, listed = false): ResultLayer[] {
  const annotations = src.resultViewSettings.annotations;
  const display = (key: DisplayLayerKey): ResultLayer[] => {
    if (!listed) return displayLayerShown(key, src) ? [{ key, kind: "display", layer: key }] : [];
    if (!displayLayerAvailable(key, src)) return [];
    // Listed by its setting: on (drawn once there is something to draw) or off.
    return displayLayerOn(key, src.resultViewSettings) ? [{ key, kind: "display", layer: key }] : [{ key, kind: "display", layer: key, off: true }];
  };
  // The built-in annotations turned off: those remembered, else one row of the type.
  const offBuiltIn = (): ResultLayer[] => {
    if (!listed) return [];
    return BUILT_IN_ANNOTATION_TYPES.flatMap((type): ResultLayer[] => {
      if (annotations.some((a) => a.type === type)) return [];
      const off = (src.offBuiltIns ?? []).filter((a) => a.type === type);
      const shown = off.length > 0 ? off : [{ id: builtInLayerKey(type), type, x: 0, y: 0 } as Annotation];
      return shown.map((a) => ({ key: a.id, kind: "annotation", annotation: a, off: true }));
    });
  };
  const annos = (reference: boolean): ResultLayer[] => [
    ...annotations
      .filter((a) => (a.type === "reference") === reference)
      .map((a): ResultLayer => ({ key: a.id, kind: "annotation", annotation: a })),
    ...(reference ? [] : offBuiltIn()),
  ];
  return [
    ...display("soilColor"),
    ...resultDrawings(src).map((d): ResultLayer => ({ key: drawingLayerKey(d.id), kind: "drawing", drawing: d })),
    ...display("femMesh"),
    ...display("femPlasticZone"),
    // reference lines: in the model, under the surfaces
    ...annos(true),
    ...display("customSurfaces"),
    // every surface and the critical one, with its slices, center and label after it
    ...display("surfaces"),
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

/**
 * The layers drawn, in the model's order (bottom first); with `listed`,
 * also the layers turned off that Properties › Layers lists, where they
 * stand in that order.
 */
export function resultLayers(src: LayerSource, listed = false): ResultLayer[] {
  const defaults = defaultLayers(src, listed);
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

/** The keys of the layers drawn (with `listed`: listed), in the model's order (bottom first). */
export function resultLayerKeys(src: LayerSource, listed = false): string[] {
  return resultLayers(src, listed).map((l) => l.key);
}

/** The annotations in the order they are drawn (bottom first): the topmost is hit first. */
export function annotationsInLayerOrder(src: LayerSource): Annotation[] {
  return resultLayers(src).flatMap((l) => (l.kind === "annotation" ? [l.annotation] : []));
}

/**
 * The stored order (bottom first) with the layer `key` moved to `index`
 * of the layers drawn (with `listed`: of the layers listed), bottom
 * first, after the move. The keys of layers not drawn now keep their
 * place after the key they followed; those of annotations and drawings
 * that no longer exist are dropped (a built-in annotation turned off this
 * session keeps its place).
 */
export function movedLayerOrder(src: LayerSource, key: string, index: number, listed = false): string[] {
  const keys = resultLayerKeys(src, listed).filter((k) => !isBuiltInPlaceholderKey(k));
  const from = keys.indexOf(key);
  if (from < 0) return storedLayerOrder(src, keys);
  const next = keys.filter((k) => k !== key);
  next.splice(Math.max(0, Math.min(next.length, index)), 0, key);
  return storedLayerOrder(src, next);
}

/** `visible` (the layers drawn, bottom first) with the remembered keys of the others put back. */
function storedLayerOrder(src: LayerSource, visible: readonly string[]): string[] {
  const annotationIds = new Set([...src.resultViewSettings.annotations, ...(src.offBuiltIns ?? [])].map((a) => a.id));
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
 * nothing is left. The critical surface's old key reads as the surfaces
 * layer ("surfaces" and "criticalSurface" are one layer, in the place of
 * the first of the two).
 */
export function normalizeLayerOrder(raw: unknown, annotations: readonly Annotation[]): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set(annotations.map((a) => a.id));
  const out: string[] = [];
  for (const rawKey of raw as unknown[]) {
    const k = rawKey === LEGACY_CRITICAL_SURFACE_KEY ? "surfaces" : rawKey;
    if (typeof k !== "string" || out.includes(k)) continue;
    if (isDisplayLayerKey(k) || ids.has(k) || (k.startsWith(DRAWING_LAYER_PREFIX) && k.length > DRAWING_LAYER_PREFIX.length)) out.push(k);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * The steps of a drawing in the layer order, for the renderers: the
 * surfaces layer ("critical": the other surfaces, then the critical one)
 * draws the slices, the center and the FOS label in its own steps
 * (between the critical surface's fill, its line and its forces) when
 * they follow it directly in their default order, as they always were;
 * otherwise each is drawn on its own, where it stands.
 */
export type LayerStep =
  | { kind: "critical"; withSlices: boolean; withCenter: boolean; withFosLabel: boolean }
  | { kind: "display"; layer: Exclude<DisplayLayerKey, "surfaces"> }
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
    } else if (l.layer === "surfaces") {
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
