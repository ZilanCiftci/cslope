import { beforeEach, describe, expect, it } from "vitest";
import { buildSlope, isPointInPolygon } from "@cslope/engine";
import { useAppStore } from "../store/app-store";
import { buildSlopeDTO } from "../store/helpers";
import { computeRegions } from "../utils/regions";

type P = [number, number];
const S = () => useAppStore.getState();
const area = (px: number[], py: number[]) => {
  let s = 0;
  for (let i = 0, j = px.length - 1; i < px.length; j = i++) s += px[j] * py[i] - px[i] * py[j];
  return Math.abs(s) / 2;
};
const regions = () =>
  computeRegions(S().coordinates, S().materialBoundaries, S().regionMaterials, S().materials[0].id);
const engineNamesAt = (p: P) =>
  buildSlope(buildSlopeDTO(S()))
    .materialGeometries.filter((g) => isPointInPolygon(p[0], p[1], g.px, g.py))
    .map((g) => g.material.name);
const EXT: P[] = [[0, 0], [40, 0], [40, 10], [25, 10], [15, 20], [0, 20]];

describe("canvas regions and engine geometry agree (round 7)", () => {
  beforeEach(() => {
    S().newProject();
    S().addMaterial();
    S().addMaterial();
  });

  it("re-splitting creates no zero-area or duplicated regions", () => {
    S().setCoordinates(EXT);
    S().setMaterialBoundaries([
      { id: "b", coordinates: [[-0.05, 4.176458638906479], [18.52370324358344, 7.1990269375965], [40.05, 10.05]] },
    ]);
    const a = regions().map((r) => area(r.px, r.py));
    expect(a).toHaveLength(2);
    expect(Math.min(...a)).toBeGreaterThan(1);

    S().setMaterialBoundaries([{ id: "b", coordinates: [[6.026681855320929, 20], [40, 4.261417495086789]] }]);
    const total = regions().reduce((s, r) => s + area(r.px, r.py), 0);
    expect(total).toBeCloseTo(600, 3);
  });

  it("a boundary ending on another splits regardless of the boundary order", () => {
    S().setCoordinates([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const wedge = { coordinates: [[0, 2], [6, 5]] as P[] };
    const layer = { coordinates: [[0, 5], [10, 5]] as P[] };
    const [, , m3] = S().materials;
    for (const ids of [["bnd-2", "bnd-1"], ["bnd-1", "bnd-2"]]) {
      S().setMaterialBoundaries([
        { id: ids[0], ...wedge },
        { id: ids[1], ...layer },
      ]);
      S().setRegionMaterials([{ point: [1, 3.5], materialId: m3.id }]);
      expect(regions()).toHaveLength(3);
      expect(engineNamesAt([8, 2])).toEqual([S().materials[0].name]);
      expect(engineNamesAt([1, 3.5])).toEqual([m3.name]);
    }
  });

  it("adding a point to a closed boundary keeps it closed", () => {
    S().setCoordinates([[0, 0], [10, 0], [10, 10], [0, 10]]);
    S().setMaterialBoundaries([{ id: "lens", coordinates: [[3, 3], [7, 3], [7, 6], [3, 6], [3, 3]] }]);
    S().addBoundaryPoint("lens", [2, 4.5]);
    const c = S().materialBoundaries[0].coordinates;
    expect(c).toHaveLength(6);
    expect(c[0]).toEqual(c[c.length - 1]);
    expect(regions()).toHaveLength(2);
  });

  it("a lens straddling the slope edge is split the same on canvas and in the engine", () => {
    S().setCoordinates([[0, 0], [10, 0], [10, 10], [0, 10]]);
    S().setMaterialBoundaries([{ id: "lens", coordinates: [[8, 4], [12, 4], [12, 6], [8, 6], [8, 4]] }]);
    const m2 = S().materials[1];
    S().setRegionMaterial([9, 5], m2.id);
    const rs = regions();
    expect(rs).toHaveLength(2);
    expect(rs.reduce((t, r) => t + area(r.px, r.py), 0)).toBeCloseTo(100, 6);
    const lens = rs.find((r) => r.materialId === m2.id)!;
    expect(area(lens.px, lens.py)).toBeCloseTo(4, 6);
    expect(engineNamesAt([9, 5])).toEqual([m2.name]);
    expect(engineNamesAt([2, 2])).toEqual([S().materials[0].name]);
  });

  it("two separate lenses get the same materials on canvas and in the engine", () => {
    S().setCoordinates(EXT);
    S().setMaterialBoundaries([
      { id: "l1", coordinates: [[18.67, 6.78], [16.87, 7.39], [17.29, 5.6], [18.67, 6.78]] },
      { id: "l2", coordinates: [[22.35, 3.39], [20.67, 5.39], [18.4, 4.45], [18.8, 1.68], [21.43, 1.54], [22.35, 3.39]] },
    ]);
    const [m1, m2, m3] = S().materials;
    S().setRegionMaterials([
      { point: [17.6, 6.6], materialId: m2.id },
      { point: [20.5, 3.3], materialId: m3.id },
    ]);
    expect(regions()).toHaveLength(3);
    for (const [p, m] of [[[17.6, 6.6], m2], [[20.5, 3.3], m3], [[5, 5], m1]] as const) {
      expect(engineNamesAt(p as P)).toEqual([m.name]);
    }
  });
});
