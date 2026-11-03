import { describe, expect, it } from "vitest";
import { PROJECT_FILE_VERSION, parseProjectFile } from "./persistence";
import { DEFAULT_ANALYSIS_LIMITS } from "./defaults";

const MODEL = {
  id: "m1",
  name: "Slope",
  coordinates: [
    [0, 0],
    [0, 10],
    [20, 10],
    [30, 0],
  ],
  materials: [
    {
      id: "mat-a",
      name: "Clay",
      color: "#abc",
      model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 25 },
    },
  ],
};

const parse = (models: unknown[], extra: Record<string, unknown> = {}) =>
  parseProjectFile(
    JSON.stringify({ version: PROJECT_FILE_VERSION, models, ...extra }),
  );
const parseOne = (patch: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  parse([{ ...MODEL, ...patch }], extra).models[0];

describe("parseProjectFile: rejected files", () => {
  it.each([
    ["not json", "File is not valid JSON."],
    ["null", "File is missing project data."],
    ["42", "File is missing project data."],
    ['{"models": []}', "File must include at least one model."],
    ['{"models": {}}', "File must include at least one model."],
    ['{"models": [null]}', "Model entry is invalid."],
    ['{"models": [{"coordinates": []}]}', "Model entry is missing an id."],
  ])("%s → %s", (text, message) => {
    expect(() => parseProjectFile(text)).toThrow(message);
  });

  it("requires three coordinates and a material", () => {
    expect(() => parseOne({ coordinates: [[0, 0], [1, 1]] })).toThrow(
      "Model m1 must include coordinates.",
    );
    expect(() => parseOne({ materials: [] })).toThrow(
      "Model m1 must include at least one material.",
    );
  });

  it("names the bad coordinate", () => {
    expect(() =>
      parseOne({ coordinates: [[0, 0], [1], [2, 2]] }),
    ).toThrow("Coordinate #2 is invalid.");
    expect(() =>
      parseOne({ coordinates: [[0, 0], [1, 1], ["2", 2]] }),
    ).toThrow("Coordinate #3 must be numbers.");
  });
});

describe("parseProjectFile: models", () => {
  it("falls back to the first model when the active id is unknown or missing", () => {
    const two = [MODEL, { ...MODEL, id: "m2" }];
    expect(parse(two, { activeModelId: "m2" }).activeModelId).toBe("m2");
    expect(parse(two, { activeModelId: "nope" }).activeModelId).toBe("m1");
    expect(parse(two, { activeModelId: 5 }).activeModelId).toBe("m1");
  });

  it("always reports the current file version", () => {
    expect(parse([MODEL], { version: 1 }).version).toBe(PROJECT_FILE_VERSION);
  });

  it("fills in a name and the default material for broken entries", () => {
    const m = parseOne({ name: 7, materials: [null, { name: "Sand" }] });
    expect(m.name).toBe("Untitled");
    expect(m.materials[0].id).toBe("mat-1");
    expect(m.materials[1]).toMatchObject({
      id: "mat-2",
      name: "Sand",
      model: { kind: "mohr-coulomb", cohesion: 0, frictionAngle: 0 },
    });
    expect(m.materials[1].color).toMatch(/^#/);
  });

  it("synthesises Mohr-Coulomb from legacy flat material fields, clamped", () => {
    const m = parseOne({
      materials: [{ id: "x", unitWeight: -5, cohesion: -1, frictionAngle: 30, depthRange: [0, "a"] }],
    });
    expect(m.materials[0].model).toEqual({
      kind: "mohr-coulomb",
      unitWeight: 0.1,
      frictionAngle: 30,
      cohesion: 0,
    });
    expect(m.materials[0].depthRange).toBeUndefined();
  });

  it("keeps only string material expressions", () => {
    const m = parseOne({
      materials: [{ ...MODEL.materials[0], modelExpressions: { cohesion: "c", phi: 3 } }],
    });
    expect(m.materials[0].modelExpressions).toEqual({ cohesion: "c" });
  });

  it("drops a bad saturated unit weight", () => {
    for (const unitWeightSat of [0, -1, 600, "20"]) {
      const m = parseOne({
        materials: [{ ...MODEL.materials[0], model: { ...MODEL.materials[0].model, unitWeightSat } }],
      });
      expect(m.materials[0].model).not.toHaveProperty("unitWeightSat");
    }
    const ok = parseOne({
      materials: [{ ...MODEL.materials[0], model: { ...MODEL.materials[0].model, unitWeightSat: 21 } }],
    });
    expect(ok.materials[0].model).toHaveProperty("unitWeightSat", 21);
  });

  it("normalises the 3D effects option", () => {
    const opts = (sgi3d: unknown) => parseOne({ options: { sgi3d } }).options?.sgi3d;
    expect(opts({ enabled: true, length: 12, overstrongF2D: 2.3, excludeMaterials: ["Let", 3, "Let"] })).toEqual({
      enabled: true, length: 12, overstrongF2D: 2.3, excludeMaterials: ["Let"],
    });
    expect(opts({ enabled: "yes", length: -1, overstrongF2D: 0 })).toEqual({ enabled: false, length: 15, overstrongF2D: null, excludeMaterials: [] });
    expect(parseOne({}).options?.sgi3d).toBeUndefined();
  });

  it("keeps the basis of Swedish partial factors when complete", () => {
    const opts = (partialFactors: unknown) => parseOne({ options: { partialFactors } }).options?.partialFactors;
    const basis = { safetyClass: 2, etaCu: 1.1, etaDrained: 1, variableLoadBase: 1.4 };
    const f = { cu: 1.364, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.274 };
    expect(opts({ ...f, basis })).toEqual({ ...f, basis });
    expect(opts({ ...f, basis: { ...basis, safetyClass: 4 } })).toEqual(f);
    expect(opts({ ...f, basis: { ...basis, etaCu: 0 } })).toEqual(f);
    // a basis that does not give the saved factors (a hand edit): dropped, the factors stay
    expect(opts({ ...f, basis: { ...basis, safetyClass: 1 } })).toEqual(f);
  });

  it("keeps an undrained anisotropy list for validation, drops an empty or malformed one", () => {
    const clay = (anisotropy: unknown) =>
      parseOne({
        materials: [{ ...MODEL.materials[0], model: { kind: "undrained", unitWeight: 17, undrainedShearStrength: 20, anisotropy } }],
      }).materials[0].model;
    expect(clay([[-45, 0.82], [0, 1], [60, 1.5]])).toHaveProperty("anisotropy", [[-45, 0.82], [0, 1], [60, 1.5]]);
    // an invalid list is kept, so that validation reports it rather than the material turning isotropic
    expect(clay([[0, 1]])).toHaveProperty("anisotropy", [[0, 1]]);
    for (const bad of [[], "x", 3, null]) expect(clay(bad)).not.toHaveProperty("anisotropy");
  });

  it("keeps valid parameters only and leaves missing ones absent", () => {
    expect(parseOne({}).parameters).toBeUndefined();
    const m = parseOne({
      parameters: [
        { id: "p1", name: "H", expression: "10" },
        { id: "p2", name: "W" },
        null,
        "x",
        { id: 3, name: "Z", expression: "1" },
      ],
    });
    expect(m.parameters).toEqual([{ id: "p1", name: "H", expression: "10" }]);
  });

  it("aligns coordinate expressions with the coordinates", () => {
    expect(parseOne({}).coordinateExpressions).toBeUndefined();
    const m = parseOne({
      coordinateExpressions: [{ x: "a", y: 3 }, null, { y: "b" }, {}, { x: "extra" }],
    });
    expect(m.coordinateExpressions).toEqual([{ x: "a" }, {}, { y: "b" }, {}]);
  });

  it("normalises boundaries, giving them ids and aligned expressions", () => {
    const m = parseOne({
      materialBoundaries: [
        { coordinates: [[0, 5], [Number.NaN, 1], [30, 5]], coordinateExpressions: [{ x: "q" }] },
        null,
        "junk",
      ],
    });
    expect(m.materialBoundaries).toHaveLength(1);
    const [b] = m.materialBoundaries;
    expect(typeof b.id).toBe("string");
    expect(b.coordinates).toEqual([[0, 5], [30, 5]]);
    expect(b.coordinateExpressions).toEqual([{ x: "q" }, {}]);
  });

  it("keeps well-formed region assignments only", () => {
    const m = parseOne({
      regionMaterials: [
        { point: [1, 2], materialId: "mat-a", extra: true },
        { point: [1], materialId: "mat-a" },
        { point: [1, 2], materialId: 3 },
        null,
      ],
    });
    expect(m.regionMaterials).toEqual([{ point: [1, 2], materialId: "mat-a" }]);
  });

  it("validates loads and their expressions", () => {
    const m = parseOne({
      udls: [
        { id: "u1", magnitude: 10, x1: 0, x2: 5, expressions: { magnitude: "q", x1: 2, bogus: "z" } },
        { id: "u2", magnitude: "x", x1: 1, x2: 1 },
        { magnitude: 1, x1: 0, x2: 1 },
        null,
        { id: "u3", x1: 0, x2: 2, expressions: { bogus: "z" } },
      ],
      lineLoads: [
        { id: "l1", magnitude: 5, x: 3, expressions: { x: "p" } },
        { magnitude: 5, x: 3 },
        7,
        { id: "l2", magnitude: Number.POSITIVE_INFINITY },
      ],
    });
    expect(m.udls).toEqual([
      { id: "u1", magnitude: 10, x1: 0, x2: 5, expressions: { magnitude: "q" } },
      { id: "u3", magnitude: 0, x1: 0, x2: 2, expressions: undefined },
    ]);
    expect(m.lineLoads).toEqual([
      { id: "l1", magnitude: 5, x: 3, expressions: { x: "p" } },
      // Infinity does not survive JSON; it arrives as null.
      { id: "l2", magnitude: 0, x: 0, expressions: undefined },
    ]);
  });

  it("keeps a line load's finite angle within ±180° and its point y; drops the rest", () => {
    const m = parseOne({
      lineLoads: [
        { id: "l1", magnitude: 5, x: 3, angle: 30, y: 7 },
        { id: "l2", magnitude: 5, x: 3, angle: 0, y: 2 },
        { id: "l3", magnitude: 5, x: 3, angle: 200, y: "high" },
        { id: "l4", magnitude: 5, x: 3, angle: "30", y: null },
        { id: "l5", magnitude: 5, x: 3, angle: -180 },
      ],
    });
    expect(m.lineLoads.map(({ angle, y }) => ({ angle, y }))).toEqual([
      { angle: 30, y: 7 },
      { angle: undefined, y: 2 },
      { angle: undefined, y: undefined },
      { angle: undefined, y: undefined },
      { angle: -180, y: undefined },
    ]);
    expect(m.lineLoads[1]).not.toHaveProperty("angle");
  });

  it("searches the whole slope when a file has no limits; fills bad fields", () => {
    expect(parseOne({}).analysisLimits).toEqual({
      ...DEFAULT_ANALYSIS_LIMITS,
      enabled: false,
    });
    const m = parseOne({ analysisLimits: { enabled: "yes", entryLeftX: 2, exitRightX: "9" } });
    expect(m.analysisLimits).toEqual({
      ...DEFAULT_ANALYSIS_LIMITS,
      enabled: DEFAULT_ANALYSIS_LIMITS.enabled,
      entryLeftX: 2,
    });
  });

  it("keeps circular and polyline custom planes and drops broken ones", () => {
    const m = parseOne({
      customSearchPlanes: [
        { id: "c1", cx: 1, cy: 2, radius: 3 },
        { cx: 1, cy: 2, radius: 0 },
        { cx: "1", cy: 2, radius: 3 },
        { points: [[0, 0], [5, -2], ["x", 1]] },
        null,
      ],
      customPlanesOnly: "true",
    });
    expect(m.customSearchPlanes).toHaveLength(2);
    expect(m.customSearchPlanes[0]).toEqual({ id: "c1", cx: 1, cy: 2, radius: 3 });
    expect(m.customSearchPlanes[1]).toMatchObject({ points: [[0, 0], [5, -2]], radius: 0 });
    expect(typeof m.customSearchPlanes[1].id).toBe("string");
    expect(m.customPlanesOnly).toBe(false);
  });

  it("restores view offsets and scales, including the legacy single view", () => {
    const legacy = parseOne({ viewOffset: [3, 4], viewScale: 2 });
    expect(legacy).toMatchObject({
      editViewOffset: [3, 4],
      resultViewOffset: [3, 4],
      editViewScale: 2,
      resultViewScale: 2,
    });
    const split = parseOne({
      editViewOffset: [1, 1],
      editViewScale: 0,
      resultViewOffset: ["a", 1],
      resultViewScale: -1,
    });
    expect(split.editViewOffset).toEqual([1, 1]);
    expect(split.editViewScale).toBe(0);
    expect(split.resultViewOffset).toBeUndefined();
    expect(split.resultViewScale).toBeUndefined();
  });

  it("a saved running state comes back idle; done and error results are kept", () => {
    expect(parseOne({ runState: "running", progress: 0.4 })).toMatchObject({
      runState: "idle",
      progress: 0,
    });
    const result = { minFOS: 1.3, criticalSurface: null, allSurfaces: [], criticalSlices: [] };
    expect(
      parseOne({ runState: "done", progress: 1, result }),
    ).toMatchObject({ runState: "done", progress: 1, result: { minFOS: 1.3 } });
    // A result the app cannot show is dropped.
    expect(parseOne({ runState: "done", result: { minFOS: 1.3 } })).toMatchObject({ runState: "idle", result: null });
    // a 3D result is kept whole or dropped, the rest of the result stays
    const sgi3d = {
      factorOfSafety: 1.03, f2dCritical: 0.92, equation: "2-3",
      critical: { cx: 4, cy: 2, radius: 6, f2d: 0.93, fp: 1.1, f3d: 1.03, drivingMoment: 900, endFaceArea: 23, endFaceMoment: 1000 },
      options: { length: 15, overstrongF2D: null, excludeMaterials: [] }, warnings: [],
    };
    expect(parseOne({ runState: "done", result: { ...result, sgi3d } }).result?.sgi3d).toEqual(sgi3d);
    for (const bad of [{ ...sgi3d, options: {} }, { ...sgi3d, warnings: [3] }, { ...sgi3d, critical: { ...sgi3d.critical, fp: "x" } }]) {
      const r = parseOne({ runState: "done", result: { ...result, sgi3d: bad } }).result;
      expect(r?.minFOS).toBe(1.3);
      expect(r?.sgi3d).toBeUndefined();
    }
    expect(parseOne({ runState: "error", errorMessage: "x" })).toMatchObject({
      runState: "error",
      progress: 0,
      errorMessage: "x",
    });
    expect(parseOne({ runState: "weird" })).toMatchObject({
      runState: "idle",
      result: null,
      errorMessage: null,
    });
  });

  it("keeps a valid mode only", () => {
    expect(parseOne({ mode: "result" }).mode).toBe("result");
    expect(parseOne({ mode: "other" }).mode).toBeUndefined();
  });
});

describe("parseProjectFile: analysis options", () => {
  it("clamps ranges and rejects unknown enum values", () => {
    const { options } = parseOne({
      options: {
        method: "Spencer",
        slices: 100000,
        iterations: -5,
        refinedIterations: 1e12,
        tolerance: 5,
        maxIterations: 0,
        minFailureDist: -3,
        intersliceFunction: "wavy",
        tensionCrackDepth: -1,
        tensionCrackWater: 3,
        porePressureHead: "sideways",
        janbuCorrection: "no",
      },
    });
    const defaults = parseOne({}).options;
    expect(options.method).toBe(defaults.method);
    expect(options.slices).toBeLessThanOrEqual(1000);
    expect(options.slices).toBeGreaterThan(defaults.slices);
    expect(options.iterations).toBeGreaterThan(0);
    expect(options.refinedIterations).toBeLessThan(1e12);
    expect(options.tolerance).toBe(0.1);
    expect(options.maxIterations).toBe(1);
    expect(options.minFailureDist).toBe(0);
    expect(options.intersliceFunction).toBe(defaults.intersliceFunction);
    expect(options.tensionCrackDepth).toBe(0);
    expect(options.tensionCrackWater).toBe(1);
    expect(options.porePressureHead).toBe(defaults.porePressureHead);
    expect(options.janbuCorrection).toBe(defaults.janbuCorrection);
  });

  it("keeps valid choices, data points and opt-in flags", () => {
    const { options } = parseOne({
      options: {
        method: "Janbu",
        intersliceFunction: "data-point-specified",
        intersliceDataPoints: [[0, 0], ["0.5", 1], [1], "x", [1, "y"], [null, 1], [0.7, ""]],
        bothDirections: true,
        nonCircularOptimization: true,
        tensionCrackAuto: true,
        minSlipDepth: 2,
        minSlipArea: 0,
        porePressureHead: "phreatic-correction",
        partialFactors: { cu: 1.5, cohesion: 0, tanPhi: "2", variableLoad: 1.3 },
      },
    });
    expect(options).toMatchObject({
      method: "Janbu",
      intersliceFunction: "data-point-specified",
      intersliceDataPoints: [[0, 0], [0.5, 1]],
      bothDirections: true,
      nonCircularOptimization: true,
      tensionCrackAuto: true,
      minSlipDepth: 2,
      minSlipArea: 0,
      porePressureHead: "phreatic-correction",
      partialFactors: { cu: 1.5, cohesion: 1, tanPhi: 1, variableLoad: 1.3 },
    });
  });

  it("leaves out invalid opt-in values", () => {
    const { options } = parseOne({
      options: { bothDirections: "yes", minSlipDepth: 0, minSlipArea: -1 },
    });
    const defaults = parseOne({}).options;
    expect(options).not.toHaveProperty("bothDirections");
    expect(options.minSlipDepth).toBe(defaults.minSlipDepth);
    expect(options.minSlipArea).toBe(defaults.minSlipArea);
    expect(options.partialFactors).toBeUndefined();
  });
});

describe("parseProjectFile: migrations", () => {
  it("version 1 files without options get the phreatic correction they were analysed with", () => {
    const m = parse([MODEL], { version: 1 }).models[0];
    expect(m.options.porePressureHead).toBe("phreatic-correction");
    // Unversioned files are version 1 too.
    const unversioned = parseProjectFile(JSON.stringify({ models: [MODEL] }));
    expect(unversioned.models[0].options.porePressureHead).toBe("phreatic-correction");
  });

  it("version 1 keeps an explicit pore pressure choice", () => {
    const m = parse([{ ...MODEL, options: { porePressureHead: "vertical" } }], {
      version: 1,
    }).models[0];
    expect(m.options.porePressureHead).toBe("vertical");
  });

  it("version 1 flips the sign of S = f(datum) rates and their expressions", () => {
    const sfd = {
      id: "s",
      name: "Soft",
      model: { kind: "s-f-datum", unitWeight: 17, cuTop: 10, rate: 2, datum: 0 },
      modelExpressions: { rate: "r+1" },
    };
    const noExpr = { ...sfd, id: "t", modelExpressions: { cuTop: "c" } };
    const exprRate = { ...sfd, id: "u", model: { ...sfd.model, rate: "x" } };
    const m = parse([{ ...MODEL, materials: [sfd, noExpr, exprRate, null, MODEL.materials[0]] }], {
      version: 1,
    }).models[0];
    expect((m.materials[0].model as { rate: number }).rate).toBe(-2);
    expect(m.materials[0].modelExpressions).toEqual({ rate: "-(r+1)" });
    expect(m.materials[1].modelExpressions).toEqual({ cuTop: "c" });
    expect((m.materials[2].model as unknown as { rate: unknown }).rate).toBe("x");
    expect(m.materials[4].model).toEqual(MODEL.materials[0].model);
  });

  it("version 2 files keep water lines clipped to the ground", () => {
    const piezometricLine = { lines: [], activeLineId: null };
    const v2 = parse([{ ...MODEL, piezometricLine }], { version: 2 }).models[0];
    expect(v2.piezometricLine.freeWater).toBe(false);
    const v3 = parse([{ ...MODEL, piezometricLine }]).models[0];
    expect(v3.piezometricLine.freeWater).not.toBe(false);
    // Without a piezometric line nothing is migrated.
    expect(() => parse([MODEL], { version: 2 })).not.toThrow();
  });
});
