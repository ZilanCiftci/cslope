import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildFeModel } from "./model";
import { emptyState, strengthReduction } from "./srm";
import { transferState } from "./transfer";

const slope = () => buildSlope(toCanonicalSlopeDefinition({
  coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
  materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 25 } }],
} as unknown as SlopeDefinition));

describe("transferState", () => {
  it("reproduces a quadratic displacement field (zero at the supports) on another mesh and carries the Gauss point values", () => {
    const s = slope();
    const coarse = buildFeModel(s, { elementSize: 3 }), fine = buildFeModel(s, { elementSize: 1.5 });
    // the base is fixed and the sides carry no horizontal displacement
    const field = (x: number, y: number): [number, number] => [0, 0.02 * y * y + 0.01 * x * y];
    const st = emptyState(coarse);
    for (let n = 0; n < coarse.nodeCount; n++) {
      const [ux, uy] = field(coarse.x[n], coarse.y[n]);
      if (coarse.eq[2 * n] >= 0) st.u[coarse.eq[2 * n]] = ux;
      if (coarse.eq[2 * n + 1] >= 0) st.u[coarse.eq[2 * n + 1]] = uy;
    }
    st.evp.fill(0.25); st.stress.fill(-7);
    const t = transferState(coarse, st, fine)!;
    for (let n = 0; n < fine.nodeCount; n++) {
      const [ux, uy] = field(fine.x[n], fine.y[n]);
      if (fine.eq[2 * n] >= 0) expect(t.u[fine.eq[2 * n]]).toBeCloseTo(ux, 9);
      if (fine.eq[2 * n + 1] >= 0) expect(t.u[fine.eq[2 * n + 1]]).toBeCloseTo(uy, 9);
    }
    expect(t.evp.length).toBe(12 * fine.elementCount);
    expect(t.evp.every((v) => v === 0.25) && t.stress.every((v) => v === -7)).toBe(true);
  });

  it("starts the search on a refined mesh: the same factor of safety in fewer trials", () => {
    const s = slope();
    const coarse = buildFeModel(s, { elementSize: 2.5 }), fine = buildFeModel(s, { elementSize: 1.5 });
    const r0 = strengthReduction(coarse, { fTolerance: 0.005 });
    const cold = strengthReduction(fine, { startF: 0.6 * r0.factorOfSafety, guide: r0.factorOfSafety, bracketStep: 0.04, fTolerance: 0.005 });
    const warmStart = transferState(coarse, r0.state, fine)!;
    const warm = strengthReduction(fine, { startF: 0.97 * r0.factorOfSafety, guide: r0.factorOfSafety, bracketStep: 0.04, fTolerance: 0.005, warmStart });
    expect(Math.abs(warm.factorOfSafety - cold.factorOfSafety)).toBeLessThanOrEqual(0.005);
    expect(warm.trials.length).toBeLessThan(cold.trials.length);
  }, 120000);
});
