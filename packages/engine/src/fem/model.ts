/**
 * Finite element model of a slope: T6 mesh, materials, supports and loads.
 *
 * The domain is the slope's external boundary, meshed with the material
 * boundaries as constraints so that every element lies in one material.
 * Supports follow common practice for slope analysis by finite elements
 * (Griffiths & Lane 1999, Géotechnique 49(3), 387–403): the base is fixed,
 * the vertical sides are on rollers, and the ground surface is free.
 *
 * Loads: self-weight with the total unit weight, the pore pressures of the
 * water table as an initial effective-stress load (∫ Bᵀ m u dA; Smith,
 * Griffiths & Margetts 2014, §6.11), ponded water above the ground as a
 * normal pressure on the surface, strip loads (kPa, per horizontal metre)
 * and line loads (kN/m) as vertical tractions on the surface. Pore pressure
 * is hydrostatic below the water line of each element's material,
 * u = γw (y_w − y) ≥ 0.
 */

import { WATER_UNIT_WEIGHT } from "../types/constants";
import type { Material } from "../types/material";
import { needsLayerTop } from "../types/strength";
import type { Slope } from "../model/slope";
import { getYAtX } from "../math/interpolation";
import { GAUSS_T6, GP_STRIDE, gaussData, shapeT6, stiffnessT6 } from "./elements";
import { meshDomain, pointInPolygon, type TriMesh } from "./mesh";
import { reverseCuthillMcKee, SkylineMatrix } from "./skyline";

/** Elastic and flow parameters of a material in the finite element analysis. */
export interface FeMaterialParameters {
  /** Young's modulus E (kPa); default 1·10⁵. */
  youngsModulus?: number;
  /** Poisson's ratio ν; default 0.3. */
  poissonsRatio?: number;
  /** Dilation angle ψ (°); default 0. */
  dilationAngle?: number;
}

export interface FeModelOptions {
  /** Target element size (m); default: domain height / 20. */
  elementSize?: number;
  /** Size field overriding `elementSize`, e.g. from error estimation. */
  sizeField?: (x: number, y: number) => number;
  /** Parameters per material name. */
  materialParameters?: Readonly<Record<string, FeMaterialParameters>>;
  /** Smallest triangle angle (°); default 25. */
  minAngle?: number;
  /** Vertex cap of the mesh; default 60 000. */
  maxVertices?: number;
}

export const DEFAULT_YOUNGS_MODULUS = 1e5;
export const DEFAULT_POISSONS_RATIO = 0.3;
/** Stiffness of high-strength and impenetrable materials relative to the softest soil. */
const RIGID_FACTOR = 100;

/** How a material behaves in the finite element analysis. */
export type FeBehaviour = "plastic" | "elastic";

export interface FeModel {
  /** Node coordinates (corner nodes first, then midside nodes). */
  x: Float64Array;
  y: Float64Array;
  nodeCount: number;
  /** Corner node count (the vertices of the triangulation). */
  cornerCount: number;
  /** Element connectivity, 6 nodes per element. */
  el: Int32Array;
  elementCount: number;
  /** Materials used by the elements and the index of each element's. */
  materials: Material[];
  elMaterial: Int32Array;
  /** Per element: E, ν, ψ (rad) and behaviour. */
  elE: Float64Array;
  elNu: Float64Array;
  elPsi: Float64Array;
  elElastic: Uint8Array;
  /** Gauss point data (see `gaussData`) and coordinates, 3 per element. */
  gp: Float64Array;
  gpX: Float64Array;
  gpY: Float64Array;
  /** Strength at each Gauss point: c (kPa) and φ (rad). */
  gpC: Float64Array;
  gpPhi: Float64Array;
  /** Pore pressure at each Gauss point (kPa, compression positive). */
  gpU: Float64Array;
  /** Equation number of each dof (2 per node, x then y), −1 if fixed. */
  eq: Int32Array;
  eqCount: number;
  /** Factorised stiffness matrix. */
  K: SkylineMatrix;
  /** External load vector per equation (gravity, surface loads, pore pressure term). */
  f: Float64Array;
  /** Surface edges (3 nodes each: end, midside, end), for plotting and loads. */
  surfaceEdges: Int32Array;
  /** The triangulation the mesh was made from. */
  triangulation: TriMesh;
}

