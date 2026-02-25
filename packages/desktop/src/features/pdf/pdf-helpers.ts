import { jsPDF, GState } from "jspdf";
import chroma from "chroma-js";

export type PathOp = { op: string; c: number[] };

export interface PdfTransform {
  worldToPdf: (wx: number, wy: number) => [number, number];
  canvasToPdf: (cx: number, cy: number) => [number, number];
  mmPerPx: number;
  paperW: number;
  paperH: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Parse a CSS color to [r,g,b]. Supports #hex, rgb(), and named colors via chroma. */
export function parseColor(color: string): [number, number, number] {
  try {
    if (color.startsWith("#")) return hexToRgb(color);
    const [r, g, b] = chroma(color).rgb();
    return [r, g, b];
  } catch {
    return [0, 0, 0];
  }
}

/** Set fill and/or stroke opacity via GState. Call resetOpacity() after drawing. */
export function setOpacity(
  pdf: jsPDF,
  fillOpacity: number,
  strokeOpacity?: number,
): void {
  pdf.saveGraphicsState();
  pdf.setGState(
    new GState({
      opacity: fillOpacity,
      "stroke-opacity": strokeOpacity ?? fillOpacity,
    }),
  );
}

export function resetOpacity(pdf: jsPDF): void {
  pdf.restoreGraphicsState();
}

/**
 * jsPDF's path() builds the path but ignores the style parameter.
 * This wrapper calls path() then writes the raw PDF painting operator.
 */
export function pdfPath(pdf: jsPDF, ops: PathOp[], style: string): void {
  pdf.path(ops);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdf.internal as any).write(style);
}

export function buildPolylinePath(
  points: [number, number][],
  closed = false,
): PathOp[] {
  if (points.length === 0) return [];
  const ops: PathOp[] = [{ op: "m", c: [points[0][0], points[0][1]] }];
  for (let i = 1; i < points.length; i++) {
    ops.push({ op: "l", c: [points[i][0], points[i][1]] });
  }
  if (closed) ops.push({ op: "h", c: [] });
  return ops;
}

/** Map jsPDF font name from CSS font-family. */
export function mapFont(family: string): string {
  const f = family.toLowerCase();
  if (f.includes("serif") && !f.includes("sans")) return "times";
  if (f.includes("mono") || f.includes("courier")) return "courier";
  return "helvetica";
}

/** Map font style string for jsPDF. */
export function mapFontStyle(
  bold?: boolean,
  italic?: boolean,
): "normal" | "bold" | "italic" | "bolditalic" {
  if (bold && italic) return "bolditalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "normal";
}

/** Interpolate surface Y at a given X from the external boundary. */
export function surfaceYAtX(
  x: number,
  coordinates: [number, number][],
): number | null {
  let bestY: number | null = null;
  for (let i = 0; i < coordinates.length; i++) {
    const [x0, y0] = coordinates[i];
    const [x1, y1] = coordinates[(i + 1) % coordinates.length];
    if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) {
      if (x1 === x0) continue;
      const t = (x - x0) / (x1 - x0);
      const y = y0 + t * (y1 - y0);
      if (bestY === null || y > bestY) bestY = y;
    }
  }
  return bestY;
}
