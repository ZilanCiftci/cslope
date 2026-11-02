/**
 * A .gsz stability analysis as a cSlope slope definition: the regions
 * become the outline, the material boundaries and region assignments; the
 * materials, piezometric lines, surcharges, line loads, method and entry and
 * exit ranges are carried over. What has no counterpart is listed in
 * `notes`, never dropped in silence.
 */

import type { AnalysisOptions, MaterialModel, SlopeDefinition } from "@cslope/engine";
import { regionInteriorPoint } from "../../../utils/regions";
import type { GszFile, GszMaterial, GszSlipResult } from "./gsz-read";

type Pt = [number, number];

export interface GszImport {
  name: string;
  definition: SlopeDefinition;
  options: Partial<AnalysisOptions>;
  /** What did not carry over exactly. */
  notes: string[];
  /** The file's own critical circle and factor of safety, when it has results. */
  reference?: GszSlipResult;
}

// unit conversion of an Imperial file: ft → m, pcf → kN/m³, psf → kPa
const FT = 0.3048;
const PCF = 0.157087463;
const PSF = 0.0478802589;

const isStability = (kind: string) => /slope/i.test(kind);

/** The stability analyses of a file (the seepage and other parts left out). */
export function stabilityAnalyses(file: GszFile) {
  return file.analyses.filter((a) => isStability(a.kind));
}

function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function onSegment(p: Pt, a: Pt, b: Pt, tol: number): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  if (t <= 1e-9 || t >= 1 - 1e-9) return false;
  const qx = a[0] + t * dx - p[0], qy = a[1] + t * dy - p[1];
  return qx * qx + qy * qy <= tol * tol;
}

/** The highest ground (outline) point above x, or null. */
function groundAt(outline: Pt[], x: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i], [x2, y2] = outline[(i + 1) % outline.length];
    if ((x < Math.min(x1, x2)) || (x > Math.max(x1, x2)) || x1 === x2) continue;
    const y = y1 + ((x - x1) * (y2 - y1)) / (x2 - x1);
    if (best === null || y > best) best = y;
  }
  return best;
}

function lineYAt(line: Pt[], x: number): number | null {
  for (let i = 0; i + 1 < line.length; i++) {
    const [x1, y1] = line[i], [x2, y2] = line[i + 1];
    if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2)) {
      return x1 === x2 ? Math.max(y1, y2) : y1 + ((x - x1) * (y2 - y1)) / (x2 - x1);
    }
  }
  return null;
}

/**
 * Outline and interior boundaries of a set of regions that share corner
 * points: an edge used by one region is on the outline, one shared by two
 * is a boundary between materials.
 */
