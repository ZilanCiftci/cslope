/**
 * 3D effects of a temporary slope after SGI's guidance (Vägledning 8,
 * Temporära slänter, 2024, section 2.1): the critical stretch of length L
 * is bounded by two plane end faces, whose undrained shear strength adds
 * resisting moment to the 2D slip surface.
 *
 *   F_P = (M_R L + 2 Σ A C c_u) / (M_E L) = F_2D + 2 Σ A C c_u / (M_E L)          (2-2)
 *   F_3D = F_2D + 0.75 (F_P − F_2D)                     infinitely overstrong     (2-3)
 *   F_3D = F_2D + (1 − F_2D,krit,min / F_2D,överstark,min) 0.75 (F_P − F_2D)  finite (2-4)
 *
 * M_E is the driving moment of the surface about its centre, M_R = F_2D M_E,
 * and Σ A C c_u the end face's moment: its area of cohesive soil times the
 * lever arm and the undrained shear strength, here ∫ c_u r dA over the face
 * (r the distance to the centre), so that c_u varying with depth and a
 * layered face need no sectors. Only cohesive soil counts in the end faces:
 * the undrained materials (φ = 0) and the undrained branch c_u of a
 * combined material (clay in a combined analysis), not friction soil, and not the materials
 * given in `excludeMaterials` (a fissured dry crust, for example). The 3D
 * factor is the smallest over the analysed circular surfaces, as the
 * surface of the smallest F_3D is generally shallower than the critical 2D
 * one (guidance, section 2.1.2). The sliding mass is the soil inside the
 * circle between its entry (or its tension crack) and its exit, as the
 * slices take it. M_E is the soil's (total) weight and the loads: forces of
 * reinforcement, piles and water in a crack or above the ground are not in
 * it, and the result warns when the model has them.
 */
import type { Slope } from "./slope";
import type { Sgi3dOptions, Sgi3dResult, Sgi3dSurface } from "../types/sgi3d";
import { getYAtX } from "../math/interpolation";
import { isPointInPolygon } from "../math/polygon";
import { designStrength, needsLayerTop, resolveStrength, resolveUnitWeight } from "../types/strength";
import { materialLayerTopAt } from "./geometry-ops";

/**
 * F_3D of an analysed slope (after `analyseSlope`): the smallest over its
 * circular surfaces with a factor of safety. Null when it has none.
 * Strengths and loads are design values when the slope has partial factors;
 * the end faces take the undrained strength without anisotropy (its
 * factor at α = 0, the direct shear strength).
 */
