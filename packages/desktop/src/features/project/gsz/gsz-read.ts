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
}

export interface GszStability {
  direction?: string;
  slipOption?: string;
  /** Entry/exit ranges [x1, x2] on the left and the right side. */
  entryExit?: { left: [number, number]; right: [number, number] };
  slices?: number;
  /** The critical surface is optimised after the search (then no longer a circle). */
  optimised: boolean;
  /** Piezometric surface id → its points. */
  piezometric: Map<number, Pt[]>;
  /** Material id → piezometric surface id. */
  materialPiezometric: Map<number, number>;
  surcharges: GszSurcharge[];
  lineLoads: GszLineLoad[];
  tensionCrack?: { option: string; angle?: number; line: Pt[]; waterPercent: number };
  seismicH: number;
  seismicV: number;
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
  /** +1 when the mass moves to the right, −1 to the left (from the mobilised shear direction). */
  direction?: 1 | -1;
}

export interface GszFile {
  units: "metric" | "imperial";
  analyses: GszAnalysis[];
  /** By 1-based position, as analyses refer to them. */
  geometries: Map<number, GszGeometry>;
  materials: Map<number, GszMaterial>;
  /** Analysis id → region id → material id. */
  regionMaterials: Map<number, Map<number, number>>;
  stability: Map<number, GszStability>;
  /** Analysis id → the unit weight of water and the pore pressure option. */
  water: Map<number, { gammaWater?: number; option: string }>;
  /** Analysis name (lower case) → the solved slip surfaces in the file. */
  results: Map<string, GszSlipResult[]>;
}

const childText = (el: Element | null | undefined, tag: string): string | undefined => {
  if (!el) return undefined;
  for (const c of Array.from(el.children)) {
    if (c.tagName === tag) {
      if (c.getAttribute("Missing") === "true") return undefined;
      const t = c.textContent?.trim();
      return t ? t : undefined;
    }
  }
  return undefined;
};
const child = (el: Element | null | undefined, tag: string): Element | null =>
  el ? (Array.from(el.children).find((c) => c.tagName === tag) ?? null) : null;