/** y of a polyline at x, extended horizontally beyond its ends. */
export function polylineY(line: { x: readonly number[]; y: readonly number[] }, x: number): number {
  const n = line.x.length;
  if (n === 0) return NaN;
  const lo = Math.min(line.x[0], line.x[n - 1]);
  const hi = Math.max(line.x[0], line.x[n - 1]);
  if (x <= lo) return line.x[0] <= line.x[n - 1] ? line.y[0] : line.y[n - 1];
  if (x >= hi) return line.x[0] <= line.x[n - 1] ? line.y[n - 1] : line.y[0];
  return getYAtX(line.x as number[], line.y as number[], x);
}

function distToPolyline(px: number, py: number, lx: readonly number[], ly: readonly number[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < lx.length; i++) {
    const ax = lx[i], ay = ly[i], bx = lx[i + 1], by = ly[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

function polygonArea(px: readonly number[], py: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = px.length - 1; i < px.length; j = i++) a += px[j] * py[i] - px[i] * py[j];
  return a / 2;
}

/** Build the finite element model of a slope and factorise its stiffness. */
export function buildFeModel(slope: Slope, options: FeModelOptions = {}): FeModel {
  const ext = slope.externalBoundaryXY;
  let bnd: [number, number][] = ext.x.map((v, i) => [v, ext.y[i]]);
  if (bnd.length > 1) {
    const [fx, fy] = bnd[0], [lx, ly] = bnd[bnd.length - 1];
    if (fx === lx && fy === ly) bnd = bnd.slice(0, -1);
  }
  if (polygonArea(bnd.map((p) => p[0]), bnd.map((p) => p[1])) < 0) bnd.reverse();
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [px, py] of bnd) {
    xmin = Math.min(xmin, px); xmax = Math.max(xmax, px);
    ymin = Math.min(ymin, py); ymax = Math.max(ymax, py);
  }
  const span = Math.max(xmax - xmin, ymax - ymin);
  const geoms = slope.materialGeometries;

  // Size field: the target size, at most half the thickness of a thin layer
  // (thickness estimated as 2·area / perimeter of the material polygon).
  const h0 = options.elementSize ?? (ymax - ymin) / 20;
  const layerSize = geoms.map((g) => {
    const a = Math.abs(polygonArea(g.px, g.py));
    let p = 0;
    for (let i = 0, j = g.px.length - 1; i < g.px.length; j = i++) p += Math.hypot(g.px[i] - g.px[j], g.py[i] - g.py[j]);
    return p > 0 ? Math.max((2 * a) / p / 2, h0 / 8) : h0;
  });
  const boxes = geoms.map((g) => [Math.min(...g.px), Math.max(...g.px), Math.min(...g.py), Math.max(...g.py)]);
  const polys = geoms.map((g) => g.px.map((v, i) => [v, g.py[i]] as [number, number]));
  const regionAtFast = (px: number, py: number): number => {
    for (let k = 0; k < polys.length; k++) {
      const b = boxes[k];
      if (px < b[0] || px > b[1] || py < b[2] || py > b[3]) continue;
      if (pointInPolygon(px, py, polys[k])) return k;
    }
    return -1;
  };
  const size = options.sizeField ?? ((px: number, py: number) => {
    const k = regionAtFast(px, py);
    return k >= 0 ? Math.min(h0, layerSize[k]) : h0;
  });

  const segments: [number, number][][] = polys.map((p) => [...p, p[0]]);
  const tm = meshDomain({
    boundary: bnd,
    segments,
    size,
    minAngle: options.minAngle,
    maxVertices: options.maxVertices,
  });

  // T6 connectivity: midside nodes numbered after the corners.
  const nc = tm.x.length;
  const edgeMid = new Map<number, number>();
  const xs: number[] = Array.from(tm.x), ys: number[] = Array.from(tm.y);
  const ne = tm.count;
  const el = new Int32Array(6 * ne);
  const edgeCount = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * nc + b : b * nc + a);
  for (let e = 0; e < ne; e++) {
    const v = [tm.tri[3 * e], tm.tri[3 * e + 1], tm.tri[3 * e + 2]];
    el[6 * e] = v[0]; el[6 * e + 1] = v[1]; el[6 * e + 2] = v[2];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], kk = key(a, b);
      let m = edgeMid.get(kk);
      if (m === undefined) {
        m = xs.length;
        xs.push((tm.x[a] + tm.x[b]) / 2); ys.push((tm.y[a] + tm.y[b]) / 2);
        edgeMid.set(kk, m);
      }
      edgeCount.set(kk, (edgeCount.get(kk) ?? 0) + 1);
      el[6 * e + 3 + k] = m;
    }
  }
  const nn = xs.length;
  const x = Float64Array.from(xs), y = Float64Array.from(ys);

  // Materials per element.
  const materials: Material[] = [];
  const matIndex = new Map<Material, number>();
  const elMaterial = new Int32Array(ne);
  for (let e = 0; e < ne; e++) {
    const a = el[6 * e], b = el[6 * e + 1], c = el[6 * e + 2];
    const cx = (x[a] + x[b] + x[c]) / 3, cy = (y[a] + y[b] + y[c]) / 3;
    let k = regionAtFast(cx, cy);
    if (k < 0) {
      // On a boundary within round-off: nearest polygon edge.
      let best = Infinity;
      for (let r = 0; r < polys.length; r++) {
        const d = distToPolyline(cx, cy, [...geoms[r].px, geoms[r].px[0]], [...geoms[r].py, geoms[r].py[0]]);
        if (d < best) { best = d; k = r; }
      }
    }
    const m = geoms[k].material;
    let mi = matIndex.get(m);
    if (mi === undefined) { mi = materials.length; materials.push(m); matIndex.set(m, mi); }
    elMaterial[e] = mi;
  }

  // Elastic parameters and behaviour per element.
  const params = materials.map((m) => options.materialParameters?.[m.name] ?? {});
  const soilE = materials
    .map((m, i) => (m.model.kind === "high-strength" || m.model.kind === "impenetrable" ? Infinity : params[i].youngsModulus ?? DEFAULT_YOUNGS_MODULUS));
  const minSoilE = Math.min(...soilE.filter(Number.isFinite), DEFAULT_YOUNGS_MODULUS);
  const elE = new Float64Array(ne), elNu = new Float64Array(ne), elPsi = new Float64Array(ne);
  const elElastic = new Uint8Array(ne);
  for (let e = 0; e < ne; e++) {
    const i = elMaterial[e], m = materials[i], p = params[i];
    const rigid = m.model.kind === "high-strength" || m.model.kind === "impenetrable";
    elE[e] = p.youngsModulus ?? (rigid ? RIGID_FACTOR * minSoilE : DEFAULT_YOUNGS_MODULUS);
    elNu[e] = p.poissonsRatio ?? DEFAULT_POISSONS_RATIO;
    elPsi[e] = ((p.dilationAngle ?? 0) * Math.PI) / 180;
    elElastic[e] = rigid ? 1 : 0;
    if (!(elE[e] > 0) || !(elNu[e] > -1 && elNu[e] < 0.5)) {
      throw new RangeError(`invalid elastic parameters for material "${m.name}"`);
    }
  }

  // Gauss points: coordinates, strength, pore pressure.
  const gp = gaussData(x, y, el, ne);
  const ngp = 3 * ne;
  const gpX = new Float64Array(ngp), gpY = new Float64Array(ngp);
  const gpC = new Float64Array(ngp), gpPhi = new Float64Array(ngp), gpU = new Float64Array(ngp);
  const N = new Float64Array(6);
  const surface = slope.surfaceLineXY ?? { x: [xmin, xmax], y: [ymax, ymax] };
  const waterLines = materials.map((m) => slope.getWaterLineForMaterial(m));
  for (let e = 0; e < ne; e++) {
    const m = materials[elMaterial[e]], wl = waterLines[elMaterial[e]];
    for (let g = 0; g < 3; g++) {
      shapeT6(GAUSS_T6[g][0], GAUSS_T6[g][1], N);
      let gx = 0, gy = 0;
      for (let k = 0; k < 6; k++) { gx += N[k] * x[el[6 * e + k]]; gy += N[k] * y[el[6 * e + k]]; }
      const i = 3 * e + g;
      gpX[i] = gx; gpY[i] = gy;
      if (elElastic[e]) { gpC[i] = Infinity; gpPhi[i] = 0; }
      else {
        const yGround = polylineY(surface, gx);
        const s = m.getStrength({ yBottom: gy, x: gx, yGround, alpha: 0, ...(needsLayerTop(m.model) ? { yLayerTop: yGround } : {}) });
        if (s.skipSurface) { gpC[i] = Infinity; gpPhi[i] = 0; elElastic[e] = 1; }
        else { gpC[i] = Math.max(0, s.cohesion); gpPhi[i] = (s.frictionAngle * Math.PI) / 180; }
      }
      if (wl) {
        const yw = polylineY(wl, gx);
        gpU[i] = Number.isFinite(yw) ? Math.max(0, WATER_UNIT_WEIGHT * (yw - gy)) : 0;
      }
    }
  }

  // Boundary edges: free on the ground surface, rollers on vertical sides, fixed elsewhere.
  const tolB = 1e-6 * span;
  const fixX = new Uint8Array(nn), fixY = new Uint8Array(nn);
  const surfEdges: number[] = [];
  for (let e = 0; e < ne; e++) {
    for (let k = 0; k < 3; k++) {
      const a = el[6 * e + k], b = el[6 * e + ((k + 1) % 3)], m = el[6 * e + 3 + k];
      if (edgeCount.get(key(a, b)) !== 1) continue;
      const mx = x[m], my = y[m];
      if (distToPolyline(mx, my, surface.x, surface.y) <= tolB) {
        surfEdges.push(a, m, b);
        continue;
      }
      const vertical = Math.abs(x[b] - x[a]) <= 1e-3 * Math.abs(y[b] - y[a]);
      for (const n of [a, m, b]) {
        fixX[n] = 1;
        if (!vertical) fixY[n] = 1;
      }
    }
  }

  // Equation numbering in reverse Cuthill–McKee order of the nodes.
  const nbr: Set<number>[] = Array.from({ length: nn }, () => new Set<number>());
  for (let e = 0; e < ne; e++) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (a !== b) nbr[el[6 * e + a]].add(el[6 * e + b]);
  const order = reverseCuthillMcKee(nbr.map((s) => Int32Array.from(s)));
  const eq = new Int32Array(2 * nn).fill(-1);
  let neq = 0;
  for (const n of order) {
    if (!fixX[n]) eq[2 * n] = neq++;
    if (!fixY[n]) eq[2 * n + 1] = neq++;
  }
  if (neq === 0) throw new Error("finite element model has no free degrees of freedom");

  // Skyline profile and assembly.
  const first = new Int32Array(neq);
  for (let i = 0; i < neq; i++) first[i] = i;
  const dofs = new Int32Array(12);
  const elDofs = (e: number) => {
    for (let a = 0; a < 6; a++) { dofs[2 * a] = eq[2 * el[6 * e + a]]; dofs[2 * a + 1] = eq[2 * el[6 * e + a] + 1]; }
    return dofs;
  };
  for (let e = 0; e < ne; e++) {
    const d = elDofs(e);
    let lo = Infinity;
    for (const q of d) if (q >= 0 && q < lo) lo = q;
    for (const q of d) if (q >= 0 && lo < first[q]) first[q] = lo;
  }
  const K = new SkylineMatrix(first);
  const ke = new Float64Array(144);
  for (let e = 0; e < ne; e++) {
    stiffnessT6(gp, e, elE[e], elNu[e], ke);
    const d = elDofs(e);
    for (let a = 0; a < 12; a++) {
      const ia = d[a];
      if (ia < 0) continue;
      for (let b = 0; b <= a; b++) {
        const ib = d[b];
        if (ib >= 0) K.add(ia, ib, ke[12 * a + b]);
      }
    }
  }
  K.factor();

  // Loads.
  const f = new Float64Array(neq);
  const addF = (n: number, fx: number, fy: number) => {
    const ix = eq[2 * n], iy = eq[2 * n + 1];
    if (ix >= 0) f[ix] += fx;
    if (iy >= 0) f[iy] += fy;
  };
  for (let e = 0; e < ne; e++) {
    const gamma = materials[elMaterial[e]].unitWeight;
    for (let g = 0; g < 3; g++) {
      const o = (3 * e + g) * GP_STRIDE, w = gp[o + 12], u = gpU[3 * e + g];
      shapeT6(GAUSS_T6[g][0], GAUSS_T6[g][1], N);
      for (let k = 0; k < 6; k++) {
        // self-weight, and ∫ Bᵀ m u: m = (1, 1, 0) in the plane
        addF(el[6 * e + k], u * gp[o + k] * w, -gamma * N[k] * w + u * gp[o + 6 + k] * w);
      }
    }
  }
  // Surface tractions, 4 sub-intervals × 3 Gauss points per edge.
  const GL = [[(1 - Math.sqrt(3 / 5)) / 2, 5 / 18], [0.5, 8 / 18], [(1 + Math.sqrt(3 / 5)) / 2, 5 / 18]];
  const ponding = slope.waterRLXY;
  for (let s = 0; s < surfEdges.length; s += 3) {
    const a = surfEdges[s], m = surfEdges[s + 1], b = surfEdges[s + 2];
    const dx = x[b] - x[a], dy = y[b] - y[a];
    for (let sub = 0; sub < 4; sub++) {
      for (const [t0, wt] of GL) {
        const t = (sub + t0) / 4, w = wt / 4;
        const px = x[a] + t * dx, py = y[a] + t * dy;
        const na = (1 - t) * (1 - 2 * t), nm = 4 * t * (1 - t), nb = t * (2 * t - 1);
        let tx = 0, ty = 0;
        // ponded water: pressure normal to the surface; outward normal × length = (dy, −dx)
        if (ponding) {
          const yw = polylineY(ponding, px);
          const p = Number.isFinite(yw) ? WATER_UNIT_WEIGHT * Math.max(0, yw - py) : 0;
          tx -= p * dy; ty += p * dx;
        }
        // strip loads: vertical, per horizontal metre (downward on a surface traversed right to left)
        for (const q of slope.udls) {
          if (px >= q.x1 && px <= q.x2) ty -= q.magnitude * Math.abs(dx);
        }
        if (tx !== 0 || ty !== 0) {
          addF(a, na * tx * w, na * ty * w);
          addF(m, nm * tx * w, nm * ty * w);
          addF(b, nb * tx * w, nb * ty * w);
        }
      }
    }
  }
  // Line loads at the surface point with that x (the highest if several).
  for (const ll of slope.lineLoads) {
    let best = -1, bestY = -Infinity, bt = 0;
    for (let s = 0; s < surfEdges.length; s += 3) {
      const a = surfEdges[s], b = surfEdges[s + 2];
      const lo = Math.min(x[a], x[b]), hi = Math.max(x[a], x[b]);
      if (ll.x < lo || ll.x > hi || hi - lo < 1e-12) continue;
      const t = (ll.x - x[a]) / (x[b] - x[a]);
      const py = y[a] + t * (y[b] - y[a]);
      if (py > bestY) { bestY = py; best = s; bt = t; }
    }
    if (best < 0) continue;
    const a = surfEdges[best], m = surfEdges[best + 1], b = surfEdges[best + 2];
    addF(a, 0, -ll.magnitude * (1 - bt) * (1 - 2 * bt));
    addF(m, 0, -ll.magnitude * 4 * bt * (1 - bt));
    addF(b, 0, -ll.magnitude * bt * (2 * bt - 1));
  }

  return {
    x, y, nodeCount: nn, cornerCount: nc, el, elementCount: ne,
    materials, elMaterial, elE, elNu, elPsi, elElastic,
    gp, gpX, gpY, gpC, gpPhi, gpU,
    eq, eqCount: neq, K, f,
    surfaceEdges: Int32Array.from(surfEdges),
    triangulation: tm,
  };
}

