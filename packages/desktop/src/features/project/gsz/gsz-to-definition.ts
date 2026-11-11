/**
 * A .gsz stability analysis as a cSlope slope definition: the regions
 * become the outline, the material boundaries and region assignments; the
 * materials, piezometric lines, surcharges, line loads, method and entry and
 * exit ranges are carried over. What has no counterpart is listed in
 * `notes`, never dropped in silence.
 */

import { calculatePolygonArea, getYAtXStrict, WATER_UNIT_WEIGHT, type AnalysisOptions, type MaterialModel, type Pile, type Reinforcement, type SlopeDefinition } from "@cslope/engine";
import { surfaceYAtX } from "../../view/surface";
import { regionInteriorPoint } from "../../../utils/regions";
import type { GszAnalysis, GszBlockGrid, GszFile, GszMaterial, GszSlipResult, GszStability } from "./gsz-read";

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
/** lbf → kN */
const LBF = 0.00444822162;

/**
 * The reinforcement of an analysis as cSlope elements. Anchors and nails
 * pull along themselves, from end 1 (the head), with the bond resistance
 * (a stress) over the bond's circumference (π × the bond diameter) along
 * the bonded length (anchors: at the embedded end) or the whole length
 * (nails); the plate capacity anchors the head. Geosynthetics take the
 * pullout resistance per metre of length and width as given, or from the
 * overburden (adhesion, interface angle, surface area factor). Piles, and
 * anchors or nails with a shear force, resist with that shear force along
 * the slip surface. "F of S dependent" elements are passive (divided by
 * F), the others active.
 */
function reinforcementOf(
  file: GszFile,
  stab: GszStability | undefined,
  scale: { len: number; stress: number },
  imperial: boolean,
  notes: string[],
): { reinforcements: Reinforcement[]; piles: Pile[] } {
  const reinforcements: Reinforcement[] = [];
  const piles: Pile[] = [];
  const force = imperial ? LBF : 1;
  const perLength = imperial ? PSF * FT : 1; // lbf/ft → kN/m
  const said = new Set<string>();
  const once = (n: string) => {
    if (!said.has(n)) notes.push(n);
    said.add(n);
  };
  for (const line of stab?.reinforcementLines ?? []) {
    const r = file.reinforcements?.get(line.reinforcement);
    if (!r) continue;
    const [x1, y1] = [line.p1[0] * scale.len, line.p1[1] * scale.len];
    const [x2, y2] = [line.p2[0] * scale.len, line.p2[1] * scale.len];
    const application = r.fosDependent ? ("passive" as const) : ("active" as const);
    const type = r.type.toLowerCase();
    const sheet = type === "geosynthetic";
    const spacing = !sheet && r.spacing !== undefined && r.spacing > 0 ? r.spacing * scale.len : undefined;
    if (type === "userdefined") {
      once(`Reinforcement "${r.name}": a user-defined force (a function of distance) is not imported.`);
      continue;
    }
    if (type === "pile" || (r.shear !== undefined && r.shear > 0)) {
      if (r.shear !== undefined && r.shear > 0) {
        piles.push({ x1, y1, x2, y2, force: r.shear * force, ...(spacing ? { spacing } : {}), direction: "tangent", application });
      }
      if (type === "pile") continue;
    }
    // No tensile capacity in the file: nothing to carry (not an unlimited element).
    if (r.tensile === undefined) {
      once(`Reinforcement "${r.name}": the file gives no tensile capacity; it is not imported.`);
      continue;
    }
    if (r.pullout === undefined && !(sheet && r.calculatedPullout)) {
      once(`Reinforcement "${r.name}": the file gives no pullout resistance; both its ends are taken as fully anchored (the tensile capacity wherever it is crossed).`);
    } else if (!sheet && r.pullout !== undefined && !(r.bondDiameter !== undefined && r.bondDiameter > 0)) {
      once(`Reinforcement "${r.name}": no bond diameter in the file; its pullout resistance is taken per meter of the element.`);
    }
    const orientation = r.orientation ?? 0;
    const direction = orientation <= 0.25 ? "axial" : orientation >= 0.75 ? "tangent" : "bisector";
    if (orientation !== 0 && orientation !== 0.5 && orientation !== 1) {
      once(`Reinforcement "${r.name}": the force orientation ${orientation} (0: along the reinforcement, 1: along the slip surface) is imported as ${direction}.`);
    }
    if (sheet) {
      const pullout: Reinforcement["pullout"] = r.calculatedPullout
        ? { kind: "interface", adhesion: (r.adhesion ?? 0) * scale.stress, frictionAngle: r.interfaceAngle ?? 0, coverage: (r.surfaceAreaFactor ?? 2) / 2 }
        : r.pullout !== undefined ? { kind: "bond", strength: r.pullout * scale.stress } : undefined;
      reinforcements.push({
        x1, y1, x2, y2,
        tensileCapacity: r.tensile * perLength,
        ...(pullout ? { pullout } : {}),
        end1Capacity: (r.plate ?? 0) * perLength,
        direction, application,
      });
    } else {
      // the bond resistance per metre of the element
      // a stress over the circumference; without a diameter, per length
      const strength =
        r.pullout === undefined
          ? undefined
          : r.bondDiameter !== undefined && r.bondDiameter > 0
            ? r.pullout * scale.stress * Math.PI * r.bondDiameter * scale.len
            : r.pullout * perLength;
      const anchor = type !== "nail";
      const bonded = anchor && r.bondLength !== undefined && r.bondLength > 0 ? r.bondLength * scale.len : undefined;
      const tensile = r.tensile * force;
      reinforcements.push({
        x1, y1, x2, y2,
        tensileCapacity: tensile,
        ...(spacing ? { spacing } : {}),
        ...(strength !== undefined ? { pullout: { kind: "bond" as const, strength, ...(bonded ? { bondedLength: bonded } : {}) } } : {}),
        // an anchor's head bears on the wall: its plate, or the tendon
        end1Capacity: r.plate !== undefined ? r.plate * force : anchor ? tensile : 0,
        direction, application,
      });
    }
    if (r.distribution !== "Concentrated") {
      once("Distributed reinforcement forces (spread over the slices the reinforcement crosses) are applied where the slip surface crosses it.");
    }
  }
  if (reinforcements.length + piles.length > 0) {
    notes.push(`The reinforcement is imported: ${reinforcements.length} element${reinforcements.length === 1 ? "" : "s"}${piles.length > 0 ? ` and ${piles.length} shear force${piles.length === 1 ? "" : "s"} (piles)` : ""}.`);
  }
  return { reinforcements, piles };
}

