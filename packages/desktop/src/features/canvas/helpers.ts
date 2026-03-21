import type {
  AnalysisResult,
  Annotation,
  MaterialRow,
  MaterialTableColumnKey,
  ParameterDef,
  PiezometricLineState,
  ProjectInfo,
  ResultViewSettings,
} from "../../store/types";
import { circleArcPoints } from "../../utils/arc";
import { computePaperFrame } from "../view/paper";
import { MODEL_SHORT_LABELS } from "../rendering/style-spec";
import { flatFieldsFromModel } from "../properties/sections/material-forms/model-defaults";
import { resolveAnnotationText } from "../annotations/resolveAnnotationText";
import {
  getMaterialTableColumnWidthPx,
  type MaterialTableRenderColumnKey,
} from "../annotations/materialTableLayout";
import { anchoredTopLeft } from "../annotations/anchorPosition";

export { computePaperFrame } from "../view/paper";

export const MATERIAL_TABLE_COLUMNS: Array<{
  key: MaterialTableColumnKey;
  label: string;
}> = [
  { key: "model", label: "Slope Stability Material Model" },
  { key: "unitWeight", label: "Unit Weight (kN/m3)" },
  { key: "cohesion", label: "Undrained Shear Strength (kPa)" },
  { key: "piezometricLine", label: "Piezometric Surface" },
  { key: "depthRef", label: "Datum (Elevation) (m)" },
  { key: "cDatum", label: "C-Datum (kPa)" },
  { key: "cRate", label: "C-Rate of Change (kN/m2/m)" },
  { key: "frictionAngle", label: "Effective Friction Angle (\u00b0)" },
];

const DEFAULT_MATERIAL_TABLE_COLUMNS: MaterialTableColumnKey[] = [
  "model",
  "unitWeight",
  "cohesion",
  "piezometricLine",
  "depthRef",
  "cDatum",
  "cRate",
  "frictionAngle",
];

function formatMaterialCell(
  key: MaterialTableColumnKey,
  material: MaterialRow,
  piezometricLine?: PiezometricLineState,
): string {
  const f = flatFieldsFromModel(material.model);
  switch (key) {
    case "model":
      return MODEL_SHORT_LABELS[material.model.kind];
    case "unitWeight":
      return `${f.unitWeight}`;
    case "frictionAngle":
      return `${f.frictionAngle}\u00b0`;
    case "cohesion":
      return `${f.cohesion}`;
    case "piezometricLine": {
      const lineId = piezometricLine?.materialAssignment[material.id];
      if (!lineId) return "-";
      return piezometricLine?.lines.find((l) => l.id === lineId)?.name ?? "-";
    }
    case "depthRef":
      if (material.model.kind === "s-f-depth")
        return `${material.model.depthRef}`;
      if (material.model.kind === "s-f-datum") return `${material.model.yRef}`;
      return "-";
    case "cDatum":
      if (material.model.kind === "s-f-depth") return `${material.model.suRef}`;
      if (material.model.kind === "s-f-datum") return `${material.model.suRef}`;
      return "-";
    case "cRate":
      if (
        material.model.kind === "s-f-depth" ||
        material.model.kind === "s-f-datum"
      ) {
        return `${material.model.rate}`;
      }
      return "-";
  }
}

export function buildMaterialTableData(
  annotation: Annotation,
  materials: MaterialRow[],
  piezometricLine?: PiezometricLineState,
): {
  columnKeys: MaterialTableRenderColumnKey[];
  header: string[];
  rows: string[][];
} {
  const visibleColumns = annotation.tableColumns?.length
    ? annotation.tableColumns
    : DEFAULT_MATERIAL_TABLE_COLUMNS;
  const visibleDefs = MATERIAL_TABLE_COLUMNS.filter((c) =>
    visibleColumns.includes(c.key),
  );

  const columnKeys: MaterialTableRenderColumnKey[] = [
    "color",
    "name",
    ...visibleDefs.map((c) => c.key),
  ];
  const header = ["Color", "Name", ...visibleDefs.map((c) => c.label)];
  const rows = materials.map((m) => [
    "",
    m.name,
    ...visibleDefs.map((c) => formatMaterialCell(c.key, m, piezometricLine)),
  ]);
  return { columnKeys, header, rows };
}

function fitTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}\u2026`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}\u2026`;
}

function wrapHeaderText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
): string[] {
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
  return lines.length > 0 ? lines : [text];
}

