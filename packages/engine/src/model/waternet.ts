/**
 * Pore pressure from head lines and reference lines (a "waternet").
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/model/waternet.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import { engineEpoch } from "../engine";
import { wasm } from "../facade/internal";

type Pt = [number, number];

export interface Waternet {
  /** Head lines by id: the elevation of the head along x. */
  headLines: { id: string; points: Pt[] }[];
  /** Reference lines: where the head of their top and bottom head lines applies. */
  referenceLines: { points: Pt[]; topHeadLineId?: string; bottomHeadLineId?: string }[];
  /** The head line that is the phreatic line (above all reference lines). */
  phreaticLineId?: string;
}

/**
 * The engine's copy of each waternet, by object, as TypeScript's WeakMap
 * cache of the compiled head lines (and like it, not renewed when the
 * lines are changed afterwards). Freed when the waternet object is
 * collected.
 */
const handles = new WeakMap<Waternet, { handle: number; epoch: number }>();
const finalizer = new FinalizationRegistry<{ handle: number; epoch: number }>((h) => {
  if (h.epoch === engineEpoch()) wasm().waternet_free(h.handle);
});

function handleOf(wn: Waternet): number {
  const h = handles.get(wn);
  if (h && h.epoch === engineEpoch()) return h.handle;
  const entry = { handle: wasm().waternet_new(wn), epoch: engineEpoch() };
  handles.set(wn, entry);
  finalizer.register(wn, entry);
  return entry.handle;
}

/**
 * The pore pressure (kPa, ≥ 0) at (x, z): γw·(h − z), with the unit weight of
 * water `waterUnitWeight` (kN/m³; `WATER_UNIT_WEIGHT` when not given).
 */
export function waternetPorePressure(wn: Waternet, x: number, z: number, waterUnitWeight?: number): number {
  return wasm().waternet_pore_pressure_at(handleOf(wn), x, z, waterUnitWeight);
}
