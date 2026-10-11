/**
 * Material model validation.
 *
 * Returns an array of human-readable error strings.  An empty array
 * means the model is valid.  This is the single source of truth for
 * model validation — used by both the engine (`buildSlope()`) and the
 * desktop UI (inline error display).
 */

import type { MaterialModel } from "./material-models";

/**
 * Validate a `MaterialModel` and return any errors found.
 *
 * @returns An array of human-readable error messages.  Empty = valid.
 */
export function validateMaterialModel(model: MaterialModel): string[] {
  const errors: string[] = [];

  // ── Common: unitWeight must be positive ──────────────────────
  if (!Number.isFinite(model.unitWeight) || model.unitWeight <= 0) {
    errors.push("Unit weight (γ) must be a positive number.");
  } else if (model.unitWeight > 500) {
    errors.push("Unit weight (γ) must be at most 500 kN/m³.");
  }
  if (
    model.unitWeightSat !== undefined &&
    (!Number.isFinite(model.unitWeightSat) ||
      model.unitWeightSat <= 0 ||
      model.unitWeightSat > 500)
  ) {
    errors.push("Saturated unit weight (γsat) must be a positive number up to 500 kN/m³.");
  }

  // Optional numeric fields must be finite when given: NaN would silently
  // turn into zero strength further on.
  const optional = model as unknown as Record<string, unknown>;
  for (const field of [
    "cohesionRefDepth",
    "cohesionRateOfChange",
    "cohesionUndrained",
    "cFactor",
    "suRefDepth",
    "suRateOfChange",
  ]) {
    const v = optional[field];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
      errors.push(`${field} must be a finite number.`);
    }
  }

  switch (model.kind) {
    case "mohr-coulomb":
      if (!Number.isFinite(model.cohesion) || model.cohesion < 0) {
        errors.push("Cohesion (c) must be ≥ 0.");
      }
      if (!Number.isFinite(model.frictionAngle) || model.frictionAngle < 0) {
        errors.push("Friction angle (φ) must be ≥ 0.");
      } else if (model.frictionAngle >= 90) {
        errors.push("Friction angle (φ) must be less than 90°.");
      }
      if (model.cFactor !== undefined && model.cFactor < 0) {
        errors.push("cFactor must be ≥ 0.");
      }
      if (
        model.cohesion === 0 &&
        model.frictionAngle === 0 &&
        !((model.cohesionRateOfChange ?? 0) > 0)
      ) {
        errors.push(
          "Both c and φ are zero — the material has no strength. Set at least one.",
        );
      }
      if (
        model.cohesionUndrained !== undefined &&
        model.cFactor !== undefined &&
        model.cFactor > 0
      ) {
        // Combined method — validate Su
        if (
          !Number.isFinite(model.cohesionUndrained) ||
          model.cohesionUndrained < 0
        ) {
          errors.push(
            "Undrained cohesion (Su) must be ≥ 0 for combined method.",
          );
        }
      }
      break;

    case "undrained":
      if (
        !Number.isFinite(model.undrainedShearStrength) ||
        model.undrainedShearStrength < 0
      ) {
        errors.push("Undrained shear strength (Su) must be ≥ 0.");
      }
      validateCutoff(
        errors,
        model.suMax,
        model.suRateOfChange ?? 0,
        model.undrainedShearStrength,
      );
      break;

    case "high-strength":
      // Only unitWeight is needed — no additional validation
      break;

    case "impenetrable":
      // Only unitWeight is needed — no additional validation
      break;

    case "spatial-mohr-coulomb":
      if (!Array.isArray(model.dataPoints) || model.dataPoints.length < 1) {
        errors.push("Spatial Mohr-Coulomb requires at least 1 data point.");
      } else {
        for (let i = 0; i < model.dataPoints.length; i++) {
          const pt = model.dataPoints[i];
          if (!Array.isArray(pt) || pt.length !== 5) {
            errors.push(
              `Data point ${i + 1}: must have 5 values [x, y, c, φ, γ].`,
            );
            continue;
          }
          if (!pt.every((v) => Number.isFinite(v))) {
            errors.push(
              `Data point ${i + 1}: all values must be finite numbers.`,
            );
          }
          if (pt[2] < 0) {
            errors.push(`Data point ${i + 1}: cohesion (c) must be ≥ 0.`);
          }
          if (pt[3] < 0) {
            errors.push(`Data point ${i + 1}: friction angle (φ) must be ≥ 0.`);
          }
          if (pt[4] <= 0) {
            errors.push(`Data point ${i + 1}: unit weight (γ) must be > 0.`);
          }
        }
      }
      break;

    case "anisotropic-function":
      if (!Number.isFinite(model.cohesion) || model.cohesion < 0) {
        errors.push("Base cohesion (c) must be ≥ 0.");
      }
      if (!Number.isFinite(model.frictionAngle) || model.frictionAngle < 0) {
        errors.push("Base friction angle (φ) must be ≥ 0.");
      } else if (model.frictionAngle >= 90) {
        errors.push("Base friction angle (φ) must be less than 90°.");
      }
      if (
        !Array.isArray(model.modifierFunction) ||
        model.modifierFunction.length < 2
      ) {
        errors.push(
          "Anisotropic modifier function requires at least 2 data points.",
        );
      } else {
        for (let i = 0; i < model.modifierFunction.length; i++) {
          const pt = model.modifierFunction[i];
          if (!Array.isArray(pt) || pt.length !== 2) {
            errors.push(
              `Modifier point ${i + 1}: must have 2 values [α°, factor].`,
            );
          } else if (!pt.every((v) => Number.isFinite(v))) {
            errors.push(
              `Modifier point ${i + 1}: all values must be finite numbers.`,
            );
          } else if (pt[1] < 0) {
            errors.push(`Modifier point ${i + 1}: factor must be ≥ 0.`);
          }
        }
      }
      break;

    case "s-f-depth":
      if (!Number.isFinite(model.suRef) || model.suRef < 0) {
        errors.push("Reference Su (suRef) must be ≥ 0.");
      }
      if (!Number.isFinite(model.depthRef)) {
        errors.push("Reference depth (depthRef) must be a finite number.");
      }
      if (!Number.isFinite(model.rate)) {
        errors.push("Rate of change must be a finite number.");
      }
      if (
        model.depthReference !== undefined &&
        model.depthReference !== "ground" &&
        model.depthReference !== "layer-top"
      ) {
        errors.push('Depth reference must be "ground" or "layer-top".');
      }
      validateCutoff(errors, model.suMax, model.rate, model.suRef);
      break;

    case "lime-cement-columns":
      if (!Number.isFinite(model.soilSu) || model.soilSu < 0) {
        errors.push("Soil Su between the columns must be ≥ 0.");
      }
      if (!Number.isFinite(model.columnSu) || model.columnSu < 0) {
        errors.push("Column Su must be ≥ 0.");
      }
      if (!Number.isFinite(model.areaRatio) || model.areaRatio < 0 || model.areaRatio > 1) {
        errors.push("Area ratio must be between 0 and 1.");
      }
      if (model.suRefDepth !== undefined && !Number.isFinite(model.suRefDepth)) {
        errors.push("Reference level must be a finite number.");
      }
      if (model.suRateOfChange !== undefined && !Number.isFinite(model.suRateOfChange)) {
        errors.push("Rate of change must be a finite number.");
      }
      if ((model.columnCohesion === undefined) !== (model.columnFrictionAngle === undefined)) {
        errors.push("Give both the drained column cohesion and friction angle, or neither.");
      } else if (model.columnCohesion !== undefined) {
        if (!Number.isFinite(model.columnCohesion) || model.columnCohesion < 0) {
          errors.push("Drained column cohesion must be ≥ 0.");
        }
        if (!(Number.isFinite(model.columnFrictionAngle) && model.columnFrictionAngle! >= 0 && model.columnFrictionAngle! < 90)) {
          errors.push("Drained column friction angle must be 0–90°.");
        }
      }
      validateCutoff(errors, model.suMax, model.suRateOfChange ?? 0, model.soilSu);
      break;

    case "s-f-datum":
      if (!Number.isFinite(model.suRef) || model.suRef < 0) {
        errors.push("Reference Su (suRef) must be ≥ 0.");
      }
      if (!Number.isFinite(model.yRef)) {
        errors.push("Reference elevation (yRef) must be a finite number.");
      }
      if (!Number.isFinite(model.rate)) {
        errors.push("Rate of change must be a finite number.");
      }
      validateCutoff(errors, model.suMax, model.rate, model.suRef);
      break;
    default:
      errors.push(
        `Unknown material model kind "${(model as { kind?: unknown }).kind}".`,
      );
  }

  return errors;
}

/**
 * Strength cutoff `suMax`: finite and > 0. With a negative rate it is a
 * minimum, which only makes sense below the reference strength (otherwise
 * it replaces the whole profile below the reference level).
 */
function validateCutoff(
  errors: string[],
  suMax: number | undefined,
  rate: number,
  suRef: number,
): void {
  if (suMax === undefined) return;
  if (!Number.isFinite(suMax) || suMax <= 0) {
    errors.push("Strength cutoff (suMax) must be a positive number.");
  }
  // With a negative rate the cutoff is a floor. It may lie above the
  // reference Su (the profile is highest at its top), so it is not
  // compared with it; varied values (reliability, sensitivity) must not
  // make a valid model invalid either.
  void rate;
  void suRef;
}
