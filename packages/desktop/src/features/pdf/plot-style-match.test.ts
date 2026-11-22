/**
 * A slice plot with a style (Properties › Plot) is drawn alike by the
 * result view (drawCanvas) and the PDF (drawAnnotations): its series in
 * the same place, color, width and dash, its markers the same shape and
 * size, the axes over the same fixed range with the same tick values, the
 * same texts at the same place and size, and the series clipped to the
 * same chart. Positions are compared in mm on the paper.
 */
import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import type { AnalysisResult, SliceData } from "@cslope/engine";
import { drawAnnotations } from "./pdf-drawing";
import { setSansFont } from "./pdf-fonts";
import { drawCanvas, type DrawCanvasParams } from "../canvas/draw";
import { createRecordingContext, pathPoints, type PaintedPath } from "../../test/recording-context";
import { computePaperFrame, getPaperDimensions } from "../view/paper";
import { BENCHMARK_MODELS } from "../../store/benchmarks";
import { DEFAULT_PIEZO_LINE } from "../../store/defaults";
import type { PaperAnnotation, PlotStyle } from "../../store/types";
import { surfaceYAtX } from "../view/surface";
import { MM_PER_PT, PLOT_LINE_COLOR } from "../rendering/style-spec";

const W = 1200;
const H = (1200 * 210) / 297;
const PAPER = { width: 297, height: 210 };

const slices = [0, 1, 2, 3, 4, 5, 6].map(
  (i) =>
    ({
      x: 10 + i,
      xLeft: 9.5 + i,
      xRight: 10.5 + i,
      width: 1,
      baseLength: 1,
      weight: 50 + 9 * i,
      cohesion: 10,
      frictionAngle: 30,
      normalForce: 40,
      // Shear 20 … 140 kPa: above a fixed top of 100, so the clip matters.
      shearForce: 20 + 20 * i,
      porePressure: 4 * i,
      alpha: 0.2,
    }) as unknown as SliceData,
);
const RESULT = {
  minFOS: 1.2,
  maxFOS: 2,
  criticalSurface: { cx: 30, cy: 30, radius: 25, fos: 1.2, entryPoint: [10, 15], exitPoint: [50, 5], converged: true },
  allSurfaces: [],
  criticalSlices: slices,
  method: "Bishop",
  elapsedMs: 1,
} as unknown as AnalysisResult;

const COLOR = "#cc0000";
const plot = (plotStyle: PlotStyle): PaperAnnotation => ({
  id: "plot",
  type: "plot",
  x: 0.3,
  y: 0.35,
  width: 0.3,
  height: 0.25,
  plotAxisX: "slice",
  plotAxisY: "shearStrength",
  plotStyle,
});

const model = BENCHMARK_MODELS[0];
const mmOfX = (pf: { x: number; w: number }, x: number) => ((x - pf.x) / pf.w) * PAPER.width;
const mmOfY = (pf: { y: number; h: number }, y: number) => ((y - pf.y) / pf.h) * PAPER.height;

/** Text widths in the PDF's embedded sans-serif, at the canvas font's px size. */
function pdfMeasure() {
  const doc = new jsPDF({ unit: "mm", format: [297, 210], orientation: "landscape" });
  return (font: string, text: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
    setSansFont(doc, "normal");
    return doc.getStringUnitWidth(text) * size;
  };
}

function viewOf(anno: PaperAnnotation) {
  const rec = createRecordingContext(W, H);
  const measure = pdfMeasure();
  rec.ctx.measureText = ((text: string) => ({ width: measure(rec.ctx.font, text), actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 })) as never;
  const rvs = model.resultViewSettings!;
  drawCanvas(rec.ctx, canvasParams(anno));
  return measured(rec, rvs);
}

