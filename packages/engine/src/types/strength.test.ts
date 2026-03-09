import { describe, expect, it } from "vitest";
import { resolveStrength, interpolateFunction } from "./strength";
import type {
  MohrCoulombModel,
  UndrainedModel,
  HighStrengthModel,
  ImpenetrableModel,
  AnisotropicFunctionModel,
  StrengthFromDepthModel,
  StrengthFromDatumModel,
  SpatialMohrCoulombModel,
} from "./material-models";
import type { StrengthContext } from "./strength";
import { Material } from "./material";
import { interpolateIDW, interpolateNearest } from "../math/interpolation";
import type { SpatialDataPoint } from "../math/interpolation";

// ── Helpers ────────────────────────────────────────────────────

const baseCtx: StrengthContext = {
  yBottom: 0,
  x: 0,
  yGround: 10,
  alpha: 0,
};

function ctx(overrides: Partial<StrengthContext> = {}): StrengthContext {
  return { ...baseCtx, ...overrides };
}

// ── Mohr-Coulomb ───────────────────────────────────────────────

describe("resolveStrength — mohr-coulomb", () => {
  const mc: MohrCoulombModel = {
    kind: "mohr-coulomb",
    unitWeight: 20,
    cohesion: 10,
    frictionAngle: 30,
  };

  it("returns base c and φ at zero depth", () => {
    const r = resolveStrength(mc, ctx());
    expect(r.cohesion).toBe(10);
    expect(r.frictionAngle).toBe(30);
    expect(r.skipSurface).toBeUndefined();
    expect(r.impenetrable).toBeUndefined();
  });

  it("applies depth-dependent cohesion", () => {
    const mcDepth: MohrCoulombModel = {
      ...mc,
      cohesionRefDepth: 5,
      cohesionRateOfChange: 2,
    };
    // At yBottom=3: c = 10 + (5-3)*2 = 14
    const r = resolveStrength(mcDepth, ctx({ yBottom: 3 }));
    expect(r.cohesion).toBe(14);
  });

  it("applies cFactor for Combined method", () => {
    const mcCombined: MohrCoulombModel = {
      ...mc,
      cFactor: 0.5,
    };
    // c = 10 * 0.5 = 5
    const r = resolveStrength(mcCombined, ctx());
    expect(r.cohesion).toBe(5);
  });

  it("matches legacy Material.getCohesion()", () => {
    const legacy = new Material({
      cohesion: 10,
      frictionAngle: 30,
      cohesionRefDepth: 5,
      cohesionRateOfChange: 2,
    });
    const r = resolveStrength(legacy.model, ctx({ yBottom: 3 }));
    expect(r.cohesion).toBe(legacy.getCohesion(3));
  });

  it("matches legacy Material.getCohesion() at ref depth", () => {
    const legacy = new Material({
      cohesion: 10,
      frictionAngle: 30,
      cohesionRefDepth: 5,
      cohesionRateOfChange: 2,
    });
    expect(resolveStrength(legacy.model, ctx({ yBottom: 5 })).cohesion).toBe(
      legacy.getCohesion(5),
    );
  });

  it("matches legacy Material.getCohesionUndrained()", () => {
    const legacy = new Material({
      cohesion: 10,
      frictionAngle: 30,
      cohesionRefDepth: 5,
      cohesionRateOfChange: 2,
      cohesionUndrained: 20,
    });
    const r = resolveStrength(legacy.model, ctx({ yBottom: 3 }));
    expect(r.cohesionUndrained).toBe(legacy.getCohesionUndrained(3));
  });
});

// ── Undrained ──────────────────────────────────────────────────

