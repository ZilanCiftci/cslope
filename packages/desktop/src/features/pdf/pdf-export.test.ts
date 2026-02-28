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
      regionMaterials: {},
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
      piezometricLine: { enabled: false, lines: [] },
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
});
