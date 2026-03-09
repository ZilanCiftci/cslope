/**
 * Hatch-pattern drawing utilities.
 *
 * Provides functions to draw hatch lines clipped to an arbitrary polygon
 * on both Canvas 2D and jsPDF.
 */

import type { HatchPattern } from "./style-spec";

// ── Geometry helpers ───────────────────────────────────────────

/** Compute the bounding box of a set of canvas-space points. */
function boundingBox(pts: [number, number][]) {
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (const [x, y] of pts) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return { xMin, xMax, yMin, yMax };
}

/**
 * Generate parallel hatch lines covering a bounding box at a given angle
 * and spacing.  Returns an array of line segments as `[x1, y1, x2, y2]`.
 */
function generateHatchLines(
  bb: { xMin: number; xMax: number; yMin: number; yMax: number },
  angleDeg: number,
  spacing: number,
): [number, number, number, number][] {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // Diagonal length of the bounding box — ensures full coverage
  const dx = bb.xMax - bb.xMin;
  const dy = bb.yMax - bb.yMin;
  const diag = Math.sqrt(dx * dx + dy * dy);

  const cx = (bb.xMin + bb.xMax) / 2;
  const cy = (bb.yMin + bb.yMax) / 2;

  const lines: [number, number, number, number][] = [];
  const count = Math.ceil(diag / spacing) + 1;

  for (let i = -count; i <= count; i++) {
    const offset = i * spacing;
    // Perpendicular offset from centre
    const ox = cx + offset * -sin;
    const oy = cy + offset * cos;
    // Line endpoints along the hatch direction
    lines.push([
      ox - diag * cos,
      oy - diag * sin,
      ox + diag * cos,
      oy + diag * sin,
    ]);
  }

  return lines;
}

// ── Canvas 2D ──────────────────────────────────────────────────

/**
 * Draw a hatch pattern inside a polygon on a Canvas 2D context.
 *
 * The polygon must already be defined as a clip path before calling
 * this function (caller handles save/clip/restore).
 *
 * @param ctx     Canvas 2D rendering context (already clipped to polygon)
 * @param pts     Polygon vertices in canvas coordinates
 * @param pattern Hatch pattern specification
 * @param holes   Optional hole polygons (already included in clip)
 */
export function drawCanvasHatch(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  pattern: HatchPattern,
) {
  if (pts.length < 3) return;
  const bb = boundingBox(pts);

  ctx.strokeStyle = pattern.color.hex;
  ctx.lineWidth = pattern.lineWidth;
  ctx.globalAlpha = 0.45;

  const drawLines = (angleDeg: number) => {
    const lines = generateHatchLines(bb, angleDeg, pattern.lineSpacing);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of lines) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };

  drawLines(pattern.angle);
  if (pattern.crossAngle !== undefined) {
    drawLines(pattern.crossAngle);
  }

  ctx.globalAlpha = 1;
}

/**
 * Draw a centroid label inside a polygon.
 */
export function drawCanvasHatchLabel(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  label: string,
) {
  if (pts.length < 3) return;

  // Simple centroid (average of vertices)
  let cx = 0,
    cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;

  ctx.save();
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  const m = ctx.measureText(label);
  const pw = m.width + 6;
  const ph = 14;
  ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
  ctx.fillStyle = "#333";
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

// ── PDF (jsPDF) ────────────────────────────────────────────────

/**
 * Draw hatch lines on a jsPDF document, clipped to a polygon.
 *
 * Caller must have already called `pdf.saveGraphicsState()` and clipped
 * to the polygon.  This function only draws the hatch lines.
 *
 * @param pdf     jsPDF instance
 * @param pts     Polygon vertices in PDF coordinates (mm)
 * @param pattern Hatch pattern specification
 * @param mmPerPx Scale factor (mm per logical pixel)
 */
export function drawPdfHatch(
  pdf: { line: (x1: number, y1: number, x2: number, y2: number) => void } & {
    setDrawColor: (...args: number[]) => void;
    setLineWidth: (w: number) => void;
  },
  pts: [number, number][],
  pattern: HatchPattern,
  mmPerPx: number,
) {
  if (pts.length < 3) return;
  const bb = boundingBox(pts);

  const [r, g, b] = pattern.color.rgb;
  pdf.setDrawColor(r, g, b);
  pdf.setLineWidth(pattern.lineWidth * mmPerPx);

  const spacing = pattern.lineSpacing * mmPerPx;

  const strokeLines = (angleDeg: number) => {
    const lines = generateHatchLines(bb, angleDeg, spacing);
    for (const [x1, y1, x2, y2] of lines) {
      pdf.line(x1, y1, x2, y2);
    }
  };

  strokeLines(pattern.angle);
  if (pattern.crossAngle !== undefined) {
    strokeLines(pattern.crossAngle);
  }
}

/**
 * Draw a centroid label on a jsPDF document.
 */
export function drawPdfHatchLabel(
  pdf: {
    setFont: (family: string, style: string) => void;
    setFontSize: (size: number) => void;
    setTextColor: (...args: number[]) => void;
    setFillColor: (...args: number[]) => void;
    text: (text: string, x: number, y: number, options?: object) => void;
    getTextWidth: (text: string) => number;
    rect: (x: number, y: number, w: number, h: number, style: string) => void;
  },
  pts: [number, number][],
  label: string,
  mmPerPx: number,
) {
  if (pts.length < 3) return;

  let cx = 0,
    cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;

  const fontSize = Math.max(6, 10 * mmPerPx);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(fontSize / 0.3528);

  const tw = pdf.getTextWidth(label);
  const pw = tw + 2 * mmPerPx;
  const ph = fontSize * 1.4;

  pdf.setFillColor(255, 255, 255);
  pdf.rect(cx - pw / 2, cy - ph / 2, pw, ph, "F");

  pdf.setTextColor(51, 51, 51);
  pdf.text(label, cx, cy + fontSize * 0.35, { align: "center" });
}
