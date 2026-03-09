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
  }

  switch (model.kind) {
    case "mohr-coulomb":
      if (!Number.isFinite(model.cohesion) || model.cohesion < 0) {
        errors.push("Cohesion (c) must be ≥ 0.");
      }
      if (!Number.isFinite(model.frictionAngle) || model.frictionAngle < 0) {
        errors.push("Friction angle (φ) must be ≥ 0.");
      }
      if (model.cohesion === 0 && model.frictionAngle === 0) {
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
      if (
        !Array.isArray(model.strengthFunction) ||
        model.strengthFunction.length < 2
      ) {
        errors.push(
          "S=f(depth) requires at least 2 data points in the strength function.",
        );
      } else {
        for (let i = 0; i < model.strengthFunction.length; i++) {
          const pt = model.strengthFunction[i];
          if (!Array.isArray(pt) || pt.length !== 2) {
            errors.push(
              `Strength point ${i + 1}: must have 2 values [depth, Su].`,
            );
          } else if (!pt.every((v) => Number.isFinite(v))) {
            errors.push(
              `Strength point ${i + 1}: all values must be finite numbers.`,
            );
          } else {
            if (pt[0] < 0) {
              errors.push(`Strength point ${i + 1}: depth must be ≥ 0.`);
            }
            if (pt[1] < 0) {
              errors.push(`Strength point ${i + 1}: Su must be ≥ 0.`);
            }
          }
        }
      }
      break;

    case "s-f-datum":
      if (
        !Array.isArray(model.strengthFunction) ||
        model.strengthFunction.length < 2
      ) {
        errors.push(
          "S=f(datum) requires at least 2 data points in the strength function.",
        );
      } else {
        for (let i = 0; i < model.strengthFunction.length; i++) {
          const pt = model.strengthFunction[i];
          if (!Array.isArray(pt) || pt.length !== 2) {
            errors.push(
              `Strength point ${i + 1}: must have 2 values [elevation, Su].`,
            );
          } else if (!pt.every((v) => Number.isFinite(v))) {
            errors.push(
              `Strength point ${i + 1}: all values must be finite numbers.`,
            );
          } else if (pt[1] < 0) {
            errors.push(`Strength point ${i + 1}: Su must be ≥ 0.`);
          }
        }
      }
      break;
  }

  return errors;
}
