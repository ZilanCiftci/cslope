import { describe, expect, it } from "vitest";
import { computeRegions } from "./regions";
import { holeFreeRegions, ringArea2 } from "./region-rings";

const ringOf = (px: number[], py: number[]) => px.map((x, i) => [x, py[i]] as [number, number]);

describe("holeFreeRegions", () => {
  it("splits a region around two lenses into pieces without holes that cover it once", () => {
    const regions = computeRegions(
      [[0, 0], [20, 0], [20, 10], [0, 10]],
      [
        { id: "a", coordinates: [[2, 2], [5, 2], [5, 5], [2, 5], [2, 2]] },
        { id: "b", coordinates: [[12, 4], [16, 4], [14, 8], [12, 4]] },
      ],
      [{ point: [10, 1], materialId: "soil" }, { point: [3, 3], materialId: "lens" }, { point: [14, 5], materialId: "lens" }],
      "soil",
    );
    expect(regions.find((r) => r.materialId === "soil")!.holes).toHaveLength(2);
    const pieces = holeFreeRegions(regions);
    expect(pieces.every((r) => !r.holes)).toBe(true);
    const area = (m: string) => pieces.filter((r) => r.materialId === m).reduce((s, r) => s + Math.abs(ringArea2(ringOf(r.px, r.py))) / 2, 0);
    expect(area("lens")).toBeCloseTo(9 + 8, 9);
    expect(area("soil")).toBeCloseTo(200 - 17, 9);
    expect(pieces.filter((r) => r.materialId === "soil").length).toBeGreaterThanOrEqual(3);
    // a model without lenses is returned as it is
    const plain = computeRegions([[0, 0], [10, 0], [10, 5], [0, 5]], [], [], "soil");
    expect(holeFreeRegions(plain)).toEqual(plain);
  });
});
