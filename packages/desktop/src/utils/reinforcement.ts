import type { Pile, PileForceDirection, Reinforcement } from "@cslope/engine";
import type { ModelOrientation, PileRow, PileType, ReinforcementRow, ReinforcementType } from "../store/types";
import { surfaceYAtX } from "../features/view/surface";

export const REINFORCEMENT_TYPE_LABELS: Record<ReinforcementType, string> = {
  anchor: "Anchor (end-anchored)",
  tieback: "Grouted tieback",
  nail: "Soil nail",
  geosynthetic: "Geosynthetic",
};

/**
 * Defaults per type, following common conventions: rigid supports act
 * along their axis, geosynthetics along the slip surface; tiebacks and
 * anchors are pre-tensioned (active), nails and geosynthetics mobilise
 * with the soil (passive, which gives the lower FOS).
 */
export function reinforcementPreset(
  type: ReinforcementType,
): Omit<ReinforcementRow, "id" | "x1" | "y1" | "x2" | "y2" | "label"> {
  const base = {
    type,
    spacing: 1,
    bondStrength: 0,
    bondedLength: 0,
    adhesion: 0,
    interfaceFriction: 0,
    end1Capacity: 0,
    end2Capacity: 0,
    direction: "axial" as const,
    application: "active" as const,
  };
  switch (type) {
    case "anchor":
      return { ...base, tensileCapacity: 200, spacing: 2, pullout: "none" };
    case "tieback":
      // Head fully anchored; bond over the last 5 m.
      return {
        ...base,
        tensileCapacity: 300,
        spacing: 2,
        pullout: "bond",
        bondStrength: 60,
        bondedLength: 5,
        end1Capacity: 300,
      };
    case "nail":
      return {
        ...base,
        tensileCapacity: 100,
        spacing: 1.5,
        pullout: "bond",
        bondStrength: 15,
        end1Capacity: 50,
        application: "passive",
      };
    case "geosynthetic":
      return {
        ...base,
        tensileCapacity: 50,
        pullout: "interface",
        interfaceFriction: 20,
        direction: "tangent",
        application: "passive",
      };
  }
}

/** A new element: 10 m long at 15° into the slope, below the mid ground. */
export function newReinforcement(
  id: string,
  type: ReinforcementType,
  coordinates: [number, number][],
  orientation: ModelOrientation,
): ReinforcementRow {
  const xs = coordinates.map((c) => c[0]);
  const xMid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const yGround = surfaceYAtX(coordinates, xMid) ?? 0;
  // Into the slope: away from the sliding direction.
  const into = orientation === "rtl" ? 1 : -1;
  const angle = type === "geosynthetic" ? 0 : (15 * Math.PI) / 180;
  const length = 10;
  const x1 = xMid;
  const y1 = yGround - 1;
  return {
    id,
    x1,
    y1,
    x2: x1 + into * length * Math.cos(angle),
    y2: y1 - length * Math.sin(angle),
    ...reinforcementPreset(type),
  };
}

/** Engine input for an element. */
export function toEngineReinforcement(row: ReinforcementRow): Reinforcement {
  const pullout: Reinforcement["pullout"] =
    row.pullout === "bond"
      ? {
          kind: "bond",
          strength: row.bondStrength,
          ...(row.bondedLength > 0 ? { bondedLength: row.bondedLength } : {}),
        }
      : row.pullout === "interface"
        ? { kind: "interface", adhesion: row.adhesion, frictionAngle: row.interfaceFriction }
        : row.pullout === "development"
          ? { kind: "development", length1: row.developmentLength1 ?? 0, length2: row.developmentLength2 ?? 0 }
          : undefined;
  return {
    x1: row.x1,
    y1: row.y1,
    x2: row.x2,
    y2: row.y2,
    tensileCapacity: row.tensileCapacity,
    spacing: row.spacing,
    ...(pullout ? { pullout, end1Capacity: row.end1Capacity, end2Capacity: row.end2Capacity } : {}),
    direction: row.direction,
    application: row.application,
  };
}

const TYPES: ReinforcementType[] = ["anchor", "tieback", "nail", "geosynthetic"];

