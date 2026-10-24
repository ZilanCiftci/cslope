import { describe, expect, it } from "vitest";
import {
  boxAround,
  boxesOverlap,
  clampBox,
  distanceToSegment,
  LabelLayout,
  pointLabelCandidates,
  type Box,
} from "./label-layout";

const BOUNDS: Box = { left: 0, top: 0, right: 400, bottom: 300 };

describe("label layout", () => {
  it("detects overlap with a clearance", () => {
    const a: Box = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(boxesOverlap(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true);
    expect(boxesOverlap(a, { left: 10.5, top: 0, right: 20, bottom: 10 })).toBe(true);
    expect(boxesOverlap(a, { left: 12, top: 0, right: 20, bottom: 10 })).toBe(false);
    expect(boxesOverlap(a, { left: 0, top: 12, right: 10, bottom: 20 })).toBe(false);
  });

  it("moves a box inside the bounds", () => {
    expect(clampBox({ left: -5, top: -3, right: 15, bottom: 7 }, BOUNDS)).toEqual({ left: 0, top: 0, right: 20, bottom: 10 });
    expect(clampBox({ left: 395, top: 295, right: 415, bottom: 305 }, BOUNDS)).toEqual({
      left: 380,
      top: 290,
      right: 400,
      bottom: 300,
    });
  });

  it("measures the distance to a segment", () => {
    expect(distanceToSegment(5, 3, [0, 0], [10, 0])).toBe(3);
    expect(distanceToSegment(-4, 3, [0, 0], [10, 0])).toBe(5);
    expect(distanceToSegment(1, 1, [0, 0], [0, 0])).toBeCloseTo(Math.SQRT2);
  });

  it("takes the first free candidate and reserves it", () => {
    const layout = new LabelLayout(BOUNDS);
    const a: Box = { left: 10, top: 10, right: 50, bottom: 20 };
    const b: Box = { left: 10, top: 30, right: 50, bottom: 40 };
    expect(layout.place([a, b])).toEqual(a);
    expect(layout.place([a, b])).toEqual(b);
    // Both taken: left out, unless forced (then the first candidate).
    expect(layout.place([a, b])).toBeNull();
    expect(layout.place([a, b], true)).toEqual(a);
  });

  it("avoids reserved boxes", () => {
    const layout = new LabelLayout(BOUNDS);
    layout.reserve(boxAround(100, 100, 6));
    const candidates = pointLabelCandidates(100, 100, 60, 13, false);
    const placed = layout.place(candidates)!;
    expect(placed).toEqual(candidates[0]);
    expect(boxesOverlap(placed, boxAround(100, 100, 6))).toBe(false);
  });

  it("offers the preferred side first, then the other side, sides and diagonals, all clear of the point", () => {
    const up = pointLabelCandidates(200, 150, 60, 13, false, 6);
    expect(up[0].bottom).toBeLessThan(150);
    expect((up[0].left + up[0].right) / 2).toBe(200);
    expect(up[1].top).toBeGreaterThan(150);
    expect(up[2].left).toBeGreaterThan(200);
    expect(up[3].right).toBeLessThan(200);
    const down = pointLabelCandidates(200, 150, 60, 13, true, 6);
    expect(down[0]).toEqual(up[1]);
    expect(down[1]).toEqual(up[0]);
    for (const c of [...up, ...down]) expect(boxesOverlap(c, boxAround(200, 150, 6), 0)).toBe(false);
  });
});
