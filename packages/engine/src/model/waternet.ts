/**
 * Pore pressure from head lines and reference lines (a "waternet"). At a
 * point between two reference lines the head varies linearly with the
 * elevation from the bottom head line of the upper reference line to the
 * top head line of the lower one; below the lowest reference line it is
 * that line's bottom head line. Above the uppermost reference line it
 * varies linearly from the top head line of that line to the phreatic
 * level (where the head is the phreatic line's), and above the phreatic
 * level it is the phreatic line's. A reference line without head lines is
 * left out. The pore pressure is γw × (head − z), not negative. This
 * describes, for example, a clay layer between a phreatic level and a
 * confined aquifer with another head.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
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

/** The pore pressure (kPa, ≥ 0) at (x, z). */
export function waternetPorePressure(wn: Waternet, x: number, z: number): number {
  return wasm().waternet_pore_pressure_at(handleOf(wn), x, z);
}
