import { describe, expect, it } from "vitest";
import { axisTicks, tickLabel } from "./plotAxis";

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
