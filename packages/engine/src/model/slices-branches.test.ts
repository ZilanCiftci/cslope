/**
 * Slice generation branches: the Rankine crack depth in every case, design
 * strength per material model, and degenerate surfaces.
 */
import { describe, it, expect } from "vitest";
import { Material, Udl } from "../types/index";
import type { MaterialModel } from "../types/material-models";
import type { PartialFactors } from "../types/analysis";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import { Slope } from "./slope";
import { getSlices, rankineCrackDepth } from "./slices";
import { buildSlope } from "./build-slope";

const BOUNDARY: [number, number][] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
const F: PartialFactors = { cu: 1.4, cohesion: 1.25, tanPhi: 1.2, variableLoad: 1.3 };

function slopeOf(model: MaterialModel, unitWeight = model.unitWeight): Slope {
  const s = new Slope();
  s.addMaterial(new Material({ name: "M", unitWeight, cohesion: 0, frictionAngle: 0, model }));
  s.setExternalBoundary(BOUNDARY);
  return s;
}

describe("rankineCrackDepth", () => {
  it("undrained: 2cu/γ, with γcu, less the (factored) surcharge", () => {
    const s = slopeOf({ kind: "undrained", unitWeight: 18, undrainedShearStrength: 27 });
    expect(rankineCrackDepth(s, 5)).toBeCloseTo(3, 9);
    s.updateAnalysisOptions({ partialFactors: F });
    expect(rankineCrackDepth(s, 5)).toBeCloseTo((2 * 27) / 1.4 / 18, 9);
    s.setUdls(new Udl({ magnitude: 10, x1: 8, x2: 2 }));
    expect(rankineCrackDepth(s, 5)).toBeCloseTo((2 * 27) / 1.4 / 18 - (10 * 1.3) / 18, 9);
    // A surcharge larger than the cohesion closes the crack.
    s.setUdls(new Udl({ magnitude: 100, x1: 0, x2: 10 }));
    expect(rankineCrackDepth(s, 5)).toBe(0);
  });

  it("c-φ: 2c/(γ√Ka) with the drained factors", () => {
    const s = slopeOf({ kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30 });
    const sqrtKa = Math.tan(Math.PI / 4 - Math.PI / 12);
    expect(rankineCrackDepth(s, 5)).toBeCloseTo((2 * 10) / (20 * sqrtKa), 9);
    s.updateAnalysisOptions({ partialFactors: F });
    const phiD = Math.atan(Math.tan(Math.PI / 6) / 1.2);
    expect(rankineCrackDepth(s, 5)).toBeCloseTo((2 * 10) / 1.25 / (20 * Math.tan(Math.PI / 4 - phiD / 2)), 9);
  });

  it("free water on the ground is a surcharge; none without cohesion, in strong rock or outside the ground", () => {
    const s = slopeOf({ kind: "undrained", unitWeight: 18, undrainedShearStrength: 36 });
    s.setWaterTable({ height: 1, followBoundary: false });
    // At x = 30 the ground is at 0: 1 m of water.
    expect(rankineCrackDepth(s, 30)).toBeCloseTo(4 - WATER_UNIT_WEIGHT / 18, 9);
    // Below the ground the water is no surcharge.
    expect(rankineCrackDepth(s, 5)).toBeCloseTo(4, 9);
    expect(rankineCrackDepth(slopeOf({ kind: "mohr-coulomb", unitWeight: 18, cohesion: 0, frictionAngle: 35 }), 5)).toBe(0);
    expect(rankineCrackDepth(slopeOf({ kind: "high-strength", unitWeight: 25 }), 5)).toBe(0);
    expect(rankineCrackDepth(slopeOf({ kind: "impenetrable", unitWeight: 25 }), 5)).toBe(0);
    expect(rankineCrackDepth(s, 50)).toBe(0);
    expect(rankineCrackDepth(new Slope(), 5)).toBe(0);
  });

  it("lime-cement columns take γcu on c and γφ′ on tan φ′; S = f(depth) from the layer top", () => {
    const lcc = slopeOf({
      kind: "lime-cement-columns",
      unitWeight: 16,
      soilSu: 10,
      columnSu: 100,
      areaRatio: 0.2,
      columnCohesion: 20,
      columnFrictionAngle: 30,
    });
    const c = 0.8 * 10 + 0.2 * 20;
    const tanPhi = 0.2 * Math.tan(Math.PI / 6);
    const z = (cc: number, t: number) => (2 * cc) / (16 * Math.tan(Math.PI / 4 - Math.atan(t) / 2));
    expect(rankineCrackDepth(lcc, 5)).toBeCloseTo(z(c, tanPhi), 9);
    lcc.updateAnalysisOptions({ partialFactors: F });
    expect(rankineCrackDepth(lcc, 5)).toBeCloseTo(z(c / 1.4, tanPhi / 1.2), 9);
    const sfd = slopeOf({ kind: "s-f-depth", unitWeight: 18, suRef: 18, depthRef: 0, rate: 0, depthReference: "layer-top" });
    expect(rankineCrackDepth(sfd, 5)).toBeCloseTo(2, 6);
  });
});

