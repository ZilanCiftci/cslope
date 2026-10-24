import { describe, expect, it } from "vitest";
import {
  colorLuminance,
  groundBetween,
  groundProfile,
  groundYFromSide,
  isDarkFill,
  meanThickness,
  sameRange,
  searchRange,
  sliceDensityFactor,
  slipMassPolygon,
  splitVerticalByRegion,
  tensionCrackFace,
} from "./slip-mass";
import type { Region } from "./regions";

/** A stepped wall: toe at y = 2, steps at x = 4 (to y = 6) and x = 8 (to y = 10). */
const STEPPED: [number, number][] = [
  [0, 0],
  [0, 2],
  [4, 2],
  [4, 6],
  [8, 6],
  [8, 10],
  [16, 10],
  [16, 0],
];

describe("groundYFromSide", () => {
  it("gives the foot and the top of a vertical face from either side", () => {
    expect(groundYFromSide(STEPPED, 4, "left")).toBe(2);
    expect(groundYFromSide(STEPPED, 4, "right")).toBe(6);
    expect(groundYFromSide(STEPPED, 6, "left")).toBe(6);
    expect(groundYFromSide(STEPPED, 6, "right")).toBe(6);
    expect(groundYFromSide(STEPPED, 0, "left")).toBeNull();
  });
});

describe("groundProfile", () => {
  it("keeps both corners of every vertical face, walking either way", () => {
    expect(groundProfile(STEPPED, [1, 2], [12, 10])).toEqual([
      [1, 2],
      [4, 2],
      [4, 6],
      [8, 6],
      [8, 10],
      [12, 10],
    ]);
    expect(groundProfile(STEPPED, [12, 10], [1, 2])).toEqual([
      [12, 10],
      [8, 10],
      [8, 6],
      [4, 6],
      [4, 2],
      [1, 2],
    ]);
  });

  it("joins an end below the ground with a vertical segment", () => {
    // From the bottom of a crack at x = 12 (2 m deep) to the toe.
    expect(groundProfile(STEPPED, [12, 8], [1, 2]).slice(0, 3)).toEqual([
      [12, 8],
      [12, 10],
      [8, 10],
    ]);
    // To a point on a vertical face.
    expect(groundProfile(STEPPED, [12, 10], [8, 7]).slice(-2)).toEqual([
      [8, 10],
      [8, 7],
    ]);
  });
});

describe("groundBetween", () => {
  it("runs from the smaller to the larger x on top of the ground", () => {
    expect(groundBetween(STEPPED, 6, 2)).toEqual([
      [2, 2],
      [4, 2],
      [4, 6],
      [6, 6],
    ]);
    expect(groundBetween(STEPPED, -5, 2)).toEqual([]);
  });
});

describe("slipMassPolygon", () => {
  it("encloses the mass behind a stepped wall without cutting the corners", () => {
    const surf = { entryPoint: [12, 10] as [number, number], exitPoint: [1, 2] as [number, number] };
    const base: [number, number][] = [
      [12, 10],
      [6, 0.5],
      [1, 2],
    ];
    const poly = slipMassPolygon(STEPPED, surf, base);
    expect(poly).toEqual([
      [12, 10],
      [8, 10],
      [8, 6],
      [4, 6],
      [4, 2],
      [1, 2],
      [6, 0.5],
    ]);
  });

  it("closes the mass up the crack face at a tension crack", () => {
    const surf = { entryPoint: [12, 8] as [number, number], exitPoint: [1, 2] as [number, number] };
    const poly = slipMassPolygon(STEPPED, surf, [
      [12, 8],
      [6, 0.5],
      [1, 2],
    ]);
    expect(poly[0]).toEqual([12, 8]);
    expect(poly[1]).toEqual([12, 10]);
    expect(poly.at(-1)).toEqual([6, 0.5]);
  });
});

describe("tensionCrackFace", () => {
  it("finds a crack where the entry is below the ground", () => {
    expect(tensionCrackFace(STEPPED, { entryPoint: [12, 8], exitPoint: [1, 2] })).toEqual({
      x: 12,
      top: 10,
      bottom: 8,
      massSide: -1,
    });
    expect(tensionCrackFace(STEPPED, { entryPoint: [12, 10], exitPoint: [1, 2] })).toBeNull();
  });
});

describe("splitVerticalByRegion", () => {
  const upper: Region = { px: [0, 10, 10, 0], py: [5, 5, 10, 10], materialId: "a", regionKey: "a" };
  const lower: Region = { px: [0, 10, 10, 0], py: [0, 0, 5, 5], materialId: "b", regionKey: "b" };

  it("cuts the line where it crosses region boundaries", () => {
    const parts = splitVerticalByRegion([upper, lower], 3, 1, 9);
    expect(parts).toEqual([
      { y0: 1, y1: 5, region: lower },
      { y0: 5, y1: 9, region: upper },
    ]);
    expect(splitVerticalByRegion([upper], 3, 6, 9)).toEqual([{ y0: 6, y1: 9, region: upper }]);
  });
});

describe("colours and density", () => {
  it("tells dark fills from light ones", () => {
    expect(colorLuminance("#ffffff")).toBeCloseTo(1, 9);
    expect(colorLuminance("#000")).toBe(0);
    expect(colorLuminance("red")).toBeNull();
    expect(isDarkFill("#3a3a4a")).toBe(true);
    expect(isDarkFill("#d4a373")).toBe(false);
    expect(isDarkFill(undefined)).toBe(false);
  });

  it("fades slice lines as their spacing shrinks", () => {
    expect(sliceDensityFactor([10, 10, 10])).toBe(1);
    expect(sliceDensityFactor([2, 2, 2])).toBeCloseTo(0.4, 9);
    expect(sliceDensityFactor([0.2, 0.2])).toBe(0.3);
    expect(sliceDensityFactor([])).toBe(1);
  });

  it("measures the mean thickness of a sliver", () => {
    expect(meanThickness([[0, 0], [100, 0], [100, 2], [0, 2]])).toBeCloseTo(400 / 204, 9);
  });
});

describe("searchRange", () => {
  it("orders the ends and recognises zero width and coinciding ranges", () => {
    expect(searchRange(8, 2)).toEqual({ lo: 2, hi: 8, point: false });
    expect(searchRange(55, 55).point).toBe(true);
    expect(sameRange(searchRange(2, 8), searchRange(8, 2))).toBe(true);
    expect(sameRange(searchRange(2, 8), searchRange(2, 9))).toBe(false);
  });
});
