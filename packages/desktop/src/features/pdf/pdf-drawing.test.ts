import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import type { AnalysisResult, SliceData, SlipSurfaceResult } from "@cslope/engine";
import {
  drawAnnotations,
  drawClosedPolyline,
  drawCriticalSurface,
  drawEntryExitMarkers,
  drawGrid,
  drawLineLoads,
  drawMaterialRegions,
  drawOpenPolyline,
  drawPiezometricLines,
  drawPilesPdf,
  drawReinforcementForcesPdf,
  drawReinforcementsPdf,
  drawRulerFrame,
  drawSlipSurfaces,
  drawUdlLoads,
} from "./pdf-drawing";
import type { PdfTransform } from "./pdf-helpers";
import { DEFAULT_MATERIAL, DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";
import type { Annotation, MaterialRow, ResultViewSettings } from "../../store/types";
import { newPile, newReinforcement } from "../../utils/reinforcement";
import { fosColor } from "../../utils/fos-color";
import { parseColor } from "./pdf-helpers";
import {
  ENTRY_DOT_COLOR,
  EXIT_DOT_COLOR,
  LINE_LOAD_COLOR,
  PIEZO_COLOR,
  POND_ARROW_WIDTH_PX,
  UDL_LOAD_COLOR,
} from "../rendering/style-spec";

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];

/** 5 mm per metre, origin at (20, 150) mm; 0.25 mm per logical px. */
const tf: PdfTransform = {
  worldToPdf: (x, y) => [20 + x * 5, 150 - y * 5],
  canvasToPdf: (x, y) => [x * 0.25, y * 0.25],
  mmPerPx: 0.25,
  paperW: 297,
  paperH: 210,
};
const VIEW_SCALE = 5 / 0.25; // px per metre that matches tf

type Call = { name: string; args: unknown[] };

const RECORDED = [
  "line",
  "text",
  "triangle",
  "circle",
  "rect",
  "setDrawColor",
  "setFillColor",
  "setTextColor",
  "setLineWidth",
  "setLineDashPattern",
  "saveGraphicsState",
  "restoreGraphicsState",
  "setGState",
  "clip",
  "moveTo",
  "lineTo",
  "stroke",
  "fill",
  "fillEvenOdd",
] as const;

function recorder() {
  const pdf = new jsPDF({ unit: "mm", format: [297, 210], orientation: "landscape" });
  const calls: Call[] = [];
  let depth = 0;
  let minDepth = 0;
  for (const name of RECORDED) {
    const original = (pdf as unknown as Record<string, (...a: unknown[]) => unknown>)[name].bind(pdf);
    (pdf as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls.push({ name, args });
      if (name === "saveGraphicsState") depth++;
      if (name === "restoreGraphicsState") {
        depth--;
        minDepth = Math.min(minDepth, depth);
      }
      return original(...args);
    };
  }
  const of = (name: string) => calls.filter((c) => c.name === name);
  /** q/Q operators actually written to the page content stream. */
  const streamOps = () => {
    const page = (pdf.internal as unknown as { pages: string[][] }).pages[1];
    const tokens = page.flatMap((s) => String(s).split(/\s+/));
    return { q: tokens.filter((t) => t === "q").length, Q: tokens.filter((t) => t === "Q").length };
  };
  /** Call log since the last colour change, so tests can find e.g. lines drawn in a colour. */
  const linesIn = (rgb: readonly number[]) => {
    const out: number[][] = [];
    let current: unknown[] = [];
    for (const c of calls) {
      if (c.name === "setDrawColor") current = c.args;
      if (c.name === "line" && rgb.every((v, i) => current[i] === v)) out.push(c.args as number[]);
    }
    return out;
  };
  const texts = () => of("text").map((c) => String(c.args[0]));
  return {
    pdf,
    calls,
    of,
    texts,
    linesIn,
    streamOps,
    balanced() {
      const { q, Q } = streamOps();
      return depth === 0 && minDepth === 0 && q === Q;
    },
  };
}

const CIRCLE = { cx: 15, cy: 14 };
const R = Math.hypot(22 - CIRCLE.cx, 5 - CIRCLE.cy);
const ENTRY_X = CIRCLE.cx - Math.sqrt(R * R - (10 - CIRCLE.cy) ** 2);

function surface(over: Partial<SlipSurfaceResult> = {}): SlipSurfaceResult {
  return {
    cx: CIRCLE.cx,
    cy: CIRCLE.cy,
    radius: R,
    fos: 1.234,
    entryPoint: [ENTRY_X, 10],
    exitPoint: [22, 5],
    ...over,
  };
}

const slice = (xLeft: number, xRight: number, extra: Partial<SliceData> = {}) =>
  ({
    x: (xLeft + xRight) / 2,
    xLeft,
    xRight,
    width: xRight - xLeft,
    baseLength: xRight - xLeft,
    weight: 50,
    cohesion: 10,
    frictionAngle: 0,
    normalForce: 40,
    porePressure: 0,
    ...extra,
  }) as SliceData;

function result(over: Partial<AnalysisResult> = {}): AnalysisResult {
  const cs = surface();
  return {
    minFOS: 1.234,
    maxFOS: 1.8,
    criticalSurface: cs,
    allSurfaces: [cs],
    criticalSlices: [],
    method: "Bishop",
    elapsedMs: 1,
    ...over,
  } as AnalysisResult;
}

const rvs = (over: Partial<ResultViewSettings> = {}): ResultViewSettings => ({
  ...DEFAULT_RESULT_VIEW_SETTINGS,
  annotations: [],
  showSlices: false,
  showFosLabel: false,
  showCentreMarker: false,
  ...over,
});

