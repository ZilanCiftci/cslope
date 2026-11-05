/**
 * The vector PDF draws the result's layers in the model's order
 * (resultViewSettings.layerOrder), as the result view does; the default
 * order draws as the PDF always did.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlipSurfaceResult } from "@cslope/engine";

const { calls, outputs } = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
  outputs: [] as string[],
}));

vi.mock("jspdf", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("jspdf");
  class KeepJsPdf extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      this.save = (() => {
        outputs.push(String(this.output()));
        return this;
      }) as unknown as typeof this.save;
    }
  }
  return { ...actual, jsPDF: KeepJsPdf };
});

/** `module` with `names` wrapped to record their calls in order. */
function recording<T extends Record<string, unknown>>(module: T, names: string[]): T {
  const out: Record<string, unknown> = { ...module };
  for (const name of names) {
    const fn = module[name] as (...a: unknown[]) => unknown;
    out[name] = (...args: unknown[]) => {
      calls.push({ name, args });
      return fn(...args);
    };
  }
  return out as T;
}

vi.mock("./pdf-drawing", async (importOriginal) =>
  recording(await importOriginal<Record<string, unknown>>(), [
    "drawMaterialRegions",
    "drawSlipSurfaces",
    "drawCriticalSurface",
    "drawCriticalSlicesPdf",
    "drawCentreMarkerPdf",
    "drawCriticalFosLabelPdf",
    "drawCustomSurfaceLabels",
    "drawAnnotations",
  ]),
);
vi.mock("./pdf-reference", async (importOriginal) =>
  recording(await importOriginal<Record<string, unknown>>(), ["drawReferenceLinesPdf", "drawReferenceLabelsPdf"]),
);

import { exportVectorPdf, type PdfExportData } from "./pdf-export";
import { DEFAULT_ANALYSIS_LIMITS, DEFAULT_MATERIAL, DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";
import type { Annotation, ResultViewSettings } from "../../store/types";

afterEach(() => {
  calls.length = 0;
  outputs.length = 0;
  vi.useRealTimers();
});

const CS: SlipSurfaceResult = { cx: 10, cy: 12, radius: 10, fos: 1.2, entryPoint: [2, 8], exitPoint: [18, 2], converged: true };
const slice = (a: number, b: number) =>
  ({ x: (a + b) / 2, xLeft: a, xRight: b, width: b - a, yTop: 8, yBottom: 4, height: 4, area: 4, alpha: 0.2, baseLength: b - a, weight: 90, cohesion: 12, frictionAngle: 0, normalForce: 80, shearForce: 12, porePressure: 0, baseMaterial: {} });

const ANNOS: Annotation[] = [
  { id: "m", type: "material-table", x: 0.9, y: 0.05, anchor: "top-right" },
  { id: "r", type: "reference", shape: "polyline", points: [[3, 9], [12, 3], [19, 4]], label: "other program" },
  { id: "t", type: "text", x: 0.1, y: 0.1, text: "Hello" },
];

function data(view: Partial<ResultViewSettings> = {}): PdfExportData {
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
      allSurfaces: [CS, { ...CS, cy: 13, fos: 1.5 }],
      criticalSlices: [slice(4, 6), slice(6, 8), slice(8, 10)],
      method: "Bishop",
      elapsedMs: 1,
    } as unknown as PdfExportData["result"],
    resultViewSettings: {
      ...DEFAULT_RESULT_VIEW_SETTINGS,
      surfaceDisplay: "all",
      showSlices: true,
      showFosLabel: true,
      showCentreMarker: true,
      annotations: ANNOS,
      ...view,
    },
    piezometricLine: { enabled: false, lines: [], activeLineId: null, materialAssignment: {} } as unknown as PdfExportData["piezometricLine"],
    udls: [],
    lineLoads: [],
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
    orientation: "ltr",
    projectInfo: { title: "Layers" } as PdfExportData["projectInfo"],
  };
}

function exportNamed(view: Partial<ResultViewSettings> = {}): string[] {
  vi.spyOn(window, "alert").mockImplementation(() => {});
  calls.length = 0;
  exportVectorPdf(data(view));
  return calls.map((c) => {
    if (c.name === "drawAnnotations") return `annotation:${(c.args[2] as Annotation[]).map((a) => a.id).join(",")}`;
    if (c.name === "drawMaterialRegions") return c.args[7] === "fills" ? "soilFills" : `regions:${c.args[6]}`;
    return c.name;
  });
}

describe("exportVectorPdf — layer order", () => {
  it("draws in the default order without a stored one", () => {
    expect(exportNamed()).toEqual([
      "regions:true",
      "drawReferenceLinesPdf",
      "drawSlipSurfaces",
      "drawCriticalSurface",
      "drawCustomSurfaceLabels",
      "drawReferenceLabelsPdf",
      "annotation:m",
      "annotation:t",
    ]);
  });

  it("writes the same PDF with the default order stored as without one", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const stable = (s: string) => s.replace(/\/ID \[[^\]]*\]/g, "");
    exportNamed();
    exportNamed({ layerOrder: ["soilColor", "r", "surfaces", "criticalSurface", "slices", "center", "fosLabel", "m", "t"] });
    expect(outputs).toHaveLength(2);
    expect(stable(outputs[1])).toBe(stable(outputs[0]));
  });

  it("draws the soil colours after the slices when they are moved above them", () => {
    expect(exportNamed({ layerOrder: ["r", "surfaces", "criticalSurface", "slices", "soilColor", "center", "fosLabel", "m", "t"] })).toEqual([
      "regions:false",
      "drawReferenceLinesPdf",
      "drawSlipSurfaces",
      // (the slices still with it)
      "drawCriticalSurface",
      "soilFills",
      "drawCentreMarkerPdf",
      "drawCriticalFosLabelPdf",
      "drawCustomSurfaceLabels",
      "drawReferenceLabelsPdf",
      "annotation:m",
      "annotation:t",
    ]);
    const critical = calls.find((c) => c.name === "drawCriticalSurface")!;
    expect(critical.args[6]).toEqual({ slices: true, center: false, fosLabel: false });
    expect(exportNamed({ layerOrder: ["r", "surfaces", "criticalSurface", "center", "slices", "fosLabel", "m", "t"] })).toContain("drawCriticalSlicesPdf");
  });

  it("draws a text annotation under the material table, and one under the model's layers", () => {
    expect(exportNamed({ layerOrder: ["soilColor", "r", "surfaces", "criticalSurface", "slices", "center", "fosLabel", "t", "m"] }).slice(-2)).toEqual([
      "annotation:t",
      "annotation:m",
    ]);
    // At the bottom, under the soil colours too (drawn as a layer after it).
    expect(exportNamed({ layerOrder: ["t", "soilColor", "r", "surfaces", "criticalSurface", "slices", "center", "fosLabel", "m"] })).toEqual([
      "regions:false",
      "annotation:t",
      "soilFills",
      "drawReferenceLinesPdf",
      "drawSlipSurfaces",
      "drawCriticalSurface",
      "drawCustomSurfaceLabels",
      "drawReferenceLabelsPdf",
      "annotation:m",
    ]);
  });
});
