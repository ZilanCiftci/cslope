import { describe, expect, it } from "vitest";
import { fosColor } from "./fos-color";

describe("fosColor", () => {
  it("returns a valid hex color string", () => {
    const color = fosColor(1.5);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("returns red-ish at the minimum FOS (0.5)", () => {
    const color = fosColor(0.5);
    // At t=0 the scale starts at red → high R, low G, low B
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
  });

  it("returns blue-ish at the maximum FOS (3.0)", () => {
    const color = fosColor(3.0);
    const b = parseInt(color.slice(5, 7), 16);
    expect(b).toBeGreaterThan(200);
  });

  it("returns a mid-scale color for FOS around 1.75", () => {
    const color = fosColor(1.75);
    // Mid scale → should be in the yellow-green range, not pure red or pure blue
    const r = parseInt(color.slice(1, 3), 16);
    const b = parseInt(color.slice(5, 7), 16);
    // Not dominated by either extreme
    expect(r).toBeLessThan(255);
    expect(b).toBeLessThan(200);
  });

  it("clamps below minimum to red", () => {
    const atMin = fosColor(0.5);
    const below = fosColor(-10);
    expect(below).toBe(atMin);
  });

  it("clamps above maximum to blue", () => {
    const atMax = fosColor(3.0);
    const above = fosColor(100);
    expect(above).toBe(atMax);
  });

  it("accepts custom min/max range", () => {
    const color = fosColor(1.0, 0, 2.0); // t = 0.5
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    // At midpoint of red-yellow-green-blue, should be greenish
    const g = parseInt(color.slice(3, 5), 16);
    expect(g).toBeGreaterThan(100);
  });

  it("handles min === max without crashing", () => {
    const color = fosColor(1.0, 1.0, 1.0);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("produces different colors for different FOS values", () => {
    const c1 = fosColor(0.5);
    const c2 = fosColor(1.5);
    const c3 = fosColor(3.0);
    expect(c1).not.toBe(c2);
    expect(c2).not.toBe(c3);
    expect(c1).not.toBe(c3);
  });

  it("is monotonically transitioning across the range", () => {
    // Blue channel should generally increase from min to max
    const values = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const blues = values.map((v) => {
      const c = fosColor(v);
      return parseInt(c.slice(5, 7), 16);
    });
    // Overall trend: last should be much higher than first
    expect(blues[blues.length - 1]).toBeGreaterThan(blues[0]);
  });
});
