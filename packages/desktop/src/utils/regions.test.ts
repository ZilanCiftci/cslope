import { describe, expect, it } from "vitest";
import { computeRegions } from "./regions";
import type { MaterialBoundaryRow, RegionMaterials } from "../store/app-store";

describe("computeRegions", () => {
  it("splits lower region by diagonal boundary even when ID order is unfavorable", () => {
    const coordinates: [number, number][] = [
      [-20, 0],
      [15, 0],
      [15, -10],
      [-20, -10],
    ];

    const boundaries: MaterialBoundaryRow[] = [
      {
        // Deliberately sorts before the horizontal cut.
        id: "a-diagonal",
        coordinates: [
          [-20.3, -5.9],
          [1.3, -4.9],
        ],
        coordinateExpressions: [{}, {}],
      },
      {
        id: "z-horizontal",
        coordinates: [
          [-20, -5],
          [15, -5],
        ],
        coordinateExpressions: [{}, {}],
      },
    ];

    const regionMaterials: RegionMaterials = [];
    const regions = computeRegions(
      coordinates,
      boundaries,
      regionMaterials,
      "default-mat",
    );

    // Expected result: top piece + two bottom pieces split by the diagonal.
    expect(regions.length).toBe(3);
  });

  it("keeps behavior stable with only one open boundary", () => {
    const coordinates: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, -10],
      [0, -10],
    ];

    const boundaries: MaterialBoundaryRow[] = [
      {
        id: "b-horizontal",
        coordinates: [
          [0, -5],
          [10, -5],
        ],
        coordinateExpressions: [{}, {}],
      },
    ];

    const regions = computeRegions(coordinates, boundaries, [], "default-mat");
    expect(regions.length).toBe(2);
  });
});