/** The sheet with the one plot, as the result view draws it at zoom 1. */
function canvasParams(anno: PaperAnnotation): DrawCanvasParams {
  const rvs = model.resultViewSettings!;
  return {
    w: W,
    h: H,
    mode: "result",
    result: RESULT,
    resultViewSettings: { ...rvs, annotations: [anno], paperFrame: { ...rvs.paperFrame, zoom: 1, offsetX: 0, offsetY: 0 } },
    orientation: "ltr",
    coordinates: model.coordinates,
    materials: model.materials,
    materialBoundaries: model.materialBoundaries,
    regionMaterials: model.regionMaterials,
    selectedRegionKey: null,
    selectedAnnotationIds: [],
    selectedResultObject: null,
    projectInfo: model.projectInfo!,
    parameters: [],
    analysisLimits: { ...model.analysisLimits, enabled: false },
    udls: [],
    lineLoads: [],
    reinforcements: [],
    piles: [],
    piezometricLine: model.piezometricLine,
    viewScale: 10,
    mouseWorld: null,
    hoverHit: null,
    worldToCanvas: (x: number, y: number, w: number, h: number) => [w / 2 + (x - 30) * 10, h / 2 - (y - 10) * 10],
    canvasToWorld: (x: number, y: number, w: number, h: number) => [(x - w / 2) / 10 + 30, -(y - h / 2) / 10 + 10],
    surfaceYAtX: (x: number) => surfaceYAtX(model.coordinates, x),
  } as unknown as DrawCanvasParams;
}

