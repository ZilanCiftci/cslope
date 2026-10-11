/**
 * Models in real-world coordinates (eastings ~6.4e6 m, elevations ~2e3 m)
 * must give the same slices and FOS as the same model near the origin.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseBishop } from "./solvers";

function model(dx: number, dy: number): SlopeDefinition {
  const P = (x: number, y: number): [number, number] => [x + dx, y + dy];
  return {
    coordinates: [P(0, -10), P(0, 10.943), P(9.551, 10.943), P(36.013, 0), P(49.384, 0), P(49.384, -10)],
    materials: [
      { name: "Upper", unitWeight: 17.71, cohesion: 7.727, frictionAngle: 15.166 },
      { name: "Lower", unitWeight: 19.391, cohesion: 11.379, frictionAngle: 20.484 },
    ],
    materialBoundaries: [{ coordinates: [P(0, -0.58), P(49.384, -1.0)], materialName: "Lower" }],
    regionAssignments: [
      { point: P(0.5, 5), materialName: "Upper" },
      { point: P(0.5, -5), materialName: "Lower" },
    ],
    customSearchPlanes: [{ cx: 25.735 + dx, cy: 13.281 + dy, radius: 17.886 }],
    customPlanesOnly: true,
  };
}

function slicesOf(def: SlopeDefinition) {
  const slope = buildSlope(def);
  slope.updateAnalysisOptions({ slices: 40, tolerance: 1e-9, maxIterations: 100 });
  const p = slope.individualPlanes[0];
  const slices = getSlices(slope, p.lc[0], p.rc[0], p.cx, p.cy, p.radius);
  return { slope, slices };
}

describe("real-world coordinates", () => {
  it("finds the base material of a thin slice at the toe (regression)", () => {
    // The last slice's base lies in the upper layer, ~0.7 m above the
    // boundary. With global coordinates, clipping the material regions by
    // the slice base lost ~1e-6 m in the constant term x·y, more than the
    // lift used to find the base material, and the slice got the lower
    // layer's strength (FOS 0.4 % too high).
    const local = slicesOf(model(0, 0));
    const world = slicesOf(model(6439598, 1881));
    expect(world.slices.length).toBe(local.slices.length);
    local.slices.forEach((s, i) => {
      expect(world.slices[i].baseMaterial?.name, `slice ${i}`).toBe(s.baseMaterial?.name);
      expect(world.slices[i].weight).toBeCloseTo(s.weight, 5);
    });
    expect(local.slices[local.slices.length - 1].baseMaterial?.name).toBe("Upper");
    const [fLocal] = analyseBishop(local.slope, local.slices);
    const [fWorld] = analyseBishop(world.slope, world.slices);
    expect(fWorld!).toBeCloseTo(fLocal!, 7);
  });
});
