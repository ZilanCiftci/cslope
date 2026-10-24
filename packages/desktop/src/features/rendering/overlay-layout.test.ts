import { describe, expect, it } from "vitest";
import {
  arrowEdges,
  formatMagnitude,
  formatRange,
  groupTouchingStrips,
  loadHeightFraction,
  placeLabel,
  segmentHitsBox,
  type Box,
} from "./overlay-layout";

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });

describe("formatMagnitude", () => {
  it("rounds for display and keeps the digits a value has", () => {
    expect(formatMagnitude(20)).toBe("20");
    expect(formatMagnitude(20.5)).toBe("20.5");
    expect(formatMagnitude(23.94013)).toBe("23.9");
    expect(formatMagnitude(11.97006)).toBe("12.0");
    expect(formatMagnitude(5.125)).toBe("5.13");
    expect(formatMagnitude(2.5)).toBe("2.5");
    expect(formatMagnitude(150.4)).toBe("150");
    expect(formatMagnitude(-0.001)).toBe("0.00");
  });

  it("labels a range once, or a single value when the ends agree", () => {
    expect(formatRange(20.5, 39.5, "q", "kPa")).toBe("q = 20.5–39.5 kPa");
    expect(formatRange(20, 40, "q", "kPa")).toBe("q = 20–40 kPa");
    expect(formatRange(10.04, 20, "q", "kPa")).toBe("q = 10.0–20.0 kPa");
    expect(formatRange(12, 12.001, "q", "kPa")).toBe("q = 12.0 kPa");
  });
});

describe("groupTouchingStrips", () => {
  it("joins strips that touch end to end and keeps overlapping ones apart", () => {
    const strips = [
      { x1: 1, x2: 0.5, magnitude: 20 },
      { x1: 0, x2: 0.5, magnitude: 10 },
      { x1: 1, x2: 1.5, magnitude: 30 },
      { x1: 0.2, x2: 3, magnitude: 5 },
    ];
    const groups = groupTouchingStrips(strips);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ lo: 0, hi: 1.5, qMin: 10, qMax: 30 });
    expect(groups[0].strips.map((s) => s.magnitude)).toEqual([10, 20, 30]);
    expect(groups[1]).toMatchObject({ lo: 0.2, hi: 3, qMin: 5, qMax: 5 });
  });

  it("tolerates rounding in the strip ends", () => {
    const groups = groupTouchingStrips([
      { x1: 0, x2: 0.1 + 0.2, magnitude: 1 },
      { x1: 0.3, x2: 0.6, magnitude: 2 },
    ]);
    expect(groups).toHaveLength(1);
  });
});

describe("arrowEdges and loadHeightFraction", () => {
  it("keeps the outer edges and inner ones at least the spacing apart", () => {
    expect(arrowEdges([0, 10, 20, 30, 40], 60)).toEqual([0, 4]);
    expect(arrowEdges([0, 50, 100, 150, 200], 60)).toEqual([0, 2, 4]);
    expect(arrowEdges([5], 60)).toEqual([0]);
  });

  it("scales heights by magnitude with a minimum", () => {
    expect(loadHeightFraction(40, 40)).toBe(1);
    expect(loadHeightFraction(20, 40)).toBe(0.5);
    expect(loadHeightFraction(1, 40)).toBe(0.4);
    expect(loadHeightFraction(5, 0)).toBe(1);
  });
});

describe("placeLabel", () => {
  it("takes the first free candidate with the fewest obstacle crossings", () => {
    const placed = [box(0, 0, 10, 10)];
    const obstacle = [[20, -5, 20, 50]] as const;
    const chosen = placeLabel([box(5, 5, 10, 10), box(15, 0, 10, 10), box(30, 0, 10, 10)], placed, obstacle);
    expect(chosen).toEqual(box(30, 0, 10, 10));
    expect(placed).toHaveLength(2);
  });

  it("returns null when every candidate overlaps a placed label or is refused", () => {
    const placed = [box(0, 0, 100, 100)];
    expect(placeLabel([box(10, 10, 5, 5)], placed)).toBeNull();
    expect(placeLabel([box(200, 0, 5, 5)], placed, [], 0, () => false)).toBeNull();
  });

  it("clips segments against boxes", () => {
    expect(segmentHitsBox([0, 0, 10, 10], box(4, 4, 2, 2))).toBe(true);
    expect(segmentHitsBox([0, 0, 10, 0], box(4, 1, 2, 2))).toBe(false);
  });
});