/** What the canvas drew, in mm on the paper. */
function measured(rec: ReturnType<typeof createRecordingContext>, rvs: NonNullable<typeof model.resultViewSettings>) {
  const pf =computePaperFrame(W, H, rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
  expect(getPaperDimensions(rvs.paperFrame.paperSize, rvs.paperFrame.landscape)).toEqual(PAPER);
  const pxPerMm = pf.w / PAPER.width;
  const toMm = (p: PaintedPath) => pathPoints(p).map(([x, y]) => [mmOfX(pf, x), mmOfY(pf, y)] as [number, number]);
  const series = rec.strokes(COLOR);
  return {
    // The line: the path with more than two points.
    line: series
      .filter((p) => pathPoints(p).length > 2 && p.segments.every((s) => s.op === "moveTo" || s.op === "lineTo") && p.segments.filter((s) => s.op === "moveTo").length === 1)
      .map((p) => ({ points: toMm(p), widthMm: p.state.lineWidth / pxPerMm, dashMm: p.state.lineDash.map((d) => d / pxPerMm) })),
    // The markers: a plus is a path of two segments.
    markers: series.filter((p) => p.segments.filter((s) => s.op === "moveTo").length === 2).map(toMm),
    fills: rec.fills(COLOR).length,
    polygons: [...rec.fills(COLOR), ...series].filter((p) => p.segments.some((s) => s.op === "closePath")).map(toMm),
    clips: rec.paths.filter((p) => p.kind === "clip" && p.segments.length === 1 && p.segments[0].op === "rect").map((p) => {
      const r = p.segments[0] as { x: number; y: number; w: number; h: number };
      return [mmOfX(pf, r.x), mmOfY(pf, r.y), (r.w / pf.w) * PAPER.width, (r.h / pf.h) * PAPER.height];
    }),
    texts: rec.texts.map((t) => ({
      text: t.text,
      x: mmOfX(pf, t.x),
      y: mmOfY(pf, t.y),
      sizeMm: Number(/(\d+(?:\.\d+)?)px/.exec(t.state.font)![1]) / pxPerMm,
    })),
  };
}

function pdfOf(anno: PaperAnnotation) {
  const pdf = new jsPDF({ unit: "mm", format: [PAPER.width, PAPER.height], orientation: "landscape" });
  const lines: { points: [number, number][]; widthMm: number; dashMm: number[]; closed: boolean }[] = [];
  const segments: [number, number, number, number][] = [];
  const texts: { text: string; x: number; y: number; sizeMm: number }[] = [];
  const rects: [number, number, number, number, unknown][] = [];
  let dash: number[] = [];
  let fills = 0;
  const p = pdf as unknown as Record<string, (...a: unknown[]) => unknown>;
  const wrap = (name: string, spy: (...a: unknown[]) => void) => {
    const orig = p[name].bind(pdf);
    p[name] = (...a: unknown[]) => {
      spy(...a);
      return orig(...a);
    };
  };
  const ours = () => pdf.getDrawColor().toLowerCase() === COLOR;
  wrap("setLineDashPattern", (d) => (dash = [...(d as number[])]));
  // jsPDF draws a line with lines(): only the outer call counts.
  let inLine = false;
  const line = p.line.bind(pdf);
  p.line = (...a: unknown[]) => {
    if (ours()) segments.push(a.slice(0, 4) as [number, number, number, number]);
    inLine = true;
    try {
      return line(...a);
    } finally {
      inLine = false;
    }
  };
  wrap("lines", (deltas, x, y, _s, style, closed) => {
    if (inLine || !ours()) return;
    if (style === "F") fills++;
    const pts: [number, number][] = [[x as number, y as number]];
    for (const [dx, dy] of deltas as [number, number][]) {
      const [px, py] = pts[pts.length - 1];
      pts.push([px + dx, py + dy]);
    }
    lines.push({ points: pts, widthMm: pdf.getLineWidth(), dashMm: dash, closed: closed === true });
  });
  wrap("circle", (_x, _y, _r, style) => {
    if (ours() && style === "F") fills++;
  });
  wrap("rect", (x, y, w, h, style) => rects.push([x, y, w, h, style] as [number, number, number, number, unknown]));
  wrap("text", (t, x, y) => texts.push({ text: String(t), x: x as number, y: y as number, sizeMm: pdf.getFontSize() * MM_PER_PT }));
  drawAnnotations(
    pdf,
    { paperW: PAPER.width, paperH: PAPER.height } as never,
    [anno],
    RESULT,
    model.materials,
    DEFAULT_PIEZO_LINE,
    model.projectInfo!,
    [],
    { x: 0, y: 0, w: PAPER.width, h: PAPER.height },
  );
  return { lines, segments, texts, fills, clips: rects.filter((r) => r[4] === null).map((r) => r.slice(0, 4) as number[]) };
}

const close = (a: number, b: number, tol = 0.05) => Math.abs(a - b) < tol;

describe("a slice plot without a style", () => {
  it("draws as it always has: a solid line and filled circles in the plot color, gridlines, both titles and the border", () => {
    const anno: PaperAnnotation = { ...plot({}), plotStyle: undefined };
    const rec = createRecordingContext(W, H);
    drawCanvas(rec.ctx, canvasParams(anno));
    const lines = rec.strokes(PLOT_LINE_COLOR.hex);
    expect(lines).toHaveLength(1);
    expect(lines[0].state.lineDash).toEqual([]);
    expect(pathPoints(lines[0])).toHaveLength(slices.length);
    const dots = rec.fills(PLOT_LINE_COLOR.hex);
    expect(dots).toHaveLength(slices.length);
    expect(dots.every((d) => d.segments[0].op === "arc")).toBe(true);
    expect(rec.paths.some((p) => p.kind === "clip" && p.segments.length === 1 && p.segments[0].op === "rect" && p.segments[0].w < W / 2)).toBe(false);
    expect(rec.textStrings()).toEqual(expect.arrayContaining(["Shear (kPa)", "Slice"]));
    const pdf = pdfOf(anno);
    expect(pdf.clips).toHaveLength(0);
    expect(pdf.texts.map((t) => t.text)).toEqual(expect.arrayContaining(["Shear (kPa)", "Slice"]));
  });
});

describe("a styled slice plot in the view and the PDF", () => {
  const styled = plot({ color: COLOR, line: "dashed", lineWidth: 0.5, marker: "plus", markerSize: 3, yMin: 0, yMax: 100 });

  it("draws the dashed series line in the same place, width, dash and color", () => {
    const view = viewOf(styled);
    const pdf = pdfOf(styled);
    expect(view.line).toHaveLength(1);
    const pdfLine = pdf.lines.filter((l) => !l.closed);
    expect(pdfLine).toHaveLength(1);
    const [v] = view.line;
    const [q] = pdfLine;
    expect(v.points).toHaveLength(slices.length);
    expect(q.points).toHaveLength(slices.length);
    v.points.forEach(([x, y], i) => {
      expect(close(x, q.points[i][0]), `x of point ${i}`).toBe(true);
      expect(close(y, q.points[i][1]), `y of point ${i}`).toBe(true);
    });
    expect(close(v.widthMm, 0.5, 1e-6)).toBe(true);
    expect(q.widthMm).toBe(0.5);
    expect(v.dashMm.map((d) => Math.round(d * 1000) / 1000)).toEqual([3, 1.5]);
    expect(q.dashMm).toEqual([3, 1.5]);
  });

  it("draws plus markers of the same size at the same points, and no filled marker", () => {
    const view = viewOf(styled);
    const pdf = pdfOf(styled);
    expect(view.markers).toHaveLength(slices.length);
    // The PDF's plus: two lines a point, after the series line.
    expect(pdf.segments).toHaveLength(2 * slices.length);
    view.markers.forEach((pts, i) => {
      const [a, b] = [pdf.segments[2 * i], pdf.segments[2 * i + 1]];
      const expected = [[a[0], a[1]], [a[2], a[3]], [b[0], b[1]], [b[2], b[3]]];
      pts.forEach(([x, y], j) => {
        expect(close(x, expected[j][0]) && close(y, expected[j][1]), `marker ${i} end ${j}`).toBe(true);
      });
      // 3 mm across.
      expect(close(expected[1][0] - expected[0][0], 3, 1e-6)).toBe(true);
    });
    expect(view.fills).toBe(0);
    expect(pdf.fills).toBe(0);
  });

  it("puts the axes over the fixed range with the same tick values and texts", () => {
    const view = viewOf(styled);
    const pdf = pdfOf(styled);
    const yValues = ["0", "50", "100"];
    for (const t of yValues) expect(pdf.texts.some((p) => p.text === t)).toBe(true);
    // No tick above the fixed top (the data goes to 140).
    expect(pdf.texts.some((p) => p.text === "150")).toBe(false);
    expect(pdf.texts.length).toBeGreaterThan(8);
    for (const p of pdf.texts) {
      const v = view.texts.find((t) => t.text === p.text && close(t.x, p.x, 0.3) && close(t.y, p.y, 0.3));
      expect(v, `"${p.text}" at ${p.x.toFixed(1)}, ${p.y.toFixed(1)} mm`).toBeDefined();
      expect(close(v!.x, p.x, 0.05), p.text).toBe(true);
      expect(Math.abs(v!.sizeMm - p.sizeMm) / p.sizeMm, p.text).toBeLessThan(0.005);
    }
  });

  it("clips the series to the same chart", () => {
    const view = viewOf(styled);
    const pdf = pdfOf(styled);
    expect(view.clips.length).toBeGreaterThan(0);
    expect(pdf.clips).toHaveLength(1);
    const chart = pdf.clips[0];
    expect(view.clips.some((c) => c.every((v, i) => close(v, chart[i])))).toBe(true);
  });

  it.each<[string, PlotStyle, boolean]>([
    ["filled squares", { marker: "square" }, true],
    ["open triangles", { marker: "triangle", markerOpen: true }, false],
  ])("draws %s at the same corners", (_, style, filled) => {
    const anno = plot({ ...style, color: COLOR, line: "none" });
    const view = viewOf(anno);
    const pdf = pdfOf(anno);
    expect(view.line).toHaveLength(0);
    const polygons = pdf.lines.filter((l) => l.closed);
    expect(polygons).toHaveLength(slices.length);
    expect(pdf.fills).toBe(filled ? slices.length : 0);
    expect(view.fills).toBe(filled ? slices.length : 0);
    expect(view.polygons).toHaveLength(slices.length);
    view.polygons.forEach((pts, i) => {
      expect(pts).toHaveLength(polygons[i].points.length);
      pts.forEach(([x, y], j) => expect(close(x, polygons[i].points[j][0]) && close(y, polygons[i].points[j][1]), `marker ${i} corner ${j}`).toBe(true));
    });
  });

  it("leaves out the title, the axis title and the gridlines alike, with larger text", () => {
    const anno = plot({ showTitle: false, showAxisTitle: false, showGrid: false, showBorder: false, fontSize: 12 });
    const view = viewOf(anno);
    const pdf = pdfOf(anno);
    for (const r of [view, pdf]) {
      expect(r.texts.some((t) => t.text === "Shear (kPa)")).toBe(false);
      expect(r.texts.some((t) => t.text === "Slice")).toBe(false);
    }
    const tick = pdf.texts.find((t) => t.text === "2")!;
    expect(close(tick.sizeMm, (12 * 210) / 600, 1e-6)).toBe(true);
    const v = view.texts.find((t) => t.text === "2" && close(t.x, tick.x, 0.05) && close(t.y, tick.y, 0.05));
    expect(v).toBeDefined();
  });
});