/** Draw a material table on the canvas. */
export function drawTable(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  columnKeys: MaterialTableRenderColumnKey[],
  header: string[],
  rows: string[][],
  materials: { color: string }[],
  scale = 1,
  fontSize = 6,
) {
  const padding = 3 * scale;
  const rowH = 15 * scale * (fontSize / 6);
  const bodySize = fontSize * scale;
  const font = `${bodySize}px sans-serif`;
  const headingSize = fontSize * scale;
  const headerFont = `bold ${headingSize}px sans-serif`;
  const headerColor = "#000";
  const swatchW = 10 * scale * (fontSize / 6);
  const headerLineH = Math.max(headingSize * 1.1, 11 * scale * (fontSize / 6));

  // Measure column widths
  ctx.font = headerFont;
  const headerLines = header.map((h, c) =>
    c <= 1
      ? [h]
      : wrapHeaderText(
          (t) => ctx.measureText(t).width,
          h,
          Math.max(
            20 * scale,
            getMaterialTableColumnWidthPx(columnKeys[c], scale, fontSize) -
              padding * 2,
          ),
        ),
  );
  const colW = columnKeys.map((k) =>
    getMaterialTableColumnWidthPx(k, scale, fontSize),
  );
  colW[0] = Math.max(colW[0], swatchW + padding * 2);
  const maxHeaderLines = Math.max(...headerLines.map((l) => l.length));
  const headerH = Math.max(
    22 * scale * (fontSize / 6),
    maxHeaderLines * headerLineH + padding * 2,
  );

  const totalW = colW.reduce((a, b) => a + b, 0);
  const totalH = headerH + rows.length * rowH;

  // Background
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, totalW, totalH);
  ctx.strokeRect(x, y, totalW, totalH);

  // Header
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(x, y, totalW, headerH);
  ctx.strokeStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(x, y + headerH);
  ctx.lineTo(x + totalW, y + headerH);
  ctx.stroke();

  ctx.fillStyle = headerColor;
  ctx.font = headerFont;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let cx = x;
  for (let c = 0; c < header.length; c++) {
    const lines = headerLines[c];
    const startY = y + padding;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx + padding, startY + i * headerLineH);
    }
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
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, ry + rowH);
    ctx.lineTo(x + totalW, ry + rowH);
    ctx.stroke();

    cx = x;
    for (let c = 0; c < rows[r].length; c++) {
      if (c === 0 && materials[r]) {
        // Color swatch
        const swatchX = cx + (colW[c] - swatchW) / 2;
        ctx.fillStyle = materials[r].color;
        const swatchY = ry + (rowH - swatchW) / 2;
        ctx.fillRect(swatchX, swatchY, swatchW, swatchW);
        ctx.strokeStyle = "#666";
        ctx.strokeRect(swatchX, swatchY, swatchW, swatchW);
      }
      if (c === 0) {
        cx += colW[c];
        continue;
      }
      ctx.fillStyle = "#333";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const fitted = fitTextToWidth(
        ctx,
        rows[r][c],
        Math.max(4, colW[c] - padding * 2),
      );
      ctx.fillText(fitted, cx + padding, ry + rowH / 2);
      cx += colW[c];
    }
  }

  // Column separators (drawn last to keep a crisp black grid)
  let separatorX = x;
  for (let c = 0; c < colW.length - 1; c++) {
    separatorX += colW[c];
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(separatorX, y);
    ctx.lineTo(separatorX, y + totalH);
    ctx.stroke();
  }
}

export function measureTable(
  ctx: CanvasRenderingContext2D,
  columnKeys: MaterialTableRenderColumnKey[],
  header: string[],
  rows: string[][],
  scale = 1,
  fontSize = 6,
) {
  const padding = 3 * scale;
  const rowH = 15 * scale * (fontSize / 6);
  const headingSize = fontSize * scale;
  const headerFont = `bold ${headingSize}px sans-serif`;
  const swatchW = 10 * scale * (fontSize / 6);
  const headerLineH = Math.max(headingSize * 1.1, 11 * scale * (fontSize / 6));

  ctx.font = headerFont;
  const headerLines = header.map((h, c) =>
    c <= 1
      ? [h]
      : wrapHeaderText(
          (t) => ctx.measureText(t).width,
          h,
          Math.max(
            20 * scale,
            getMaterialTableColumnWidthPx(columnKeys[c], scale, fontSize) -
              padding * 2,
          ),
        ),
  );
  const colW = columnKeys.map((k) =>
    getMaterialTableColumnWidthPx(k, scale, fontSize),
  );
  colW[0] = Math.max(colW[0], swatchW + padding * 2);
  const maxHeaderLines = Math.max(...headerLines.map((l) => l.length));
  const headerH = Math.max(
    22 * scale * (fontSize / 6),
    maxHeaderLines * headerLineH + padding * 2,
  );

  return {
    w: colW.reduce((a, b) => a + b, 0),
    h: headerH + rows.length * rowH,
  };
}

