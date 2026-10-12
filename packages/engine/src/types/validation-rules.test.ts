/**
 * Every material validation rule: rejects what it should (with its own
 * message) and accepts the boundary values.
 */
import { describe, it, expect } from "vitest";
import { validateMaterialModel } from "./validation";
import type { MaterialModel } from "./material-models";

const mc = (o: Record<string, unknown> = {}): MaterialModel =>
  ({ kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30, ...o }) as MaterialModel;
const su = (o: Record<string, unknown> = {}): MaterialModel =>
  ({ kind: "undrained", unitWeight: 18, undrainedShearStrength: 30, ...o }) as MaterialModel;
const sfd = (o: Record<string, unknown> = {}): MaterialModel =>
  ({ kind: "s-f-depth", unitWeight: 18, suRef: 20, depthRef: 0, rate: 2, ...o }) as MaterialModel;
const sfy = (o: Record<string, unknown> = {}): MaterialModel =>
  ({ kind: "s-f-datum", unitWeight: 18, suRef: 20, yRef: 0, rate: 2, ...o }) as MaterialModel;
const lcc = (o: Record<string, unknown> = {}): MaterialModel =>
  ({ kind: "lime-cement-columns", unitWeight: 18, soilSu: 15, columnSu: 100, areaRatio: 0.2, ...o }) as MaterialModel;
const aniso = (o: Record<string, unknown> = {}): MaterialModel =>
  ({
    kind: "anisotropic-function",
    unitWeight: 18,
    cohesion: 5,
    frictionAngle: 30,
    modifierFunction: [
      [-90, 1],
      [90, 1],
    ],
    ...o,
  }) as MaterialModel;
const spatial = (dataPoints: unknown): MaterialModel =>
  ({ kind: "spatial-mohr-coulomb", unitWeight: 18, dataPoints }) as MaterialModel;

