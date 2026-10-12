import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_MATERIAL,
  DEFAULT_RESULT_VIEW_SETTINGS,
} from "../../store/defaults";

interface PdfWithSavedFilename {
  __savedFilename?: string;
  getNumberOfPages: () => number;
}

const { pdfInstances } = vi.hoisted(() => ({
  pdfInstances: [] as PdfWithSavedFilename[],
}));

vi.mock("jspdf", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("jspdf");

  class WrappedJsPdf extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      pdfInstances.push(this as unknown as PdfWithSavedFilename);

      this.save = ((filename: string) => {
        (this as unknown as PdfWithSavedFilename).__savedFilename = filename;
        return this;
      }) as unknown as typeof this.save;
    }
  }

  return {
    ...actual,
    jsPDF: WrappedJsPdf,
  };
});

import { exportVectorPdf, type PdfExportData } from "./pdf-export";

afterEach(() => {
  pdfInstances.length = 0;
  vi.restoreAllMocks();
});

describe("exportVectorPdf", () => {
  it("generates a sample PDF without throwing and with one page", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const data: PdfExportData = {
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
        maxFOS: 1.6,
        criticalSurface: {
          cx: 10,
          cy: 12,
          radius: 10,
          fos: 1.2,
          entryPoint: [2, 8],
          exitPoint: [18, 2],
          converged: true,
        },
        allSurfaces: [
          {
            cx: 10,
            cy: 12,
            radius: 10,
            fos: 1.2,
            entryPoint: [2, 8],
            exitPoint: [18, 2],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 123,
      },
      resultViewSettings: {
        ...DEFAULT_RESULT_VIEW_SETTINGS,
        annotations: [],
      },
      piezometricLine: {
        enabled: false,
        lines: [],
        activeLineId: null,
        materialAssignment: {},
      },
      udls: [],
      lineLoads: [],
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
      orientation: "ltr",
      projectInfo: { title: "PDF Test Model" } as PdfExportData["projectInfo"],
    };

    expect(() => exportVectorPdf(data)).not.toThrow();
    expect(pdfInstances).toHaveLength(1);
    const doc = pdfInstances[0];
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.__savedFilename).toBe("PDF Test Model.pdf");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("alerts and returns early when result has no surfaces", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const data: PdfExportData = {
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
        minFOS: 0,
        maxFOS: 0,
        criticalSurface:
          null as unknown as PdfExportData["result"]["criticalSurface"],
        allSurfaces: [],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 0,
      },
      resultViewSettings: {
        ...DEFAULT_RESULT_VIEW_SETTINGS,
        annotations: [],
      },
      piezometricLine: {
        enabled: false,
        lines: [],
        activeLineId: null,
        materialAssignment: {},
      },
      udls: [],
      lineLoads: [],
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
      orientation: "ltr",
      projectInfo: { title: "Empty Result" } as PdfExportData["projectInfo"],
    };

    exportVectorPdf(data);
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("No analysis results"),
    );
    // No PDF should have been created
    expect(pdfInstances).toHaveLength(0);
  });

  it("alerts and returns early when result has no critical surface", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const data: PdfExportData = {
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
        maxFOS: 1.6,
        criticalSurface:
          null as unknown as PdfExportData["result"]["criticalSurface"],
        allSurfaces: [
          {
            cx: 10,
            cy: 12,
            radius: 10,
            fos: 1.2,
            entryPoint: [2, 8],
            exitPoint: [18, 2],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 100,
      },
      resultViewSettings: {
        ...DEFAULT_RESULT_VIEW_SETTINGS,
        annotations: [],
      },
      piezometricLine: {
        enabled: false,
        lines: [],
        activeLineId: null,
        materialAssignment: {},
      },
      udls: [],
      lineLoads: [],
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
      orientation: "ltr",
      projectInfo: { title: "No Critical" } as PdfExportData["projectInfo"],
    };

    exportVectorPdf(data);
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("No analysis results"),
    );
    expect(pdfInstances).toHaveLength(0);
  });

  it("generates PDF with default filename when projectInfo is missing", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(window, "alert").mockImplementation(() => {});

    const data: PdfExportData = {
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
        maxFOS: 1.6,
        criticalSurface: {
          cx: 10,
          cy: 12,
          radius: 10,
          fos: 1.2,
          entryPoint: [2, 8],
          exitPoint: [18, 2],
          converged: true,
        },
        allSurfaces: [
          {
            cx: 10,
            cy: 12,
            radius: 10,
            fos: 1.2,
            entryPoint: [2, 8],
            exitPoint: [18, 2],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 123,
      },
      resultViewSettings: {
        ...DEFAULT_RESULT_VIEW_SETTINGS,
        annotations: [],
      },
      piezometricLine: {
        enabled: false,
        lines: [],
        activeLineId: null,
        materialAssignment: {},
      },
      udls: [],
      lineLoads: [],
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
      orientation: "ltr",
    };

    expect(() => exportVectorPdf(data)).not.toThrow();
    expect(pdfInstances).toHaveLength(1);
    // Without projectInfo.title, filename should fall back to default
    const doc = pdfInstances[0];
    expect(doc.__savedFilename).toMatch(/\.pdf$/);
  });
});

describe("exportVectorPdf with free water", () => {
  it("exports a piezometric line standing above the ground (free water)", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const surface = {
      cx: 10,
      cy: 12,
      radius: 10,
      fos: 1.2,
      entryPoint: [2, 8] as [number, number],
      exitPoint: [18, 2] as [number, number],
    };
    exportVectorPdf({
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
        maxFOS: 1.6,
        criticalSurface: surface,
        allSurfaces: [surface],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 1,
      },
      resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [] },
      // Water table at y = 7: a pond over the toe where the ground is at y = 5.
      piezometricLine: {
        enabled: true,
        lines: [
          {
            id: "w",
            name: "W",
            color: "#00f",
            coordinates: [
              [0, 7],
              [20, 7],
            ],
          },
        ],
        activeLineId: "w",
        materialAssignment: {},
      },
      udls: [],
      lineLoads: [],
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
      orientation: "ltr",
      projectInfo: { title: "Pond" } as PdfExportData["projectInfo"],
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(pdfInstances).toHaveLength(1);
    expect(pdfInstances[0].__savedFilename).toBe("Pond.pdf");
  });
});