describe("resolveStrength — undrained", () => {
  const ud: UndrainedModel = {
    kind: "undrained",
    unitWeight: 18,
    undrainedShearStrength: 50,
  };

  it("returns Su as cohesion, φ = 0", () => {
    const r = resolveStrength(ud, ctx());
    expect(r.cohesion).toBe(50);
    expect(r.frictionAngle).toBe(0);
    expect(r.cohesionUndrained).toBe(50);
  });

  it("applies depth-dependent Su", () => {
    const udDepth: UndrainedModel = {
      ...ud,
      suRefDepth: 5,
      suRateOfChange: 3,
    };
    // At yBottom=2: Su = 50 + (5-2)*3 = 59
    const r = resolveStrength(udDepth, ctx({ yBottom: 2 }));
    expect(r.cohesion).toBe(59);
  });

  it("does not set skipSurface or impenetrable", () => {
    const r = resolveStrength(ud, ctx());
    expect(r.skipSurface).toBeUndefined();
    expect(r.impenetrable).toBeUndefined();
  });

  it("returns Su at zero depth when no rate specified", () => {
    const r = resolveStrength(ud, ctx({ yBottom: 0 }));
    expect(r.cohesion).toBe(50);
  });

  it("handles negative depth (above ref)", () => {
    const udDepth: UndrainedModel = {
      ...ud,
      suRefDepth: 0,
      suRateOfChange: 2,
    };
    // yBottom = 5 → Su = 50 + (0-5)*2 = 40
    const r = resolveStrength(udDepth, ctx({ yBottom: 5 }));
    expect(r.cohesion).toBe(40);
  });
});

// ── High Strength ──────────────────────────────────────────────

describe("resolveStrength — high-strength", () => {
  const hs: HighStrengthModel = {
    kind: "high-strength",
    unitWeight: 24,
  };

  it("returns infinite cohesion and skipSurface", () => {
    const r = resolveStrength(hs, ctx());
    expect(r.cohesion).toBe(Infinity);
    expect(r.frictionAngle).toBe(90);
    expect(r.skipSurface).toBe(true);
  });

  it("does not set impenetrable", () => {
    const r = resolveStrength(hs, ctx());
    expect(r.impenetrable).toBeUndefined();
  });

  it("returns same values regardless of context", () => {
    const r1 = resolveStrength(hs, ctx({ yBottom: -100 }));
    const r2 = resolveStrength(hs, ctx({ yBottom: 100, alpha: Math.PI }));
    expect(r1.cohesion).toBe(r2.cohesion);
    expect(r1.frictionAngle).toBe(r2.frictionAngle);
    expect(r1.skipSurface).toBe(r2.skipSurface);
  });
});

// ── Impenetrable ───────────────────────────────────────────────

describe("resolveStrength — impenetrable", () => {
  const imp: ImpenetrableModel = {
    kind: "impenetrable",
    unitWeight: 25,
  };

  it("returns impenetrable flag", () => {
    const r = resolveStrength(imp, ctx());
    expect(r.impenetrable).toBe(true);
  });

  it("does not set skipSurface", () => {
    const r = resolveStrength(imp, ctx());
    expect(r.skipSurface).toBeUndefined();
  });

  it("returns zeroed strength values", () => {
    const r = resolveStrength(imp, ctx());
    expect(r.cohesion).toBe(0);
    expect(r.frictionAngle).toBe(0);
    expect(r.cohesionUndrained).toBe(0);
  });
});

// ── Anisotropic Function ───────────────────────────────────────

