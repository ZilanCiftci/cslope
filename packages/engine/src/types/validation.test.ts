import { describe, expect, it } from "vitest";
import { validateMaterialModel } from "./validation";
import type {
  MohrCoulombModel,
  UndrainedModel,
  HighStrengthModel,
  ImpenetrableModel,
  SpatialMohrCoulombModel,
  AnisotropicFunctionModel,
  StrengthFromDepthModel,
  StrengthFromDatumModel,
} from "./material-models";

// ── Helpers ────────────────────────────────────────────────────

const validMC: MohrCoulombModel = {
  kind: "mohr-coulomb",
  unitWeight: 18,
  cohesion: 10,
  frictionAngle: 30,
};

const validUndrained: UndrainedModel = {
  kind: "undrained",
  unitWeight: 18,
  undrainedShearStrength: 25,
};

const validHS: HighStrengthModel = { kind: "high-strength", unitWeight: 24 };
const validImp: ImpenetrableModel = { kind: "impenetrable", unitWeight: 26 };

const validSpatialMC: SpatialMohrCoulombModel = {
  kind: "spatial-mohr-coulomb",
  unitWeight: 18,
  dataPoints: [
    [0, 0, 10, 30, 18],
    [5, 0, 12, 28, 19],
    [10, 0, 8, 32, 17],
  ],
};

const validAniso: AnisotropicFunctionModel = {
  kind: "anisotropic-function",
  unitWeight: 18,
  cohesion: 10,
  frictionAngle: 30,
  modifierFunction: [
    [0, 1.0],
    [90, 0.5],
  ],
};

const validSfDepth: StrengthFromDepthModel = {
  kind: "s-f-depth",
  unitWeight: 18,
  suRef: 20,
  depthRef: 0,
  rate: 2,
};

const validSfDatum: StrengthFromDatumModel = {
  kind: "s-f-datum",
  unitWeight: 18,
  suRef: 30,
  yRef: 0,
  rate: 2,
};

// ── Common validation ──────────────────────────────────────────

describe("validateMaterialModel — common", () => {
  it("rejects unitWeight = 0", () => {
    const errs = validateMaterialModel({ ...validMC, unitWeight: 0 });
    expect(errs).toContainEqual(expect.stringContaining("Unit weight"));
  });

  it("rejects negative unitWeight", () => {
    const errs = validateMaterialModel({ ...validMC, unitWeight: -5 });
    expect(errs).toContainEqual(expect.stringContaining("Unit weight"));
  });

  it("rejects NaN unitWeight", () => {
    const errs = validateMaterialModel({ ...validMC, unitWeight: NaN });
    expect(errs).toContainEqual(expect.stringContaining("Unit weight"));
  });

  it("rejects Infinity unitWeight", () => {
    const errs = validateMaterialModel({ ...validMC, unitWeight: Infinity });
    expect(errs).toContainEqual(expect.stringContaining("Unit weight"));
  });
});

// ── Mohr-Coulomb ───────────────────────────────────────────────

describe("validateMaterialModel — mohr-coulomb", () => {
  it("valid model returns no errors", () => {
    expect(validateMaterialModel(validMC)).toEqual([]);
  });

  it("rejects negative cohesion", () => {
    const errs = validateMaterialModel({ ...validMC, cohesion: -1 });
    expect(errs).toContainEqual(expect.stringContaining("Cohesion"));
  });

  it("rejects negative friction angle", () => {
    const errs = validateMaterialModel({ ...validMC, frictionAngle: -1 });
    expect(errs).toContainEqual(expect.stringContaining("Friction angle"));
  });

  it("warns when both c and φ are zero", () => {
    const errs = validateMaterialModel({
      ...validMC,
      cohesion: 0,
      frictionAngle: 0,
    });
    expect(errs).toContainEqual(expect.stringContaining("no strength"));
  });

  it("allows c=0 as long as φ > 0", () => {
    expect(
      validateMaterialModel({ ...validMC, cohesion: 0, frictionAngle: 30 }),
    ).toEqual([]);
  });

  it("allows φ=0 as long as c > 0", () => {
    expect(
      validateMaterialModel({ ...validMC, cohesion: 10, frictionAngle: 0 }),
    ).toEqual([]);
  });
});

