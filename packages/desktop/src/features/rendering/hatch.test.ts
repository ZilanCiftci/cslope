import { describe, expect, it, vi } from "vitest";
import { drawCanvasHatch, drawCanvasHatchLabel, drawPdfHatch, drawPdfHatchLabel } from "./hatch";
import type { HatchPattern } from "./style-spec";
import { MODEL_HATCH_PATTERNS } from "./style-spec";
import { createRecordingContext, pathPoints } from "../../test/recording-context";

const SQUARE: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

const pattern = (over: Partial<HatchPattern> = {}): HatchPattern => ({
  angle: 0,
  lineSpacing: 10,
  lineWidth: 1.5,
  color: { hex: "#123456", rgb: [18, 52, 86] },
  ...over,
});

/** Segments [x1, y1, x2, y2] from a path of alternating moveTo/lineTo. */
function segments(pts: [number, number][]) {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push([...pts[i], ...pts[i + 1]]);
  return out;
}

describe("drawCanvasHatch", () => {
  it("draws parallel lines at the pattern angle and spacing covering the polygon", () => {
    const rec = createRecordingContext();
    drawCanvasHatch(rec.ctx, SQUARE, pattern());
    const strokes = rec.strokes("#123456");
    expect(strokes).toHaveLength(1);
    expect(strokes[0].state.lineWidth).toBe(1.5);
    expect(strokes[0].state.globalAlpha).toBeCloseTo(0.45);
    const segs = segments(pathPoints(strokes[0]));
    // Horizontal lines: constant y per segment, 10 px apart.
    const ys = segs.map(([, y1, , y2]) => {
      expect(y1).toBeCloseTo(y2, 9);
      return y1;
    });
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(10, 9);
    // Every row inside the square is covered across its full width.
    for (let y = 0; y <= 100; y += 10) {
      const seg = segs.find((s) => Math.abs(s[1] - y) < 1e-9)!;
      expect(Math.min(seg[0], seg[2])).toBeLessThanOrEqual(0);
      expect(Math.max(seg[0], seg[2])).toBeGreaterThanOrEqual(100);
    }
    // Alpha is reset for the caller.
    expect(rec.ctx.globalAlpha).toBe(1);
  });

  it("adds a second line family for cross-hatching", () => {
    const rec = createRecordingContext();
    drawCanvasHatch(rec.ctx, SQUARE, pattern({ angle: 45, crossAngle: -45 }));
    const [a, b] = rec.strokes("#123456").map((p) => segments(pathPoints(p))[0]);
    const angle = ([x1, y1, x2, y2]: number[]) => (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    expect(angle(a)).toBeCloseTo(45, 9);
    expect(angle(b)).toBeCloseTo(-45, 9);
  });

  it("ignores degenerate polygons", () => {
    const rec = createRecordingContext();
    drawCanvasHatch(rec.ctx, SQUARE.slice(0, 2), pattern());
    drawCanvasHatchLabel(rec.ctx, SQUARE.slice(0, 2), "X");
    expect(rec.calls).toHaveLength(0);
  });
});

describe("drawCanvasHatchLabel", () => {
  it("draws the label on a white box at the vertex centroid", () => {
    const rec = createRecordingContext();
    drawCanvasHatchLabel(rec.ctx, SQUARE, "BR");
    expect(rec.depth()).toBe(0);
    expect(rec.findText("BR")).toMatchObject({ x: 50, y: 50 });
    const [box] = rec.callsOf("fillRect");
    const [x, y, w, h] = box.args as number[];
    expect(x + w / 2).toBeCloseTo(50, 9);
    expect(y + h / 2).toBeCloseTo(50, 9);
    expect(box.state.fillStyle).toBe("rgba(255,255,255,0.85)");
  });
});

function fakePdf() {
  return {
    line: vi.fn(),
    setDrawColor: vi.fn(),
    setLineWidth: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    setFillColor: vi.fn(),
    text: vi.fn(),
    getTextWidth: vi.fn((t: string) => t.length * 2),
    rect: vi.fn(),
  };
}

describe("drawPdfHatch", () => {
  it("strokes lines in the pattern colour scaled from px to mm", () => {
    const pdf = fakePdf();
    drawPdfHatch(pdf, SQUARE, pattern({ lineSpacing: 10 }), 0.5);
    expect(pdf.setDrawColor).toHaveBeenCalledWith(18, 52, 86);
    expect(pdf.setLineWidth).toHaveBeenCalledWith(0.75);
    const ys = pdf.line.mock.calls.map((c) => c[1] as number);
    // Spacing 10 px × 0.5 mm/px = 5 mm.
    expect(ys[1] - ys[0]).toBeCloseTo(5, 9);
  });

  it("draws twice as many lines with a cross angle", () => {
    const single = fakePdf();
    drawPdfHatch(single, SQUARE, pattern(), 1);
    const cross = fakePdf();
    drawPdfHatch(cross, SQUARE, pattern({ crossAngle: 90 }), 1);
    expect(cross.line.mock.calls.length).toBe(2 * single.line.mock.calls.length);
  });

  it("does nothing for fewer than three points", () => {
    const pdf = fakePdf();
    drawPdfHatch(pdf, SQUARE.slice(0, 2), pattern(), 1);
    drawPdfHatchLabel(pdf, SQUARE.slice(0, 2), "X", 1);
    expect(pdf.line).not.toHaveBeenCalled();
    expect(pdf.text).not.toHaveBeenCalled();
  });
});

describe("drawPdfHatchLabel", () => {
  it("centres the label on a white box at the centroid with a 10 px font", () => {
    const pdf = fakePdf();
    drawPdfHatchLabel(pdf, SQUARE, MODEL_HATCH_PATTERNS.impenetrable!.label!, 0.3528);
    // 10 px × 0.3528 mm/px = 3.528 mm = 10 pt.
    expect(pdf.setFontSize).toHaveBeenCalledWith(10);
    expect(pdf.setFillColor).toHaveBeenCalledWith(255, 255, 255);
    const [x, y, w, , style] = pdf.rect.mock.calls[0];
    expect(x + w / 2).toBeCloseTo(50, 9);
    expect(y).toBeLessThan(50);
    expect(style).toBe("F");
    const [text, tx, , opts] = pdf.text.mock.calls[0];
    expect(text).toBe("BR");
    expect(tx).toBe(50);
    expect(opts).toEqual({ align: "center" });
  });
});
