import { describe, expect, it } from "vitest";
import { circleEntryExit, crackCutX, defaultCustomCircle, prescribedPath } from "./custom-plane";
import { surfaceYAtX } from "../features/view/surface";
import {
  analyseSlope,
  buildSlope,
  toCanonicalSlopeDefinition,
} from "@cslope/engine";

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

  describe("on an embankment, the face falling in the sliding direction", () => {
    // Rising face x 10-20, crest y 10 from x 20 to 30, falling face x 30-40.
    const embankment: [number, number][] = [
      [0, 0],
      [0, 5],
      [10, 5],
      [20, 10],
      [30, 10],
      [40, 5],
      [50, 5],
      [50, 0],
    ];

    function fosOnlyThisPlane(orientation: "ltr" | "rtl") {
      const plane = defaultCustomCircle(embankment, orientation);
      // The engine works on the canonical (left to right) definition.
      const slope = buildSlope(
        toCanonicalSlopeDefinition({
          orientation,
          coordinates: embankment,
          materials: [
            { name: "Fill", unitWeight: 19, cohesion: 5, frictionAngle: 30 },
          ],
          customSearchPlanes: [plane],
          customPlanesOnly: true,
        }),
      );
      return { plane, fos: analyseSlope(slope) };
    }

    it("left to right: the right face (ground drops as x increases)", () => {
      const { plane, fos } = fosOnlyThisPlane("ltr");
      expect(plane.cx).toBe(35);
      expect(plane.cy).toBeGreaterThan(10);
      expect(plane.cy - plane.radius).toBeLessThan(5);
      expect(plane.cy - plane.radius).toBeGreaterThan(0);
      expect(fos).not.toBeNull();
      expect(fos!).toBeGreaterThan(0);
    });

    it("right to left: the left face (ground drops as x decreases)", () => {
      const { plane, fos } = fosOnlyThisPlane("rtl");
      expect(plane.cx).toBe(15);
      expect(plane.cy).toBeGreaterThan(10);
      expect(plane.cy - plane.radius).toBeLessThan(5);
      expect(fos).not.toBeNull();
      expect(fos!).toBeGreaterThan(0);
    });
  });

  it("keeps the old default without a model", () => {
    expect(defaultCustomCircle([])).toEqual({ cx: 0, cy: 0, radius: 10 });
  });
});

describe("circleEntryExit", () => {
  const model: [number, number][] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [20, 5],
    [30, 5],
    [30, 0],
  ];

  it("gives where the lower arc enters the ground and leaves it again", () => {
    const ends = circleEntryExit(model, 15, 14, 10)!;
    expect(ends[0][0]).toBeCloseTo(15 - Math.sqrt(84), 9);
    expect(ends[0][1]).toBeCloseTo(10, 9);
    expect(ends[1][0]).toBeGreaterThan(19);
    expect(ends[1][0]).toBeLessThan(20);
    expect(ends[1][1]).toBeCloseTo(surfaceYAtX(model, ends[1][0])!, 9);
    // The same, mirrored, for a right-to-left model.
    const mirrored = circleEntryExit(model, 15, 14, 10, true)!;
    expect(mirrored[0][0]).toBeCloseTo(ends[1][0], 9);
    expect(mirrored[1][0]).toBeCloseTo(ends[0][0], 9);
  });

  it("is null for a circle that misses the ground or has no radius", () => {
    expect(circleEntryExit(model, 15, 30, 5)).toBeNull();
    expect(circleEntryExit(model, 15, 14, 0)).toBeNull();
    expect(circleEntryExit([], 15, 14, 10)).toBeNull();
  });
});

