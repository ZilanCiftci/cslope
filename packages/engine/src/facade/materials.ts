/**
 * Material identity across the boundary (ARCHITECTURE.md §3.3; not a shim).
 * Every facade `Material` has a key; the engine stores the key with the
 * table entry of the material, and gives it back with the entry, so that
 * the same JavaScript object comes back (`slices[0].baseMaterial === clay`).
 * A material the engine made (buildSlope) gets an object, and a key, the
 * first time it is handed out.
 */
import type { MaterialModel } from "../types/material-models";
import { Material } from "../types/material";

const byKey = new Map<number, WeakRef<Material>>();
const forget = new FinalizationRegistry<number>((key) => {
  if (!byKey.get(key)?.deref()) byKey.delete(key);
});
let nextKey = 1;

/** A new key for `m` (its constructor calls this). */
export function registerMaterial(m: Material): number {
  const key = nextKey++;
  byKey.set(key, new WeakRef(m));
  forget.register(m, key);
  return key;
}

/** The live material object of a key. */
export function materialByKey(key: number): Material | undefined {
  return byKey.get(key)?.deref();
}

/** A material as the engine reads it. */
export interface MaterialWire {
  key: number;
  name: string;
  color: string;
  model: MaterialModel;
}

export function materialWire(m: Material): MaterialWire {
  return { key: m._key, name: m.name, color: m.color, model: m.model };
}

/** A table entry of the engine. */
export interface MaterialEntry {
  key: number | null;
  name: string;
  color: string;
  model: MaterialModel;
}

/** The object of an entry the engine made (no JavaScript object yet). */
export function materialFromEngine(e: Omit<MaterialEntry, "key">): Material {
  const m = Object.create(Material.prototype) as { -readonly [K in keyof Material]: Material[K] };
  m.name = e.name;
  m.color = e.color;
  m.model = e.model;
  Object.defineProperty(m, "_key", { value: registerMaterial(m as Material), enumerable: false });
  return m as Material;
}
