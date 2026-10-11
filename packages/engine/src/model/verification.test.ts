/**
 * Published verification problems (see verification/cases.ts for the data
 * and sources). The same cases produce the verification report.
 */
import { describe, it, expect } from "vitest";
import { getSlices } from "./slices";
import { defaultAxisPoint, isAdmissiblePolyline } from "./surface";
import { validateMaterialModel } from "../types/validation";
import { analyseBishop, analyseMorgensternPrice } from "./solvers";
import { rankineCrackDepth } from "./slices";
import { Material } from "../types/material";
import { analyseSlope } from "./solvers";
import { RELIABILITY_CASES } from "../verification/reliability-cases";
import type { Slice } from "../types/geometry";
import {
  VERIFICATION_CASES,
  runReliabilityCase,
  circle,
  layered,
  mc,
  runVerification,
  su,
} from "../verification/cases";

describe("Verification problems", () => {
  for (const c of VERIFICATION_CASES) {
    for (const check of c.checks) {
      // Searches with non-circular optimisation take a few seconds.
      it(`${c.id} ${c.title}: ${check.label} ${check.published}`, { timeout: 30000 }, () => {
        const { fos } = runVerification(c.definition, check.method, check.options);
        expect(fos).not.toBeNull();
        expect(Math.abs(fos! - check.published) / check.published).toBeLessThanOrEqual(check.tolerance);
      });
    }
  }
});

describe("Probabilistic verification problems", () => {
  for (const c of RELIABILITY_CASES) {
    // One run per case (Taylor series and Monte Carlo), one test per check.
    let results: ReturnType<typeof runReliabilityCase> | null = null;
    const run = () => (results ??= runReliabilityCase(c));
    c.checks.forEach(([quantity, published, publishedBy, tolerance], i) => {
      if (quantity === "fos") return; // in VERIFICATION_CASES
      it(`${c.id} ${c.title}: ${quantity} ${published} (${publishedBy})`, { timeout: 120000 }, () => {
        const r = run()[i];
        expect(r.quantity).toBe(quantity);
        expect(Math.abs(r.computed - published)).toBeLessThanOrEqual(tolerance + 1e-9);
      });
    });
  }
});

describe("Slice-count convergence", () => {
  it("VP23 geometry: a nearly vertical entry slice in a stiff crust does not inflate FOS", () => {
    // Low (1989) / Slide VP23 layering with the lower clay simplified to a
    // constant Su. With the arc length as base length, 50 slices gave 1.469
    // against 1.40 at 500 slices (independent 2000-slice check: 1.389).
    const def = layered(
      [[0, 8], [10, 8], [26, 16], [40, 16]],
      0,
      [
        { name: "Upper", topY: null, model: mc(95, 15, 20) },
        { name: "Middle", topY: 8, model: mc(15, 0, 20) },
        { name: "Lower", topY: 4, model: mc(22.5, 0, 20) },
      ],
      circle(18, 16, 12),
    );
    const f50 = runVerification(def, "Bishop", { slices: 50 }).fos!;
    const f500 = runVerification(def, "Bishop", { slices: 500 }).fos!;
    expect(Math.abs(f50 / f500 - 1)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(f500 / 1.389 - 1)).toBeLessThanOrEqual(0.01);
  });
});

describe("Search convergence", () => {
  it("VP24: the local search reaches the minimum between grid points", () => {
    // The one-pass refinement stopped at the grid resolution: 1.455 with
    // 4000 grid surfaces but 1.447 with 2000. A dense brute-force search
    // gives 1.438 (Slide2 1.439).
    const c = VERIFICATION_CASES.find((v) => v.id === "VP24")!;
    const coarse = runVerification(c.definition, "Bishop", { iterations: 2000, refinedIterations: 1000 }).fos!;
    const fine = runVerification(c.definition, "Bishop", { iterations: 4000, refinedIterations: 2000 }).fos!;
    expect(Math.abs(coarse / fine - 1)).toBeLessThanOrEqual(0.002);
    expect(fine).toBeLessThanOrEqual(1.439);
  });
});

