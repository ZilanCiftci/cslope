/**
 * Rapid drawdown by the three-stage procedure of Duncan, Wright & Wong
 * (1990; Duncan, Wright & Brandon 2014, ch. 9). The slope's own water is
 * the state after drawdown; `Slope.drawdownBefore` is the same model with
 * the water before it.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/model/drawdown.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import type { Slice } from "../types/geometry";
import type { SearchPlane, Slope } from "./slope";
import { wasm } from "../facade/internal";
import { h, onSlices } from "../facade/wire";

/**
 * Undrained strength after drawdown at the consolidation stresses σ′fc,
 * τfc on the base (Duncan, Wright & Wong 1990): c′, φ′ the effective
 * envelope, (cR, φR) the R envelope. Kc is the principal stress ratio at
 * consolidation, Kf = (σ′fc + c′cos φ′)(1 + sin φ′) / ((σ′fc − c′cos φ′)
 * (1 − sin φ′)) the ratio at failure on the effective envelope; τff is
 * interpolated by Kc between the envelope at Kc = 1 (from the R envelope)
 * and at Kc = Kf (the effective envelope).
 */
export function drawdownStrength(sfc: number, tfc: number, c: number, phiDeg: number, cR: number, phiRDeg: number): number {
  return wasm().drawdown_strength(sfc, tfc, c, phiDeg, cR, phiRDeg);
}

/**
 * Stages 1–3 on the slices of a surface after drawdown: sets the strength
 * of the bases in materials with a drawdown envelope (undrained, or
 * drained where lower), as design values with the partial factors (γcu on
 * the undrained strength). A SHANSEP base keeps the strength of its
 * effective stress before drawdown (it does not drain). Returns false
 * when the stage before drawdown has no solution (the surface then has no
 * factor of safety).
 */
export function applyRapidDrawdown(slope: Slope, slices: Slice[], plane: SearchPlane): boolean {
  const p = { ...plane, slices: null };
  return onSlices(slope, slices, (w) => wasm().apply_rapid_drawdown_to(h(slope), w, p));
}