/** An element read from a file, or null if it is not one. */
export function sanitizeReinforcement(raw: unknown, id: string): ReinforcementRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = TYPES.includes(r.type as ReinforcementType) ? (r.type as ReinforcementType) : null;
  if (!type) return null;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (![r.x1, r.y1, r.x2, r.y2].every(finite)) return null;
  const preset = reinforcementPreset(type);
  const num = (v: unknown, fallback: number, min = 0) =>
    finite(v) && (v as number) >= min ? (v as number) : fallback;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    id: typeof r.id === "string" && r.id ? r.id : id,
    ...(typeof r.label === "string" ? { label: r.label } : {}),
    type,
    x1: r.x1 as number,
    y1: r.y1 as number,
    x2: r.x2 as number,
    y2: r.y2 as number,
    tensileCapacity: num(r.tensileCapacity, preset.tensileCapacity),
    spacing: finite(r.spacing) && (r.spacing as number) > 0 ? (r.spacing as number) : preset.spacing,
    pullout: pick(r.pullout, ["none", "bond", "interface", "development"] as const, preset.pullout),
    ...(r.pullout === "development"
      ? { developmentLength1: num(r.developmentLength1, 0), developmentLength2: num(r.developmentLength2, 0) }
      : {}),
    bondStrength: num(r.bondStrength, preset.bondStrength),
    bondedLength: num(r.bondedLength, preset.bondedLength),
    adhesion: num(r.adhesion, preset.adhesion),
    interfaceFriction: finite(r.interfaceFriction) && (r.interfaceFriction as number) >= 0 && (r.interfaceFriction as number) < 90
      ? (r.interfaceFriction as number)
      : preset.interfaceFriction,
    end1Capacity: num(r.end1Capacity, preset.end1Capacity),
    end2Capacity: num(r.end2Capacity, preset.end2Capacity),
    direction: pick(r.direction, ["axial", "tangent", "bisector"] as const, preset.direction),
    // A geosynthetic saved without an application was active (the preset
    // then); it must not turn passive with the newer preset.
    application: pick(r.application, ["active", "passive"] as const, type === "geosynthetic" ? "active" : preset.application),
  };
}

export const PILE_TYPE_LABELS: Record<PileType, string> = {
  pile: "Pile row",
  "sheet-pile": "Sheet pile wall",
};

export const PILE_DIRECTION_LABELS: Record<PileForceDirection, string> = {
  tangent: "Tangent to the slip surface",
  perpendicular: "Perpendicular to the pile",
  angle: "At angle θ",
};

/**
 * Defaults: a pile row with the Ito & Matsui force, passive and tangent to
 * the slip surface (the usual default), or a sheet pile wall with a given shear
 * force per metre (active, at angle θ).
 */
export function pilePreset(type: PileType): Omit<PileRow, "id" | "x1" | "y1" | "x2" | "y2" | "label"> {
  return type === "pile"
    ? {
        type,
        mode: "ito-matsui",
        force: 100,
        diameter: 0.6,
        spacing: 2,
        shearCapacity: 0,
        momentCapacity: 0,
        angle: 0,
        direction: "tangent",
        application: "passive",
      }
    : {
        type,
        mode: "force",
        force: 100,
        diameter: 0.6,
        spacing: 1,
        shearCapacity: 0,
        momentCapacity: 0,
        angle: 0,
        application: "active",
      };
}

/** A new pile: vertical, from the mid ground 10 m down. */
export function newPile(id: string, type: PileType, coordinates: [number, number][]): PileRow {
  const xs = coordinates.map((c) => c[0]);
  const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const yGround = surfaceYAtX(coordinates, x) ?? 0;
  return { id, x1: x, y1: yGround, x2: x, y2: yGround - 10, ...pilePreset(type) };
}

/** Engine input for a pile row. */
export function toEnginePile(row: PileRow): Pile {
  return {
    x1: row.x1,
    y1: row.y1,
    x2: row.x2,
    y2: row.y2,
    ...(row.mode === "force" ? { force: row.force } : {}),
    diameter: row.diameter,
    spacing: row.spacing,
    ...(row.shearCapacity > 0 ? { shearCapacity: row.shearCapacity } : {}),
    ...(row.momentCapacity > 0 ? { momentCapacity: row.momentCapacity } : {}),
    angle: row.angle,
    ...(row.direction ? { direction: row.direction } : {}),
    application: row.application,
  };
}

const PILE_DIRECTIONS: PileForceDirection[] = ["tangent", "perpendicular", "angle"];

/** A pile row read from a file, or null if it is not one. */
export function sanitizePile(raw: unknown, id: string): PileRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type: PileType | null = r.type === "pile" || r.type === "sheet-pile" ? r.type : null;
  if (!type) return null;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (![r.x1, r.y1, r.x2, r.y2].every(finite)) return null;
  const preset = pilePreset(type);
  const num = (v: unknown, fallback: number, ok: (n: number) => boolean) => (finite(v) && ok(v as number) ? (v as number) : fallback);
  return {
    id: typeof r.id === "string" && r.id ? r.id : id,
    ...(typeof r.label === "string" ? { label: r.label } : {}),
    type,
    x1: r.x1 as number,
    y1: r.y1 as number,
    x2: r.x2 as number,
    y2: r.y2 as number,
    mode: r.mode === "force" || r.mode === "ito-matsui" ? r.mode : preset.mode,
    force: num(r.force, preset.force, (n) => n >= 0),
    diameter: num(r.diameter, preset.diameter, (n) => n > 0),
    spacing: num(r.spacing, preset.spacing, (n) => n > 0),
    shearCapacity: num(r.shearCapacity, 0, (n) => n >= 0),
    momentCapacity: num(r.momentCapacity, 0, (n) => n >= 0),
    angle: num(r.angle, 0, (n) => Math.abs(n) < 90),
    // Absent stays absent (force at the angle, as before the option).
    ...(PILE_DIRECTIONS.includes(r.direction as PileForceDirection) ? { direction: r.direction as PileForceDirection } : {}),
    application: r.application === "active" || r.application === "passive" ? r.application : preset.application,
  };
}