describe("Free water above the ground", () => {
  // Submerged soil is in equilibrium under buoyant weight alone, so a fully
  // submerged slope must give the FOS of the dry slope with γ' = γsat − γw.
  const ground: [number, number][] = [[0, 0], [20, 0], [40, 10], [70, 10]];
  const soil = (gamma: number) => [{ name: "S", topY: null, model: mc(5, 30, gamma) }];
  for (const method of ["Bishop", "Janbu", "Morgenstern-Price"] as const) {
    it(`${method}: fully submerged slope = buoyant dry slope`, { timeout: 20000 }, () => {
      const buoyant = runVerification(layered(ground, -10, soil(10)), method).fos!;
      const submerged = runVerification(
        layered(ground, -10, soil(19.81), {
          waterTable: { mode: "custom", value: [[0, 30], [70, 30]], followBoundary: false },
        }),
        method,
      ).fos!;
      expect(Math.abs(submerged / buoyant - 1)).toBeLessThanOrEqual(0.003);
    });
  }
});

describe("Free water against a vertical face", () => {
  // A quay wall: the thrust on the face is the only difference from a face
  // 0.06° off vertical, so the FOS must be continuous there.
  const soil = [{ name: "S", topY: null, model: mc(20, 30, 20) }];
  const wall = (dx: number, water: number) =>
    layered([[-10, -10], [-10, 10], [10, 10], [10 + dx, 0], [40, 0], [40, -10]], -10, soil, {
      waterTable: { mode: "custom", value: [[-10, water], [40, water]], followBoundary: false },
      ...circle(8, 10, 11),
    });
  it("a lake against the wall resists like one against a near-vertical face", () => {
    const vertical = runVerification(wall(0, 5), "Bishop").fos!;
    const steep = runVerification(wall(0.01, 5), "Bishop").fos!;
    expect(Math.abs(vertical / steep - 1)).toBeLessThan(0.002);
    // Without the thrust the FOS was 2.02.
    expect(vertical).toBeGreaterThan(2.3);
  });
  it("a submerged vertical cut = the buoyant cut", () => {
    const submerged = runVerification(wall(0, 15), "Bishop").fos!;
    const buoyant = runVerification(
      layered([[-10, -10], [-10, 10], [10, 10], [10, 0], [40, 0], [40, -10]], -10, [{ name: "S", topY: null, model: mc(20, 30, 20 - 9.81) }], circle(8, 10, 11)),
      "Bishop",
    ).fos!;
    expect(Math.abs(submerged / buoyant - 1)).toBeLessThan(0.001);
  });
});

describe("Combined method", () => {
  it("accepts a surface whose steep exit slice is governed by the undrained strength", () => {
    // Exit slice at α ≈ −54°: m_α with φ′ = 35° is negative, but the slice
    // is in equilibrium with cu (tan φ = 0), which is what was solved.
    const ground: [number, number][] = [[-30, 10], [10, 10], [20, 0], [40, 0]];
    const combined = { ...mc(5, 35, 20), cohesionUndrained: 10, cFactor: 1 };
    const fos = runVerification(layered(ground, -10, [{ name: "C", topY: null, model: combined }], circle(8, 10.6, 20)), "Bishop").fos;
    const undrained = runVerification(layered(ground, -10, [{ name: "C", topY: null, model: su(10, 20) }], circle(8, 10.6, 20)), "Bishop").fos;
    expect(undrained).not.toBeNull();
    expect(fos).not.toBeNull();
    // The combined strength is the smaller of the two on every slice.
    expect(fos!).toBeLessThanOrEqual(undrained! + 1e-9);
    expect(fos!).toBeGreaterThan(0.9 * undrained!);
  });
});

