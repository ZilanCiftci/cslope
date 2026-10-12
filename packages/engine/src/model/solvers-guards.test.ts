/**
 * Solver guards: surfaces that would slide the other way, surfaces through
 * strong rock or bedrock, too shallow or too small sliding masses.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseOrdinary, analyseBishop, analyseJanbu, analyseMorgensternPrice, analyseSlope, sliceDrivingMoment, sliceVerticalLoad } from "./solvers";

const LTR: [number, number][] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
const RTL: [number, number][] = LTR.map(([x, y]) => [40 - x, y]);
const soil = { name: "S", unitWeight: 19, cohesion: 10, frictionAngle: 25 };

function slicesOf(def: SlopeDefinition, c: { cx: number; cy: number; radius: number }) {
  const slope = buildSlope(def);
  slope.updateAnalysisOptions({ slices: 30 });
  const ints = slope.getCircleExternalIntersection(c.cx, c.cy, c.radius);
  return { slope, slices: getSlices(slope, ints[0][0], ints[ints.length - 1][0], c.cx, c.cy, c.radius) };
}

describe("surfaces that cannot slide in the analysed direction", () => {
  // A right-to-left slope analysed as if it slid to +x.
  const { slope, slices } = slicesOf({ orientation: "ltr", coordinates: RTL, materials: [soil] }, { cx: 18, cy: 18, radius: 18.5 });

  it("every method reports no FOS", () => {
    expect(slices.length).toBeGreaterThan(5);
    expect(analyseOrdinary(slope, slices)).toBeNull();
    expect(analyseBishop(slope, slices)).toEqual([null, null, null, true]);
    expect(analyseJanbu(slope, slices)).toEqual([null, null, null, true]);
    expect(analyseMorgensternPrice(slope, slices)[0]).toBeNull();
    const total = slices.reduce((s, q) => s + sliceDrivingMoment(q), 0);
    expect(total).toBeLessThan(0);
  });

  it("the search skips it", () => {
    const def: SlopeDefinition = { orientation: "ltr", coordinates: RTL, materials: [soil], customSearchPlanes: [{ cx: 18, cy: 18, radius: 18.5 }], customPlanesOnly: true };
    const s = buildSlope(def);
    for (const method of ["Bishop", "Janbu", "Morgenstern-Price"] as const) {
      s.updateAnalysisOptions({ method });
      expect(analyseSlope(s)).toBeNull();
    }
  });
});

describe("surfaces the analysis rejects", () => {
  const circle = { cx: 22, cy: 18, radius: 18.5 };
  const onCircle = (def: SlopeDefinition): SlopeDefinition => ({ ...def, customSearchPlanes: [circle], customPlanesOnly: true });
  const layered = (model: object): SlopeDefinition => ({
    coordinates: LTR,
    materials: [soil, { name: "R", unitWeight: 24, cohesion: 0, frictionAngle: 0, model: model as never }],
    materialBoundaries: [{ coordinates: [[0, 1], [40, 1]], materialName: "R" }],
    regionAssignments: [{ point: [1, 5], materialName: "S" }, { point: [1, -5], materialName: "R" }],
  });

  it("through strong rock or bedrock: no FOS", () => {
    for (const model of [{ kind: "high-strength", unitWeight: 24 }, { kind: "impenetrable", unitWeight: 24 }]) {
      const s = buildSlope(onCircle(layered(model)));
      expect(analyseSlope(s), model.kind).toBeNull();
      expect(s.search[0].converged).toBe(true);
    }
  });

  it("shallower than the minimum depth or smaller than the minimum area: no FOS", () => {
    const s = buildSlope(onCircle({ coordinates: LTR, materials: [soil] }));
    expect(analyseSlope(s)).not.toBeNull();
    s.updateAnalysisOptions({ minSlipDepth: 50 });
    expect(analyseSlope(s)).toBeNull();
    s.updateAnalysisOptions({ minSlipDepth: 0, minSlipArea: 1e6 });
    expect(analyseSlope(s)).toBeNull();
  });

  it("vertical load of a slice includes free water and surface loads", () => {
    expect(sliceVerticalLoad({ weight: 10, udl: 2, ll: 3, waterLoad: 4 })).toBe(19);
    expect(sliceVerticalLoad({ weight: 10, udl: 2, ll: 3 })).toBe(15);
  });
});
