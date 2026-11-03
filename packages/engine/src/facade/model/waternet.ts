/** Facade shim of model/waternet.ts (see facade/internal.ts). */
import { engineEpoch } from "../../engine";
import { wasm } from "../internal";
import type { Waternet } from "../../model/waternet";

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

export function waternetPorePressure(wn: Waternet, x: number, z: number): number {
  return wasm().waternet_pore_pressure_at(handleOf(wn), x, z);
}
