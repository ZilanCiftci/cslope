/**
 * Tension crack at a limiting base inclination (`tensionCrackAngle`): the
 * part of the surface steeper than the angle from the entry is cut off.
 */

import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import { findAngleCrackX } from "./slices";
import { DEFAULT_ANALYSIS_OPTIONS, type AnalysisOptions } from "../types/analysis";

const CX = 14, CY = 18, R = 15;
const def: SlopeDefinition = {
  orientation: "ltr",
  coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
  materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 8, frictionAngle: 28 } }],
  regionAssignments: [{ point: [15, 2], materialName: "soil" }],
  customSearchPlanes: [{ cx: CX, cy: CY, radius: R }],
  customPlanesOnly: true,
};
const run = (o: Partial<AnalysisOptions> = {}) => {
  const s = buildSlope(toCanonicalSlopeDefinition(def));
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", slices: 40, ...o });
  const F = analyseSlope(s) as number;
  return { F, plane: s.search[0] };
};
const circleY = (x: number) => CY - Math.sqrt(R * R - (x - CX) ** 2);

describe("tension crack at a limiting base inclination", () => {
  it("finds where a circle's base flattens to the angle", () => {
    // on a circle the base is inclined at α where x = cx − R sin α
    for (const a of [45, 60, 70]) {
      const x = findAngleCrackX(CX - R + 1e-6, CX + R - 1e-6, circleY, (a * Math.PI) / 180)!;
      expect(x).toBeCloseTo(CX - R * Math.sin((a * Math.PI) / 180), 4);
    }
    // no steeper than the angle at the entry: no crack
    expect(findAngleCrackX(CX, CX + 5, circleY, Math.PI / 4)).toBe(CX);
  });

  it("cuts the surface off at the crack and records it", () => {
    const none = run();
    const crack = run({ tensionCrackAngle: 45 });
    const xc = CX - R * Math.sin(Math.PI / 4);
    expect(crack.plane.crack![0]).toBeCloseTo(xc, 4);
    expect(crack.F).not.toBeCloseTo(none.F, 3);
  });

  it("equals a crack of the same depth at the same place", () => {
    const xc = CX - R * Math.sin((50 * Math.PI) / 180);
    const ground = 10; // the crest is level there
    const byAngle = run({ tensionCrackAngle: 50 });
    const byDepth = run({ tensionCrackDepth: ground - circleY(xc) });
    expect(byAngle.F).toBeCloseTo(byDepth.F, 5);
    // and with water in the crack
    expect(run({ tensionCrackAngle: 50, tensionCrackWater: 1 }).F).toBeCloseTo(run({ tensionCrackDepth: ground - circleY(xc), tensionCrackWater: 1 }).F, 5);
  });

  it("leaves a surface no steeper than the angle unchanged, and the deeper crack governs", () => {
    expect(run({ tensionCrackAngle: 89 }).F).toBeCloseTo(run().F, 10);
    const xc = CX - R * Math.sin((50 * Math.PI) / 180);
    const shallow = run({ tensionCrackAngle: 50, tensionCrackDepth: 0.5 });
    expect(shallow.plane.crack![0]).toBeCloseTo(xc, 4);
    const deep = run({ tensionCrackAngle: 50, tensionCrackDepth: 10 - circleY(xc) + 1 });
    expect(deep.plane.crack![0]).toBeGreaterThan(xc + 0.1);
  });

  it("rejects an angle outside 0–90°", () => {
    const s = buildSlope(toCanonicalSlopeDefinition(def));
    expect(() => s.updateAnalysisOptions({ tensionCrackAngle: 90 })).toThrow(/tensionCrackAngle/);
    expect(() => s.updateAnalysisOptions({ tensionCrackAngle: -1 })).toThrow(/tensionCrackAngle/);
  });
});
