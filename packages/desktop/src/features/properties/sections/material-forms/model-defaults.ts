/**
 * Default MaterialModel factories for each model kind.
 *
 * Used when the user switches model kind in the UI — we reset the
 * model-specific fields to sensible defaults.
 */

import type {
  MaterialModel,
  MaterialModelKind,
  MohrCoulombModel,
  UndrainedModel,
  HighStrengthModel,
  ImpenetrableModel,
  SpatialMohrCoulombModel,
  AnisotropicFunctionModel,
  StrengthFromDepthModel,
  StrengthFromDatumModel,
} from "@cslope/engine";

export function createDefaultModel(
  kind: MaterialModelKind,
  unitWeight: number = 18,
): MaterialModel {
  switch (kind) {
    case "mohr-coulomb":
      return {
        kind: "mohr-coulomb",
        unitWeight,
        cohesion: 10,
        frictionAngle: 30,
      } satisfies MohrCoulombModel;

    case "undrained":
      return {
        kind: "undrained",
        unitWeight,
        undrainedShearStrength: 50,
      } satisfies UndrainedModel;

    case "high-strength":
      return {
        kind: "high-strength",
        unitWeight,
      } satisfies HighStrengthModel;

    case "impenetrable":
      return {
        kind: "impenetrable",
        unitWeight,
      } satisfies ImpenetrableModel;

    case "spatial-mohr-coulomb":
      return {
        kind: "spatial-mohr-coulomb",
        unitWeight,
        dataPoints: [],
        interpolation: "idw",
      } satisfies SpatialMohrCoulombModel;

    case "anisotropic-function":
      return {
        kind: "anisotropic-function",
        unitWeight,
        cohesion: 10,
        frictionAngle: 30,
        modifierFunction: [
          [0, 1.0],
          [90, 1.0],
        ],
      } satisfies AnisotropicFunctionModel;

    case "s-f-depth":
      return {
        kind: "s-f-depth",
        unitWeight,
        strengthFunction: [],
      } satisfies StrengthFromDepthModel;

    case "s-f-datum":
      return {
        kind: "s-f-datum",
        unitWeight,
        strengthFunction: [],
      } satisfies StrengthFromDatumModel;
  }
}

/**
 * Derive flat MaterialRow fields from a MaterialModel.
 *
 * These are the legacy fields (unitWeight, frictionAngle, cohesion)
 * that the rest of the app still reads for display / backward compat.
 */
export function flatFieldsFromModel(model: MaterialModel): {
  unitWeight: number;
  frictionAngle: number;
  cohesion: number;
} {
  switch (model.kind) {
    case "mohr-coulomb":
      return {
        unitWeight: model.unitWeight,
        frictionAngle: model.frictionAngle,
        cohesion: model.cohesion,
      };
    case "undrained":
      return {
        unitWeight: model.unitWeight,
        frictionAngle: 0,
        cohesion: model.undrainedShearStrength,
      };
    case "anisotropic-function":
      return {
        unitWeight: model.unitWeight,
        frictionAngle: model.frictionAngle,
        cohesion: model.cohesion,
      };
    default:
      return {
        unitWeight: model.unitWeight,
        frictionAngle: 0,
        cohesion: 0,
      };
  }
}
