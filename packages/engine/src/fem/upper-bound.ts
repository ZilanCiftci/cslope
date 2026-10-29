/**
 * Upper bound limit analysis by finite elements and linear programming
 * (Sloan & Kleeman 1995, Comput. Methods Appl. Mech. Eng. 127, 293–314;
 * Lyamin & Sloan 2002, IJNAMG 26, 181–216).
 *
 * The velocities vary linearly over three-node triangles whose nodes are not
 * shared, so that every edge can carry a velocity discontinuity. In each
 * element the constant plastic strain rate follows the flow rule of the
 * Mohr–Coulomb criterion replaced by the p-sided polygon circumscribing it
 * (its sides tangent to the circle), ε̇ = Σ λₖ ∂Fₖ/∂σ, λₖ ≥ 0, and dissipates
 * 2c cos φ Σ λₖ per unit area. Along a discontinuity the tangential jump is
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
 * the slope there). Solved by HiGHS.
 *
 * Supports as in the strength reduction model (model.ts): the vertical
 * sides are smooth rollers (no normal velocity), the base is rigid, and
 * the soil may slip along it through a discontinuity of the soil's
 * strength.
 *
 * Implementation choices (not from the literature): p = 24 sides; the
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
import { loadHighs, type HighsModuleOptions } from "./lower-bound";
import { meanUnitWeight, porePressureAt, strengthAt, surfaceLineLoads } from "./limit-common";

export interface UpperBoundOptions extends FeModelOptions {
  /** Sides of the circumscribed yield polygon; default 24. */
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
  build(F: number): string;
  /**
   * The dissipation of a solution at F per element (the model's), with
   * each discontinuity's shared equally by the elements on its sides (all
   * of it by the element on the base).
   */
  elementDissipation(F: number, columns: Record<string, { Primal: number }>): Float64Array;
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

  const vu = (e: number, k: number) => `u${3 * e + k}`, vv = (e: number, k: number) => `v${3 * e + k}`;
  const fmt = (a: number) => (a === 0 ? "0" : a.toPrecision(15));
  const term = (a: number, name: string) => (a === 0 ? "" : ` ${a < 0 ? "-" : "+"} ${fmt(Math.abs(a))} ${name}`);

  // The power of the loads (F-independent), as coefficients per velocity.
  const power = new Map<string, number>();
  const addP = (name: string, a: number) => { if (a !== 0) power.set(name, (power.get(name) ?? 0) + a); };
  const geom = (e: number) => {
    const n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
    const b = [y[n[1]] - y[n[2]], y[n[2]] - y[n[0]], y[n[0]] - y[n[1]]];
    const c = [x[n[2]] - x[n[1]], x[n[0]] - x[n[2]], x[n[1]] - x[n[0]]];
    return { n, b, c, area2: b[0] * c[1] - b[1] * c[0] };
  };
  for (let e = 0; e < ne; e++) {
    const { b, c, area2 } = geom(e);
    const pm = (nU[3 * e] + nU[3 * e + 1] + nU[3 * e + 2]) / 3;
    for (let k = 0; k < 3; k++) {
      // weight: −γ A v̄; pore pressure: ∫ p ε̇_v dA = p̄ (Σ b u + c v)/2
      addP(vv(e, k), (-eGamma[e] * area2) / 6 + (pm * c[k]) / 2);
      addP(vu(e, k), (pm * b[k]) / 2);
    }
  }
  // ∫ p Δu_n over an edge with p and Δu_n linear: L/6 (2 p_a d_a + p_a d_b + p_b d_a + 2 p_b d_b)
  const pairWeights = (L: number, pa: number, pb: number) => [(L / 6) * (2 * pa + pb), (L / 6) * (pa + 2 * pb)];

  const rows: string[] = [];
  let row = 0;
  // Per discontinuity end: tangential and normal jump. `jump` gives the
  // velocity names of the two sides (the other side null for the rigid base).
  const dVars: { name: string; coef: (F: number) => number; e: number; e2: number | null }[] = [];
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
    const ends: [number, number, number][] = [[k, a, wa], [(k + 1) % 3, b, wb]];
    for (const [kk, node, w] of ends) {
      const kk2 = e2 === null ? -1 : el[3 * e2 + k2!] === node ? k2! : (k2! + 1) % 3;
      // Δu = u(e2) − u(e)
      const jt = (e2 === null ? "" : term(sx, vu(e2, kk2)) + term(sy, vv(e2, kk2))) + term(-sx, vu(e, kk)) + term(-sy, vv(e, kk));
      const jn = (e2 === null ? "" : term(nx, vu(e2, kk2)) + term(ny, vv(e2, kk2))) + term(-nx, vu(e, kk)) + term(-ny, vv(e, kk));
      // pore pressure power on the normal jump
      if (e2 !== null) { addP(vu(e2, kk2), w * nx); addP(vv(e2, kk2), w * ny); }
      addP(vu(e, kk), -w * nx); addP(vv(e, kk), -w * ny);
      if (tie) {
        rows.push(` r${row++}:${jt} = 0`, ` r${row++}:${jn} = 0`);
        continue;
      }
      const id = `${row}`;
      const up = `dp${id}`, um = `dm${id}`;
      let t = term(-1, up) + term(1, um), nn = "";
      // dissipation c (u⁺ + u⁻) L/2 per end; the dilation tan φ_F depends on F
      dVars.push({ name: up, coef: (F) => (c / F) * L / 2, e, e2 }, { name: um, coef: (F) => (c / F) * L / 2, e, e2 });
      nn += ` - TANPHI${id} ${up} - TANPHI${id} ${um}`;
      tanRows.push({ id, phi });
      if (Number.isFinite(cu)) {
        const tp = `tp${id}`, tm = `tm${id}`;
        t += term(-1, tp) + term(1, tm);
        dVars.push({ name: tp, coef: (F) => (cu / F) * L / 2, e, e2 }, { name: tm, coef: (F) => (cu / F) * L / 2, e, e2 });
      }
      if (cutoff) { const op = `op${id}`; nn += term(-1, op); }
      rows.push(` r${row++}:${jt}${t} = 0`, ` r${row++}:${jn}${nn} = 0`);
    }
  };
  const tanRows: { id: string; phi: number }[] = [];

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
      for (const kk of [k, (k + 1) % 3]) rows.push(` r${row++}: ${vu(e, kk)} = 0`);
      continue;
    }
    // rigid base: a discontinuity against zero velocity (none for a rigid element)
    disc(e, k, null, null, eC[e], ePhi[e], eCu[e], rigid[e] === 1);
  }

  // Normalisation: the power of the loads is one.
  if (power.size === 0) throw new Error("The slope carries no load: no upper bound.");
  let norm = " norm:";
  for (const [name, a] of power) norm += term(a, name);
  rows.push(`${norm} = 1`);

  // Element flow rule (F-dependent): 2A ε̇ = Σ multipliers × gradients, multipliers scaled by 2A.
  const flowRows = (F: number): { rows: string[]; obj: string[] } => {
    const out: string[] = [], obj: string[] = [];
    let r = row;
    for (let e = 0; e < ne; e++) {
      const { b, c } = geom(e);
      let ex = "", ey = "", gxy = "";
      for (let k = 0; k < 3; k++) {
        ex += term(b[k], vu(e, k));
        ey += term(c[k], vv(e, k));
        gxy += term(c[k], vu(e, k)) + term(b[k], vv(e, k));
      }
      if (!rigid[e]) {
        const phiF = Math.atan(Math.tan(ePhi[e]) / F), sp = Math.sin(phiF), dc = (eC[e] / F) * Math.cos(phiF);
        for (let j = 0; j < p; j++) {
          const th = (2 * Math.PI * j) / p, ct = Math.cos(th), st = Math.sin(th);
          // F_j = cos θ (σx − σy) + sin θ (2τ) + sin φ (σx + σy) − 2c cos φ; dissipation 2c cos φ λ A = c cos φ Λ
          const m = `l${e}_${j}`;
          ex += term(-(ct + sp), m); ey += term(-(-ct + sp), m); gxy += term(-2 * st, m);
          if (dc > 0) obj.push(term(dc, m));
          if (Number.isFinite(eCu[e])) {
            const mu = `t${e}_${j}`;
            ex += term(-ct, mu); ey += term(ct, mu); gxy += term(-2 * st, mu);
            obj.push(term(eCu[e] / F, mu));
          }
          if (cutoff) {
            // σ₁ ≤ 0 circumscribed: cos θ (σx − σy)/2 + sin θ τ + (σx + σy)/2 ≤ 0, no dissipation
            const mt = `c${e}_${j}`;
            ex += term(-(ct / 2 + 0.5), mt); ey += term(-(-ct / 2 + 0.5), mt); gxy += term(-st, mt);
          }
        }
      }
      out.push(` r${r++}:${ex} = 0`, ` r${r++}:${ey} = 0`, ` r${r++}:${gxy} = 0`);
    }
    return { rows: out, obj };
  };

  const velocityBounds: string[] = ["Bounds"];
  for (let i = 0; i < 3 * ne; i++) velocityBounds.push(` u${i} free`, ` v${i} free`);
  const fixedText = rows.join("\n"), boundsText = velocityBounds.join("\n");
  let plastic = 0, combined = 0;
  for (let e = 0; e < ne; e++) if (!rigid[e]) { plastic++; if (Number.isFinite(eCu[e])) combined++; }
  const perElement = p * (1 + (cutoff ? 1 : 0));
  return {
    build: (F) => {
      const tanMap = new Map(tanRows.map((t) => [t.id, Math.tan(t.phi) / F]));
      const text = fixedText.replace(/ - TANPHI(\d+) (\w+)/g, (_, id: string, name: string) => term(-(tanMap.get(id) ?? 0), name));
      const flow = flowRows(F);
      let obj = " obj:" + flow.obj.join("");
      for (const d of dVars) obj += term(d.coef(F), d.name);
      if (obj === " obj:") obj = " obj: 0 u0";
      return ["Minimize", obj, "Subject To", text, flow.rows.join("\n"), boundsText, "End"].join("\n");
    },
    elementDissipation: (F, columns) => {
      const out = new Float64Array(ne);
      const val = (name: string) => columns[name]?.Primal ?? 0;
      for (let e = 0; e < ne; e++) {
        if (rigid[e]) continue;
        const dc = (eC[e] / F) * Math.cos(Math.atan(Math.tan(ePhi[e]) / F));
        for (let j = 0; j < p; j++) {
          if (dc > 0) out[e] += dc * val(`l${e}_${j}`);
          if (Number.isFinite(eCu[e])) out[e] += (eCu[e] / F) * val(`t${e}_${j}`);
        }
      }
      for (const d of dVars) {
        const w = d.coef(F) * val(d.name);
        if (d.e2 === null) out[d.e] += w;
        else { out[d.e] += w / 2; out[d.e2] += w / 2; }
      }
      return out;
    },
    allUndrained,
    cohesive: eC.some((c) => c > 0) || eCu.some((c) => Number.isFinite(c) && c > 0),
    elements: ne,
    variables: 6 * ne + plastic * perElement + combined * p + dVars.length + tanRows.length * (cutoff ? 1 : 0),
    constraints: row + 1 + 3 * ne, // with the normalisation row
    warnings,
    mesh: { x: Float64Array.from(x), y: Float64Array.from(y), el },
  };
}

