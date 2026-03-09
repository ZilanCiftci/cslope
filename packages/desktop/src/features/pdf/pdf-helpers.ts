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
  const state = new GState({
    opacity: fillOpacity,
    "stroke-opacity": strokeOpacity ?? fillOpacity,
  });
  // @ts-ignore - jsPDF types might not include setGState depending on version
  pdf.setGState(state);
}

export function resetOpacity(pdf: jsPDF): void {
  pdf.restoreGraphicsState();
}

export function pdfPath(pdf: jsPDF, ops: PathOp[], style: string): void {
  for (const op of ops) {
    if (op.op === "m") {
      pdf.moveTo(op.c[0], op.c[1]);
      continue;
    }

    if (op.op === "l") {
      pdf.lineTo(op.c[0], op.c[1]);
      continue;
    }

    if (op.op === "h") {
      pdf.close();
    }
  }

  if (style === "S") {
    pdf.stroke();
    return;
  }

  if (style === "f") {
    pdf.fill();
    return;
  }

  if (style === "f*") {
    pdf.fillEvenOdd();
    return;
  }

  // Empty style: path defined but no fill/stroke (used for clip paths)
  if (style === "") {
    return;
  }

  throw new Error(`Unsupported PDF path style: ${style}`);
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

/**
 * @deprecated Use `surfaceYAtX` from `features/view/surface` directly.
 * Re-exported here for backward-compatible imports in pdf-drawing.ts / tests.
 */
export { surfaceYAtX } from "../view/surface";
