/**
 * Strength from matric suction (φb) in the analysis: the negative pore
 * pressure above the water line at the slice bases, and the factor of
 * safety of surfaces above the line.
 */

import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseSlope } from "./solvers";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { SlopeDefinition } from "../types/slope-definition";
import type { MaterialModel } from "../types/material-models";
import { buildFeModel } from "../fem/model";

const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

/** A 10 m high slope with a water line 15 m below the crest (below the toe). */
function definition(model: Partial<Extract<MaterialModel, { kind: "mohr-coulomb" }>> = {}, water: [number, number][] = [[0, -15], [60, -15]]): SlopeDefinition {
  return {
    coordinates: [[0, -25], [0, 0], [20, 0], [40, -10], [60, -10], [60, -25]],
    materials: [{ name: "Soil", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 5, frictionAngle: 28, ...model } }],
    waterTable: { mode: "custom", value: water },
  };
}

const CIRCLE = { cx: 32, cy: 14, r: 25 };

function slicesOf(def: SlopeDefinition) {
  const slope = buildSlope(def);
  const pts = slope.getCircleExternalIntersection(CIRCLE.cx, CIRCLE.cy, CIRCLE.r);
  return getSlices(slope, pts[0][0], pts[1][0], CIRCLE.cx, CIRCLE.cy, CIRCLE.r);
}

function fosOnCircle(def: SlopeDefinition, options: Parameters<ReturnType<typeof buildSlope>["updateAnalysisOptions"]>[0] = {}): number {
  const slope = buildSlope({ ...def, customSearchPlanes: [{ cx: CIRCLE.cx, cy: CIRCLE.cy, radius: CIRCLE.r }], customPlanesOnly: true });
  slope.updateAnalysisOptions({ method: "Morgenstern-Price", ...options });
  return analyseSlope(slope) as number;
}

describe("suction at the slice bases", () => {
  it("is γw times the height above the line, with U = 0 there", () => {
    const slices = slicesOf(definition({ phiB: 15 }));
    expect(slices.length).toBeGreaterThan(10);
    for (const s of slices) {
      expect(s.U).toBe(0);
      const suction = WATER_UNIT_WEIGHT * (s.yBottom + 15);
      expect(s.suction).toBeCloseTo(suction, 9);
      expect(s.suctionStrength).toBeCloseTo(suction * tan(15), 9);
      expect(s.cohesion).toBeCloseTo(5 + suction * tan(15), 9);
    }
  });

  it("is capped by the maximum suction", () => {
    for (const s of slicesOf(definition({ phiB: 15, maxSuction: 40 }))) {
      expect(s.suctionStrength).toBeCloseTo(Math.min(40, WATER_UNIT_WEIGHT * (s.yBottom + 15)) * tan(15), 9);
    }
  });

  it("applies above the line only; below it the pore pressure is as before", () => {
    const high: [number, number][] = [[0, -6], [60, -6]];
    const withPhiB = slicesOf(definition({ phiB: 20 }, high));
    const without = slicesOf(definition({}, high));
    expect(withPhiB.length).toBe(without.length);
    let above = 0, below = 0;
    withPhiB.forEach((s, i) => {
      expect(s.U).toBe(without[i].U);
      if (s.yBottom > -6) {
        above++;
        expect(s.cohesion).toBeCloseTo(5 + WATER_UNIT_WEIGHT * (s.yBottom + 6) * tan(20), 9);
      } else {
        below++;
        expect(s.suction).toBeUndefined();
        expect(s.cohesion).toBe(without[i].cohesion);
      }
    });
    expect(above).toBeGreaterThan(0);
    expect(below).toBeGreaterThan(0);
  });

  it("takes the head factor of the phreatic correction", () => {
    const inclined: [number, number][] = [[0, -12], [60, -18]];
    const slope = buildSlope(definition({ phiB: 15 }, inclined));
    slope.updateAnalysisOptions({ porePressureHead: "phreatic-correction" });
    const pts = slope.getCircleExternalIntersection(CIRCLE.cx, CIRCLE.cy, CIRCLE.r);
    const cos2 = Math.cos(Math.atan(6 / 60)) ** 2;
    for (const s of getSlices(slope, pts[0][0], pts[1][0], CIRCLE.cx, CIRCLE.cy, CIRCLE.r)) {
      const yw = -12 - (6 * s.x) / 60;
      expect(s.suction).toBeCloseTo(WATER_UNIT_WEIGHT * (s.yBottom - yw) * cos2, 9);
    }
  });

  it("needs a water line", () => {
    const def = definition({ phiB: 15 });
    delete def.waterTable;
    for (const s of slicesOf(def)) {
      expect(s.suction).toBeUndefined();
      expect(s.cohesion).toBe(5);
    }
  });

  it("takes γc′ with partial factors", () => {
    const slope = buildSlope(definition({ phiB: 15 }));
    slope.updateAnalysisOptions({ partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 } });
    const pts = slope.getCircleExternalIntersection(CIRCLE.cx, CIRCLE.cy, CIRCLE.r);
    for (const s of getSlices(slope, pts[0][0], pts[1][0], CIRCLE.cx, CIRCLE.cy, CIRCLE.r)) {
      const ss = WATER_UNIT_WEIGHT * (s.yBottom + 15) * tan(15);
      expect(s.cohesion).toBeCloseTo((5 + ss) / 1.3, 9);
      expect(s.suctionStrength).toBeCloseTo(ss / 1.3, 9);
    }
  });
});

