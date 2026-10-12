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
import { LINE_LOAD_COLOR, PIEZO_COLOR, UDL_LOAD_COLOR } from "../rendering/style-spec";

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

describe("loads", () => {
  it("draws UDL arrows with tips on the ground, a top edge following the crest and a label", () => {
    const rec = recorder();
    drawUdlLoads(rec.pdf, tf, [{ x1: 14, x2: 6, magnitude: 12 }], COORDS);
    const tris = rec.of("triangle").map((c) => c.args);
    // Tips on the ground at x = 6 (y = 10) and x = 14 (y = 8); x1/x2 order does not matter.
    expect(tris.map((t) => [t[0], t[1]])).toEqual([
      [50, 100],
      [90, 110],
    ]);
    const arrowH = 38 * 0.25;
    const lines = rec.linesIn(UDL_LOAD_COLOR.rgb);
    // Top edge: (6) → crest (10) → (14), offset up by the arrow height.
    const top = lines.filter(([, y1, , y2]) => y1 !== y2 || y1 === 100 - arrowH).slice(2);
    expect(top).toEqual([
      [50, 100 - arrowH, 70, 100 - arrowH],
      [70, 100 - arrowH, 90, 110 - arrowH],
    ]);
    const label = rec.of("text")[0];
    expect(label.args[0]).toBe("q = 12 kPa");
    expect(label.args[1]).toBe(70);
    expect(label.args[2]).toBeCloseTo(100 - arrowH - 1.5, 9);
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

  it("draws force arrows with their size, on the side they point to", () => {
    const rec = recorder();
    drawReinforcementForcesPdf(rec.pdf, tf, [
      { index: 0, x: 10, y: 6, fx: 0, fy: 0, force: 0, passive: false },
      { index: 1, x: 10, y: 6, fx: -30, fy: 0, force: 30, passive: false },
      { index: 2, x: 10, y: 6, fx: 0, fy: 150, force: 150, passive: true },
    ]);
    const [left, up] = rec.of("text");
    expect(left.args[0]).toBe("30.0 kN/m");
    expect(left.args[1]).toBeCloseTo(70 - 7 - 1, 9);
    expect((left.args[3] as { align: string }).align).toBe("right");
    expect(up.args[0]).toBe("150 kN/m /F");
    expect(up.args[2]).toBeCloseTo(120 - 7, 9); // up on paper = smaller y
    expect(rec.of("triangle")).toHaveLength(2);
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
    expect(rec.of("setGState")).toHaveLength(1);
    expect(rec.of("fill").length).toBeGreaterThanOrEqual(2); // pond + symbol
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
    expect(two.texts()).toEqual(["1", "2"]);
  });
});

describe("drawEntryExitMarkers", () => {
  const limits = { enabled: true, entryLeftX: 2, entryRightX: 8, exitLeftX: 21, exitRightX: 28 };

  const tipOffsets = (orientation: "ltr" | "rtl") => {
    const rec = recorder();
    drawEntryExitMarkers(rec.pdf, tf, limits, COORDS, orientation);
    const out: number[] = [];
    const moves = rec.of("moveTo");
    const lines = rec.of("lineTo");
    for (let i = 0; i < moves.length; i++) out.push((lines[2 * i].args[0] as number) - (moves[i].args[0] as number));
    return { out, rec };
  };

  it("points the handles inwards and mirrors them for right-to-left models", () => {
    const ltr = tipOffsets("ltr");
    expect(ltr.out.map(Math.sign)).toEqual([-1, 1, -1, 1]);
    const rtl = tipOffsets("rtl");
    expect(rtl.out.map(Math.sign)).toEqual([1, -1, 1, -1]);
  });

  it("dots the ranges along the ground including both ends", () => {
    const { rec } = tipOffsets("ltr");
    const dots = rec.of("circle").map((c) => c.args as number[]);
    expect(dots.length).toBeGreaterThan(6);
    const entry = dots.filter(([x]) => x <= 20 + 8 * 5);
    expect(entry[0].slice(0, 2)).toEqual([30, 100]);
    expect(entry[1].slice(0, 2)).toEqual([60, 100]);
    for (const [, y] of entry) expect(y).toBe(100);
  });

  it("skips handles off the ground", () => {
    const rec = recorder();
    drawEntryExitMarkers(rec.pdf, tf, { ...limits, entryLeftX: -5, exitRightX: 50 }, COORDS, "ltr");
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

  it("writes the colour bar ticks with an ASCII '>=' on a capped scale", () => {
    const capped = draw([{ id: "c", type: "color-bar", x: 0.8, y: 0.2 }], result({ maxFOS: 10 }));
    expect(capped.texts()).toContain(">= 2.47");
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
});
