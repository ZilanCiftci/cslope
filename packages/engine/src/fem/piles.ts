/**
 * Pile rows in the strength reduction: an embedded beam row.
 *
 * Method: each pile is a line of two-node Euler–Bernoulli frame elements
 * (axial and bending stiffness per metre of slope, EA/s and EI/s for piles
 * at spacing s) on beam nodes with a rotation, placed at the soil nodes
 * along the pile (the mesh has the pile as a constraint line). Each beam
 * node is joined to its soil node by a lateral and an axial spring,
 * elastic–perfectly plastic, so that the soil can flow between the piles
 * (the embedded beam row: Sluis, Besseling & Stuurwold 2014, Numerical
 * Methods in Geotechnical Engineering, 431–436; the pile–soil springs of
 * the p–y method). The springs are bars of bars.ts that act in both
 * directions.
 *
 * Limits per pile and metre of pile, reduced with the soil's strength
 * (c/F, tan φ/F):
 * - lateral: p_u = 9 c d + 3 Kp σ′v d, the ultimate lateral resistance of
 *   Broms (1964, J. Soil Mech. Found. Div. 90(SM2), 27–63, and (SM3),
 *   123–156) for cohesive and cohesionless soil, summed for c–φ soil; a
 *   continuous wall (`wall`, or spacing ≤ width) lets no soil through and
 *   its lateral springs do not yield;
 * - axial: skin friction t = π d (c + K0 σ′v tan φ), K0 = 1 − sin φ.
 *
 * Implementation choices (not from the literature): the springs' stiffness
 * is 10 times the soil's Young's modulus per metre of tributary length
 * (stiff against the soil, soft enough for the conditioning); σ′v is the
 * unit weight of the soil at the node times its depth below the ground less
 * the pore pressure; the strength is that of the first element at the node
 * (rigid material: no yield); EI and EA of a solid circular section of
 * concrete (E = 30 GPa) unless given (for a wall a plate of thickness d per
 * metre); the piles stay elastic, their largest
 * moment and shear compared with the capacities afterwards; piles without a
 * diameter (a given force only) are left out.
 */

import type { Slope } from "../model/slope";
import type { Material } from "../types/material";
import type { SparseCholesky } from "./sparse";

/** Young's modulus of a pile without given stiffness (kPa): concrete. */
export const PILE_DEFAULT_E = 3e7;
/** Spring stiffness per metre of tributary length, as a multiple of the soil's Young's modulus. */
const SPRING_FACTOR = 10;
/** Capacity of a spring that does not yield (kN). */
export const NO_YIELD = 1e12;

export interface FePiles {
  /** Beam elements: two global nodes each. */
  count: number;
  nodes: Int32Array;
  /** Per beam: direction cosines, length, EA and EI per metre of slope, source pile. */
  c: Float64Array;
  s: Float64Array;
  length: Float64Array;
  ea: Float64Array;
  ei: Float64Array;
  source: Int32Array;
  /** Rotation equation of each global node (−1: none, a soil node or fixed). */
  rotEq: Int32Array;
}

/** Spring bars to append to the reinforcement bars (bars.ts layout). */
export interface PileSprings {
  nodes: number[];
  gp: number[];
  stiffness: number[];
  /** Per Gauss point: capacity kind (1 lateral, 2 axial; 0 fixed) and its terms. */
  kind: number[];
  capC: number[];
  capSv: number[];
  capTan: number[];
  fixedCap: number[];
}

export const EMPTY_PILES: FePiles = {
  count: 0, nodes: new Int32Array(0), c: new Float64Array(0), s: new Float64Array(0), length: new Float64Array(0),
  ea: new Float64Array(0), ei: new Float64Array(0), source: new Int32Array(0), rotEq: new Int32Array(0),
};

