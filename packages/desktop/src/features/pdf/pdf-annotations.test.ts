import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import type { AnalysisResult } from "@cslope/engine";
import { drawAnnotations, drawMaterialRegions } from "./pdf-drawing";
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

function record(anno: Annotation, result: AnalysisResult = RESULT) {
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
  const circle = pdf.circle.bind(pdf);
  let circles = 0;
  pdf.circle = ((...args: Parameters<typeof pdf.circle>) => {
    circles++;
    return circle(...args);
  }) as typeof pdf.circle;
  drawAnnotations(
    pdf,
    PAPER as never,
    [anno],
    result,
    MATERIALS,
    { enabled: false, lines: [], activeLineId: null, materialAssignment: {} },
    {},
    [],
    FRAME,
  );
  return { rects, fontSizes, circles };
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

  it("draws a slice plot annotation like the canvas does", () => {
    const anno = {
      id: "p",
      type: "plot",
      x: 0.5,
      y: 0.5,
      width: 0.24,
      height: 0.18,
    } as Annotation;
    const empty = record(anno);
    expect(empty.rects[0]).toMatchObject({ w: 297 * 0.24, h: 210 * 0.18 });

    const slice = (x: number) => ({
      x,
      weight: 50,
      cohesion: 5,
      frictionAngle: 30,
      baseLength: 1,
      normalForce: 40,
      alpha: 0.3,
      porePressure: 0,
    });
    const withSlices = record(anno, {
      ...RESULT,
      criticalSlices: [slice(1), slice(2), slice(3)],
    } as unknown as AnalysisResult);
    // Frame + chart box, and one marker per slice.
    expect(withSlices.rects.length).toBe(2);
    expect(withSlices.circles).toBe(3);

    // Right-to-left model: slices come in descending x, the axis still
    // runs from xMin (left) to xMax (right).
    const pdf = new jsPDF({ unit: "mm", format: [297, 210], orientation: "landscape" });
    const labels: { text: string; x: number }[] = [];
    const text = pdf.text.bind(pdf);
    pdf.text = ((t: string, x: number, ...rest: unknown[]) => {
      labels.push({ text: String(t), x });
      return (text as (...a: unknown[]) => jsPDF)(t, x, ...rest);
    }) as typeof pdf.text;
    drawAnnotations(
      pdf,
      PAPER as never,
      [{ ...anno, plotAxisX: "x" } as Annotation],
      { ...RESULT, criticalSlices: [slice(30), slice(20), slice(10)] } as unknown as AnalysisResult,
      MATERIALS,
      { enabled: false, lines: [], activeLineId: null, materialAssignment: {} },
      {},
      [],
      FRAME,
    );
    const left = labels.find((l) => l.text === "10.0")!;
    const right = labels.find((l) => l.text === "30.0")!;
    expect(left.x).toBeLessThan(right.x);
  });
});

describe("PDF material regions", () => {
  it("clips the hatch of a region with holes even-odd, like the canvas", () => {
    const pdf = new jsPDF({ unit: "mm", format: [297, 210], orientation: "landscape" });
    const rules: (string | undefined)[] = [];
    const clip = pdf.clip.bind(pdf);
    pdf.clip = ((rule?: "evenodd") => {
      rules.push(rule);
      return clip(rule);
    }) as typeof pdf.clip;
    const bedrock: MaterialRow = {
      ...MATERIALS[0],
      id: "rock",
      name: "Rock",
      model: { kind: "impenetrable", unitWeight: 22 },
    } as MaterialRow;
    const clay: MaterialRow = { ...MATERIALS[0], id: "clay" };
    const tf = {
      worldToPdf: (x: number, y: number) => [20 + x * 5, 150 - y * 5],
      canvasToPdf: (x: number, y: number) => [x, y],
      mmPerPx: 0.25,
      paperW: 297,
      paperH: 210,
    };
    drawMaterialRegions(
      pdf,
      tf as never,
      [[0, 0], [20, 0], [20, 20], [0, 20]],
      [bedrock, clay],
      [{ id: "b", coordinates: [[5, 5], [10, 5], [10, 10], [5, 10], [5, 5]] }],
      [
        { point: [2, 2], materialId: "rock" },
        { point: [7, 7], materialId: "clay" },
      ],
    );
    // Model clip (nonzero) + the hatched bedrock region with a hole.
    expect(rules).toContain("evenodd");
  });
});