describe("prescribedPath", () => {
  // Crest at y 10 up to x 10, face down to y 5 at x 20, base at y 0.
  const model: [number, number][] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [20, 5],
    [30, 5],
    [30, 0],
  ];
  const circle = { cx: 18, cy: 16, radius: 13 };

  it("runs a circle from its entry to its exit without a crack", () => {
    const ends = circleEntryExit(model, circle.cx, circle.cy, circle.radius)!;
    const p = prescribedPath(model, circle, 0);
    expect(p.unusable).toBe(false);
    expect(p.crack).toBeNull();
    expect(p.points[0][0]).toBeCloseTo(ends[0][0], 6);
    expect(p.points.at(-1)![0]).toBeCloseTo(ends[1][0], 6);
  });

  it("starts a circle at the base of a fixed-depth crack, as the analysis does", () => {
    const p = prescribedPath(model, circle, 2);
    expect(p.unusable).toBe(false);
    const { x, top, bottom } = p.crack!;
    expect(top).toBeCloseTo(surfaceYAtX(model, x)!, 9);
    expect(top - bottom).toBeCloseTo(2, 6);
    // The surface enters there, past the circle's own entry.
    const ends = circleEntryExit(model, circle.cx, circle.cy, circle.radius)!;
    expect(x).toBeGreaterThan(ends[0][0]);
    expect(p.points[0][0]).toBeCloseTo(x, 6);
    expect(p.points[0][1]).toBeCloseTo(bottom, 6);
    expect(p.points.at(-1)![0]).toBeCloseTo(ends[1][0], 6);
    // Never that deep: no surface.
    expect(prescribedPath(model, circle, 50).unusable).toBe(true);
  });

  it("cuts a polyline at the crack, from the right in a right-to-left model", () => {
    const poly = { cx: 0, cy: 0, radius: 0, points: [[2, 10], [8, 4], [22, 5]] as [number, number][] };
    const p = prescribedPath(model, poly, 2);
    expect(p.crack!.x).toBeCloseTo(4, 6);
    expect(p.points[0]).toEqual([p.crack!.x, p.crack!.bottom]);
    expect(p.points.slice(1)).toEqual([[8, 4], [22, 5]]);
    const mirrored = model.map(([x, y]): [number, number] => [30 - x, y]);
    const mp = prescribedPath(mirrored, { ...poly, points: poly.points.map(([x, y]): [number, number] => [30 - x, y]) }, 2, true);
    expect(mp.crack!.x).toBeCloseTo(26, 6);
    expect(mp.points.slice(1)).toEqual([[22, 4], [8, 5]]);
  });

  it("has no surface for a polyline that never reaches the crack depth", () => {
    // At most 1 m below the ground: no crack of 2 m, as the analysis finds.
    const shallow = { cx: 0, cy: 0, radius: 0, points: [[2, 10], [8, 9], [22, 5]] as [number, number][] };
    const p = prescribedPath(model, shallow, 2);
    expect(p.unusable).toBe(true);
    expect(p.crack).toBeNull();
    expect(prescribedPath(model, shallow, 0.5).unusable).toBe(false);
  });

  it("has no surface for a circle that leaves the model through its base", () => {
    // Both ends on the ground, the lowest point 0.5 m below the base (y 0).
    const deep = { cx: 15, cy: 14, radius: 14.5 };
    expect(circleEntryExit(model, deep.cx, deep.cy, deep.radius)).not.toBeNull();
    expect(prescribedPath(model, deep, 0).unusable).toBe(true);
    expect(prescribedPath(model.map(([x, y]): [number, number] => [30 - x, y]), { ...deep, cx: 15 }, 0, true).unusable).toBe(true);
    // 1 m above the base: a surface.
    expect(prescribedPath(model, { ...deep, radius: 13 }, 0).unusable).toBe(false);
    // As the analysis: no plane for the first, one for the second.
    const planes = (c: typeof deep) =>
      buildSlope({ coordinates: model, materials: [{ name: "M", unitWeight: 20, frictionAngle: 30, cohesion: 5 }], customSearchPlanes: [c] })
        .individualPlanes.length;
    expect(planes(deep)).toBe(0);
    expect(planes({ ...deep, radius: 13 })).toBe(1);
  });
});

describe("crackCutX", () => {
  it("finds where a surface first lies the crack depth below the ground, from either side", () => {
    const flat: [number, number][] = [[0, 0], [0, 10], [20, 10], [20, 0]];
    const v = (x: number) => 10 - Math.min(x, 20 - x); // a V from the ground down to y 0 at x 10
    expect(crackCutX(flat, v, 0, 20, 3)).toBeCloseTo(3, 6);
    expect(crackCutX(flat, v, 20, 0, 3)).toBeCloseTo(17, 6);
    expect(crackCutX(flat, v, 0, 20, 11)).toBeNull();
  });
});
