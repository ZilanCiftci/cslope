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

describe("computeRegions with nested closed boundaries", () => {
  const square = (h: number): [number, number][] => [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
    [-h, -h],
  ];
  const exterior = square(50).slice(0, 4);
  const assignments: RegionMaterials = [
    { point: [0, 0], materialId: "core" },
    { point: [10, 10], materialId: "ring" },
    { point: [40, 40], materialId: "outer" },
  ];

  function materialAt(
    regions: ReturnType<typeof computeRegions>,
    x: number,
    y: number,
  ): string | undefined {
    // Regions are sorted largest first; the smallest containing one wins.
    let found: string | undefined;
    for (const r of regions) {
      let inside = false;
      for (let i = 0, j = r.px.length - 1; i < r.px.length; j = i++) {
        const [xi, yi, xj, yj] = [r.px[i], r.py[i], r.px[j], r.py[j]];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) found = r.materialId;
    }
    return found;
  }

  for (const ids of [
    ["a-outer", "b-inner"],
    ["b-outer", "a-inner"],
  ]) {
    it(`assigns outer, ring and core correctly (ids ${ids.join(", ")})`, () => {
      const boundaries: MaterialBoundaryRow[] = [
        { id: ids[0], coordinates: square(20), coordinateExpressions: [] },
        { id: ids[1], coordinates: square(5), coordinateExpressions: [] },
      ];
      const regions = computeRegions(exterior, boundaries, assignments, "outer");
      expect(regions).toHaveLength(3);
      expect(materialAt(regions, 40, 40)).toBe("outer");
      expect(materialAt(regions, 10, 10)).toBe("ring");
      expect(materialAt(regions, 0, 0)).toBe("core");
    });
  }
});
