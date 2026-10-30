/**
 * Upper bound limit analysis by finite elements and conic programming
 * (Sloan & Kleeman 1995, Comput. Methods Appl. Mech. Eng. 127, 293–314;
 * Lyamin & Sloan 2002, IJNAMG 26, 181–216; Makrodimopoulos & Martin 2007,
 * IJNAMG 31(6), 835–865).
 *
 * The velocities vary linearly over three-node triangles whose nodes are not
 * shared, so that every edge can carry a velocity discontinuity. In each
 * element the constant plastic strain rate follows the associated flow rule
 * of the Mohr–Coulomb criterion, in plane strain ε̇x + ε̇y = sin φ z with
 * z ≥ ‖(ε̇x − ε̇y, γ̇xy)‖ (a second-order cone), and dissipates c cos φ z per
 * unit area. Solved exactly by Clarabel, or by HiGHS on the p-sided polygon
 * circumscribing the criterion (Sloan & Kleeman 1995: ε̇ = Σ λₖ ∂Fₖ/∂σ,
 * λₖ ≥ 0, dissipating 2c cos φ Σ λₖ), see conic.ts. Along a discontinuity the tangential jump is
 * Δu_t = u⁺ − u⁻ and the normal jump Δu_n = (u⁺ + u⁻) tan φ (u⁺, u⁻ ≥ 0, at
 * both ends of the edge), dissipating c (u⁺ + u⁻) per unit length. The
 * circumscribed polygon is stronger than the soil, so the power the loads
 * do on any such velocity field over the dissipation bounds the load factor
 * from above for the mesh.
 *
 * Pore pressures: the power of the total stresses is that of the effective
 * stresses less ∫ p ε̇_v dV and ∫ p Δu_n dS on the discontinuities, so the
 * pore pressure does that power as a load (Kim, Salgado & Yu 1999, J.
 * Geotech. Geoenviron. Eng. 125(9), 811–820), besides the weight at the
 * saturated unit weight and the water ponded on the ground.
 *
 * The linear program minimises the dissipation with the power of all loads
 * (weight, pore pressure, surface loads) equal to one: the minimum is an
 * upper bound λ on the load factor. The factor of safety on strength is
 * the reduction F at which λ(F) = 1 (as for the lower bound, lower-bound.ts):
 * F = λ(1) when φ = 0 everywhere, otherwise a secant search on log λ
 * against log F from `startF`, and
 * the smallest evaluated F with λ(F) ≤ 1 is the bound (a mechanism fails
 * the slope there).
 *
 * Supports as in the strength reduction model (model.ts): the vertical
 * sides are smooth rollers (no normal velocity), the base is rigid, and
 * the soil may slip along it through a discontinuity of the soil's
 * strength.
 *
 * Implementation choices (not from the literature): p = 24 sides for
 * HiGHS; for Clarabel the velocities scaled so that the load power's
 * largest coefficient is one; the
 * strength of an element at its centroid; a discontinuity between two
 * materials takes the lesser cohesion and friction angle of the two (a
 * slip band in the weaker soil); rigid materials do not deform, and no
 * discontinuity runs between two rigid elements; a combined material (the
 * lesser of the drained and undrained strength) flows on both polygons and
 * its discontinuities on both criteria; with the tension cut-off σ₁′ ≤ 0
 * the elements flow on its circumscribed polygon too and the
 * discontinuities may open without dissipation; the secant search as the
 * lower bound's, mirrored.
 */

import type { Slope } from "../model/slope";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import { buildFeModel, polylineY, type FeModelOptions } from "./model";
import { boundSolver, type HighsModuleOptions } from "./lower-bound";
import { affine, ProgramBuilder, type ConicProgram } from "./conic";
import { meanUnitWeight, porePressureAt, strengthAt, surfaceLineLoads } from "./limit-common";

