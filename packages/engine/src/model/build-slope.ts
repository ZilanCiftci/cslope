/**
 * Build a Slope model from a serialized SlopeDefinition DTO.
 *
 * Used by the Web Worker to reconstruct the model from UI data,
 * and also available for testing without worker context.
 */

import type { SlopeDefinition } from "../types/slope-definition";
import type { MaterialType } from "../types/material";
import { Material, Udl, LineLoad } from "../types/index";
import type { MohrCoulombModel } from "../types/material-models";
import { validateMaterialModel } from "../types/validation";
import { Slope } from "./slope";
import { addSingleCircularPlane } from "./search";

/**
 * Compute the midpoint along a polyline at half of its total arc length.
 * The result always lies ON the polyline and is robust for any number of
 * vertices — including 2-point boundaries where the old vertex-index
 * approach would pick an endpoint that might lie outside the slope.
 */
function polylineMidpoint(coords: [number, number][]): [number, number] {
  if (coords.length === 1) return coords[0];

  // Compute cumulative segment lengths
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    totalLen += len;
  }

  // Walk along the polyline to the half-length point
  const halfLen = totalLen / 2;
  let accum = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (accum + segLens[i] >= halfLen) {
      const t = (halfLen - accum) / segLens[i];
      return [
        coords[i][0] + t * (coords[i + 1][0] - coords[i][0]),
        coords[i][1] + t * (coords[i + 1][1] - coords[i][1]),
      ];
    }
    accum += segLens[i];
  }

  // Fallback: return last point
  return coords[coords.length - 1];
}

/**
 * Reconstruct a Slope model from a serialized SlopeDefinition DTO.
 */
export function buildSlope(def: SlopeDefinition): Slope {
  const slope = new Slope();

  // Materials — build Material instances first so we can assign the first
  // one to the external boundary (set_external_boundary uses materials[0]).
  const materialsByName = new Map<string, InstanceType<typeof Material>>();
  for (const m of def.materials) {
    // When a full MaterialModel is provided, use it directly.
    // Otherwise, fall back to constructing from flat fields (backward compat).
    const model =
      m.model ??
      ({
        kind: "mohr-coulomb" as const,
        unitWeight: m.unitWeight,
        cohesion: m.cohesion,
        frictionAngle: m.frictionAngle,
        cohesionRefDepth: m.cohesionRefDepth,
        cohesionRateOfChange: m.cohesionRateOfChange,
        cohesionUndrained: m.cohesionUndrained,
      } satisfies MohrCoulombModel);

    // Validate the model before constructing the Material.
    const validationErrors = validateMaterialModel(model);
    if (validationErrors.length > 0) {
      throw new Error(
        `Material "${m.name}" has invalid model:\n  – ${validationErrors.join("\n  – ")}`,
      );
    }

    const mat = new Material({
      name: m.name,
      unitWeight: m.unitWeight,
      frictionAngle: m.frictionAngle,
      cohesion: m.cohesion,
      cohesionRefDepth: m.cohesionRefDepth,
      cohesionRateOfChange: m.cohesionRateOfChange,
      cohesionUndrained: m.cohesionUndrained,
      materialType: m.materialType as MaterialType | undefined,
      color: m.color,
      model,
    });
    materialsByName.set(m.name, mat);
  }

  // External boundary — assign the first defined material so it isn't the
  // placeholder default Material (c=2, phi=35).
  const firstMat =
    def.materials.length > 0
      ? materialsByName.get(def.materials[0].name)
      : undefined;
  if (firstMat) {
    slope.addMaterial(firstMat);
  }
  slope.setExternalBoundary(def.coordinates);

  // Material boundaries — split the geometry first, then assign materials
  if (def.materialBoundaries && def.materialBoundaries.length > 0) {
    // Split at each boundary polyline
    for (const b of def.materialBoundaries) {
      if (b.coordinates.length >= 2) {
        slope.setMaterialBoundary(b.coordinates);
      }
    }

    if (def.regionAssignments && def.regionAssignments.length > 0) {
      // Point-based assignment: each entry maps a representative point
      // to a material.  The engine assigns it to whichever region
      // contains the point.
      for (const ra of def.regionAssignments) {
        const mat = materialsByName.get(ra.materialName);
        if (mat) {
          slope.assignMaterial(ra.point, mat);
        }
      }
    } else {
      // Legacy boundary-name assignment (materialBoundaries carry materialName)
      for (const b of def.materialBoundaries) {
        const mat = materialsByName.get(b.materialName);
        if (mat && b.coordinates.length >= 2) {
          const midPt = polylineMidpoint(b.coordinates);
          slope.assignMaterial([midPt[0], midPt[1] - 0.01], mat);
        }
      }

      const topMatName = def.topRegionMaterialName ?? def.materials[0]?.name;
      const topMat = topMatName ? materialsByName.get(topMatName) : undefined;
      if (topMat) {
        const firstB = def.materialBoundaries[0];
        const midPt = polylineMidpoint(firstB.coordinates);
        slope.assignMaterial([midPt[0], midPt[1] + 0.01], topMat);
      }
    }
  }

  // Water table
  if (def.waterTable) {
    const wt = def.waterTable;
    if (wt.mode === "height" && typeof wt.value === "number") {
      slope.setWaterTable({
        height: wt.value,
        followBoundary: wt.followBoundary,
      });
    } else if (wt.mode === "depth" && typeof wt.value === "number") {
      slope.setWaterTable({
        depth: wt.value,
        followBoundary: wt.followBoundary,
      });
    } else if (wt.mode === "custom" && Array.isArray(wt.value)) {
      slope.setWaterTable({
        coordinates: wt.value as [number, number][],
        followBoundary: wt.followBoundary,
      });
    }
  }

  // UDLs
  if (def.udls) {
    slope.setUdls(
      ...def.udls.map(
        (u) => new Udl({ magnitude: u.magnitude, x1: u.x1, x2: u.x2 }),
      ),
    );
  }

  // Line loads
  if (def.lineLoads) {
    slope.setLineLoads(
      ...def.lineLoads.map(
        (ll) => new LineLoad({ magnitude: ll.magnitude, x: ll.x }),
      ),
    );
  }

  // Analysis limits
  if (def.analysisLimits) {
    slope.setAnalysisLimits(def.analysisLimits);
  }

  // Custom search planes
  if (def.customSearchPlanes) {
    for (const p of def.customSearchPlanes) {
      addSingleCircularPlane(slope, p.cx, p.cy, p.radius);
    }
  }

  // Custom-planes-only mode: skip random search generation
  if (def.customPlanesOnly) {
    slope.customPlanesOnly = true;
  }

  return slope;
}