const isStability = (kind: string) => /slope/i.test(kind);

/** The stability analyses of a file (the seepage and other parts left out). */
export function stabilityAnalyses(file: GszFile) {
  return file.analyses.filter((a) => isStability(a.kind));
}

const polygonArea = (p: Pt[]): number => calculatePolygonArea(p.map((q) => q[0]), p.map((q) => q[1]));

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
const groundAt = surfaceYAtX;

/** A line's y at x inside its x-range: the first segment reaching x (the engine's rule). */
function lineYAt(line: Pt[], x: number): number {
  return getYAtXStrict([line.map((p) => p[0]), line.map((p) => p[1])], x);
}

/** The most soil regions (or layers) of an analysis that are imported. */
export const MAX_REGIONS = 1000;

/**
 * Outline and interior boundaries of a set of regions that share corner
 * points: an edge used by one region is on the outline, one shared by two
 * is a boundary between materials.
 */
export function regionsToGeometry(polys: { id: number; pts: number[] }[], points: Map<number, Pt>, notes: string[]) {
  // (each region becomes a boundary, and the time to build the model grows with their square)
  if (polys.length > MAX_REGIONS) throw new Error(`The model has ${polys.length} soil regions; at most ${MAX_REGIONS} can be imported.`);
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

/**
 * An anisotropy function of the format ([inclination °, factor]) in cSlope's
 * convention, and back (the conversion is its own inverse): the inclination
 * changes sign. cSlope's α is positive where the slice base dips down in the
 * direction of sliding (the scarp) and negative at the toe; the format's
 * inclination is negative at the scarp and positive at the toe.
 *
 * Measured for a model sliding right to left: the strengths of the slices
 * stored with the results of an example file (a scarp base rising at +60°
 * towards +x, a toe base at −18°) are those of the function at the opposite
 * inclination, for c and φ alike (and for a function on the shear strength):
 * so the inclination is not the geometric angle there. Derived, not measured,
 * for a model sliding left to right (no example with results slides that way
 * through such a function): the scarp base's geometric angle is negative
 * there too, so the same sign change holds whether the format takes the
 * inclination relative to the sliding direction or geometrically.
 */
export function anisotropyFromGsz(points: readonly (readonly [number, number])[]): [number, number][] {
  return points.map(([a, k]): [number, number] => [0 - a, k]).sort((p, q) => p[0] - q[0]);
}

function materialModel(
  m: GszMaterial,
  scale: { len: number; weight: number; stress: number },
  notes: string[],
  water: MaterialWater = { hasLine: false },
  anisotropyFunctions?: Map<number, [number, number][]>,
  materialFunctions?: GszFile["materialFunctions"],
  cohesionFunctions?: GszFile["cohesionFunctions"],
  strengthFunctions?: GszFile["strengthFunctions"],
): MaterialModel {
  const f = (k: string): number | undefined => {
    const v = Number(m.fields[k]);
    return Number.isFinite(v) && m.fields[k] !== undefined ? v : undefined;
  };
  const gamma = (f("UnitWeight") ?? 0) * scale.weight;
  const unitWeight = gamma > 0 ? gamma : 20;
  if (!(gamma > 0) && m.model !== "Bedrock") notes.push(`Material "${m.name}": no unit weight in the file; 20 kN/m³ used.`);
  // An anisotropy function on the shear strength: on the undrained models
  // as their anisotropy (interpolated linearly; the file uses a spline), its
  // inclination's sign changed to cSlope's (anisotropyFromGsz).
  const anisoId = f("ShearAnisoFnNum");
  const aniso = anisoId !== undefined ? anisotropyFunctions?.get(anisoId) : undefined;
  const linearNote = (n: number) =>
    `Material "${m.name}": the anisotropy function is imported as factors interpolated linearly between its ${n} points (the file uses a spline), with the sign of the inclination changed to cSlope's (positive where the base dips down in the direction of sliding).`;
  const undrainedAniso = (): { anisotropy?: [number, number][] } => {
    if (!aniso) return {};
    notes.push(linearNote(aniso.length));
    return { anisotropy: anisotropyFromGsz(aniso) };
  };
  if (aniso && m.model !== "UndrainedPhiZero" && m.model !== "SFnDepth" && m.model !== "SHANSEP") {
    notes.push(`Material "${m.name}": the anisotropy function on the shear strength is not imported for the model "${m.model}".`);
  }
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
      return { kind: "undrained", unitWeight, undrainedShearStrength: (f("Cohesion") ?? f("CohesionPrime") ?? 0) * scale.stress, ...undrainedAniso() };
    case "SFnDepth": {
      // Su at the top of the layer and its increase with depth below it
      const top = f("CTopOfLayer"), rate = f("CRateOfIncrease"), max = f("CMaximum");
      if (top !== undefined) {
        return {
          kind: "s-f-depth",
          unitWeight,
          suRef: top * scale.stress,
          depthRef: 0,
          rate: ((rate ?? 0) * scale.stress) / scale.len,
          depthReference: "layer-top",
          ...(max !== undefined && max > 0 ? { suMax: max * scale.stress } : {}),
          ...undrainedAniso(),
        };
      }
      break;
    }
    case "HoekBrown": {
      // from GSI, mi and D, or mb, s and a given directly; the file's
      // envelope is a spline up to MaxConfiningStress, cSlope's exact
      const ucs = f("UniaxialCompressiveStrength");
      const mb = f("HoekBrownMB"), s = f("HoekBrownS"), a = f("HoekBrownA");
      if (ucs !== undefined && ucs > 0) {
        if (m.fields.IsHoekBrownDerivedCalc !== "true" && mb !== undefined && s !== undefined) {
          return { kind: "hoek-brown", unitWeight, ucs: ucs * scale.stress, gsi: 100, mi: mb, mb, s, ...(a !== undefined ? { a } : {}) };
        }
        const gsi = f("GeologicalStrengthIndex");
        if (gsi !== undefined) {
          const mi = f("IntactRockParam");
          if (mi === undefined) notes.push(`Material "${m.name}": no mi in the file; 10 used (the format's default).`);
          return { kind: "hoek-brown", unitWeight, ucs: ucs * scale.stress, gsi, mi: mi ?? 10, disturbance: f("DisturbanceFactor") ?? 0 };
        }
      }
      break;
    }
    case "ShearNormalFn": {
      const id = f("StrengthFnNum");
      const g = id !== undefined ? strengthFunctions?.get(id) : undefined;
      if (g && g.input === "NormalStress" && g.points.length >= 2) {
        return {
          kind: "shear-normal", unitWeight,
          points: g.points.map(([sn, tau]) => [sn * scale.stress, Math.max(0, tau) * scale.stress]),
          ...(g.spline ? { spline: { ...(g.spline.startSlope !== undefined ? { startSlope: g.spline.startSlope } : {}), ...(g.spline.endSlope !== undefined ? { endSlope: g.spline.endSlope } : {}) } } : {}),
        };
      }
      break;
    }
    case "MohrCoulombSpatial": {
      // c a straight-line function of elevation with φ = 0: S = f(datum)
      const id = f("CohesionFnNum");
      const g = id !== undefined ? cohesionFunctions?.get(id) : undefined;
      if (g && g.input === "Y" && g.points.length === 2 && !(f("PhiPrime") ?? 0)) {
        const [[ya, ca], [yb, cb]] = g.points;
        if (yb > ya) {
          return {
            kind: "s-f-datum", unitWeight,
            suRef: cb * scale.stress, yRef: yb * scale.len,
            rate: ((ca - cb) * scale.stress) / ((yb - ya) * scale.len),
          };
        }
      }
      break;
    }
    case "SHANSEP": {
      // Su = σ′v·S·OCR^m (OCR a function of elevation with the "Custom"
      // model), Su a function of σ′v ("Function"), or Su/σ′v constant
      const option = m.fields.SlopeUndrainedStrengthModel ?? "";
      const fn = (key: string, input: string) => {
        const id = f(key);
        const g = id !== undefined ? materialFunctions?.get(id) : undefined;
        return g && g.input === input ? g : undefined;
      };
      // the spline in stress units (its end slopes are ratios of the units)
      const splineOf = (g: { spline?: { startSlope?: number; endSlope?: number } }, k: number) =>
        g.spline ? { spline: { ...(g.spline.startSlope !== undefined ? { startSlope: g.spline.startSlope * k } : {}), ...(g.spline.endSlope !== undefined ? { endSlope: g.spline.endSlope * k } : {}) } } : {};
      if (/function/i.test(option)) {
        const g = fn("ShearVerticalFnNum", "YEffectiveStress");
        if (g) {
          return { kind: "shansep", unitWeight, ratio: f("TauSigmaRatio") ?? 0, suByStress: g.points.map(([s, su]) => [s * scale.stress, su * scale.stress]), ...splineOf(g, 1), ...undrainedAniso() };
        }
      } else if (/custom/i.test(option)) {
        const ratio = f("NCUndrainedStrengthRatio"), m_ = f("SHANSEPExponent");
        const g = fn("OCRFnNum", "Y");
        const ocr = f("OCRatio");
        if (ratio !== undefined && (g || (ocr !== undefined && ocr > 0))) {
          return {
            kind: "shansep", unitWeight, ratio,
            ...(m_ !== undefined ? { exponent: m_ } : {}),
            ...(g ? { ocrByElevation: g.points.map(([y, o]) => [y * scale.len, o]), ...splineOf(g, 1 / scale.len) } : { ocr }),
            ...undrainedAniso(),
          };
        }
      } else {
        const ratio = f("TauSigmaRatio");
        if (ratio !== undefined) return { kind: "shansep", unitWeight, ratio, ocr: 1, ...undrainedAniso() };
      }
      break;
    }
    case "AnisotropicFn": {
      // c and φ (in degrees) times one function of the base inclination; a
      // separate function for φ has no counterpart (read below with a note)
      const cId = f("CAnisoFnNum"), phiId = f("PhiAnisoFnNum");
      const fn = cId !== undefined ? anisotropyFunctions?.get(cId) : undefined;
      if (fn && phiId === cId) {
        notes.push(linearNote(fn.length));
        return {
          kind: "anisotropic-function",
          unitWeight,
          cohesion: (f("CohesionPrime") ?? 0) * scale.stress,
          frictionAngle: f("PhiPrime") ?? 0,
          modifierFunction: anisotropyFromGsz(fn),
          ...suctionOf(m, f("UnsatPhiB"), water, notes),
        };
      }
      if (fn && phiId !== undefined && anisotropyFunctions?.has(phiId)) {
        notes.push(`Material "${m.name}": c and φ have different anisotropy functions; cSlope's anisotropic function applies one to both.`);
      }
      break;
    }
    case "Bedrock":
      return { kind: "impenetrable", unitWeight };
    case "HighStrength":
      return { kind: "high-strength", unitWeight };
  }
  // A model not read above: Mohr-Coulomb from its plain fields, with a note.
  const c = (f("CohesionPrime") ?? f("Cohesion") ?? 0) * scale.stress;
  const phi = f("PhiPrime") ?? 0;
  const params = Object.entries(m.fields)
    .filter(([k]) => !/FnNum$|Model$/.test(k))
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");
  // no strength in the plain fields (it is in a function): a placeholder the model accepts
  const placeholder = !(c > 0) && !(phi > 0);
  notes.push(
    `Material "${m.name}": the strength model "${m.model || "unnamed"}" has no counterpart in the import yet; it is read as Mohr-Coulomb with ${placeholder ? "a placeholder c = 0.001 kPa (the file gives the strength as a function)" : `c = ${c.toFixed(2)} kPa, φ = ${phi}°`}, which is not the same strength. Enter it by hand. The file gives: ${params}.`,
  );
  return { kind: "mohr-coulomb", unitWeight, cohesion: placeholder ? 0.001 : c, frictionAngle: phi };
}

