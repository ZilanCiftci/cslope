import { PAPER_DIMENSIONS } from "../../store/app-store";
import type { PaperSize } from "../../store/app-store";

/** Compute the paper frame rectangle (centered, with margin) given canvas CSS size. */
export function computePaperFrame(
  canvasW: number,
  canvasH: number,
  paperSize: PaperSize,
): { x: number; y: number; w: number; h: number } {
  const { w: pw, h: ph } = PAPER_DIMENSIONS[paperSize];
  const paperAspect = pw / ph;
  const margin = 20; // px margin around the frame
  const availW = canvasW - margin * 2;
  const availH = canvasH - margin * 2;
  let frameW: number;
  let frameH: number;
  if (availW / availH > paperAspect) {
    // Canvas is wider than paper — fit height
    frameH = availH;
    frameW = frameH * paperAspect;
  } else {
    // Canvas is taller — fit width
    frameW = availW;
    frameH = frameW / paperAspect;
  }
  const x = (canvasW - frameW) / 2;
  const y = (canvasH - frameH) / 2;
  return { x, y, w: frameW, h: frameH };
}

/** Draw a labelled parameter block on the canvas. */
export function drawParamBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  title: string,
  lines: string[],
  scale = 1,
) {
  const padding = 8 * scale;
  const lineHeight = 16 * scale;
  const titleHeight = 20 * scale;
  const font = `${12 * scale}px sans-serif`;
  const titleFont = `bold ${12 * scale}px sans-serif`;

  ctx.font = titleFont;
  let maxW = ctx.measureText(title).width;
  ctx.font = font;
  for (const line of lines) {
    maxW = Math.max(maxW, ctx.measureText(line).width);
  }
  const boxW = maxW + padding * 2;
  const boxH = titleHeight + lines.length * lineHeight + padding;

  // Background
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeRect(x, y, boxW, boxH);

  // Title
  ctx.fillStyle = "#000";
  ctx.font = titleFont;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(title, x + padding, y + padding);

  // Separator line
  ctx.strokeStyle = "#ccc";
  ctx.beginPath();
  ctx.moveTo(x + 4, y + titleHeight);
  ctx.lineTo(x + boxW - 4, y + titleHeight);
  ctx.stroke();

  // Lines
  ctx.fillStyle = "#333";
  ctx.font = font;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + padding, y + titleHeight + 4 + i * lineHeight);
  }
}

/** Draw a material table on the canvas. */
export function drawTable(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  header: string[],
  rows: string[][],
  materials: { color: string }[],
  scale = 1,
) {
  const padding = 6 * scale;
  const rowH = 18 * scale;
  const headerH = 22 * scale;
  const font = `${11 * scale}px sans-serif`;
  const headerFont = `bold ${11 * scale}px sans-serif`;
  const swatchW = 12 * scale;

  // Measure column widths
  ctx.font = headerFont;
  const colW = header.map((h) => ctx.measureText(h).width + padding * 2);
  ctx.font = font;
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      colW[c] = Math.max(colW[c], ctx.measureText(row[c]).width + padding * 2);
    }
  }
  // Add swatch width to first column
  colW[0] += swatchW + 4;

  const totalW = colW.reduce((a, b) => a + b, 0);
  const totalH = headerH + rows.length * rowH;

  // Background
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, totalW, totalH);
  ctx.strokeRect(x, y, totalW, totalH);

  // Header
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(x, y, totalW, headerH);
  ctx.strokeStyle = "#ccc";
  ctx.beginPath();
  ctx.moveTo(x, y + headerH);
  ctx.lineTo(x + totalW, y + headerH);
  ctx.stroke();

  ctx.fillStyle = "#000";
  ctx.font = headerFont;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cx = x;
  for (let c = 0; c < header.length; c++) {
    ctx.fillText(
      header[c],
      cx + padding + (c === 0 ? swatchW + 4 : 0),
      y + headerH / 2,
    );
    cx += colW[c];
  }

  // Rows
  ctx.font = font;
  for (let r = 0; r < rows.length; r++) {
    const ry = y + headerH + r * rowH;
    // Alternating row color
    if (r % 2 === 1) {
      ctx.fillStyle = "rgba(0,0,0,0.03)";
      ctx.fillRect(x, ry, totalW, rowH);
    }
    // Row border
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(x, ry + rowH);
    ctx.lineTo(x + totalW, ry + rowH);
    ctx.stroke();

    cx = x;
    for (let c = 0; c < rows[r].length; c++) {
      if (c === 0 && materials[r]) {
        // Color swatch
        ctx.fillStyle = materials[r].color;
        ctx.fillRect(cx + padding, ry + 3, swatchW, swatchW);
        ctx.strokeStyle = "#666";
        ctx.strokeRect(cx + padding, ry + 3, swatchW, swatchW);
      }
      ctx.fillStyle = "#333";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(
        rows[r][c],
        cx + padding + (c === 0 ? swatchW + 4 : 0),
        ry + rowH / 2,
      );
      cx += colW[c];
    }
  }
}