export function sgi3dFactorOfSafety(slope: Slope, options: Sgi3dOptions): Sgi3dResult | null {
  const L = options.length;
  if (!(Number.isFinite(L) && L > 0)) throw new Error("The length of the critical stretch must be a positive number");
  const ov = options.overstrongF2D;
  if (ov !== undefined && !(Number.isFinite(ov) && ov > 0)) throw new Error("F2D of the overstrong stretches must be a positive number");
  const h = options.cellSize ?? 0.05;
  if (!(h > 0)) throw new Error("The cell size must be positive");
  const exclude = new Set(options.excludeMaterials ?? []);

  const valid = slope.search.filter((p) => p.fos != null && Number.isFinite(p.fos));
  // composite circles (along rock or the model's base) are not circles in 3D either
  const planes = valid.filter((p) => p.radius > 0 && !p.points && !p.composite);
  if (planes.length === 0) return null;
  // F_2D,krit,min: the analysis's smallest F_2D, non-circular surfaces included
  const f2dCritical = Math.min(...valid.map((p) => p.fos!));
  const kFinite = ov === undefined ? 1 : Math.min(1, Math.max(0, 1 - f2dCritical / ov));

  // The sliding mass of a surface: the soil inside its circle between where
  // it enters (or its tension crack) and where it leaves the ground, as the
  // slices take it (not where the circle dips into the ground again beyond).
  const span = (p: (typeof planes)[number]): [number, number] => [Math.max(p.lc[0], p.crack?.[0] ?? -Infinity), p.rc[0]];
  const surf = slope.surfaceLineXY;
  if (!surf) return null;
  // cells over the sliding masses, from the lowest circle bottom up to the ground: unit weight and the end face's c_u
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
  for (const p of planes) { const [a, b] = span(p); x0 = Math.min(x0, a); x1 = Math.max(x1, b); y0 = Math.min(y0, p.cy - p.radius); }
  let y1 = -Infinity;
  for (let i = 0; i < surf.x.length; i++) if (surf.x[i] >= x0 - 1 && surf.x[i] <= x1 + 1) y1 = Math.max(y1, surf.y[i]);
  y1 = Math.max(y1, getYAtX(surf.x, surf.y, x0), getYAtX(surf.x, surf.y, x1));
  // at most about 400 000 cells: coarser for a large model
  const hUsed = Math.max(h, Math.sqrt(((x1 - x0) * (y1 - y0)) / 4e5));
  const geos = slope.materialGeometries;
  const f = slope.partialFactors;
  const cx: number[] = [], cy: number[] = [], gam: number[] = [], cu: number[] = [];
  for (let x = x0 + hUsed / 2; x < x1; x += hUsed) {
    const yGround = getYAtX(surf.x, surf.y, x);
    if (!Number.isFinite(yGround)) continue;
    for (let y = y0 + hUsed / 2; y < Math.min(y1, yGround); y += hUsed) {
      const geo = geos.find((g) => isPointInPolygon(x, y, g.px, g.py));
      if (!geo) continue;
      const m = geo.material, model = m.model;
      if (model.kind === "impenetrable" || model.kind === "high-strength") continue;
      // total unit weight: saturated below the material's water line
      let g = resolveUnitWeight(model, m.unitWeight, x, y);
      if (model.unitWeightSat !== undefined) {
        const wl = slope.getWaterLineForMaterial(m);
        const yw = wl ? getYAtX(wl.x, wl.y, x) : NaN;
        if (Number.isFinite(yw) && y < yw) g = model.unitWeightSat;
      }
      let c = 0;
      if (!exclude.has(m.name)) {
        const yLayerTop = needsLayerTop(model) ? (materialLayerTopAt(geos, m, x, y) ?? undefined) : undefined;
        const st = resolveStrength(model, { yBottom: y, x, yGround, yLayerTop, alpha: 0 });
        const d = designStrength(model.kind, st, f);
        if (d.undrained && Number.isFinite(d.cohesion)) c = d.cohesion;
        // combined clay: the end faces of a temporary slope take its undrained strength
        else if (st.isCombined && Number.isFinite(d.cohesionUndrained)) c = d.cohesionUndrained;
      }
      cx.push(x); cy.push(y); gam.push(g); cu.push(c);
    }
  }
  const n = cx.length, dA = hUsed * hUsed;
  const qf = f?.variableLoad ?? 1;

  const evaluate = (p: (typeof planes)[number]): Sgi3dSurface | null => {
    const r2 = p.radius * p.radius;
    const [xa, xb] = span(p);
    let me = 0, mc = 0, area = 0;
    for (let i = 0; i < n; i++) {
      if (cx[i] < xa || cx[i] > xb) continue;
      const dx = cx[i] - p.cx, dy = cy[i] - p.cy, d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      me += gam[i] * dx;
      if (cu[i] > 0) { mc += cu[i] * Math.sqrt(d2); area += 1; }
    }
    me *= dA; mc *= dA; area *= dA;
    // loads on the ground above the surface
    for (const u of slope.udls) {
      const k = Math.max(8, Math.ceil((u.x2 - u.x1) / hUsed));
      const w = (u.x2 - u.x1) / k;
      for (let j = 0; j < k; j++) {
        const xm = u.x1 + (j + 0.5) * w, dx = xm - p.cx;
        if (dx * dx >= r2 || xm < xa || xm > xb) continue;
        const yg = getYAtX(surf.x, surf.y, xm);
        if (p.cy - Math.sqrt(r2 - dx * dx) < yg) {
          me += u.magnitude * qf * w * dx;
          // a load normal to the ground: its horizontal part p·dy at the ground
          if (u.direction === "normal") {
            const sl = (getYAtX(surf.x, surf.y, xm + w / 2) - getYAtX(surf.x, surf.y, xm - w / 2)) / w;
            me -= u.magnitude * qf * w * sl * (p.cy - yg);
          }
        }
      }
    }
    for (const l of slope.lineLoads) {
      const dx = l.x - p.cx;
      if (dx * dx < r2 && l.x >= xa && l.x <= xb && p.cy - Math.sqrt(r2 - dx * dx) < getYAtX(surf.x, surf.y, l.x)) me += l.magnitude * qf * dx;
    }
    me = Math.abs(me);
    if (!(me > 0)) return null;
    const f2d = p.fos!;
    const fp = f2d + (2 * mc) / (L * me);
    const f3d = f2d + kFinite * 0.75 * (fp - f2d);
    const c = slope.toModelCircle(p);
    return { ...c, f2d, drivingMoment: me, endFaceArea: area, endFaceMoment: mc, fp, f3d };
  };

  // F_3D ≥ F_2D: once a surface's F_2D is past the smallest F_3D found, none further is lower
  const sorted = [...planes].sort((a, b) => a.fos! - b.fos!);
  let best: Sgi3dSurface | null = null;
  for (const p of sorted) {
    if (best && p.fos! >= best.f3d) break;
    const s = evaluate(p);
    if (s && (!best || s.f3d < best.f3d)) best = s;
  }
  if (!best) return null;
  const warnings: string[] = [];
  if (best.f3d > 1.25 * f2dCritical) {
    warnings.push("F3D is more than 25 % above the critical F2D: SGI's guidance asks for the 3D factor to be judged with care (section 2.1.2).");
  }
  if (valid.some((p) => p.points || p.composite)) {
    warnings.push("Non-circular and composite surfaces are not included in the 3D factor (their F2D counts as F2D,krit,min).");
  }
  // what the guidance's M_E (the soil's weight and the loads) leaves out, though the 2D factor has it
  const left: string[] = [];
  if (slope.reinforcements.length > 0) left.push("reinforcement");
  if (slope.piles.length > 0) left.push("piles");
  if (slope.tensionCrackWater > 0 && planes.some((p) => p.crack)) left.push("water in the tension crack");
  const wl = slope.waterRLXY;
  if (wl && wl.x.some((x, i) => x >= x0 && x <= x1 && wl.y[i] > getYAtX(surf.x, surf.y, x) + 1e-6)) left.push("free water above the ground");
  if (left.length) warnings.push(`The driving moment M_E is the soil's weight and the loads; ${left.join(", ")} are not in it, though the 2D factor includes them.`);
  const names = new Set(slope.materialGeometries.map((g) => g.material.name));
  const unknown = [...exclude].filter((n) => !names.has(n));
  if (unknown.length) warnings.push(`Not in the model, so not left out of the end faces: ${unknown.join(", ")}.`);
  return {
    factorOfSafety: best.f3d,
    f2dCritical,
    critical: best,
    equation: ov === undefined ? "2-3" : "2-4",
    options: { length: L, overstrongF2D: ov ?? null, excludeMaterials: [...exclude] },
    warnings,
  };
}