/** Upper bound on the factor of safety of a slope. */
export async function upperBound(slope: Slope, options: UpperBoundOptions = {}, highs?: Highs, module?: HighsModuleOptions): Promise<UpperBoundResult> {
  const solver = (highs ?? (await loadHighs(module))) as Highs;
  const prob = upperBoundProblem(slope, options);
  const trials: UpperBoundResult["trials"] = [];
  const warnings = [...prob.warnings];
  const velocities = new Map<number, Record<string, { Primal: number }>>();
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
    const lp = prob.build(F);
    const time_limit = Math.min(options.timeLimit ?? 300, remaining);
    let r = solver.solve(lp, { solver: "ipm", time_limit });
    if (r.Status !== "Optimal" && r.Status !== "Infeasible" && r.Status !== "Time limit reached") r = solver.solve(lp, { solver: "simplex", time_limit });
    // No mechanism with unit load power (infeasible): the loads cannot fail
    // the slope at this reduction, λ unbounded.
    const lambda = r.Status === "Optimal" ? r.ObjectiveValue : r.Status === "Infeasible" ? Infinity : NaN;
    if (r.Status !== "Optimal" && r.Status !== "Infeasible") warnings.push(`The linear program at F = ${F.toFixed(3)} ended with status "${r.Status}".`);
    if (r.Status === "Optimal" && r.Columns) velocities.set(F, r.Columns);
    trials.push({ F, lambda, seconds: (performance.now() - t0) / 1000 });
    return lambda;
  };
  const tol = options.fTolerance ?? 0.002;
  const base = { trials, elements: prob.elements, variables: prob.variables, constraints: prob.constraints };
  const fail = (reason: string): UpperBoundResult => ({ factorOfSafety: NaN, ...base, warnings: [...warnings, reason] });
  let F0 = options.startF ?? 1;
  let l0 = lambdaAt(F0);
  if (Number.isNaN(l0)) return fail(`The linear program at F = ${F0.toFixed(3)} was not solved.`);
  // Where no mechanism fits the mesh (a friction angle near the slope's,
  // whose mechanisms reach beyond the model) the program is infeasible;
  // with cohesion λ turns finite at a larger reduction.
  // (Not when φ = 0 everywhere: the constraints do not depend on F.)
  for (let k = 0; k < 12 && l0 === Infinity && prob.cohesive && !prob.allUndrained; k++) {
    F0 *= 1.25;
    l0 = lambdaAt(F0);
    if (Number.isNaN(l0)) return fail(`The linear program at F = ${F0.toFixed(3)} was not solved.`);
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
    let best = l0 <= 1 ? F0 : Infinity;
    const certify = (f: number, l: number) => { if (l <= 1 && f < best) best = f; };
    // Secant on log λ against log F (λ falls about as a power of F), root
    // where λ = 1; the next trial tol/2 above the secant's root, on the
    // failing side. The second point assumes λ ∝ 1/F², within ±50 %.
    let fa = F0, ga = Math.log(l0);
    let fb = Math.min(1.5 * F0, Math.max(F0 / 1.5, F0 * Math.sqrt(l0)));
    let lb = lambdaAt(fb);
    certify(fb, lb);
    let reached = false, root = NaN;
    for (let it = 0; it < 15 && Number.isFinite(lb) && lb > 0; it++) {
      const gb = Math.log(lb);
      if (Math.abs(gb - ga) < 1e-14) { reached = Number.isFinite(best) && Math.abs(fb - best) <= tol; break; }
      root = Math.max(0.05, Math.exp(Math.log(fb) - (gb * (Math.log(fb) - Math.log(fa))) / (gb - ga)));
      if (Number.isFinite(best) && best <= root + tol) { reached = true; break; }
      fa = fb; ga = gb;
      fb = root + tol / 2;
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
      velocity[2 * i] = cols[`u${i}`]?.Primal ?? 0;
      velocity[2 * i + 1] = cols[`v${i}`]?.Primal ?? 0;
      vmax = Math.max(vmax, Math.hypot(velocity[2 * i], velocity[2 * i + 1]));
    }
    if (vmax > 0) for (let i = 0; i < velocity.length; i++) velocity[i] /= vmax;
    mechanism = { ...prob.mesh, velocity };
  }
  return { factorOfSafety: F, ...base, warnings, mechanism };
}
