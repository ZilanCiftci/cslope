/**
 * The order the vector PDF draws the result in: the custom surfaces' lines
 * under the critical surface (as on the canvas, so the critical FOS
 * label's plate covers them), their labels after it, then the reference
 * labels, which keep clear of the custom surfaces and their labels.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlipSurfaceResult } from "@cslope/engine";

const { calls } = vi.hoisted(() => ({ calls: [] as { name: string; args: unknown[]; out: unknown }[] }));

vi.mock("jspdf", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("jspdf");
  class NoSaveJsPdf extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      this.save = (() => this) as unknown as typeof this.save;
    }
  }
  return { ...actual, jsPDF: NoSaveJsPdf };
});

/** `module` with `names` wrapped to record their calls (and results) in order. */
function recording<T extends Record<string, unknown>>(module: T, names: string[]): T {
  const out: Record<string, unknown> = { ...module };
  for (const name of names) {
    const fn = module[name] as (...a: unknown[]) => unknown;
    out[name] = (...args: unknown[]) => {
      const result = fn(...args);
      calls.push({ name, args, out: result });
      return result;
    };
  }
  return out as T;
}

vi.mock("./pdf-drawing", async (importOriginal) =>
  recording(await importOriginal<Record<string, unknown>>(), ["drawCustomSurfaceLines", "drawCriticalSurface", "drawCustomSurfaceLabels"]),
);
vi.mock("./pdf-reference", async (importOriginal) => recording(await importOriginal<Record<string, unknown>>(), ["drawReferenceLabelsPdf"]));

import { exportVectorPdf, type PdfExportData } from "./pdf-export";
import { DEFAULT_ANALYSIS_LIMITS, DEFAULT_MATERIAL, DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";

afterEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
});

const CS: SlipSurfaceResult = { cx: 10, cy: 12, radius: 10, fos: 1.2, entryPoint: [2, 8], exitPoint: [18, 2], converged: true };
const CUSTOM: SlipSurfaceResult = { ...CS, cy: 13, radius: Math.hypot(8, 11), fos: 1.5, customPlane: { kind: "circle", index: 0 } };

function data(): PdfExportData {
  return {
    coordinates: [
      [0, 0],
      [0, 10],
      [10, 10],
      [20, 5],
      [20, 0],
    ],
    materials: [{ ...DEFAULT_MATERIAL }],
    materialBoundaries: [],
    regionMaterials: [],
    result: {
      minFOS: 1.2,
      maxFOS: 1.5,
      criticalSurface: CS,
      allSurfaces: [CS, CUSTOM],
      customSurfaces: [{ kind: "circle", index: 0, surface: CUSTOM }],
      criticalSlices: [],
      method: "Bishop",
      elapsedMs: 1,
    },
    resultViewSettings: {
      ...DEFAULT_RESULT_VIEW_SETTINGS,
      showCustomSurfaces: true,
      showFosLabel: true,
      annotations: [{ id: "r", type: "reference", shape: "polyline", points: [[3, 9], [12, 3], [19, 4]], label: "other program" }],
    },
    piezometricLine: { enabled: false, lines: [], activeLineId: null, materialAssignment: {} },
    udls: [],
    lineLoads: [],
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
    orientation: "ltr",
    projectInfo: { title: "Order" } as PdfExportData["projectInfo"],
  };
}

describe("exportVectorPdf — custom surfaces", () => {
  it("draws their lines before the critical surface, their labels after it, and the reference labels keep clear of both", () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exportVectorPdf(data());
    expect(calls.map((c) => c.name)).toEqual(["drawCustomSurfaceLines", "drawCriticalSurface", "drawCustomSurfaceLabels", "drawReferenceLabelsPdf"]);
    const [lines, , labels, references] = calls;
    expect(lines.out).toEqual([CUSTOM]);
    expect(labels.out).toHaveLength(1);
    expect(references.args[3]).toMatchObject({ customSurfaces: lines.out, customLabelBoxes: labels.out });
  });
});
