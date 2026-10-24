import { describe, expect, it } from "vitest";
import { MIN_TICK_SPACING_MM, computeRulerStep, formatRulerLabel, resolveTickStep } from "./ruler";

describe("computeRulerStep", () => {
  it("returns a reasonable step for a typical A4 slope model", () => {
    // 25m world span, ~240mm inner frame, 297mm A4 paper
    const step = computeRulerStep(25, 240, 297);
    expect(step).toBeGreaterThanOrEqual(0.5);
    expect(step).toBeLessThanOrEqual(25);
    // Step should be a "nice" number (1, 2, 2.5, 5 times a power of ten)
    const normalised = step / Math.pow(10, Math.floor(Math.log10(step)));
    expect([1, 2, 2.5, 5, 10]).toContain(normalised);
  });

  it("returns a reasonable step for a large world span", () => {
    const step = computeRulerStep(500, 240, 297);
    expect(step).toBeGreaterThanOrEqual(10);
    expect(step).toBeLessThanOrEqual(500);
  });

  it("returns at least 0.01 for a very small world span", () => {
    expect(computeRulerStep(0.1, 240, 297)).toBe(0.01);
  });

  it("handles zero world span without throwing", () => {
    const step = computeRulerStep(0, 240, 297);
    expect(step).toBeGreaterThanOrEqual(0.01);
    expect(Number.isFinite(step)).toBe(true);
  });

  it("handles zero inner frame width without throwing", () => {
    const step = computeRulerStep(25, 0, 297);
    expect(Number.isFinite(step)).toBe(true);
    expect(step).toBeGreaterThanOrEqual(0.5);
  });

  it("spaces the labelled ticks far enough apart on the paper", () => {
    // A4 landscape plot area: 267 mm wide.
    // 0..240 m: every 20 (it was every 10, 11 mm apart).
    expect(computeRulerStep(269, 267, 297, [-14.5, 254.5])).toBe(20);
    // -3..20 m: every 2 (it was every 1).
    expect(computeRulerStep(25.8, 267, 297, [-4.4, 21.4])).toBe(2);
    // About 13 m: every 1 (it was every 0.5).
    expect(computeRulerStep(14.6, 267, 297, [3.8, 18.4])).toBe(1);
    for (const [span, lo] of [[3, 0], [25, -2], [130, 5], [700, -30]] as const) {
      const step = computeRulerStep(span, 267, 297, [lo, lo + span]);
      expect((step * 267) / span).toBeGreaterThanOrEqual(MIN_TICK_SPACING_MM - 1e-9);
    }
  });

  it("uses 2.5 steps and widens the spacing for long labels", () => {
    // 15 mm needs 2.2 m here: 2.5 is the next nice step.
    expect(computeRulerStep(39, 267, 297, [0, 39])).toBe(2.5);
    // Labels like 123402.5 need more than 15 mm.
    expect(computeRulerStep(39, 267, 297, [123400, 123439])).toBe(5);
  });

  it("handles negative inputs by taking absolute values", () => {
    const stepPos = computeRulerStep(25, 240, 297);
    const stepNeg = computeRulerStep(-25, -240, 297);
    expect(stepNeg).toBe(stepPos);
  });

  it("produces a larger step for A3 paper than A4 (same world span)", () => {
    const stepA4 = computeRulerStep(25, 240, 297);
    const stepA3 = computeRulerStep(25, 240, 420);
    // A3 is wider → raw step scales up → should produce >= A4 step
    expect(stepA3).toBeGreaterThanOrEqual(stepA4);
  });

  it("step always divides cleanly into grid lines", () => {
    const testCases = [
      { span: 25, frame: 240, paper: 297 },
      { span: 100, frame: 350, paper: 420 },
      { span: 3, frame: 200, paper: 297 },
    ];
    for (const { span, frame, paper } of testCases) {
      const step = computeRulerStep(span, frame, paper);
      // Step should produce at least 2 ticks across the span
      const ticks = span / step;
      expect(ticks).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("formatRulerLabel", () => {
  it("formats integers without decimals", () => {
    expect(formatRulerLabel(5)).toBe("5");
    expect(formatRulerLabel(100)).toBe("100");
    expect(formatRulerLabel(-10)).toBe("-10");
  });

  it("snaps near-zero values to 0", () => {
    expect(formatRulerLabel(1e-12)).toBe("0");
    expect(formatRulerLabel(-1e-12)).toBe("0");
    expect(formatRulerLabel(0)).toBe("0");
  });

  it("formats values close to integers as integers", () => {
    expect(formatRulerLabel(5.0000001)).toBe("5");
    expect(formatRulerLabel(9.9999999)).toBe("10");
  });

  it("formats decimal values with one decimal place", () => {
    expect(formatRulerLabel(2.5)).toBe("2.5");
    expect(formatRulerLabel(7.3)).toBe("7.3");
    expect(formatRulerLabel(-0.5)).toBe("-0.5");
  });

  it("rounds to one decimal place", () => {
    expect(formatRulerLabel(3.14159)).toBe("3.1");
    expect(formatRulerLabel(2.95)).toBe("3.0");
  });

  it("handles large numbers", () => {
    expect(formatRulerLabel(1000)).toBe("1000");
    expect(formatRulerLabel(999.5)).toBe("999.5");
  });
});

describe("formatRulerLabel with a tick step", () => {
  it("uses as many decimals as the step needs", () => {
    expect(formatRulerLabel(0.25, 0.25)).toBe("0.25");
    expect(formatRulerLabel(0.75, 0.25)).toBe("0.75");
    expect(formatRulerLabel(1.25, 0.25)).toBe("1.25");
    expect(formatRulerLabel(0.125, 0.125)).toBe("0.125");
    expect(formatRulerLabel(2, 0.25)).toBe("2");
    expect(formatRulerLabel(0.5, 0.5)).toBe("0.5");
  });
});

describe("resolveTickStep", () => {
  it("uses the user's spacing when it is sensible", () => {
    expect(resolveTickStep(2.5, 10)).toBe(2.5);
    expect(resolveTickStep(50, 10)).toBe(50);
  });
  it("falls back to auto for missing, invalid or far too dense spacing", () => {
    expect(resolveTickStep(undefined, 10)).toBe(10);
    expect(resolveTickStep(0, 10)).toBe(10);
    expect(resolveTickStep(-1, 10)).toBe(10);
    expect(resolveTickStep(Number.NaN, 10)).toBe(10);
    expect(resolveTickStep(0.001, 10)).toBe(10);
  });
});