interface PileInput {
  slope: Slope;
  x: Float64Array;
  y: Float64Array;
  el: Int32Array;
  ne: number;
  eq: Int32Array;
  neq: number;
  span: number;
  materials: Material[];
  elMaterial: Int32Array;
  elElastic: Uint8Array;
  gpC: Float64Array;
  gpPhi: Float64Array;
  gpU: Float64Array;
  maxSoilE: number;
  waterLines: ({ x: number[]; y: number[] } | null)[];
  unitWeight: (m: Material, wl: { x: number[]; y: number[] } | null, u: number, x: number, y: number) => number;
  groundY: (x: number) => number;
}

/**
 * Beam nodes, beam elements and springs of the slope's piles (those with a
 * diameter). Returns the coordinates and equation numbers extended with the
 * beam nodes (2 per node, then a rotation equation each).
 */
export function buildPiles(input: PileInput): {
  x: Float64Array; y: Float64Array; eq: Int32Array; neq: number; piles: FePiles; springs: PileSprings; warnings: string[];
} {
  const { slope, el, ne, span } = input;
  let { neq } = input;
  const warnings: string[] = [];
  const springs: PileSprings = { nodes: [], gp: [], stiffness: [], kind: [], capC: [], capSv: [], capTan: [], fixedCap: [] };
  const xs = Array.from(input.x), ys = Array.from(input.y), eqs = Array.from(input.eq);
  const rot: number[] = new Array(xs.length).fill(-1);
  const bn: number[] = [], bc: number[] = [], bs: number[] = [], bl: number[] = [], bea: number[] = [], bei: number[] = [], bsrc: number[] = [];
  const tol = 1e-6 * span;
  // Element at each soil node (for its strength and pore pressure).
  const nodeElement = new Int32Array(input.x.length).fill(-1);
  for (let e = 0; e < ne; e++) for (let k = 0; k < 6; k++) if (nodeElement[el[6 * e + k]] < 0) nodeElement[el[6 * e + k]] = e;
  slope.piles.forEach((p, pi) => {
    const d = p.diameter;
    if (!(d !== undefined && d > 0)) {
      warnings.push(`Pile ${pi + 1} has no diameter and is not included in the finite element analysis.`);
      return;
    }
    const L = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
    if (!(L > 0)) return;
    const c = (p.x2 - p.x1) / L, s = (p.y2 - p.y1) / L;
    const station = (n: number) => (input.x[n] - p.x1) * c + (input.y[n] - p.y1) * s;
    const onLine = (n: number) => {
      const t = station(n);
      return t >= -tol && t <= L + tol && Math.abs(-(input.x[n] - p.x1) * s + (input.y[n] - p.y1) * c) <= tol;
    };
    const soil: number[] = [];
    for (let n = 0; n < input.x.length; n++) if (nodeElement[n] >= 0 && onLine(n)) soil.push(n);
    soil.sort((a, b) => station(a) - station(b));
    if (soil.length < 2) {
      warnings.push(`Pile ${pi + 1} lies outside the mesh and is not included in the finite element analysis.`);
      return;
    }
    const spacing = p.spacing && p.spacing > 0 ? p.spacing : 1;
    const E = PILE_DEFAULT_E;
    const wall = p.wall ?? spacing <= d; // a continuous wall: no soil flows through
    // defaults: a solid circle of diameter d per pile, or a plate of thickness d per metre for a wall
    const EA = (p.axialStiffness ?? (wall ? E * d * spacing : (E * Math.PI * d * d) / 4)) / spacing;
    const EI = (p.bendingStiffness ?? (wall ? (E * d ** 3 * spacing) / 12 : (E * Math.PI * d ** 4) / 64)) / spacing;
    // beam nodes at the soil nodes
    const beam = soil.map((n) => {
      const g = xs.length;
      xs.push(input.x[n]); ys.push(input.y[n]);
      eqs.push(neq++, neq++);
      rot.push(neq++);
      return g;
    });
    for (let k = 0; k + 1 < beam.length; k++) {
      const len = station(soil[k + 1]) - station(soil[k]);
      bn.push(beam[k], beam[k + 1]); bc.push(c); bs.push(s); bl.push(len); bea.push(EA); bei.push(EI); bsrc.push(pi);
    }
    // springs, with the tributary length of each node
    soil.forEach((n, k) => {
      const prev = k > 0 ? station(n) - station(soil[k - 1]) : 0, next = k + 1 < soil.length ? station(soil[k + 1]) - station(n) : 0;
      const trib = (prev + next) / 2;
      if (!(trib > 0)) return;
      const e = nodeElement[n], mi = input.elMaterial[e], m = input.materials[mi];
      // strength and pore pressure of the element at the node (its Gauss points' mean)
      let cc = 0, phi = 0, u = 0;
      for (let g = 0; g < 3; g++) { cc += input.gpC[3 * e + g] / 3; phi += input.gpPhi[3 * e + g] / 3; u += input.gpU[3 * e + g] / 3; }
      const depth = Math.max(0, input.groundY(input.x[n]) - input.y[n]);
      const sv = Math.max(0, input.unitWeight(m, input.waterLines[mi], u, input.x[n], input.y[n]) * depth - u);
      const rigid = input.elElastic[e] === 1;
      const k0 = SPRING_FACTOR * input.maxSoilE * trib;
      for (const [kind, nx, ny] of [[1, -s, c], [2, c, s]] as const) {
        springs.nodes.push(n, n, beam[k]);
        springs.stiffness.push(k0);
        for (let g = 0; g < 2; g++) {
          springs.gp.push(-nx, -ny, 0, 0, nx, ny, 0.5);
          const lateral = kind === 1;
          const noYield = rigid || (lateral && wall);
          springs.kind.push(noYield ? 0 : kind);
          springs.fixedCap.push(NO_YIELD);
          // per metre of slope: per pile × trib / spacing
          springs.capC.push(lateral ? (9 * cc * d * trib) / spacing : (Math.PI * d * cc * trib) / spacing);
          springs.capSv.push(lateral ? (3 * sv * d * trib) / spacing : (Math.PI * d * (1 - Math.sin(phi)) * sv * trib) / spacing);
          springs.capTan.push(Math.tan(phi));
        }
      }
    });
  });
  return {
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    eq: Int32Array.from(eqs),
    neq,
    piles: {
      count: bsrc.length, nodes: Int32Array.from(bn), c: Float64Array.from(bc), s: Float64Array.from(bs), length: Float64Array.from(bl),
      ea: Float64Array.from(bea), ei: Float64Array.from(bei), source: Int32Array.from(bsrc), rotEq: Int32Array.from(rot),
    },
    springs,
    warnings,
  };
}