export interface UpperBoundOptions extends FeModelOptions {
  /** The solver, as the lower bound's (lower-bound.ts): "clarabel" (default) or "highs". */
  boundSolver?: "clarabel" | "highs";
  /** The Clarabel WebAssembly binary, where it cannot be read from beside the module (the app). */
  clarabelWasm?: ArrayBuffer;
  /** Sides of the circumscribed yield polygon (HiGHS); default 24. */
  sides?: number;
  /** Rankine tension cut-off σ₁′ ≤ 0; default false. */
  tensionCutoff?: boolean;
  /** Tolerance on F; default 0.002. */
  fTolerance?: number;
  /** Time limit per linear program (s); default 300. */
  timeLimit?: number;
  /** Time limit of the whole search (s): no linear program starts after it, and the bound stays the best certified so far; default none. */
  totalTimeLimit?: number;
  /** First reduction tried, e.g. the strength reduction factor; default 1. */
  startF?: number;
}

export interface UpperBoundResult {
  /** Upper bound on the factor of safety. */
  factorOfSafety: number;
  /** The load factors λ(F) of the linear programs solved. */
  trials: { F: number; lambda: number; seconds: number }[];
  elements: number;
  variables: number;
  constraints: number;
  warnings: string[];
  /** The mesh and, at the bound, the velocity of each element corner (x, y), scaled to a largest speed of 1: the mechanism. */
  mechanism?: { x: Float64Array; y: Float64Array; el: Int32Array; velocity: Float64Array };
}

interface Highs {
  solve(lp: string, options?: Record<string, unknown>): {
    Status: string;
    ObjectiveValue: number;
    Columns?: Record<string, { Primal: number }>;
  };
}

export interface UbProblem {
  /** The program at a reduction F (conic.ts): minimise the dissipation at unit load power; velocities of corner i in columns 2i, 2i + 1. */
  program(F: number): ConicProgram;
  /** Sides of the yield polygon when the program is solved as an LP by HiGHS. */
  sides: number;
  /**
   * The dissipation of a solution at F per element (the model's), with
   * each discontinuity's shared equally by the elements on its sides (all
   * of it by the element on the base).
   */
  elementDissipation(F: number, solution: Float64Array): Float64Array;
  allUndrained: boolean;
  /** Whether any soil has cohesion. */
  cohesive: boolean;
  elements: number;
  variables: number;
  constraints: number;
  warnings: string[];
  mesh: { x: Float64Array; y: Float64Array; el: Int32Array };
}

