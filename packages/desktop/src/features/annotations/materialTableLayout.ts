import type { MaterialTableColumnKey } from "../../store/types";

export type MaterialTableRenderColumnKey =
  | "color"
  | "name"
  | MaterialTableColumnKey;

const MM_PER_CSS_PX = 25.4 / 96;

/** Base column widths calibrated for a 6 px font size. */
const BASE_COLUMN_WIDTH_PX: Record<MaterialTableRenderColumnKey, number> = {
  color: 21,
  name: 52,
  model: 38,
  unitWeight: 30,
  cohesion: 38,
  piezometricLine: 41,
  depthRef: 38,
  cDatum: 30,
  cRate: 38,
  frictionAngle: 38,
};

const BASE_FONT_SIZE = 6;

export function getMaterialTableColumnWidthPx(
  key: MaterialTableRenderColumnKey,
  scale = 1,
  fontSize = BASE_FONT_SIZE,
): number {
  return BASE_COLUMN_WIDTH_PX[key] * scale * (fontSize / BASE_FONT_SIZE);
}

export function getMaterialTableColumnWidthMm(
  key: MaterialTableRenderColumnKey,
  scale = 1,
  fontSize = BASE_FONT_SIZE,
): number {
  return getMaterialTableColumnWidthPx(key, scale, fontSize) * MM_PER_CSS_PX;
}
