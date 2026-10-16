/**
 * An app model from an engine slope definition: the reverse of
 * `buildSlopeDTOFromModel` for the parts a verification problem uses, so a
 * published problem can be opened in the app (the website's result images
 * are captured this way). Both are in model coordinates; a definition
 * without an orientation gets the one the engine infers from its geometry.
 */

import { resolveOrientation, type AnalysisOptions, type SlopeDefinition } from "@cslope/engine";
import type { ModelEntry } from "./types";
import { APP_DEFAULT_ANALYSIS_OPTIONS, DEFAULT_PIEZO_LINE, MATERIAL_COLORS } from "./defaults";
import { createExampleResultViewSettings } from "./benchmarks";

export interface DefinitionModelInfo {
  id: string;
  name: string;
  /** Analysis options on top of the app's defaults (method, slices, ...). */
  options?: Partial<AnalysisOptions>;
}

/** Parts of a definition this conversion does not carry over. */
const UNSUPPORTED = ["waterTables", "reinforcements", "piles"] as const;

export function modelFromDefinition(def: SlopeDefinition, info: DefinitionModelInfo): ModelEntry {
  for (const key of UNSUPPORTED) {
    const v = (def as unknown as Record<string, unknown>)[key];
    if (Array.isArray(v) && v.length > 0) throw new Error(`Definitions with ${key} are not supported`);
  }
  if (def.waterTable && def.waterTable.mode !== "custom") {
    throw new Error(`Water table mode "${def.waterTable.mode}" is not supported`);
  }

  const materialId = (i: number) => `${info.id}-mat-${i + 1}`;
  const idByName = new Map(def.materials.map((m, i) => [m.name, materialId(i)]));
  const water = def.waterTable?.mode === "custom" ? (def.waterTable.value as [number, number][]) : null;
  const xs = def.coordinates.map((c) => c[0]);

  return {
    id: info.id,
    name: info.name,
    orientation: resolveOrientation(def.orientation, def.coordinates),
    coordinates: def.coordinates.map(([x, y]) => [x, y]),
    materials: def.materials.map((m, i) => ({
      id: materialId(i),
      name: m.name,
      color: m.color ?? MATERIAL_COLORS[i % MATERIAL_COLORS.length],
      ...(m.depthRange ? { depthRange: m.depthRange } : {}),
      model: m.model ?? { kind: "mohr-coulomb", unitWeight: m.unitWeight, cohesion: m.cohesion, frictionAngle: m.frictionAngle },
    })),
    materialBoundaries: (def.materialBoundaries ?? []).map((b, i) => ({
      // Ids sort in definition order (the analysis applies boundaries by id).
      id: `${info.id}-boundary-${String(i + 1).padStart(3, "0")}`,
      coordinates: b.coordinates.map(([x, y]) => [x, y] as [number, number]),
    })),
    regionMaterials: (def.regionAssignments ?? []).flatMap((a) => {
      const id = idByName.get(a.materialName);
      return id ? [{ point: [a.point[0], a.point[1]] as [number, number], materialId: id }] : [];
    }),
    piezometricLine: water
      ? {
          ...DEFAULT_PIEZO_LINE,
          enabled: true,
          lines: [{ id: `${info.id}-water`, name: "Water table", color: "#3b82f6", coordinates: water.map(([x, y]) => [x, y]) }],
          activeLineId: `${info.id}-water`,
          mainLineId: `${info.id}-water`,
          freeWater: def.waterTable?.followBoundary !== true,
        }
      : { ...DEFAULT_PIEZO_LINE, lines: [] },
    udls: (def.udls ?? []).map((u, i) => ({ id: `${info.id}-udl-${i + 1}`, magnitude: u.magnitude, x1: u.x1, x2: u.x2 })),
    lineLoads: (def.lineLoads ?? []).map((l, i) => ({ id: `${info.id}-load-${i + 1}`, magnitude: l.magnitude, x: l.x })),
    customSearchPlanes: [
      ...(def.customSearchPlanes ?? []).map((p, i) => ({ id: `${info.id}-plane-${i + 1}`, cx: p.cx, cy: p.cy, radius: p.radius })),
      ...(def.customSurfaces ?? []).map((s, i) => ({
        id: `${info.id}-surface-${i + 1}`,
        cx: 0,
        cy: 0,
        radius: 0,
        points: s.points.map(([x, y]) => [x, y] as [number, number]),
      })),
    ],
    customPlanesOnly: def.customPlanesOnly ?? false,
    options: { ...APP_DEFAULT_ANALYSIS_OPTIONS, ...info.options },
    analysisLimits: def.analysisLimits
      ? { enabled: true, ...def.analysisLimits }
      : { enabled: false, entryLeftX: Math.min(...xs), entryRightX: Math.max(...xs), exitLeftX: Math.min(...xs), exitRightX: Math.max(...xs) },
    // The paper fitted to the model, without the examples' title and table.
    resultViewSettings: { ...createExampleResultViewSettings(def.coordinates)!, annotations: [] },
  };
}