/** Capacity of a pile spring at reduction F (kind 1 lateral, 2 axial). */
export function springCapacity(kind: number, capC: number, capSv: number, tanPhi: number, F: number): number {
  const tanF = tanPhi / F;
  if (kind === 1) {
    const sinF = Math.sin(Math.atan(tanF)), kp = (1 + sinF) / (1 - sinF);
    return capC / F + capSv * kp;
  }
  return capC / F + capSv * tanF;
}

/** Global stiffness (6 × 6, dofs u1 v1 θ1 u2 v2 θ2) of a frame element into `k`. */
export function frameStiffness(c: number, s: number, L: number, EA: number, EI: number, k: Float64Array): void {
  const a = EA / L, b = (12 * EI) / L ** 3, q = (6 * EI) / L ** 2, r = (4 * EI) / L, h = (2 * EI) / L;
  // local stiffness (axial along the beam, transverse, rotation)
  const kl = [
    a, 0, 0, -a, 0, 0,
    0, b, q, 0, -b, q,
    0, q, r, 0, -q, h,
    -a, 0, 0, a, 0, 0,
    0, -b, -q, 0, b, -q,
    0, q, h, 0, -q, r,
  ];
  // T: local = T global
  const T = new Float64Array(36);
  for (const o of [0, 3]) {
    T[(o) * 6 + o] = c; T[(o) * 6 + o + 1] = s;
    T[(o + 1) * 6 + o] = -s; T[(o + 1) * 6 + o + 1] = c;
    T[(o + 2) * 6 + o + 2] = 1;
  }
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let v = 0;
      for (let m = 0; m < 6; m++) {
        if (T[m * 6 + i] === 0) continue;
        for (let n = 0; n < 6; n++) v += T[m * 6 + i] * kl[m * 6 + n] * T[n * 6 + j];
      }
      k[i * 6 + j] = v;
    }
  }
}

