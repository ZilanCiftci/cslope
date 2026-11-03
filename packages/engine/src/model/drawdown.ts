/**
 * Rapid drawdown by the three-stage procedure of Duncan, Wright & Wong
 * (1990; Duncan, Wright & Brandon 2014, ch. 9):
 *
 * 1. Before drawdown, with drained strengths and the pore pressures (and
 *    the reservoir on the slope) of the full reservoir: the consolidation
 *    stresses σ′fc and τfc on each slice base.
 * 2. After drawdown, the materials with a drawdown (R) envelope take the
 *    undrained strength τff at their consolidation stresses, interpolated
 *    by the consolidation ratio Kc between isotropic consolidation (Kc = 1,
 *    from the R envelope) and consolidation at failure (Kc = Kf, the
 *    effective envelope).
 * 3. Where the drained strength with the pore pressures after drawdown is
 *    lower than τff (dilating soil), the drained strength is used.
 *
 * The slope's own water is the state after drawdown; `Slope.drawdownBefore`
 * is the same model with the water before it.
 */

import type { Slice } from "../types/index";
import { designStrength, resolveStrength } from "../types/index";
import type { Slope, SearchPlane } from "./slope";
import { getSlices } from "./slices";
import { analyseBishop, analyseJanbu, analyseMorgensternPrice, solvedEffectiveNormals } from "./solvers";

/**
 * The drawdown (R) envelope of a slice's base material and its
 * characteristic drained strength there (c′ as resolved at the base, so a
 * cohesion varying with depth counts), if it has an envelope.
 */
function rEnvelope(s: Slice): { cohesion: number; frictionAngle: number; c: number; phi: number } | null {
  const m = s.strengthModel ?? s.baseMaterial?.model;
  if (m?.kind !== "mohr-coulomb" || !m.drawdownStrength) return null;
  const st = resolveStrength(m, { yBottom: s.yBottom, x: s.x, yGround: s.yTop, alpha: s.alpha });
  return { ...m.drawdownStrength, c: st.cohesion, phi: st.frictionAngle };
}

/** F and the effective normal forces of the slices by the slope's method; null without a converged solution. */
function solve(slope: Slope, slices: Slice[]): { fos: number; normals: number[] } | null {
  let fos: number | null;
  let converged: boolean;
  let lff: [number, number, number, number][] | null = null;
  if (slope.method === "Bishop") [fos, , , converged] = analyseBishop(slope, slices);
  else if (slope.method === "Janbu") [fos, , , converged] = analyseJanbu(slope, slices);
  else {
    const r = analyseMorgensternPrice(slope, slices);
    fos = r[0];
    lff = r[1] ?? null;
    converged = r[4] === true || r[6] === true;
  }
  if (fos == null || !(fos > 0) || !converged) return null;
  const normals = solvedEffectiveNormals(slope, slices, fos, lff);
  return normals ? { fos, normals } : null;
}

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
  const phi = (phiDeg * Math.PI) / 180, phiR = (phiRDeg * Math.PI) / 180;
  const sn = Math.max(0, sfc);
  // Kc = 1: the R envelope expressed against σ′fc
  const d1 = (cR * Math.cos(phiR)) / (1 - Math.sin(phiR));
  const tan1 = (Math.sin(phiR) * Math.cos(phiR)) / (1 - Math.sin(phiR));
  const tau1 = d1 + sn * tan1;
  // Kc = Kf: the effective envelope
  const tauKf = c + sn * Math.tan(phi);
  const s1 = sfc + (tfc * (Math.sin(phi) + 1)) / Math.cos(phi);
  const s3 = sfc + (tfc * (Math.sin(phi) - 1)) / Math.cos(phi);
  const cc = c * Math.cos(phi);
  const kf = sfc > cc ? ((sfc + cc) * (1 + Math.sin(phi))) / ((sfc - cc) * (1 - Math.sin(phi))) : Infinity;
  if (!(s3 > 0) || !Number.isFinite(kf)) return Math.min(tau1, tauKf);
  const kc = Math.min(Math.max(s1 / s3, 1), kf);
  return ((kf - kc) * tau1 + (kc - 1) * tauKf) / (kf - 1);
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
  const before = slope.drawdownBefore;
  if (!before || !slices.some((s) => rEnvelope(s) || s.baseMaterial?.model.kind === "shansep")) return true;
  const sb = getSlices(before, plane.lc[0], plane.rc[0], plane.cx, plane.cy, plane.radius, plane.points);
  if (sb.length === 0) return false;
  const factors = slope.partialFactors;
  const at = (x: number) => {
    let j = 0;
    while (j < sb.length - 1 && sb[j].xRight < x) j++;
    return j;
  };
  // undrained SHANSEP: the effective vertical stress before drawdown
  for (const s of slices) {
    const m = s.baseMaterial?.model;
    if (m?.kind !== "shansep") continue;
    const b = sb[at(s.x)];
    const sv = (b.weight + b.udl + b.ll + (b.waterLoad ?? 0)) / b.width - b.U;
    const st = resolveStrength(m, { yBottom: s.yBottom, x: s.x, yGround: s.yTop, alpha: s.alpha, effectiveVerticalStress: sv });
    const d = designStrength("shansep", st, factors);
    s.cohesion = d.cohesion;
    s.cohesionUndrained = d.cohesionUndrained;
  }
  if (!slices.some((s) => rEnvelope(s))) return true;
  const stage1 = solve(before, sb);
  if (!stage1) return false;
  // the design drained strength of each base, for stage 3
  const drainedOf = new Map<Slice, { c: number; tanPhi: number }>();
  const tff = new Map<Slice, number>();
  for (const s of slices) {
    const r = rEnvelope(s);
    if (!r) continue;
    const j = at(s.x);
    const b = sb[j];
    const sfc = stage1.normals[j] / b.baseLength;
    const tfc = (b.cohesion + Math.max(0, sfc) * Math.tan(b.phi)) / stage1.fos;
    drainedOf.set(s, { c: s.cohesion, tanPhi: Math.tan(s.phi) });
    const t = drawdownStrength(sfc, tfc, r.c, r.phi, r.cohesion, r.frictionAngle) / (factors?.cu ?? 1);
    tff.set(s, t);
    s.cohesion = s.cohesionUndrained = t;
    s.phi = 0;
    s.frictionAngle = 0;
  }
  // stage 3: the drained strength after drawdown where it is lower
  const stage2 = solve(slope, slices);
  if (!stage2) return true;
  slices.forEach((s, i) => {
    const t = tff.get(s);
    const dr = drainedOf.get(s);
    if (t === undefined || !dr) return;
    const sn = stage2.normals[i] / s.baseLength;
    if (dr.c + Math.max(0, sn) * dr.tanPhi < t) {
      s.cohesion = s.cohesionUndrained = dr.c;
      s.phi = Math.atan(dr.tanPhi);
      s.frictionAngle = (s.phi * 180) / Math.PI;
    }
  });
  return true;
}