/** Assemble the upper bound problem of a slope. */
export function upperBoundProblem(slope: Slope, options: UpperBoundOptions = {}): UbProblem {
  const model = buildFeModel(slope, options);
  const { materials, x, y } = model;
  const ne = model.elementCount;
  const p = options.sides ?? 24;
  const cutoff = options.tensionCutoff ?? false;
  const warnings: string[] = [];
  // (the bars also hold the piles' springs, source −1)
  if (model.bars.source.some((k) => k >= 0)) warnings.push("Reinforcement is not included in the upper bound analysis.");
  if (slope.piles.length > 0) warnings.push("Piles are not included in the upper bound analysis.");
  const el = new Int32Array(3 * ne);
  for (let e = 0; e < ne; e++) for (let k = 0; k < 3; k++) el[3 * e + k] = model.el[6 * e + k];
  const nc = x.length;
  const edgeKey = (a: number, b: number) => (a < b ? a * nc + b : b * nc + a);

  let xLo = Infinity, xHi = -Infinity, yHi = -Infinity;
  for (let k = 0; k < el.length; k++) { const n = el[k]; xLo = Math.min(xLo, x[n]); xHi = Math.max(xHi, x[n]); yHi = Math.max(yHi, y[n]); }
  const surface = slope.surfaceLineXY ?? { x: [xLo, xHi], y: [yHi, yHi] };
  const waterLines = materials.map((m) => slope.getWaterLineForMaterial(m));
  const head = model.seepage?.flow ? model.seepage.head : undefined;

  // Per element: strength at the centroid, mean unit weight, corner pore pressures.
  const eC = new Float64Array(ne), ePhi = new Float64Array(ne), eCu = new Float64Array(ne).fill(Infinity);
  const eGamma = new Float64Array(ne), nU = new Float64Array(3 * ne);
  const rigid = model.elElastic;
  let allUndrained = true;
  for (let e = 0; e < ne; e++) {
    const mi = model.elMaterial[e], m = materials[mi], wl = waterLines[mi];
    const n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
    for (let k = 0; k < 3; k++) nU[3 * e + k] = porePressureAt(head, n[k], wl, x[n[k]], y[n[k]]);
    eGamma[e] = meanUnitWeight(m, wl, !!head, n.map((i) => x[i]), n.map((i) => y[i]), [nU[3 * e], nU[3 * e + 1], nU[3 * e + 2]]);
    if (rigid[e]) continue;
    const st = strengthAt(slope, m, surface, (x[n[0]] + x[n[1]] + x[n[2]]) / 3, (y[n[0]] + y[n[1]] + y[n[2]]) / 3);
    eC[e] = st.c; ePhi[e] = st.phi; eCu[e] = st.cu;
    if (st.phi > 0) allUndrained = false;
  }

  // Edges: interior ones (two elements), base and sides, the ground surface.
  const surfaceSet = new Set<number>();
  for (let s = 0; s < model.surfaceEdges.length; s += 3) surfaceSet.add(edgeKey(model.surfaceEdges[s], model.surfaceEdges[s + 2]));
  const owner = new Map<number, [number, number]>();
  const interior: [number, number, number, number][] = []; // e, k (edge from corner k to k+1), e2, k2
  for (let e = 0; e < ne; e++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(el[3 * e + k], el[3 * e + ((k + 1) % 3)]);
      const o = owner.get(key);
      if (o) { interior.push([e, k, o[0], o[1]]); owner.delete(key); } else owner.set(key, [e, k]);
    }
  }
  const lineQ = surfaceLineLoads(slope, model, edgeKey, warnings);
  const loadFactor = slope.partialFactors?.variableLoad ?? 1;

  // Columns: the velocities u, v of each element corner (free), first, so
  // that corner i's are columns 2i and 2i + 1.
  const vu = (e: number, k: number) => 2 * (3 * e + k), vv = (e: number, k: number) => 2 * (3 * e + k) + 1;

  // The power of the loads (F-independent), as coefficients per velocity column.
  const power = new Map<number, number>();
  const addP = (j: number, a: number) => { if (a !== 0) power.set(j, (power.get(j) ?? 0) + a); };
  const geom = (e: number) => {
    const n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
    const b = [y[n[1]] - y[n[2]], y[n[2]] - y[n[0]], y[n[0]] - y[n[1]]];
    const c = [x[n[2]] - x[n[1]], x[n[0]] - x[n[2]], x[n[1]] - x[n[0]]];
    return { n, b, c, area2: b[0] * c[1] - b[1] * c[0] };
  };
  let size = 0;
  for (let e = 0; e < ne; e++) {
    const { b, c, area2 } = geom(e);
    size += Math.sqrt(Math.abs(area2) / 2) / ne;
    const pm = (nU[3 * e] + nU[3 * e + 1] + nU[3 * e + 2]) / 3;
    for (let k = 0; k < 3; k++) {
      // weight: −γ A v̄; pore pressure: ∫ p ε̇_v dA = p̄ (Σ b u + c v)/2
      addP(vv(e, k), (-eGamma[e] * area2) / 6 + (pm * c[k]) / 2);
      addP(vu(e, k), (pm * b[k]) / 2);
    }
  }
  // ∫ p Δu_n over an edge with p and Δu_n linear: L/6 (2 p_a d_a + p_a d_b + p_b d_a + 2 p_b d_b)
  const pairWeights = (L: number, pa: number, pb: number) => [(L / 6) * (2 * pa + pb), (L / 6) * (pa + 2 * pb)];

  // The discontinuities: per end, the tangential and normal jump as terms on
  // the velocity columns, and the strength (the dilation tan φ_F and the
  // dissipation c/F depend on F, so the rows are made per F).
  interface DiscEnd { jt: [number, number][]; jn: [number, number][]; tie: boolean; c: number; phi: number; cu: number; L: number; e: number; e2: number | null }
  const ends: DiscEnd[] = [];
  const disc = (
    e: number, k: number, e2: number | null, k2: number | null,
    c: number, phi: number, cu: number, tie: boolean, pSide: number = e,
  ) => {
    const a = el[3 * e + k], b = el[3 * e + ((k + 1) % 3)];
    const L = Math.hypot(x[b] - x[a], y[b] - y[a]);
    const sx = (x[b] - x[a]) / L, sy = (y[b] - y[a]) / L;
    const nx = sy, ny = -sx; // outward of e (counter-clockwise elements)
    // pore pressure on the discontinuity: that of the side whose material it lies in
    const corner = (node: number) => { for (let q = 0; q < 3; q++) if (el[3 * pSide + q] === node) return 3 * pSide + q; return 3 * e + k; };
    const pa = nU[corner(a)], pb = nU[corner(b)];
    const [wa, wb] = pairWeights(L, pa, pb);
    for (const [kk, node, w] of [[k, a, wa], [(k + 1) % 3, b, wb]] as [number, number, number][]) {
      const kk2 = e2 === null ? -1 : el[3 * e2 + k2!] === node ? k2! : (k2! + 1) % 3;
      // Δu = u(e2) − u(e)
      const jt: [number, number][] = [[vu(e, kk), -sx], [vv(e, kk), -sy]];
      const jn: [number, number][] = [[vu(e, kk), -nx], [vv(e, kk), -ny]];
      if (e2 !== null) { jt.push([vu(e2, kk2), sx], [vv(e2, kk2), sy]); jn.push([vu(e2, kk2), nx], [vv(e2, kk2), ny]); }
      // pore pressure power on the normal jump
      if (e2 !== null) { addP(vu(e2, kk2), w * nx); addP(vv(e2, kk2), w * ny); }
      addP(vu(e, kk), -w * nx); addP(vv(e, kk), -w * ny);
      ends.push({ jt, jn, tie, c, phi, cu, L, e, e2 });
    }
  };

  // Of two soils meeting at an edge, the one with the lower shear strength
  // under the overburden at the edge's middle, c + σ′v tan φ (at most cu),
  // σ′v ≈ γ depth − u (implementation choice: either material gives an
  // upper bound; the weaker one a lower, closer one).
  const weakerSide = (e: number, k: number, e2: number): number => {
    const a = el[3 * e + k], b = el[3 * e + ((k + 1) % 3)];
    const mx = (x[a] + x[b]) / 2, my = (y[a] + y[b]) / 2;
    const depth = Math.max(0, polylineY(surface, mx) - my);
    const tau = (s: number) => {
      const u = (nU[3 * s] + nU[3 * s + 1] + nU[3 * s + 2]) / 3;
      const sv = Math.max(0, eGamma[s] * depth - u);
      return Math.min(eC[s] + sv * Math.tan(ePhi[s]), eCu[s]);
    };
    return tau(e2) < tau(e) ? e2 : e;
  };
  for (const [e, k, e2, k2] of interior) {
    const r1 = rigid[e] === 1, r2 = rigid[e2] === 1;
    if (r1 && r2) { disc(e, k, e2, k2, 0, 0, Infinity, true); continue; }
    // A slip band lies in one material: the side's whole strength (c, φ, cu),
    // never a mix of the two, which would be weaker than either.
    const side = r1 ? e2 : r2 ? e : weakerSide(e, k, e2);
    disc(e, k, e2, k2, eC[side], ePhi[side], eCu[side], false, side);
  }
  const sideCols: number[] = [];
  for (const [key, [e, k]] of owner) {
    const a = el[3 * e + k], b = el[3 * e + ((k + 1) % 3)];
    if (surfaceSet.has(key)) {
      // ground surface: ponded water (normal pressure) and strip loads (vertical, per horizontal metre)
      const pondLine = head ? slope.waterRLXY : waterLines[model.elMaterial[e]];
      const L = Math.hypot(x[b] - x[a], y[b] - y[a]);
      const nx = (y[b] - y[a]) / L, ny = -(x[b] - x[a]) / L;
      const mx = (x[a] + x[b]) / 2;
      const t: [number, number][] = [];
      for (const node of [a, b]) {
        let pw = 0;
        if (pondLine) {
          const yw = polylineY(pondLine, x[node]);
          pw = Number.isFinite(yw) ? WATER_UNIT_WEIGHT * Math.max(0, yw - y[node]) : 0;
        }
        let q = lineQ.get(`${key}:${node}`) ?? 0;
        for (const udl of slope.udls) if (mx >= udl.x1 && mx <= udl.x2) q += udl.magnitude * loadFactor;
        t.push([-pw * nx, -pw * ny - q * Math.abs(ny)]);
      }
      // ∫ t·u over the edge, t and u linear
      const ka = k, kb = (k + 1) % 3;
      addP(vu(e, ka), (L / 6) * (2 * t[0][0] + t[1][0])); addP(vv(e, ka), (L / 6) * (2 * t[0][1] + t[1][1]));
      addP(vu(e, kb), (L / 6) * (t[0][0] + 2 * t[1][0])); addP(vv(e, kb), (L / 6) * (t[0][1] + 2 * t[1][1]));
      continue;
    }
    if (Math.abs(x[b] - x[a]) <= 1e-3 * Math.abs(y[b] - y[a])) {
      // smooth vertical side: no horizontal velocity
      for (const kk of [k, (k + 1) % 3]) sideCols.push(vu(e, kk));
      continue;
    }
    // rigid base: a discontinuity against zero velocity (none for a rigid element)
    disc(e, k, null, null, eC[e], ePhi[e], eCu[e], rigid[e] === 1);
  }
  if (power.size === 0) throw new Error("The slope carries no load: no upper bound.");
  // Scales (conic.ts): velocities so that the load power's largest
  // coefficient is one, the flow variables those times the element size.
  let pMax = 0;
  for (const a of power.values()) pMax = Math.max(pMax, Math.abs(a));
  const vScale = 1 / pMax, sScale = vScale * size;

  // The columns of the flow rule and the discontinuities, the same at every F.
  interface Layout { s: Int32Array; t: Int32Array; dp: Int32Array; dm: Int32Array; tp: Int32Array; tm: Int32Array }
  let layout: Layout | null = null;
  const program = (F: number): ConicProgram => {
    const pb = new ProgramBuilder();
    for (let i = 0; i < 3 * ne; i++) { pb.col(`u${i}`, false, vScale); pb.col(`v${i}`, false, vScale); }
    const lay: Layout = {
      s: new Int32Array(ne).fill(-1), t: new Int32Array(ne).fill(-1),
      dp: new Int32Array(ends.length).fill(-1), dm: new Int32Array(ends.length).fill(-1),
      tp: new Int32Array(ends.length).fill(-1), tm: new Int32Array(ends.length).fill(-1),
    };
    // Discontinuities (Sloan & Kleeman 1995): Δu_t = u⁺ − u⁻ (+ the undrained
    // cap's), Δu_n = (u⁺ + u⁻) tan φ_F (+ opening with the cut-off),
    // dissipating c/F (u⁺ + u⁻) L/2 per end.
    ends.forEach((d, i) => {
      if (d.tie) { pb.eq(d.jt); pb.eq(d.jn); return; }
      const up = pb.col(`dp${i}`, true, vScale), um = pb.col(`dm${i}`, true, vScale);
      lay.dp[i] = up; lay.dm[i] = um;
      const tanF = Math.tan(d.phi) / F;
      const jt: [number, number][] = [...d.jt, [up, -1], [um, 1]];
      const jn: [number, number][] = [...d.jn, [up, -tanF], [um, -tanF]];
      pb.addObjective(up, ((d.c / F) * d.L) / 2); pb.addObjective(um, ((d.c / F) * d.L) / 2);
      if (Number.isFinite(d.cu)) {
        const tp = pb.col(`tp${i}`, true, vScale), tm = pb.col(`tm${i}`, true, vScale);
        lay.tp[i] = tp; lay.tm[i] = tm;
        jt.push([tp, -1], [tm, 1]);
        pb.addObjective(tp, ((d.cu / F) * d.L) / 2); pb.addObjective(tm, ((d.cu / F) * d.L) / 2);
      }
      if (cutoff) jn.push([pb.col(`op${i}`, true, vScale), -1]);
      pb.eq(jt); pb.eq(jn);
    });
    for (const j of sideCols) pb.eq([[j, 1]]);
    // Normalisation: the power of the loads is one.
    pb.eq([...power.entries()], 1);
    // Element flow rule: 2A ε̇ = the sum of the mechanisms' strain rates,
    // each in its cone: Mohr–Coulomb 2A(ε̇x + ε̇y) = 2 sin φ_F S, (2S, d) a
    // cone, dissipating c/F cos φ_F S; the undrained cap no volume change,
    // (2T, d) a cone, dissipating cu/F T; the tension cut-off 2A(ε̇x + ε̇y)
    // = C, (C, d) a cone, no dissipation.
    for (let e = 0; e < ne; e++) {
      const { b, c } = geom(e);
      const tr: [number, number][] = [], dev: [number, number][] = [], gxy: [number, number][] = [];
      for (let k = 0; k < 3; k++) {
        tr.push([vu(e, k), b[k]], [vv(e, k), c[k]]);
        dev.push([vu(e, k), b[k]], [vv(e, k), -c[k]]);
        gxy.push([vu(e, k), c[k]], [vv(e, k), b[k]]);
      }
      if (!rigid[e]) {
        const phiF = Math.atan(Math.tan(ePhi[e]) / F), sp = Math.sin(phiF), dc = (eC[e] / F) * Math.cos(phiF);
        const S = pb.col(`S${e}`, false, sScale), d1 = pb.col(`a${e}`, false, sScale), d2 = pb.col(`b${e}`, false, sScale);
        lay.s[e] = S;
        tr.push([S, -2 * sp]); dev.push([d1, -1]); gxy.push([d2, -1]);
        pb.cone(affine([[S, 2]]), affine([[d1, 1]]), affine([[d2, 1]]), "vertices");
        pb.addObjective(S, dc);
        if (Number.isFinite(eCu[e])) {
          const T = pb.col(`T${e}`, false, sScale), b1 = pb.col(`ta${e}`, false, sScale), b2 = pb.col(`tb${e}`, false, sScale);
          lay.t[e] = T;
          dev.push([b1, -1]); gxy.push([b2, -1]);
          pb.cone(affine([[T, 2]]), affine([[b1, 1]]), affine([[b2, 1]]), "vertices");
          pb.addObjective(T, eCu[e] / F);
        }
        if (cutoff) {
          const C = pb.col(`C${e}`, false, sScale), c1 = pb.col(`ca${e}`, false, sScale), c2 = pb.col(`cb${e}`, false, sScale);
          tr.push([C, -1]); dev.push([c1, -1]); gxy.push([c2, -1]);
          pb.cone(affine([[C, 1]]), affine([[c1, 1]]), affine([[c2, 1]]), "vertices");
        }
      }
      pb.eq(tr); pb.eq(dev); pb.eq(gxy);
    }
    layout ??= lay;
    return pb.build();
  };
  const first = program(1);
  return {
    program,
    sides: p,
    elementDissipation: (F, sol) => {
      const out = new Float64Array(ne);
      const lay = layout!;
      for (let e = 0; e < ne; e++) {
        if (rigid[e]) continue;
        const dc = (eC[e] / F) * Math.cos(Math.atan(Math.tan(ePhi[e]) / F));
        if (lay.s[e] >= 0) out[e] += dc * sol[lay.s[e]];
        if (lay.t[e] >= 0) out[e] += (eCu[e] / F) * sol[lay.t[e]];
      }
      ends.forEach((d, i) => {
        if (d.tie) return;
        let w = ((d.c / F) * d.L) / 2 * (sol[lay.dp[i]] + sol[lay.dm[i]]);
        if (lay.tp[i] >= 0) w += ((d.cu / F) * d.L) / 2 * (sol[lay.tp[i]] + sol[lay.tm[i]]);
        if (d.e2 === null) out[d.e] += w;
        else { out[d.e] += w / 2; out[d.e2] += w / 2; }
      });
      return out;
    },
    allUndrained,
    cohesive: eC.some((c) => c > 0) || eCu.some((c) => Number.isFinite(c) && c > 0),
    elements: ne,
    variables: first.names.length,
    constraints: first.eqRhs.length + first.cones.length,
    warnings,
    mesh: { x: Float64Array.from(x), y: Float64Array.from(y), el },
  };
}