describe("Tension crack", () => {
  const def = layered([[0, 25], [30, 25], [50, 35], [90, 35]], 20, [{ name: "S", topY: null, model: mc(32, 10, 20) }]);

  it("starts the sliding mass where the surface is the crack depth below ground", () => {
    const { slope } = runVerification(def, "Bishop", { tensionCrackDepth: 2, iterations: 500 });
    const plane = slope.search.find((p) => p.fos != null && p.crack)!;
    const slices = getSlices(slope, plane.lc[0], plane.rc[0], plane.cx, plane.cy, plane.radius);
    expect(slices[0].y0Top - slices[0].y0Bottom).toBeCloseTo(2, 6);
    expect(plane.crack![0]).toBeCloseTo(slices[0].xLeft, 9);
  });

  it("water in the crack lowers the FOS", () => {
    const dry = runVerification(def, "Bishop", { tensionCrackDepth: 3.814 }).fos!;
    const wet = runVerification(def, "Bishop", { tensionCrackDepth: 3.814, tensionCrackWater: 1 }).fos!;
    expect(wet).toBeLessThan(dry);
  });

  it("a crack deeper than any surface leaves no sliding mass", () => {
    expect(runVerification(def, "Bishop", { tensionCrackDepth: 30 }).fos).toBeNull();
  });

  it("surfaces too shallow for the crack never keep a placeholder FOS", () => {
    // Refined and local planes used to arrive with fos: 100 and keep it
    // when getSlices returned nothing, swamping Max FOS and the colour scale.
    const { slope } = runVerification(def, "Bishop", { tensionCrackDepth: 6 });
    expect(slope.search.length).toBeGreaterThan(0);
    for (const p of slope.search) {
      // A reported FOS always belongs to a surface that was sliced.
      if (p.fos != null) expect(p.slices).not.toBeNull();
    }
  });
});

describe("Partial factors", () => {
  const ground: [number, number][] = [[0, 0], [10, 0], [25, 10], [40, 10]];
  const fixed = circle(12, 22, 22.2);
  const pf = (over: Partial<{ cu: number; cohesion: number; tanPhi: number; variableLoad: number }>) => ({
    partialFactors: { cu: 1, cohesion: 1, tanPhi: 1, variableLoad: 1, ...over },
  });

  it("γcu divides the FOS of an undrained slope", () => {
    const def = layered(ground, -10, [{ name: "Clay", topY: null, model: su(30, 18) }], fixed);
    const fk = runVerification(def, "Bishop").fos!;
    const fd = runVerification(def, "Bishop", pf({ cu: 1.5 })).fos!;
    expect(fd).toBeCloseTo(fk / 1.5, 6);
  });

  it("Mohr-Coulomb with φ = 0 is undrained and takes γcu", () => {
    const def = layered(ground, -10, [{ name: "Clay", topY: null, model: mc(30, 0, 18) }], fixed);
    const fk = runVerification(def, "Bishop").fos!;
    const fd = runVerification(def, "Bishop", pf({ cu: 1.5, cohesion: 1.3 })).fos!;
    expect(fd).toBeCloseTo(fk / 1.5, 6);
  });

  it("γc' and γφ' together divide the FOS of a drained slope", () => {
    const def = layered(ground, -10, [{ name: "S", topY: null, model: mc(10, 25, 19) }], fixed);
    const fk = runVerification(def, "Bishop").fos!;
    const fd = runVerification(def, "Bishop", pf({ cohesion: 1.3, tanPhi: 1.3 })).fos!;
    expect(fd).toBeCloseTo(fk / 1.3, 3);
  });

  it("γQ scales distributed and line loads", () => {
    const loads = (q: number) => ({ udls: [{ magnitude: q, x1: 27, x2: 32 }], lineLoads: [{ magnitude: q, x: 30 }] });
    const soil = [{ name: "S", topY: null, model: mc(10, 25, 19) }];
    const factored = runVerification(layered(ground, -10, soil, { ...fixed, ...loads(20) }), "Bishop", pf({ variableLoad: 1.3 })).fos!;
    const scaled = runVerification(layered(ground, -10, soil, { ...fixed, ...loads(26) }), "Bishop").fos!;
    expect(factored).toBeCloseTo(scaled, 9);
  });
});