// ── Undrained ──────────────────────────────────────────────────

describe("validateMaterialModel — undrained", () => {
  it("valid model returns no errors", () => {
    expect(validateMaterialModel(validUndrained)).toEqual([]);
  });

  it("rejects negative Su", () => {
    const errs = validateMaterialModel({
      ...validUndrained,
      undrainedShearStrength: -1,
    });
    expect(errs).toContainEqual(expect.stringContaining("Undrained"));
  });

  it("allows Su = 0", () => {
    expect(
      validateMaterialModel({
        ...validUndrained,
        undrainedShearStrength: 0,
      }),
    ).toEqual([]);
  });
});

// ── High Strength ──────────────────────────────────────────────

describe("validateMaterialModel — high-strength", () => {
  it("valid model returns no errors", () => {
    expect(validateMaterialModel(validHS)).toEqual([]);
  });
});

// ── Impenetrable ───────────────────────────────────────────────

describe("validateMaterialModel — impenetrable", () => {
  it("valid model returns no errors", () => {
    expect(validateMaterialModel(validImp)).toEqual([]);
  });
});

// ── Spatial Mohr-Coulomb ───────────────────────────────────────

describe("validateMaterialModel — spatial-mohr-coulomb", () => {
  it("valid model returns no errors", () => {
    expect(validateMaterialModel(validSpatialMC)).toEqual([]);
  });

  it("rejects empty data points array", () => {
    const errs = validateMaterialModel({
      ...validSpatialMC,
      dataPoints: [],
    });
    expect(errs).toContainEqual(expect.stringContaining("at least 1"));
  });

  it("rejects data point with wrong number of values", () => {
    const errs = validateMaterialModel({
      ...validSpatialMC,
      dataPoints: [
        [0, 0, 10] as unknown as [number, number, number, number, number],
      ],
    });
    expect(errs).toContainEqual(expect.stringContaining("5 values"));
  });

  it("rejects NaN in data point", () => {
    const errs = validateMaterialModel({
      ...validSpatialMC,
      dataPoints: [[0, 0, NaN, 30, 18]],
    });
    expect(errs).toContainEqual(expect.stringContaining("finite numbers"));
  });

  it("rejects negative cohesion in data point", () => {
    const errs = validateMaterialModel({
      ...validSpatialMC,
      dataPoints: [[0, 0, -5, 30, 18]],
    });
    expect(errs).toContainEqual(expect.stringContaining("cohesion"));
  });

  it("rejects negative friction angle in data point", () => {
    const errs = validateMaterialModel({
      ...validSpatialMC,
      dataPoints: [[0, 0, 10, -5, 18]],
    });
    expect(errs).toContainEqual(expect.stringContaining("friction angle"));
  });

  it("rejects zero unit weight in data point", () => {
    const errs = validateMaterialModel({
      ...validSpatialMC,
      dataPoints: [[0, 0, 10, 30, 0]],
    });
    expect(errs).toContainEqual(expect.stringContaining("unit weight"));
  });

  it("allows a single data point", () => {
    expect(
      validateMaterialModel({
        ...validSpatialMC,
        dataPoints: [[0, 0, 10, 30, 18]],
      }),
    ).toEqual([]);
  });
});

// ── Anisotropic Function ───────────────────────────────────────

