import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import type { AnalysisResult } from "@cslope/engine";
import { drawAnnotations } from "./pdf-drawing";
import type { Annotation, MaterialRow } from "../../store/types";

const PAPER = { paperW: 297, paperH: 210 };
const FRAME = { x: 0, y: 0, w: 297, h: 210 };
const SCALE = 210 / 600; // annotation scale in mm on A4 landscape

const RESULT = {
  minFOS: 1.1,
  maxFOS: 2.4,
  allSurfaces: [],
  criticalSlices: [],
  criticalSurface: null,
  method: "Bishop",
  elapsedMs: 1,
} as unknown as AnalysisResult;

const MATERIALS: MaterialRow[] = [
  {
    id: "m1",
    name: "Firm Clay",
    color: "#c084fc",
    modelExpressions: {},
    model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 8, frictionAngle: 28 },
  } as MaterialRow,
];

function record(anno: Annotation) {
  const pdf = new jsPDF({ unit: "mm", format: [297, 210], orientation: "landscape" });
  const rects: { w: number; h: number; style?: string | null }[] = [];
  const fontSizes: number[] = [];
  const rect = pdf.rect.bind(pdf);
  pdf.rect = ((x: number, y: number, w: number, h: number, style?: string | null) => {
    rects.push({ w, h, style });
    return rect(x, y, w, h, style);
  }) as typeof pdf.rect;
  const setFontSize = pdf.setFontSize.bind(pdf);
  pdf.setFontSize = ((size: number) => {
    fontSizes.push(size);
    return setFontSize(size);
  }) as typeof pdf.setFontSize;
  drawAnnotations(
    pdf,
    PAPER as never,
    [anno],
    RESULT,
    MATERIALS,
    { enabled: false, lines: [], activeLineId: null, materialAssignment: {} },
    {},
    [],
    FRAME,
  );
  return { rects, fontSizes };
}

describe("PDF annotations match the canvas proportions", () => {
  it("draws the material table at the canvas size (364 units wide)", () => {
    const { rects } = record({ id: "t", type: "material-table", x: 0.1, y: 0.1 } as Annotation);
    const outline = rects.find((r) => r.style === "FD")!;
    expect(outline.w).toBeCloseTo(364 * SCALE, 1); // ≈ 127 mm, was ≈ 35 mm
  });

  it("draws the colour bar 20 × 200 units, also for a single surface", () => {
    const { rects } = record({ id: "c", type: "color-bar", x: 0.8, y: 0.2 } as Annotation);
    const border = rects.find((r) => r.style === "S")!;
    expect(border.w).toBeCloseTo(20 * SCALE, 6);
    expect(border.h).toBeCloseTo(200 * SCALE, 6);
  });

  it("uses the annotation font size without an 8 pt floor", () => {
    const { fontSizes } = record({
      id: "x",
      type: "text",
      x: 0.5,
      y: 0.5,
      text: "small\nlines",
      fontSize: 6,
    } as Annotation);
    expect(fontSizes.at(-1)).toBeCloseTo((6 * SCALE) / 0.3528, 6);
  });
});