export function getAnnotationBoundsPx(
  ctx: CanvasRenderingContext2D,
  params: {
    annotation: Annotation;
    paperFrame: { x: number; y: number; w: number; h: number };
    result: AnalysisResult;
    materials: MaterialRow[];
    piezometricLine?: PiezometricLineState;
    projectInfo: ProjectInfo;
    parameters: ParameterDef[];
  },
): { x: number; y: number; w: number; h: number } {
  const {
    annotation: anno,
    paperFrame: pf,
    result,
    materials,
    piezometricLine,
    projectInfo,
    parameters,
  } = params;

  const annoScale = Math.min(pf.w, pf.h) / 600;
  const ax = pf.x + anno.x * pf.w;
  const ay = pf.y + anno.y * pf.h;
  const hitPad = 4;

  if (anno.type === "text") {
    const family = anno.fontFamily ?? "sans-serif";
    const weight = anno.bold ? "bold" : "normal";
    const style = anno.italic ? "italic" : "normal";
    const fontSize = (anno.fontSize ?? 12) * annoScale;
    const resolved = resolveAnnotationText({
      text: anno.text ?? "",
      projectInfo,
      result,
      parameters,
    });
    const lines = resolved.split("\n");
    const lineHeight = fontSize * 1.2;

    ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
    let maxW = 0;
    for (const line of lines) {
      maxW = Math.max(maxW, ctx.measureText(line).width);
    }
    const textH = Math.max(lineHeight, lines.length * lineHeight);
    const contentW = Math.max(8, maxW);
    const contentH = Math.max(8, textH);
    const { x: tlx, y: tly } = anchoredTopLeft(
      ax,
      ay,
      contentW,
      contentH,
      anno.anchor,
    );

    return {
      x: tlx - hitPad,
      y: tly - hitPad,
      w: contentW + hitPad * 2,
      h: contentH + hitPad * 2,
    };
  }

  if (anno.type === "color-bar") {
    const barW = 20 * annoScale;
    const barH = 200 * annoScale;
    const numTicks = 5;
    const labelPad = 5 * annoScale;
    const labelFontSize = Math.max(10, 11 * annoScale);

    ctx.font = `${labelFontSize}px 'Segoe UI', sans-serif`;
    let maxLabelW = 0;
    for (let t = 0; t <= numTicks; t++) {
      const frac = t / numTicks;
      const fos = result.maxFOS - frac * (result.maxFOS - result.minFOS);
      maxLabelW = Math.max(maxLabelW, ctx.measureText(fos.toFixed(2)).width);
    }

    const titleExtraTop = labelFontSize + 4 * annoScale;
    const contentW = barW + labelPad + maxLabelW;
    const contentH = barH + titleExtraTop;
    const { x: tlx, y: tly } = anchoredTopLeft(
      ax,
      ay,
      contentW,
      contentH,
      anno.anchor,
    );

    return {
      x: tlx - hitPad,
      y: tly - hitPad,
      w: contentW + hitPad * 2,
      h: contentH + hitPad * 2,
    };
  }

  if (anno.type === "material-table") {
    const { columnKeys, header, rows } = buildMaterialTableData(
      anno,
      materials,
      piezometricLine,
    );
    const box = measureTable(
      ctx,
      columnKeys,
      header,
      rows,
      annoScale,
      anno.fontSize ?? 6,
    );
    const { x: tlx, y: tly } = anchoredTopLeft(
      ax,
      ay,
      box.w,
      box.h,
      anno.anchor,
    );
    return {
      x: tlx - hitPad,
      y: tly - hitPad,
      w: box.w + hitPad * 2,
      h: box.h + hitPad * 2,
    };
  }

  return { x: ax - 6, y: ay - 6, w: 12, h: 12 };
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

import { surfaceYAtX as _surfaceYAtX } from "../view/surface";

/**
 * @deprecated Use `surfaceYAtX` from `features/view/surface` directly.
 * Kept as a thin re-export for backward compatibility with existing call sites.
 */
export function surfaceYAtXFromCoordinates(
  coordinates: Coord[],
  x: number,
): number | null {
  return _surfaceYAtX(coordinates, x);
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
  piezometricLine?: PiezometricLineState;
  projectInfo: ProjectInfo;
  parameters: ParameterDef[];
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
    piezometricLine,
    projectInfo,
    parameters,
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

  const pf = computePaperFrame(
    width,
    height,
    rvs.paperFrame.paperSize,
    rvs.paperFrame.landscape,
    rvs.paperFrame.zoom ?? 1,
    rvs.paperFrame.offsetX ?? 0,
    rvs.paperFrame.offsetY ?? 0,
  );
  const annoScale = Math.min(pf.w, pf.h) / 600;

  for (const anno of rvs.annotations) {
    const ax = pf.x + anno.x * pf.w;
    const ay = pf.y + anno.y * pf.h;

    if (anno.type === "text") {
      const fontSize = (anno.fontSize ?? 12) * annoScale;
      const family = anno.fontFamily ?? "sans-serif";
      const weight = anno.bold ? "bold" : "normal";
      const style = anno.italic ? "italic" : "normal";
      const resolvedText = resolveAnnotationText({
        text: anno.text ?? "",
        projectInfo,
        result,
        parameters,
      });
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
    } else if (anno.type === "material-table") {
      const { columnKeys, header, rows } = buildMaterialTableData(
        anno,
        materials,
        piezometricLine,
      );
      const { w: tableW, h: tableH } = measureTable(
        ctx,
        columnKeys,
        header,
        rows,
        annoScale,
        anno.fontSize ?? 6,
      );
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
