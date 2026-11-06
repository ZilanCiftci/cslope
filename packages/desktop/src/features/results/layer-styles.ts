/**
 * The styles of the result sheet's display layers (`layerStyles` of the
 * result view settings): what a file may hold, how a change is made, and
 * the small helpers both renderers (the canvas and the PDF) use, so the
 * screen and the print agree. Every field is an override: absent, the
 * layer is drawn as always (features/rendering/style-spec.ts).
 */
import type { ResultLayerStyles, ResultViewSettings } from "../../store/types";
import { FOS_LABEL_DECIMALS, FOS_LABEL_FONT_PX } from "../rendering/style-spec";

/** The fonts of the FOS label: the ones text annotations offer. */
export const LAYER_FONT_FAMILIES = [
  { label: "Sans-serif", value: "sans-serif" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "monospace" },
] as const;

type FieldKind = "color" | "width" | "opacity" | "fontSize" | "fontFamily" | "bool" | "decimals" | "size";

/** The fields of each layer's style and what each holds. */
const FIELDS: { [K in keyof ResultLayerStyles]-?: Record<string, FieldKind> } = {
  soilColor: { opacity: "opacity" },
  femMesh: { color: "color", width: "width", opacity: "opacity" },
  femPlasticZone: { color: "color", opacity: "opacity" },
  surfaces: { width: "width", opacity: "opacity" },
  customSurfaces: { color: "color", width: "width", fontSize: "fontSize" },
  criticalSurface: { color: "color", width: "width" },
  slices: { color: "color", width: "width" },
  center: { color: "color", size: "size", radiusLines: "bool" },
  fosLabel: { fontSize: "fontSize", fontFamily: "fontFamily", color: "color", bold: "bool", decimals: "decimals" },
};

/** The bounds of the numbers (line widths and sizes in px at paper zoom 1). */
export const LAYER_STYLE_LIMITS = {
  width: { min: 0.1, max: 10 },
  size: { min: 0.5, max: 20 },
  fontSize: { min: 4, max: 72 },
  decimals: { min: 0, max: 4 },
} as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A field's value if it is a valid one of its kind, else undefined. */
function validField(kind: FieldKind, v: unknown): unknown {
  switch (kind) {
    case "color":
      return typeof v === "string" && HEX_COLOR.test(v) ? v.toLowerCase() : undefined;
    case "bool":
      return typeof v === "boolean" ? v : undefined;
    case "fontFamily":
      return LAYER_FONT_FAMILIES.some((f) => f.value === v) ? v : undefined;
    case "opacity":
      return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
    case "decimals":
      return Number.isInteger(v) && (v as number) >= LAYER_STYLE_LIMITS.decimals.min && (v as number) <= LAYER_STYLE_LIMITS.decimals.max
        ? v
        : undefined;
    default: {
      const { min, max } = LAYER_STYLE_LIMITS[kind];
      return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
    }
  }
}

/**
 * The layers' styles as read from a file or a template: the known layers
 * and fields with valid values only (the rest dropped, no error); absent
 * when nothing is left.
 */
export function normalizeLayerStyles(raw: unknown): ResultLayerStyles | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [layer, fields] of Object.entries(FIELDS)) {
    const style = (raw as Record<string, unknown>)[layer];
    if (!style || typeof style !== "object" || Array.isArray(style)) continue;
    const clean: Record<string, unknown> = {};
    for (const [field, kind] of Object.entries(fields)) {
      const v = validField(kind, (style as Record<string, unknown>)[field]);
      if (v !== undefined) clean[field] = v;
    }
    if (Object.keys(clean).length > 0) out[layer] = clean;
  }
  return Object.keys(out).length > 0 ? (out as ResultLayerStyles) : undefined;
}

/**
 * The settings patch that changes `layer`'s style by `patch` (a field set
 * to undefined goes back to the default); a layer with no field left, and
 * styles with no layer left, are removed. One store change: one undo step.
 */
export function layerStylePatch<K extends keyof ResultLayerStyles>(
  rvs: Pick<ResultViewSettings, "layerStyles">,
  layer: K,
  patch: Partial<NonNullable<ResultLayerStyles[K]>>,
): Pick<ResultViewSettings, "layerStyles"> {
  const merged: Record<string, unknown> = { ...(rvs.layerStyles?.[layer] ?? {}), ...patch };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  const styles: ResultLayerStyles = { ...(rvs.layerStyles ?? {}) };
  if (Object.keys(merged).length > 0) styles[layer] = merged as ResultLayerStyles[K];
  else delete styles[layer];
  return { layerStyles: Object.keys(styles).length > 0 ? styles : undefined };
}

/** The settings patch that draws `layer` as by default again. */
export function layerStyleCleared(rvs: Pick<ResultViewSettings, "layerStyles">, layer: keyof ResultLayerStyles): Pick<ResultViewSettings, "layerStyles"> {
  const styles: ResultLayerStyles = { ...(rvs.layerStyles ?? {}) };
  delete styles[layer];
  return { layerStyles: Object.keys(styles).length > 0 ? styles : undefined };
}

/** A factor of safety as the FOS label writes it. */
export function fosLabelText(fos: number, style: ResultLayerStyles["fosLabel"]): string {
  return fos.toFixed(style?.decimals ?? FOS_LABEL_DECIMALS);
}

/** The FOS label's size relative to the default (its box and offsets scale with it). */
export function fosLabelScale(style: { fontSize?: number } | undefined): number {
  return (style?.fontSize ?? FOS_LABEL_FONT_PX) / FOS_LABEL_FONT_PX;
}

/** The canvas font of a FOS label of `px` pixels. */
export function fosLabelCanvasFont(style: ResultLayerStyles["fosLabel"], px: number): string {
  return `${style?.bold === false ? "" : "bold "}${px}px ${style?.fontFamily ?? "sans-serif"}`;
}

/**
 * A line width or size in the PDF (mm): the PDF's own default scaled by
 * the override's ratio to the canvas default, so a style changes the
 * print as much as the screen and no style leaves the print as it was.
 */
export function pdfScaled(pdfDefault: number, override: number | undefined, canvasDefault: number): number {
  return override === undefined ? pdfDefault : (pdfDefault * override) / canvasDefault;
}

/** "#rrggbb" as red, green and blue (0 to 255). */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
