import { describe, expect, it } from "vitest";
import { defaultCustomCircle } from "./custom-plane";
import { surfaceYAtX } from "../features/view/surface";

describe("defaultCustomCircle", () => {
  it("puts the centre above the middle of the slope face", () => {
    // Crest at y 10 up to x 20, toe at y 0 from x 40, base at y -5.
    const model: [number, number][] = [
      [0, -5],
      [0, 10],
      [20, 10],
      [40, 0],
      [60, 0],
      [60, -5],
    ];
    const c = defaultCustomCircle(model);
    expect(c.cx).toBe(30);
    expect(c.cy).toBeGreaterThan(10);
    // Reaches below the toe level but stays above the base.
    expect(c.cy - c.radius).toBeLessThan(0);
    expect(c.cy - c.radius).toBeGreaterThan(-5);
    // Cuts the ground on both sides of the centre, inside the model.
    const cuts = [];
    for (let x = 0; x <= 60; x += 0.5) {
      const dy = c.cy - surfaceYAtX(model, x)!;
      cuts.push(Math.hypot(x - c.cx, dy) < c.radius);
    }
    expect(cuts[0]).toBe(false);
    expect(cuts.at(-1)).toBe(false);
    expect(cuts.some(Boolean)).toBe(true);
  });

  it("falls back to the model centre on flat ground", () => {
    const model: [number, number][] = [
      [0, 0],
      [0, 10],
      [50, 10],
      [50, 0],
    ];
    const c = defaultCustomCircle(model);
    expect(c.cx).toBe(25);
    expect(c.cy).toBeGreaterThan(10);
    expect(c.cy - c.radius).toBeLessThan(10);
  });

  it("keeps the old default without a model", () => {
    expect(defaultCustomCircle([])).toEqual({ cx: 0, cy: 0, radius: 10 });
  });
});