describe("Non-circular surfaces", () => {
  const ground: [number, number][] = [[0, 0], [10, 0], [25, 10], [40, 10]];
  const soil = [{ name: "S", topY: null, model: mc(10, 25, 19) }];
  const [cx, cy, r] = [12, 22, 22.2];

  it("a dense polyline on a circle about its centre gives the circle's FOS", () => {
    const circleFos = runVerification(layered(ground, -10, soil, circle(cx, cy, r)), "Bishop").fos!;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 400; i++) {
      const x = -8 + (48 * i) / 400;
      const t = r * r - (x - cx) ** 2;
      if (t > 0) pts.push([x, cy - Math.sqrt(t)]);
    }
    const { slope } = runVerification(
      layered(ground, -10, soil, { customSurfaces: [{ points: pts }], customPlanesOnly: true }),
      "Bishop",
    );
    const plane = slope.search[0];
    // About the circle centre (not the default axis) the methods coincide.
    plane.cx = cx;
    plane.cy = cy;
    const fit = getSlices(slope, plane.lc[0], plane.rc[0], cx, cy, 0, plane.points);
    const [fos] = analyseBishop(slope, fit);
    expect(fos!).toBeCloseTo(circleFos, 2);
  });

  it("Spencer and M-P on a polyline do not depend on the axis point", () => {
    const pts: [number, number][] = [[8, 0], [14, -3], [24, -2], [30, 10]];
    const def = layered(ground, -10, soil, { customSurfaces: [{ points: pts }], customPlanesOnly: true });
    const { slope } = runVerification(def, "Morgenstern-Price");
    const p = slope.search[0];
    const fos = (ax: number, ay: number) => {
      const [f] = analyseMorgensternPrice(slope, getSlices(slope, p.lc[0], p.rc[0], ax, ay, 0, p.points));
      return f!;
    };
    expect(fos(20, 30)).toBeCloseTo(fos(10, 50), 2);
  });

  it("optimisation never ends above the best circle", () => {
    const def = layered(ground, -10, soil);
    const c = runVerification(def, "Bishop").fos!;
    const nc = runVerification(def, "Bishop", { nonCircularOptimization: true }).fos!;
    expect(nc).toBeLessThanOrEqual(c + 1e-9);
  });

  it("a polyline cutting through the air between entry and exit gives no slices", () => {
    // Left-to-right slope, so these are canonical coordinates. The ground
    // at x = 26 is at y = 2.7; the vertex at 5 is in the air.
    const ltr: [number, number][] = [[0, 10], [15, 10], [30, 0], [40, 0]];
    const { slope } = runVerification(layered(ltr, -10, soil), "Bishop", { iterations: 500 });
    const inAir: [number, number][] = [[10, 10], [18, 6], [26, 5], [35, 0]];
    expect(getSlices(slope, 10, 35, 20, 30, 0, inAir)).toEqual([]);
    const below: [number, number][] = [[10, 10], [18, 6], [26, 0], [35, 0]];
    expect(getSlices(slope, 10, 35, 20, 30, 0, below).length).toBeGreaterThan(0);
  });
});

describe("Non-circular review fixes", () => {
  const ground: [number, number][] = [[0, 0], [10, 0], [25, 10], [40, 10]];
  const soil = [{ name: "S", topY: null, model: mc(10, 25, 19) }];

  it("polyline kinks stay slice boundaries with fixed slices", () => {
    const ltr: [number, number][] = [[0, 10], [15, 10], [30, 0], [40, 0]];
    const { slope } = runVerification(layered(ltr, -10, soil), "Bishop", { iterations: 500 });
    slope.addFixedSlices([14, 22]);
    const pts: [number, number][] = [[10, 10], [17.37, 7], [25.71, -1], [35, 0]];
    const slices = getSlices(slope, 10, 35, 20, 30, 0, pts);
    expect(slices.length).toBeGreaterThan(0);
    const edges = new Set(slices.flatMap((s) => [s.xLeft, s.xRight]));
    for (const [x] of pts) expect(edges.has(x)).toBe(true);
  });

  it("a custom polyline that misses the ground or leaves the model is skipped, not fatal", () => {
    const def = layered(ground, -10, soil, {
      customSurfaces: [
        { points: [[0, 20], [40, 20]] }, // above the ground
        { points: [[8, 0], [15, -14], [30, 10]] }, // below the model base
      ],
    });
    const { fos, slope } = runVerification(def, "Bishop");
    expect(fos).not.toBeNull();
    expect(slope.search.some((p) => p.points)).toBe(false);
  });

  it("the default axis lies above a deep, skewed surface", () => {
    const axis = defaultAxisPoint([[0, 0], [0.1, -5], [10, 0]]);
    expect(axis[1]).toBeGreaterThan(2);
  });

  it("surfaces with undefined points are not admissible", () => {
    const { slope } = runVerification(layered(ground, -10, soil), "Bishop", { iterations: 200 });
    expect(isAdmissiblePolyline(slope, [[12, 1], [20, 2], [30, 10]])).toBe(true);
    expect(isAdmissiblePolyline(slope, [[12, Number.NaN], [20, 2], [30, 10]])).toBe(false);
  });

  it("optimisation respects the minimum failure distance", () => {
    const def = layered(ground, -10, [{ name: "S", topY: null, model: mc(0, 30, 19) }]);
    const { slope } = runVerification(def, "Bishop", { nonCircularOptimization: true, minFailureDist: 15 });
    for (const p of slope.search) {
      if (p.points && p.fos != null) expect(p.rc[0] - p.lc[0]).toBeGreaterThan(15);
    }
  });
});