describe("resolveStrength — anisotropic-function", () => {
  const aniso: AnisotropicFunctionModel = {
    kind: "anisotropic-function",
    unitWeight: 19,
    cohesion: 20,
    frictionAngle: 25,
    modifierFunction: [
      [0, 1.0],
      [45, 0.8],
      [90, 0.5],
    ],
  };

  it("returns unmodified at α = 0", () => {
    const r = resolveStrength(aniso, ctx({ alpha: 0 }));
    expect(r.cohesion).toBeCloseTo(20);
    expect(r.frictionAngle).toBeCloseTo(25);
  });

  it("interpolates modifier at α = 45°", () => {
    const alpha45 = (45 * Math.PI) / 180;
    const r = resolveStrength(aniso, ctx({ alpha: alpha45 }));
    expect(r.cohesion).toBeCloseTo(20 * 0.8);
    expect(r.frictionAngle).toBeCloseTo(25 * 0.8);
  });

  it("interpolates at intermediate α", () => {
    const alpha22 = (22.5 * Math.PI) / 180;
    const r = resolveStrength(aniso, ctx({ alpha: alpha22 }));
    // Modifier at 22.5° = lerp(1.0, 0.8, 0.5) = 0.9
    expect(r.cohesion).toBeCloseTo(20 * 0.9);
  });

  it("returns factor=1 when modifier is empty", () => {
    const anisoEmpty: AnisotropicFunctionModel = {
      ...aniso,
      modifierFunction: [],
    };
    const r = resolveStrength(anisoEmpty, ctx({ alpha: 0.5 }));
    // Empty modifier → factor = 1
    expect(r.cohesion).toBeCloseTo(20);
  });

  it("clamps modifier beyond table range", () => {
    // α = 120° is beyond [0, 90] → should clamp to last value (0.5)
    const alpha120 = (120 * Math.PI) / 180;
    const r = resolveStrength(aniso, ctx({ alpha: alpha120 }));
    expect(r.cohesion).toBeCloseTo(20 * 0.5);
    expect(r.frictionAngle).toBeCloseTo(25 * 0.5);
  });

  it("clamps modifier below table range", () => {
    // α = -10° is below [0, 90] → should clamp to first value (1.0)
    const alphaNeg = (-10 * Math.PI) / 180;
    const r = resolveStrength(aniso, ctx({ alpha: alphaNeg }));
    expect(r.cohesion).toBeCloseTo(20 * 1.0);
  });

  it("sets φ = 0 correctly", () => {
    const anisoZeroPhi: AnisotropicFunctionModel = {
      ...aniso,
      frictionAngle: 0,
    };
    const alpha45 = (45 * Math.PI) / 180;
    const r = resolveStrength(anisoZeroPhi, ctx({ alpha: alpha45 }));
    expect(r.frictionAngle).toBe(0);
  });

  it("sets cohesionUndrained = modified c", () => {
    const alpha45 = (45 * Math.PI) / 180;
    const r = resolveStrength(aniso, ctx({ alpha: alpha45 }));
    expect(r.cohesionUndrained).toBeCloseTo(r.cohesion);
  });
});

// ── S = f(depth) ───────────────────────────────────────────────

describe("resolveStrength — s-f-depth", () => {
  const sfd: StrengthFromDepthModel = {
    kind: "s-f-depth",
    unitWeight: 18,
    strengthFunction: [
      [0, 20],
      [5, 40],
      [10, 60],
    ],
  };

  it("interpolates Su from depth below ground", () => {
    // yGround=10, yBottom=5 → depth=5 → Su=40
    const r = resolveStrength(sfd, ctx({ yGround: 10, yBottom: 5 }));
    expect(r.cohesion).toBeCloseTo(40);
    expect(r.frictionAngle).toBe(0);
  });

  it("clamps at upper boundary", () => {
    // depth = 12 (beyond table) → Su = 60 (last point)
    const r = resolveStrength(sfd, ctx({ yGround: 12, yBottom: 0 }));
    expect(r.cohesion).toBeCloseTo(60);
  });

  it("returns Su at ground surface (depth=0)", () => {
    const r = resolveStrength(sfd, ctx({ yGround: 10, yBottom: 10 }));
    // depth = 0 → Su = 20
    expect(r.cohesion).toBeCloseTo(20);
  });

  it("interpolates at intermediate depth", () => {
    // yGround=10, yBottom=7.5 → depth=2.5 → lerp(20, 40, 0.5)=30
    const r = resolveStrength(sfd, ctx({ yGround: 10, yBottom: 7.5 }));
    expect(r.cohesion).toBeCloseTo(30);
  });

  it("returns 0 for empty function", () => {
    const sfdEmpty: StrengthFromDepthModel = {
      kind: "s-f-depth",
      unitWeight: 18,
      strengthFunction: [],
    };
    const r = resolveStrength(sfdEmpty, ctx());
    expect(r.cohesion).toBe(0);
  });

  it("returns single value for single-point function", () => {
    const sfdSingle: StrengthFromDepthModel = {
      kind: "s-f-depth",
      unitWeight: 18,
      strengthFunction: [[5, 42]],
    };
    const r = resolveStrength(sfdSingle, ctx({ yGround: 10, yBottom: 0 }));
    expect(r.cohesion).toBe(42);
  });

  it("always has φ = 0 and cohesionUndrained = cohesion", () => {
    const r = resolveStrength(sfd, ctx({ yGround: 10, yBottom: 5 }));
    expect(r.frictionAngle).toBe(0);
    expect(r.cohesionUndrained).toBeCloseTo(r.cohesion);
  });
});

// ── S = f(datum) ───────────────────────────────────────────────

