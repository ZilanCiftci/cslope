import chroma from "chroma-js";

/** Shared FOS-to-color mapper used across canvas, plot, and PDF export. */
const FOS_SCALE = chroma.scale(["red", "yellow", "green", "blue"]);

/**
 * Colour of the governing FOS in the summary and the status bar: red below
 * 1.0, amber below 1.5 and green otherwise. With partial factors the FOS is
 * an over-design factor on design values, where 1.0 already satisfies the
 * design, so there is no amber band.
 */
export function fosStatusColor(fos: number, designValues: boolean): string {
  if (fos < 1.0) return "var(--color-vsc-error)";
  if (!designValues && fos < 1.5) return "var(--color-vsc-warning-text)";
  return "var(--color-vsc-success)";
}

/** Colour of `fos` on the default (classic) scheme. */
export function fosColor(fos: number, minFos = 0.5, maxFos = 3.0): string {
  return FOS_SCALE(fosFraction(fos, minFos, maxFos)).hex();
}

/** Position of `fos` on a scale from `minFos` (0) to `maxFos` (1), clamped. */
function fosFraction(fos: number, minFos: number, maxFos: number): number {
  const t = (fos - minFos) / (maxFos - minFos || 1);
  return Math.max(0, Math.min(1, t));
}

// ── Colour schemes ─────────────────────────────────────────────────────

export type FosSchemePreset = "classic" | "traffic" | "cool-warm" | "viridis" | "greyscale";
export type FosSchemeId = FosSchemePreset | "custom";

/**
 * A colour scheme of the FOS scale: a preset, or "custom" with its own
 * end colours (hex) and an optional middle colour. Missing custom colours
 * take the defaults of CUSTOM_SCHEME_DEFAULTS.
 */
export interface FosColorScheme {
  id: FosSchemeId;
  from?: string;
  mid?: string;
  to?: string;
}

export interface FosSchemePresetDef {
  id: FosSchemePreset;
  label: string;
  /** The colour stops from the lowest FOS to the highest. */
  colors: readonly string[];
  /** Interpolation space; the classic scheme keeps its RGB blend. */
  mode: "rgb" | "oklab";
}

/**
 * The presets, the first being the default: it is the scale the app has
 * always used (red at the critical FOS through yellow and green to blue),
 * blended in RGB so existing drawings keep their colours.
 */
export const FOS_SCHEME_PRESETS: readonly FosSchemePresetDef[] = [
  { id: "classic", label: "Red, yellow, green, blue", colors: ["red", "yellow", "green", "blue"], mode: "rgb" },
  { id: "traffic", label: "Traffic light (red to green)", colors: ["#d7191c", "#ffd700", "#1a9641"], mode: "oklab" },
  { id: "cool-warm", label: "Warm to cool (red to blue)", colors: ["#b40426", "#dddddd", "#3b4cc0"], mode: "oklab" },
  { id: "viridis", label: "Viridis (purple to yellow)", colors: chroma.brewer.Viridis, mode: "rgb" },
  { id: "greyscale", label: "Grayscale (black to light gray)", colors: ["#000000", "#c8c8c8"], mode: "oklab" },
];

export const DEFAULT_FOS_SCHEME_ID: FosSchemePreset = "classic";
export const DEFAULT_FOS_SCHEME: FosColorScheme = { id: DEFAULT_FOS_SCHEME_ID };
/** End colours of a custom scheme whose colours are not set. */
export const CUSTOM_SCHEME_DEFAULTS = { from: "#cc0000", to: "#0066cc" } as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** True for a six-digit hex colour such as "#1a9641". */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function isFosSchemePreset(value: unknown): value is FosSchemePreset {
  return FOS_SCHEME_PRESETS.some((p) => p.id === value);
}

export function isFosSchemeId(value: unknown): value is FosSchemeId {
  return value === "custom" || isFosSchemePreset(value);
}

/** The colour stops of a scheme, lowest FOS first (also for a preview). */
export function fosSchemeStops(scheme: FosColorScheme): string[] {
  if (scheme.id !== "custom") {
    const preset = FOS_SCHEME_PRESETS.find((p) => p.id === scheme.id) ?? FOS_SCHEME_PRESETS[0];
    return [...preset.colors];
  }
  const from = isHexColor(scheme.from) ? scheme.from : CUSTOM_SCHEME_DEFAULTS.from;
  const to = isHexColor(scheme.to) ? scheme.to : CUSTOM_SCHEME_DEFAULTS.to;
  return isHexColor(scheme.mid) ? [from, scheme.mid, to] : [from, to];
}

type ChromaScale = ReturnType<typeof chroma.scale>;
const presetScales = new Map<FosSchemePreset, ChromaScale>([["classic", FOS_SCALE]]);
const customScales = new Map<string, ChromaScale>();

