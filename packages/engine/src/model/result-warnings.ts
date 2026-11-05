/**
 * Warnings on an analysed slope: input the regions do not use as drawn,
 * and conditions on the critical surface under which the factor of safety
 * of a method of slices is open to question.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { AnalysisWarning } from "../types/analysis";
import type { Slice } from "../types/geometry";
import { type SearchPlane, type Slope as TsSlope, Slope } from "./slope";
import { wasm } from "../facade/internal";
import { materialWire } from "../facade/materials";
import { Material } from "../types/material";
import { facadeSlope, h } from "../facade/wire";
import { encodeSlices } from "../facade/slice-codec";

/**
 * m_α below which a slice is reported. Whitman and Bailey (1967) found
 * that Bishop's method can give unrealistic normal forces, and a factor of
 * safety too high, where m_α = cos α (1 + tan α tan φ / F) on a slice is
 * less than about 0.2; Duncan and Wright (2014, ch. 6) recommend checking
 * m_α and treating such surfaces with caution. The same term is in the
 * normal force of every method here (Janbu, Morgenstern–Price).
 */
export const M_ALPHA_WARNING_LIMIT = 0.2;

/**
 * Entry inclination (degrees) from which a Morgenstern–Price or Spencer
 * surface without complete equilibrium is put down to its steep entry.
 */
export const STEEP_ENTRY_LIMIT = 70;

/** A partial plane as the engine reads a plane. */
function asPlane(p: Partial<SearchPlane>): SearchPlane {
  return { lc: [0, 0], rc: [0, 0], cx: 0, cy: 0, radius: 0, fos: null, slices: null, ...p } as SearchPlane;
}

/**
 * The engine's slope of `slope`; an object with only what analysisWarnings
 * reads (TypeScript reads any object with those fields) is set up as a
 * slope of the engine with them.
 */
function engineSlope(slope: TsSlope): Slope {
  if (slope instanceof Slope) return slope;
  const s = slope as unknown as { method?: string; janbuCorrection?: boolean; search?: Partial<SearchPlane>[] };
  const own = new Slope();
  own.updateAnalysisOptions({ method: s.method as never, janbuCorrection: s.janbuCorrection });
  own.setSearchResults((s.search ?? []).map(asPlane));
  return own;
}

/**
 * Inclination of a surface at its entry (degrees, positive descending
 * into the slope): at the crack bottom when cut, on a circle from the
 * centre, on a polyline its first segment.
 */
export function entryInclination(p: SearchPlane): number {
  return wasm().entry_inclination(asPlane({ ...p, slices: null }));
}

/**
 * Morgenstern–Price or Spencer found no complete equilibrium (no solution,
 * or only the closest pair) on surfaces whose entry is steeper than
 * STEEP_ENTRY_LIMIT: the cohesion along a nearly vertical base can only
 * hold the slice with tension at its base (a negative normal force), and
 * the moment and force factors then need not meet. A tension crack at a
 * limiting base inclination cuts that part off. Null when this does not
 * apply (another method, a crack angle already set, no steep entry).
 *
 * `planes` are the surfaces concerned: the critical one when it is a
 * closest pair, or those without a factor when no surface has one.
 */
export function steepEntryMessage(slope: TsSlope, planes: readonly SearchPlane[]): string | null {
  return (wasm().steep_entry_message(h(slope), facadeSlope(slope)._planesOut(planes)) as string | undefined) ?? null;
}

/**
 * The critical surface enters steeper than STEEP_ENTRY_LIMIT and slices on
 * its descending (entry) part have N′ < 0 or a low m_α: every method then
 * relies on tension at the base there, and Bishop and Janbu still give a
 * factor (on a φ = 0 slope with a vertical upper face 0.460 with Bishop,
 * against 0.426 with the steep part cut off at 70°; with c′ = 15 kPa and
 * φ′ = 25° 2.211 against 2.227). Null when it does not apply.
 */
export function steepEntryTensionMessage(slope: TsSlope, plane: SearchPlane, n: number): string | null {
  return (wasm().steep_entry_tension_message(h(slope), { ...plane, slices: null }, n) as string | undefined) ?? null;
}

/** Warning text for a dangling boundary, numbered from 1 as the user knows it. */
export function danglingBoundaryMessage(n: number): string {
  return wasm().dangling_boundary_message(n);
}

export function analysisWarnings(slope: TsSlope, effectiveNormals?: readonly number[] | null): AnalysisWarning[] {
  const s = engineSlope(slope);
  return wasm().analysis_warnings(s._h, effectiveNormals ?? null) as AnalysisWarning[];
}

/**
 * The depth a critical surface's base must on average stay within to count
 * as shallow (m): 1 m, or a tenth of the ground relief around the surface
 * when larger.
 */
export function shallowDepthLimit(localRelief: number): number {
  return wasm().shallow_depth_limit(localRelief);
}

/**
 * The warning text when the critical surface, of these slices, is a
 * shallow slide mostly in cohesionless soil (see analysisWarnings), else
 * null. Its depth is the base's mean depth below the ground, weighted by
 * base length, so that a long thin surface counts with a deeper part.
 */
export function shallowCohesionlessMessage(slices: readonly Slice[], fos: number, relief: number): string | null {
  // the slices' materials numbered by object
  const materials: Material[] = [];
  const wire = encodeSlices(slices as never, (m) => {
    if (!(m instanceof Material)) return null;
    const i = materials.indexOf(m);
    return i >= 0 ? i : materials.push(m) - 1;
  });
  return (wasm().shallow_cohesionless_message(wire, materials.map(materialWire), fos, relief) as string | undefined) ?? null;
}