describe("Minimum slip depth", () => {
  it("surfaces shallower than the minimum are not analysed", () => {
    const def = layered([[0, 0], [10, 0], [25, 10], [40, 10]], -10, [{ name: "S", topY: null, model: mc(0, 30, 19) }]);
    const free = runVerification(def, "Bishop");
    const limited = runVerification(def, "Bishop", { minSlipDepth: 2 });
    expect(limited.fos!).toBeGreaterThan(free.fos!);
    for (const p of limited.slope.search) {
      if (p.fos == null) continue;
      const depth = Math.max(...p.slices!.map((s) => s.y0Top - s.y0Bottom));
      expect(depth).toBeGreaterThanOrEqual(2 - 1e-9);
    }
  });

  it("degenerate surfaces that only scratch the ground are skipped", () => {
    // Cohesive soil: FOS ∝ c/(γ·depth) is unbounded for very thin surfaces.
    const def = layered([[0, 0], [10, 0], [25, 10], [40, 10]], -10, [{ name: "C", topY: null, model: su(12, 19) }]);
    const { slope } = runVerification(def, "Bishop");
    const minDepth = 1e-3 * slope.modelHeight;
    for (const p of slope.search) {
      if (p.fos == null) continue;
      const depth = Math.max(...p.slices!.map((s) => Math.max(s.y0Top - s.y0Bottom, s.y1Top - s.y1Bottom)));
      expect(depth).toBeGreaterThanOrEqual(minDepth);
    }
  });
  it("sliding masses below the minimum area are skipped (automatic by default)", () => {
    const def = layered([[0, 0], [10, 0], [25, 10], [40, 10]], -10, [{ name: "C", topY: null, model: su(12, 19) }]);
    const area = (p: { slices?: { area: number }[] | null }) => p.slices!.reduce((a, s) => a + s.area, 0);
    const auto = runVerification(def, "Bishop");
    expect(auto.slope.minSlipArea).toBeCloseTo(1e-2 * 10 ** 2);
    for (const p of auto.slope.search) {
      if (p.fos != null) expect(area(p)).toBeGreaterThanOrEqual(auto.slope.minSlipArea);
    }
    const set = runVerification(def, "Bishop", { minSlipArea: 5 });
    for (const p of set.slope.search) if (p.fos != null) expect(area(p)).toBeGreaterThanOrEqual(5);
    // 0 turns the limit off: smaller surfaces are analysed again.
    const off = runVerification(def, "Bishop", { minSlipArea: 0 });
    expect(off.slope.search.some((p) => p.fos != null && area(p) < auto.slope.minSlipArea)).toBe(true);
    expect(auto.fos!).toBeCloseTo(off.fos!, 6);
  });
});