/** [label, model, expected message fragment] */
const rejected: [string, MaterialModel, RegExp][] = [
  ["γ = 0", mc({ unitWeight: 0 }), /Unit weight.*positive/],
  ["γ < 0", mc({ unitWeight: -1 }), /Unit weight.*positive/],
  ["γ NaN", mc({ unitWeight: NaN }), /Unit weight.*positive/],
  ["γ > 500", mc({ unitWeight: 500.1 }), /at most 500/],
  ["γsat = 0", mc({ unitWeightSat: 0 }), /Saturated/],
  ["γsat > 500", mc({ unitWeightSat: 501 }), /Saturated/],
  ["γsat Infinity", mc({ unitWeightSat: Infinity }), /Saturated/],
  ["cohesionRefDepth NaN", mc({ cohesionRefDepth: NaN }), /cohesionRefDepth must be a finite/],
  ["cohesionRateOfChange string", mc({ cohesionRateOfChange: "1" }), /cohesionRateOfChange must be a finite/],
  ["cohesionUndrained Infinity", mc({ cohesionUndrained: Infinity }), /cohesionUndrained must be a finite/],
  ["cFactor NaN", mc({ cFactor: NaN }), /cFactor must be a finite/],
  ["suRefDepth NaN", su({ suRefDepth: NaN }), /suRefDepth must be a finite/],
  ["suRateOfChange NaN", su({ suRateOfChange: NaN }), /suRateOfChange must be a finite/],
  ["c < 0", mc({ cohesion: -0.1 }), /Cohesion \(c\) must be ≥ 0/],
  ["c NaN", mc({ cohesion: NaN }), /Cohesion \(c\) must be ≥ 0/],
  ["φ < 0", mc({ frictionAngle: -1 }), /Friction angle \(φ\) must be ≥ 0/],
  ["φ = 90", mc({ frictionAngle: 90 }), /less than 90/],
  ["cFactor < 0", mc({ cFactor: -1 }), /cFactor must be ≥ 0/],
  ["c = φ = 0", mc({ cohesion: 0, frictionAngle: 0 }), /no strength/],
  ["c = φ = 0, rate 0", mc({ cohesion: 0, frictionAngle: 0, cohesionRateOfChange: 0 }), /no strength/],
  ["combined Su < 0", mc({ cohesionUndrained: -1, cFactor: 1 }), /Su\) must be ≥ 0 for combined/],
  ["Su < 0", su({ undrainedShearStrength: -1 }), /Undrained shear strength/],
  ["Su NaN", su({ undrainedShearStrength: NaN }), /Undrained shear strength/],
  ["suMax 0", su({ suMax: 0 }), /suMax\) must be a positive/],
  ["suMax NaN", su({ suMax: NaN }), /suMax\) must be a positive/],
  ["spatial: no points", spatial([]), /at least 1 data point/],
  ["spatial: not an array", spatial(null), /at least 1 data point/],
  ["spatial: 4 values", spatial([[0, 0, 1, 30]]), /must have 5 values/],
  ["spatial: NaN", spatial([[0, NaN, 1, 30, 18]]), /finite numbers/],
  ["spatial: c < 0", spatial([[0, 0, -1, 30, 18]]), /cohesion \(c\) must be ≥ 0/],
  ["spatial: φ < 0", spatial([[0, 0, 1, -30, 18]]), /friction angle \(φ\) must be ≥ 0/],
  ["spatial: γ = 0", spatial([[0, 0, 1, 30, 0]]), /unit weight \(γ\) must be > 0/],
  ["aniso: c < 0", aniso({ cohesion: -1 }), /Base cohesion/],
  ["aniso: φ NaN", aniso({ frictionAngle: NaN }), /Base friction angle \(φ\) must be ≥ 0/],
  ["aniso: φ = 90", aniso({ frictionAngle: 90 }), /Base friction angle.*less than 90/],
  ["aniso: 1 point", aniso({ modifierFunction: [[0, 1]] }), /at least 2 data points/],
  ["aniso: not an array", aniso({ modifierFunction: undefined }), /at least 2 data points/],
  ["aniso: 3 values", aniso({ modifierFunction: [[0, 1, 2], [10, 1]] }), /must have 2 values/],
  ["aniso: NaN", aniso({ modifierFunction: [[0, NaN], [10, 1]] }), /finite numbers/],
  ["aniso: factor < 0", aniso({ modifierFunction: [[0, -0.5], [10, 1]] }), /factor must be ≥ 0/],
  ["s-f-depth: suRef < 0", sfd({ suRef: -1 }), /Reference Su/],
  ["s-f-depth: depthRef NaN", sfd({ depthRef: NaN }), /Reference depth/],
  ["s-f-depth: rate Infinity", sfd({ rate: Infinity }), /Rate of change/],
  ["s-f-depth: bad reference", sfd({ depthReference: "surface" }), /Depth reference/],
  ["s-f-depth: suMax < 0", sfd({ suMax: -5 }), /suMax\) must be a positive/],
  ["s-f-datum: suRef NaN", sfy({ suRef: NaN }), /Reference Su/],
  ["s-f-datum: yRef NaN", sfy({ yRef: NaN }), /Reference elevation/],
  ["s-f-datum: rate NaN", sfy({ rate: NaN }), /Rate of change/],
  ["lcc: soil Su < 0", lcc({ soilSu: -1 }), /Soil Su/],
  ["lcc: column Su NaN", lcc({ columnSu: NaN }), /Column Su/],
  ["lcc: area ratio > 1", lcc({ areaRatio: 1.01 }), /Area ratio/],
  ["lcc: area ratio < 0", lcc({ areaRatio: -0.01 }), /Area ratio/],
  ["lcc: suRefDepth Infinity", lcc({ suRefDepth: Infinity }), /Reference level/],
  ["lcc: suRateOfChange Infinity", lcc({ suRateOfChange: Infinity }), /Rate of change/],
  ["lcc: c′ without φ′", lcc({ columnCohesion: 10 }), /both the drained column/],
  ["lcc: φ′ without c′", lcc({ columnFrictionAngle: 30 }), /both the drained column/],
  ["lcc: c′ < 0", lcc({ columnCohesion: -1, columnFrictionAngle: 30 }), /Drained column cohesion/],
  ["lcc: φ′ = 90", lcc({ columnCohesion: 10, columnFrictionAngle: 90 }), /friction angle must be 0–90/],
  ["lcc: φ′ < 0", lcc({ columnCohesion: 10, columnFrictionAngle: -1 }), /friction angle must be 0–90/],
  ["unknown kind", { kind: "granite", unitWeight: 18 } as unknown as MaterialModel, /Unknown material model kind "granite"/],
];

