import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseBishop } from "./solvers";
import { resolveUnitWeight } from "../types/strength";
import type { SlopeDefinition } from "../types/slope-definition";
import type { SpatialMohrCoulombModel } from "../types/material-models";

const COORDS: SlopeDefinition["coordinates"] = [
  [0, -15],
  [0, 0],
  [20, 0],
  [40, -10],
  [60, -10],
  [60, -15],
];
const CIRCLE = [32.63, 17.7, 30.33] as const;

function bishop(def: SlopeDefinition) {
  const slope = buildSlope(def);
  const [cx, cy, r] = CIRCLE;
  const pts = slope.getCircleExternalIntersection(cx, cy, r);
  const slices = getSlices(slope, pts[0][0], pts[1][0], cx, cy, r);
  return {
    fos: analyseBishop(slope, slices)[0]!,
    weight: slices.reduce((sum, s) => sum + s.weight, 0),
  };
}

function spatial(
  gamma: number,
  points: [number, number][] = [
    [0, 0],
    [60, -15],
  ],
): SlopeDefinition {
  const model: SpatialMohrCoulombModel = {
    kind: "spatial-mohr-coulomb",
    unitWeight: 25,
    dataPoints: points.map(([x, y]) => [x, y, 5, 30, gamma]),
  };
  return {
    coordinates: COORDS,
    materials: [
      { name: "S", unitWeight: 25, frictionAngle: 30, cohesion: 5, model },
    ],
  };
}

describe("spatial Mohr-Coulomb unit weight", () => {
  it("uses the γ of the data points, not the material γ", () => {
    const mc = bishop({
      coordinates: COORDS,
      materials: [{ name: "A", unitWeight: 18, frictionAngle: 30, cohesion: 5 }],
    });
    const sp = bishop(spatial(18));
    expect(sp.weight).toBeCloseTo(mc.weight, 6);
    expect(sp.fos).toBeCloseTo(mc.fos, 6);
  });

  it("falls back to the material γ when the data points give none", () => {
    const model = spatial(0).materials[0].model!;
    expect(resolveUnitWeight(model, 25, 30, -5)).toBe(25);
  });

  it("interpolates γ between data points", () => {
    const model: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [
        [0, 0, 5, 30, 16],
        [10, 0, 5, 30, 20],
      ],
      interpolation: "idw",
    };
    expect(resolveUnitWeight(model, 20, 5, 0)).toBeCloseTo(18, 9);
    expect(resolveUnitWeight(model, 20, 0, 0)).toBe(16);
    expect(
      resolveUnitWeight({ ...model, interpolation: "nearest" }, 20, 9, 0),
    ).toBe(20);
    expect(
      resolveUnitWeight(
        { kind: "mohr-coulomb", unitWeight: 20, cohesion: 1, frictionAngle: 30 },
        20,
        5,
        0,
      ),
    ).toBe(20);
  });
});