describe("resolveStrength — s-f-datum", () => {
  const sfdat: StrengthFromDatumModel = {
    kind: "s-f-datum",
    unitWeight: 18,
    strengthFunction: [
      [0, 80],
      [10, 40],
      [20, 10],
    ],
  };

  it("interpolates Su from elevation", () => {
    // yBottom = 5 → lerp(80, 40, 0.5) = 60
    const r = resolveStrength(sfdat, ctx({ yBottom: 5 }));
    expect(r.cohesion).toBeCloseTo(60);
    expect(r.frictionAngle).toBe(0);
  });

  it("clamps at lower bound", () => {
    // yBottom = -5 → below table → Su = 80
    const r = resolveStrength(sfdat, ctx({ yBottom: -5 }));
    expect(r.cohesion).toBeCloseTo(80);
  });

  it("clamps at upper bound", () => {
    // yBottom = 25 → above table → Su = 10
    const r = resolveStrength(sfdat, ctx({ yBottom: 25 }));
    expect(r.cohesion).toBeCloseTo(10);
  });

  it("interpolates at intermediate elevation", () => {
    // yBottom = 15 → lerp(40, 10, 0.5) = 25
    const r = resolveStrength(sfdat, ctx({ yBottom: 15 }));
    expect(r.cohesion).toBeCloseTo(25);
  });

  it("returns exact value at table point", () => {
    const r = resolveStrength(sfdat, ctx({ yBottom: 10 }));
    expect(r.cohesion).toBeCloseTo(40);
  });

  it("returns 0 for empty function", () => {
    const sfdatEmpty: StrengthFromDatumModel = {
      kind: "s-f-datum",
      unitWeight: 18,
      strengthFunction: [],
    };
    const r = resolveStrength(sfdatEmpty, ctx());
    expect(r.cohesion).toBe(0);
  });

  it("always has φ = 0", () => {
    const r = resolveStrength(sfdat, ctx({ yBottom: 5 }));
    expect(r.frictionAngle).toBe(0);
  });
});

// ── Spatial Mohr-Coulomb (IDW interpolation) ───────────────────

