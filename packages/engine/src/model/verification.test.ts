/**
 * Published verification problems (see verification/cases.ts for the data
 * and sources). The same cases produce the verification report.
 */
import { describe, it, expect } from "vitest";
import { getSlices } from "./slices";
import { defaultAxisPoint } from "./surface";
import { analyseBishop, analyseMorgensternPrice } from "./solvers";
import {
  VERIFICATION_CASES,
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
    const area = (p: { slices?: { area: number }[] }) => p.slices!.reduce((a, s) => a + s.area, 0);
    const auto = runVerification(def, "Bishop");
    expect(auto.slope.minSlipArea).toBeCloseTo(1e-3 * auto.slope.modelArea);
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
