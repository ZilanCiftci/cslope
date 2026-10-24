import { afterEach, describe, expect, it, vi } from "vitest";
import type { jsPDF } from "jspdf";
import type { SlipSurfaceResult } from "@cslope/engine";
const { saved } = vi.hoisted(() => ({ saved: [] as { doc: jsPDF; filename: string }[] }));

vi.mock("jspdf", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("jspdf");
  class RecordingJsPdf extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      // The text written, with its position: with the embedded font the
      // stream holds glyph ids, not the characters.
      const texts: { text: string; x: number; y: number }[] = [];
      (this as unknown as { recordedTexts: typeof texts }).recordedTexts = texts;
      const text = this.text.bind(this);
      this.text = ((t: string | string[], x: number, y: number, ...rest: unknown[]) => {
        for (const line of Array.isArray(t) ? t : [t]) texts.push({ text: String(line), x, y });
        return (text as (...a: unknown[]) => unknown)(t, x, y, ...rest);
      }) as unknown as typeof this.text;
      this.save = ((filename: string) => {
        saved.push({ doc: this, filename });
        return this;
      }) as unknown as typeof this.save;
    }
  }
  return { ...actual, jsPDF: RecordingJsPdf };
});

import { buildExportFilename, exportVectorPdf, type PdfExportData } from "./pdf-export";
import { buildAnalysisSummary } from "../export/analysisSummary";
import { DEFAULT_ANALYSIS_OPTIONS } from "@cslope/engine";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_MATERIAL,
  DEFAULT_RESULT_VIEW_SETTINGS,
  PLOT_MARGINS,
} from "../../store/defaults";
import { newPile, newReinforcement } from "../../utils/reinforcement";
import type { ProjectInfo } from "../../store/types";

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];

const CS: SlipSurfaceResult = {
  cx: 15,
  cy: 14,
  radius: Math.hypot(7, 9),
  fos: 1.234,
  entryPoint: [15 - Math.sqrt(130 - 16), 10],
  exitPoint: [22, 5],
  reinforcementForces: [{ index: 0, x: 12, y: 7, fx: -25, fy: 5, force: 25.5, passive: false }],
};

function data(over: Partial<PdfExportData> = {}): PdfExportData {
  return {
    coordinates: COORDS,
    materials: [
      { ...DEFAULT_MATERIAL },
      { ...DEFAULT_MATERIAL, id: "rock", name: "Rock", color: "#777777", model: { kind: "impenetrable", unitWeight: 22 } },
    ],
    materialBoundaries: [
      {
        id: "b",
        coordinates: [
          [0, 2],
          [30, 2],
        ],
      },
    ],
    regionMaterials: [{ point: [15, 1], materialId: "rock" }],
    result: {
      minFOS: 1.234,
      maxFOS: 5,
      criticalSurface: CS,
      allSurfaces: [CS, { ...CS, cy: 16, radius: Math.hypot(7, 11), fos: 2 }],
      criticalSlices: [
        { x: 12, xLeft: 11, xRight: 13, baseLength: 2, weight: 50, cohesion: 12, frictionAngle: 0, normalForce: 40, porePressure: 0 },
        { x: 14, xLeft: 13, xRight: 15, baseLength: 2, weight: 60, cohesion: 12, frictionAngle: 0, normalForce: 50, porePressure: 0 },
      ] as PdfExportData["result"]["criticalSlices"],
      method: "Bishop",
      elapsedMs: 1,
    },
    resultViewSettings: {
      ...DEFAULT_RESULT_VIEW_SETTINGS,
      surfaceDisplay: "all",
      showSlices: true,
      minorTicks: 1,
      annotations: [
        ...DEFAULT_RESULT_VIEW_SETTINGS.annotations,
        { id: "c", type: "color-bar", x: 0.85, y: 0.3 },
        { id: "p", type: "plot", x: 0.5, y: 0.6 },
      ],
    },
    piezometricLine: {
      enabled: true,
      lines: [
        {
          id: "w",
          name: "W",
          color: "#00f",
          coordinates: [
            [0, 7],
            [30, 7],
          ],
        },
      ],
      activeLineId: "w",
      materialAssignment: {},
    },
    udls: [{ id: "u", x1: 2, x2: 8, magnitude: 10 }],
    lineLoads: [{ id: "l", x: 26, magnitude: 40 }],
    reinforcements: [newReinforcement("r", "tieback", COORDS, "ltr")],
    piles: [newPile("p", "pile", COORDS)],
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, entryLeftX: 2, entryRightX: 8, exitLeftX: 21, exitRightX: 28 },
    orientation: "ltr",
    projectInfo: { title: "Full model", subtitle: "Section A" } as ProjectInfo,
    ...over,
  };
}

afterEach(() => {
  saved.length = 0;
  vi.restoreAllMocks();
});

function exportDoc(d: PdfExportData) {
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  saved.length = 0;
  exportVectorPdf(d);
  return { alert, error, doc: saved[0]?.doc, filename: saved[0]?.filename };
}

function pageStream(doc: jsPDF): string {
  return (doc.internal as unknown as { pages: string[][] }).pages[1].join("\n");
}

/** Text shown on the page (string operands of Tj operators). */
function recordedTexts(doc: jsPDF): { text: string; x: number; y: number }[] {
  return (doc as unknown as { recordedTexts: { text: string; x: number; y: number }[] }).recordedTexts;
}

function pageTexts(doc: jsPDF): string[] {
  return recordedTexts(doc).map((t) => t.text);
}

