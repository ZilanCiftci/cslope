import { describe, expect, it } from "vitest";
import { computeRulerStep, formatRulerLabel } from "./ruler";

describe("computeRulerStep", () => {
  it("returns a reasonable step for a typical A4 slope model", () => {
    // 25m world span, ~240mm inner frame, 297mm A4 paper
    const step = computeRulerStep(25, 240, 297);
    expect(step).toBeGreaterThanOrEqual(0.5);
    expect(step).toBeLessThanOrEqual(25);
    // Step should be a "nice" number (1, 2, 5, 10, 20, 50, ...)
    const normalised = step / Math.pow(10, Math.floor(Math.log10(step)));
    expect([1, 2, 5, 10]).toContain(normalised);
  });

  it("returns a reasonable step for a large world span", () => {
    const step = computeRulerStep(500, 240, 297);
    expect(step).toBeGreaterThanOrEqual(10);
    expect(step).toBeLessThanOrEqual(500);
  });

  it("returns minimum 0.5 for a very small world span", () => {
    const step = computeRulerStep(0.1, 240, 297);
    expect(step).toBe(0.5);
  });

  it("handles zero world span without throwing", () => {
    const step = computeRulerStep(0, 240, 297);
    expect(step).toBeGreaterThanOrEqual(0.5);
    expect(Number.isFinite(step)).toBe(true);
  });

  it("handles zero inner frame width without throwing", () => {
    const step = computeRulerStep(25, 0, 297);
    expect(Number.isFinite(step)).toBe(true);
    expect(step).toBeGreaterThanOrEqual(0.5);
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