/** Boundary values that are valid. */
const accepted: [string, MaterialModel][] = [
  ["suMax ≥ Su with negative rate (a floor above the reference is valid)", su({ suMax: 30, suRateOfChange: -1 })],
  ["s-f-depth: suMax above suRef, rate < 0 (a floor above the reference is valid)", sfd({ rate: -1, suMax: 25 })],
  ["s-f-datum: suMax = suRef, rate < 0 (a floor above the reference is valid)", sfy({ rate: -1, suMax: 20 })],
  ["lcc: suMax ≥ soil Su, rate < 0 (a floor above the reference is valid)", lcc({ suRateOfChange: -1, suMax: 15 })],
  ["γ = 500", mc({ unitWeight: 500 })],
  ["γ tiny", mc({ unitWeight: 1e-6 })],
  ["γsat = 500", mc({ unitWeightSat: 500 })],
  ["c = 0", mc({ cohesion: 0 })],
  ["φ = 0", mc({ frictionAngle: 0 })],
  ["φ = 89.99", mc({ frictionAngle: 89.99 })],
  ["cFactor = 0", mc({ cFactor: 0 })],
  ["c = φ = 0 with c rising with depth", mc({ cohesion: 0, frictionAngle: 0, cohesionRateOfChange: 1 })],
  ["combined Su = 0", mc({ cohesionUndrained: 0, cFactor: 1 })],
  ["Su given without cFactor (not combined)", mc({ cohesionUndrained: 10 })],
  ["Su = 0", su({ undrainedShearStrength: 0 })],
  ["suMax tiny", su({ suMax: 1e-9 })],
  ["suMax just below Su with negative rate", su({ suMax: 29.99, suRateOfChange: -1 })],
  ["suMax above Su with positive rate", su({ suMax: 100, suRateOfChange: 1 })],
  ["suMax above Su without rate", su({ suMax: 100 })],
  ["high strength", { kind: "high-strength", unitWeight: 18 }],
  ["impenetrable", { kind: "impenetrable", unitWeight: 18 }],
  ["spatial: zero c and φ", spatial([[0, 0, 0, 0, 18]])],
  ["aniso: factor 0", aniso({ modifierFunction: [[0, 0], [10, 1]] })],
  ["aniso: φ = 0, c = 0", aniso({ cohesion: 0, frictionAngle: 0 })],
  ["s-f-depth: negative rate below suRef", sfd({ rate: -1, suMax: 19 })],
  ["s-f-depth: layer-top", sfd({ depthReference: "layer-top" })],
  ["s-f-depth: ground", sfd({ depthReference: "ground" })],
  ["s-f-depth: suRef = 0", sfd({ suRef: 0 })],
  ["s-f-datum: negative yRef and rate", sfy({ yRef: -50, rate: -0.5 })],
  ["lcc: area ratio 0", lcc({ areaRatio: 0 })],
  ["lcc: area ratio 1", lcc({ areaRatio: 1 })],
  ["lcc: drained columns at the bounds", lcc({ columnCohesion: 0, columnFrictionAngle: 0 })],
  ["lcc: drained columns φ′ 89.9", lcc({ columnCohesion: 5, columnFrictionAngle: 89.9 })],
  ["lcc: suMax with negative rate below soil Su", lcc({ suRateOfChange: -1, suMax: 14 })],
];

describe("validateMaterialModel rules", () => {
  it.each(rejected)("rejects %s", (_label, model, message) => {
    const errors = validateMaterialModel(model);
    expect(errors.some((e) => message.test(e)), errors.join(" | ")).toBe(true);
  });

  it.each(accepted)("accepts %s", (_label, model) => {
    expect(validateMaterialModel(model)).toEqual([]);
  });

  it("reports every error of a model, not only the first", () => {
    const errors = validateMaterialModel(mc({ unitWeight: -1, cohesion: -1, frictionAngle: 95, cFactor: -2 }));
    expect(errors).toHaveLength(4);
  });

  it("a cutoff that is not a positive number is not also checked against the reference", () => {
    const errors = validateMaterialModel(su({ suMax: -40, suRateOfChange: -1 }));
    expect(errors).toEqual(["Strength cutoff (suMax) must be a positive number."]);
  });

  it("a malformed spatial data point skips the value checks of that point", () => {
    const errors = validateMaterialModel(spatial([[0, 0, -1], [0, 0, 1, 30, 18]]));
    expect(errors).toEqual(["Data point 1: must have 5 values [x, y, c, φ, γ]."]);
  });
});