function schemeScale(scheme: FosColorScheme): ChromaScale {
  if (scheme.id !== "custom") {
    const preset = FOS_SCHEME_PRESETS.find((p) => p.id === scheme.id) ?? FOS_SCHEME_PRESETS[0];
    let scale = presetScales.get(preset.id);
    if (!scale) {
      scale = chroma.scale([...preset.colors]).mode(preset.mode);
      presetScales.set(preset.id, scale);
    }
    return scale;
  }
  const stops = fosSchemeStops(scheme);
  const key = stops.join("|").toLowerCase();
  let scale = customScales.get(key);
  if (!scale) {
    // A custom scheme is blended in OKLab: even lightness steps and no
    // grey trough between two saturated colours, which an RGB blend gives.
    scale = chroma.scale(stops).mode("oklab");
    if (customScales.size > 64) customScales.clear();
    customScales.set(key, scale);
  }
  return scale;
}

/** Colour at position `t` (0 = lowest FOS, 1 = highest) of a scheme. */
export function fosSchemeColorAt(scheme: FosColorScheme, t: number): string {
  return schemeScale(scheme)(Math.max(0, Math.min(1, t))).hex();
}

/** Colour of `fos` on a scheme; the classic scheme matches fosColor(). */
export function fosColorIn(scheme: FosColorScheme, fos: number, minFos: number, maxFos: number): string {
  return schemeScale(scheme)(fosFraction(fos, minFos, maxFos)).hex();
}

/** CSS gradient of a scheme, lowest FOS on the left (for a preview). */
export function fosSchemeGradient(scheme: FosColorScheme, steps = 12): string {
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) stops.push(fosSchemeColorAt(scheme, i / steps));
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

// ── Scale range ────────────────────────────────────────────────────────

export interface FosScaleRange {
  min: number;
  max: number;
  /** True when surfaces above `max` exist (they get the top colour). */
  capped: boolean;
  /** True when surfaces below `min` exist (they get the bottom colour). */
  floored?: boolean;
}

/**
 * FOS range of the colour scale. The search always finds some surfaces
 * with very high FOS (small or shallow ones in cohesive soil), so the
 * scale ends at max(minFOS + 1, 2·minFOS) to keep the colours spread
 * over the surfaces near the critical one.
 */
export function fosScaleRange(result: { minFOS: number; maxFOS: number }): FosScaleRange {
  const { minFOS, maxFOS } = result;
  const upper = Math.max(minFOS + 1, 2 * minFOS);
  return maxFOS > upper
    ? { min: minFOS, max: upper, capped: true }
    : { min: minFOS, max: maxFOS, capped: false };
}

/** True when `min` and `max` are finite and in order: a usable fixed range. */
export function validFosScaleBounds(min: unknown, max: unknown): min is number {
  return typeof min === "number" && typeof max === "number" && Number.isFinite(min) && Number.isFinite(max) && min < max;
}

/**
 * A fixed range of the colour scale: surfaces beyond either end get the
 * end colour and the tick there reads "≥" or "≤". Null for bounds that are
 * not in order (the caller falls back to the automatic range).
 */
export function fosFixedRange(
  min: unknown,
  max: unknown,
  result: { minFOS: number; maxFOS: number },
): FosScaleRange | null {
  if (!validFosScaleBounds(min, max)) return null;
  const range: FosScaleRange = { min, max: max as number, capped: result.maxFOS > (max as number) };
  if (result.minFOS < min) range.floored = true;
  return range;
}

/**
 * The range of the surface filter (Surfaces ▸ Filter by FOS): from the
 * critical FOS to the filter's limit. Null when the limit is not above the
 * critical FOS (the filter shows no other surface; the automatic range is
 * used).
 */
export function fosFilterRange(result: { minFOS: number; maxFOS: number }, fosFilterMax: number): FosScaleRange | null {
  if (!Number.isFinite(fosFilterMax) || fosFilterMax <= result.minFOS) return null;
  return { min: result.minFOS, max: fosFilterMax, capped: result.maxFOS > fosFilterMax };
}

/** FOS of colour-bar tick `t` of `ticks` (0 = top). */
export function fosTickValue(range: FosScaleRange, t: number, ticks: number): number {
  return range.max - (t / ticks) * (range.max - range.min);
}

/**
 * Colour-bar tick label; the top one of a capped scale reads "≥ x" and the
 * bottom one of a floored scale "≤ x".
 */
export function fosTickLabel(range: FosScaleRange, t: number, ticks: number, ge = "≥ ", le = "≤ "): string {
  const text = fosTickValue(range, t, ticks).toFixed(2);
  if (t === 0 && range.capped) return ge + text;
  if (t === ticks && range.floored) return le + text;
  return text;
}
