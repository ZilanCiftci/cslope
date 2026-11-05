/**
 * The selection and the locks of the edit canvas: which object (and point)
 * is selected, what it is called, whether it is locked, and the rules for
 * changing locks. Pure functions over the store's state.
 */

import { isClosedBoundary } from "../utils/regions";
import { customPlanesInResultOrder } from "./helpers";
import type {
  AppState,
  CanvasObjectRef,
  CanvasObjectType,
  CanvasPointKey,
  CanvasSelection,
  LockGroup,
  ModelLocks,
} from "./types";

/** The model fields the selection and lock rules read. */
export type CanvasObjectsState = Pick<
  AppState,
  | "coordinates"
  | "materialBoundaries"
  | "piezometricLine"
  | "udls"
  | "lineLoads"
  | "reinforcements"
  | "piles"
  | "customSearchPlanes"
  | "analysisLimits"
> & Partial<Pick<AppState, "backgrounds">>;

/** The lock group an object type belongs to. */
export const LOCK_GROUP_OF: Record<CanvasObjectType, LockGroup> = {
  exterior: "exterior",
  boundary: "boundaries",
  waterLine: "waterLines",
  udl: "loads",
  lineLoad: "loads",
  reinforcement: "reinforcement",
  pile: "reinforcement",
  searchLimits: "searchLimits",
  customPlane: "customSurfaces",
  background: "backgrounds",
};

/** The "Lock all" menu's groups with their labels, in menu order. */
export const LOCK_GROUPS: { group: LockGroup; label: string }[] = [
  { group: "exterior", label: "Exterior boundary" },
  { group: "boundaries", label: "Material boundaries" },
  { group: "waterLines", label: "Water lines" },
  { group: "loads", label: "Loads" },
  { group: "reinforcement", label: "Reinforcement" },
  { group: "searchLimits", label: "Search limits" },
  { group: "customSurfaces", label: "Custom surfaces" },
  { group: "backgrounds", label: "Drawings" },
];

export function sameObject(a: CanvasObjectRef | null | undefined, b: CanvasObjectRef | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  return !("id" in a) || a.id === (b as { id: string }).id;
}

export function sameSelection(a: CanvasSelection | null, b: CanvasSelection | null): boolean {
  if (!a || !b) return a === b;
  return sameObject(a.object, b.object) && a.point === b.point;
}

/** The id of an object (null for the exterior and the search limits). */
function idOf(ref: CanvasObjectRef): string | null {
  return "id" in ref ? ref.id : null;
}

export function isObjectLocked(locks: ModelLocks, ref: CanvasObjectRef): boolean {
  const group = LOCK_GROUP_OF[ref.type];
  const value = locks[group];
  if (value === true) return true;
  const id = idOf(ref);
  return Array.isArray(value) && id !== null && value.includes(id);
}

/** True when the selection's object is locked. */
export function isSelectionLocked(locks: ModelLocks, sel: CanvasSelection | null): boolean {
  return !!sel && isObjectLocked(locks, sel.object);
}

/** Locks without empty lists, and without the import flag once the geometry is unlocked. */
function tidyLocks(locks: ModelLocks): ModelLocks {
  const out: ModelLocks = {};
  if (locks.exterior) out.exterior = true;
  if (locks.searchLimits) out.searchLimits = true;
  for (const key of ["boundaries", "waterLines", "loads", "reinforcement", "customSurfaces", "backgrounds"] as const) {
    const ids = locks[key];
    if (ids && ids.length > 0) out[key] = [...new Set(ids)];
  }
  if (locks.fromImport && (out.exterior || out.boundaries)) out.fromImport = true;
  return out;
}

/** The locks with one object locked or unlocked. */
export function withObjectLocked(locks: ModelLocks, ref: CanvasObjectRef, locked: boolean): ModelLocks {
  const group = LOCK_GROUP_OF[ref.type];
  const next: ModelLocks = { ...locks };
  if (group === "exterior" || group === "searchLimits") {
    if (locked) next[group] = true;
    else delete next[group];
  } else {
    const id = idOf(ref);
    if (id === null) return locks;
    const ids = (locks[group] ?? []).filter((x) => x !== id);
    next[group] = locked ? [...ids, id] : ids;
  }
  return tidyLocks(next);
}

/** The ids of every object of a group in the model (empty for the singletons). */
export function groupIds(state: CanvasObjectsState, group: LockGroup): string[] {
  switch (group) {
    case "boundaries":
      return state.materialBoundaries.map((b) => b.id);
    case "waterLines":
      return state.piezometricLine.lines.map((l) => l.id);
    case "loads":
      return [...state.udls.map((u) => u.id), ...state.lineLoads.map((l) => l.id)];
    case "reinforcement":
      return [...state.reinforcements.map((r) => r.id), ...state.piles.map((p) => p.id)];
    case "customSurfaces":
      return state.customSearchPlanes.map((p) => p.id);
    case "backgrounds":
      return (state.backgrounds ?? []).map((b) => b.id);
    default:
      return [];
  }
}