/** Upper bound on the factor of safety of a slope. */
export async function upperBound(slope: Slope, options: UpperBoundOptions = {}, highs?: Highs, module?: HighsModuleOptions): Promise<UpperBoundResult> {
  const solve = await boundSolver(options, highs, module);
  const prob = upperBoundProblem(slope, options);
  const trials: UpperBoundResult["trials"] = [];
  const warnings = [...prob.warnings];
  const velocities = new Map<number, Float64Array>();
  const searchStart = performance.now();
  let outOfTime = false;
  const lambdaAt = (F: number): number => {
    const t0 = performance.now();
    const remaining = (options.totalTimeLimit ?? Infinity) - (t0 - searchStart) / 1000;
    if (remaining <= 0) {
      if (!outOfTime) warnings.push(`The search stopped at its time limit of ${options.totalTimeLimit} s.`);
      outOfTime = true;
      return NaN;
    }
    const r = solve(prob.program(F), prob.sides, Math.min(options.timeLimit ?? 300, remaining));
    // No mechanism with unit load power (infeasible): the loads cannot fail
    // the slope at this reduction, λ unbounded.
    const lambda = r.status === "optimal" ? r.objective : r.status === "infeasible" ? Infinity : NaN;
    if (r.status !== "optimal" && r.status !== "infeasible") warnings.push(`The program at F = ${F.toFixed(3)} ended with status "${r.detail}".`);
    if (r.status === "optimal") velocities.set(F, r.x);
    trials.push({ F, lambda, seconds: (performance.now() - t0) / 1000 });
    return lambda;
  };
  const tol = options.fTolerance ?? 0.002;
  const base = { trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints };
  const fail = (reason: string): UpperBoundResult => ({ factorOfSafety: NaN, ...base, warnings: [...warnings, reason] });
  let F0 = options.startF ?? 1;
  let l0 = lambdaAt(F0);
  if (Number.isNaN(l0)) return fail(`The program at F = ${F0.toFixed(3)} was not solved.`);
  // Where no mechanism fits the mesh (a friction angle near the slope's,
  // whose mechanisms reach beyond the model) the program is infeasible;
  // with cohesion λ turns finite at a larger reduction.
  // (Not when φ = 0 everywhere: the constraints do not depend on F.)
  for (let k = 0; k < 12 && l0 === Infinity && prob.cohesive && !prob.allUndrained; k++) {
    F0 *= 1.25;
    l0 = lambdaAt(F0);
    if (Number.isNaN(l0)) return fail(`The program at F = ${F0.toFixed(3)} was not solved.`);
  }
  // A reduction F with λ(F) ≤ 1 has a mechanism whose loads do at least the
  // power the reduced strength dissipates: the slope fails there, F is an
  // upper bound. The result is the smallest such F evaluated.
  let F: number, mechanismF = NaN;
  if (prob.allUndrained) {
    if (l0 === 0) return { factorOfSafety: 0, ...base, warnings: [...warnings, "A mechanism without dissipation fails the slope at any reduction."] };
    if (!Number.isFinite(l0)) return fail("No mechanism fits the mesh: the linear program is infeasible.");
    F = l0 * F0; // λ(F) = λ(F0)·F0/F
    mechanismF = F0; // the same mechanism at every F
  } else if (l0 === 0 || l0 === Infinity) {
    // Without cohesion the dissipation is homogeneous of degree one in the
    // velocities and does not depend on F's scale; and where no mechanism
    // fits the mesh at all the program is infeasible: λ is 0 (a mechanism
    // fails the slope) or unbounded, and F is found by bisection on failure.
    const fails = (f: number) => { const l = lambdaAt(f); return Number.isNaN(l) ? null : l <= 1; };
    let lo = 0, hi = Infinity;
    if (l0 <= 1) hi = F0; else lo = F0;
    for (let k = 0; k < 20 && (lo === 0 || hi === Infinity); k++) {
      const f = lo === 0 ? hi / 1.5 : lo * 1.5;
      if (f < 0.05 || f > 100) break;
      const r = fails(f);
      if (r === null) break;
      if (r) hi = f; else lo = f;
    }
    while (Number.isFinite(hi) && lo > 0 && hi - lo > tol) {
      const f = (lo + hi) / 2, r = fails(f);
      if (r === null) break;
      if (r) hi = f; else lo = f;
    }
    if (!Number.isFinite(hi)) return fail("No reduction with a failing mechanism was found.");
    if (!(lo > 0) || hi - lo > tol) warnings.push(`The bisection stopped with F between ${lo.toFixed(3)} and ${hi.toFixed(3)}; F is the upper of the two.`);
    F = hi;
  } else {
    let best = l0 <= 1 ? F0 : Infinity, stands = l0 > 1 ? F0 : 0;
    const certify = (f: number, l: number) => {
      if (l <= 1) best = Math.min(best, f);
      else stands = Math.max(stands, f);
    };
    // Secant on log λ against log F (λ falls about as a power of F), root
    // where λ = 1; the next trial tol/2 above the secant's root, on the
    // failing side. The second point assumes λ ∝ 1/F², within ±50 %. A
    // trial off the bracket between the largest F that stands and the
    // smallest that fails, or after λ = 0 or ∞, bisects it (as the lower
    // bound's search).
    let fa = F0, la = l0;
    let fb = Math.min(1.5 * F0, Math.max(F0 / 1.5, F0 * Math.sqrt(l0)));
    let lb = lambdaAt(fb);
    certify(fb, lb);
    let reached = false, root = NaN;
    for (let it = 0; it < 25 && !Number.isNaN(lb); it++) {
      if (Number.isFinite(best) && best - stands <= tol) { reached = true; break; }
      let next = NaN;
      if (la > 0 && lb > 0 && Number.isFinite(la) && Number.isFinite(lb) && Math.abs(Math.log(lb) - Math.log(la)) >= 1e-14) {
        const ga = Math.log(la), gb = Math.log(lb);
        root = Math.max(0.05, Math.exp(Math.log(fb) - (gb * (Math.log(fb) - Math.log(fa))) / (gb - ga)));
        if (Number.isFinite(best) && best <= root + tol) { reached = true; break; }
        next = root + tol / 2;
      }
      if (!(next > stands && next < best)) next = Number.isFinite(best) && stands > 0 ? (best + stands) / 2 : Number.isFinite(best) ? best / 1.5 : 1.5 * stands;
      if (next < 0.05 || next > 100) break;
      fa = fb; la = lb;
      fb = next;
      lb = lambdaAt(fb);
      certify(fb, lb);
    }
    if (!Number.isFinite(best)) return fail("No reduction with a failing mechanism was found.");
    if (!reached) {
      warnings.push(`The search for λ = 1 stopped before converging${Number.isFinite(root) ? ` (estimated root F = ${root.toFixed(3)})` : ""}; F is the smallest reduction found to fail.`);
    }
    F = best;
  }
  const cols = velocities.get(Number.isNaN(mechanismF) ? F : mechanismF);
  let mechanism: UpperBoundResult["mechanism"];
  if (cols) {
    const n = prob.mesh.el.length, velocity = new Float64Array(2 * n);
    let vmax = 0;
    for (let i = 0; i < n; i++) {
      velocity[2 * i] = cols[2 * i];
      velocity[2 * i + 1] = cols[2 * i + 1];
      vmax = Math.max(vmax, Math.hypot(velocity[2 * i], velocity[2 * i + 1]));
    }
    if (vmax > 0) for (let i = 0; i < velocity.length; i++) velocity[i] /= vmax;
    mechanism = { ...prob.mesh, velocity };
  }
  return { factorOfSafety: F, ...base, warnings, mechanism };
}