describe("exportVectorPdf — full model", () => {
  it("produces one page with balanced graphics state and no error", () => {
    const { alert, error, doc } = exportDoc(data());
    expect(alert).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(doc.getNumberOfPages()).toBe(1);
    const tokens = pageStream(doc).split(/\s+/);
    const q = tokens.filter((t) => t === "q").length;
    const Q = tokens.filter((t) => t === "Q").length;
    expect(q).toBeGreaterThan(3);
    expect(Q).toBe(q);
    // Depth never goes negative along the stream (no restore before save).
    let depth = 0;
    for (const t of tokens) {
      if (t === "q") depth++;
      if (t === "Q") depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  });

  it("writes the labels of every drawn feature", () => {
    const { doc } = exportDoc(data());
    const texts = pageTexts(doc);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Full model",
        "Section A",
        "1.234",
        "q = 10 kPa",
        "P = 40 kN/m",
        "P1",
        "1",
        "FOS",
        "BR",
      ]),
    );
    // The force at its element's head (numbered when it needs a leader).
    expect(texts.some((t) => /^(1: )?25\.5 kN\/m$/.test(t))).toBe(true);
    // Capped colour scale (maxFOS 5 > 2 × 1.234) with an ASCII ">=".
    expect(texts.some((t) => t.startsWith("≥ 2.47"))).toBe(true);
  });

  it("appends the analysis summary after the drawing, with the scale on the drawing only", () => {
    const d = data();
    const sections = buildAnalysisSummary({
      ...d,
      options: { ...DEFAULT_ANALYSIS_OPTIONS, partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 } },
    });
    const { alert, error, doc } = exportDoc({
      ...d,
      summary: { sections, header: { projectInfo: d.projectInfo, modelName: "Section A", version: "9.9.9", date: "2026-10-17" } },
    });
    expect(alert).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    const texts = pageTexts(doc);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Analysis summary",
        "Result",
        "Over-design factor (design values)",
        "Bishop simplified (moment equilibrium)",
        "Partial factors",
        "Materials (characteristic values)",
        "Summary page 1",
      ]),
    );
    expect(texts.some((t) => t.startsWith("cSlope 9.9.9"))).toBe(true);
    // Every summary line lies inside the page.
    const [w, h] = [doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight()];
    for (const t of recordedTexts(doc)) {
      expect(t.y).toBeLessThanOrEqual(h);
      expect(t.x).toBeLessThanOrEqual(w);
    }
    const out = doc.output();
    expect(out.match(/\/VP \[/g)).toHaveLength(1);
  });

  it("names the file from the project number when there is no title", () => {
    const { filename } = exportDoc(data({ projectInfo: { title: " ", projectNumber: "P-12" } as ProjectInfo }));
    expect(filename).toBe("P-12.pdf");
  });

  it("uses the locked view bounds for the scale, and auto-fits a reversed lock", () => {
    const widthOfModel = (d: PdfExportData) => {
      const doc = exportDoc(d).doc;
      // The calibrated measure dictionary states metres per mm.
      const out = doc.output();
      return Number(/1 mm = ([\d.]+) m/.exec(out)![1]);
    };
    const auto = widthOfModel(data());
    const zoomedOut = widthOfModel(data({ viewBounds: { xMin: -30, xMax: 60, yMin: -10, yMax: 30 } }));
    const reversed = widthOfModel(data({ viewBounds: { xMin: 60, xMax: -30, yMin: -10, yMax: 30 } }));
    expect(zoomedOut).toBeGreaterThan(auto * 1.5);
    expect(reversed).toBeCloseTo(auto, 9);
  });

  it("places a locked view like the canvas: its bottom on the plot frame's bottom", () => {
    // A lock much wider than the plot area (e.g. from a file): the canvas
    // (computeViewLockFit) puts y = yMin on the bottom of the plot frame.
    const { doc } = exportDoc(data({ viewBounds: { xMin: 10, xMax: 80, yMin: 0, yMax: 10 } }));
    const label = recordedTexts(doc).find((t) => t.text === "0");
    expect(label).toBeDefined();
    const yFromTopMm = label!.y;
    // Left ruler label of y = 0 sits at the frame bottom (+ its baseline shift).
    expect(yFromTopMm).toBeCloseTo(210 * (1 - PLOT_MARGINS.B) + 9 * 0.12, 2);
  });

  it("reports an error instead of throwing when drawing fails", () => {
    const { alert, error } = exportDoc(data({ coordinates: null as unknown as [number, number][] }));
    expect(error).toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("PDF export failed"));
  });
});

describe("buildExportFilename", () => {
  it("strips characters that are invalid in file names and trailing dots", () => {
    expect(buildExportFilename({ title: 'Slope: A/B "test"?..' } as ProjectInfo, "png")).toBe("Slope AB test.png");
  });

  it("falls back to a default name", () => {
    expect(buildExportFilename(undefined, "pdf")).toBe("slope-analysis.pdf");
    expect(buildExportFilename({ title: "<>:" } as ProjectInfo, "pdf")).toBe("slope-analysis.pdf");
  });

  it("collapses whitespace and limits the length", () => {
    expect(buildExportFilename({ title: "a   b  c" } as ProjectInfo, "pdf")).toBe("a b c.pdf");
    // Control characters are dropped, not turned into spaces.
    expect(buildExportFilename({ title: "a\tb\nc" } as ProjectInfo, "pdf")).toBe("abc.pdf");
    expect(buildExportFilename({ title: "x".repeat(300) } as ProjectInfo, "pdf")).toBe(`${"x".repeat(120)}.pdf`);
  });
});