/** Equations of a beam's six dofs. */
export function beamDofs(eq: Int32Array, piles: FePiles, b: number, out: Int32Array): void {
  const n1 = piles.nodes[2 * b], n2 = piles.nodes[2 * b + 1];
  out[0] = eq[2 * n1]; out[1] = eq[2 * n1 + 1]; out[2] = piles.rotEq[n1];
  out[3] = eq[2 * n2]; out[4] = eq[2 * n2 + 1]; out[5] = piles.rotEq[n2];
}

const BK = new Float64Array(36), BD = new Int32Array(6);

/** Internal forces of the (elastic) piles added to `fint`, and their stiffness to `K` when given. */
export function beamInternal(model: { eq: Int32Array; piles: FePiles }, u: Float64Array, fint: Float64Array, K: SparseCholesky | null): void {
  const { piles, eq } = model;
  for (let b = 0; b < piles.count; b++) {
    frameStiffness(piles.c[b], piles.s[b], piles.length[b], piles.ea[b], piles.ei[b], BK);
    beamDofs(eq, piles, b, BD);
    for (let i = 0; i < 6; i++) {
      if (BD[i] < 0) continue;
      let f = 0;
      for (let j = 0; j < 6; j++) if (BD[j] >= 0) f += BK[i * 6 + j] * u[BD[j]];
      fint[BD[i]] += f;
      if (K) for (let j = 0; j <= i; j++) if (BD[j] >= 0) K.add(BD[i], BD[j], BK[i * 6 + j]);
    }
  }
}

/**
 * Largest axial force, shear force and bending moment of each pile (per
 * pile: per metre of slope × spacing) from the displacements.
 */
export function pileForces(model: { eq: Int32Array; piles: FePiles }, u: Float64Array, spacing: (pile: number) => number): Map<number, { axial: number; shear: number; moment: number }> {
  const { piles, eq } = model;
  const out = new Map<number, { axial: number; shear: number; moment: number }>();
  const ul = new Float64Array(6);
  for (let b = 0; b < piles.count; b++) {
    beamDofs(eq, piles, b, BD);
    const c = piles.c[b], s = piles.s[b], L = piles.length[b], EA = piles.ea[b], EI = piles.ei[b];
    const g = (i: number) => (BD[i] >= 0 ? u[BD[i]] : 0);
    // local displacements
    ul[0] = c * g(0) + s * g(1); ul[1] = -s * g(0) + c * g(1); ul[2] = g(2);
    ul[3] = c * g(3) + s * g(4); ul[4] = -s * g(3) + c * g(4); ul[5] = g(5);
    const axial = (EA / L) * (ul[3] - ul[0]);
    const shear = ((12 * EI) / L ** 3) * (ul[1] - ul[4]) + ((6 * EI) / L ** 2) * (ul[2] + ul[5]);
    const m1 = ((6 * EI) / L ** 2) * (ul[1] - ul[4]) + (EI / L) * (4 * ul[2] + 2 * ul[5]);
    const m2 = ((6 * EI) / L ** 2) * (ul[1] - ul[4]) + (EI / L) * (2 * ul[2] + 4 * ul[5]);
    const sp = spacing(piles.source[b]);
    const prev = out.get(piles.source[b]) ?? { axial: 0, shear: 0, moment: 0 };
    out.set(piles.source[b], {
      axial: Math.max(prev.axial, Math.abs(axial) * sp),
      shear: Math.max(prev.shear, Math.abs(shear) * sp),
      moment: Math.max(prev.moment, Math.abs(m1) * sp, Math.abs(m2) * sp),
    });
  }
  return out;
}