const children = (el: Element | null | undefined, path: string): Element[] => {
  let level: Element[] = el ? [el] : [];
  for (const tag of path.split("/")) level = level.flatMap((e) => Array.from(e.children).filter((c) => c.tagName === tag));
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

/** Parse the model XML of a .gsz. */
export function parseGszXml(xml: string): Omit<GszFile, "results"> {
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
  children(root, "Geometries/Geometry").forEach((g, i) => {
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
  for (const s of children(root, "StabilityItems/StabilityItem")) {
    const aid = num(childText(s, "AnalysisID"));
    const entry = child(s, "Entry");
    if (aid === undefined || !entry) continue;
    // the analysis's own point list, which the water, loads and crack refer to
    const local = new Map<number, Pt>();
    for (const d of children(entry, "DataPoints/DataPoint")) {
      const n = num(d.getAttribute("Number")), x = num(d.getAttribute("X")), y = num(d.getAttribute("Y"));
      if (n !== undefined && x !== undefined && y !== undefined) local.set(n, [x, y]);
    }
    const pointsOf = (el: Element | null): Pt[] =>
      children(el, "DataPoints/DataPoint").flatMap((d) => {
        const p = local.get(Number(d.textContent?.trim()));
        return p ? [p] : [];
      });
    const piezometric = new Map<number, Pt[]>();
    for (const ps of children(entry, "PiezometricSurfaces/PiezometricSurface")) {
      const id = num(childText(ps, "ID"));
      if (id !== undefined) piezometric.set(id, pointsOf(ps));
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
      return [{ x: p[0], y: p[1], value, plunge }];
    });
    const tc = child(entry, "TensionCrack");
    const tcOption = childText(tc, "TensionOption");
    const slip = child(entry, "SlipSurface");
    const ee = child(slip, "EntryExit");
    const xOf = (tag: string) => num(child(ee, tag)?.getAttribute("X"));
    const [l1, l2, r1, r2] = ["LeftSideLeftPt", "LeftSideRightPt", "RightSideLeftPt", "RightSideRightPt"].map(xOf);
    const seis = child(entry, "Seismic");
    stability.set(aid, {
      direction: childText(slip, "DirectionOfSlip"),
      slipOption: childText(slip, "Option"),
      entryExit:
        l1 !== undefined && l2 !== undefined && r1 !== undefined && r2 !== undefined
          ? { left: [Math.min(l1, l2), Math.max(l1, l2)], right: [Math.min(r1, r2), Math.max(r1, r2)] }
          : undefined,
      slices: num(childText(slip, "NumberOfSlicesPerSlip")),
      optimised: childText(slip, "IsOptimizationOn") === "true",
      piezometric,
      materialPiezometric,
      surcharges,
      lineLoads,
      tensionCrack: tcOption
        ? { option: tcOption, angle: num(childText(tc, "Angle")), line: pointsOf(tc), waterPercent: num(childText(tc, "PctFilledWithWater")) ?? 0 }
        : undefined,
      seismicH: num(seis?.getAttribute("Horizontal")) ?? 0,
      seismicV: num(seis?.getAttribute("Vertical")) ?? 0,
    });
  }

  const system = root.getElementsByTagName("EngCoords")[0]?.getAttribute("UnitSystem")?.toLowerCase();
  let units: "metric" | "imperial";
  if (system === "metric" || system === "imperial") units = system;
  else {
    // no stated system: from the unit weight of water, the one fixed value
    const gw = [...water.values()].find((w) => w.gammaWater !== undefined)?.gammaWater;
    if (gw !== undefined && Math.abs(gw - 62.4) < 1) units = "imperial";
    else if (gw === undefined || Math.abs(gw - 9.81) < 0.2) units = "metric";
    else throw new Error(`Cannot tell the units of the file (unit weight of water ${gw}).`);
  }

  return { units, analyses, geometries, materials, regionMaterials, stability, water };
}

/** The solved slip surfaces of one analysis's slip_surface.csv. */
export function parseSlipSurfaceCsv(text: string): GszSlipResult[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const [iF, iX, iY, iR, iM, iW, iD] = ["SlipFOS", "SlipCenterX", "SlipCenterY", "SlipRadiusX", "SlipOrigSearchMethod", "SlipWeight", "MobilizedShearDirection"].map(col);
  if (iF < 0 || iX < 0 || iY < 0 || iR < 0) return [];
  const out: GszSlipResult[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const fos = Number(c[iF]), cx = Number(c[iX]), cy = Number(c[iY]), r = Number(c[iR]);
    // failed trials carry a sentinel factor
    if (!(fos > 0 && fos < 100) || !Number.isFinite(cx) || !Number.isFinite(cy) || !(r > 0)) continue;
    // search method 4 is the block search, whose surfaces are not circles
    const method = iM >= 0 ? (c[iM] ?? "").trim() : "";
    const weight = iW >= 0 ? Number(c[iW]) : NaN;
    const dir = iD >= 0 ? Number(c[iD]) : NaN;
    out.push({
      fos, cx, cy, r,
      circular: method !== "4" && !/block|fully|optimi/i.test(method),
      ...(Number.isFinite(weight) ? { weight } : {}),
      ...(Number.isFinite(dir) && dir !== 0 ? { direction: dir < 0 ? 1 : -1 } : {}),
    } as GszSlipResult);
  }
  return out;
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
    const prefix = `${a.name.toLowerCase()}/`;
    const csv = [...entries.keys()].sort().find((n) => n.toLowerCase().startsWith(prefix) && n.endsWith("slip_surface.csv"));
    if (csv) results.set(a.name.toLowerCase(), parseSlipSurfaceCsv(new TextDecoder().decode(entries.get(csv))));
  }
  return { ...file, results };
}
