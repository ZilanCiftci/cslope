import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { BAR_GP_STRIDE, buildFeModel, type FeModel } from "./model";
import { runTrial } from "./srm";

const def = (pullout: object | undefined, prestress = 0) =>
  ({
    coordinates: [[0, 0], [0, 10], [10, 10], [15, 4], [30, 4], [30, 0]],
    materials: [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 25 } }],
    reinforcements: [{ x1: 13.75, y1: 5.5, x2: 1, y2: 5.5, tensileCapacity: 150, end1Capacity: 200, pullout, prestress, application: "active" }],
  }) as unknown as SlopeDefinition;
const model = (pullout: object | undefined, prestress = 0) => buildFeModel(buildSlope(toCanonicalSlopeDefinition(def(pullout, prestress))), { elementSize: 1 });

/** Axial force of each bar Gauss point. */
function forces(m: FeModel, u: Float64Array, barEp: Float64Array): number[] {
  const out: number[] = [];
  for (let b = 0; b < m.bars.count; b++) {
    for (let g = 0; g < 2; g++) {
      const o = (2 * b + g) * BAR_GP_STRIDE;
      let eps = 0;
      for (let k = 0; k < 3; k++) {
        const n = m.bars.nodes[3 * b + k], ix = m.eq[2 * n], iy = m.eq[2 * n + 1];
        if (ix >= 0) eps += m.bars.gp[o + 2 * k] * u[ix];
        if (iy >= 0) eps += m.bars.gp[o + 2 * k + 1] * u[iy];
      }
      out.push(m.bars.stiffness[b] * (eps - barEp[2 * b + g]));
    }
  }
  return out;
}

describe("grouted anchors", () => {
  it("join the free length to the soil only at its ends: one bar from the head to the bonded length", () => {
    const nail = model({ kind: "bond", strength: 100 });
    const anchor = model({ kind: "bond", strength: 100, bondedLength: 4 });
    expect(anchor.bars.count).toBeLessThan(nail.bars.count);
    // the free bar runs from the head (x = 13.75) to the start of the bonded length (x = 5)
    const free = Array.from({ length: anchor.bars.count }, (_, b) => b).find((b) => anchor.bars.nodes[3 * b] === anchor.bars.nodes[3 * b + 1])!;
    const [a, , z] = [anchor.bars.nodes[3 * free], 0, anchor.bars.nodes[3 * free + 2]];
    expect(anchor.x[a]).toBeCloseTo(13.75, 6);
    expect(anchor.x[z]).toBeCloseTo(5, 6);
  });

  it("start the free length where the line enters the soil when the head is outside it", () => {
    // the head 1.5 m above the crest
    const d = def({ kind: "bond", strength: 100, bondedLength: 4 }, 80) as unknown as { reinforcements: { x1: number; y1: number }[] };
    d.reinforcements[0].x1 = 8; d.reinforcements[0].y1 = 11.5;
    (d.reinforcements[0] as { x2?: number; y2?: number }).x2 = 1; (d.reinforcements[0] as { x2?: number; y2?: number }).y2 = 5.5;
    const m = buildFeModel(buildSlope(toCanonicalSlopeDefinition(d as unknown as SlopeDefinition)), { elementSize: 1 });
    const free = Array.from({ length: m.bars.count }, (_, b) => b).filter((b) => m.bars.nodes[3 * b] === m.bars.nodes[3 * b + 1]);
    expect(free).toHaveLength(1);
    expect(m.bars.ep0[2 * free[0]]).toBeLessThan(0);
    expect(m.warnings).toEqual([]);
  });

  it("carry their lock-off load in the free length, with both solvers", () => {
    const freeBar = (m: FeModel) => Array.from({ length: m.bars.count }, (_, b) => b).find((b) => m.bars.nodes[3 * b] === m.bars.nodes[3 * b + 1])!;
    const freeForce = (prestress: number, solver: "newton" | "viscoplastic") => {
      const m = model({ kind: "bond", strength: 100, bondedLength: 4 }, prestress);
      // a strong soil (F = 0.5): the anchor works elastically
      const r = runTrial(m, 0.5, null, { solver });
      expect(r.converged).toBe(true);
      const N = forces(m, r.state.u, r.state.barEp), b = freeBar(m);
      expect(N[2 * b + 1]).toBeCloseTo(N[2 * b], 6); // constant along the free length
      return N[2 * b];
    };
    for (const solver of ["newton", "viscoplastic"] as const) {
      const slack = freeForce(0, solver), locked = freeForce(80, solver);
      // much of the lock-off load is lost as the head, a single node without a
      // bearing plate, presses into the soft soil (E = 10⁵ kPa)
      expect(locked - slack).toBeGreaterThan(10);
      expect(locked).toBeLessThanOrEqual(150 + 1e-6);
    }
  }, 120000);
});