function regionsToGeometry(polys: { id: number; pts: number[] }[], points: Map<number, Pt>, notes: string[]) {
  const tol = 1e-6 * Math.max(1, ...[...points.values()].map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  // corner points of other regions that lie on an edge (T-junctions) become corners of that edge too
  const used = [...new Set(polys.flatMap((p) => p.pts))];
  const rings = polys.map((poly) => {
    const out: number[] = [];
    for (let i = 0; i < poly.pts.length; i++) {
      const a = poly.pts[i], b = poly.pts[(i + 1) % poly.pts.length];
      out.push(a);
      const pa = points.get(a)!, pb = points.get(b)!;
      const between = used
        .filter((q) => q !== a && q !== b && onSegment(points.get(q)!, pa, pb, tol))
        .sort((q1, q2) => {
          const d = (q: number) => (points.get(q)![0] - pa[0]) ** 2 + (points.get(q)![1] - pa[1]) ** 2;
          return d(q1) - d(q2);
        });
      out.push(...between);
    }
    return { id: poly.id, pts: out };
  });
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const count = new Map<string, number>();
  for (const r of rings) for (let i = 0; i < r.pts.length; i++) {
    const k = key(r.pts[i], r.pts[(i + 1) % r.pts.length]);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const outerEdges: [number, number][] = [];
  const innerEdges: [number, number][] = [];
  for (const [k, n] of count) {
    const [a, b] = k.split(",").map(Number) as [number, number];
    (n === 1 ? outerEdges : innerEdges).push([a, b]);
  }
  // outline loops
  const adj = new Map<number, number[]>();
  for (const [a, b] of outerEdges) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const seen = new Set<string>();
  const loops: number[][] = [];
  for (const [a, b] of outerEdges) {
    if (seen.has(key(a, b))) continue;
    const loop = [a];
    let prev = a, cur = b;
    seen.add(key(a, b));
    while (cur !== a) {
      loop.push(cur);
      const next = (adj.get(cur) ?? []).find((n) => n !== prev && !seen.has(key(cur, n)));
      if (next === undefined) break;
      seen.add(key(cur, next));
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  if (loops.length === 0) throw new Error("The regions of the analysis do not form a closed outline.");
  const ptsOf = (ids: number[]) => ids.map((i) => points.get(i)!);
  loops.sort((l1, l2) => Math.abs(polygonArea(ptsOf(l2))) - Math.abs(polygonArea(ptsOf(l1))));
  if (loops.length > 1) {
    notes.push(`The soil regions have ${loops.length} separate outlines; the largest is the model, the other ${loops.length - 1} left out (a hole or a separate body).`);
  }
  const outlineIds = new Set(loops[0]);
  // interior boundaries: chains of shared edges between branch points or the outline
  const iadj = new Map<number, number[]>();
  for (const [a, b] of innerEdges) {
    iadj.set(a, [...(iadj.get(a) ?? []), b]);
    iadj.set(b, [...(iadj.get(b) ?? []), a]);
  }
  const iseen = new Set<string>();
  const chains: number[][] = [];
  const isEnd = (p: number) => outlineIds.has(p) || (iadj.get(p)?.length ?? 0) !== 2;
  const walk = (start: number, next: number) => {
    const chain = [start];
    let prev = start, cur = next;
    iseen.add(key(start, next));
    while (true) {
      chain.push(cur);
      if (isEnd(cur) || cur === start) break;
      const n = (iadj.get(cur) ?? []).find((q) => q !== prev && !iseen.has(key(cur, q)));
      if (n === undefined) break;
      iseen.add(key(cur, n));
      prev = cur;
      cur = n;
    }
    chains.push(chain);
  };
  for (const p of iadj.keys()) if (isEnd(p)) for (const n of iadj.get(p)!) if (!iseen.has(key(p, n))) walk(p, n);
  // closed boundaries (a lens inside the soil)
  for (const [a, b] of innerEdges) if (!iseen.has(key(a, b))) walk(a, b);
  return {
    outline: ptsOf(loops[0]),
    boundaries: chains.map(ptsOf),
    rings: rings.map((r) => ({ id: r.id, pts: ptsOf(r.pts) })),
  };
}

/**
 * The piezometric line a material uses, for its strength from suction:
 * whether it has one, and the line's cap on the suction (kPa) if any.
 */
interface MaterialWater {
  hasLine: boolean;
  maxSuction?: number;
}

/**
 * Strength from suction of a Mohr-Coulomb material: a constant φb
 * (UnsatPhiB) with the cap of its piezometric line. Suction strength from
 * a function of the volumetric water content has no counterpart and is
 * noted; so is a φb without a line (no negative pore pressure there).
 */
function suctionOf(m: GszMaterial, phiB: number | undefined, water: MaterialWater, notes: string[]): { phiB?: number; maxSuction?: number } {
  if (/function/i.test(m.fields.SlopeSuctionModel ?? "")) {
    if (water.hasLine) notes.push(`Material "${m.name}": the strength from suction is given by a function (from the volumetric water content); it is not imported, so the material has no suction strength.`);
    return {};
  }
  if (phiB === undefined || !(phiB > 0)) return {};
  if (!(phiB < 90)) {
    notes.push(`Material "${m.name}": φb = ${phiB}° is not below 90°; the strength from suction is not imported.`);
    return {};
  }
  if (!water.hasLine) {
    notes.push(`Material "${m.name}": φb = ${phiB}° without a piezometric line (no suction) is not imported.`);
    return {};
  }
  return { phiB, ...(water.maxSuction !== undefined && water.maxSuction > 0 ? { maxSuction: water.maxSuction } : {}) };
}

function materialModel(m: GszMaterial, scale: { len: number; weight: number; stress: number }, notes: string[], water: MaterialWater = { hasLine: false }): MaterialModel {
  const f = (k: string): number | undefined => {
    const v = Number(m.fields[k]);
    return Number.isFinite(v) && m.fields[k] !== undefined ? v : undefined;
  };
  const gamma = (f("UnitWeight") ?? 0) * scale.weight;
  const unitWeight = gamma > 0 ? gamma : 20;
  if (!(gamma > 0) && m.model !== "Bedrock") notes.push(`Material "${m.name}": no unit weight in the file; 20 kN/m³ used.`);
  switch (m.model) {
    case "MohrCoulomb":
      return {
        kind: "mohr-coulomb",
        unitWeight,
        cohesion: (f("CohesionPrime") ?? 0) * scale.stress,
        frictionAngle: f("PhiPrime") ?? 0,
        ...suctionOf(m, f("UnsatPhiB"), water, notes),
      };
    case "UndrainedPhiZero":
      return { kind: "undrained", unitWeight, undrainedShearStrength: (f("Cohesion") ?? f("CohesionPrime") ?? 0) * scale.stress };
    case "Bedrock":
      return { kind: "impenetrable", unitWeight };
    case "HighStrength":
      return { kind: "high-strength", unitWeight };
    default: {
      const c = (f("CohesionPrime") ?? f("Cohesion") ?? 0) * scale.stress;
      const phi = f("PhiPrime") ?? 0;
      const params = Object.entries(m.fields)
        .filter(([k]) => !/FnNum$|Model$/.test(k))
        .map(([k, v]) => `${k} = ${v}`)
        .join(", ");
      // no strength in the plain fields (it is in a function): a placeholder the model accepts
      const placeholder = !(c > 0) && !(phi > 0);
      notes.push(
        `Material "${m.name}": the strength model "${m.model || "unnamed"}" has no counterpart in the import yet; it is read as Mohr-Coulomb with ${placeholder ? "a placeholder c = 0.001 kPa (the file gives the strength as a function)" : `c = ${c.toFixed(2)} kPa, φ = ${phi}°`}, which is NOT the same strength. Enter it by hand. The file gives: ${params}.`,
      );
      return { kind: "mohr-coulomb", unitWeight, cohesion: placeholder ? 0.001 : c, frictionAngle: phi };
    }
  }
}

/** One stability analysis of a .gsz file as a slope definition. */
export function gszToDefinition(file: GszFile, analysisId: number, fileName = "gsz"): GszImport {
  const analysis = file.analyses.find((a) => a.id === analysisId);
  if (!analysis) throw new Error(`The file has no analysis ${analysisId}.`);
  const notes: string[] = [];
  const imperial = file.units === "imperial";
  const scale = imperial ? { len: FT, weight: PCF, stress: PSF } : { len: 1, weight: 1, stress: 1 };
  if (imperial) notes.push("The file is in Imperial units; converted to m, kN/m³ and kPa.");
  const L = (p: Pt): Pt => [p[0] * scale.len, p[1] * scale.len];

  const geometry = file.geometries.get(analysis.geometryId) ?? file.geometries.get(1);
  if (!geometry) throw new Error(`Analysis "${analysis.name}" has no geometry.`);
  const assign = file.regionMaterials.get(analysis.id) ?? new Map<number, number>();
  const soil = [...geometry.regions].filter(([rid]) => assign.has(rid)).map(([id, pts]) => ({ id, pts }));
  if (soil.length === 0) throw new Error(`Analysis "${analysis.name}" assigns no material to any region.`);
  const unassigned = geometry.regions.size - soil.length;
  if (unassigned > 0) notes.push(`${unassigned} region${unassigned === 1 ? "" : "s"} without a material in this analysis left out.`);
  const points = new Map([...geometry.points].map(([k, p]) => [k, L(p)] as [number, Pt]));
  const geo = regionsToGeometry(soil, points, notes);

  // materials: those the analysis uses, by unique name
  const usedIds = [...new Set(soil.map((r) => assign.get(r.id)!))];
  const nameOf = new Map<number, string>();
  const names = new Set<string>();
  for (const id of usedIds) {
    const base = file.materials.get(id)?.name ?? `Material ${id}`;
    let n = base, k = 2;
    while (names.has(n)) n = `${base} (${k++})`;
    names.add(n);
    nameOf.set(id, n);
  }

  // water: one line per piezometric surface; materials without one get none
  const stab = file.stability.get(analysis.id);
  const water = file.water.get(analysis.id);
  const waterOption = water?.option ?? "None";
  const gw = water?.gammaWater;
  if (gw !== undefined && Math.abs(gw * scale.weight - 9.81) > 0.02) {
    notes.push(`The file's unit weight of water is ${(gw * scale.weight).toFixed(3)} kN/m³; cSlope uses 9.81.`);
  }
  const xs = geo.outline.map((p) => p[0]), ys = geo.outline.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), yMin = Math.min(...ys);
  const clipLine = (line: Pt[]): Pt[] => {
    const l = line.map(L).sort((a, b) => a[0] - b[0]);
    if (l[0][0] > x0) l.unshift([x0, l[0][1]]);
    if (l[l.length - 1][0] < x1) l.push([x1, l[l.length - 1][1]]);
    return l;
  };
  const piezo = stab?.piezometric ?? new Map<number, Pt[]>();
  let waterTable: SlopeDefinition["waterTable"];
  const waterTables: NonNullable<SlopeDefinition["waterTables"]> = [];
  const waterIdOf = new Map<number, string>();
  // material id → its piezometric line's cap on the suction (as written), for φb
  const waterOfMaterial = new Map<number, MaterialWater>();
  if (/piezo/i.test(waterOption) && piezo.size > 0) {
    if (/bbar/i.test(waterOption)) notes.push("Pore pressure from B-bar (excess pore pressure from loading) is not imported; only the piezometric lines.");
    const usage = new Map<number, number>();
    for (const id of usedIds) {
      const p = stab?.materialPiezometric.get(id);
      if (p !== undefined && piezo.has(p)) usage.set(p, (usage.get(p) ?? 0) + 1);
    }
    const main = [...usage].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (main !== undefined) {
      // a line above the ground is free water standing on it, as in the file
      waterTable = { mode: "custom", value: clipLine(piezo.get(main)!), followBoundary: false };
      for (const [pid] of usage) {
        if (pid === main) continue;
        waterTables.push({ id: `piezo-${pid}`, coordinates: clipLine(piezo.get(pid)!), followBoundary: false });
      }
    }
    const dry = usedIds.filter((id) => !usage.has(stab?.materialPiezometric.get(id) ?? -1));
    if (dry.length > 0 && main !== undefined) {
      // no line for these materials: a line below the model gives no pore pressure
      waterTables.push({ id: "no-water", coordinates: [[x0, yMin - 100], [x1, yMin - 100]], followBoundary: false });
      notes.push(`Materials without a piezometric line (${dry.map((id) => nameOf.get(id)).join(", ")}) get a line below the model (no pore pressure).`);
    }
    for (const id of usedIds) {
      const p = stab?.materialPiezometric.get(id);
      if (p !== undefined && p !== main && piezo.has(p)) waterIdOf.set(id, `piezo-${p}`);
      else if (p === undefined || !piezo.has(p)) if (main !== undefined) waterIdOf.set(id, "no-water");
      if (p !== undefined && piezo.has(p)) {
        const cap = stab?.piezometricMaxSuction.get(p);
        waterOfMaterial.set(id, { hasLine: true, ...(cap !== undefined ? { maxSuction: cap * scale.stress } : {}) });
      }
    }
  } else if (waterOption !== "None") {
    notes.push(`The pore pressure option "${waterOption}" is not imported (for example from a seepage analysis or ru); the model has no water.`);
  }

  const materials = usedIds.map((id) => {
    const m = file.materials.get(id) ?? { id, name: `Material ${id}`, model: "", fields: {} };
    const c = m.color;
    return {
      name: nameOf.get(id)!,
      model: materialModel(m, scale, notes, waterOfMaterial.get(id)),
      ...(c ? { color: `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}` } : {}),
      ...(waterIdOf.has(id) ? { waterTableId: waterIdOf.get(id) } : {}),
    };
  });

  // surcharge: the weight of the fill between the drawn line and the ground, in strips
  const udls: { magnitude: number; x1: number; x2: number; direction?: "normal" }[] = [];
  for (const s of stab?.surcharges ?? []) {
    const line = s.line.map(L);
    // normal to the ground: the pressure γ·h acts normal to it (water against a slope)
    const normal = /normal/i.test(s.direction);
    const gw = s.unitWeight * scale.weight;
    const lx = line.map((p) => p[0]);
    const a = Math.max(Math.min(...lx), x0), b = Math.min(Math.max(...lx), x1);
    const cuts = [...new Set([a, b, ...lx, ...xs].filter((x) => x >= a && x <= b))].sort((p, q) => p - q);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const n = Math.max(1, Math.ceil((cuts[i + 1] - cuts[i]) / 0.5));
      for (let k = 0; k < n; k++) {
        const u = cuts[i] + ((cuts[i + 1] - cuts[i]) * k) / n, v = cuts[i] + ((cuts[i + 1] - cuts[i]) * (k + 1)) / n;
        const xm = (u + v) / 2;
        const top = lineYAt(line, xm), g = groundAt(geo.outline, xm);
        if (top === null || g === null || top <= g) continue;
        const q = Number((gw * (top - g)).toFixed(3));
        const last = udls[udls.length - 1];
        if (last && Math.abs(last.x2 - u) < 1e-9 && last.magnitude === q && (last.direction === "normal") === normal) last.x2 = v;
        else udls.push({ magnitude: q, x1: u, x2: v, ...(normal ? { direction: "normal" as const } : {}) });
      }
    }
    if (s.direction && !/vertical|normal/i.test(s.direction)) notes.push(`A surcharge direction "${s.direction}" is imported as vertical.`);
  }
  if ((stab?.surcharges.length ?? 0) > 0) {
    notes.push(`${stab!.surcharges.length} surcharge${stab!.surcharges.length === 1 ? "" : "s"} imported as distributed loads: the unit weight times the height of the fill above the ground, in strips.`);
  }
  const lineLoads = (stab?.lineLoads ?? []).map((l) => {
    if (Math.abs(l.plunge - 90) > 0.5) notes.push(`A line load at x = ${(l.x * scale.len).toFixed(2)} is inclined (${l.plunge}° below horizontal); imported as vertical.`);
    return { magnitude: l.value * (imperial ? 0.0145939 : 1), x: l.x * scale.len };
  });

  const options: Partial<AnalysisOptions> = {};
  const method = analysis.method.toLowerCase().replace(/[^a-z]/g, "");
  if (method === "spencer") Object.assign(options, { method: "Morgenstern-Price", intersliceFunction: "constant" });
  else if (method === "morgensternprice") Object.assign(options, { method: "Morgenstern-Price", intersliceFunction: "half-sine" });
  else if (method.startsWith("bishop")) options.method = "Bishop";
  else if (method.startsWith("janbu")) options.method = "Janbu";
  else {
    options.method = "Morgenstern-Price";
    notes.push(`The method "${analysis.method}" is not available; Morgenstern-Price is used.`);
  }
  if (stab?.slices) options.slices = Math.min(500, Math.max(10, Math.round(stab.slices)));

  const results = file.results.get(analysis.name.toLowerCase()) ?? [];
  const best = results.slice().sort((a, b) => a.fos - b.fos)[0];
  let orientation: SlopeDefinition["orientation"];
  if (stab?.direction === "RightToLeft") orientation = "rtl";
  else if (stab?.direction === "LeftToRight") orientation = "ltr";
  // not stated: the direction the file's own critical mass moved
  else if (best?.direction !== undefined) orientation = best.direction > 0 ? "ltr" : "rtl";

  let analysisLimits: SlopeDefinition["analysisLimits"];
  if (stab?.entryExit && /entry/i.test(stab.slipOption ?? "")) {
    const { left, right } = stab.entryExit;
    const [entry, exit] = orientation === "rtl" ? [right, left] : [left, right];
    analysisLimits = {
      entryLeftX: entry[0] * scale.len, entryRightX: entry[1] * scale.len,
      exitLeftX: exit[0] * scale.len, exitRightX: exit[1] * scale.len,
    };
  } else if (stab?.slipOption) {
    notes.push(`The file's slip surface search ("${stab.slipOption}") is not imported; cSlope's own search over the whole slope is used.`);
  }
  if (stab?.tensionCrack) {
    const tc = stab.tensionCrack;
    if (tc.line.length >= 2) {
      const depths = tc.line.map(L).map(([x, y]) => (groundAt(geo.outline, x) ?? y) - y).filter((d) => d > 0);
      if (depths.length > 0) {
        options.tensionCrackDepth = Number((depths.reduce((s, d) => s + d, 0) / depths.length).toFixed(3));
        notes.push(`The tension crack line is imported as a crack depth of ${options.tensionCrackDepth} m.`);
      }
    } else if (/angle/i.test(tc.option) && tc.angle !== undefined && tc.angle > 0 && tc.angle < 90) {
      options.tensionCrackAngle = tc.angle;
    } else notes.push(`The tension crack option "${tc.option}"${tc.angle !== undefined ? ` (${tc.angle}°)` : ""} is not imported.`);
    if (tc.waterPercent > 0 && (options.tensionCrackAngle || options.tensionCrackDepth)) options.tensionCrackWater = Math.min(1, tc.waterPercent / 100);
  }
  if (stab && (stab.seismicH !== 0 || stab.seismicV !== 0)) {
    notes.push(`The seismic coefficients (kh = ${stab.seismicH}, kv = ${stab.seismicV}) are not imported.`);
  }

  const regionAssignments = geo.rings.map((r) => {
    const pt = regionInteriorPoint(r.pts.map((p) => p[0]), r.pts.map((p) => p[1]));
    return { point: pt, materialName: nameOf.get(assign.get(r.id)!)! };
  });

  // the file's critical surface, when it is a circle (an optimised or block surface is not)
  const circularBest = best && best.circular && !stab?.optimised && !stab?.projected;
  const reference = circularBest
    ? { ...best, cx: best.cx * scale.len, cy: best.cy * scale.len, r: best.r * scale.len, ...(best.weight !== undefined ? { weight: best.weight * (imperial ? 0.0145939 : 1) } : {}) }
    : undefined;
  if (best && !circularBest) notes.push(`The file's critical surface (F = ${best.fos.toFixed(3)}) is not a circle; it is not carried over.`);

  const definition: SlopeDefinition = {
    ...(orientation ? { orientation } : {}),
    coordinates: geo.outline,
    materials,
    materialBoundaries: geo.boundaries.map((c) => ({ coordinates: c, materialName: "" })),
    regionAssignments,
    ...(waterTable ? { waterTable } : {}),
    ...(waterTables.length > 0 ? { waterTables } : {}),
    udls,
    lineLoads,
    ...(analysisLimits ? { analysisLimits } : {}),
    ...(reference ? { customSearchPlanes: [{ cx: reference.cx, cy: reference.cy, radius: reference.r }] } : {}),
  } as SlopeDefinition;
  const base = fileName.replace(/\.gsz$/i, "");
  return { name: stabilityAnalyses(file).length > 1 ? `${base} – ${analysis.name}` : base, definition, options, notes, reference };
}