/** The locks with every object of a group locked. */
export function withGroupLocked(locks: ModelLocks, state: CanvasObjectsState, group: LockGroup): ModelLocks {
  if (group === "exterior" || group === "searchLimits") return tidyLocks({ ...locks, [group]: true });
  return tidyLocks({ ...locks, [group]: [...(locks[group] ?? []), ...groupIds(state, group)] });
}

/** True when the group has something to lock that is not locked yet. */
export function groupHasUnlocked(locks: ModelLocks, state: CanvasObjectsState, group: LockGroup): boolean {
  if (group === "exterior") return !locks.exterior && state.coordinates.length > 0;
  if (group === "searchLimits") return !locks.searchLimits && state.analysisLimits.enabled;
  const locked = new Set(locks[group] ?? []);
  return groupIds(state, group).some((id) => !locked.has(id));
}

/** True when anything is locked. */
export function hasLocks(locks: ModelLocks): boolean {
  return Object.keys(tidyLocks(locks)).some((k) => k !== "fromImport");
}

/** The locks of a freshly imported model: its exterior and material boundaries. */
export function importedGeometryLocks(boundaryIds: string[]): ModelLocks {
  return tidyLocks({ exterior: true, boundaries: boundaryIds, fromImport: true });
}

/** The locks with the exterior and the material boundaries unlocked. */
export function withoutGeometryLocks(locks: ModelLocks): ModelLocks {
  const next = { ...locks };
  delete next.exterior;
  delete next.boundaries;
  delete next.fromImport;
  return tidyLocks(next);
}

/**
 * Locks read from a file: only the known keys with values of the right
 * shape; ids of objects the model does not have are dropped when `ids` is
 * given. Undefined when nothing is locked.
 */
export function normalizeLocks(
  raw: unknown,
  ids?: Partial<Record<LockGroup, Set<string>>>,
): ModelLocks | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ModelLocks = {};
  if (r.exterior === true) out.exterior = true;
  if (r.searchLimits === true) out.searchLimits = true;
  for (const key of ["boundaries", "waterLines", "loads", "reinforcement", "customSurfaces", "backgrounds"] as const) {
    const v = r[key];
    if (!Array.isArray(v)) continue;
    const known = ids?.[key];
    const list = v.filter((x): x is string => typeof x === "string" && (!known || known.has(x)));
    if (list.length > 0) out[key] = list;
  }
  if (r.fromImport === true) out.fromImport = true;
  const tidy = tidyLocks(out);
  return Object.keys(tidy).length > 0 ? tidy : undefined;
}

/** Locks of a copied model, its ids mapped to the copy's. */
export function remapLocks(locks: ModelLocks | undefined, idMap: Map<string, string>): ModelLocks | undefined {
  if (!locks) return undefined;
  const out: ModelLocks = { ...locks };
  for (const key of ["boundaries", "waterLines", "loads", "reinforcement", "customSurfaces", "backgrounds"] as const) {
    const ids = locks[key];
    if (ids) out[key] = ids.map((id) => idMap.get(id) ?? id);
  }
  return out;
}

/** True when the object is in the model. */
export function objectExists(state: CanvasObjectsState, ref: CanvasObjectRef): boolean {
  switch (ref.type) {
    case "exterior":
      return state.coordinates.length > 0;
    case "searchLimits":
      return state.analysisLimits.enabled;
    case "boundary":
      return state.materialBoundaries.some((b) => b.id === ref.id);
    case "waterLine":
      return state.piezometricLine.lines.some((l) => l.id === ref.id);
    case "udl":
      return state.udls.some((u) => u.id === ref.id);
    case "lineLoad":
      return state.lineLoads.some((l) => l.id === ref.id);
    case "reinforcement":
      return state.reinforcements.some((r) => r.id === ref.id);
    case "pile":
      return state.piles.some((p) => p.id === ref.id);
    case "customPlane":
      return state.customSearchPlanes.some((p) => p.id === ref.id);
    case "background":
      return (state.backgrounds ?? []).some((b) => b.id === ref.id);
  }
}

/** The vertices of an object that has vertices (exterior, boundary, water line, custom polyline). */
export function objectVertices(state: CanvasObjectsState, ref: CanvasObjectRef): [number, number][] | null {
  switch (ref.type) {
    case "exterior":
      return state.coordinates;
    case "boundary":
      return state.materialBoundaries.find((b) => b.id === ref.id)?.coordinates ?? null;
    case "waterLine":
      return state.piezometricLine.lines.find((l) => l.id === ref.id)?.coordinates ?? null;
    case "customPlane":
      return state.customSearchPlanes.find((p) => p.id === ref.id)?.points ?? null;
    default:
      return null;
  }
}

