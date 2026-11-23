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
import { drawAnnotations, drawCriticalSurface, drawGrid, drawRulerFrame, drawSlipSurfaces } from "./pdf-drawing";
import { drawReferenceLinesPdf } from "./pdf-reference";
import { setSansFont } from "./pdf-fonts";
import { drawCanvas, type DrawCanvasParams } from "../canvas/draw";
import { createRecordingContext, type TextCall } from "../../test/recording-context";
import { computePaperFrame, getPaperDimensions } from "../view/paper";
import { BENCHMARK_MODELS } from "../../store/benchmarks";
import { verificationModel } from "../../store/verification-models";
import { DEFAULT_PIEZO_LINE, PLOT_MARGINS } from "../../store/defaults";
import type { ModelEntry, PaperSize, ResultLayerStyles } from "../../store/types";
import { surfaceYAtX } from "../view/surface";
import {
  CENTER_DOT_RADIUS_PX,
  CRITICAL_SURFACE_LINE_WIDTH_PX,
  GRID_COLOR,
  MM_PER_PT,
  RULER_COLOR,
  SLIP_SURFACE_LINE_WIDTH_PX,
  STYLE_PX_PER_MM,
} from "../rendering/style-spec";
import { REFERENCE_DEFAULT_WIDTH } from "../annotations/reference";
import { hexRgb } from "../results/layer-styles";

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

/** The sheet as the canvas draws it (a recording). */
function drawSheet(model: ModelEntry) {
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
  return rec;
}

