/**
 * Build a Slope model from a serialized SlopeDefinition DTO.
 *
 * Used by the Web Worker to reconstruct the model from UI data,
 * and also available for testing without worker context.
 */

import { materialModelOf, type SlopeDefinition } from "../types/slope-definition";
import { Material, Udl, LineLoad } from "../types/index";
import { validateMaterialModel } from "../types/validation";
import { Slope } from "./slope";
import { addSingleCircularPlane } from "./search";
import {
  defaultAxisPoint,
  fitPolylineToGround,
  isAdmissiblePolyline,
} from "./surface";

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
  if (!Array.isArray(def.materials) || def.materials.length === 0) {
    throw new Error("The model needs at least one material.");
  }
  for (const m of def.materials) {
    const model = materialModelOf(m);

    // Validate the model before constructing the Material.
    const validationErrors = validateMaterialModel(model);
    if (validationErrors.length > 0) {
      throw new Error(
        `Material "${m.name}" has invalid model:\n  – ${validationErrors.join("\n  – ")}`,
      );
    }

    const mat = new Material({ name: m.name, color: m.color, model });
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
  // A canonical definition of a right-to-left slope is mirrored model
  // space; options given in model space (interslice data points) follow.
  slope.setMirrored(def.orientation === "rtl");

  // Material boundaries — split the geometry first, then assign materials
  if (def.materialBoundaries && def.materialBoundaries.length > 0) {
    // Cut the slope by all boundaries at once, exactly as the canvas
    // computes its regions (order independent, no re-splitting). Lines
    // with fewer than two points are skipped there; all are passed so that
    // slope.danglingBoundaries indexes def.materialBoundaries.
    slope.setMaterialBoundaries(def.materialBoundaries.map((b) => b.coordinates));

    if (!(def.regionAssignments && def.regionAssignments.length > 0)) {
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

  // Point-based assignment: each entry maps a representative point to a
  // material, assigned to whichever region contains the point.  This also
  // applies to a model without interior boundaries (a single region).
  // When several points fall in the same region the FIRST one wins (same
  // rule as the desktop canvas), so apply them in reverse order.
  if (def.regionAssignments && def.regionAssignments.length > 0) {
    for (const ra of [...def.regionAssignments].reverse()) {
      const mat = materialsByName.get(ra.materialName);
      // An unknown name left the region with the first material.
      if (!mat) throw new Error(`Region assigned to an unknown material "${ra.materialName}".`);
      slope.assignMaterial(ra.point, mat);
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

  // Per-material water tables
  if (def.waterTables && def.waterTables.length > 0) {
    for (const wt of def.waterTables) {
      slope.setWaterTableById(wt.id, wt.coordinates, wt.followBoundary);
    }
    for (const m of def.materials) {
      const mat = materialsByName.get(m.name);
      if (mat && m.waterTableId !== undefined) {
        slope.assignMaterialWaterTable(mat, m.waterTableId);
      }
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

  // Reinforcement
  if (def.reinforcements?.length) {
    slope.setReinforcements(def.reinforcements);
  }

  if (def.piles?.length) {
    slope.setPiles(def.piles);
  }

  // Analysis limits
  if (def.analysisLimits) {
    slope.setAnalysisLimits(def.analysisLimits);
  }

  // Custom search planes
  if (def.customSearchPlanes) {
    for (const p of def.customSearchPlanes) {
      if (![p.cx, p.cy, p.radius].every(Number.isFinite) || p.radius <= 0) {
        throw new Error(
          `Custom search circle (${p.cx}, ${p.cy}, R ${p.radius}) needs a finite centre and a positive radius.`,
        );
      }
      addSingleCircularPlane(slope, p.cx, p.cy, p.radius);
    }
  }

  // Custom non-circular surfaces
  if (def.customSurfaces) {
    for (const surface of def.customSurfaces) {
      // Like a custom circle that misses the ground, a polyline that does
      // not cut through the soil or leaves the model is no surface.
      const points = fitPolylineToGround(slope, surface.points);
      if (!points || !isAdmissiblePolyline(slope, points, Infinity)) continue;
      const [cx, cy] = surface.axis ?? defaultAxisPoint(points);
      slope.addIndividualPlanes([
        {
          lc: points[0],
          rc: points[points.length - 1],
          cx,
          cy,
          radius: 0,
          points,
          fos: null,
          slices: null,
        },
      ]);
    }
  }

  // Custom-planes-only mode: skip random search generation
  if (def.customPlanesOnly) {
    slope.customPlanesOnly = true;
  }

  return slope;
}
