import type { Reinforcement } from "@cslope/engine";
import type { ModelOrientation, ReinforcementRow, ReinforcementType } from "../store/types";
import { surfaceYAtX } from "../features/view/surface";

export const REINFORCEMENT_TYPE_LABELS: Record<ReinforcementType, string> = {
  anchor: "Anchor (end-anchored)",
  tieback: "Grouted tieback",
  nail: "Soil nail",
  geosynthetic: "Geosynthetic",
};

/**
 * Defaults per type, following the Slide2 conventions: rigid supports act
 * along their axis, geosynthetics along the slip surface; tiebacks and
 * anchors are pre-tensioned (active), nails mobilise with the soil
 * (passive).
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
    pullout: pick(r.pullout, ["none", "bond", "interface"] as const, preset.pullout),
    bondStrength: num(r.bondStrength, preset.bondStrength),
    bondedLength: num(r.bondedLength, preset.bondedLength),
    adhesion: num(r.adhesion, preset.adhesion),
    interfaceFriction: finite(r.interfaceFriction) && (r.interfaceFriction as number) >= 0 && (r.interfaceFriction as number) < 90
      ? (r.interfaceFriction as number)
      : preset.interfaceFriction,
    end1Capacity: num(r.end1Capacity, preset.end1Capacity),
    end2Capacity: num(r.end2Capacity, preset.end2Capacity),
    direction: pick(r.direction, ["axial", "tangent", "bisector"] as const, preset.direction),
    application: pick(r.application, ["active", "passive"] as const, preset.application),
  };
}
