/**
 * Build a Slope model from a serialized SlopeDefinition DTO.
 *
 * Used by the Web Worker to reconstruct the model from UI data,
 * and also available for testing without worker context.
 */

import type { SlopeDefinition } from "./messages";
import type { MaterialType } from "../engine/types/material";
import { Material, Udl, LineLoad } from "../engine/types/index";
import { Slope } from "../engine/model/index";

/**
 * Reconstruct a Slope model from a serialized SlopeDefinition DTO.
 */
export function buildSlope(def: SlopeDefinition): Slope {
  const slope = new Slope();

  // Materials — build Material instances first so we can assign the first
  // one to the external boundary (matching Python's behaviour where
  // set_external_boundary uses materials[0]).
  const materialsByName = new Map<string, InstanceType<typeof Material>>();
  for (const m of def.materials) {
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

    // Assign materials below each boundary.
    // For each boundary, find a point just below the midpoint of the polyline.
    for (const b of def.materialBoundaries) {
      const mat = materialsByName.get(b.materialName);
      if (mat && b.coordinates.length >= 2) {
        // Use the midpoint of the polyline, offset slightly downward
        const midIdx = Math.floor(b.coordinates.length / 2);
        const midPt = b.coordinates[midIdx];
        slope.assignMaterial([midPt[0], midPt[1] - 0.01], mat);
      }
    }

    // Assign material to the top region.
    // When topRegionMaterialName is explicitly provided, use it.
    // Otherwise fall back to the first defined material (matching Python).
    const topMatName = def.topRegionMaterialName ?? def.materials[0]?.name;
    const topMat = topMatName ? materialsByName.get(topMatName) : undefined;
    if (topMat) {
      const firstB = def.materialBoundaries[0];
      const midIdx = Math.floor(firstB.coordinates.length / 2);
      const midPt = firstB.coordinates[midIdx];
      slope.assignMaterial([midPt[0], midPt[1] + 0.01], topMat);
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

  return slope;
}
