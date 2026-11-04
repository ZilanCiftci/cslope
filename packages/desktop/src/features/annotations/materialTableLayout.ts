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

/** Font size of a material table that has none of its own. */
export const MATERIAL_TABLE_FONT_SIZE = BASE_FONT_SIZE;
/** Font size of a new material table: readable at 100 % and on an A4 sheet. */
export const NEW_MATERIAL_TABLE_FONT_SIZE = 8;

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

/**
 * `text` broken at spaces into lines no wider than `maxWidth` (a single
 * word wider than that stays on its own line).
 */
export function wrapWords(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  if (measure(text) <= maxWidth) return [text];
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 1) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Where everything of a material table goes, in the units of `scale`. */
export interface MaterialTableGeometry {
  padding: number;
  swatchW: number;
  headerLineH: number;
  bodyLineH: number;
  headerLines: string[][];
  /** The lines of each body cell (none for the colour column). */
  cellLines: string[][][];
  colW: number[];
  headerH: number;
  rowHeights: number[];
  totalW: number;
  totalH: number;
}

/**
 * The layout of a material table, shared by the canvas and the PDF so both
 * have the same proportions. A column is widened to its widest word and a
 * longer cell wraps onto more lines (its row grows), so no cell is cut
 * off; headers wrap the same way.
 */
export function layoutMaterialTable(
  columnKeys: MaterialTableRenderColumnKey[],
  header: string[],
  rows: string[][],
  measure: { header: (text: string) => number; body: (text: string) => number },
  scale = 1,
  fontSize = BASE_FONT_SIZE,
): MaterialTableGeometry {
  const f = fontSize / BASE_FONT_SIZE;
  const padding = 3 * scale;
  const rowH = 15 * scale * f;
  const swatchW = 10 * scale * f;
  const headerLineH = Math.max(fontSize * scale * 1.1, 11 * scale * f);
  const bodyLineH = fontSize * scale * 1.25;

  const colW = columnKeys.map((k) => getMaterialTableColumnWidthPx(k, scale, fontSize));
  colW[0] = Math.max(colW[0], swatchW + padding * 2);
  for (let c = 1; c < colW.length; c++) {
    for (const row of rows) {
      for (const word of (row[c] ?? "").split(/\s+/)) {
        if (word) colW[c] = Math.max(colW[c], measure.body(word) + padding * 2);
      }
    }
  }
  const headerLines = header.map((h, c) =>
    c <= 1 ? [h] : wrapWords(measure.header, h, Math.max(20 * scale, colW[c] - padding * 2)),
  );
  const cellLines = rows.map((row) =>
    row.map((text, c) => (c === 0 ? [] : wrapWords(measure.body, text, colW[c] - padding * 2))),
  );
  const maxHeaderLines = Math.max(...headerLines.map((l) => l.length));
  const headerH = Math.max(22 * scale * f, maxHeaderLines * headerLineH + padding * 2);
  const rowHeights = cellLines.map((cells) => rowH + (Math.max(1, ...cells.map((l) => l.length)) - 1) * bodyLineH);
  return {
    padding,
    swatchW,
    headerLineH,
    bodyLineH,
    headerLines,
    cellLines,
    colW,
    headerH,
    rowHeights,
    totalW: colW.reduce((a, b) => a + b, 0),
    totalH: headerH + rowHeights.reduce((a, b) => a + b, 0),
  };
}