/** True when `point` names a handle the object has. */
export function pointExists(state: CanvasObjectsState, ref: CanvasObjectRef, point: CanvasPointKey): boolean {
  if (typeof point === "number") {
    const v = objectVertices(state, ref);
    return !!v && point >= 0 && point < v.length;
  }
  switch (ref.type) {
    case "udl":
      return point === "x1" || point === "x2";
    case "lineLoad":
      return point === "x";
    case "reinforcement":
    case "pile":
      return point === "end1" || point === "end2";
    case "searchLimits":
      return point === "entryLeftX" || point === "entryRightX" || point === "exitLeftX" || point === "exitRightX";
    case "customPlane": {
      const plane = state.customSearchPlanes.find((p) => p.id === ref.id);
      return !!plane && !plane.points && (point === "centre" || point === "rim");
    }
    default:
      return false;
  }
}

/**
 * The selection as it can stand in the model now: null when its object
 * is gone, without its point when the point is gone.
 */
export function validSelection(state: CanvasObjectsState, sel: CanvasSelection | null): CanvasSelection | null {
  if (!sel || !objectExists(state, sel.object)) return null;
  if (sel.point !== null && !pointExists(state, sel.object, sel.point)) return { object: sel.object, point: null };
  return sel;
}

/** What the status bar and the menus call an object ("Water line 1"). */
export function canvasObjectLabel(state: CanvasObjectsState, ref: CanvasObjectRef): string {
  const n = (i: number) => (i >= 0 ? ` ${i + 1}` : "");
  switch (ref.type) {
    case "exterior":
      return "Exterior boundary";
    case "searchLimits":
      return "Search limits";
    case "boundary":
      return `Material boundary${n(state.materialBoundaries.findIndex((b) => b.id === ref.id))}`;
    case "waterLine":
      return `Water line${n(state.piezometricLine.lines.findIndex((l) => l.id === ref.id))}`;
    case "udl":
      return `Distributed load${n(state.udls.findIndex((u) => u.id === ref.id))}`;
    case "lineLoad":
      return `Line load${n(state.lineLoads.findIndex((l) => l.id === ref.id))}`;
    case "reinforcement":
      return `Reinforcement${n(state.reinforcements.findIndex((r) => r.id === ref.id))}`;
    case "pile":
      return `Pile${n(state.piles.findIndex((p) => p.id === ref.id))}`;
    case "customPlane": {
      // Numbered as the result numbers the custom surfaces.
      const order = customPlanesInResultOrder(state.customSearchPlanes);
      const plane = state.customSearchPlanes.find((p) => p.id === ref.id);
      const kind = plane?.points ? "Custom surface" : "Custom circle";
      return `${kind}${n(order.findIndex((p) => p.id === ref.id))}`;
    }
    case "background": {
      const list = state.backgrounds ?? [];
      const b = list.find((v) => v.id === ref.id);
      return b?.name ? `Drawing ${b.name}` : `Drawing${n(list.findIndex((v) => v.id === ref.id))}`;
    }
  }
}

const HANDLE_LABELS: Record<Exclude<CanvasPointKey, number>, string> = {
  x1: "left end",
  x2: "right end",
  x: "point",
  end1: "end 1",
  end2: "end 2",
  entryLeftX: "entry, left",
  entryRightX: "entry, right",
  exitLeftX: "exit, left",
  exitRightX: "exit, right",
  centre: "center",
  rim: "radius",
};

/** "point 3", "left end", "center". */
export function canvasPointLabel(point: CanvasPointKey): string {
  return typeof point === "number" ? `point ${point + 1}` : HANDLE_LABELS[point];
}

/** True when the point can be deleted (as the context menu allows): a vertex above the minimum count. */
export function canDeletePoint(state: CanvasObjectsState, ref: CanvasObjectRef, point: CanvasPointKey | null): boolean {
  if (typeof point !== "number") return false;
  const v = objectVertices(state, ref);
  if (!v || point < 0 || point >= v.length) return false;
  switch (ref.type) {
    case "exterior":
      return v.length > 3;
    case "boundary":
      // An open line keeps two points; a closed one a triangle.
      return v.length > (isClosedBoundary(v) ? 4 : 2);
    case "waterLine":
    case "customPlane":
      return v.length > 2;
    default:
      return false;
  }
}

/**
 * The next selection of a click at the same spot as the previous one,
 * cycling through `candidates` (the objects under the pointer, topmost
 * first) after the selected one.
 */
export function nextCycleIndex(candidates: CanvasObjectRef[], current: CanvasObjectRef | null): number {
  const at = current ? candidates.findIndex((c) => sameObject(c, current)) : -1;
  return at < 0 ? 0 : (at + 1) % candidates.length;
}
