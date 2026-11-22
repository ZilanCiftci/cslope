/**
 * The result view previews the PDF: the sheet on screen is the PDF page at
 * the screen's zoom. The same sheet drawn by the canvas (drawCanvas) and
 * by the PDF (drawAnnotations) puts the title block, the material table and
 * the color bar in the same place at the same size, as shares of the paper,
 * with the same text colours. The canvas measures its text in the PDF's
 * embedded font here (Arial metrics, as the sheet's sans-serif on screen).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import type { AnalysisResult, SlipSurfaceResult } from "@cslope/engine";
import { VERIFICATION_CASES } from "@cslope/engine/verification";
import { drawAnnotations } from "./pdf-drawing";
import { setSansFont } from "./pdf-fonts";
import { drawCanvas, type DrawCanvasParams } from "../canvas/draw";
import { createRecordingContext, type TextCall } from "../../test/recording-context";
import { computePaperFrame, getPaperDimensions } from "../view/paper";
import { BENCHMARK_MODELS } from "../../store/benchmarks";
import { verificationModel } from "../../store/verification-models";
import { DEFAULT_PIEZO_LINE } from "../../store/defaults";
import type { ModelEntry } from "../../store/types";
import { surfaceYAtX } from "../view/surface";
import { MM_PER_PT, RULER_COLOR } from "../rendering/style-spec";

// The PDF's virtual canvas: the sheet as wide as the PDF lays it out (any size would do).
const W = 1200;
const H = (1200 * 210) / 297;

const SURFACE: SlipSurfaceResult = {
  cx: 30,
  cy: 30,
  radius: 25,
  fos: 1.234,
  entryPoint: [10, 15],
  exitPoint: [50, 5],
  converged: true,
};
const RESULT = {
  minFOS: 1.234,
  maxFOS: 2.1,
  criticalSurface: SURFACE,
  allSurfaces: [SURFACE, { ...SURFACE, fos: 2.1, cy: 34, radius: 29 }],
  criticalSlices: [],
  method: "Bishop",
  elapsedMs: 1,
} as unknown as AnalysisResult;

/** Text widths in the PDF's embedded sans-serif (bold or not), at the canvas font's px size. */
function pdfMeasure() {
  const doc = new jsPDF({ unit: "mm", format: [297, 210], orientation: "landscape" });
  return (font: string, text: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
    setSansFont(doc, /\bbold\b/.test(font) ? "bold" : "normal");
    return doc.getStringUnitWidth(text) * size;
  };
}

