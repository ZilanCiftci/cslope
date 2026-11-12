/**
 * Reading .gsz project files: a ZIP archive with the model as one XML
 * document (root <GSIData>) and, when the file was saved after solving,
 * the solved slip surfaces as CSV in a folder per analysis.
 *
 * This module only reads what the file says, without interpreting it for
 * cSlope; `gsz-to-definition.ts` does that. Coordinates and values are as
 * written (units in `units`).
 */

import { isZip, readZip } from "../../../utils/zip";
import { WATER_UNIT_WEIGHT } from "@cslope/engine";

type Pt = [number, number];

export interface GszAnalysis {
  id: number;
  name: string;
  /** The program part, e.g. the stability or the seepage analysis. */
  kind: string;
  method: string;
  parentId?: number;
  geometryId: number;
}

export interface GszGeometry {
  points: Map<number, Pt>;
  /** Region id → its corner point ids, in order. */
  regions: Map<number, number[]>;
}

export interface GszMaterial {
  id: number;
  name: string;
  /** The strength model name, e.g. MohrCoulomb, UndrainedPhiZero, Bedrock. */
  model: string;
  color?: [number, number, number];
  /** The <StressStrain> fields that have a value, as text. */
  fields: Record<string, string>;
}

export interface GszSurcharge {
  /** The unit weight of the fill between the line and the ground. */
  unitWeight: number;
  /** The top line of the fill. */
  line: Pt[];
  direction: string;
}

export interface GszLineLoad {
  x: number;
  y: number;
  value: number;
  /** Angle below the horizontal (90: vertical). */
  plunge: number;
  /** Compass direction of the horizontal part (°; 90: +x, 270: −x). */
  trend: number;
}

export interface GszStability {
  direction?: string;
  slipOption?: string;
  /**
   * Where the analysis takes its initial input from (InitialInputInfo):
   * the option (Parent, Other, …) and the analysis named in its path, as
   * written. A slip surface search "FromOther" takes its slip surfaces
   * from that analysis.
   */
  inputFrom?: { option?: string; name?: string };
  /** Entry/exit ranges [x1, x2] on the left and the right side. */
  entryExit?: { left: [number, number]; right: [number, number] };
  slices?: number;
  /** The critical surface is optimised after the search (then no longer a circle). */
  optimised: boolean;
  /** The ends of the surface are projected at a fixed angle (then not a circle). */
  projected: boolean;
  /** Fully specified slip surfaces (polylines) and their moment axis. */
  fullySpecified: Pt[][];
  /**
   * Block search: each grid as its corners (upper left, lower left, lower
   * right) and the range of the end segment's angle (°, counter-clockwise
   * from +x).
   */
  block?: { left: GszBlockGrid; right: GszBlockGrid };
  /**
   * The smallest sliding mass a slip surface may have (MinimumVolume): an
   * area per unit width, in the file's length unit squared.
   */
  minimumVolume?: number;
  /** The smallest depth a slip surface may have (MinimumDepth), in the file's length unit. */
  minimumDepth?: number;
  axis?: Pt;
  /** Piezometric surface id → its points. */
  piezometric: Map<number, Pt[]>;
  /** Material id → piezometric surface id. */
  materialPiezometric: Map<number, number>;
  /**
   * Piezometric surface id → the largest suction (as written) above it,
   * for the surfaces whose suction is capped (CapSuction).
   */
  piezometricMaxSuction: Map<number, number>;
  surcharges: GszSurcharge[];
  lineLoads: GszLineLoad[];
  /**
   * waterFraction: PctFilledWithWater, which despite its name is the
   * fraction filled (1 = full, as the format's tension crack example
   * states).
   */
  tensionCrack?: { option: string; angle?: number; line: Pt[]; waterFraction: number };
  seismicH: number;
  seismicV: number;
  /** A rapid drawdown analysis (Control/IsRapidDrawdown). */
  rapidDrawdown?: boolean;
  /** The phreatic correction of the pore pressure (Control/IsPiezPhreatic). */
  phreaticCorrection?: boolean;
  /** The reinforcement lines: the reinforcement's id, end 1 (the head) and end 2. */
  reinforcementLines?: { reinforcement: number; p1: Pt; p2: Pt }[];
  /**
   * B-bar per material id: the function giving B̄ (its id; a constant
   * when written as a value), and whether the material's weight is the
   * load that raises the pore pressure (IsIncluded).
   */
  bBar?: Map<number, { fn?: number; value?: number; included: boolean }>;
}