describe("design strength of the slices", () => {
  const circle = { cx: 22, cy: 18, radius: 18.5 };
  function slicesOf(model: MaterialModel) {
    const s = slopeOf(model);
    s.updateAnalysisOptions({ partialFactors: F, slices: 10 });
    const ints = s.getCircleExternalIntersection(circle.cx, circle.cy, circle.radius);
    return getSlices(s, ints[0][0], ints[ints.length - 1][0], circle.cx, circle.cy, circle.radius);
  }

  it("each model takes its own factors", () => {
    const drained = slicesOf({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 10, frictionAngle: 30 })[0];
    expect(drained.cohesion).toBeCloseTo(10 / 1.25, 12);
    expect(Math.tan(drained.phi)).toBeCloseTo(Math.tan(Math.PI / 6) / 1.2, 12);
    expect(drained.frictionAngle).toBeCloseTo((drained.phi * 180) / Math.PI, 12);
    // φ = 0 Mohr-Coulomb is undrained clay.
    expect(slicesOf({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 28, frictionAngle: 0 })[0].cohesion).toBeCloseTo(20, 12);
    for (const m of [
      { kind: "undrained", unitWeight: 19, undrainedShearStrength: 28 },
      { kind: "s-f-depth", unitWeight: 19, suRef: 28, depthRef: 0, rate: 0 },
      { kind: "s-f-datum", unitWeight: 19, suRef: 28, yRef: 0, rate: 0 },
    ] as MaterialModel[]) {
      const s = slicesOf(m)[0];
      expect(s.cohesion, m.kind).toBeCloseTo(20, 12);
      expect(s.cohesionUndrained, m.kind).toBeCloseTo(20, 12);
    }
    // Combined: drained c′ with γc′, its undrained strength with γcu.
    const combined = slicesOf({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 10, frictionAngle: 30, cFactor: 1, cohesionUndrained: 28 })[0];
    expect(combined.isCombined).toBe(true);
    expect(combined.cohesion).toBeCloseTo(8, 12);
    expect(combined.cohesionUndrained).toBeCloseTo(20, 12);
    // Columns: c with γcu, tan φ′ with γφ′.
    const lcc = slicesOf({ kind: "lime-cement-columns", unitWeight: 16, soilSu: 10, columnSu: 100, areaRatio: 0.2, columnCohesion: 20, columnFrictionAngle: 30 })[0];
    expect(lcc.cohesion).toBeCloseTo(12 / 1.4, 12);
    expect(Math.tan(lcc.phi)).toBeCloseTo((0.2 * Math.tan(Math.PI / 6)) / 1.2, 12);
    // Strong rock is not factored (and the surface is skipped).
    const rock = slicesOf({ kind: "high-strength", unitWeight: 25 })[0];
    expect(rock.skipSurface).toBe(true);
  });
});

describe("degenerate surfaces", () => {
  const s = slopeOf({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 10, frictionAngle: 30 });

  it("rejects an entry at or right of the exit and a model without ground", () => {
    expect(() => getSlices(s, 20, 20, 22, 18, 18.5)).toThrow(/x0 must be less than x1/);
    expect(() => getSlices(new Slope(), 0, 1, 0, 5, 5)).toThrow(/Surface line not defined/);
  });

  it("a crack deeper than the surface leaves no sliding mass", () => {
    const t = slopeOf({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 10, frictionAngle: 30 });
    t.updateAnalysisOptions({ tensionCrackDepth: 50 });
    const ints = t.getCircleExternalIntersection(22, 18, 18.5);
    expect(getSlices(t, ints[0][0], ints[ints.length - 1][0], 22, 18, 18.5)).toEqual([]);
    // Automatic crack in clay too stiff to ever reach the surface.
    const u = slopeOf({ kind: "undrained", unitWeight: 18, undrainedShearStrength: 900 });
    u.updateAnalysisOptions({ tensionCrackAuto: true });
    expect(getSlices(u, ints[0][0], ints[ints.length - 1][0], 22, 18, 18.5)).toEqual([]);
  });

  it("a polyline through the air is no surface", () => {
    const pts: [number, number][] = [[5, 10], [15, 12], [30, 0]];
    expect(getSlices(s, 5, 30, 15, 30, 0, pts)).toEqual([]);
  });

  it("a material's own water table gives its slices pore pressure", () => {
    const t = slopeOf({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 10, frictionAngle: 30 });
    t.setWaterTableById("w", [[0, 2], [40, 1]]);
    t.assignMaterialWaterTable(t.materialGeometries[0].material, "w");
    const ints = t.getCircleExternalIntersection(22, 18, 18.5);
    const sl = getSlices(t, ints[0][0], ints[ints.length - 1][0], 22, 18, 18.5);
    expect(sl.length).toBeGreaterThan(5);
    expect(sl.some((q) => q.U > 0)).toBe(true);
  });
});

describe("per-material water without a default water table", () => {
  it("only the material with its own line gets pore pressure", () => {
    const slope = buildSlope({
      coordinates: BOUNDARY,
      materials: [
        { name: "Top", unitWeight: 19, cohesion: 10, frictionAngle: 25 },
        { name: "Base", unitWeight: 19, cohesion: 10, frictionAngle: 25, waterTableId: "w" },
      ],
      materialBoundaries: [{ coordinates: [[0, 3], [40, -2]], materialName: "Base" }],
      regionAssignments: [{ point: [1, 8], materialName: "Top" }, { point: [1, -5], materialName: "Base" }],
      waterTables: [{ id: "w", coordinates: [[0, 6], [40, 0]] }],
    });
    slope.updateAnalysisOptions({ slices: 30, porePressureHead: "phreatic-correction" });
    const ints = slope.getCircleExternalIntersection(22, 18, 18.5);
    const slices = getSlices(slope, ints[0][0], ints[ints.length - 1][0], 22, 18, 18.5);
    const top = slices.filter((q) => q.baseMaterial?.name === "Top");
    const base = slices.filter((q) => q.baseMaterial?.name === "Base");
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((q) => q.U === 0)).toBe(true);
    expect(base.some((q) => q.U > 0)).toBe(true);
  });
});
