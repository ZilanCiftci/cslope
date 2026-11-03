/**
 * Writing a model as a .sli model file (and a .slim archive holding it):
 * the regions as triangular cells on numbered vertices, the outline and
 * the boundaries between materials, the materials (Mohr-Coulomb,
 * undrained with a constant Su or Su increasing below the top of its
 * layer, the shear-normal function, generalised Hoek-Brown, SHANSEP with
 * OCR against elevation; the unit weight below the water, φb and the
 * drawdown envelope), the water table and piezometric lines per material
 * (Hu automatic for cSlope's head correction, else 1), rapid drawdown,
 * distributed and line loads, the seismic coefficients, end-anchored bars,
 * grouted tiebacks and geosynthetics, a tension crack, the method, the
 * slices, the direction of sliding, the given circles and surfaces or a
 * grid of centres, and the entry and exit ranges as slope limits. What has
 * no counterpart in the format is listed in `notes`.
 *
 * The sections follow the published example files; the receiving program
 * remains the authority on its own format, so the file is a starting point
 * to check there, not a guaranteed round trip.
 */

import { hoekBrownOf, toCanonicalSlopeDefinition, type AnalysisOptions, type MaterialModel, type SlopeDefinition } from "@cslope/engine";
import { buildSlopeDTOFromModel } from "../../../store/helpers";
import type { ModelEntry } from "../../../store/types";
import { computeRegions } from "../../../utils/regions";
import { sharedRings } from "../../../utils/region-rings";
import { writeZip } from "../../../utils/zip";

type Pt = [number, number];

/** A number as the files write it (at most 15 significant digits). */
function n(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const r = +v.toPrecision(15);
  return Object.is(r, -0) ? "0" : String(r);
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const area2 = (r: Pt[]) => r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0);

/** Whether segments ab and cd cross at a point inside both (not at their ends). */
function properlyCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}

/** Whether p is inside triangle abc (counter-clockwise) or on its edges. */
function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt, eps: number): boolean {
  return cross(a, b, p) >= -eps && cross(b, c, p) >= -eps && cross(c, a, p) >= -eps;
}

/** Whether the direction from v to m lies inside the corner prev–v–next of a ring whose inside is on the left. */
function inCone(prev: Pt, v: Pt, next: Pt, m: Pt): boolean {
  if (cross(prev, v, next) >= 0) return cross(v, next, m) > 0 && cross(prev, v, m) > 0;
  return !(cross(v, next, m) <= 0 && cross(prev, v, m) <= 0);
}

/**
 * Triangles (vertex ids) of a polygon with holes: each hole joined to the
 * outer ring by a bridge (to the nearest vertex it sees: the bridge crosses
 * no edge, passes through no other vertex and leaves both corners inwards),
 * then ear clipping. Vertices on a straight edge stay corners of the
 * triangles where possible, so that neighbouring regions share them.
 * The triangles are checked to cover the region exactly once; otherwise
 * it throws.
 */