/**
 * A reinforcement definition as written (per element; the reduction
 * factors of older files already applied). Absent values are absent in
 * the file.
 */
export interface GszReinforcement {
  name: string;
  /** Anchor (when not written), Nail, Geosynthetic, Pile or UserDefined. */
  type: string;
  /** The force is divided by the factor of safety ("F of S dependent"). */
  fosDependent: boolean;
  spacing?: number;
  /** Bonded length at the embedded end (anchors). */
  bondLength?: number;
  bondDiameter?: number;
  tensile?: number;
  plate?: number;
  /** Bond skin friction (anchors, nails: stress; geosynthetics: force per length and width). */
  pullout?: number;
  /** Geosynthetics: the pullout resistance from the overburden stress. */
  calculatedPullout: boolean;
  interfaceAngle?: number;
  adhesion?: number;
  surfaceAreaFactor?: number;
  /** Shear force per element (piles; anchors and nails with shear). */
  shear?: number;
  /** 0: along the reinforcement, 1: along the slip surface. */
  orientation?: number;
  /** "Concentrated" or "Distributed" (when not written). */
  distribution?: string;
}

/** A function of a material property given as points (see GszFile.materialFunctions). */
export interface GszFunction {
  output: string;
  input: string;
  points: [number, number][];
  spline?: { startSlope?: number; endSlope?: number };
}

export interface GszSlipResult {
  fos: number;
  cx: number;
  cy: number;
  r: number;
  /** Generated as a circle (not a block or an optimised surface). */
  circular: boolean;
  /** Weight of the sliding mass. */
  weight?: number;
  /** The slip surface's number (its slices are in column_<num>.csv). */
  num?: number;
  /** The critical surface's base as its slices give it (the ends of the slice bases), from left to right. */
  base?: Pt[];
  /** +1 when the mass moves to the right, −1 to the left (from the mobilised shear direction). */
  direction?: 1 | -1;
}

export interface GszFile {
  units: "metric" | "imperial";
  analyses: GszAnalysis[];
  /** By 1-based position, as analyses refer to them. */
  geometries: Map<number, GszGeometry>;
  materials: Map<number, GszMaterial>;
  /** Reinforcement definitions by id. */
  reinforcements?: Map<number, GszReinforcement>;
  /** Analysis id → region id → material id. */
  regionMaterials: Map<number, Map<number, number>>;
  stability: Map<number, GszStability>;
  /** Analysis id → the unit weight of water and the pore pressure option. */
  water: Map<number, { gammaWater?: number; option: string }>;
  /**
   * Anisotropy functions by id: [inclination °, modifier factor] points
   * (the file interpolates them with a spline).
   */
  anisotropyFunctions?: Map<number, [number, number][]>;
  /**
   * Material functions by id (Fn2D): what they give (OutputParam, e.g.
   * OverconsolidationRatio, UndrainedShearStrength) from what (InputParam,
   * e.g. Y, YEffectiveStress), and their points, sorted by x; `spline`
   * when the function is a spline, with its end slopes (absent: computed,
   * a natural spline).
   */
  materialFunctions?: Map<number, GszFunction>;
  /** Shear strength against normal stress functions by id (StrengthFn), as `materialFunctions`. */
  strengthFunctions?: Map<number, GszFunction>;
  /** Cohesion functions by id (CohesionFn), as `materialFunctions`. */
  cohesionFunctions?: Map<number, GszFunction>;
  /** Analysis name (lower case) → the solved slip surfaces in the file. */
  results: Map<string, GszSlipResult[]>;
}

/** The child elements, by walking the siblings (an element's `children` list can be slow to index for long lists). */
const elements = (el: Element): Element[] => {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) out.push(c);
  return out;
};
const childText = (el: Element | null | undefined, tag: string): string | undefined => {
  if (!el) return undefined;
  for (const c of elements(el)) {
    if (c.tagName === tag) {
      if (c.getAttribute("Missing") === "true") return undefined;
      const t = c.textContent?.trim();
      return t ? t : undefined;
    }
  }
  return undefined;
};
const child = (el: Element | null | undefined, tag: string): Element | null =>
  el ? (elements(el).find((c) => c.tagName === tag) ?? null) : null;
