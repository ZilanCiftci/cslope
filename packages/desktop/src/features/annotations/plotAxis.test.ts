import { describe, expect, it } from "vitest";
import { axisTicks, chartAxis, tickLabel } from "./plotAxis";

describe("axisTicks", () => {
  it("widens the range to round steps and labels them with the step's decimals", () => {
    const t = axisTicks(4.12, 22.58, 5);
    expect(t.step).toBe(5);
    expect([t.min, t.max]).toEqual([0, 25]);
    expect(t.values).toEqual([0, 5, 10, 15, 20, 25]);
    expect(t.decimals).toBe(0);
    expect(tickLabel(15, t)).toBe("15");
  });

  it("uses decimals for small steps", () => {
    const t = axisTicks(0.37, 1.02, 5);
    expect(t.step).toBe(0.2);
    expect(t.values).toEqual([0.2, 0.4, 0.6, 0.8, 1, 1.2]);
    expect(tickLabel(0.6, t)).toBe("0.6");
  });

  it("keeps whole steps for slice numbers", () => {
    const t = axisTicks(1, 3, 5, true);
    expect(t.step).toBe(1);
    expect(t.values).toEqual([1, 2, 3]);
    const many = axisTicks(1, 30, 5, true);
    expect(many.step).toBe(10);
    expect(many.values).toEqual([0, 10, 20, 30]);
  });

  it("opens up a flat range instead of dividing by zero", () => {
    const t = axisTicks(7, 7);
    expect(t.min).toBeLessThan(7);
    expect(t.max).toBeGreaterThan(7);
    expect(t.values.length).toBeGreaterThan(1);
  });
});

describe("chartAxis (#71)", () => {
  /** The Results plot's labels before: three decimals, trailing zeros dropped. */
  const threeDecimals = (v: number) => v.toFixed(3).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "");

  it("gives every tick its own label on a small range (Fm and Ff of the dam, λ plot)", () => {
    const axis = chartAxis(1.9495, 1.9512, { minDecimals: 3, trim: true });
    const labels = axis.ticks.map(axis.label);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(new Set(labels).size).toBe(labels.length);
    expect(axis.decimals).toBe(4);
    expect(labels).toEqual(["1.9495", "1.95", "1.9505", "1.951", "1.9515"]);
    // Three decimals alone repeat at this step.
    const before = axis.ticks.map(threeDecimals);
    expect(new Set(before).size).toBeLessThan(before.length);
    // The range covers the data.
    expect(axis.domain[0]).toBeLessThanOrEqual(1.9495);
    expect(axis.domain[1]).toBeGreaterThanOrEqual(1.9512);
  });

  it("keeps the axis's own decimals on a usual range", () => {
    const f = chartAxis(1.21, 1.63, { minDecimals: 3, trim: true });
    expect(f.ticks.map(f.label)).toEqual(["1.2", "1.3", "1.4", "1.5", "1.6", "1.7"]);
    const s = chartAxis(1, 1.63, { minDecimals: 2 });
    expect(s.ticks.map(s.label)).toEqual(["1.00", "1.20", "1.40", "1.60", "1.80"]);
  });

  it("adds decimals near 1.0 where the Sensitivity and Probabilistic axes need them", () => {
    const s = chartAxis(1, 1.003, { minDecimals: 2 });
    const labels = s.ticks.map(s.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(["1.000", "1.001", "1.002", "1.003"]);
  });
});