export function triangulate(outer: number[], holes: number[][], at: (id: number) => Pt): number[][] {
  const ring = area2(outer.map(at)) < 0 ? [...outer].reverse() : [...outer];
  const cw = holes.map((h) => (area2(h.map(at)) > 0 ? [...h].reverse() : [...h]));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const id of ring) {
    const [x, y] = at(id);
    [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
  }
  const ext = Math.max(1e-9, x1 - x0, y1 - y0);
  const eps = 1e-12 * ext * ext;
  const same = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) <= 1e-12 * ext && Math.abs(p[1] - q[1]) <= 1e-12 * ext;
  const maxX = (h: number[]) => h.reduce((m, id) => Math.max(m, at(id)[0]), -Infinity);
  const ordered = [...cw].sort((p, q) => maxX(q) - maxX(p));
  const pending = new Set(ordered);
  for (const h of ordered) {
    pending.delete(h);
    const rings = [ring, ...pending];
    const segs = rings.flatMap((r) => r.map((id, i): [Pt, Pt] => [at(id), at(r[(i + 1) % r.length])]));
    const verts = rings.flat().concat(h).map(at);
    let best: { i: number; mi: number; d: number } | undefined;
    for (let mi = 0; mi < h.length; mi++) {
      const M = at(h[mi]);
      const [hp, hn] = [at(h[(mi + h.length - 1) % h.length]), at(h[(mi + 1) % h.length])];
      for (let i = 0; i < ring.length; i++) {
        const V = at(ring[i]);
        const d = Math.hypot(V[0] - M[0], V[1] - M[1]);
        if (best && d >= best.d) continue;
        if (!inCone(at(ring[(i + ring.length - 1) % ring.length]), V, at(ring[(i + 1) % ring.length]), M)) continue;
        if (!inCone(hp, M, hn, V)) continue;
        if (segs.some(([a, b]) => properlyCross(M, V, a, b)) || h.some((id, k) => properlyCross(M, V, at(id), at(h[(k + 1) % h.length])))) continue;
        // no vertex on the bridge between its ends
        const len2 = (V[0] - M[0]) ** 2 + (V[1] - M[1]) ** 2;
        const touches = verts.some((p) => {
          if (same(p, M) || same(p, V)) return false;
          const t = ((p[0] - M[0]) * (V[0] - M[0]) + (p[1] - M[1]) * (V[1] - M[1])) / len2;
          return t > 0 && t < 1 && Math.abs(cross(M, V, p)) <= 1e-9 * ext * Math.sqrt(len2);
        });
        if (!touches) best = { i, mi, d };
      }
    }
    if (!best) throw new Error("a hole in it cannot be joined to its outline");
    const hole = [...h.slice(best.mi), ...h.slice(0, best.mi), h[best.mi]];
    ring.splice(best.i + 1, 0, ...hole, ring[best.i]);
  }
  const tris: number[][] = [];
  const poly = [...ring];
  let guard = 0;
  while (poly.length > 3 && guard++ < 1000000) {
    let clipped = false;
    for (let i = 0; i < poly.length && !clipped; i++) {
      const ia = poly[(i + poly.length - 1) % poly.length], ib = poly[i], ic = poly[(i + 1) % poly.length];
      const [a, b, c] = [at(ia), at(ib), at(ic)];
      if (cross(a, b, c) <= eps) continue;
      const blocked = poly.some((id) => {
        const p = at(id);
        if (same(p, a) || same(p, b) || same(p, c)) return false;
        return inTriangle(p, a, b, c, eps);
      });
      if (blocked) continue;
      tris.push([ia, ib, ic]);
      poly.splice(i, 1);
      clipped = true;
    }
    if (!clipped) {
      // only straight runs left: drop a vertex on a straight line
      const k = poly.findIndex((id, i) => Math.abs(cross(at(poly[(i + poly.length - 1) % poly.length]), at(id), at(poly[(i + 1) % poly.length]))) <= eps);
      if (k < 0) throw new Error("no ear is left to clip (a crossing outline?)");
      poly.splice(k, 1);
    }
  }
  if (poly.length === 3 && cross(at(poly[0]), at(poly[1]), at(poly[2])) > eps) tris.push([...poly]);
  // the triangles must cover the region once: the same area, none turned over
  const area = Math.abs(area2(outer.map(at))) - cw.reduce((t, h) => t + Math.abs(area2(h.map(at))), 0);
  const covered = tris.reduce((t, [a, b, c]) => t + cross(at(a), at(b), at(c)), 0);
  if (tris.some(([a, b, c]) => cross(at(a), at(b), at(c)) <= 0) || Math.abs(covered - area) > 1e-9 * Math.max(area, ext * ext)) throw new Error("its triangles do not cover it exactly");
  return tris;
}

/** The format's method bits of the analysis options, with a note when the method has no counterpart. */
function methodBits(o: Partial<AnalysisOptions>, notes: string[]): number {
  if (o.method === "Janbu") return o.janbuCorrection ? 16 : 4;
  if (o.method === "Morgenstern-Price") {
    if (o.intersliceFunction === "constant") return 8;
    if (o.intersliceFunction && o.intersliceFunction !== "half-sine") notes.push(`Morgenstern-Price with the ${o.intersliceFunction} interslice function is written as GLE / Morgenstern-Price (the receiving program's default function is a half-sine); set the function there.`);
    return 128;
  }
  return 2;
}

interface MaterialOut {
  fields: string;
  /** Extra sections for the material: strength function points, SHANSEP OCR table, Hoek-Brown GSI. */
  strengthFunction?: { name: string; points: Pt[] };
  ocr?: Pt[];
  hb?: { gsi: number; mi: number; d: number };
}