/**
 * Strains of every Gauss point from a displacement vector (per equation):
 * εx, εy, γxy, εz (= 0 in plane strain), 4 per Gauss point.
 */
export function gaussStrains(model: FeModel, u: Float64Array, out: Float64Array): void {
  const { el, eq, gp, elementCount } = model;
  for (let e = 0; e < elementCount; e++) {
    for (let g = 0; g < 3; g++) {
      const o = (3 * e + g) * GP_STRIDE;
      let ex = 0, ey = 0, gxy = 0;
      for (let k = 0; k < 6; k++) {
        const n = el[6 * e + k];
        const ix = eq[2 * n], iy = eq[2 * n + 1];
        const ux = ix >= 0 ? u[ix] : 0, uy = iy >= 0 ? u[iy] : 0;
        ex += gp[o + k] * ux; ey += gp[o + 6 + k] * uy;
        gxy += gp[o + 6 + k] * ux + gp[o + k] * uy;
      }
      const i = 4 * (3 * e + g);
      out[i] = ex; out[i + 1] = ey; out[i + 2] = gxy; out[i + 3] = 0;
    }
  }
}

/** Elastic solution: displacements per equation and effective stresses (σx, σy, τxy, σz) per Gauss point. */
export function solveElastic(model: FeModel): { u: Float64Array; stress: Float64Array } {
  const u = Float64Array.from(model.f);
  model.K.solve(u);
  const ngp = 3 * model.elementCount;
  const strain = new Float64Array(4 * ngp);
  gaussStrains(model, u, strain);
  const stress = new Float64Array(4 * ngp);
  for (let i = 0; i < ngp; i++) {
    const e = Math.floor(i / 3);
    const E = model.elE[e], nu = model.elNu[e];
    const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
    const ex = strain[4 * i], ey = strain[4 * i + 1], g = strain[4 * i + 2];
    const tr = ex + ey;
    stress[4 * i] = lam * tr + 2 * mu * ex;
    stress[4 * i + 1] = lam * tr + 2 * mu * ey;
    stress[4 * i + 2] = mu * g;
    stress[4 * i + 3] = lam * tr;
  }
  return { u, stress };
}