describe("Saturated unit weight", () => {
  const ground: [number, number][] = [[0, 0], [10, 0], [20, 10], [30, 10]];
  const water = { waterTable: { mode: "custom" as const, value: [[0, 4], [30, 4]] as [number, number][], followBoundary: false } };
  const slicesFor = (gammaSat?: number) => {
    const model = { ...mc(5, 30, 18), ...(gammaSat !== undefined ? { unitWeightSat: gammaSat } : {}) };
    const def = layered(ground, -10, [{ name: "S", topY: null, model }], { ...water, ...circle(8, 22, 22) });
    const { slope } = runVerification(def, "Bishop");
    return slope.search[0].slices!;
  };

  it("soil below the water line weighs γsat, above it γ", () => {
    const plain = slicesFor();
    const sat = slicesFor(21);
    expect(sat.length).toBe(plain.length);
    let below = 0;
    let above = 0;
    for (let i = 0; i < sat.length; i++) {
      const s = sat[i];
      const top = Math.max(s.y0Top, s.y1Top);
      const bottom = Math.min(s.y0Bottom, s.y1Bottom);
      if (top < 4 - 1e-6) {
        expect(s.weight / s.area).toBeCloseTo(21, 9);
        below++;
      } else if (bottom > 4 - 1e-6) {
        expect(s.weight).toBeCloseTo(plain[i].weight, 9);
        above++;
      } else {
        expect(s.weight).toBeGreaterThan(plain[i].weight);
        expect(s.weight).toBeLessThan(plain[i].weight * (21 / 18));
      }
    }
    expect(below).toBeGreaterThan(0);
    expect(above).toBeGreaterThan(0);
  });

  it("the extra weight is proportional to γsat − γ", () => {
    const w = (g?: number) => slicesFor(g).reduce((a, s) => a + s.weight, 0);
    const base = w();
    expect((w(21) - base) / (w(19) - base)).toBeCloseTo(3, 9);
    // Equal to γ changes nothing.
    expect(w(18)).toBeCloseTo(base, 9);
  });

  it("an invalid γsat is reported", () => {
    expect(validateMaterialModel({ ...mc(5, 30, 18), unitWeightSat: -1 })).not.toEqual([]);
    expect(validateMaterialModel({ ...mc(5, 30, 18), unitWeightSat: 20 })).toEqual([]);
  });
});

describe("Automatic tension crack depth", () => {
  // Crest on the left: canonical coordinates are the model's own.
  const ground: [number, number][] = [[0, 10], [10, 10], [20, 0], [30, 0]];
  const slopeWith = (model: ReturnType<typeof mc>, opts: Record<string, unknown> = {}, extra = {}) => {
    const def = layered(ground, -10, [{ name: "S", topY: null, model }], extra);
    return runVerification(def, "Bishop", { tensionCrackAuto: true, ...opts });
  };

  it("is the Rankine depth of the soil at the crest", { timeout: 30000 }, () => {
    // Undrained: 2cu/γ
    expect(rankineCrackDepth(slopeWith(su(20, 18)).slope, 5)).toBeCloseTo(40 / 18, 9);
    // Drained: 2c/(γ√Ka), Ka = tan²(45° − φ/2)
    const sqrtKa = Math.tan(Math.PI / 4 - Math.PI / 12);
    expect(rankineCrackDepth(slopeWith(mc(10, 30, 18)).slope, 5)).toBeCloseTo(20 / (18 * sqrtKa), 9);
    // A surcharge closes the crack by q/γ
    const loaded = slopeWith(su(20, 18), {}, { udls: [{ magnitude: 10, x1: 2, x2: 8 }] });
    expect(rankineCrackDepth(loaded.slope, 5)).toBeCloseTo(30 / 18, 9);
    expect(rankineCrackDepth(loaded.slope, 9)).toBeCloseTo(40 / 18, 9);
    // Design strength with partial factors
    const pf = slopeWith(su(20, 18), { partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 } });
    expect(rankineCrackDepth(pf.slope, 5)).toBeCloseTo(40 / 1.5 / 18, 9);
    // Cohesionless soil: no crack
    expect(rankineCrackDepth(slopeWith(mc(0, 30, 18)).slope, 5)).toBe(0);
  });

  it("depends on the soil at the crack, so re-slicing from the crack finds it again", () => {
    // Load from x = 0 to 3 on the crest; this circle enters under the load
    // (Rankine depth 1.67 m) and cracks beyond it (2.22 m), so the depth at
    // the entry would put the crack elsewhere.
    const loaded = slopeWith(su(20, 18), {}, { udls: [{ magnitude: 10, x1: 0, x2: 3 }], ...circle(14, 18, 14) });
    expect(loaded.slope.search[0].lc[0]).toBeLessThan(3);
    expect(loaded.slope.search[0].crack![0]).toBeGreaterThan(3);
    const p = loaded.slope.search.find((q) => q.fos != null && q.crack)!;
    const again = getSlices(loaded.slope, p.crack![0], p.rc[0], p.cx, p.cy, p.radius);
    expect(again[0].xLeft).toBeCloseTo(p.crack![0], 6);
    const depth = rankineCrackDepth(loaded.slope, p.crack![0]);
    expect(again[0].y0Top - again[0].y0Bottom).toBeCloseTo(depth, 6);
  });

  it("is recomputed after a material change", () => {
    const run = slopeWith(su(40, 18), {}, circle(12, 16, 12));
    const before = run.slope.search[0].crack;
    expect(before).toBeDefined();
    run.slope.assignMaterial([5, 5], new Material({ name: "Sand", unitWeight: 18, frictionAngle: 30, cohesion: 0 }));
    expect(run.slope.search).toHaveLength(0); // results dropped
    analyseSlope(run.slope);
    expect(run.slope.search[0].crack).toBeUndefined();
  });

  it("free water on the crest closes the crack like a surcharge", () => {
    const wet = slopeWith(su(20, 18), {}, { waterTable: { mode: "custom", value: [[0, 11], [30, 11]], followBoundary: false } });
    expect(rankineCrackDepth(wet.slope, 5)).toBeCloseTo((40 - 9.81) / 18, 2);
  });

  it("gives the same result as the same fixed depth", () => {
    const auto = slopeWith(su(20, 18));
    const fixed = runVerification(layered(ground, -10, [{ name: "S", topY: null, model: su(20, 18) }]), "Bishop", { tensionCrackDepth: 40 / 18 });
    expect(auto.fos!).toBeCloseTo(fixed.fos!, 9);
    const crack = auto.slope.search.find((p) => p.fos != null)!.crack!;
    expect(crack).toBeDefined();
  });
});

