/**
 * A calculation of a .stix project file as a cSlope slope definition: its last
 * stage's geometry, soils (Mohr-Coulomb, Su with the state's POP, OCR or
 * yield stress as SHANSEP, the Su table, the sigma-tau table as a
 * shear-normal function; a different model above the phreatic level as
 * the strength above the water), the waternet (head and reference lines),
 * loads (uniform and line loads, earthquake), geotextiles, the method and
 * the file's critical slip plane for comparison. What does not carry over
 * is listed in the notes.
 */

import { WATER_UNIT_WEIGHT, waternetPorePressure, type AnalysisOptions, type MaterialModel, type SlopeDefinition } from "@cslope/engine";
import { regionInteriorPoint } from "../../../utils/regions";
import { surfaceYAtX } from "../../view/surface";
import { MAX_REGIONS, regionsToGeometry } from "../gsz/gsz-to-definition";
import { num, pts, type Pt, type StixCalculation, type StixFile, type StixStage } from "./stix-read";

type Json = Record<string, unknown>;

/** A value of the file as text: a string, number or boolean as written; anything else (missing, or an object) as `fallback`. */
function text(v: unknown, fallback = ""): string {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : fallback;
}

export interface StixImport {
  name: string;
  definition: SlopeDefinition;
  options: Partial<AnalysisOptions>;
  notes: string[];
  /**
   * The file's critical slip plane (its points along the base) and factor
   * of safety; with its circle's centre and radius when it is a circle.
   */
  reference?: { fos: number; points: Pt[]; cx?: number; cy?: number; r?: number };
}

/** y of a polyline (x increasing) at x, constant beyond its ends. */
function lineAt(l: Pt[], x: number): number {
  if (x <= l[0][0]) return l[0][1];
  if (x >= l[l.length - 1][0]) return l[l.length - 1][1];
  let k = 1;
  while (k < l.length - 1 && l[k][0] < x) k++;
  const [a, ay] = l[k - 1], [b, by] = l[k];
  return b > a ? ay + ((x - a) / (b - a)) * (by - ay) : by;
}

/** Whether p lies inside the ring (or on its edge, with `edge`). */
function pointInRing(p: Pt, ring: Pt[], edge = false): boolean {
  const tol = 1e-7 * Math.max(1, ...ring.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    // on the edge
    const cross = (p[0] - xj) * (yi - yj) - (p[1] - yj) * (xi - xj);
    if (Math.abs(cross) <= tol * Math.hypot(xi - xj, yi - yj) && p[0] >= Math.min(xi, xj) - tol && p[0] <= Math.max(xi, xj) + tol && p[1] >= Math.min(yi, yj) - tol && p[1] <= Math.max(yi, yj) + tol) return edge;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** A point well inside a ring and outside its holes (the farthest from their edges on a grid). */
function pointInRegion(ring: Pt[], holes: Pt[][]): Pt {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const segDist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const edges = [ring, ...holes].flatMap((r) => r.map((a, i): [Pt, Pt] => [a, r[(i + 1) % r.length]]));
  let best: Pt = ring[0], bestD = -1;
  const n = 60;
  for (let i = 1; i < n; i++) for (let k = 1; k < n; k++) {
    const p: Pt = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * k) / n];
    if (!pointInRing(p, ring) || holes.some((h) => pointInRing(p, h, true))) continue;
    const d = Math.min(...edges.map(([a, b]) => segDist(p, a, b)));
    if (d > bestD) [best, bestD] = [p, d];
  }
  return best;
}

