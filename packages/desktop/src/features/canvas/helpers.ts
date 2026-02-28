import { PAPER_DIMENSIONS } from "../../store/app-store";
import type { PaperSize } from "../../store/app-store";
import type {
  AnalysisResult,
  MaterialRow,
  ProjectInfo,
  ResultViewSettings,
} from "../../store/types";
import { PAPER_FRAME_MARGIN_PX } from "../../constants";
import { circleArcPoints } from "../../utils/arc";

/** Compute the paper frame rectangle (centered, with margin) given canvas CSS size. */
export function computePaperFrame(
  canvasW: number,
  canvasH: number,
  paperSize: PaperSize,
): { x: number; y: number; w: number; h: number } {
  const { w: pw, h: ph } = PAPER_DIMENSIONS[paperSize];
  const paperAspect = pw / ph;
  const margin = PAPER_FRAME_MARGIN_PX;
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

type Coord = [number, number];

type CoordinatesHolder = {
  coordinates: Coord[];
};

type AnalysisLimitsLike = {
  enabled: boolean;
  entryLeftX: number;
  entryRightX: number;
  exitLeftX: number;
  exitRightX: number;
};

type UdlLike = {
  x1: number;
  x2: number;
};

type LineLoadLike = {
  x: number;
};

export function surfaceYAtXFromCoordinates(
  coordinates: Coord[],
  x: number,
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

export function collectModelFitBounds(params: {
  coordinates: Coord[];
  materialBoundaries: CoordinatesHolder[];
  piezometricLines: CoordinatesHolder[];
  analysisLimits: AnalysisLimitsLike;
  udls: UdlLike[];
  lineLoads: LineLoadLike[];
  surfaceYAtX: (x: number) => number | null;
}): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  const {
    coordinates,
    materialBoundaries,
    piezometricLines,
    analysisLimits,
    udls,
    lineLoads,
    surfaceYAtX,
  } = params;

  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;

  const addPoint = (x: number, y: number) => {
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  };

  for (const [x, y] of coordinates) addPoint(x, y);

  for (const boundary of materialBoundaries) {
    for (const [x, y] of boundary.coordinates) addPoint(x, y);
  }

  for (const line of piezometricLines) {
    for (const [x, y] of line.coordinates) addPoint(x, y);
  }

  if (analysisLimits.enabled) {
    const limitXs = [
      analysisLimits.entryLeftX,
      analysisLimits.entryRightX,
      analysisLimits.exitLeftX,
      analysisLimits.exitRightX,
    ];
    for (const x of limitXs) {
      const y = surfaceYAtX(x);
      if (y !== null) addPoint(x, y);
    }
  }

  for (const udl of udls) {
    const y1 = surfaceYAtX(udl.x1);
    if (y1 !== null) addPoint(udl.x1, y1);
    const y2 = surfaceYAtX(udl.x2);
    if (y2 !== null) addPoint(udl.x2, y2);
  }

  for (const lineLoad of lineLoads) {
    const y = surfaceYAtX(lineLoad.x);
    if (y !== null) addPoint(lineLoad.x, y);
  }

  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return null;
  return { xMin, xMax, yMin, yMax };
}

export function extendBoundsWithResultFitExtras(params: {
  result: AnalysisResult;
  resultViewSettings: ResultViewSettings;
  materials: MaterialRow[];
  projectInfo: ProjectInfo;
  canvas: HTMLCanvasElement | null;
  width: number;
  height: number;
  canvasToWorld: (
    cx: number,
    cy: number,
    w: number,
    h: number,
  ) => [number, number];
  addPoint: (x: number, y: number) => void;
}) {
  const {
    result,
    resultViewSettings,
    materials,
    projectInfo,
    canvas,
    width,
    height,
    canvasToWorld,
    addPoint,
  } = params;

  const rvs = resultViewSettings;
  const surfaces = (() => {
    if (rvs.surfaceDisplay === "critical") {
      return result.criticalSurface ? [result.criticalSurface] : [];
    }
    if (rvs.surfaceDisplay === "filter") {
      return result.allSurfaces.filter((s) => s.fos <= rvs.fosFilterMax);
    }
    return result.allSurfaces;
  })();

  const addSurface = (surf: {
    cx: number;
    cy: number;
    radius: number;
    entryPoint: [number, number];
    exitPoint: [number, number];
  }) => {
    const arcPts = circleArcPoints(
      surf.cx,
      surf.cy,
      surf.radius,
      surf.entryPoint,
      surf.exitPoint,
    );
    for (const [px, py] of arcPts) addPoint(px, py);
  };

  for (const surf of surfaces) addSurface(surf);
  if (result.criticalSurface) addSurface(result.criticalSurface);

  if (result.criticalSurface && (rvs.showCentreMarker || rvs.showFosLabel)) {
    addPoint(result.criticalSurface.cx, result.criticalSurface.cy);
  }

  const ctx = canvas?.getContext("2d") ?? null;
  if (!ctx || rvs.annotations.length === 0) return;

  const addCanvasRect = (
    x: number,
    y: number,
    rectW: number,
    rectH: number,
  ) => {
    const corners: [number, number][] = [
      [x, y],
      [x + rectW, y],
      [x, y + rectH],
      [x + rectW, y + rectH],
    ];
    for (const [px, py] of corners) {
      const [wx, wy] = canvasToWorld(px, py, width, height);
      addPoint(wx, wy);
    }
  };

  const pf = computePaperFrame(width, height, rvs.paperFrame.paperSize);
  const annoScale = Math.min(pf.w, pf.h) / 600;

  const resolveAnnotationText = (text: string) => {
    if (!text) return "";
    return text
      .replace(/#Title/gi, projectInfo.title)
      .replace(/#Subtitle/gi, projectInfo.subtitle)
      .replace(/#Client/gi, projectInfo.client)
      .replace(/#ProjectNumber/gi, projectInfo.projectNumber)
      .replace(/#Revision/gi, projectInfo.revision)
      .replace(/#Author/gi, projectInfo.author)
      .replace(/#Checker/gi, projectInfo.checker)
      .replace(/#Date/gi, projectInfo.date)
      .replace(/#Description/gi, projectInfo.description)
      .replace(/#FOS/gi, result.minFOS.toFixed(3))
      .replace(/#MinFOS/gi, result.minFOS.toFixed(3))
      .replace(/#Method/gi, result.method)
      .replace(/\n/g, "\n");
  };

  const measureParamBlock = (title: string, lines: string[]) => {
    const padding = 8 * annoScale;
    const lineHeight = 16 * annoScale;
    const titleHeight = 20 * annoScale;
    const font = `${12 * annoScale}px sans-serif`;
    const titleFont = `bold ${12 * annoScale}px sans-serif`;

    ctx.font = titleFont;
    let maxW = ctx.measureText(title).width;
    ctx.font = font;
    for (const line of lines) {
      maxW = Math.max(maxW, ctx.measureText(line).width);
    }
    const boxW = maxW + padding * 2;
    const boxH = titleHeight + lines.length * lineHeight + padding;
    return { width: boxW, height: boxH };
  };

  const measureTable = (header: string[], rows: string[][]) => {
    const padding = 6 * annoScale;
    const rowH = 18 * annoScale;
    const headerH = 22 * annoScale;
    const font = `${11 * annoScale}px sans-serif`;
    const headerFont = `bold ${11 * annoScale}px sans-serif`;
    const swatchW = 12 * annoScale;

    ctx.font = headerFont;
    const colW = header.map((h) => ctx.measureText(h).width + padding * 2);
    ctx.font = font;
    for (const row of rows) {
      for (let c = 0; c < row.length; c++) {
        colW[c] = Math.max(
          colW[c],
          ctx.measureText(row[c]).width + padding * 2,
        );
      }
    }
    colW[0] += swatchW + 4;

    const totalW = colW.reduce((a, b) => a + b, 0);
    const totalH = headerH + rows.length * rowH;
    return { width: totalW, height: totalH };
  };

  for (const anno of rvs.annotations) {
    const ax = pf.x + anno.x * pf.w;
    const ay = pf.y + anno.y * pf.h;

    if (anno.type === "text") {
      const fontSize = (anno.fontSize ?? 12) * annoScale;
      const family = anno.fontFamily ?? "sans-serif";
      const weight = anno.bold ? "bold" : "normal";
      const style = anno.italic ? "italic" : "normal";
      const resolvedText = resolveAnnotationText(anno.text ?? "");
      const lines = resolvedText.split("\n");
      const lineHeight = fontSize * 1.2;

      ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
      let maxW = 0;
      for (const line of lines) {
        maxW = Math.max(maxW, ctx.measureText(line).width);
      }
      const textHeight = lines.length * lineHeight;
      addCanvasRect(ax, ay, maxW, textHeight);
    } else if (anno.type === "color-bar") {
      const barW = 20 * annoScale;
      const barH = 200 * annoScale;
      const barY = ay;

      const fosMin = result.minFOS;
      const fosMax = result.maxFOS;
      const numTicks = 5;
      const fontSize = Math.max(10, 11 * annoScale);
      const labelX2 = ax + barW + 5 * annoScale;

      ctx.font = `${fontSize}px 'Segoe UI', sans-serif`;
      let maxLabelW = 0;
      for (let t = 0; t <= numTicks; t++) {
        const frac = t / numTicks;
        const fos = fosMax - frac * (fosMax - fosMin);
        maxLabelW = Math.max(maxLabelW, ctx.measureText(fos.toFixed(2)).width);
      }

      const xRight = labelX2 + maxLabelW;
      const yTop = barY - 4 * annoScale - fontSize;
      const yBottom = barY + barH;
      addCanvasRect(ax, yTop, xRight - ax, yBottom - yTop);
    } else if (anno.type === "input-params") {
      const { width: boxW, height: boxH } = measureParamBlock(
        "Input Parameters",
        [
          `Method: ${result.method}`,
          `Slices: ${result.criticalSlices.length}`,
          `Surfaces: ${result.allSurfaces.length}`,
        ],
      );
      addCanvasRect(ax, ay, boxW, boxH);
    } else if (anno.type === "output-params") {
      const lines = [`FOS = ${result.minFOS.toFixed(3)}`];
      if (result.criticalSurface) {
        lines.push(
          `Centre: (${result.criticalSurface.cx.toFixed(1)}, ${result.criticalSurface.cy.toFixed(1)})`,
        );
        lines.push(`Radius: ${result.criticalSurface.radius.toFixed(2)} m`);
      }
      lines.push(`Time: ${result.elapsedMs.toFixed(0)} ms`);
      const { width: boxW, height: boxH } = measureParamBlock("Results", lines);
      addCanvasRect(ax, ay, boxW, boxH);
    } else if (anno.type === "material-table") {
      const header = ["Material", "gamma", "phi", "c"];
      const rows = materials.map((m) => [
        m.name,
        `${m.unitWeight}`,
        `${m.frictionAngle} deg`,
        `${m.cohesion}`,
      ]);
      const { width: tableW, height: tableH } = measureTable(header, rows);
      addCanvasRect(ax, ay, tableW, tableH);
    }
  }
}

export function extendBoundsWithFosLabelFitPadding(params: {
  result: AnalysisResult | null;
  showFosLabel: boolean;
  canvas: HTMLCanvasElement | null;
  scale: number;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  const { result, showFosLabel, canvas, scale, bounds } = params;

  if (!result?.criticalSurface || !showFosLabel || scale <= 0) return null;

  const ctx = canvas?.getContext("2d");
  if (!ctx) return null;

  const fosText = result.criticalSurface.fos.toFixed(3);
  ctx.font = "bold 14px sans-serif";
  const tw = ctx.measureText(fosText).width;
  const extraRight = (13 + tw) / scale;
  const extraLeft = 7 / scale;
  const extraUp = 16 / scale;
  const extraDown = 6 / scale;

  const { cx, cy } = result.criticalSurface;
  return {
    xMin: Math.min(bounds.xMin, cx - extraLeft),
    xMax: Math.max(bounds.xMax, cx + extraRight),
    yMin: Math.min(bounds.yMin, cy - extraDown),
    yMax: Math.max(bounds.yMax, cy + extraUp),
  };
}