/** The format's material fields for one model (without the water fields). */
function materialFields(name: string, model: MaterialModel, notes: string[]): MaterialOut {
  const uw = `uw: ${n(model.unitWeight)}${model.unitWeightSat !== undefined && model.unitWeightSat !== model.unitWeight ? ` uwbwt: ${n(model.unitWeightSat)}` : ""}`;
  if (model.aboveWater) notes.push(`"${name}": the strength above the water line is not written; the strength below it is used throughout.`);
  if (model.bBar) notes.push(`"${name}": the B-bar pore pressure is not written.`);
  const mc = (c: number, phi: number, extra = "") => ({ fields: `type: 0 c: ${n(c)} phi: ${n(phi)} ${uw}${extra}` });
  switch (model.kind) {
    case "mohr-coulomb": {
      if (model.cohesionRateOfChange) notes.push(`"${name}": c′ increasing with depth is written as its reference value.`);
      if (model.cFactor) notes.push(`"${name}": the combined (undrained) limit is not written; drained c′ and φ′ only.`);
      if (model.maxSuction !== undefined && model.phiB) notes.push(`"${name}": the limit on the suction is not written.`);
      const phiB = model.phiB && model.phiB > 0 ? ` gw_phi_b: ${n(model.phiB)}` : "";
      const rd = model.drawdownStrength ? ` rd_undrained: 1 rd_type: 0 rd_cr: ${n(model.drawdownStrength.cohesion)} rd_phir: ${n(model.drawdownStrength.frictionAngle)}` : "";
      return mc(model.cohesion, model.frictionAngle, phiB + rd);
    }
    case "undrained":
      if (model.suRateOfChange) notes.push(`"${name}": Su increasing with depth below a reference level is written as its reference value.`);
      if (model.suMax !== undefined) notes.push(`"${name}": the cut-off of Su is not written.`);
      if (model.anisotropy?.length) notes.push(`"${name}": the anisotropy of Su is not written.`);
      return { fields: `type: 1 ctype: 0 c: ${n(model.undrainedShearStrength)} ${uw}` };
    case "s-f-depth": {
      const top = model.depthReference === "layer-top";
      if (!top) notes.push(`"${name}": Su is given below the ground; the format measures the depth from the top of the material's layer, so check it where the layer is not at the ground.`);
      if (model.drainedCohesion !== undefined) notes.push(`"${name}": the drained branch of the combined strength is not written.`);
      if (model.suMax !== undefined) notes.push(`"${name}": the cut-off of Su is not written.`);
      if (model.anisotropy?.length) notes.push(`"${name}": the anisotropy of Su is not written.`);
      const c0 = model.suRef - model.depthRef * model.rate;
      if (c0 < 0) notes.push(`"${name}": Su at the top of the layer would be ${+c0.toFixed(3)} kPa; it is written as 0, with the same increase.`);
      return { fields: `type: 1 ctype: 1 c: ${n(Math.max(0, c0))} dc: ${n(model.rate)} ${uw}` };
    }
    case "s-f-datum":
      notes.push(`"${name}": Su against elevation is written as its reference value ${model.suRef} kPa (constant).`);
      return { fields: `type: 1 ctype: 0 c: ${n(model.suRef)} ${uw}` };
    case "shear-normal":
      if (model.spline) notes.push(`"${name}": the spline through the shear-normal points is not written; straight lines between them.`);
      return { fields: `type: 5 ${uw}`, strengthFunction: { name: `${name} function`, points: model.points } };
    case "hoek-brown": {
      const p = hoekBrownOf(model);
      return { fields: `type: 8 mb: ${n(p.mb)} s: ${n(p.s)} a: ${n(p.a)} sigc: ${n(model.ucs)} ${uw}`, hb: { gsi: model.gsi, mi: model.mi, d: model.disturbance ?? 0 } };
    }
    case "shansep": {
      let ocr: Pt[] | undefined;
      if (model.ocrByElevation?.length) ocr = model.ocrByElevation;
      else if ((model.ocr ?? 1) !== 1) ocr = [[-1e4, model.ocr!], [1e4, model.ocr!]];
      if (model.pop !== undefined || model.yieldStress !== undefined || model.yieldFromEarlierStage) notes.push(`"${name}": the stress history (POP or yield stress) is not written; OCR = 1.`);
      if (model.suByStress) notes.push(`"${name}": Su as a function of the vertical stress is not written.`);
      if (model.suMin) notes.push(`"${name}": the lower limit of Su is not written.`);
      return { fields: `type: 18 ${uw} shansepA: 0 shansepS: ${n(model.ratio)} shansepm: ${n(model.exponent ?? 0.8)} histype: 0 shansepmd: 0 shansepht: 0 shansepcon: 2`, ...(ocr ? { ocr } : {}) };
    }
    case "anisotropic-function":
      notes.push(`"${name}": the anisotropic function is not written; Mohr-Coulomb with its base c and φ.`);
      return mc(model.cohesion, model.frictionAngle);
    default: {
      const m = model as { cohesion?: number; frictionAngle?: number; kind: string };
      notes.push(`"${name}": the material model "${model.kind}" has no counterpart in the export; written as Mohr-Coulomb${m.cohesion !== undefined || m.frictionAngle !== undefined ? " with its c and φ" : " with no strength, to be entered by hand"}.`);
      return mc(m.cohesion ?? 0, m.frictionAngle ?? 0);
    }
  }
}

