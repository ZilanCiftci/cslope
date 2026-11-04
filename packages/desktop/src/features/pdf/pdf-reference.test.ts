import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { drawReferenceLabelsPdf, drawReferenceLinesPdf } from "./pdf-reference";
import type { PdfTransform } from "./pdf-helpers";
import type { ReferenceAnnotation } from "../../store/types";
import { REFERENCE_ANNOTATION_COLOR } from "../rendering/style-spec";

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
const BOUNDS = { left: 10, top: 10, right: 287, bottom: 200 };

const LINE: ReferenceAnnotation = {
  id: "l",
  type: "reference",
  shape: "polyline",
  points: [[2, 10], [12, 4], [22, 5]],
  label: "F = 0.664 (other program)",
  dash: "dashed",
  width: 2,
};
const CIRCLE: ReferenceAnnotation = { id: "c", type: "reference", shape: "circle", cx: 15, cy: 14, radius: 10, color: "#ff0000", label: "paper" };

type Call = { name: string; args: unknown[] };

function recorder() {
  const pdf = new jsPDF({ unit: "mm", format: [297, 210], orientation: "landscape" });
  const calls: Call[] = [];
  for (const name of ["setDrawColor", "setLineWidth", "setLineDashPattern", "setLineCap", "moveTo", "lineTo", "stroke", "rect", "text", "setTextColor", "setFillColor"]) {
    const original = (pdf as unknown as Record<string, (...a: unknown[]) => unknown>)[name].bind(pdf);
    (pdf as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls.push({ name, args });
      return original(...args);
    };
  }
  return { pdf, calls, of: (name: string) => calls.filter((c) => c.name === name) };
}

describe("reference annotations in the PDF", () => {
  it("strokes a polyline through its points with its width, dash and the default colour", () => {
    const { pdf, of } = recorder();
    const drawn = drawReferenceLinesPdf(pdf, tf, [{ id: "t", type: "text", x: 0, y: 0 }, LINE], COORDS);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].pts).toEqual([
      [30, 100],
      [80, 130],
      [130, 125],
    ]);
    expect(of("setDrawColor")[0].args).toEqual(REFERENCE_ANNOTATION_COLOR.rgb);
    expect(of("setLineWidth")[0].args).toEqual([0.5]);
    // Dashed for width 2: [10, 6] px → mm; reset after.
    expect(of("setLineDashPattern").map((c) => c.args[0])).toEqual([[2.5, 1.5], []]);
    expect(of("moveTo")).toHaveLength(1);
    expect(of("lineTo")).toHaveLength(2);
    expect(of("stroke")).toHaveLength(1);
  });

  it("strokes the arc of a circle below the ground in its own colour", () => {
    const { pdf, of } = recorder();
    const [d] = drawReferenceLinesPdf(pdf, tf, [CIRCLE], COORDS);
    expect(of("setDrawColor")[0].args).toEqual([255, 0, 0]);
    expect(d.pts.length).toBeGreaterThan(8);
    for (const [mx, my] of d.pts) {
      const x = (mx - 20) / 5;
      const y = (150 - my) / 5;
      expect(Math.hypot(x - 15, y - 14)).toBeCloseTo(10, 6);
      expect(y).toBeLessThan(10 + 1e-6);
    }
  });

  it("labels the lines on a white plate in the line's colour, clear of the FOS label", () => {
    const { pdf, of } = recorder();
    const drawn = drawReferenceLinesPdf(pdf, tf, [LINE, CIRCLE], COORDS);
    const cs = { cx: 15, cy: 14, radius: 10, fos: 1.234, entryPoint: [7, 10] as [number, number], exitPoint: [22, 5] as [number, number] };
    const boxes = drawReferenceLabelsPdf(pdf, tf, drawn, { coordinates: COORDS, criticalSurface: cs, showFosLabel: true, bounds: BOUNDS });
    expect(boxes).toHaveLength(2);
    const texts = of("text").map((c) => c.args[0]);
    expect(texts).toEqual(["F = 0.664 (other program)", "paper"]);
    expect(of("rect").filter((c) => c.args[4] === "F")).toHaveLength(2);
    expect(of("setTextColor").map((c) => c.args)).toEqual([REFERENCE_ANNOTATION_COLOR.rgb, [255, 0, 0], [0, 0, 0]]);
    // The circle's label sits below its lowest point (15, 4) → (95, 130) mm,
    // moved aside where the critical surface (the same circle) runs.
    const circleBox = boxes[1];
    expect(circleBox.top).toBeGreaterThan(130);
    expect(Math.abs((circleBox.left + circleBox.right) / 2 - 95)).toBeLessThan(12);
    // Both inside the plot area and apart.
    for (const b of boxes) {
      expect(b.left).toBeGreaterThanOrEqual(BOUNDS.left);
      expect(b.bottom).toBeLessThanOrEqual(BOUNDS.bottom);
    }
    expect(boxes[0].bottom <= boxes[1].top || boxes[1].bottom <= boxes[0].top || boxes[0].right <= boxes[1].left || boxes[1].right <= boxes[0].left).toBe(true);
  });

  it("draws no label without text or without a drawn line", () => {
    const { pdf, of } = recorder();
    const drawn = drawReferenceLinesPdf(pdf, tf, [{ ...LINE, label: "  " }, { ...CIRCLE, cy: 40 }], COORDS);
    expect(drawn[1].pts).toEqual([]);
    expect(drawReferenceLabelsPdf(pdf, tf, drawn, { coordinates: COORDS, bounds: BOUNDS })).toEqual([]);
    expect(of("text")).toHaveLength(0);
  });
});