/** The sheet as the canvas draws it: its texts as shares of the paper, their font size in mm on the paper. */
function canvasTexts(model: ModelEntry) {
  const rec = createRecordingContext(W, H);
  const measure = pdfMeasure();
  rec.ctx.measureText = ((text: string) => ({ width: measure(rec.ctx.font, text), actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 })) as never;
  const rvs = model.resultViewSettings!;
  const params: DrawCanvasParams = {
    w: W,
    h: H,
    mode: "result",
    result: RESULT,
    resultViewSettings: { ...rvs, paperFrame: { ...rvs.paperFrame, zoom: 1, offsetX: 0, offsetY: 0 } },
    orientation: model.orientation ?? "ltr",
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
    worldToCanvas: (x, y, w, h) => [w / 2 + (x - 30) * 10, h / 2 - (y - 10) * 10],
    canvasToWorld: (x, y, w, h) => [(x - w / 2) / 10 + 30, -(y - h / 2) / 10 + 10],
    surfaceYAtX: (x) => surfaceYAtX(model.coordinates, x),
  };
  drawCanvas(rec.ctx, params);
  const pf = computePaperFrame(W, H, rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
  const paper = getPaperDimensions(rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
  return rec.texts.map((t: TextCall) => ({
    text: t.text,
    x: (t.x - pf.x) / pf.w,
    y: (t.y - pf.y) / pf.h,
    sizeMm: (Number(/(\d+(?:\.\d+)?)px/.exec(t.state.font)![1]) / pf.w) * paper.width,
    color: String(t.state.fillStyle).toLowerCase(),
  }));
}

/** The same sheet's annotations as the PDF draws them. */
function pdfTexts(model: ModelEntry) {
  const rvs = model.resultViewSettings!;
  const paper = getPaperDimensions(rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
  const pdf = new jsPDF({ unit: "mm", format: [paper.width, paper.height], orientation: "landscape" });
  const out: { text: string; x: number; y: number; sizeMm: number; color: string }[] = [];
  const text = pdf.text.bind(pdf);
  pdf.text = ((...args: Parameters<typeof pdf.text>) => {
    const [t, x, y] = args as unknown as [string, number, number];
    out.push({ text: String(t), x: x / paper.width, y: y / paper.height, sizeMm: pdf.getFontSize() * MM_PER_PT, color: pdf.getTextColor().toLowerCase() });
    return text(...args);
  }) as typeof pdf.text;
  drawAnnotations(
    pdf,
    { paperW: paper.width, paperH: paper.height } as never,
    rvs.annotations,
    RESULT,
    model.materials,
    model.piezometricLine ?? DEFAULT_PIEZO_LINE,
    model.projectInfo!,
    [],
    { x: 0, y: 0, w: paper.width, h: paper.height },
  );
  return out;
}

const benchmark = (id: string) => {
  const c = VERIFICATION_CASES.find((v) => v.id === id)!;
  return verificationModel(c, undefined, `${c.id} ${c.title}`, { titleBlock: true });
};
/** A user's model: the first example, with its title block and material table, and a color bar. */
const userModel = (): ModelEntry => {
  const m = BENCHMARK_MODELS[0];
  const rvs = m.resultViewSettings!;
  return {
    ...m,
    resultViewSettings: { ...rvs, annotations: [...rvs.annotations, { id: "bar", type: "color-bar", x: 0.94, y: 0.3, anchor: "top-right" }] },
  };
};

const MODELS: [string, () => ModelEntry][] = [
  ["V002", () => benchmark("V002")],
  ["V038b", () => benchmark("V038b")],
  ["V085", () => benchmark("V085")],
  ["a user's model with a table and a color bar", userModel],
];

describe("the result view and the PDF draw the sheet alike", () => {
  it.each(MODELS)("%s: the title block, the material table and the color bar in the same place and size", (_, make) => {
    const model = make();
    const view = canvasTexts(model);
    const pdf = pdfTexts(model);
    expect(pdf.length).toBeGreaterThan(5);
    const tables = model.resultViewSettings!.annotations.filter((a) => a.type === "material-table");
    expect(tables.length).toBeGreaterThan(0);
    // Every text the PDF writes for the annotations, at the same place and size on the canvas.
    for (const p of pdf) {
      const v = view.find((t) => t.text === p.text && Math.abs(t.x - p.x) < 0.01 && Math.abs(t.y - p.y) < 0.02);
      expect(v, `"${p.text}" at ${p.x.toFixed(3)}, ${p.y.toFixed(3)}`).toBeDefined();
      // Within 0.1 % of the paper; the baselines differ where the PDF writes on the middle or top of a line.
      expect(Math.abs(v!.x - p.x), p.text).toBeLessThan(0.001);
      expect(Math.abs(v!.sizeMm - p.sizeMm) / p.sizeMm, p.text).toBeLessThan(0.005);
    }
  });

  it.each(MODELS)("%s: the material table's and the color bar's text in the same colours", (_, make) => {
    const model = make();
    const view = canvasTexts(model);
    const pdf = pdfTexts(model);
    const body = model.materials[0].name;
    expect(view.find((t) => t.text === body)!.color).toBe(pdf.find((t) => t.text === body)!.color);
    expect(view.find((t) => t.text === "Name")!.color).toBe(pdf.find((t) => t.text === "Name")!.color);
    if (model.resultViewSettings!.annotations.some((a) => a.type === "color-bar")) {
      expect(view.find((t) => t.text === "F")!.color).toBe(pdf.find((t) => t.text === "F")!.color);
    }
  });
});

describe("the sheet's tick labels", () => {
  afterEach(() => document.documentElement.style.removeProperty("--color-canvas-paper-ticks"));

  it("are the PDF's dark grey in the light theme", () => {
    // The light theme's token (index.css), as the canvas reads it.
    const css = readFileSync(join(__dirname, "../../index.css"), "utf-8");
    const light = css.split("}").find((block) => /--color-canvas-paper:\s*#ffffff/.test(block))!;
    const tick = /--color-canvas-paper-ticks:\s*(#[0-9a-f]{6})/i.exec(light)![1];
    expect(tick.toLowerCase()).toBe(RULER_COLOR.hex);
    document.documentElement.style.setProperty("--color-canvas-paper-ticks", tick);
    // The numbers in the margin, outside the plot frame (PLOT_MARGINS).
    const labels = canvasTexts(userModel()).filter((t) => /^-?\d+$/.test(t.text) && (t.x < 0.05 || t.y > 0.95));
    expect(labels.length).toBeGreaterThan(4);
    for (const l of labels) expect(l.color).toBe(RULER_COLOR.hex);
  });
});