/** The definition of the model in its own coordinates (the analysis input is mirrored for a slope sliding to the left). */
function ownDefinition(model: ModelEntry): SlopeDefinition {
  const canonical = buildSlopeDTOFromModel(model);
  return canonical.orientation === "rtl" ? toCanonicalSlopeDefinition(canonical) : canonical;
}

/** The model as the text of a .sli file, with what is not written. */
export function modelToSli(model: ModelEntry): { text: string; notes: string[] } {
  const notes: string[] = [];
  const def = ownDefinition(model);
  const opts: Partial<AnalysisOptions> = model.options ?? {};
  if (def.coordinates.length < 3 || def.materials.length === 0) throw new Error("The model has no outline or no materials to export.");
  const outline = def.coordinates;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of outline) [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];

  // regions: rings of vertices, with the corners of neighbours on their edges
  const names = def.materials.map((m) => m.name);
  const regions = computeRegions(
    outline,
    (def.materialBoundaries ?? []).map((b, i) => ({ id: `b${String(i).padStart(4, "0")}`, coordinates: b.coordinates })),
    (def.regionAssignments ?? []).map((a) => ({ point: a.point, materialId: a.materialName })),
    names[0],
  );
  // the rings of the regions, their holes and the outline on shared, numbered vertices (the corners of
  // neighbours on their edges); the lines (water, crack, surfaces) add their own vertices after them
  const holeRegions = regions.flatMap((r) => (r.holes ?? []).map((h) => ({ ...h, materialId: "", regionKey: "" })));
  const shared = sharedRings([...regions, ...holeRegions, { px: outline.map((p) => p[0]), py: outline.map((p) => p[1]), materialId: "", regionKey: "" }]);
  const vertices: Pt[] = shared.points.map(([x, y]) => [x, y]);
  const tol = 1e-9 * Math.max(1, x1 - x0, y1 - y0);
  const vid = (p: Pt) => {
    let i = vertices.findIndex((q) => Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol);
    if (i < 0) i = vertices.push([p[0], p[1]]) - 1;
    return i + 1;
  };
  const at = (id: number) => vertices[id - 1];
  const dedupe = (ids: number[]) => ids.filter((id, i) => id !== ids[(i + 1) % ids.length]);
  let nextHole = regions.length;
  const rings = regions.map((r, k) => ({ material: r.materialId, outer: dedupe(shared.rings[k].ids), holes: (r.holes ?? []).map(() => dedupe(shared.rings[nextHole++].ids)) }));
  const outlineRing = dedupe(shared.rings[shared.rings.length - 1].ids);

  // materials: soil1, soil2, … in the definition's order
  const water = def.waterTable && Array.isArray(def.waterTable.value) ? (def.waterTable.value as Pt[]) : undefined;
  if (def.waterTable && !Array.isArray(def.waterTable.value)) notes.push("The water table given as a level or a depth is not written; draw it as a line.");
  if (def.waterTable?.followBoundary) notes.push("The water table is clipped to the ground in cSlope (no free water); the format takes the line as drawn.");
  const below = (l: Pt[]) => l.every((p) => p[1] < y0 - 1e-9);
  // piezometric lines: the other water lines that some material uses (a line below the model means dry)
  const piezos: { id: string; line: Pt[] }[] = [];
  const wtableOf = (m: SlopeDefinition["materials"][number]): number => {
    if (!water) return 0;
    if (m.waterTableId === undefined) return below(water) ? 0 : 1;
    const l = def.waterTables?.find((w) => w.id === m.waterTableId);
    if (!l) return below(water) ? 0 : 1;
    if (below(l.coordinates)) return 0;
    if (l.coordinates.length === water.length && l.coordinates.every((p, i) => p[0] === water[i][0] && p[1] === water[i][1])) return 1;
    let k = piezos.findIndex((q) => q.id === l.id);
    if (k < 0) k = piezos.push({ id: l.id, line: l.coordinates }) - 1;
    return k + 2;
  };
  const auto = opts.porePressureHead === "phreatic-correction";
  const matLines: string[] = [];
  const propLines: string[] = [];
  const functions: string[] = [];
  let functionCount = 0;
  const ocrTables: string[] = [];
  const hbLines: string[] = [];
  def.materials.forEach((m, i) => {
    const k = i + 1;
    if (!m.model) {
      notes.push(`"${m.name}" has no material model; written as Mohr-Coulomb with no strength.`);
    }
    const out = m.model ? materialFields(m.name, m.model, notes) : { fields: "type: 0 c: 0 phi: 0 uw: 0" } as MaterialOut;
    // (a function's name runs to the end of the line)
    matLines.push(`  soil${k} = ${out.fields} water: 1 wtable: ${wtableOf(m)} hutype: ${auto ? 1 : 0} withru: 0${out.strengthFunction ? ` name: ${out.strengthFunction.name}` : ""}`);
    const hex = /^#[0-9a-f]{6}$/i.test(m.color ?? "") ? m.color! : "#c8c8c8";
    const [r, g, b] = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
    propLines.push(`  ${m.name.replace(/\s+/g, " ").trim() || `Material ${k}`}    red: ${r}  green: ${g}  blue: ${b}  has_hatch: 0 hatch2: 0  hatch_clr: 0`);
    if (out.strengthFunction) {
      functions.push(`${++functionCount}  type: 5  num: ${out.strengthFunction.points.length}  name: ${out.strengthFunction.name}`);
      for (const [sn, tau] of out.strengthFunction.points) functions.push(`    n: ${n(sn)} s: ${n(tau)}`);
    }
    if (out.ocr) {
      ocrTables.push(`    soil: ${k} numdata: ${out.ocr.length}`);
      out.ocr.forEach(([y, ocr], q) => ocrTables.push(`      id1: ${q + 1} x: ${n(y)} y: ${n(ocr)}`));
    }
    hbLines.push(`  num: ${k}  gsi: ${n(out.hb?.gsi ?? 50)}  mi: ${n(out.hb?.mi ?? 10)}  disturbance: ${n(out.hb?.d ?? 0)}  use_gsi_mi_d: 0`);
  });
  const unusedLines = (def.waterTables ?? []).filter((w) => !below(w.coordinates) && !def.materials.some((m) => m.waterTableId === w.id) && !(water && w.coordinates.length === water.length && w.coordinates.every((p, i) => p[0] === water[i][0] && p[1] === water[i][1])));
  if (unusedLines.length > 0) notes.push(`${unusedLines.length} water line(s) that no material uses are not written.`);

  // cells: each region in triangles
  const cells: string[] = [];
  for (const r of rings) {
    const k = names.indexOf(r.material) + 1 || 1;
    let tris: number[][];
    try {
      tris = triangulate(r.outer, r.holes, at);
    } catch (e) {
      throw new Error(`A region of "${r.material}" cannot be divided into cells (${e instanceof Error ? e.message : String(e)}), so the model cannot be exported.`);
    }
    for (const t of tris) cells.push(`  ${cells.length + 1}  vertices: [${t.join(",")}] material: soil${k}`);
  }

  // the ground: the top of the outline from its left end to its right end
  const topAt = (x: number) => Math.max(...outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) return [];
    return [a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])];
  }));
  // (the outline counter-clockwise: its top runs from the top of the right side to the top of the left side)
  const ccw = area2(outlineRing.map(at)) > 0 ? outlineRing : [...outlineRing].reverse();
  const topOfSide = (x: number) => ccw.reduce((best, id, i) => (at(id)[0] === x && (best < 0 || at(id)[1] > at(ccw[best])[1]) ? i : best), -1);
  const iR = topOfSide(x1), iL = topOfSide(x0);
  const groundIds: number[] = [];
  if (iR >= 0 && iL >= 0) for (let i = iR; ; i = (i + 1) % ccw.length) {
    groundIds.unshift(ccw[i]);
    if (i === iL) break;
  }
  const ground = groundIds.map(at);

  // water lines as vertices
  const lineIds = (l: Pt[]) => l.map(vid);
  const wtIds = water && !below(water) ? lineIds(water) : undefined;
  const piezoIds = piezos.map((p) => lineIds(p.line));
  let drawdownIds: number[] | undefined;
  let waterTableIds = wtIds;
  if (def.rapidDrawdown && wtIds) {
    // the water table is the water before drawdown, the drawdown line the water after it
    waterTableIds = lineIds(def.rapidDrawdown.waterBefore);
    drawdownIds = wtIds;
    notes.push("Rapid drawdown is written as the water table before it and a drawdown line after it; choose the drawdown procedure in the receiving program.");
  }
  if (def.waternet) notes.push("The head and reference lines (waternet) are not written; the materials' water lines are.");

  // loads
  const forces: string[] = [];
  for (const u of def.udls ?? []) {
    const ya = Number.isFinite(topAt(u.x1)) ? topAt(u.x1) : y1, yb = Number.isFinite(topAt(u.x2)) ? topAt(u.x2) : y1;
    if (u.direction === "normal") notes.push(`A distributed load acting normal to the ground in cSlope is written as vertical.`);
    if (u.excessPorePressure?.length) notes.push("The excess pore pressure under a distributed load is not written.");
    forces.push(`  ${forces.length + 1} type: 0 x1: ${n(u.x1)} y1: ${n(ya)} x2: ${n(u.x2)} y2: ${n(yb)} angle: 270 load: ${n(u.magnitude)} load2: ${n(u.magnitude)} stage2: 0 design_standard_option: 0`);
  }
  for (const l of def.lineLoads ?? []) {
    const y = l.y ?? (Number.isFinite(topAt(l.x)) ? topAt(l.x) : y1);
    forces.push(`  ${forces.length + 1} type: 1 x1: ${n(l.x)} y1: ${n(y)} angle: ${n(270 + (l.angle ?? 0))} load: ${n(l.magnitude)} stage2: 0 design_standard_option: 0`);
  }
  if ((def.lineLoads ?? []).length > 0) notes.push("Line loads are written as type 1 forces with their point, direction and magnitude; check them in the receiving program.");

  // support: anchors without pullout (end-anchored) and with a bond (grouted tiebacks)
  const anchorTypes: string[] = [];
  const anchors: string[] = [];
  for (const [i, r] of (def.reinforcements ?? []).entries()) {
    const k = anchorTypes.length + 1;
    // the force's orientation: 1 along the element, 0 along the surface, 2 between them
    const fa = `${r.application === "passive" ? 1 : 0} fo_flag: ${r.direction === "tangent" ? 0 : r.direction === "bisector" ? 2 : 1}`;
    if ((r.end2Capacity ?? 0) > 0) notes.push(`Reinforcement ${i + 1}: the capacity at the embedded end is not written.`);
    if (!r.pullout) anchorTypes.push(`  anchor${k} = type: 1 fa: ${fa} sp: ${n(r.spacing ?? 1)} cap: ${n(r.tensileCapacity)}`);
    else if (r.pullout.kind === "interface") {
      // a geosynthetic, per metre of slope with its coverage
      const a = r.pullout.coverage ?? 1, sp = r.spacing ?? 1;
      if (sp !== 1) notes.push(`Reinforcement ${i + 1}: a geosynthetic is written per metre of slope (its strengths divided by the spacing ${sp} m); its pullout is not divided.`);
      const conn = (r.end1Capacity ?? 0) > 0 ? ` anch: 2 conn_strength: ${n(r.end1Capacity! / sp / a)}` : " anch: 0";
      anchorTypes.push(`  anchor${k} = type: 4 fa: ${fa} ts: ${n(r.tensileCapacity / sp / a)}${conn} po_type: 1 po_adh: ${n(r.pullout.adhesion)} po_fric: ${n(r.pullout.frictionAngle)} cov_perc: ${n(100 * a)}`);
    }
    else if (r.pullout.kind === "bond") {
      const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
      const pct = Math.min(100, (100 * (r.pullout.bondedLength ?? len)) / len);
      anchorTypes.push(`  anchor${k} = type: 2 fa: ${fa} sp: ${n(r.spacing ?? 1)} cap: ${n(r.tensileCapacity)} pc: ${n(r.end1Capacity ?? 0)} bst: 0 bs: ${n(r.pullout.strength)} bt: 1 bl: ${n(pct)}`);
    } else {
      notes.push(`Reinforcement ${i + 1}: its pullout (${r.pullout.kind}) has no counterpart in the export; it is written as an end-anchored bar with its tensile capacity.`);
      anchorTypes.push(`  anchor${k} = type: 1 fa: ${fa} sp: ${n(r.spacing ?? 1)} cap: ${n(r.tensileCapacity)}`);
    }
    anchors.push(`  ${anchors.length + 1} x1: ${n(r.x1)} y1: ${n(r.y1)} x2: ${n(r.x2)} y2: ${n(r.y2)}  material: anchor${k}`);
  }
  if ((def.piles ?? []).length > 0) notes.push(`${def.piles!.length} pile row(s) not written.`);

  // tension crack: a line at the crack depth below the ground
  let crackIds: number[] | undefined;
  if ((opts.tensionCrackDepth ?? 0) > 0 && ground.length >= 2) {
    const d = opts.tensionCrackDepth!;
    crackIds = ground.map(([x, y]) => vid([x, y - d]));
    notes.push(`The tension crack is written as a line ${d} m below the ground${(opts.tensionCrackWater ?? 0) > 0 ? ", filled with water" : ", dry"}.`);
  }
  if (opts.tensionCrackAuto || opts.tensionCrackAngle) notes.push("The tension crack from the soil's strength or a limiting base inclination is not written.");

  // the surfaces: given circles and surfaces, else a grid of centres above the slope
  const circles = def.customSearchPlanes ?? [];
  const surfaces = (def.customSurfaces ?? []).map((s) => lineIds(s.points));
  const onlyGiven = !!def.customPlanesOnly && circles.length + surfaces.length > 0;
  const toe = ground.reduce((m, p) => (p[1] < m[1] ? p : m), ground[0] ?? [x0, y0]);
  const crest = ground.reduce((m, p) => (p[1] > m[1] ? p : m), ground[0] ?? [x1, y1]);
  const gx0 = Math.min(toe[0], crest[0]), gx1 = Math.max(toe[0], crest[0]);
  const h = Math.max(1, crest[1] - toe[1]), w = Math.max(1, gx1 - gx0);
  const grid = onlyGiven ? [] : [`  1: x1: ${n(gx0)} y1: ${n(crest[1] + 0.2 * h)}  x2: ${n(gx1 + 0.5 * w)} y2: ${n(crest[1] + 0.2 * h + Math.max(h, w))}  nx: 20 ny: 20`];
  if (!onlyGiven) notes.push("The search is written as a grid of centres above the slope; adjust it to the slope there.");
  if (opts.nonCircularOptimization) notes.push("The non-circular optimisation is not written; the search is circular.");
  if (opts.searchMethod === "block" || (def.blockSearchObjects ?? []).length > 0) notes.push("The block search is not written.");
  const groundL = ground[0] ?? [x0, y1], groundR = ground[ground.length - 1] ?? [x1, y1];
  let limits = `  x1: ${n(groundL[0])} y1: ${n(groundL[1])} x2: ${n(groundR[0])} y2: ${n(groundR[1])}`;
  if (def.analysisLimits) {
    const a = def.analysisLimits;
    const rtl = def.orientation === "rtl";
    const [left, right] = rtl ? [[a.exitLeftX, a.exitRightX], [a.entryLeftX, a.entryRightX]] : [[a.entryLeftX, a.entryRightX], [a.exitLeftX, a.exitRightX]];
    const y = (x: number) => (Number.isFinite(topAt(x)) ? topAt(x) : y1);
    limits = `  x1: ${n(left[0])} y1: ${n(y(left[0]))} x2: ${n(left[1])} y2: ${n(y(left[1]))} x3: ${n(right[0])} y3: ${n(y(right[0]))} x4: ${n(right[1])} y4: ${n(y(right[1]))}`;
  }

  // options
  const bits = methodBits(opts, notes);
  const slices = Math.round(opts.slices ?? 25);
  if (opts.partialFactors) notes.push("The partial factors are not written; the analysis uses the given values.");
  if (opts.fem?.enabled) notes.push("The finite element analysis is not written.");
  if (opts.bothDirections) notes.push("The analysis of both directions is not written; the model's direction is.");
  if (opts.minSlipDepth || opts.minSlipArea) notes.push("The minimum depth and area of the surfaces are not written.");
  if (def.earlierStage) notes.push("The earlier stage is not written.");
  for (const m of def.materials) if (m.depthRange) notes.push(`"${m.name}": its depth range is not written.`);
  const kh = opts.seismicHorizontal ?? 0, kv = opts.seismicVertical ?? 0;
  const direction = def.orientation === "rtl" ? "right to left" : "left to right";

  const L: string[] = [];
  const sec = (name: string, lines: string[] = []) => L.push(`${name}:`, ...lines, "");
  sec("model description", [
    "  version: 7.010", `  methods: ${bits}`, "  units: metric", `  seismic: ${n(kh)}`, `  seismicv: ${n(kv)}`, "  seismic_advanced: 0", "  seismic_pseudostatic: 0",
    "  water: hu", `  direction: ${direction}`, "  tolerance: 0.005", "  maxiter: 75", "  gammaw: 9.81", "  mode: 0", "  search: 0", "  circularsearch: 0", "  datamode: 1",
    `  nummaterials: ${def.materials.length}`, `  numanchors: ${anchorTypes.length}`, "  probability_analysis: 0", "  sensitivity analysis: no", "  with_ru: 0", "  transient: no", "  design_selection: 0", "  use_profile: 0", "  slices_type: 0",
  ]);
  sec("material types", matLines);
  sec("strength functions");
  L.splice(L.length - 1, 0, ...functions);
  sec("shansep variable functions", [`  numfunctions: ${ocrTables.filter((l) => /soil:/.test(l)).length}`, ...ocrTables]);
  sec("anchor types", anchorTypes);
  sec("tension crack properties", [`  type: ${(opts.tensionCrackWater ?? 0) > 0 ? "filled" : "dry"}  angle_flag: 0  angle_value: 10`]);
  sec("vertices", vertices.map((p, i) => `  ${i + 1} x: ${n(p[0])}  y: ${n(p[1])}`));
  sec("cells", cells);
  sec("anchors", anchors);
  sec("water table", waterTableIds ? [`  from_boreholes: 0  vertices: [${waterTableIds.join(",")}]`] : []);
  sec("drawdown line", drawdownIds ? [`  vertices: [${drawdownIds.join(",")}]`] : []);
  sec("piezos", piezoIds.map((ids, i) => `  ${i + 1}  vertices: [${ids.join(",")}]`));
  sec("tension crack", crackIds ? [`  1  vertices: [${crackIds.join(",")}]`] : []);
  sec("pore pressures");
  sec("slope", groundIds.length >= 2 ? [`  1  vertices: [${groundIds.join(",")}]`] : []);
  sec("exterior", [`  1  vertices: [${outlineRing.join(",")}]`]);
  sec("forces", forces);
  sec("noncircular analysis", [`  slices: ${slices}`]);
  sec("circular analysis", [`  slices: ${slices}`]);
  sec("slope limits", [limits]);
  sec("grids", grid);
  sec("centers", circles.map((c, i) => `  ${i + 1} x: ${n(c.cx)} y: ${n(c.cy)} r: ${n(c.radius)}`));
  sec("surfaces", surfaces.map((ids, i) => `  ${i + 1}  vertices: [${ids.join(",")}]`));
  sec("material gen. hoek-brown", hbLines);
  // the boundaries as drawn: the outline (type 0) and the material boundaries (type 3), the last point of each flagged
  const boundaries: { type: number; pts: Pt[] }[] = [{ type: 0, pts: outlineRing.map(at) }, ...(def.materialBoundaries ?? []).map((b) => ({ type: 3, pts: b.coordinates }))];
  sec("geometry gui_ids", [
    "# ----------------------------------------------------------------------------------------------",
    ...boundaries.map((_, i) => `guid: {00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}}`),
  ]);
  sec("geometry info", [
    "#0:External boundary  1:Excavation  2:Joint  3:Material  4:Stage  5: Master Profile  6: Profile Bound",
    "#  Material Type    End Flag        Vertex (x,y)        Disc (x,y)       A.B.I    Visible    Temporary",
    "# ----------------------------------------------------------------------------------------------",
    ...boundaries.flatMap((b) => b.pts.map((p, i) => `         ${b.type}                ${i === b.pts.length - 1 ? 1 : 0}        ${n(p[0])},${n(p[1])}           0              0          1          0`)),
  ]);
  sec("material properties", propLines);
  return { text: L.join("\r\n"), notes: [...new Set(notes)] };
}

/** The model as the bytes of a .slim archive (one .sli inside), with what is not written. */
export function modelToSlim(model: ModelEntry, baseName = "model"): { bytes: Uint8Array; notes: string[] } {
  const { text, notes } = modelToSli(model);
  // the files are single-byte text (Latin-1); other characters (in names) become "?"
  const chars = [...text];
  const other = [...new Set(chars.filter((c) => c.charCodeAt(0) > 0xff))];
  if (other.length > 0) notes.push(`The characters ${other.join(" ")} (in names) have no place in the file's character set; they are written as "?".`);
  const bytes = new Uint8Array(chars.map((c) => (c.charCodeAt(0) <= 0xff ? c.charCodeAt(0) : 0x3f)));
  return { bytes: writeZip([{ name: `${baseName}.sli`, data: bytes }]), notes };
}