/** The state (POP, OCR or yield stress) of a layer, from its state point or the nearest state line. */
function layerState(state: Json | undefined, layerId: string, centroid: Pt, notes: string[], svAt?: (p: Pt) => number, layerLabel = layerId): Json | undefined {
  const points = ((state?.StatePoints as Json[] | undefined) ?? []).filter((p) => p.LayerId === layerId);
  if (points.length > 0) {
    const s = points.map((p) => p.Stress as Json);
    const key = (x: Json) => `${text(x.StateType)}:${text(x.Pop)}:${text(x.Ocr)}:${text(x.YieldStress)}`;
    if (new Set(s.map(key)).size > 1) notes.push(`Layer "${layerLabel}": ${s.length} state points with different values; the first is used for the whole layer.`);
    const at = pts([points[0].Point])[0];
    return at && svAt ? { ...s[0], __sv: svAt(at) } : s[0];
  }
  // a state line: its value above or below it at the layer's centroid
  let best: { d: number; v: Json } | undefined;
  for (const line of (state?.StateLines as Json[] | undefined) ?? []) {
    const lp = pts(line.Points).sort((a, b) => a[0] - b[0]);
    if (lp.length < 2 || centroid[0] < lp[0][0] || centroid[0] > lp[lp.length - 1][0]) continue;
    let k = 1;
    while (k < lp.length - 1 && lp[k][0] < centroid[0]) k++;
    const [x0, y0] = lp[k - 1], [x1, y1] = lp[k];
    const y = x1 > x0 ? y0 + ((centroid[0] - x0) / (x1 - x0)) * (y1 - y0) : y0;
    const d = Math.abs(centroid[1] - y);
    const values = ((line.Values as Json[] | undefined) ?? []).filter(Boolean).sort((a, b) => (num(a.X) ?? 0) - (num(b.X) ?? 0));
    if (values.length === 0) continue;
    // the value nearest in x (the file interpolates between them)
    const v = values.reduce((m, q) => (Math.abs((num(q.X) ?? 0) - centroid[0]) < Math.abs((num(m.X) ?? 0) - centroid[0]) ? q : m));
    const above = centroid[1] > y;
    const stress = (above ? v.Above : v.Below) as Json | undefined;
    // (a yield stress or OCR at the line, just above or below it)
    const vx = num(v.X) ?? centroid[0];
    const lineY = (() => {
      let k2 = 1;
      while (k2 < lp.length - 1 && lp[k2][0] < vx) k2++;
      const [a0, b0] = lp[k2 - 1], [a1, b1] = lp[k2];
      return a1 > a0 ? b0 + ((vx - a0) / (a1 - a0)) * (b1 - b0) : b0;
    })();
    const at: Pt = [vx, lineY + (above ? 1e-3 : -1e-3)];
    if (stress && (!best || d < best.d)) best = { d, v: svAt ? { ...stress, __sv: svAt(at) } : stress };
  }
  return best?.v;
}

/** The model of a soil's strength type (one side of the phreatic level). */
function strengthModel(soil: Json, type: string, state: Json | undefined, unitWeight: number, notes: string[], fromEarlier = false): MaterialModel {
  const name = text(soil.Name ?? soil.Code, "soil");
  if (type === "MohrCoulombAdvanced" || type === "MohrCoulombClassic") {
    const mc = (soil[`${type}ShearStrengthModel`] ?? {}) as Json;
    let phi = num(mc.FrictionAngle) ?? 0;
    let c = num(mc.Cohesion) ?? 0;
    if (!(c > 0) && !(phi > 0)) {
      notes.push(`Material "${name}": its ${type === "MohrCoulombClassic" ? "Mohr-Coulomb" : "Mohr-Coulomb (advanced)"} strength is c = 0, φ = 0; a placeholder c = 0.001 kPa is used (cSlope needs some strength).`);
      return { kind: "mohr-coulomb", unitWeight, cohesion: 0.001, frictionAngle: 0 };
    }
    // the advanced model's dilatancy ψ < φ lowers the strength on the slip
    // plane (non-associated flow; Davis 1968):
    // c* = c·cos ψ·cos φ / (1 − sin ψ·sin φ), tan φ* = cos ψ·sin φ / (1 − sin ψ·sin φ)
    const psi = type === "MohrCoulombAdvanced" ? Math.min(num(mc.Dilatancy) ?? phi, phi) : phi;
    if (psi < phi - 1e-9) {
      const r = Math.PI / 180, k = 1 - Math.sin(psi * r) * Math.sin(phi * r);
      const c0 = c, phi0 = phi;
      c = (c * Math.cos(psi * r) * Math.cos(phi * r)) / k;
      phi = Math.atan((Math.cos(psi * r) * Math.sin(phi * r)) / k) / r;
      notes.push(`Material "${name}": the dilatancy ψ = ${psi}° below φ = ${phi0}° reduces the strength (Davis): c = ${c0} → ${+c.toFixed(3)} kPa, φ = ${phi0}° → ${+phi.toFixed(2)}°.`);
    }
    return { kind: "mohr-coulomb", unitWeight, cohesion: c, frictionAngle: phi };
  }
  if (type === "Su") {
    const su = (soil.SuShearStrengthModel ?? {}) as Json;
    const ratio = num(su.ShearStrengthRatio) ?? 0, exponent = num(su.StrengthIncreaseExponent) ?? 1;
    const st = stateOf(state);
    if (!st) notes.push(`Material "${name}": no state (POP, OCR or yield stress) for its Su; OCR = 1 is used.`);
    return { kind: "shansep", unitWeight, ratio, exponent, ...(st ?? { ocr: 1 }), ...(fromEarlier ? { yieldFromEarlierStage: true } : {}) };
  }
  if (type === "SuTable") {
    const t = (soil.SuTable ?? {}) as Json;
    const table = ((t.SuTablePoints as Json[] | undefined) ?? [])
      .flatMap((p) => {
        const s = num(p.EffectiveStress), u = num(p.Su);
        return s !== undefined && u !== undefined ? [[s, u] as [number, number]] : [];
      })
      .sort((a, b) => a[0] - b[0]);
    if (table.length > 0) {
      const m = num(t.StrengthIncreaseExponent) ?? 1;
      const st = stateOf(state);
      if (st && m !== 0 && !("ocr" in st && st.ocr === 1)) notes.push(`Material "${name}": the Su table's increase with OCR (exponent ${m}) is not imported; the table's Su is used.`);
      return { kind: "shansep", unitWeight, ratio: 0, suByStress: table };
    }
  }
  if (type === "SigmaTauTable") {
    const t = (soil.SigmaTauTable ?? {}) as Json;
    const table = ((t.SigmaTauTablePoints as Json[] | undefined) ?? [])
      .flatMap((p) => {
        const s = num(p.EffectiveStress), u = num(p.ShearStrength);
        return s !== undefined && u !== undefined ? [[s, Math.max(0, u)] as [number, number]] : [];
      })
      .sort((a, b) => a[0] - b[0]);
    if (table.length >= 2) return { kind: "shear-normal", unitWeight, points: table };
  }
  notes.push(`Material "${name}": the strength model "${type}" is not imported; Mohr-Coulomb with its c′ and φ′ is used.`);
  const mc = (soil.MohrCoulombAdvancedShearStrengthModel ?? soil.MohrCoulombClassicShearStrengthModel ?? {}) as Json;
  return { kind: "mohr-coulomb", unitWeight, cohesion: num(mc.Cohesion) ?? 0, frictionAngle: num(mc.FrictionAngle) ?? 0 };
}