describe("factor of safety with suction strength", () => {
  it("is unchanged with φb = 0", () => {
    expect(fosOnCircle(definition({ phiB: 0 }))).toBe(fosOnCircle(definition()));
    expect(fosOnCircle(definition({ phiB: 0, maxSuction: 10 }))).toBe(fosOnCircle(definition()));
  });

  it("rises with φb on a surface above the water line, less with a cap", () => {
    const f0 = fosOnCircle(definition());
    const f10 = fosOnCircle(definition({ phiB: 10 }));
    const f20 = fosOnCircle(definition({ phiB: 20 }));
    const capped = fosOnCircle(definition({ phiB: 20, maxSuction: 30 }));
    expect(f10).toBeGreaterThan(f0 * 1.05);
    expect(f20).toBeGreaterThan(f10);
    expect(capped).toBeGreaterThan(f0);
    expect(capped).toBeLessThan(f20);
  });

  it("rises with φb for the critical surface of a search", () => {
    const search = (phiB?: number) => {
      const slope = buildSlope(definition(phiB !== undefined ? { phiB } : {}));
      const F = analyseSlope(slope) as number;
      return { F, slices: slope.search[0].slices ?? [] };
    };
    const without = search();
    const withPhiB = search(15);
    // the critical surface lies above the line (15 m below the crest)
    expect(withPhiB.slices.length).toBeGreaterThan(0);
    for (const s of withPhiB.slices) expect(s.yBottom).toBeGreaterThan(-15);
    expect(withPhiB.F).toBeGreaterThan(without.F * 1.05);
  });

  it("is taken by the finite element model at its Gauss points", () => {
    const m0 = buildFeModel(buildSlope(definition()), { elementSize: 3 });
    const m1 = buildFeModel(buildSlope(definition({ phiB: 15, maxSuction: 60 })), { elementSize: 3 });
    expect(m1.gpC.length).toBe(m0.gpC.length);
    let checked = 0;
    for (let i = 0; i < m0.gpC.length; i++) {
      const suction = Math.max(0, WATER_UNIT_WEIGHT * (m0.gpY[i] + 15));
      expect(m1.gpC[i]).toBeCloseTo(m0.gpC[i] + Math.min(suction, 60) * tan(15), 9);
      if (suction > 0) checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
