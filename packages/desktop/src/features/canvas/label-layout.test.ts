import { describe, expect, it } from "vitest";
import {
  boxAround,
  boxesOverlap,
  clampBox,
  distanceToSegment,
  LabelLayout,
  outwardDirection,
  pointLabelCandidates,
  segmentHitsBox,
  segmentsCross,
  segmentsInside,
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

  it("offers the preferred direction first, then turning away from it and farther out, all clear of the point", () => {
    const up = pointLabelCandidates(200, 150, 60, 13, false, 6);
    // Straight above, centred, with a gap over the symbol.
    expect(up[0].bottom).toBe(150 - 9);
    expect((up[0].left + up[0].right) / 2).toBe(200);
    // Then the directions next to it, on either side.
    expect(up[1].bottom).toBeLessThan(150);
    expect(up[2].bottom).toBeLessThan(150);
    expect(Math.sign((up[1].left + up[1].right) / 2 - 200)).toBe(-Math.sign((up[2].left + up[2].right) / 2 - 200));
    // Straight below comes last among the near ring.
    const down = pointLabelCandidates(200, 150, 60, 13, true, 6);
    expect(down[0].top).toBe(150 + 9);
    // A diagonal preference puts the box at the corner.
    const corner = pointLabelCandidates(200, 150, 60, 13, [Math.SQRT1_2, -Math.SQRT1_2], 6)[0];
    expect(corner).toEqual({ left: 209, top: 150 - 9 - 13, right: 269, bottom: 141 });
    // Three rings of 16 directions, none on the point.
    expect(up).toHaveLength(48);
    for (const c of [...up, ...down]) expect(boxesOverlap(c, boxAround(200, 150, 6), 0)).toBe(false);
  });

  it("keeps labels off reserved segments by their half-width", () => {
    const layout = new LabelLayout(BOUNDS);
    layout.reserveSegment([0, 100, 400, 100], 3);
    expect(layout.isFree({ left: 10, top: 80, right: 60, bottom: 96 })).toBe(true);
    expect(layout.isFree({ left: 10, top: 80, right: 60, bottom: 98 })).toBe(false);
    expect(layout.isFree({ left: 10, top: 90, right: 60, bottom: 110 })).toBe(false);
    // A closed polyline also reserves its closing segment.
    const square = new LabelLayout(BOUNDS);
    square.reservePolyline(
      [
        [100, 100],
        [200, 100],
        [200, 200],
        [100, 200],
      ],
      2,
      true,
    );
    expect(square.isFree({ left: 90, top: 140, right: 110, bottom: 160 })).toBe(false);
    expect(square.isFree({ left: 120, top: 120, right: 180, bottom: 180 })).toBe(true);
    expect(segmentHitsBox([0, 0, 10, 10], { left: 4, top: 4, right: 6, bottom: 6 })).toBe(true);
  });

  it("points away from the fill at a polygon's vertices", () => {
    // A square in canvas coordinates (y down).
    const sq: [number, number][] = [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ];
    const inside = (x: number, y: number) => x > 100 && x < 200 && y > 100 && y < 200;
    const [dx, dy] = outwardDirection(sq, 0, inside);
    expect(dx).toBeCloseTo(-Math.SQRT1_2);
    expect(dy).toBeCloseTo(-Math.SQRT1_2);
    const [ex, ey] = outwardDirection(sq, 2, inside);
    expect(ex).toBeCloseTo(Math.SQRT1_2);
    expect(ey).toBeCloseTo(Math.SQRT1_2);
    // A straight vertex: perpendicular to the edge, outwards (up).
    const flat: [number, number][] = [
      [100, 100],
      [150, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ];
    const [fx, fy] = outwardDirection(flat, 1, inside);
    expect(fx).toBeCloseTo(0);
    expect(fy).toBeCloseTo(-1);
  });

  it("clips a polyline to the inside of a polygon", () => {
    const sq: [number, number][] = [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ];
    const inside = (x: number, y: number) => x > 100 && x < 200 && y > 100 && y < 200;
    const segs = segmentsInside(
      [
        [50, 150],
        [250, 150],
      ],
      sq,
      inside,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0][0]).toBeCloseTo(100);
    expect(segs[0][2]).toBeCloseTo(200);
    // Along an edge counts as inside.
    expect(segmentsInside([[100, 120], [100, 180]], sq, inside)).toHaveLength(1);
    expect(segmentsInside([[0, 0], [50, 50]], sq, inside)).toHaveLength(0);
  });
});

describe("leader lines", () => {
  it("tells whether two segments cross", () => {
    expect(segmentsCross([0, 0, 10, 10], [0, 10, 10, 0])).toBe(true);
    expect(segmentsCross([0, 0, 10, 0], [0, 1, 10, 1])).toBe(false);
    expect(segmentsCross([0, 0, 10, 0], [5, 0, 15, 0])).toBe(true);
    expect(segmentsCross([0, 0, 4, 0], [5, -1, 5, 1])).toBe(false);
  });

  it("finds a leader crossing a reserved line or box", () => {
    const layout = new LabelLayout({ left: 0, top: 0, right: 100, bottom: 100 });
    layout.reserveSegment([50, 0, 50, 100]);
    layout.reserve({ left: 10, top: 80, right: 20, bottom: 90 });
    expect(layout.crossesLine([40, 10, 60, 10])).toBe(true);
    expect(layout.crossesLine([0, 85, 30, 85])).toBe(true);
    expect(layout.crossesLine([10, 10, 40, 40])).toBe(false);
  });
});