/** The sheet as the canvas draws it: its texts as shares of the paper, their font size in mm on the paper. */
function canvasTexts(model: ModelEntry) {
  const rec = drawSheet(model);
  const rvs = model.resultViewSettings!;
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

/** The PDF's transform of the same sheet (the canvas's view on the PDF's page). */
function pdfSheet(model: ModelEntry) {
  const rvs = model.resultViewSettings!;
  const paper = getPaperDimensions(rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
  const pf = computePaperFrame(W, H, rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
  const mmPerPx = paper.width / pf.w;
  const canvasToPdf = (cx: number, cy: number): [number, number] => [(cx - pf.x) * mmPerPx, (cy - pf.y) * mmPerPx];
  const tf = {
    canvasToPdf,
    worldToPdf: (x: number, y: number) => canvasToPdf(W / 2 + (x - 30) * 10, H / 2 - (y - 10) * 10),
    mmPerPx,
    paperW: paper.width,
    paperH: paper.height,
  };
  const frame = {
    x: paper.width * PLOT_MARGINS.L,
    y: paper.height * PLOT_MARGINS.T,
    w: paper.width * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R),
    h: paper.height * (1 - PLOT_MARGINS.T - PLOT_MARGINS.B),
  };
  const pdf = new jsPDF({ unit: "mm", format: [paper.width, paper.height], orientation: "landscape" });
  return { pdf, tf, frame, paper, rvs };
}

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

describe("the sheet's grid", () => {
  /** The model with its grid on: a fixed spacing, minor lines, a style of the user's (or the default). */
  const gridModel = (styled: boolean): ModelEntry => {
    const m = userModel();
    return {
      ...m,
      resultViewSettings: {
        ...m.resultViewSettings!,
        showGrid: true,
        gridSpacing: undefined,
        gridLineSpacing: 3,
        layerStyles: { grid: styled ? { color: "#336699", width: 2, subdivisions: 4, minorWidth: 0.8 } : { subdivisions: 4 } },
      },
    };
  };
  type Line = { at: number; vertical: boolean; widthMm: number; color: string };
  const key = (l: Line) => `${l.vertical ? "x" : "y"}${l.at.toFixed(4)}`;

  /** The canvas's grid lines (stroked in `color`): place as a share of the paper, width in mm. */
  function viewLines(model: ModelEntry, color: string): Line[] {
    const rec = drawSheet(model);
    const rvs = model.resultViewSettings!;
    const pf = computePaperFrame(W, H, rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
    const paper = getPaperDimensions(rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
    const out: Line[] = [];
    for (const p of rec.strokes()) {
      if (String(p.state.strokeStyle).toLowerCase() !== color) continue;
      for (let i = 0; i + 1 < p.segments.length; i += 2) {
        const [a, b] = [p.segments[i], p.segments[i + 1]] as { x: number; y: number }[];
        const vertical = Math.abs(a.x - b.x) < 1e-9;
        out.push({
          at: vertical ? (a.x - pf.x) / pf.w : (a.y - pf.y) / pf.h,
          vertical,
          widthMm: (p.state.lineWidth / pf.w) * paper.width,
          color,
        });
      }
    }
    return out;
  }

  function pdfLines(model: ModelEntry): Line[] {
    const { pdf, tf, frame, paper, rvs } = pdfSheet(model);
    const out: Line[] = [];
    let width = 0;
    const setLineWidth = pdf.setLineWidth.bind(pdf);
    pdf.setLineWidth = ((w: number) => {
      width = w;
      return setLineWidth(w);
    });
    pdf.line = ((x1: number, y1: number, x2: number) => {
      const vertical = Math.abs(x1 - x2) < 1e-9;
      out.push({ at: vertical ? x1 / paper.width : y1 / paper.height, vertical, widthMm: width, color: pdf.getDrawColor().toLowerCase() });
      return pdf;
    });
    drawGrid(pdf, tf, 10, frame, rvs.gridSpacing, rvs.gridLineSpacing, rvs.layerStyles?.grid);
    return out;
  }

  it.each([
    ["a style of the user's", true, "#336699"],
    ["the default style", false, GRID_COLOR.hex],
  ])("%s: the same lines, minor lines, widths and color in the view and the PDF", (_, styled, color) => {
    const model = gridModel(styled);
    const view = viewLines(model, color);
    const pdf = pdfLines(model);
    expect(pdf.length).toBeGreaterThan(40);
    // (jsPDF writes a grey as a grey level: #dcdcdc reads back as #dbdbdb)
    const near = (c: string) => hexRgb(c).every((v, i) => Math.abs(v - hexRgb(color)[i]) <= 1);
    expect(pdf.every((l) => near(l.color))).toBe(true);
    // Two widths: the major and the minor lines.
    const widths = [...new Set(pdf.map((l) => l.widthMm.toFixed(4)))].sort();
    expect(widths).toEqual(styled ? ["0.0800", "0.2000"] : ["0.0500", "0.1000"]);
    expect(view.length).toBe(pdf.length);
    const byKey = new Map(view.map((l) => [key(l), l]));
    for (const p of pdf) {
      const v = byKey.get(key(p));
      expect(v, key(p)).toBeDefined();
      expect(v!.widthMm).toBeCloseTo(p.widthMm, 6);
    }
  });

  it("puts every labelled tick on a grid line when the grid has a fixed spacing", () => {
    const model = gridModel(false);
    const { pdf, tf, frame, paper, rvs } = pdfSheet(model);
    const labels: { text: string; x: number }[] = [];
    const text = pdf.text.bind(pdf);
    pdf.text = ((...args: Parameters<typeof pdf.text>) => {
      const [t, x, y] = args as unknown as [string, number, number];
      if (y > frame.y + frame.h) labels.push({ text: String(t), x: x / paper.width });
      return text(...args);
    }) as typeof pdf.text;
    drawRulerFrame(pdf, tf, 10, frame, rvs.gridSpacing, 0, rvs.gridLineSpacing);
    expect(labels.length).toBeGreaterThan(3);
    // Multiples of the grid spacing (3 m) ...
    for (const l of labels) expect(Math.abs(Number(l.text) % 3)).toBe(0);
    // ... on the PDF's major grid lines, and the view's labels the same.
    const majors = pdfLines(model).filter((l) => l.vertical && l.widthMm > 0.06);
    for (const l of labels) expect(majors.some((m) => Math.abs(m.at - l.x) < 1e-6), l.text).toBe(true);
    const viewLabels = canvasTexts(model)
      .filter((t) => /^-?\d+$/.test(t.text) && t.y > 0.95)
      .map((t) => t.text);
    expect(viewLabels).toEqual(labels.map((l) => l.text));
  });
});

describe("the sheet's frame", () => {
  /** The user's model with ticks every 5 m, 4 minor ticks between, the grid off, the frame in `style` (or off). */
  const frameModel = (style?: ResultLayerStyles["frame"], showFrame = true): ModelEntry => {
    const m = userModel();
    const rvs = m.resultViewSettings!;
    return {
      ...m,
      resultViewSettings: {
        ...rvs,
        showGrid: false,
        gridSpacing: 5,
        minorTicks: 4,
        paperFrame: { ...rvs.paperFrame, showFrame },
        layerStyles: style ? { frame: style } : undefined,
      },
    };
  };
  type Rect = { x: number; y: number; w: number; h: number; widthMm: number; color: string };
  type Tick = { x: number; y: number; lengthMm: number; widthMm: number };
  type Label = { text: string; x: number; y: number; sizeMm: number; color: string };
  /** In the margin, outside the plot frame (as shares of the paper). */
  const inMargin = (x: number, y: number) => x < PLOT_MARGINS.L - 1e-6 || y > 1 - PLOT_MARGINS.B + 1e-6;

  /** The frame as the canvas draws it: the plot frame, the ticks and the labels, as shares of the paper and mm. */
  function viewFrame(model: ModelEntry) {
    const rec = drawSheet(model);
    const rvs = model.resultViewSettings!;
    const pf = computePaperFrame(W, H, rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
    const paper = getPaperDimensions(rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
    const mm = (px: number) => (px / pf.w) * paper.width;
    const rects: Rect[] = rec.calls
      .filter((c) => c.name === "strokeRect")
      .map((c) => {
        const [x, y, w, h] = c.args as number[];
        return { x: (x - pf.x) / pf.w, y: (y - pf.y) / pf.h, w: w / pf.w, h: h / pf.h, widthMm: mm(c.state.lineWidth), color: String(c.state.strokeStyle).toLowerCase() };
      })
      .filter((r) => Math.abs(r.x - PLOT_MARGINS.L) < 1e-6);
    const ticks: Tick[] = rec
      .strokes()
      .flatMap((p) => {
        const pts = p.segments.filter((g): g is { op: "moveTo" | "lineTo"; x: number; y: number } => "x" in g);
        if (pts.length !== 2) return [];
        const [a, b] = pts;
        const x = (b.x - pf.x) / pf.w;
        const y = (b.y - pf.y) / pf.h;
        return inMargin(x, y) ? [{ x, y, lengthMm: mm(Math.hypot(b.x - a.x, b.y - a.y)), widthMm: mm(p.state.lineWidth) }] : [];
      });
    const labels: Label[] = canvasTexts(model).filter((t) => /^-?\d+$/.test(t.text) && inMargin(t.x, t.y));
    return { rects, ticks, labels };
  }

  /** The same frame as the PDF draws it. */
  function pdfFrame(model: ModelEntry) {
    const { pdf, tf, frame, paper, rvs } = pdfSheet(model);
    let width = 0;
    const setLineWidth = pdf.setLineWidth.bind(pdf);
    pdf.setLineWidth = (w: number) => {
      width = w;
      return setLineWidth(w);
    };
    const rects: Rect[] = [];
    const ticks: Tick[] = [];
    const labels: Label[] = [];
    pdf.rect = ((x: number, y: number, w: number, h: number) => {
      rects.push({ x: x / paper.width, y: y / paper.height, w: w / paper.width, h: h / paper.height, widthMm: width, color: pdf.getDrawColor().toLowerCase() });
      return pdf;
    });
    pdf.line = (x1: number, y1: number, x2: number, y2: number) => {
      ticks.push({ x: x2 / paper.width, y: y2 / paper.height, lengthMm: Math.hypot(x2 - x1, y2 - y1), widthMm: width });
      return pdf;
    };
    const text = pdf.text.bind(pdf);
    pdf.text = ((...args: Parameters<typeof pdf.text>) => {
      const [t, x, y] = args as unknown as [string, number, number];
      labels.push({ text: String(t), x: x / paper.width, y: y / paper.height, sizeMm: pdf.getFontSize() * MM_PER_PT, color: pdf.getTextColor().toLowerCase() });
      return text(...args);
    }) as typeof pdf.text;
    drawRulerFrame(pdf, tf, 10, frame, rvs.gridSpacing, rvs.minorTicks, rvs.gridLineSpacing, rvs.layerStyles?.frame);
    return { rects, ticks, labels };
  }

  it.each([
    ["the default style", undefined],
    ["a style of the user's (color, 8 px, 12 pt labels)", { color: "#cc0000", width: 8, fontSize: 12 }],
    ["a style without tick labels", { labels: false }],
  ] as [string, ResultLayerStyles["frame"]][])("%s: the same plot frame, ticks and labels in the view and the PDF", (_, style) => {
    const model = frameModel(style);
    const view = viewFrame(model);
    const pdf = pdfFrame(model);
    // The plot frame: one, in the same place, as wide.
    expect(pdf.rects).toHaveLength(1);
    expect(view.rects).toHaveLength(1);
    for (const k of ["x", "y", "w", "h"] as const) expect(view.rects[0][k]).toBeCloseTo(pdf.rects[0][k], 6);
    expect(view.rects[0].widthMm).toBeCloseTo(style?.width ? style.width / 10 : 0.4, 6);
    expect(pdf.rects[0].widthMm).toBeCloseTo(view.rects[0].widthMm, 6);
    // The ticks: the same, major (2 mm) and minor (1 mm).
    expect(pdf.ticks.length).toBeGreaterThan(20);
    expect(view.ticks).toHaveLength(pdf.ticks.length);
    const tickKey = (t: Tick) => `${t.x.toFixed(4)},${t.y.toFixed(4)},${t.lengthMm.toFixed(3)},${t.widthMm.toFixed(3)}`;
    expect(view.ticks.map(tickKey).sort()).toEqual(pdf.ticks.map(tickKey).sort());
    // The labels: the same text, place, size and color.
    if (style?.labels === false) {
      expect(pdf.labels).toHaveLength(0);
      expect(view.labels).toHaveLength(0);
      return;
    }
    expect(pdf.labels.length).toBeGreaterThan(4);
    expect(view.labels.map((l) => l.text)).toEqual(pdf.labels.map((l) => l.text));
    view.labels.forEach((v, i) => {
      const p = pdf.labels[i];
      expect(Math.abs(v.x - p.x), v.text).toBeLessThan(0.001);
      expect(Math.abs(v.y - p.y), v.text).toBeLessThan(0.001);
      expect(v.sizeMm).toBeCloseTo((style?.fontSize ?? 9) * MM_PER_PT, 6);
      expect(p.sizeMm).toBeCloseTo(v.sizeMm, 6);
    });
    if (style?.color) {
      expect(view.rects[0].color).toBe(style.color);
      expect(pdf.rects[0].color).toBe(style.color);
      for (const l of [...view.labels, ...pdf.labels]) expect(l.color).toBe(style.color);
    }
  });

  it("is not drawn when it is off: no plot frame, ticks or labels in the view (the PDF: pdf-layer-order.test.ts)", () => {
    const view = viewFrame(frameModel({ color: "#cc0000" }, false));
    expect(view.rects).toHaveLength(0);
    expect(view.ticks).toHaveLength(0);
    expect(view.labels).toHaveLength(0);
  });
});

describe("the result layers' line widths and the center's dot", () => {
  const REFERENCE_COLOR = "#123456";
  /** The user's model on `paperSize` with every surface, the center and a reference line, in `styles` (or the defaults). */
  const layersModel = (paperSize: PaperSize, styles?: ResultLayerStyles, referenceWidth?: number): ModelEntry => {
    const m = userModel();
    const rvs = m.resultViewSettings!;
    return {
      ...m,
      resultViewSettings: {
        ...rvs,
        annotations: [
          {
            id: "ref",
            type: "reference",
            shape: "polyline",
            points: [
              [12, 2],
              [30, 6],
              [44, 4],
            ],
            color: REFERENCE_COLOR,
            ...(referenceWidth === undefined ? {} : { width: referenceWidth }),
          },
        ],
        paperFrame: { ...rvs.paperFrame, paperSize },
        surfaceDisplay: "all",
        showCentreMarker: true,
        showSlices: false,
        showFosLabel: false,
        layerStyles: styles,
      },
    };
  };
  type Widths = { critical: number; other: number; reference: number; dot: number };

  /** The widths (mm on the paper) the view draws. */
  function viewWidths(model: ModelEntry): Widths {
    const rec = drawSheet(model);
    const rvs = model.resultViewSettings!;
    const pf = computePaperFrame(W, H, rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
    const paper = getPaperDimensions(rvs.paperFrame.paperSize, rvs.paperFrame.landscape);
    const mm = (px: number) => (px / pf.w) * paper.width;
    const arcs = rec.strokes().filter((p) => p.segments.length > 20);
    const critical = arcs.filter((p) => p.state.globalAlpha === 1);
    const other = arcs.filter((p) => p.state.globalAlpha < 1);
    expect(critical).toHaveLength(1);
    expect(other).toHaveLength(1);
    const reference = rec.strokes(REFERENCE_COLOR);
    expect(reference).toHaveLength(1);
    const dot = rec.fills().find((p) => p.segments[0]?.op === "arc")!;
    expect(dot).toBeDefined();
    return {
      critical: mm(critical[0].state.lineWidth),
      other: mm(other[0].state.lineWidth),
      reference: mm(reference[0].state.lineWidth),
      dot: mm((dot.segments[0] as { r: number }).r),
    };
  }

  /** The same widths as the PDF prints them (mm). */
  function pdfWidths(model: ModelEntry): Widths {
    const { pdf, tf, rvs } = pdfSheet(model);
    const widths: number[] = [];
    const setLineWidth = pdf.setLineWidth.bind(pdf);
    pdf.setLineWidth = (w: number) => {
      widths.push(w);
      return setLineWidth(w);
    };
    const radii: number[] = [];
    const circle = pdf.circle.bind(pdf);
    pdf.circle = (x: number, y: number, r: number, style?: string | null) => {
      radii.push(r);
      return circle(x, y, r, style);
    };
    drawSlipSurfaces(pdf, tf, RESULT, rvs);
    const other = widths.at(-1)!;
    drawCriticalSurface(pdf, tf, RESULT, rvs, model.coordinates, {}, { fosLabel: false });
    // The surface's line, then the center's radius lines.
    const critical = widths.at(-2)!;
    drawReferenceLinesPdf(pdf, tf, rvs.annotations, model.coordinates);
    expect(radii).toHaveLength(1);
    return { critical, other, reference: widths.at(-1)!, dot: radii[0] };
  }

  const mm = (px: number) => px / STYLE_PX_PER_MM;
  it.each([
    ["A4", undefined, undefined],
    ["A1", undefined, undefined],
    ["A3", { criticalSurface: { width: 6 }, surfaces: { width: 3 }, center: { size: 12 } }, 7],
  ] as [PaperSize, ResultLayerStyles | undefined, number | undefined][])(
    "%s, %j: as wide in the view as in the PDF, 1 px = 0.1 mm whatever the paper",
    (paperSize, styles, referenceWidth) => {
      const model = layersModel(paperSize, styles, referenceWidth);
      const view = viewWidths(model);
      const pdf = pdfWidths(model);
      const expected: Widths = {
        critical: mm(styles?.criticalSurface?.width ?? CRITICAL_SURFACE_LINE_WIDTH_PX),
        other: mm(styles?.surfaces?.width ?? SLIP_SURFACE_LINE_WIDTH_PX),
        reference: mm(referenceWidth ?? REFERENCE_DEFAULT_WIDTH),
        dot: mm(styles?.center?.size ?? CENTER_DOT_RADIUS_PX),
      };
      for (const k of ["critical", "other", "reference", "dot"] as const) {
        expect(pdf[k], `PDF ${k}`).toBeCloseTo(expected[k], 9);
        expect(view[k], `view ${k}`).toBeCloseTo(expected[k], 6);
      }
    },
  );
});