describe("resolveStrength — spatial-mohr-coulomb", () => {
  it("returns zero for empty data points", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [],
    };
    const r = resolveStrength(smc, ctx());
    expect(r.cohesion).toBe(0);
    expect(r.frictionAngle).toBe(0);
  });

  it("returns exact values when query coincides with single data point", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [[5, 3, 15, 28, 20]],
    };
    const r = resolveStrength(smc, ctx({ x: 5, yBottom: 3 }));
    expect(r.cohesion).toBe(15);
    expect(r.frictionAngle).toBe(28);
  });

  it("returns exact values when query coincides with one of several data points", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [
        [0, 0, 10, 20, 18],
        [10, 0, 30, 40, 22],
      ],
    };
    const r = resolveStrength(smc, ctx({ x: 0, yBottom: 0 }));
    expect(r.cohesion).toBe(10);
    expect(r.frictionAngle).toBe(20);
  });

  it("IDW interpolation — equidistant from two points gives average", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [
        [0, 0, 10, 20, 18],
        [10, 0, 30, 40, 22],
      ],
    };
    // Midpoint (5, 0) is equidistant → equal weights → average
    const r = resolveStrength(smc, ctx({ x: 5, yBottom: 0 }));
    expect(r.cohesion).toBeCloseTo(20); // avg(10, 30)
    expect(r.frictionAngle).toBeCloseTo(30); // avg(20, 40)
  });

  it("IDW interpolation — closer point has higher weight", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [
        [0, 0, 10, 20, 18],
        [10, 0, 30, 40, 22],
      ],
    };
    // Query at (2, 0): dist to P1 = 2, dist to P2 = 8
    // w1 = 1/4 = 0.25, w2 = 1/64 = 0.015625
    // c = (0.25*10 + 0.015625*30) / (0.25 + 0.015625)
    const r = resolveStrength(smc, ctx({ x: 2, yBottom: 0 }));
    expect(r.cohesion).toBeGreaterThan(10);
    expect(r.cohesion).toBeLessThan(20);
    // Should be closer to 10 since closer to first point
    expect(r.cohesion).toBeLessThan(15);
  });

  it("IDW interpolation with three points", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [
        [0, 0, 10, 20, 18],
        [10, 0, 30, 40, 22],
        [5, 10, 50, 60, 20],
      ],
    };
    const r = resolveStrength(smc, ctx({ x: 5, yBottom: 0 }));
    // (5,0) is equidistant from (0,0) and (10,0), dist=5
    // (5,0) is 10 away from (5,10)
    // w1 = 1/25, w2 = 1/25, w3 = 1/100
    // c = (0.04*10 + 0.04*30 + 0.01*50) / (0.04+0.04+0.01) = (0.4+1.2+0.5)/0.09
    expect(r.cohesion).toBeGreaterThan(10);
    expect(r.cohesion).toBeLessThan(50);
  });

  it("uses nearest interpolation when specified", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [
        [0, 0, 10, 20, 18],
        [10, 0, 30, 40, 22],
      ],
      interpolation: "nearest",
    };
    // Query at (3, 0): closest to (0, 0)
    const r = resolveStrength(smc, ctx({ x: 3, yBottom: 0 }));
    expect(r.cohesion).toBe(10);
    expect(r.frictionAngle).toBe(20);
  });

  it("uses nearest interpolation — picks other point when closer", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [
        [0, 0, 10, 20, 18],
        [10, 0, 30, 40, 22],
      ],
      interpolation: "nearest",
    };
    // Query at (7, 0): closest to (10, 0)
    const r = resolveStrength(smc, ctx({ x: 7, yBottom: 0 }));
    expect(r.cohesion).toBe(30);
    expect(r.frictionAngle).toBe(40);
  });

  it("linear interpolation uses power=1", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [
        [0, 0, 10, 20, 18],
        [10, 0, 30, 40, 22],
      ],
      interpolation: "linear",
    };
    // Query at (2, 0): dist to P1=2, dist to P2=8
    // w1 = 1/2 = 0.5, w2 = 1/8 = 0.125
    // c = (0.5*10 + 0.125*30) / (0.5 + 0.125) = (5+3.75)/0.625 = 14
    const r = resolveStrength(smc, ctx({ x: 2, yBottom: 0 }));
    expect(r.cohesion).toBeCloseTo(14);
  });

  it("sets cohesionUndrained = cohesion", () => {
    const smc: SpatialMohrCoulombModel = {
      kind: "spatial-mohr-coulomb",
      unitWeight: 20,
      dataPoints: [[0, 0, 15, 28, 20]],
    };
    const r = resolveStrength(smc, ctx({ x: 0, yBottom: 0 }));
    expect(r.cohesionUndrained).toBe(r.cohesion);
  });
});

// ── interpolateFunction ────────────────────────────────────────

describe("interpolateFunction", () => {
  it("returns 0 for empty array", () => {
    expect(interpolateFunction([], 5)).toBe(0);
  });

  it("returns single point for length-1 array", () => {
    expect(interpolateFunction([[3, 42]], 999)).toBe(42);
  });

  it("clamps below range", () => {
    expect(
      interpolateFunction(
        [
          [0, 10],
          [10, 20],
        ],
        -5,
      ),
    ).toBe(10);
  });

  it("clamps above range", () => {
    expect(
      interpolateFunction(
        [
          [0, 10],
          [10, 20],
        ],
        15,
      ),
    ).toBe(20);
  });

  it("interpolates linearly", () => {
    expect(
      interpolateFunction(
        [
          [0, 10],
          [10, 20],
        ],
        5,
      ),
    ).toBeCloseTo(15);
  });

  it("handles unsorted input", () => {
    expect(
      interpolateFunction(
        [
          [10, 20],
          [0, 10],
        ],
        5,
      ),
    ).toBeCloseTo(15);
  });
});

// ── Material.model field ───────────────────────────────────────

