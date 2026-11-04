/**
 * The FOS colour scale of a result view: its range and colour scheme come
 * from the colour bar annotation, so the surfaces of the plot and the bar
 * always agree. Without a colour bar the automatic range and the default
 * scheme apply; with several (the ribbon toggles one) the first wins.
 */

import type { Annotation, ResultViewSettings } from "../../store/types";
import {
  DEFAULT_FOS_SCHEME,
  fosColorIn,
  fosFilterRange,
  fosFixedRange,
  fosScaleRange,
  isFosSchemeId,
  type FosColorScheme,
  type FosScaleRange,
} from "../../utils/fos-color";

/** The colour scale fields of a colour bar annotation. */
export type ColorBarScaleSettings = Pick<
  Annotation,
  "scaleMode" | "scaleMin" | "scaleMax" | "scheme" | "schemeFrom" | "schemeTo" | "schemeMid"
>;

/** What the "filter" range follows: Surfaces ▸ Filter by FOS. */
export type ScaleFilter = Pick<ResultViewSettings, "fosFilterMax">;

export interface FosColorScale {
  range: FosScaleRange;
  scheme: FosColorScheme;
  /** Colour of a surface with this FOS. */
  colorOf: (fos: number) => string;
}

type ScaleResult = { minFOS: number; maxFOS: number };

/** The colour scheme a colour bar chose; the default without one. */
export function colorBarScheme(anno?: ColorBarScaleSettings): FosColorScheme {
  if (!anno || !isFosSchemeId(anno.scheme)) return DEFAULT_FOS_SCHEME;
  if (anno.scheme !== "custom") return { id: anno.scheme };
  return { id: "custom", from: anno.schemeFrom, mid: anno.schemeMid, to: anno.schemeTo };
}

/**
 * The range a colour bar chose: fixed bounds, the surface filter's span,
 * or the automatic range. Bounds out of order and a filter limit not above
 * the critical FOS fall back to the automatic range.
 */
export function colorBarRange(
  anno: ColorBarScaleSettings | undefined,
  result: ScaleResult,
  filter?: ScaleFilter,
): FosScaleRange {
  if (anno?.scaleMode === "fixed") {
    return fosFixedRange(anno.scaleMin, anno.scaleMax, result) ?? fosScaleRange(result);
  }
  if (anno?.scaleMode === "filter" && filter) {
    return fosFilterRange(result, filter.fosFilterMax) ?? fosScaleRange(result);
  }
  return fosScaleRange(result);
}

/** The colour scale of one colour bar (or of none: the defaults). */
export function colorScaleOfBar(
  anno: ColorBarScaleSettings | undefined,
  result: ScaleResult,
  filter?: ScaleFilter,
): FosColorScale {
  const range = colorBarRange(anno, result, filter);
  const scheme = colorBarScheme(anno);
  return { range, scheme, colorOf: (fos) => fosColorIn(scheme, fos, range.min, range.max) };
}

/** The first colour bar of the view, which sets the scale of the plot. */
export function firstColorBar(annotations: readonly Annotation[]): Annotation | undefined {
  return annotations.find((a) => a.type === "color-bar");
}

/** The colour scale of the result view, set by its (first) colour bar. */
export function colorScaleOf(
  rvs: Pick<ResultViewSettings, "annotations" | "fosFilterMax">,
  result: ScaleResult,
): FosColorScale {
  return colorScaleOfBar(firstColorBar(rvs.annotations), result, rvs);
}