const children = (el: Element | null | undefined, path: string): Element[] => {
  let level: Element[] = el ? [el] : [];
  for (const tag of path.split("/")) level = level.flatMap((e) => elements(e).filter((c) => c.tagName === tag));
  return level;
};
const num = (s: string | null | undefined): number | undefined => {
  if (s == null || s.trim() === "") return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

function parseColor(s: string | undefined): [number, number, number] | undefined {
  const m = s?.match(/RGB=\((\d+),(\d+),(\d+)\)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** A block search grid: three corners of the parallelogram and the end angles. */
export interface GszBlockGrid {
  ul: Pt;
  ll: Pt;
  lr: Pt;
  angles: [number, number];
}

/**
 * Keep a point of an analysis's point list (DataPoints, by Number). A
 * number the list has already given is a repeat, which some files have:
 * that point takes its position in the list (1-based) as its number, as
 * the search objects' references to it do, so no point is lost. A list
 * without repeats is read by its numbers alone.
 */
function setPoint(points: Map<number, Pt>, n: number, index: number, p: Pt) {
  const key = points.has(n) ? index + 1 : n;
  if (!points.has(key)) points.set(key, p);
}

/** Parse the model XML of a .gsz. */
export function parseGszXml(xml: string): Omit<GszFile, "results"> {
  // A model never has a document type declaration; one can only carry
  // entity tricks (a "billion laughs", an external entity), so it is
  // refused before anything is parsed.
  if (/<!DOCTYPE/i.test(xml)) throw new Error("The model XML has a DOCTYPE declaration, which a .gsz file never has; the file was not read.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || root.tagName !== "GSIData" || doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The file has no readable model (expected a <GSIData> XML document).");
  }

  const analyses: GszAnalysis[] = [];
  for (const a of children(root, "Analyses/Analysis")) {
    const id = num(childText(a, "ID"));
    if (id === undefined) continue;
    analyses.push({
      id,
      name: childText(a, "Name") ?? `Analysis ${id}`,
      kind: childText(a, "Kind") ?? "",
      method: childText(a, "Method") ?? "",
      parentId: num(childText(a, "ParentID")),
      geometryId: num(childText(a, "GeometryId")) ?? 1,
    });
  }

  const geometries = new Map<number, GszGeometry>();
  // Version 8 files (2012) have one geometry, as GeometryItems.
  const geometryElements = children(root, "Geometries/Geometry");
  if (geometryElements.length === 0) geometryElements.push(...children(root, "GeometryItems"));
  geometryElements.forEach((g, i) => {
    const points = new Map<number, Pt>();
    for (const p of children(g, "Points/Point")) {
      const id = num(p.getAttribute("ID")), x = num(p.getAttribute("X")), y = num(p.getAttribute("Y"));
      // a deleted point keeps its id without coordinates
      if (id !== undefined && x !== undefined && y !== undefined) points.set(id, [x, y]);
    }
    const regions = new Map<number, number[]>();
    for (const r of children(g, "Regions/Region")) {
      const id = num(childText(r, "ID"));
      const ids = childText(r, "PointIDs");
      if (id !== undefined && ids) regions.set(id, ids.split(",").map((s) => Number(s.trim())));
    }
    geometries.set(i + 1, { points, regions });
  });

  const materials = new Map<number, GszMaterial>();
  for (const m of children(root, "Materials/Material")) {
    const id = num(childText(m, "ID"));
    if (id === undefined) continue;
    const fields: Record<string, string> = {};
    for (const f of Array.from(child(m, "StressStrain")?.children ?? [])) {
      const t = f.textContent?.trim();
      if (f.getAttribute("Missing") !== "true" && t) fields[f.tagName] = t;
    }
    materials.set(id, {
      id,
      name: childText(m, "Name") ?? `Material ${id}`,
      model: childText(m, "SlopeModel") ?? "",
      color: parseColor(childText(m, "Color")),
      fields,
    });
  }

  // region → material is given per analysis
  const regionMaterials = new Map<number, Map<number, number>>();
  for (const c of children(root, "Contexts/Context")) {
    const aid = num(childText(c, "AnalysisID"));
    if (aid === undefined) continue;
    const map = new Map<number, number>();
    for (const g of children(c, "GeometryUsesMaterials/GeometryUsesMaterial")) {
      const m = (g.getAttribute("ID") ?? "").match(/^Regions-(\d+)$/);
      const entry = num(g.getAttribute("Entry"));
      if (m && entry !== undefined) map.set(Number(m[1]), entry);
    }
    // version 8: region id → material id
    for (const g of children(c, "RegionUsesMaterials/RegionUsesMaterial")) {
      const id = num(g.getAttribute("ID")), uses = num(g.getAttribute("UsesID"));
      if (id !== undefined && uses !== undefined) map.set(id, uses);
    }
    regionMaterials.set(aid, map);
  }

  const water = new Map<number, { gammaWater?: number; option: string }>();
  for (const w of children(root, "WaterItems/WaterItem")) {
    const aid = num(childText(w, "AnalysisID"));
    const entry = child(w, "Entry");
    if (aid === undefined) continue;
    water.set(aid, {
      gammaWater: num(childText(entry, "UnitWaterWeight")),
      option: childText(child(entry, "ResultInputInfo"), "Option") ?? "None",
    });
  }

  const stability = new Map<number, GszStability>();
  // The geometry's points, which version 8 files refer to from the
  // stability items (later versions give each analysis its own list).
  const globalPoints = geometries.get(1)?.points ?? new Map<number, Pt>();
  const items = [...children(root, "StabilityItems/StabilityItem"), ...children(root, "SlopeItems/SlopeItem")];
  for (const s of items) {
    const aid = num(childText(s, "AnalysisID"));
    const entry = child(s, "Entry");
    if (aid === undefined || !entry) continue;
    // the analysis's own point list, which the water, loads and crack refer to
    const local = new Map<number, Pt>();
    children(entry, "DataPoints/DataPoint").forEach((d, i) => {
      const n = num(d.getAttribute("Number")), x = num(d.getAttribute("X")), y = num(d.getAttribute("Y"));
      if (n !== undefined && x !== undefined && y !== undefined) setPoint(local, n, i, [x, y]);
    });
    const pointsOf = (el: Element | null): Pt[] =>
      children(el, "DataPoints/DataPoint").flatMap((d) => {
        const n = Number(d.textContent?.trim());
        const p = local.size > 0 ? local.get(n) : globalPoints.get(n);
        return p ? [p] : [];
      });
    const piezometric = new Map<number, Pt[]>();
    const piezometricMaxSuction = new Map<number, number>();
    for (const ps of [...children(entry, "PiezometricSurfaces/PiezometricSurface"), ...children(entry, "PiezometricLines/PiezometricLine")]) {
      const id = num(childText(ps, "ID"));
      if (id === undefined) continue;
      piezometric.set(id, pointsOf(ps));
      const cap = num(childText(ps, "MaxSuction"));
      if (childText(ps, "CapSuction") === "true" && cap !== undefined) piezometricMaxSuction.set(id, cap);
    }
    const materialPiezometric = new Map<number, number>();
    for (const mu of children(entry, "MaterialUsesPiezs/MaterialUsesPiez")) {
      const id = num(mu.getAttribute("ID")), uses = num(mu.getAttribute("UsesID"));
      if (id !== undefined && uses !== undefined) materialPiezometric.set(id, uses);
    }
    const surcharges = children(entry, "Surcharges/Surcharge").flatMap((sc) => {
      const line = pointsOf(sc);
      const w = num(childText(sc, "Pressure"));
      return line.length >= 2 && w !== undefined ? [{ unitWeight: w, line, direction: childText(sc, "Direction") ?? "Vertical" }] : [];
    });
    const lineLoads = children(entry, "LineLoadPoints/LineLoadPoint").flatMap((lp) => {
      const p = local.get(num(childText(lp, "ID")) ?? -1);
      const ll = child(lp, "LineLoad");
      const value = num(childText(ll, "Value"));
      if (!p || value === undefined) return [];
      const plunge = num(child(ll, "Direction")?.getAttribute("Plunge")) ?? 90;
      const trend = num(child(ll, "Direction")?.getAttribute("Trend")) ?? 0;
      return [{ x: p[0], y: p[1], value, plunge, trend }];
    });
    const tc = child(entry, "TensionCrack");
    const tcOption = childText(tc, "TensionOption");
    const slip = child(entry, "SlipSurface");
    // version 8: SlipEntryExit directly in the entry
    const ee = child(slip, "EntryExit") ?? child(entry, "SlipEntryExit");
    const xOf = (tag: string) => num(child(ee, tag)?.getAttribute("X"));
    const [l1, l2Given, r1, r2Given] = ["LeftSideLeftPt", "LeftSideRightPt", "RightSideLeftPt", "RightSideRightPt"].map(xOf);
    // An entry or exit given as a single point (LeftOption / RightOption
    // "Point") has only its first point, also when the file still carries a
    // second one for that side.
    const l2 = /point/i.test(childText(ee, "LeftOption") ?? "") ? l1 : l2Given;
    const r2 = /point/i.test(childText(ee, "RightOption") ?? "") ? r1 : r2Given;
    const seis = child(entry, "Seismic");
    const input = child(entry, "InitialInputInfo");
    // the path names the analysis in quotes: ;;"name";(last)
    const inputName = input ? child(input, "Path")?.getAttribute("path")?.match(/"(.*)"/)?.[1] : undefined;
    stability.set(aid, {
      direction: childText(slip, "DirectionOfSlip"),
      ...(input ? { inputFrom: { option: childText(input, "Option"), name: inputName } } : {}),
      // The default search (Entry and Exit) is not written.
      slipOption: childText(slip, "Option") ?? (ee ? "EntryExit" : undefined),
      entryExit:
        l1 !== undefined && l2 !== undefined && r1 !== undefined && r2 !== undefined
          ? { left: [Math.min(l1, l2), Math.max(l1, l2)], right: [Math.min(r1, r2), Math.max(r1, r2)] }
          : undefined,
      slices: num(childText(slip, "NumberOfSlicesPerSlip")),
      optimised: childText(slip, "IsOptimizationOn") === "true",
      projected: ["UseLeftAngle", "UseRightAngle"].some((k) => child(slip, "Radius")?.getAttribute(k) === "true"),
      block: (() => {
        const grid = (tag: string): GszBlockGrid | undefined => {
          const g = child(child(slip, "Block"), tag);
          const at = (k: string) => {
            const id = num(g?.getAttribute(k));
            return id === undefined ? undefined : local.get(id);
          };
          const [ul, ll, lr] = [at("PointUL"), at("PointLL"), at("PointLR")];
          // one angle given: a fixed angle
          const a1 = num(g?.getAttribute("Angle1")) ?? num(g?.getAttribute("Angle2"));
          const a2 = num(g?.getAttribute("Angle2")) ?? a1;
          return ul && ll && lr && a1 !== undefined && a2 !== undefined ? { ul, ll, lr, angles: [a1, a2] } : undefined;
        };
        const left = grid("LeftGrid"), right = grid("RightGrid");
        return left && right ? { left, right } : undefined;
      })(),
      minimumVolume: num(childText(slip, "MinimumVolume")),
      minimumDepth: num(childText(slip, "MinimumDepth")),
      fullySpecified: [
        ...children(slip, "FullySpecifiedSlips/FullySpecifiedSlip"),
        // version 8
        ...children(entry, "FullySpecifiedSlipSurfaces/FullySpecifiedSlipSurface"),
      ].map(pointsOf).filter((l) => l.length >= 2),
      axis: (() => {
        const id = num(child(slip, "Axis")?.getAttribute("ID")) ?? num(childText(child(entry, "SlipSurfaceAxis"), "ID"));
        return id === undefined ? undefined : (local.size > 0 ? local.get(id) : globalPoints.get(id));
      })(),
      piezometric,
      materialPiezometric,
      piezometricMaxSuction,
      surcharges,
      lineLoads,
      tensionCrack: tcOption
        ? { option: tcOption, angle: num(childText(tc, "Angle")), line: pointsOf(tc), waterFraction: num(childText(tc, "PctFilledWithWater")) ?? 0 }
        : undefined,
      seismicH: num(seis?.getAttribute("Horizontal")) ?? 0,
      seismicV: num(seis?.getAttribute("Vertical")) ?? 0,
      rapidDrawdown: childText(child(entry, "Control"), "IsRapidDrawdown") === "true",
      phreaticCorrection: childText(child(entry, "Control"), "IsPiezPhreatic") === "true",
      bBar: new Map(
        children(entry, "MaterialUsesBBarParams/MaterialUsesBBarParam").flatMap((b) => {
          const id = num(childText(b, "ID"));
          const e = child(b, "Entry");
          if (id === undefined || !e) return [];
          const fn = num(e.getAttribute("Function")), value = num(e.getAttribute("BBar") ?? e.getAttribute("Value"));
          return [[id, { ...(fn !== undefined ? { fn } : {}), ...(value !== undefined ? { value } : {}), included: e.getAttribute("IsIncluded") === "true" }] as const];
        }),
      ),
      reinforcementLines: children(entry, "ReinforcementLines/ReinforcementLine").flatMap((rl) => {
        const at = (k: string) => {
          const id = num(rl.getAttribute(k));
          return id === undefined ? undefined : local.size > 0 ? local.get(id) : globalPoints.get(id);
        };
        const reinforcement = num(rl.getAttribute("Reinforcement"));
        const p1 = at("Point1Id"), p2 = at("Point2Id");
        return reinforcement !== undefined && p1 && p2 ? [{ reinforcement, p1, p2 }] : [];
      }),
    });
  }

  const system = root.getElementsByTagName("EngCoords")[0]?.getAttribute("UnitSystem")?.toLowerCase();
  let units: "metric" | "imperial";
  if (system === "metric" || system === "imperial") units = system;
  else {
    // no stated system: from the unit weight of water, the one fixed value
    const gw = [...water.values()].find((w) => w.gammaWater !== undefined)?.gammaWater;
    if (gw !== undefined && Math.abs(gw - 62.4) < 1) units = "imperial";
    else if (gw === undefined || Math.abs(gw - WATER_UNIT_WEIGHT) < 0.2) units = "metric";
    else throw new Error(`Cannot tell the units of the file (unit weight of water ${gw}).`);
  }

  // Version 8 has no water items: the piezometric lines of an analysis
  // are its pore pressure, and a pore pressure function (PHFunc3DID) is
  // named so that it is reported as not imported.
  for (const s of children(root, "SlopeItems/SlopeItem")) {
    const aid = num(childText(s, "AnalysisID"));
    if (aid === undefined || water.has(aid)) continue;
    const entry = child(s, "Entry");
    if (childText(entry, "PHFunc3DID") !== undefined) water.set(aid, { option: "Spatial function" });
    else if ((stability.get(aid)?.piezometric.size ?? 0) > 0) water.set(aid, { option: "PiezoSurface" });
  }

  const anisotropyFunctions = new Map<number, [number, number][]>();
  for (const fn of children(root, "Functions/Material/StressStrain/AnisoFns/AnisoFn")) {
    const id = num(childText(fn, "ID"));
    const pts = children(fn, "Points/Point").flatMap((p) => {
      const x = num(p.getAttribute("X")), y = num(p.getAttribute("Y"));
      return x !== undefined && y !== undefined ? [[x, y] as [number, number]] : [];
    });
    if (id !== undefined && pts.length > 0) anisotropyFunctions.set(id, pts.sort((a, b) => a[0] - b[0]));
  }

  const materialFunctions = new Map<number, GszFunction>();
  const cohesionFunctions = new Map<number, GszFunction>();
  const strengthFunctions = new Map<number, GszFunction>();
  for (const [fn, into] of [
    ...children(root, "Functions/Material/Fn2Ds/Fn2D").map((e) => [e, materialFunctions] as const),
    ...children(root, "Functions/Material/StressStrain/CohesionFns/CohesionFn").map((e) => [e, cohesionFunctions] as const),
    ...children(root, "Functions/Material/StressStrain/StrengthFns/StrengthFn").map((e) => [e, strengthFunctions] as const),
  ]) {
    const id = num(childText(fn, "ID"));
    const def = childText(fn, "Function") ?? "";
    const pts = children(fn, "Points/Point").flatMap((p) => {
      const x = num(p.getAttribute("X")), y = num(p.getAttribute("Y"));
      return x !== undefined && y !== undefined ? [[x, y] as [number, number]] : [];
    });
    if (id === undefined || pts.length === 0) continue;
    const slope = (k: string) => num(def.match(new RegExp(`${k}=([^,)]+)`))?.[1]);
    const startSlope = slope("SlopeBefore"), endSlope = slope("SlopeAfter");
    into.set(id, {
      output: def.match(/OutputParam=(\w+)/)?.[1] ?? "",
      input: def.match(/InputParam=(\w+)/)?.[1] ?? "",
      points: pts.sort((a, b) => a[0] - b[0]),
      ...(/^\s*Spline\(/.test(def)
        ? { spline: { ...(startSlope !== undefined ? { startSlope } : {}), ...(endSlope !== undefined ? { endSlope } : {}) } }
        : {}),
    });
  }

  const reinforcements = new Map<number, GszReinforcement>();
  for (const r of children(root, "Reinforcements/Reinforcement")) {
    const id = num(childText(r, "ID"));
    if (id === undefined) continue;
    const f = (tag: string) => num(childText(r, tag));
    // Older files give the capacities with reduction factors; later ones
    // the reduced values (the same model's newer copy divides by them).
    const by = (v: number | undefined, factor: number | undefined) => (v === undefined ? undefined : v / (factor && factor > 0 ? factor : 1));
    const rfT = f("ReinforcementForceReductionFactor"), rfP = f("PulloutReductionFactor"), rfS = f("ShearReductionFactor");
    reinforcements.set(id, {
      name: childText(r, "Name") ?? `Reinforcement ${id}`,
      type: childText(r, "Type") ?? "Anchor",
      fosDependent: childText(r, "FofSDependent") === "true",
      spacing: f("Spacing"),
      bondLength: f("BondLength"),
      bondDiameter: f("BondDiameter"),
      tensile: by(f("Tensile") ?? f("TensileCapacity"), rfT),
      plate: by(f("PlateCapacity"), rfT),
      pullout: by(f("PulloutResistance"), rfP),
      calculatedPullout: childText(r, "CalculatedPulloutResistance") === "true",
      interfaceAngle: f("InterfaceShearAngle"),
      adhesion: f("Adhesion"),
      surfaceAreaFactor: f("SurfaceAreaFactor"),
      shear: by(f("Shear") ?? f("ShearForce"), rfS),
      orientation: f("ForceOrientation"),
      distribution: childText(r, "ForceDistribution"),
    });
  }

  return { units, analyses, geometries, materials, reinforcements, regionMaterials, stability, water, anisotropyFunctions, materialFunctions, cohesionFunctions, strengthFunctions };
}

/** The solved slip surfaces of one analysis's slip_surface.csv. */
export function parseSlipSurfaceCsv(text: string): GszSlipResult[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const [iF, iX, iY, iR, iM, iW, iD, iN] = ["SlipFOS", "SlipCenterX", "SlipCenterY", "SlipRadiusX", "SlipOrigSearchMethod", "SlipWeight", "MobilizedShearDirection", "SlipNum"].map(col);
  // version 8: SlipRadius
  const iRadius = iR >= 0 ? iR : col("SlipRadius");
  if (iF < 0 || iX < 0 || iY < 0 || iRadius < 0) return [];
  const out: GszSlipResult[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const fos = Number(c[iF]), cx = Number(c[iX]), cy = Number(c[iY]), r = Number(c[iRadius]);
    // failed trials carry a sentinel factor
    if (!(fos > 0 && fos < 100) || !Number.isFinite(cx) || !Number.isFinite(cy) || !(r > 0)) continue;
    // search method 4 is the block search, whose surfaces are not circles
    const method = iM >= 0 ? (c[iM] ?? "").trim() : "";
    const weight = iW >= 0 ? Number(c[iW]) : NaN;
    const dir = iD >= 0 ? Number(c[iD]) : NaN;
    const n = iN >= 0 ? Number(c[iN]) : NaN;
    out.push({
      fos, cx, cy, r,
      circular: method !== "4" && !/block|fully|optimi/i.test(method),
      ...(Number.isFinite(weight) ? { weight } : {}),
      ...(Number.isInteger(n) ? { num: n } : {}),
      ...(Number.isFinite(dir) && dir !== 0 ? { direction: dir < 0 ? 1 : -1 } : {}),
    });
  }
  return out;
}

/**
 * The centre of a circle of the given radius through the two ends of a
 * slip surface's base (the first and last slice of a column_<n>.csv),
 * above the base; null when they are missing or further apart than 2r.
 */
export function circleFromColumns(text: string, r: number): Pt | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 3) return null;
  const head = lines[0].split(",").map((h) => h.trim());
  const [iXl, iXr, iYl, iYr] = ["XLeft", "XRight", "YBackBotLeft", "YBackBotRight"].map((k) => head.indexOf(k));
  if ([iXl, iXr, iYl, iYr].some((i) => i < 0)) return null;
  const first = lines[1].split(",").map(Number), last = lines[lines.length - 1].split(",").map(Number);
  const a: Pt = [first[iXl], first[iYl]], b: Pt = [last[iXr], last[iYr]];
  if (![...a, ...b].every(Number.isFinite)) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
  if (!(d > 0) || d > 2 * r) return null;
  const h = Math.sqrt(r * r - (d / 2) ** 2);
  // the normal to the chord pointing up (the centre is above the base)
  let nx = -dy / d, ny = dx / d;
  if (ny < 0) [nx, ny] = [-nx, -ny];
  return [(a[0] + b[0]) / 2 + nx * h, (a[1] + b[1]) / 2 + ny * h];
}

/** The base of a slip surface from its column_<n>.csv: the ends of the slice bases, left to right. */
export function basePolylineFromColumns(text: string): Pt[] | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const head = lines[0].split(",").map((h) => h.trim());
  const [iXl, iXr, iYl, iYr] = ["XLeft", "XRight", "YBackBotLeft", "YBackBotRight"].map((k) => head.indexOf(k));
  if ([iXl, iXr, iYl, iYr].some((i) => i < 0)) return null;
  // both ends of every slice (the columns run in the direction of sliding)
  const rows = lines.slice(1).map((l) => l.split(",").map(Number));
  const ends = rows.flatMap((r): Pt[] => [[r[iXl], r[iYl]], [r[iXr], r[iYr]]]);
  if (!ends.every((p) => p.every(Number.isFinite))) return null;
  ends.sort((a, b) => a[0] - b[0]);
  const tol = 1e-9 * Math.max(1, Math.abs(ends[ends.length - 1][0] - ends[0][0]));
  return ends.filter((p, i) => i === 0 || Math.abs(p[0] - ends[i - 1][0]) > tol || Math.abs(p[1] - ends[i - 1][1]) > tol);
}