describe("Material.model", () => {
  it("synthesises MohrCoulombModel from legacy params", () => {
    const m = new Material({
      cohesion: 10,
      frictionAngle: 30,
      unitWeight: 19,
      name: "Test",
    });
    expect(m.model.kind).toBe("mohr-coulomb");
    if (m.model.kind === "mohr-coulomb") {
      expect(m.model.cohesion).toBe(10);
      expect(m.model.frictionAngle).toBe(30);
      expect(m.model.unitWeight).toBe(19);
    }
  });

  it("accepts an explicit model in params", () => {
    const model: UndrainedModel = {
      kind: "undrained",
      unitWeight: 18,
      undrainedShearStrength: 50,
    };
    const m = new Material({ model });
    expect(m.model.kind).toBe("undrained");
    expect(m.model).toBe(model);
  });

  it("getCohesion delegates to resolveStrength", () => {
    const m = new Material({
      cohesion: 10,
      frictionAngle: 30,
      cohesionRefDepth: 5,
      cohesionRateOfChange: 2,
    });
    // At depth 3: c = 10 + (5-3)*2 = 14
    expect(m.getCohesion(3)).toBe(14);
    // At depth 5 (ref): c = 10
    expect(m.getCohesion(5)).toBe(10);
  });

  it("getStrength returns full ResolvedStrength", () => {
    const m = new Material({ cohesion: 10, frictionAngle: 30 });
    const r = m.getStrength({ yBottom: 0, x: 0, yGround: 10, alpha: 0 });
    expect(r.cohesion).toBe(10);
    expect(r.frictionAngle).toBe(30);
  });
});

// ── interpolateIDW ─────────────────────────────────────────────

describe("interpolateIDW", () => {
  const pts: SpatialDataPoint[] = [
    { x: 0, y: 0, values: [10, 20] },
    { x: 10, y: 0, values: [30, 40] },
  ];

  it("returns empty array for empty input", () => {
    expect(interpolateIDW([], 5, 5)).toEqual([]);
  });

  it("returns exact values for single point", () => {
    const single: SpatialDataPoint[] = [{ x: 3, y: 4, values: [42, 99] }];
    expect(interpolateIDW(single, 0, 0)).toEqual([42, 99]);
  });

  it("returns exact values when query coincides with a point", () => {
    expect(interpolateIDW(pts, 0, 0)).toEqual([10, 20]);
  });

  it("returns average for equidistant query", () => {
    const result = interpolateIDW(pts, 5, 0);
    expect(result[0]).toBeCloseTo(20); // avg(10, 30)
    expect(result[1]).toBeCloseTo(30); // avg(20, 40)
  });

  it("weights closer points more heavily (default p=2)", () => {
    // Query at (1, 0): dist to P1=1, dist to P2=9
    // w1 = 1, w2 = 1/81
    const result = interpolateIDW(pts, 1, 0);
    expect(result[0]).toBeGreaterThan(10);
    expect(result[0]).toBeLessThan(15); // much closer to 10
  });

  it("uses custom power parameter", () => {
    // p=1: w1 = 1/1 = 1, w2 = 1/9
    const resultP1 = interpolateIDW(pts, 1, 0, 1);
    // p=4: w1 = 1/1 = 1, w2 = 1/6561
    const resultP4 = interpolateIDW(pts, 1, 0, 4);
    // Higher power → closer to nearest point value (10)
    expect(resultP4[0]).toBeLessThan(resultP1[0]);
  });

  it("handles 2D distances correctly", () => {
    const pts2d: SpatialDataPoint[] = [
      { x: 0, y: 0, values: [100] },
      { x: 10, y: 10, values: [200] },
    ];
    // Query at (5, 5): equidistant → average
    const result = interpolateIDW(pts2d, 5, 5);
    expect(result[0]).toBeCloseTo(150);
  });
});

// ── interpolateNearest ─────────────────────────────────────────

describe("interpolateNearest", () => {
  const pts: SpatialDataPoint[] = [
    { x: 0, y: 0, values: [10, 20] },
    { x: 10, y: 0, values: [30, 40] },
    { x: 5, y: 8, values: [50, 60] },
  ];

  it("returns empty array for empty input", () => {
    expect(interpolateNearest([], 5, 5)).toEqual([]);
  });

  it("picks the closest point", () => {
    // (1, 0) is closest to (0, 0)
    expect(interpolateNearest(pts, 1, 0)).toEqual([10, 20]);
  });

  it("picks the other closest point", () => {
    // (9, 0) is closest to (10, 0)
    expect(interpolateNearest(pts, 9, 0)).toEqual([30, 40]);
  });

  it("picks point considering 2D distance", () => {
    // (5, 7) is closest to (5, 8), dist=1
    expect(interpolateNearest(pts, 5, 7)).toEqual([50, 60]);
  });

  it("returns a copy, not the original array", () => {
    const result = interpolateNearest(pts, 0, 0);
    result[0] = 999;
    expect(pts[0].values[0]).toBe(10); // original unchanged
  });
});