describe("Spencer against an independent solution", () => {
  // Spencer (1967), circular surface: Q from slice equilibrium with the
  // interslice resultant at θ; force ΣQ = 0 and moment ΣQ cos(α − θ) = 0.
  // Independent of the solvers' marching formulation; only the slices are
  // shared. Clay over friction soil with water, the circle reaching into
  // the friction soil near the toe, where the normal forces (and so the
  // method) matter.
  function independentSpencer(sl: Slice[]) {
    const sums = (F: number, th: number) => {
      let force = 0;
      let moment = 0;
      for (const s of sl) {
        const a = s.alpha;
        const tp = Math.tan(s.phi);
        const W = s.weight + s.udl + s.ll;
        const q =
          ((s.cohesion * s.width) / F / Math.cos(a) +
            (tp / F) * (W * Math.cos(a) - (s.U * s.width) / Math.cos(a)) -
            W * Math.sin(a)) /
          (Math.cos(a - th) * (1 + (tp * Math.tan(a - th)) / F));
        force += q;
        moment += q * Math.cos(a - th);
      }
      return { force, moment };
    };
    const root = (g: (x: number) => number, lo: number, hi: number) => {
      for (let k = 0; k < 100; k++) {
        const m = (lo + hi) / 2;
        if (Math.sign(g(m)) === Math.sign(g(lo))) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    };
    const fm = (th: number) => root((F) => sums(F, th).moment, 0.3, 4);
    const ff = (th: number) => root((F) => sums(F, th).force, 0.3, 4);
    const th = root((t) => fm(t) - ff(t), -0.3, 0.6);
    return { spencer: fm(th), bishop: fm(0) };
  }

  it("cSlope's Spencer and Bishop match it on a clay/friction-soil circle", () => {
    const def = layered(
      [[0, 10], [10, 10], [20, 3], [30, 3]],
      -10,
      [
        { name: "Clay", topY: null, model: su(18, 17) },
        { name: "Sand", topY: 2, model: mc(0, 32, 20) },
      ],
      { waterTable: { mode: "custom", value: [[0, 6], [20, 3], [30, 3]], followBoundary: true }, ...circle(16, 16, 15) },
    );
    const spencer = runVerification(def, "Morgenstern-Price", { intersliceFunction: "constant" });
    const bishop = runVerification(def, "Bishop");
    const slices = spencer.slope.search[0].slices!;
    expect(slices.some((s) => s.phi > 0)).toBe(true);
    const ref = independentSpencer(slices);
    expect(bishop.fos!).toBeCloseTo(ref.bishop, 3);
    expect(Math.abs(spencer.fos! / ref.spencer - 1)).toBeLessThan(0.005);
    // The interslice shear raises the normal force on the friction-soil
    // slices at the toe: Spencer is clearly above Bishop here.
    expect(ref.spencer).toBeGreaterThan(ref.bishop * 1.01);
  });
});