/** The slip surface settings of a stability analysis (its <SlipSurface>). */
const SLIP_SURFACE_FIELDS = ["direction", "slipOption", "entryExit", "slices", "optimised", "projected", "fullySpecified", "block", "axis"] as const;

/**
 * The stability settings of an analysis with the slip surface settings it
 * uses. A search "FromOther" takes the slip surfaces of the analysis its
 * input comes from (named in InitialInputInfo, or the parent analysis
 * when no other is named), through a chain of such analyses. When that
 * analysis cannot be found, or the chain loops, the analysis keeps its
 * own settings and `note` says why.
 */
function slipSurfaceSettings(
  file: GszFile, analysis: GszAnalysis, own: GszStability | undefined,
): { stab: GszStability | undefined; from?: GszAnalysis; note?: string } {
  const fallback = "cSlope's own search over the whole slope is used.";
  let current = analysis;
  let stab = own;
  const seen = new Set([analysis.id]);
  while (stab && /^fromother$/i.test(stab.slipOption ?? "")) {
    const ref = stab.inputFrom;
    const parent = current.parentId;
    const name = ref?.name;
    const source = name !== undefined
      ? file.analyses.find((a) => a.name === name) ?? file.analyses.find((a) => a.name.toLowerCase() === name.toLowerCase())
      : /^parent$/i.test(ref?.option ?? "Parent") && parent !== undefined ? file.analyses.find((a) => a.id === parent) : undefined;
    const sourceStab = source && file.stability.get(source.id);
    if (!source || !sourceStab) {
      const named = name !== undefined ? `"${name}"` : current === analysis ? "another analysis" : `another analysis (from "${current.name}")`;
      return { stab: own, note: `The file's slip surface search takes its slip surfaces from ${named}, which the file does not give as a stability analysis; ${fallback}` };
    }
    if (seen.has(source.id)) {
      return { stab: own, note: `The file's slip surface search takes its slip surfaces from other analyses in a loop (back to "${source.name}"), so none gives them; ${fallback}` };
    }
    seen.add(source.id);
    current = source;
    stab = sourceStab;
  }
  if (current === analysis || !own || !stab) return { stab: own };
  const slip = Object.fromEntries(SLIP_SURFACE_FIELDS.map((k) => [k, stab[k]])) as Pick<GszStability, (typeof SLIP_SURFACE_FIELDS)[number]>;
  return { stab: { ...own, ...slip }, from: current };
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
  for (const r of soil) {
    const missing = r.pts.find((id) => !points.has(id));
    if (missing !== undefined) throw new Error(`Analysis "${analysis.name}": region ${r.id} refers to ${Number.isFinite(missing) ? `point ${missing}, which the file does not give` : "a point that is not a number"}.`);
    if (r.pts.length < 3) throw new Error(`Analysis "${analysis.name}": region ${r.id} has fewer than three points.`);
  }
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
  // a search "FromOther" uses another analysis's slip surface settings
  const slipFrom = slipSurfaceSettings(file, analysis, file.stability.get(analysis.id));
  const stab = slipFrom.stab;
  const water = file.water.get(analysis.id);
  const waterOption = water?.option ?? "None";
  // the file's unit weight of water, in kN/m³, as the model's (absent: 9.807)
  const gw = water?.gammaWater;
  const gammaW = gw !== undefined ? Number((gw * scale.weight).toFixed(4)) : undefined;
  if (gammaW !== undefined && !(gammaW > 0)) notes.push(`The file's unit weight of water (${gw}) is not valid; ${WATER_UNIT_WEIGHT} kN/m³ is used.`);
  const xs = geo.outline.map((p) => p[0]), ys = geo.outline.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), yMin = Math.min(...ys);
  const clipLine = (line: Pt[]): Pt[] => {
    const l = line.map(L).sort((a, b) => a[0] - b[0]);
    if (l[0][0] > x0) l.unshift([x0, l[0][1]]);
    if (l[l.length - 1][0] < x1) l.push([x1, l[l.length - 1][1]]);
    return l;
  };
  // (a line without points, e.g. one whose points are missing, gives no water)
  const piezo = new Map([...(stab?.piezometric ?? [])].filter(([, line]) => line.length > 0));
  let waterTable: SlopeDefinition["waterTable"];
  const waterTables: NonNullable<SlopeDefinition["waterTables"]> = [];
  const waterIdOf = new Map<number, string>();
  // material id → its piezometric line's cap on the suction (as written), for φb
  const waterOfMaterial = new Map<number, MaterialWater>();
  if (/piezo/i.test(waterOption) && piezo.size > 0) {
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

  // B-bar: the excess pore pressure from the weight of the included fills
  // (the format's B-bar function, whose points the file does not hold: 1)
  const bBarOf = (id: number): { bBar?: number; bBarLoad?: true } => {
    if (!/bbar/i.test(waterOption)) return {};
    const b = stab?.bBar?.get(id);
    if (!b) return {};
    const value = b.value ?? (b.fn !== undefined ? (file.materialFunctions?.get(b.fn)?.points.length === 1 ? file.materialFunctions.get(b.fn)!.points[0][1] : 1) : undefined);
    return { ...(value !== undefined ? { bBar: value } : {}), ...(b.included ? { bBarLoad: true as const } : {}) };
  };
  if (/bbar/i.test(waterOption) && [...(stab?.bBar?.values() ?? [])].some((b) => b.fn !== undefined && b.value === undefined)) {
    notes.push("B̄ pore pressure: the excess pore pressure is B̄ = 1 times the weight of the included fill above (the file names a B̄ function without its points).");
  }

  // Rapid drawdown (three-stage): the materials' line is the water before
  // drawdown, the one line no material uses the water after it.
  let rapidDrawdown: SlopeDefinition["rapidDrawdown"];
  if (stab?.rapidDrawdown) {
    const used = new Set(usedIds.map((id) => stab.materialPiezometric.get(id)).filter((p): p is number => p !== undefined && piezo.has(p)));
    const after = [...piezo.keys()].filter((p) => !used.has(p));
    if (used.size === 1 && after.length === 1) {
      rapidDrawdown = { waterBefore: clipLine(piezo.get([...used][0])!) };
      waterTable = { mode: "custom", value: clipLine(piezo.get(after[0])!), followBoundary: false };
      waterTables.length = 0;
      waterIdOf.clear();
      notes.push("Rapid drawdown: imported as the three-stage analysis, with the materials' piezometric line as the water before drawdown and the other line as the water after it; the materials with drawdown strengths (cR, φR) do not drain.");
    } else {
      notes.push("Rapid drawdown: the piezometric lines before and after drawdown could not be told apart (one line used by all materials and one other expected); not imported as a drawdown analysis.");
    }
  }

  const materials = usedIds.map((id) => {
    const m = file.materials.get(id) ?? { id, name: `Material ${id}`, model: "", fields: {} };
    const c = m.color;
    const model = materialModel(m, scale, notes, waterOfMaterial.get(id), file.anisotropyFunctions, file.materialFunctions, file.cohesionFunctions, file.strengthFunctions);
    // the drawdown (R) envelope of a soil that does not drain
    const cR = Number(m.fields.DrawdownCohesion), phiR = Number(m.fields.DrawdownPhi);
    const drawdown =
      rapidDrawdown && model.kind === "mohr-coulomb" && (m.fields.DrawdownCohesion !== undefined || m.fields.DrawdownPhi !== undefined)
        ? { drawdownStrength: { cohesion: (Number.isFinite(cR) ? cR : 0) * scale.stress, frictionAngle: Number.isFinite(phiR) ? phiR : 0 } }
        : {};
    return {
      name: nameOf.get(id)!,
      model: { ...model, ...bBarOf(id), ...drawdown },
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
        if (g === null || top <= g) continue;
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
  // the direction from the plunge below the horizontal and the compass
  // trend of its horizontal part (90: +x): the angle from the downward
  // vertical, positive towards +x
  const lineLoads = (stab?.lineLoads ?? []).map((l) => {
    const p = (l.plunge * Math.PI) / 180, t = (l.trend * Math.PI) / 180;
    const angle = (Math.atan2(Math.cos(p) * Math.sin(t), Math.sin(p)) * 180) / Math.PI;
    const a = Math.abs(angle) < 1e-9 ? 0 : Number(angle.toFixed(6));
    return { magnitude: l.value * (imperial ? 0.0145939 : 1), x: l.x * scale.len, ...(a !== 0 ? { angle: a, y: l.y * scale.len } : {}) };
  });

  const options: Partial<AnalysisOptions> = {};
  if (gammaW !== undefined && gammaW > 0 && gammaW !== WATER_UNIT_WEIGHT) options.waterUnitWeight = gammaW;
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
  // A slip surface below the bottom of the geometry follows it there in
  // .gsz files (the material below is taken as impenetrable).
  options.compositeBase = true;
  // the phreatic correction of the pore pressure; otherwise the default
  // (the vertical head)
  if (stab?.phreaticCorrection) options.porePressureHead = "phreatic-correction";

  const results = file.results.get(analysis.name.toLowerCase()) ?? [];
  const best = results.slice().sort((a, b) => a.fos - b.fos)[0];
  let orientation: SlopeDefinition["orientation"];
  if (stab?.direction === "RightToLeft") orientation = "rtl";
  else if (stab?.direction === "LeftToRight") orientation = "ltr";
  // not stated: the direction the file's own critical mass moved
  else if (best?.direction !== undefined) orientation = best.direction > 0 ? "ltr" : "rtl";

  let analysisLimits: SlopeDefinition["analysisLimits"];
  let blockSearchObjects: SlopeDefinition["blockSearchObjects"];
  if (stab?.entryExit && /entry/i.test(stab.slipOption ?? "")) {
    const { left, right } = stab.entryExit;
    const [entry, exit] = orientation === "rtl" ? [right, left] : [left, right];
    analysisLimits = {
      entryLeftX: entry[0] * scale.len, entryRightX: entry[1] * scale.len,
      exitLeftX: exit[0] * scale.len, exitRightX: exit[1] * scale.len,
    };
  } else if (stab && /fully/i.test(stab.slipOption ?? "") && stab.fullySpecified.length > 0) {
    // the file's own surfaces, analysed alone (below)
  } else if (stab?.block && /block/i.test(stab.slipOption ?? "")) {
    // The two grids as windows of the block search, their end angles (°
    // counter-clockwise from +x) as the inclinations of the end segments:
    // the upslope end rises backwards (180° − angle when sliding to the
    // right), the downslope end forwards (the angle).
    const rtl = orientation === "rtl";
    const window = (g: GszBlockGrid) => {
      const ur: Pt = [g.ul[0] + g.lr[0] - g.ll[0], g.ul[1] + g.lr[1] - g.ll[1]];
      return { points: [g.ul, g.ll, g.lr, ur].map(L) };
    };
    const incl = (a: number, upslope: boolean) => (upslope !== rtl ? 180 - a : a);
    const range = (g: GszBlockGrid, upslope: boolean): [number, number] => {
      const [p, q] = g.angles.map((a) => incl(a, upslope));
      return [Math.min(p, q), Math.max(p, q)];
    };
    const [up, down] = rtl ? [stab.block.right, stab.block.left] : [stab.block.left, stab.block.right];
    blockSearchObjects = [window(stab.block.left), window(stab.block.right)];
    options.searchMethod = "block";
    // cSlope's block search takes end inclinations between 0° and 90°;
    // others (an exit segment dipping down) leave the Rankine angles
    const valid = (r: [number, number]) => r[0] > 0 && r[1] < 90;
    for (const [key, r, end] of [
      ["blockActiveAngle", range(up, true), "upslope"],
      ["blockPassiveAngle", range(down, false), "downslope"],
    ] as const) {
      if (valid(r)) options[key] = r;
      else notes.push(`The ${end} end angles of the block search (${r[0]}° to ${r[1]}° from the horizontal) are outside 0–90°; the Rankine angle is used.`);
    }
    if (stab.optimised) options.nonCircularOptimization = true;
    notes.push("The block search grids are imported as block search windows, with their end angles.");
  } else if (slipFrom.note) {
    notes.push(slipFrom.note);
  } else if (stab?.slipOption) {
    const from = slipFrom.from ? `, taken from analysis "${slipFrom.from.name}"` : "";
    notes.push(`The file's slip surface search ("${stab.slipOption}"${from}) is not imported; cSlope's own search over the whole slope is used.`);
  }
  if (slipFrom.from && /entry|fully|block/i.test(stab?.slipOption ?? "")) {
    notes.push(`The slip surface search is taken from analysis "${slipFrom.from.name}", as the file specifies.`);
  }
  // Fully specified surfaces: the polylines with their moment axis, and
  // only they are analysed, as in the file.
  const fully = stab && /fully/i.test(stab.slipOption ?? "") ? stab.fullySpecified : [];
  const customSurfaces = fully.map((pts) => ({
    points: pts.map(L).sort((a, b) => a[0] - b[0]),
    ...(stab?.axis ? { axis: L(stab.axis) } : {}),
  }));
  if (customSurfaces.length > 0) {
    notes.push(`The file's ${customSurfaces.length === 1 ? "fully specified slip surface is" : `${customSurfaces.length} fully specified slip surfaces are`} imported as custom surfaces and analyzed alone.`);
    if (stab?.optimised) notes.push("The optimization of the specified surface is not carried over; turn on the non-circular optimization in the options to refine it.");
  }
  if (stab?.tensionCrack) {
    const tc = stab.tensionCrack;
    if (tc.line.length >= 2) {
      const depths = tc.line.map(L).map(([x, y]) => (groundAt(geo.outline, x) ?? y) - y).filter((d) => d > 0);
      if (depths.length > 0) {
        options.tensionCrackDepth = Number((depths.reduce((s, d) => s + d, 0) / depths.length).toFixed(3));
        notes.push(`The tension crack line is imported as a crack depth of ${options.tensionCrackDepth} m.`);
      }
    } else if (/angle/i.test(tc.option) && tc.angle !== undefined) {
      // The file's angle is counter-clockwise from +x: for sliding to the
      // right the base inclination is 180° − angle (120° means 60°), to
      // the left the angle itself.
      const inclination = orientation === "rtl" ? tc.angle : 180 - tc.angle;
      if (inclination > 0 && inclination < 90) options.tensionCrackAngle = Number(inclination.toFixed(6));
      else notes.push(`The tension crack angle ${tc.angle}° (a base inclination of ${inclination}°) is not imported.`);
    } else notes.push(`The tension crack option "${tc.option}"${tc.angle !== undefined ? ` (${tc.angle}°)` : ""} is not imported.`);
    if (tc.waterFraction > 0 && (options.tensionCrackAngle || options.tensionCrackDepth)) options.tensionCrackWater = Math.min(1, tc.waterFraction);
  }
  // pseudostatic seismic coefficients (the file's kv positive downward, as cSlope's)
  if (stab && stab.seismicH !== 0) options.seismicHorizontal = Math.abs(stab.seismicH);
  if (stab && stab.seismicV !== 0) options.seismicVertical = stab.seismicV;

  const { reinforcements, piles } = reinforcementOf(file, stab, scale, imperial, notes);

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
  // A circle the file ends at a point where it would run on in the soil
  // (an exit given at the toe of a wall): cSlope would take it on to its
  // own exit, so its base as the slices give it is carried over instead,
  // a surface with the circle's centre as its axis.
  let truncatedReference: { points: Pt[]; axis: Pt } | undefined;
  if (reference && best?.base && best.base.length >= 3) {
    const base = best.base.map(L);
    const arcY = (x: number) => reference.cy - Math.sqrt(Math.max(0, reference.r ** 2 - (x - reference.cx) ** 2));
    const d = 1e-3 * reference.r;
    const inSoil = (x: number) => {
      const g = groundAt(geo.outline, x);
      return g !== null && Math.abs(x - reference.cx) < reference.r && arcY(x) < g - 1e-6 * reference.r;
    };
    // the circle runs on in the soil for 1 % of its radius beyond the end
    const runsOn = (x: number) => {
      const dir = x < base[0][0] + d ? -1 : 1;
      for (let k = 1; k <= 10; k++) if (!inSoil(x + dir * k * d)) return false;
      return true;
    };
    // (the entry end of a file with a tension crack is cut by the crack, which cSlope makes itself)
    const crackAtLeft = stab?.tensionCrack ? orientation !== "rtl" : null;
    const leftCut = crackAtLeft !== true && runsOn(base[0][0]);
    const rightCut = crackAtLeft !== false && runsOn(base[base.length - 1][0]);
    if (leftCut || rightCut) {
      // An end below the ground (a tension crack) rises to it, nearly
      // vertically, so that cSlope's crack forms there again.
      const pts = base.slice();
      const rise = (p: Pt, dir: number): Pt | null => {
        const g = groundAt(geo.outline, p[0]);
        return g !== null && g - p[1] > 1e-3 * reference.r ? [p[0] + dir * 1e-4 * reference.r, g] : null;
      };
      const first = rise(pts[0], -1), last = rise(pts[pts.length - 1], 1);
      if (first) pts.unshift(first);
      if (last) pts.push(last);
      truncatedReference = { points: pts, axis: [reference.cx, reference.cy] };
      notes.push(`The file's critical circle ends where it would run on in the soil (F = ${best.fos.toFixed(3)}); it is carried over as a surface along its slices, with the circle's center as the axis.`);
    }
  }

  const definition: SlopeDefinition = {
    ...(orientation ? { orientation } : {}),
    coordinates: geo.outline,
    materials,
    materialBoundaries: geo.boundaries.map((c) => ({ coordinates: c, materialName: "" })),
    regionAssignments,
    ...(waterTable ? { waterTable } : {}),
    ...(rapidDrawdown ? { rapidDrawdown } : {}),
    ...(waterTables.length > 0 ? { waterTables } : {}),
    udls,
    lineLoads,
    ...(reinforcements.length > 0 ? { reinforcements } : {}),
    ...(piles.length > 0 ? { piles } : {}),
    ...(analysisLimits ? { analysisLimits } : {}),
    ...(reference && !truncatedReference ? { customSearchPlanes: [{ cx: reference.cx, cy: reference.cy, radius: reference.r }] } : {}),
    ...(customSurfaces.length > 0
      ? { customSurfaces, customPlanesOnly: true }
      : truncatedReference
        ? { customSurfaces: [truncatedReference] }
        : {}),
    ...(blockSearchObjects ? { blockSearchObjects } : {}),
  };
  const base = fileName.replace(/\.gsz$/i, "");
  return { name: stabilityAnalyses(file).length > 1 ? `${analysis.name} (${base})` : base, definition, options, notes, reference };
}
