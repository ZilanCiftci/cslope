/**
 * An app model from an engine slope definition: the reverse of
 * `buildSlopeDTOFromModel` for the parts a verification problem uses, so a
 * published problem can be opened in the app (the website's result images
 * are captured this way). Both are in model coordinates; a definition
 * without an orientation gets the one the engine infers from its geometry.
 */

import { materialModelOf, resolveOrientation, type AnalysisOptions, type SlopeDefinition } from "@cslope/engine";
import type { Pile, Reinforcement } from "@cslope/engine";
import type { ModelEntry, PileRow, ReinforcementRow } from "./types";
import { APP_DEFAULT_ANALYSIS_OPTIONS, DEFAULT_PIEZO_LINE, MATERIAL_COLORS, PIEZO_COLORS } from "./defaults";
import { createExampleResultViewSettings } from "./benchmarks";

export interface DefinitionModelInfo {
  id: string;
  name: string;
  /** Analysis options on top of the app's defaults (method, slices, ...). */
  options?: Partial<AnalysisOptions>;
}

/**
 * The app's element for an engine reinforcement, with the engine's defaults
 * for what the definition leaves out. The type only names it in the app:
 * the analysis takes the fields.
 */
function reinforcementRow(r: Reinforcement, id: string): ReinforcementRow {
  const p = r.pullout;
  if (p?.kind === "interface" && p.coverage != null && p.coverage !== 1) {
    throw new Error("Interface coverage is not supported");
  }
  const direction = r.direction ?? "axial";
  return {
    id,
    type:
      p?.kind === "interface" || direction === "tangent"
        ? "geosynthetic"
        : p?.kind === "bond"
          ? p.bondedLength
            ? "tieback"
            : "nail"
          : "anchor",
    x1: r.x1,
    y1: r.y1,
    x2: r.x2,
    y2: r.y2,
    tensileCapacity: r.tensileCapacity,
    spacing: r.spacing ?? 1,
    pullout: p?.kind ?? "none",
    bondStrength: p?.kind === "bond" ? p.strength : 0,
    bondedLength: p?.kind === "bond" ? (p.bondedLength ?? 0) : 0,
    adhesion: p?.kind === "interface" ? p.adhesion : 0,
    interfaceFriction: p?.kind === "interface" ? p.frictionAngle : 0,
    ...(p?.kind === "development" ? { developmentLength1: p.length1, developmentLength2: p.length2 } : {}),
    end1Capacity: r.end1Capacity ?? 0,
    end2Capacity: r.end2Capacity ?? 0,
    direction,
    application: r.application ?? "active",
  };
}

/** The app's pile row for an engine pile (Ito & Matsui when no force is given). */
function pileRow(p: Pile, id: string): PileRow {
  const spacing = p.spacing ?? 1;
  return {
    id,
    type: p.force != null && spacing === 1 ? "sheet-pile" : "pile",
    x1: p.x1,
    y1: p.y1,
    x2: p.x2,
    y2: p.y2,
    mode: p.force != null ? "force" : "ito-matsui",
    force: p.force ?? 0,
    diameter: p.diameter ?? 0.6,
    spacing,
    shearCapacity: p.shearCapacity ?? 0,
    momentCapacity: p.momentCapacity ?? 0,
    angle: p.angle ?? 0,
    ...(p.direction ? { direction: p.direction } : {}),
    application: p.application ?? "active",
  };
}

/**
 * The piezometric lines: the main water table, and each further line that
 * a material is assigned to. The app has one free-water setting for all.
 */
function piezometricLine(def: SlopeDefinition, id: string, materialId: (i: number) => string): ModelEntry["piezometricLine"] {
  const main = def.waterTable?.mode === "custom" ? (def.waterTable.value as [number, number][]) : null;
  const extra = def.waterTables ?? [];
  if (!main && extra.length) throw new Error("Further water tables without a main one are not supported");
  if (!main) return { ...DEFAULT_PIEZO_LINE, lines: [] };
  const followBoundary = def.waterTable?.followBoundary === true;
  if (extra.some((w) => (w.followBoundary === true) !== followBoundary)) {
    throw new Error("Water tables that differ in free water are not supported");
  }
  const mainId = `${id}-water`;
  const same = (a: [number, number][], b: [number, number][]) => JSON.stringify(a) === JSON.stringify(b);
  const lineId = new Map(extra.map((w) => [w.id, same(w.coordinates, main) ? mainId : `${id}-water-${w.id}`]));
  const lines = [
    { id: mainId, name: "Water table", color: "#3b82f6", coordinates: main.map(([x, y]) => [x, y] as [number, number]) },
    ...extra
      .filter((w) => lineId.get(w.id) !== mainId)
      .map((w, i) => ({
        id: lineId.get(w.id)!,
        name: w.id,
        color: PIEZO_COLORS[(i + 1) % PIEZO_COLORS.length],
        coordinates: w.coordinates.map(([x, y]) => [x, y] as [number, number]),
      })),
  ];
  const materialAssignment: Record<string, string> = {};
  def.materials.forEach((m, i) => {
    const line = m.waterTableId ? lineId.get(m.waterTableId) : undefined;
    if (m.waterTableId && !line) throw new Error(`Material ${m.name} names an unknown water table`);
    if (line && line !== mainId) materialAssignment[materialId(i)] = line;
  });
  return {
    ...DEFAULT_PIEZO_LINE,
    enabled: true,
    lines,
    activeLineId: mainId,
    mainLineId: mainId,
    freeWater: !followBoundary,
    materialAssignment,
  };
}

export function modelFromDefinition(def: SlopeDefinition, info: DefinitionModelInfo): ModelEntry {
  if (def.waterTable && def.waterTable.mode !== "custom") {
    throw new Error(`Water table mode "${def.waterTable.mode}" is not supported`);
  }

  const materialId = (i: number) => `${info.id}-mat-${i + 1}`;
  const idByName = new Map(def.materials.map((m, i) => [m.name, materialId(i)]));
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
      model: materialModelOf(m),
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
    piezometricLine: piezometricLine(def, info.id, materialId),
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
    reinforcements: (def.reinforcements ?? []).map((r, i) => reinforcementRow(r, `${info.id}-reinforcement-${i + 1}`)),
    piles: (def.piles ?? []).map((p, i) => pileRow(p, `${info.id}-pile-${i + 1}`)),
    options: { ...APP_DEFAULT_ANALYSIS_OPTIONS, ...info.options },
    analysisLimits: def.analysisLimits
      ? { enabled: true, ...def.analysisLimits }
      : { enabled: false, entryLeftX: Math.min(...xs), entryRightX: Math.max(...xs), exitLeftX: Math.min(...xs), exitRightX: Math.max(...xs) },
    // The paper fitted to the model, without the examples' title and table.
    resultViewSettings: { ...createExampleResultViewSettings(def.coordinates)!, annotations: [] },
  };
}