/**
 * The SHANSEP stress history of a state, as a POP: a yield stress or OCR
 * given at a point becomes the POP there (σ′y − σ′v at the point, with
 * `sv`, the effective vertical stress there), which then holds for the
 * layer, as the file applies it.
 */
function stateOf(state: Json | undefined): { pop: number } | { ocr: number } | { yieldStress: number } | undefined {
  if (!state) return undefined;
  const type = text(state.StateType);
  const sv = num(state.__sv);
  if (type === "Pop") return { pop: num(state.Pop) ?? 0 };
  if (type === "Ocr") return sv !== undefined ? { pop: Math.max(0, ((num(state.Ocr) ?? 1) - 1) * sv) } : { ocr: num(state.Ocr) ?? 1 };
  if (type === "YieldStress") return sv !== undefined ? { pop: Math.max(0, (num(state.YieldStress) ?? 0) - sv) } : { yieldStress: num(state.YieldStress) ?? 0 };
  return undefined;
}

/** The parts of a stage's slope definition, and the POP of its layers by label. */
function stagePart(file: StixFile, st: StixStage, notes: string[], inherited?: Map<string, number>) {
  const popByLabel = new Map<string, number>();
  const layers = ((st.geometry?.Layers as Json[] | undefined) ?? []).filter(Boolean);
  if (layers.length === 0) throw new Error(`Stage "${st.label}" has no geometry.`);
  if (layers.length > MAX_REGIONS) throw new Error(`Stage "${st.label}" has ${layers.length} layers; at most ${MAX_REGIONS} can be imported.`);
  const soilOfLayer = new Map<string, string>();
  for (const sl of (st.soilLayers?.SoilLayers as Json[] | undefined) ?? []) {
    if (typeof sl.LayerId === "string" && typeof sl.SoilId === "string") soilOfLayer.set(sl.LayerId, sl.SoilId);
  }

  // points by coordinates (the layers share their corners)
  const points = new Map<number, Pt>();
  const idOf = new Map<string, number>();
  const pid = (p: Pt) => {
    const k = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    let id = idOf.get(k);
    if (id === undefined) {
      id = idOf.size + 1;
      idOf.set(k, id);
      points.set(id, p);
    }
    return id;
  };
  const allPolys = layers.flatMap((l, i) => {
    const ring = pts(l.Points);
    return ring.length >= 3 ? [{ id: i, pts: ring.map(pid), layer: l, ring }] : [];
  });
  // A layer lying inside another (a lens, a dike core) is a hole in it:
  // the outer layers make the outline, the inner ones closed boundaries.
  const inside = (a: Pt[], b: Pt[]) => a.every((p) => pointInRing(p, b, true));
  const contained = new Set(allPolys.filter((p) => allPolys.some((q) => q !== p && inside(p.ring, q.ring) && !inside(q.ring, p.ring))).map((p) => p.id));
  const polys = allPolys.filter((p) => !contained.has(p.id));
  const geo = regionsToGeometry(polys, points, notes);
  for (const p of allPolys) if (contained.has(p.id)) {
    geo.boundaries.push([...p.ring, p.ring[0]]);
    geo.rings.push({ id: p.id, pts: p.ring });
  }
  const holesOf = (id: number) => {
    const ring = allPolys.find((p) => p.id === id)!.ring;
    return allPolys.filter((q) => q.id !== id && contained.has(q.id) && inside(q.ring, ring)).map((q) => q.ring);
  };

  // water: the phreatic line for all materials; head and reference lines as a waternet
  if (st.waterDefinition === "WaterMesh") notes.push(`Stage "${st.label}" takes its pore pressures from a mesh (a groundwater flow calculation); that is not imported, and the stage's head and reference lines (if any) are used instead.`);
  const wn = st.waternet;
  const headLines = ((wn?.HeadLines as Json[] | undefined) ?? []).map((h) => ({ id: String(h.Id), points: pts(h.Points).sort((a, b) => a[0] - b[0]) })).filter((h) => h.points.length >= 2);
  const headLabel = (id: string) => {
    const h = ((wn?.HeadLines as Json[] | undefined) ?? []).find((l) => String(l.Id) === id);
    return text(h?.Label, id);
  };
  const refs = ((wn?.ReferenceLines as Json[] | undefined) ?? [])
    .map((r) => ({ points: pts(r.Points).sort((a, b) => a[0] - b[0]), ...(typeof r.TopHeadLineId === "string" ? { topHeadLineId: r.TopHeadLineId } : {}), ...(typeof r.BottomHeadLineId === "string" ? { bottomHeadLineId: r.BottomHeadLineId } : {}) }))
    .filter((r) => r.points.length >= 2);
  const phreaticId = typeof wn?.PhreaticLineId === "string" ? wn.PhreaticLineId : undefined;
  let phreatic = headLines.find((h) => h.id === phreaticId)?.points;
  if (!phreatic && phreaticId === undefined && headLines.length > 0) {
    // No phreatic line: the materials would have no water line (so their
    // strength above the water applied everywhere and γsat went unused).
    // Take the top head line of the uppermost reference line, else the
    // first head line.
    const meanY = (l: Pt[]) => l.reduce((a, p) => a + p[1], 0) / l.length;
    const top = [...refs]
      .filter((r) => r.topHeadLineId !== undefined && headLines.some((h) => h.id === r.topHeadLineId))
      .sort((a, b) => meanY(b.points) - meanY(a.points))[0];
    const line = headLines.find((h) => h.id === top?.topHeadLineId) ?? headLines[0];
    phreatic = line.points;
    notes.push(
      `Stage "${st.label}" has no phreatic line; the phreatic level (for the saturated unit weight, free water and the strength above the water) is taken from head line "${headLabel(line.id)}"${top ? " (the top head line of the uppermost reference line)" : ""}.`,
    );
  }
  const xs = geo.outline.map((p) => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const extend = (l: Pt[]): Pt[] => {
    const out = l.filter((p) => p[0] >= x0 - 1e-9 && p[0] <= x1 + 1e-9);
    const at = (x: number) => {
      let k = 1;
      while (k < l.length - 1 && l[k][0] < x) k++;
      const [a, ay] = l[k - 1], [b, by] = l[k];
      return x <= l[0][0] ? l[0][1] : x >= l[l.length - 1][0] ? l[l.length - 1][1] : ay + ((x - a) / (b - a)) * (by - ay);
    };
    if (out.length === 0 || out[0][0] > x0) out.unshift([x0, at(x0)]);
    if (out[out.length - 1][0] < x1) out.push([x1, at(x1)]);
    return out;
  };
  const waterTable = phreatic ? { mode: "custom" as const, value: extend(phreatic), followBoundary: false } : undefined;
  const waternet = refs.length > 0 || headLines.length > 1 ? { headLines, referenceLines: refs, ...(phreaticId ? { phreaticLineId: phreaticId } : {}) } : undefined;
  // the file's unit weight of water (kN/m³) as the model's (absent: 9.807)
  const gwFile = num(wn?.UnitWeightWater);
  if (gwFile !== undefined && !(gwFile > 0)) notes.push(`The unit weight of water in the file (${gwFile}) is not valid; ${WATER_UNIT_WEIGHT} kN/m³ is used.`);
  const gammaW = gwFile !== undefined && gwFile > 0 ? gwFile : WATER_UNIT_WEIGHT;

  // the effective vertical stress at a point (for a state given as a yield
  // stress or OCR at it): the soil column above it, γ above or below the
  // phreatic level, free water on the ground, less the pore pressure there
  const gammaAt = (p: Pt): number => {
    const hit = [...allPolys.filter((q) => contained.has(q.id)), ...polys].find((q) => pointInRing(p, q.ring, true));
    const soil = hit ? file.soils.find((so) => so.Id === soilOfLayer.get(String(hit.layer.Id))) : undefined;
    if (!soil) return 0;
    const ga = num(soil.VolumetricWeightAbovePhreaticLevel) ?? 18, gb = num(soil.VolumetricWeightBelowPhreaticLevel) ?? ga;
    const hp = phreatic ? lineAt(phreatic, p[0]) : -Infinity;
    return p[1] > hp ? ga : gb;
  };
  const svAt = (p: Pt): number => {
    const top = surfaceYAtX(geo.outline, p[0]);
    if (top === null || !(top > p[1])) return 0;
    const n = 400, dz = (top - p[1]) / n;
    let sv = 0;
    for (let k = 0; k < n; k++) sv += gammaAt([p[0], p[1] + (k + 0.5) * dz]) * dz;
    if (phreatic) sv += Math.max(0, lineAt(phreatic, p[0]) - top) * gammaW;
    const u = waternet ? waternetPorePressure(waternet, p[0], p[1], gammaW) : phreatic ? Math.max(0, (lineAt(phreatic, p[0]) - p[1]) * gammaW) : 0;
    return sv - u;
  };

  // materials: one per soil and state (the layers of a soil can have their own state)
  const materials: SlopeDefinition["materials"] = [];
  const nameOf = new Map<string, string>();
  const regionAssignments: SlopeDefinition["regionAssignments"] = [];
  const materialOfLayer = new Map<string, string>();
  for (const r of geo.rings) {
    const layer = allPolys.find((p) => p.id === r.id)!.layer;
    const soilId = soilOfLayer.get(String(layer.Id));
    const soil = file.soils.find((s) => s.Id === soilId);
    if (!soil) {
      notes.push(`Layer "${text(layer.Label ?? layer.Id)}" has no soil; it is left as the first material.`);
      continue;
    }
    const holes = holesOf(r.id);
    const centroid = holes.length === 0 ? regionInteriorPoint(r.pts.map((p) => p[0]), r.pts.map((p) => p[1])) : pointInRegion(r.pts, holes);
    const own = layerState(st.state, String(layer.Id), centroid, notes, svAt, String(layer.Label ?? layer.Id));
    // no state of its own: the stress history of the earlier stage (its yield stresses)
    // (keyed by label and soil, as the format matches a layer to the one of an earlier stage)
    const label = `${String(layer.Label ?? layer.Id)}|${soilId}`;
    const kept = own ? undefined : inherited?.get(label);
    const state = own ?? (kept !== undefined ? { StateType: "Pop", Pop: kept, __earlier: true } : undefined);
    const so = stateOf(own);
    if (so && "pop" in so) {
      const had = popByLabel.get(label);
      if (had !== undefined && Math.abs(had - so.pop) > 1e-9) notes.push(`Stage "${st.label}" has several layers labeled "${String(layer.Label ?? layer.Id)}" with different states; a later stage takes the last one's.`);
      popByLabel.set(label, so.pop);
    }
    const above = text(soil.ShearStrengthModelTypeAbovePhreaticLevel, "MohrCoulombAdvanced");
    const below = text(soil.ShearStrengthModelTypeBelowPhreaticLevel, above);
    const gAbove = num(soil.VolumetricWeightAbovePhreaticLevel) ?? 18;
    const gBelow = num(soil.VolumetricWeightBelowPhreaticLevel) ?? gAbove;
    const key = `${soilId}|${JSON.stringify(state ?? null)}`;
    let name = nameOf.get(key);
    if (!name) {
      const base = text(soil.Name ?? soil.Code, `Soil ${soilId}`);
      name = base;
      for (let k = 2; materials.some((m) => m.name === name); k++) name = `${base} (${k})`;
      nameOf.set(key, name);
      const belowModel = strengthModel(soil, below, state, gAbove, notes, kept !== undefined);
      const model: MaterialModel = {
        ...belowModel,
        ...(gBelow !== gAbove ? { unitWeightSat: gBelow } : {}),
        ...(above !== below ? { aboveWater: strengthModel(soil, above, state, gAbove, notes, kept !== undefined) } : {}),
      };
      const colour = file.colours.get(String(soilId));
      materials.push({ name, model, ...(colour ? { color: colour } : {}) });
    }
    regionAssignments.push({ point: centroid, materialName: name });
    materialOfLayer.set(String(layer.Id), name);
  }
  if (materials.length === 0) throw new Error(`Stage "${st.label}" assigns no soil to any layer.`);

  // loads
  const loads = st.loads ?? {};
  const options: Partial<AnalysisOptions> = {};
  if (gammaW !== WATER_UNIT_WEIGHT) options.waterUnitWeight = gammaW;
  const consolidations = (l: Json) => ((l.Consolidations as Json[] | undefined) ?? []).filter((c) => (num(c.Degree) ?? 100) < 100);
  const udls = ((loads.UniformLoads as Json[] | undefined) ?? []).flatMap((u) => {
    const a = num(u.Start), b = num(u.End), q = num(u.Magnitude);
    if (a === undefined || b === undefined || q === undefined || !(b > a)) return [];
    // degrees of consolidation below 100 %: the rest of the load as excess
    // pore pressure in the layer (per material; layers sharing one take the first)
    const excess: { material: string; ratio: number }[] = [];
    for (const c of consolidations(u)) {
      const material = materialOfLayer.get(String(c.LayerId));
      if (!material) continue;
      const ratio = 1 - Math.min(100, Math.max(0, num(c.Degree) ?? 100)) / 100;
      const had = excess.find((e) => e.material === material);
      if (!had) excess.push({ material, ratio });
      else if (Math.abs(had.ratio - ratio) > 1e-9) notes.push(`Material "${material}" has layers with different degrees of consolidation under a uniform load; the first (${(100 * (1 - had.ratio)).toFixed(0)} %) is used.`);
    }
    return [{ magnitude: q, x1: a, x2: b, ...(excess.length > 0 ? { excessPorePressure: excess } : {}) }];
  });
  const lineLoads = ((loads.LineLoads as Json[] | undefined) ?? []).flatMap((l) => {
    const p = pts([l.Location])[0], q = num(l.Magnitude);
    if (!p || q === undefined) return [];
    const a = num(l.Angle) ?? 0;
    return [{ magnitude: q, x: p[0], ...(a !== 0 ? { angle: a, y: p[1] } : {}) }];
  });
  if (((loads.LineLoads as Json[] | undefined) ?? []).some((l) => consolidations(l).length > 0)) {
    notes.push("Degrees of consolidation below 100 % under line loads (their excess pore pressure) are not imported; they act fully drained.");
  }
  // the weight of a layer not yet consolidated in another (an embankment on
  // clay): B̄ = 1 − the degree of consolidation on the material of the
  // receiving layer, and the loading layer's material counts as fill
  const layerLoads = ((loads.LayerLoads as Json[] | undefined) ?? []).filter((l) => consolidations(l).length > 0);
  if (layerLoads.length > 0) {
    const bBarOf = new Map<string, number>();
    const fills = new Set<string>();
    let mixed = false;
    for (const l of layerLoads) {
      const fill = materialOfLayer.get(String(l.LayerId));
      if (!fill) continue;
      for (const c of consolidations(l)) {
        const target = materialOfLayer.get(String(c.LayerId));
        if (!target || target === fill) continue;
        const b = 1 - Math.max(0, num(c.Degree) ?? 100) / 100;
        const had = bBarOf.get(target);
        if (had !== undefined && Math.abs(had - b) > 1e-9) mixed = true;
        bBarOf.set(target, Math.max(had ?? 0, b));
        fills.add(fill);
      }
    }
    for (const m of materials) {
      const b = bBarOf.get(m.name);
      if (b !== undefined && b > 0) m.model = { ...m.model, bBar: b } as MaterialModel;
      if (fills.has(m.name) && !bBarOf.has(m.name)) m.model = { ...m.model, bBarLoad: true } as MaterialModel;
    }
    const list = [...bBarOf].map(([name, b]) => `"${name}" B̄ = ${+b.toFixed(3)}`).join(", ");
    if (list) notes.push(`Degrees of consolidation below 100 % under the weight of layers are imported as excess pore pressure (B̄ = 1 − the degree): ${list}, from the weight of ${[...fills].map((f) => `"${f}"`).join(", ")} above. cSlope applies it also above the water and from the whole fill above a base; this mapping is approximate, so check the excess pore pressure.`);
    if (mixed) notes.push("Some materials take different degrees of consolidation from different layers above them; the largest excess pore pressure is used.");
  }
  if (consolidations((loads.Earthquake as Json | undefined) ?? {}).length > 0 && (loads.Earthquake as Json | undefined)?.IsEnabled) {
    notes.push("Degrees of consolidation below 100 % under the earthquake load are not imported.");
  }
  if ((((loads.UniformLoads as Json[] | undefined) ?? [])).some((u) => (num(u.Spread) ?? 0) !== 0)) notes.push("The spread angles of the uniform loads are not imported (they matter for the stress in the soil below them).");
  if (((loads.Trees as Json[] | undefined) ?? []).length > 0) notes.push(`${(loads.Trees as Json[]).length} tree load(s) (wind on trees) not imported.`);
  const eq = loads.Earthquake as Json | undefined;
  if (eq?.IsEnabled) {
    const kh = num(eq.HorizontalFactor) ?? 0, kv = num(eq.VerticalFactor) ?? 0;
    if (kh) options.seismicHorizontal = Math.abs(kh);
    if (kv) options.seismicVertical = kv;
    if (num(eq.FreeWaterFactor)) notes.push("The earthquake's free water factor is not imported.");
  }

  // reinforcement: geotextiles (tensile strength developed over the reduction length at each end)
  const re = st.reinforcements ?? {};
  const reinforcements = ((re.Geotextiles as Json[] | undefined) ?? []).flatMap((g) => {
    const [a] = pts([g.Start]), [b] = pts([g.End]);
    const t = num(g.TensileStrength), red = num(g.ReductionArea) ?? 0;
    return a && b && t !== undefined ? [{ x1: a[0], y1: a[1], x2: b[0], y2: b[1], tensileCapacity: t, pullout: { kind: "development" as const, length1: red, length2: red } }] : [];
  });
  if (((re.Nails as Json[] | undefined) ?? []).length > 0) notes.push(`${(re.Nails as Json[]).length} nail(s) not imported.`);
  if (((re.ForbiddenLines as Json[] | undefined) ?? []).length > 0) notes.push(`${(re.ForbiddenLines as Json[]).length} forbidden line(s) not imported (cSlope searches all surfaces).`);

  return {
    definition: {
      coordinates: geo.outline,
      materials,
      materialBoundaries: geo.boundaries.map((c) => ({ coordinates: c, materialName: "" })),
      regionAssignments,
      ...(waterTable ? { waterTable } : {}),
      ...(waternet ? { waternet } : {}),
      udls,
      lineLoads,
      ...(reinforcements.length > 0 ? { reinforcements } : {}),
    } as SlopeDefinition,
    options,
    popByLabel,
  };
}

/** One calculation of a .stix file as a slope definition. */
export function stixToDefinition(file: StixFile, index: number, fileName = "stix"): StixImport {
  const calc: StixCalculation | undefined = file.calculations[index];
  if (!calc) throw new Error(`The file has no calculation ${index + 1}.`);
  const notes: string[] = [];
  const stages = calc.stages;
  // the earlier stage's stress history for the layers without a state of their own
  const earlierNotes: string[] = [];
  // (the latest earlier stage that gives a state; later loading that raised the
  // yield stress in between is not followed)
  const hasState = (g: StixStage) => (((g.state?.StatePoints as unknown[] | undefined) ?? []).length + ((g.state?.StateLines as unknown[] | undefined) ?? []).length) > 0;
  const earlierStage = stages.slice(0, -1).reverse().find(hasState);
  // an earlier stage that cannot be read leaves the stress history out, not the calculation
  let earlier: ReturnType<typeof stagePart> | undefined;
  if (earlierStage) {
    try {
      earlier = stagePart(file, earlierStage, earlierNotes);
    } catch (e) {
      notes.push(`The earlier stage "${earlierStage.label}" cannot be read (${e instanceof Error ? e.message : String(e)}); its stress history is left out.`);
    }
  }
  const part = stagePart(file, calc.stage, notes, earlier?.popByLabel);
  const options = part.options;
  // method and the file's slip plane
  const s = calc.settings ?? {};
  const type = text(s.AnalysisType);
  let customSurfaces: SlopeDefinition["customSurfaces"];
  let customSearchPlanes: SlopeDefinition["customSearchPlanes"];
  if (/^Bishop/.test(type)) options.method = "Bishop";
  else {
    Object.assign(options, { method: "Morgenstern-Price", intersliceFunction: "constant" });
    if (/UpliftVan/.test(type)) notes.push("Uplift-Van (two circles joined by a straight part) has no counterpart in cSlope's search; the file's critical slip plane is carried over as a surface and analyzed with Spencer.");
  }
  if (type === "Bishop") {
    const c = ((s.Bishop as Json | undefined)?.Circle ?? {}) as Json;
    const [cc] = pts([c.Center]), r = num(c.Radius);
    if (cc && r) customSearchPlanes = [{ cx: cc[0], cy: cc[1], radius: r }];
  } else if (type === "Spencer") {
    const sp = pts((s.Spencer as Json | undefined)?.SlipPlane).sort((a, b) => a[0] - b[0]);
    if (sp.length >= 2) customSurfaces = [{ points: sp }];
  } else if (type === "UpliftVan") {
    notes.push("The given Uplift-Van slip plane is not carried over (its result is, when the file has one).");
  }
  if (/BruteForce|Genetic|ParticleSwarm/.test(type)) notes.push(`The file's search (${type}) is not imported; cSlope's own search over the whole slope is used.`);
  const ctype = typeof s.CalculationType === "string" ? s.CalculationType : "Deterministic";
  if (ctype !== "Deterministic") notes.push(`The ${ctype.toLowerCase()} calculation is imported as a deterministic one with the soils' given values (no partial factors or design values).`);
  if ((num(s.ModelFactorMean) ?? 1) !== 1) notes.push(`The model factor ${num(s.ModelFactorMean)} is not imported.`);

  const res = calc.result;
  let reference: StixImport["reference"];
  const fos = num(res?.FactorOfSafety);
  const rp = pts(res?.Points).sort((a, b) => a[0] - b[0]);
  if (fos !== undefined && rp.length >= 2) {
    const c = res?.Circle as Json | undefined;
    const [cc] = pts([c?.Center]), r = num(c?.Radius);
    reference = { fos, points: rp, ...(cc && r ? { cx: cc[0], cy: cc[1], r } : {}) };
  }
  if (reference && !customSearchPlanes && !customSurfaces) {
    // the file's critical surface alongside cSlope's own search
    customSurfaces = [{ points: reference.points, ...(reference.cx !== undefined ? { axis: [reference.cx, reference.cy!] as Pt } : {}) }];
  }

  // the direction of sliding: from the high end of the file's slip plane
  // (a dike has two slopes; cSlope otherwise picks one itself)
  const surface = customSurfaces?.[0]?.points ?? reference?.points;
  let orientation: SlopeDefinition["orientation"];
  if (surface && surface.length >= 2) {
    const l = surface[0], r = surface[surface.length - 1];
    if (Math.abs(l[1] - r[1]) > 1e-6) orientation = l[1] > r[1] ? "ltr" : "rtl";
  }

  const usesEarlier = part.definition.materials.some((m) => (m.model as { yieldFromEarlierStage?: boolean }).yieldFromEarlierStage || ((m.model as { aboveWater?: { yieldFromEarlierStage?: boolean } }).aboveWater?.yieldFromEarlierStage ?? false));
  if (usesEarlier) notes.push(`The stress history of the earlier stage "${earlierStage?.label}" is used where this stage gives no state: the yield stress there is its effective vertical stress plus the POP.`);
  // what of the earlier stage did not carry over matters for that stress history
  if (usesEarlier) for (const n of earlierNotes) if (!notes.includes(n)) notes.push(`Earlier stage "${earlierStage?.label}": ${n}`);
  const definition: SlopeDefinition = {
    ...part.definition,
    ...(orientation ? { orientation } : {}),
    ...(usesEarlier && earlier ? { earlierStage: earlier.definition } : {}),
    ...(customSearchPlanes ? { customSearchPlanes } : {}),
    ...(customSurfaces ? { customSurfaces, ...(type === "Spencer" ? { customPlanesOnly: true } : {}) } : {}),
    ...(type === "Bishop" ? { customPlanesOnly: true } : {}),
  };
  const base = fileName.replace(/\.stix$/i, "");
  // A short name, the calculation (and its scenario when needed) and the file; the list shows the whole name on hover.
  const scenarios = new Set(file.calculations.map((c) => c.scenario));
  const perScenario = file.calculations.filter((c) => c.scenario === calc.scenario).length;
  const what = scenarios.size <= 1 ? calc.label : perScenario === 1 ? calc.scenario : `${calc.scenario}, ${calc.label}`;
  return { name: `${what} (${base})`, definition, options, notes: [...new Set(notes)], ...(reference ? { reference } : {}) };
}