describe("validateMaterialModel — anisotropic-function", () => {
  it("valid model returns no errors", () => {
    expect(validateMaterialModel(validAniso)).toEqual([]);
  });

  it("rejects negative base cohesion", () => {
    const errs = validateMaterialModel({ ...validAniso, cohesion: -1 });
    expect(errs).toContainEqual(expect.stringContaining("cohesion"));
  });

  it("rejects negative base friction angle", () => {
    const errs = validateMaterialModel({ ...validAniso, frictionAngle: -1 });
    expect(errs).toContainEqual(expect.stringContaining("friction angle"));
  });

  it("rejects fewer than 2 modifier points", () => {
    const errs = validateMaterialModel({
      ...validAniso,
      modifierFunction: [[0, 1.0]],
    });
    expect(errs).toContainEqual(expect.stringContaining("at least 2"));
  });

  it("rejects empty modifier function", () => {
    const errs = validateMaterialModel({
      ...validAniso,
      modifierFunction: [],
    });
    expect(errs).toContainEqual(expect.stringContaining("at least 2"));
  });

  it("rejects negative modifier factor", () => {
    const errs = validateMaterialModel({
      ...validAniso,
      modifierFunction: [
        [0, 1.0],
        [90, -0.5],
      ],
    });
    expect(errs).toContainEqual(expect.stringContaining("factor"));
  });

  it("rejects NaN in modifier point", () => {
    const errs = validateMaterialModel({
      ...validAniso,
      modifierFunction: [
        [0, NaN],
        [90, 0.5],
      ],
    });
    expect(errs).toContainEqual(expect.stringContaining("finite numbers"));
  });
});

// ── S = f(depth) ───────────────────────────────────────────────

describe("validateMaterialModel — s-f-depth", () => {
  it("valid model returns no errors", () => {
    expect(validateMaterialModel(validSfDepth)).toEqual([]);
  });

  it("rejects negative suRef", () => {
    const errs = validateMaterialModel({ ...validSfDepth, suRef: -1 });
    expect(errs).toContainEqual(expect.stringContaining("suRef"));
  });

  it("rejects NaN suRef", () => {
    const errs = validateMaterialModel({ ...validSfDepth, suRef: NaN });
    expect(errs).toContainEqual(expect.stringContaining("suRef"));
  });

  it("rejects NaN depthRef", () => {
    const errs = validateMaterialModel({ ...validSfDepth, depthRef: NaN });
    expect(errs).toContainEqual(expect.stringContaining("depthRef"));
  });

  it("rejects NaN rate", () => {
    const errs = validateMaterialModel({ ...validSfDepth, rate: NaN });
    expect(errs).toContainEqual(expect.stringContaining("Rate"));
  });

  it("allows suRef = 0", () => {
    expect(validateMaterialModel({ ...validSfDepth, suRef: 0 })).toEqual([]);
  });

  it("allows negative rate", () => {
    expect(validateMaterialModel({ ...validSfDepth, rate: -1 })).toEqual([]);
  });
});

// ── S = f(datum) ───────────────────────────────────────────────

describe("validateMaterialModel — s-f-datum", () => {
  it("valid model returns no errors", () => {
    expect(validateMaterialModel(validSfDatum)).toEqual([]);
  });

  it("rejects negative suRef", () => {
    const errs = validateMaterialModel({ ...validSfDatum, suRef: -1 });
    expect(errs).toContainEqual(expect.stringContaining("suRef"));
  });

  it("rejects NaN yRef", () => {
    const errs = validateMaterialModel({ ...validSfDatum, yRef: NaN });
    expect(errs).toContainEqual(expect.stringContaining("yRef"));
  });

  it("rejects NaN rate", () => {
    const errs = validateMaterialModel({ ...validSfDatum, rate: NaN });
    expect(errs).toContainEqual(expect.stringContaining("Rate"));
  });

  it("allows negative yRef (below sea level)", () => {
    expect(validateMaterialModel({ ...validSfDatum, yRef: -10 })).toEqual([]);
  });
});

// ── Multiple errors ────────────────────────────────────────────

describe("validateMaterialModel — multiple errors", () => {
  it("returns multiple errors for a model with several issues", () => {
    const errs = validateMaterialModel({
      kind: "mohr-coulomb",
      unitWeight: -1,
      cohesion: -5,
      frictionAngle: -10,
    });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});