/** Read a .gsz file. */
export async function readGsz(bytes: Uint8Array): Promise<GszFile> {
  if (!isZip(bytes)) throw new Error("Not a .gsz project file (expected a ZIP archive).");
  const entries = await readZip(bytes);
  // the model is the one XML at the top of the archive; the copies in the
  // analysis folders are snapshots saved with the results
  const xmlName = [...entries.keys()].find((n) => !n.includes("/") && n.toLowerCase().endsWith(".xml"));
  if (!xmlName) throw new Error("The .gsz file contains no model XML.");
  const file = parseGszXml(new TextDecoder().decode(entries.get(xmlName)));
  const results = new Map<string, GszSlipResult[]>();
  for (const a of file.analyses) {
    // a "/" in the analysis name is "&3" in its folder name
    const prefix = `${a.name.replace(/\//g, "&3").toLowerCase()}/`;
    const csv = [...entries.keys()].sort().find((n) => n.toLowerCase().startsWith(prefix) && n.endsWith("slip_surface.csv"));
    if (!csv) continue;
    const slips = parseSlipSurfaceCsv(new TextDecoder().decode(entries.get(csv)));
    // With a given moment axis the file reports the axis as the centre:
    // the circle's centre from the ends of the critical surface's slices
    // (column_<n>.csv) and its radius.
    const best = slips.reduce<GszSlipResult | undefined>((m, r) => (!m || r.fos < m.fos ? r : m), undefined);
    const columns = best?.num !== undefined ? entries.get(csv.replace(/slip_surface\.csv$/, `column_${best.num}.csv`)) : undefined;
    if (best && columns) {
      const text = new TextDecoder().decode(columns);
      const base = basePolylineFromColumns(text);
      if (base) best.base = base;
      const c = best.circular ? circleFromColumns(text, best.r) : null;
      if (c && Math.hypot(c[0] - best.cx, c[1] - best.cy) > 1e-3 * best.r) [best.cx, best.cy] = c;
    }
    results.set(a.name.toLowerCase(), slips);
  }
  return { ...file, results };
}