const PIEZO_EMPTY = { enabled: false, lines: [], activeLineId: null, materialAssignment: {} };
const FRAME = { x: 0, y: 0, w: 297, h: 210 };

describe("drawGrid", () => {
  it("draws grid lines at round world steps inside the clip and the axes through the origin", () => {
    const rec = recorder();
    const clip = { x: 10, y: 10, w: 200, h: 150 };
    drawGrid(rec.pdf, tf, VIEW_SCALE, clip, 5);
    const grid = rec.linesIn([220, 220, 220]);
    const vertical = grid.filter(([x1, , x2]) => x1 === x2);
    expect(vertical.length).toBeGreaterThan(3);
    for (const [x, y1, , y2] of vertical) {
      const wx = (x - 20) / 5;
      expect(wx % 5).toBeCloseTo(0, 9);
      expect([y1, y2]).toEqual([10, 160]);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(210);
    }
    const axes = rec.linesIn([180, 180, 180]);
    expect(axes).toEqual([
      [20, 10, 20, 160],
      [10, 150, 210, 150],
    ]);
  });

  it("omits axes outside the clip", () => {
    const rec = recorder();
    drawGrid(rec.pdf, tf, VIEW_SCALE, { x: 50, y: 10, w: 100, h: 100 });
    expect(rec.linesIn([180, 180, 180])).toHaveLength(0);
  });
});

describe("grid and ruler share one spacing", () => {
  it("draws a grid line at every labelled tick", () => {
    const frame = { x: 15, y: 10, w: 267, h: 190 };
    for (const mmPerM of [1.5, 2.5, 4, 5, 9]) {
      const t: PdfTransform = { ...tf, worldToPdf: (x, y) => [20 + x * mmPerM, 150 - y * mmPerM] };
      const scale = mmPerM / t.mmPerPx;
      const rec = recorder();
      drawGrid(rec.pdf, t, scale, frame);
      drawRulerFrame(rec.pdf, t, scale, frame);
      const gridX = rec
        .linesIn([220, 220, 220])
        .filter(([x1, , x2]) => x1 === x2)
        .map(([x]) => x);
      const tickX = rec
        .of("text")
        .filter((c) => (c.args[3] as { align: string }).align === "center")
        .map((c) => c.args[1] as number);
      expect(tickX.length, `${mmPerM} mm/m`).toBeGreaterThan(1);
      for (const x of tickX) {
        expect(gridX.some((g) => Math.abs(g - x) < 1e-6), `tick at ${x} mm, ${mmPerM} mm/m`).toBe(true);
      }
    }
  });
});

describe("drawRulerFrame", () => {
  it("labels ticks at their world values below and left of the frame, with minor ticks", () => {
    const rec = recorder();
    const frame = { x: 20, y: 20, w: 200, h: 130 };
    drawRulerFrame(rec.pdf, tf, VIEW_SCALE, frame, 10, 1);
    const xLabels = rec.of("text").filter((c) => (c.args[3] as { align: string }).align === "center");
    expect(xLabels.map((c) => c.args[0])).toEqual(["0", "10", "20", "30", "40"]);
    for (const c of xLabels) expect(c.args[1]).toBeCloseTo(20 + Number(c.args[0]) * 5, 9);
    const yLabels = rec.of("text").filter((c) => (c.args[3] as { align: string }).align === "right");
    expect(yLabels.map((c) => c.args[0])).toEqual(["0", "10", "20"]);
    // Minor ticks (1 mm) halfway between the majors (2 mm).
    const bottomTicks = rec
      .of("line")
      .map((c) => c.args as number[])
      .filter(([x1, y1, x2]) => x1 === x2 && y1 === 150);
    const minor = bottomTicks.filter(([, y1, , y2]) => y2 - y1 === 1);
    expect(minor.map(([x]) => (x - 20) / 5)).toEqual([5, 15, 25, 35]);
    // Frame border last.
    expect(rec.of("rect").at(-1)!.args).toEqual([20, 20, 200, 130, "S"]);
  });
});

describe("drawMaterialRegions", () => {
  const hs = { ...DEFAULT_MATERIAL, id: "hs", model: { kind: "high-strength", unitWeight: 20 } } as MaterialRow;

  it("fills each region in its material colour inside a balanced clip", () => {
    const rec = recorder();
    drawMaterialRegions(rec.pdf, tf, COORDS, [DEFAULT_MATERIAL], [], []);
    expect(rec.balanced()).toBe(true);
    expect(rec.of("setFillColor")[0].args).toEqual(parseColor(DEFAULT_MATERIAL.color));
    expect(rec.of("fill")).toHaveLength(1);
    expect(rec.of("clip")).toHaveLength(1);
  });

  it("skips the colour fill when soil colours are off but keeps the borders", () => {
    const rec = recorder();
    drawMaterialRegions(rec.pdf, tf, COORDS, [DEFAULT_MATERIAL], [], [], false);
    expect(rec.of("fill")).toHaveLength(0);
    expect(rec.of("stroke")).toHaveLength(1);
  });

  it("hatches special materials at reduced opacity, labels them and stays balanced", () => {
    const rec = recorder();
    drawMaterialRegions(rec.pdf, tf, COORDS, [hs], [], []);
    expect(rec.balanced()).toBe(true);
    expect(rec.of("setGState")).toHaveLength(1);
    expect(rec.texts()).toContain("HS");
    expect(rec.linesIn([85, 85, 85]).length).toBeGreaterThan(10);
    // The label is drawn after the hatch clip and opacity are both restored.
    const labelAt = rec.calls.findIndex((c) => c.name === "text");
    const restoresBefore = rec.calls.slice(0, labelAt).filter((c) => c.name === "restoreGraphicsState").length;
    expect(restoresBefore).toBe(2);
  });

  it("fills a region with a hole even-odd", () => {
    const rec = recorder();
    const clay = { ...DEFAULT_MATERIAL, id: "clay", color: "#00ff00" };
    drawMaterialRegions(
      rec.pdf,
      tf,
      COORDS,
      [DEFAULT_MATERIAL, clay],
      [
        {
          id: "lens",
          coordinates: [
            [5, 3],
            [8, 3],
            [8, 6],
            [5, 6],
            [5, 3],
          ],
        },
      ],
      [{ point: [6.5, 4.5], materialId: "clay" }],
    );
    expect(rec.balanced()).toBe(true);
    expect(rec.of("fillEvenOdd")).toHaveLength(1);
    expect(rec.of("fill")).toHaveLength(1);
  });
});

describe("polylines", () => {
  it("strokes closed and open polylines through the transformed points", () => {
    const rec = recorder();
    drawClosedPolyline(rec.pdf, tf, COORDS, [1, 2, 3], 0.3);
    drawOpenPolyline(rec.pdf, tf, COORDS.slice(0, 2), [4, 5, 6], 0.2);
    expect(rec.of("moveTo").map((c) => c.args)).toEqual([
      [20, 150],
      [20, 150],
    ]);
    expect(rec.of("lineTo")).toHaveLength(COORDS.length - 1 + 1);
    expect(rec.of("setDrawColor").map((c) => c.args)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("ignores too-short polylines", () => {
    const rec = recorder();
    drawClosedPolyline(rec.pdf, tf, COORDS.slice(0, 2), [0, 0, 0], 1);
    drawOpenPolyline(rec.pdf, tf, COORDS.slice(0, 1), [0, 0, 0], 1);
    expect(rec.of("stroke")).toHaveLength(0);
  });
});

/** The points of each stroked path (moveTo/lineTo up to a stroke). */
function strokedPaths(rec: ReturnType<typeof recorder>): number[][][] {
  const out: number[][][] = [];
  let cur: number[][] = [];
  for (const c of rec.calls) {
    if (c.name === "moveTo" || c.name === "lineTo") cur.push(c.args as number[]);
    else if (c.name === "stroke") {
      out.push(cur);
      cur = [];
    } else if (c.name === "fill" || c.name === "fillEvenOdd" || c.name === "clip") cur = [];
  }
  return out;
}

describe("loads", () => {
  it("draws UDL arrows with tips on the ground, a hatched band following the crest and a label", () => {
    const rec = recorder();
    drawUdlLoads(rec.pdf, tf, [{ x1: 14, x2: 6, magnitude: 12 }], COORDS);
    const tris = rec.of("triangle").map((c) => c.args);
    // Tips on the ground at x = 6 (y = 10) and x = 14 (y = 8); x1/x2 order does not matter.
    expect(tris.map((t) => [t[0], t[1]])).toEqual([
      [50, 100],
      [90, 110],
    ]);
    const arrowH = 38 * 0.25;
    // Outline as on the canvas: the top edge (6) → crest (10) → (14), offset
    // up by the arrow height, and back along the ground.
    const outline = strokedPaths(rec).at(-1)!;
    expect(outline).toEqual([
      [50, 100],
      [50, 100 - arrowH],
      [70, 100 - arrowH],
      [90, 110 - arrowH],
      [90, 110],
      [70, 100],
      [50, 100],
    ]);
    // Hatching inside a clip to the band, the state restored after.
    expect(rec.of("clip")).toHaveLength(1);
    expect(rec.balanced()).toBe(true);
    const label = rec.of("text")[0];
    expect(label.args[0]).toBe("q = 12 kPa");
    expect(label.args[1]).toBe(70);
    // The canvas's 8 px gap above the band.
    expect(label.args[2]).toBeCloseTo(100 - arrowH - 8 * 0.25, 9);
  });

  it("keeps the band on the ground at a step (both corners of the face)", () => {
    const stepped: [number, number][] = [
      [0, 0],
      [0, 4],
      [10, 4],
      [10, 10],
      [20, 10],
      [20, 0],
    ];
    const rec = recorder();
    drawUdlLoads(rec.pdf, tf, [{ x1: 5, x2: 15, magnitude: 10 }], stepped);
    const outline = strokedPaths(rec).at(-1)!;
    // Ground part: (15, 10) → (10, 10) → (10, 4) → (5, 4).
    const ground = outline.slice(-4);
    expect(ground).toEqual([tf.worldToPdf(15, 10), tf.worldToPdf(10, 10), tf.worldToPdf(10, 4), tf.worldToPdf(5, 4)]);
  });

  it("skips loads off the model", () => {
    const rec = recorder();
    drawUdlLoads(rec.pdf, tf, [{ x1: -4, x2: 3, magnitude: 1 }], COORDS);
    drawLineLoads(rec.pdf, tf, [{ x: 40, magnitude: 1 }], COORDS);
    expect(rec.of("text")).toHaveLength(0);
  });

  it("draws a line load arrow at its position", () => {
    const rec = recorder();
    drawLineLoads(rec.pdf, tf, [{ x: 25, magnitude: 80 }], COORDS);
    expect(rec.of("triangle")[0].args.slice(0, 2)).toEqual([145, 125]);
    expect(rec.of("setDrawColor")[0].args).toEqual(LINE_LOAD_COLOR.rgb);
    expect(rec.texts()).toEqual(["P = 80 kN/m"]);
  });

  it("draws touching UDL strips as one load: arrows at its ends, one rounded label", () => {
    const rec = recorder();
    // Ramp on the toe (y = 5) in 1 m strips: 5 mm each, closer than the arrow spacing.
    const ramp = [10.04, 12.5, 15, 17.5, 20].map((q, i) => ({ x1: 21 + i, x2: 22 + i, magnitude: q }));
    drawUdlLoads(rec.pdf, tf, ramp, COORDS);
    expect(rec.texts()).toEqual(["q = 10.0–20.0 kPa"]);
    const tips = rec.of("triangle").map((c) => c.args[0]);
    expect(tips).toEqual([20 + 21 * 5, 20 + 26 * 5]);
    // The left end (10 of 20 kPa) is half the height of the right end.
    const shafts = rec.linesIn(UDL_LOAD_COLOR.rgb).filter(([x1, , x2]) => x1 === x2 && tips.includes(x1));
    const headL = 12 * 0.25;
    expect(shafts[0][3] - shafts[0][1]).toBeCloseTo(38 * 0.25 * 0.502 - headL, 2);
    expect(shafts[1][3] - shafts[1][1]).toBeCloseTo(38 * 0.25 - headL, 9);
  });
});

describe("reinforcement", () => {
  it("draws the bonded band at reduced opacity with balanced graphics state", () => {
    const rec = recorder();
    const tieback = { ...newReinforcement("r", "tieback", COORDS, "ltr"), x1: 5, y1: 8, x2: 15, y2: 8, bondedLength: 4 };
    const anchor = { ...newReinforcement("a", "anchor", COORDS, "ltr"), x1: 5, y1: 6, x2: 15, y2: 6 };
    drawReinforcementsPdf(rec.pdf, tf, [tieback, anchor]);
    expect(rec.balanced()).toBe(true);
    expect(rec.of("setGState")).toHaveLength(1);
    const band = rec.calls[rec.calls.findIndex((c) => c.name === "setGState") + 2];
    expect(band.name).toBe("line");
    expect(band.args[0]).toBeCloseTo(20 + 11 * 5, 9); // bonded from 60 % along
    expect(band.args[2]).toBeCloseTo(20 + 15 * 5, 9);
    // Anchor block only for the element without pullout.
    expect(rec.of("rect")).toHaveLength(1);
    expect(rec.texts()).toEqual(["1", "2"]);
  });

  it("labels piles P1… above their heads", () => {
    const rec = recorder();
    drawPilesPdf(rec.pdf, tf, [{ ...newPile("p", "sheet-pile", COORDS), x1: 4, y1: 10, x2: 4, y2: 2 }]);
    expect(rec.of("line")[0].args).toEqual([40, 100, 40, 140]);
    expect(rec.of("setLineWidth")[0].args).toEqual([1]);
    expect(rec.of("text")[0].args.slice(0, 3)).toEqual(["P1", 40, 100 - 1.2]);
  });

  it("draws force arrows beside their line, with their size on a white plate, as on the canvas", () => {
    const rec = recorder();
    drawReinforcementForcesPdf(rec.pdf, tf, [
      { index: 0, x: 10, y: 6, fx: 0, fy: 0, force: 0, passive: false },
      { index: 1, x: 10, y: 6, fx: -30, fy: 0, force: 30, passive: false },
      { index: 2, x: 10, y: 6, fx: 0, fy: 150, force: 150, passive: true },
      { index: 3, x: 10, y: 6, fx: 0.02, fy: 0, force: 0.02, passive: false },
    ]);
    expect(rec.balanced()).toBe(true);
    // Zero and 0.0 kN/m forces are left out.
    expect(rec.of("triangle")).toHaveLength(2);
    // The passive marker: "FOS" after a drawn ÷ (a bar and two dots).
    expect(rec.texts()).toEqual(["30.0 kN/m", "150 kN/m", "FOS"]);
    expect(rec.of("circle")).toHaveLength(2);
    // The leftward arrow runs 1.4 mm above the crossing at (70, 120).
    const shaft = rec.of("line")[0].args as number[];
    expect(shaft[0]).toBe(70);
    expect(shaft[1]).toBeCloseTo(118.6, 9);
    // Each text starts inside its plate, and no plate covers the crossing.
    const rects = rec.of("rect").map((c) => c.args as number[]);
    expect(rects).toHaveLength(2);
    const [t30, t150] = rec.of("text");
    for (const [t, [x, y, w, h]] of [
      [t30, rects[0]],
      [t150, rects[1]],
    ] as const) {
      expect(t.args[1]).toBeCloseTo(x + 0.25, 9);
      expect(t.args[2]).toBeCloseTo(y + h / 2, 9);
      expect(70 > x && 70 < x + w && 120 > y && 120 < y + h).toBe(false);
    }
  });
});

describe("drawPiezometricLines", () => {
  const line = (id: string, y: number) => ({
    id,
    coordinates: [
      [0, y],
      [30, y],
    ] as [number, number][],
  });

  it("draws free water at reduced opacity with balanced graphics state", () => {
    const rec = recorder();
    drawPiezometricLines(rec.pdf, tf, [line("a", 7)], COORDS, true, "a");
    expect(rec.balanced()).toBe(true);
    expect(rec.of("setGState")).toHaveLength(2); // pond, load arrows
    expect(rec.of("fill").length).toBeGreaterThanOrEqual(2); // pond + symbol
  });

  it("draws load arrows in the pond with their tips on the ground", () => {
    const rec = recorder();
    drawPiezometricLines(rec.pdf, tf, [line("a", 7)], COORDS, true, "a");
    const width = rec.of("setLineWidth").findIndex((c) => c.args[0] === POND_ARROW_WIDTH_PX * tf.mmPerPx);
    expect(width).toBeGreaterThanOrEqual(0);
    const shafts = rec.linesIn(PIEZO_COLOR.rgb).filter((l) => Math.abs(l[3] - l[1]) > 1e-9 || l[0] !== l[2]);
    // Pond over the toe, 10 mm (40 px) deep: shafts at most 20 px, pointing down at the ground.
    const arrows = shafts.filter(([x0, y0, x1, y1]) => y1 > y0 && Math.hypot(x1 - x0, y1 - y0) <= 20 * tf.mmPerPx);
    expect(arrows.length).toBeGreaterThanOrEqual(4);
    for (const [, y0] of arrows) expect(y0).toBeGreaterThan(150 - 7 * 5);
    expect(rec.balanced()).toBe(true);
    const dry = recorder();
    drawPiezometricLines(dry.pdf, tf, [line("a", 7)], COORDS, false, "a");
    expect(dry.of("setLineWidth").some((c) => c.args[0] === POND_ARROW_WIDTH_PX * tf.mmPerPx)).toBe(false);
  });

  it("dashes the horizontal continuation and resets the dash", () => {
    const rec = recorder();
    drawPiezometricLines(rec.pdf, tf, [{ id: "a", coordinates: [[5, 4], [25, 4]] }], COORDS);
    const dashes = rec.of("setLineDashPattern").map((c) => c.args[0]);
    expect(dashes).toEqual([[1.6, 1.1], []]);
    // Continuations from the line ends to the model sides (either direction).
    const piezoLines = rec
      .linesIn(PIEZO_COLOR.rgb)
      .filter(([, y1, , y2]) => y1 === 130 && y2 === 130)
      .map(([x1, , x2]) => [Math.min(x1, x2), Math.max(x1, x2)]);
    expect(piezoLines).toEqual(
      expect.arrayContaining([
        [20, 45],
        [145, 170],
      ]),
    );
  });

  it("numbers the lines only when there are several", () => {
    const one = recorder();
    drawPiezometricLines(one.pdf, tf, [line("a", 4)], COORDS);
    expect(one.texts()).toEqual([]);
    const two = recorder();
    drawPiezometricLines(two.pdf, tf, [line("a", 4), line("b", 2), { id: "c", coordinates: [[0, 1]] }], COORDS);
    expect([...new Set(two.texts())]).toEqual(["1", "2"]);
  });

  it("spaces the symbols along the line as on the canvas, clear of the critical surface", () => {
    // 30 m = 150 mm = 600 canvas px: two symbols (at most two a line).
    const tips = (critical: Parameters<typeof drawPiezometricLines>[6] = null) => {
      const rec = recorder();
      drawPiezometricLines(rec.pdf, tf, [line("a", 4)], COORDS, false, undefined, critical);
      // Each filled triangle ends with a line to its tip.
      return rec.calls.flatMap((c, i) =>
        c.name === "fill" ? [rec.calls.slice(0, i).filter((d) => d.name === "lineTo").pop()!.args[0] as number] : [],
      );
    };
    expect(tips()).toHaveLength(2);
    // A circle crossing the line at x = 15 m (75 + 20 mm): no symbol on it.
    const xs = tips({ cx: 15, cy: 14, radius: 10, entryPoint: [5, 14], exitPoint: [25, 14] });
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) expect(Math.abs(x - 95)).toBeGreaterThan(2);
  });
});

describe("drawEntryExitMarkers", () => {
  const limits = { enabled: true, entryLeftX: 2, entryRightX: 8, exitLeftX: 21, exitRightX: 28 };

  /** Each triangle as [bar x, base x − bar x]: negative when it points right. */
  const triangles = (lim: typeof limits) => {
    const rec = recorder();
    drawEntryExitMarkers(rec.pdf, tf, lim, COORDS);
    const moves = rec.of("moveTo");
    const lines = rec.of("lineTo");
    const out = moves.map((m, i) => {
      const x = m.args[0] as number;
      return [x, (lines[2 * i].args[0] as number) - x];
    });
    out.sort((a, b) => a[0] - b[0]);
    return { out, rec };
  };

  it("points the triangles into each range whatever the order of its ends", () => {
    const signs = (lim: typeof limits) => triangles(lim).out.map(([, d]) => Math.sign(d));
    expect(signs(limits)).toEqual([-1, 1, -1, 1]);
    const swapped = { ...limits, entryLeftX: 8, entryRightX: 2, exitLeftX: 28, exitRightX: 21 };
    expect(signs(swapped)).toEqual([-1, 1, -1, 1]);
  });

  it("draws only a bar for a range of zero width", () => {
    const { out, rec } = triangles({ ...limits, exitLeftX: 25, exitRightX: 25 });
    expect(out).toHaveLength(2); // the entry range's triangles only
    // Two entry bars and one exit bar.
    expect(rec.of("line")).toHaveLength(3);
  });

  it("dots the ranges along the ground between the ends, under the markers (as on the canvas)", () => {
    const { rec } = triangles(limits);
    const dots = rec.of("circle").map((c) => c.args as number[]);
    expect(dots.length).toBeGreaterThan(6);
    const entry = dots.filter(([x]) => x <= 20 + 8 * 5);
    // One spacing (12 px = 3 mm) in from the end, none on the ends themselves.
    expect(entry[0][0]).toBeCloseTo(33, 9);
    expect(entry.some(([x]) => Math.abs(x - 30) < 1e-9 || Math.abs(x - 60) < 1e-9)).toBe(false);
    for (const [, y] of entry) expect(y).toBe(100);
    // Dots first, then the markers over them.
    const lastDot = rec.calls.map((c) => c.name).lastIndexOf("circle");
    const firstBar = rec.calls.findIndex((c) => c.name === "line");
    expect(lastDot).toBeLessThan(firstBar);
  });

  it("keeps the markers off the sliding mass: no dots over it, triangles above the ground", () => {
    const rec = recorder();
    drawEntryExitMarkers(rec.pdf, tf, limits, COORDS, { entryPoint: [ENTRY_X, 10], exitPoint: [22, 5] });
    const xs = rec.of("circle").map((c) => ((c.args[0] as number) - 20) / 5);
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) expect(x < ENTRY_X || x > 22).toBe(true);
    // Every triangle corner above the ground under it.
    for (const c of [...rec.of("moveTo"), ...rec.of("lineTo")]) {
      const [px, py] = c.args as [number, number];
      const wx = (px - 20) / 5;
      const gy = wx <= 10 ? 10 : wx <= 20 ? 10 - (wx - 10) / 2 : 5;
      expect(py).toBeLessThan(tf.worldToPdf(wx, gy)[1]);
    }
  });

  it("alternates the colours of the dots when the entry and exit ranges coincide", () => {
    const rec = recorder();
    drawEntryExitMarkers(rec.pdf, tf, { ...limits, exitLeftX: 2, exitRightX: 8 }, COORDS);
    const colours = rec.of("setFillColor").map((c) => c.args.join(","));
    expect(colours).toContain(ENTRY_DOT_COLOR.rgb.join(","));
    expect(colours).toContain(EXIT_DOT_COLOR.rgb.join(","));
    // One set of dots, not two on top of each other.
    const xs = rec.of("circle").map((c) => c.args[0] as number);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it("is drawn lighter than the result and keeps the graphics state balanced", () => {
    const { rec } = triangles(limits);
    expect(rec.of("setGState")).toHaveLength(1);
    expect(rec.balanced()).toBe(true);
  });

  it("skips handles off the ground", () => {
    const rec = recorder();
    drawEntryExitMarkers(rec.pdf, tf, { ...limits, entryLeftX: -5, exitRightX: 50 }, COORDS);
    expect(rec.of("moveTo")).toHaveLength(2);
    expect(rec.of("circle")).toHaveLength(0);
  });
});

describe("drawSlipSurfaces", () => {
  const s2 = surface({ cy: 16, fos: 1.5 });
  const s3 = surface({ cy: 18, fos: 9 });
  const res = result({ allSurfaces: [surface(), s2, s3], maxFOS: 9 });

  it("draws nothing in critical-only mode", () => {
    const rec = recorder();
    drawSlipSurfaces(rec.pdf, tf, res, rvs());
    expect(rec.calls).toHaveLength(0);
  });

  it("draws the other surfaces by capped FOS colour, each in a balanced opacity state", () => {
    const rec = recorder();
    drawSlipSurfaces(rec.pdf, tf, res, rvs({ surfaceDisplay: "all" }));
    expect(rec.balanced()).toBe(true);
    expect(rec.of("stroke")).toHaveLength(2);
    expect(rec.of("setDrawColor").map((c) => c.args)).toEqual([
      parseColor(fosColor(2.468, 1.234, 2.468)),
      parseColor(fosColor(1.5, 1.234, 2.468)),
    ]);
  });

  it("filters surfaces above the FOS limit", () => {
    const rec = recorder();
    drawSlipSurfaces(rec.pdf, tf, res, rvs({ surfaceDisplay: "filter", fosFilterMax: 2 }));
    expect(rec.of("stroke")).toHaveLength(1);
  });
});

describe("drawCriticalSurface", () => {
  it("does nothing without a critical surface", () => {
    const rec = recorder();
    drawCriticalSurface(rec.pdf, tf, result({ criticalSurface: null }), rvs(), COORDS);
    expect(rec.calls).toHaveLength(0);
  });

  it("fills the mass, draws slices, centre and FOS label with balanced graphics state", () => {
    const rec = recorder();
    drawCriticalSurface(
      rec.pdf,
      tf,
      result({ criticalSlices: [slice(8, 12), slice(12, 16)] }),
      rvs({ showSlices: true, showCentreMarker: true, showFosLabel: true }),
      COORDS,
    );
    expect(rec.balanced()).toBe(true);
    expect(rec.of("setGState")).toHaveLength(2); // mass fill + slice lines
    // Slice boundary at x = 12: from the ground (y = 9) down to the arc.
    const at12 = rec.of("line").find((c) => c.args[0] === 80 && c.args[2] === 80)!;
    expect(at12.args[1]).toBeCloseTo(150 - 9 * 5, 9);
    expect(at12.args[3]).toBeCloseTo(150 - (CIRCLE.cy - Math.sqrt(R * R - 9)) * 5, 9);
    // Radius lines to entry and exit, and the centre dot.
    const [cx, cy] = tf.worldToPdf(CIRCLE.cx, CIRCLE.cy);
    expect(rec.of("circle")[0].args.slice(0, 2)).toEqual([cx, cy]);
    expect(rec.texts()).toEqual(["1.234"]);
    expect(rec.of("text")[0].args[1]).toBe(cx + 3);
  });

  it("fills the same sliding mass for a mirrored (right-to-left) model", () => {
    /** Shoelace area (mm²) of the failure-mass fill path. */
    const fillArea = (coords: [number, number][], cs: SlipSurfaceResult) => {
      const rec = recorder();
      drawCriticalSurface(rec.pdf, tf, result({ criticalSurface: cs }), rvs(), coords);
      const start = rec.calls.findIndex((c) => c.name === "setGState");
      const end = rec.calls.findIndex((c, i) => i > start && c.name === "fill");
      const pts = rec.calls
        .slice(start, end)
        .filter((c) => c.name === "moveTo" || c.name === "lineTo")
        .map((c) => c.args as [number, number]);
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        a += x1 * y2 - x2 * y1;
      }
      return Math.abs(a) / 2;
    };
    const mirror = ([x, y]: [number, number]): [number, number] => [30 - x, y];
    const ltr = fillArea(COORDS, surface());
    const cs = surface();
    const rtl = fillArea(COORDS.map(mirror).reverse(), {
      ...cs,
      cx: 30 - cs.cx,
      entryPoint: mirror(cs.entryPoint),
      exitPoint: mirror(cs.exitPoint),
    });
    expect(ltr).toBeGreaterThan(100);
    expect(rtl).toBeCloseTo(ltr, 3);
  });

  it("omits the centre marker of a non-circular surface and labels above the mass", () => {
    const rec = recorder();
    const poly = surface({ points: [[ENTRY_X, 10], [12, 6], [22, 5]] });
    drawCriticalSurface(
      rec.pdf,
      tf,
      result({ criticalSurface: poly }),
      rvs({ showCentreMarker: true, showFosLabel: true }),
      COORDS,
    );
    expect(rec.of("circle")).toHaveLength(0);
    const [ax] = tf.worldToPdf((ENTRY_X + 22) / 2, 10);
    expect(rec.of("text")[0].args[1]).toBeCloseTo(ax + 3, 9);
    // The arc stroke follows the polyline points.
    const lastStrokeMoves = rec.of("moveTo").at(-1)!.args;
    expect(lastStrokeMoves).toEqual(tf.worldToPdf(ENTRY_X, 10));
  });

  /** The failure-mass fill path (world coordinates), from the first opacity change to its fill. */
  const fillPath = (rec: ReturnType<typeof recorder>) => {
    const start = rec.calls.findIndex((c) => c.name === "setGState");
    const end = rec.calls.findIndex((c, i) => i > start && c.name === "fill");
    return rec.calls
      .slice(start, end)
      .filter((c) => c.name === "moveTo" || c.name === "lineTo")
      .map((c) => {
        const [x, y] = c.args as [number, number];
        return [(x - 20) / 5, (150 - y) / 5];
      });
  };

  it("fills the mass behind a vertical wall face without spilling into the air", () => {
    // Stepped wall: ground at y = 10 for x ≥ 10, vertical face down to y = 4,
    // toe at y = 4 to the left. The surface enters at (16, 10) and exits at (4, 4).
    const stepped: [number, number][] = [
      [0, 0],
      [0, 4],
      [10, 4],
      [10, 10],
      [20, 10],
      [20, 0],
    ];
    const cs = surface({ points: [[16, 10], [10, 2], [4, 4]], entryPoint: [16, 10], exitPoint: [4, 4] });
    const rec = recorder();
    drawCriticalSurface(rec.pdf, tf, result({ criticalSurface: cs }), rvs(), stepped);
    const path = fillPath(rec);
    for (const corner of [[10, 10], [10, 4]]) {
      expect(path.some(([x, y]) => Math.abs(x - corner[0]) < 1e-9 && Math.abs(y - corner[1]) < 1e-9)).toBe(true);
    }
    // Nothing above the ground left of the wall.
    for (const [x, y] of path) if (x < 10 - 1e-9) expect(y).toBeLessThanOrEqual(4 + 1e-9);
  });

  it("draws the tension crack face as part of the surface and the water in it", () => {
    // The analysis reports a crack at x = 6 from the ground down to 7, half filled with water.
    const crack = { x: 6, top: 10, bottom: 7 };
    const cs = surface({ points: [[6, 7], [12, 4], [22, 5]], entryPoint: [6, 7], exitPoint: [22, 5], crack });
    const rec = recorder();
    drawCriticalSurface(rec.pdf, tf, result({ criticalSurface: cs }), rvs(), COORDS, {
      options: { tensionCrackWater: 0.5 },
    });
    // The bold surface line starts at the top of the crack.
    expect(rec.of("moveTo").at(-1)!.args).toEqual(tf.worldToPdf(6, 10));
    // Water band from the crack bottom (y = 7) up to y = 8.5, in the crack
    // against the face on the side of the sliding mass.
    const band = rec.of("rect").find((c) => c.args[4] === "F")!;
    const [x, y, , hBand] = band.args as number[];
    expect(x).toBeCloseTo(tf.worldToPdf(6, 0)[0], 9);
    expect(y).toBeCloseTo(tf.worldToPdf(0, 8.5)[1], 9);
    expect(y + hBand).toBeCloseTo(tf.worldToPdf(0, 7)[1], 9);
  });

  it("draws no water without water in the crack", () => {
    const cs = surface({ points: [[6, 7], [12, 4], [22, 5]], entryPoint: [6, 7], exitPoint: [22, 5] });
    const rec = recorder();
    drawCriticalSurface(rec.pdf, tf, result({ criticalSurface: cs }), rvs(), COORDS);
    expect(rec.of("rect")).toHaveLength(0);
  });

  it("draws slice lines white over a dark material and black over a light one", () => {
    const dark: MaterialRow = { ...DEFAULT_MATERIAL, id: "dark", color: "#3a3a4a" };
    const rec = recorder();
    drawCriticalSurface(
      rec.pdf,
      tf,
      result({ criticalSlices: [slice(8, 12), slice(12, 16)] }),
      rvs({ showSlices: true }),
      COORDS,
      { materials: [dark], materialBoundaries: [], regionMaterials: [] },
    );
    expect(rec.linesIn([255, 255, 255]).length).toBeGreaterThan(0);
    expect(rec.linesIn([0, 0, 0])).toHaveLength(0);
  });

  it("gives a very thin sliding mass a band of minimum width", () => {
    // A slab 0.05 m deep under the slope face from (10, 10) to (20, 5).
    const cs = surface({ points: [[10, 10], [15, 7.45], [20, 5]], entryPoint: [10, 10], exitPoint: [20, 5] });
    const rec = recorder();
    drawCriticalSurface(rec.pdf, tf, result({ criticalSurface: cs }), rvs(), COORDS);
    expect(rec.of("setGState")).toHaveLength(2); // fill + band
    expect(rec.balanced()).toBe(true);
    // Under the ground only: the ground over the mass, twice as wide, clipped to the model.
    expect(rec.of("clip")).toHaveLength(1);
    expect(rec.of("setLineWidth").some((c) => Math.abs((c.args[0] as number) - 2 * 5 * 0.25) < 1e-9)).toBe(true);
    const band = strokedPaths(rec)[0];
    expect(band[0]).toEqual(tf.worldToPdf(10, 10));
    expect(band.at(-1)).toEqual(tf.worldToPdf(20, 5));
  });

  it("draws no crack for an entry below the ground that the analysis did not report as one", () => {
    const cs = surface({ points: [[6, 7], [12, 4], [22, 5]], entryPoint: [6, 7], exitPoint: [22, 5] });
    const rec = recorder();
    drawCriticalSurface(rec.pdf, tf, result({ criticalSurface: cs }), rvs(), COORDS, { options: { tensionCrackWater: 1 } });
    expect(rec.of("rect")).toHaveLength(0);
    expect(rec.of("moveTo").at(-1)!.args).toEqual(tf.worldToPdf(6, 7));
  });

  it("draws coincident slice boundaries once and every other line of dense slices", () => {
    const rec = recorder();
    drawCriticalSurface(
      rec.pdf,
      tf,
      result({ criticalSlices: [slice(8, 12), slice(12 + 1e-7, 16)] }),
      rvs({ showSlices: true }),
      COORDS,
    );
    expect(rec.linesIn([0, 0, 0])).toHaveLength(3);
    // 0.1 m slices: 0.5 mm = 2 (canvas) px apart → 21 of the 41 lines.
    const dense = Array.from({ length: 40 }, (_, i) => slice(8 + i * 0.1, 8.1 + i * 0.1));
    const rec2 = recorder();
    drawCriticalSurface(rec2.pdf, tf, result({ criticalSlices: dense }), rvs({ showSlices: true }), COORDS);
    expect(rec2.linesIn([0, 0, 0])).toHaveLength(21);
  });
});

describe("drawAnnotations", () => {
  const draw = (annotations: Annotation[], res: AnalysisResult = result()) => {
    const rec = recorder();
    drawAnnotations(rec.pdf, tf, annotations, res, [DEFAULT_MATERIAL], PIEZO_EMPTY, {}, [], FRAME);
    return rec;
  };

  it("keeps graphics state balanced for every annotation type", () => {
    const rec = draw(
      [
        { id: "t", type: "text", x: 0.1, y: 0.1, text: "A\nB", italic: true, fontFamily: "Georgia, serif" },
        { id: "c", type: "color-bar", x: 0.8, y: 0.2 },
        { id: "m", type: "material-table", x: 0.9, y: 0.05, anchor: "top-right" },
        { id: "p", type: "plot", x: 0.5, y: 0.5 },
      ],
      result({ criticalSlices: [slice(1, 2), slice(2, 3)] }),
    );
    expect(rec.balanced()).toBe(true);
    expect(rec.texts()).toEqual(expect.arrayContaining(["A", "B", "FOS", "No slice data"].slice(0, 3)));
  });

  it("writes the colour bar ticks with '≥' on a capped scale", () => {
    const capped = draw([{ id: "c", type: "color-bar", x: 0.8, y: 0.2 }], result({ maxFOS: 10 }));
    expect(capped.texts()).toContain("≥ 2.47");
    expect(capped.texts()).toContain("1.23");
    const plain = draw([{ id: "c", type: "color-bar", x: 0.8, y: 0.2 }]);
    expect(plain.texts().some((t) => t.startsWith(">="))).toBe(false);
    expect(plain.texts()).toContain("1.80");
  });

  it("resolves placeholders and draws one text line per row", () => {
    const rec = draw([{ id: "t", type: "text", x: 0.2, y: 0.2, text: "FOS = #FOS\nline 2" }]);
    const [first, second] = rec.of("text");
    expect(String(first.args[0])).toContain("1.23");
    expect(second.args[0]).toBe("line 2");
    expect(second.args[1]).toBe(first.args[1]);
    expect(second.args[2] as number).toBeGreaterThan(first.args[2] as number);
  });

  it("draws the material table cells with a colour swatch per material, right-anchored", () => {
    const rec = recorder();
    const sand = { ...DEFAULT_MATERIAL, id: "sand", name: "Sand", color: "#eedd88" } as MaterialRow;
    drawAnnotations(
      rec.pdf,
      tf,
      [{ id: "m", type: "material-table", x: 0.9, y: 0.1, anchor: "top-right", tableColumns: ["unitWeight", "cohesion"] }],
      result(),
      [DEFAULT_MATERIAL, sand],
      PIEZO_EMPTY,
      {},
      [],
      FRAME,
    );
    expect(rec.texts()).toEqual(
      expect.arrayContaining(["Color", "Name", DEFAULT_MATERIAL.name, "Sand", "18", "12"]),
    );
    // Swatches in the material colours.
    const fills = rec.of("setFillColor").map((c) => c.args.join(","));
    expect(fills).toContain(parseColor(DEFAULT_MATERIAL.color).join(","));
    expect(fills).toContain("238,221,136");
    // Second row is shaded.
    expect(fills).toContain("248,248,248");
    // Right edge of the outline at the anchor (0.9 of the frame width).
    const outline = rec.of("rect").find((c) => c.args[4] === "FD")!.args as number[];
    expect(outline[0] + outline[2]).toBeCloseTo(0.9 * 297, 6);
    expect(outline[1]).toBeCloseTo(0.1 * 210, 6);
    expect(rec.balanced()).toBe(true);
  });
});
