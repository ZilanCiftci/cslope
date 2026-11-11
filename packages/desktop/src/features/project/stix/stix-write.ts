/**
 * Writing a model as a .stix project file: one scenario with one stage and
 * one calculation, holding the layers, soils (Mohr-Coulomb, undrained, Su
 * with its state as SHANSEP, the Su table, the sigma-tau table), the
 * phreatic line or waternet, uniform and line loads (with the degree of
 * consolidation under a uniform load), the earthquake coefficients,
 * geotextiles and the method with a search grid or a given slip plane.
 * What has no counterpart in the format is listed in `notes`.
 *
 * The documents follow the published example files; the receiving program
 * remains the authority on its own format, so the file is a starting point
 * to check there, not a guaranteed round trip.
 */

import { MATERIAL_MODEL_LABELS, WATER_UNIT_WEIGHT, suctionAngle, toCanonicalSlopeDefinition, type MaterialModel, type SlopeDefinition } from "@cslope/engine";
import { buildSlopeDTOFromModel } from "../../../store/helpers";
import type { ModelEntry } from "../../../store/types";
import { computeRegions } from "../../../utils/regions";
import { holeFreeRegions, ringArea2, sharedRings } from "../../../utils/region-rings";
import { writeZip } from "../../../utils/zip";
import { surfaceYAtX } from "../../view/surface";

type Pt = [number, number];
type Json = Record<string, unknown>;

/** The application name and version the files of the format carry (ROT13, like the names guarded in forbidden-names.ts). */
const APPLICATION = "Q-Fgnovyvgl 2025.01".replace(/[a-z]/gi, (c) => {
  const base = c <= "Z" ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});

const VERSION = "2";
const NaN_ = "NaN";
const det = { IsProbabilistic: false, Mean: 1, StandardDeviation: 0 };
const xz = ([x, z]: Pt) => ({ X: x, Z: z });

/** The format's strength model type and parameters of one cSlope model. */
interface SoilStrength {
  type: "MohrCoulombAdvanced" | "Su" | "SuTable" | "SigmaTauTable";
  mc?: { c: number; phi: number };
  su?: { ratio: number; exponent: number };
  suTable?: Pt[];
  sigmaTau?: Pt[];
  /** The SHANSEP state of the layers (POP, OCR or yield stress). */
  state?: { pop: number } | { ocr: number } | { yieldStress: number };
}

function strengthOf(name: string, model: MaterialModel, notes: string[]): SoilStrength {
  switch (model.kind) {
    case "mohr-coulomb":
      if (model.cohesionRateOfChange) notes.push(`Material "${name}": c′ increasing with depth is written as its reference value.`);
      if (model.cFactor) notes.push(`Material "${name}": the combined (undrained) limit is not written; drained c′ and φ′ only.`);
      if (model.drawdownStrength) notes.push(`Material "${name}": the drawdown strength (R envelope, cR, φR) is not written.`);
      return { type: "MohrCoulombAdvanced", mc: { c: model.cohesion, phi: model.frictionAngle } };
    case "undrained":
      if (model.suRateOfChange) notes.push(`Material "${name}": Su increasing with depth is written as its reference value.`);
      return { type: "MohrCoulombAdvanced", mc: { c: model.undrainedShearStrength, phi: 0 } };
    case "shansep": {
      if (model.suByStress && model.suByStress.length > 0) return { type: "SuTable", suTable: model.suByStress };
      if (model.ocrByElevation) notes.push(`Material "${name}": OCR varying with elevation is not written; OCR = 1.`);
      if (model.suMin) notes.push(`Material "${name}": the lower limit of Su is not written.`);
      const state =
        model.pop !== undefined ? { pop: model.pop } : model.yieldStress !== undefined ? { yieldStress: model.yieldStress } : { ocr: model.ocrByElevation ? 1 : model.ocr ?? 1 };
      return { type: "Su", su: { ratio: model.ratio, exponent: model.exponent ?? 0.8 }, state };
    }
    case "shear-normal":
      if (model.spline) notes.push(`Material "${name}": the spline through the shear-normal points is not written; straight lines between them.`);
      return { type: "SigmaTauTable", sigmaTau: model.points };
    default: {
      const m = model as { cohesion?: number; frictionAngle?: number };
      notes.push(`Material "${name}": the material model "${MATERIAL_MODEL_LABELS[model.kind as MaterialModel["kind"]] ?? model.kind}" has no counterpart in the export; written as Mohr-Coulomb${m.cohesion !== undefined || m.frictionAngle !== undefined ? " with its c and φ" : " with no strength, to be entered by hand"}.`);
      return { type: "MohrCoulombAdvanced", mc: { c: m.cohesion ?? 0, phi: m.frictionAngle ?? 0 } };
    }
  }
}

/** A soil document entry with all the format's strength models. */
function soilJson(id: string, name: string, model: MaterialModel, notes: string[]): { soil: Json; state?: SoilStrength["state"] } {
  const below = strengthOf(name, model, notes);
  const above = model.aboveWater ? strengthOf(name, model.aboveWater, notes) : below;
  // one set of parameters per strength model: the one below the water wins
  if (above !== below && above.type === below.type && JSON.stringify(above) !== JSON.stringify(below)) {
    notes.push(`Material "${name}": the strength above the water line is of the same kind as below it with other parameters; the format has one set per kind, so the one below the water is written for both.`);
  }
  const pick = <K extends keyof SoilStrength>(k: K) => (below[k] ?? above[k]);
  const mc = pick("mc") ?? { c: 0, phi: 0 };
  const su = pick("su") ?? { ratio: 0, exponent: 0 };
  const table = (pts: Pt[] | undefined, key: string) => (pts ?? []).map(([s, v]) => ({ EffectiveStress: s, [key]: v }));
  const gamma = model.unitWeight;
  return {
    soil: {
      Id: id,
      Name: name,
      Notes: null,
      Code: name,
      IsProbabilistic: false,
      VolumetricWeightAbovePhreaticLevel: gamma,
      VolumetricWeightBelowPhreaticLevel: model.unitWeightSat ?? gamma,
      ShearStrengthModelTypeAbovePhreaticLevel: above.type,
      ShearStrengthModelTypeBelowPhreaticLevel: below.type,
      MohrCoulombClassicShearStrengthModel: {
        Cohesion: mc.c, CohesionStochasticParameter: det, FrictionAngle: mc.phi, FrictionAngleStochasticParameter: det, CohesionAndFrictionAngleCorrelated: false,
      },
      // dilatancy equal to φ: the strength c′, φ′ itself (a lower one reduces it)
      MohrCoulombAdvancedShearStrengthModel: {
        Cohesion: mc.c, CohesionStochasticParameter: det, FrictionAngle: mc.phi, FrictionAngleStochasticParameter: det, CohesionAndFrictionAngleCorrelated: false,
        Dilatancy: mc.phi, DilatancyStochasticParameter: det,
      },
      SigmaTauTable: { SigmaTauTablePoints: table(pick("sigmaTau"), "ShearStrength"), IsSigmaTauTableProbabilistic: false, SigmaTauTableVariationCoefficient: 0 },
      SuShearStrengthModel: {
        ShearStrengthRatio: su.ratio, ShearStrengthRatioStochasticParameter: det, StrengthIncreaseExponent: su.exponent,
        StrengthIncreaseExponentStochasticParameter: det, ShearStrengthRatioAndShearStrengthExponentCorrelated: false,
      },
      // exponent 0: the table's Su as it is, as cSlope reads it
      SuTable: { StrengthIncreaseExponent: 0, StrengthIncreaseExponentStochasticParameter: det, SuTablePoints: table(pick("suTable"), "Su"), IsSuTableProbabilistic: false, SuTableVariationCoefficient: 0 },
    },
    state: below.state ?? above.state,
  };
}

/** The ground (top of the outline) at x; beside the outline, its highest point. */
function groundAt(outline: Pt[], x: number): number {
  return surfaceYAtX(outline, x) ?? Math.max(...outline.map((p) => p[1]));
}

/** A stage's documents (geometry, soil layers, water, state, loads, reinforcement) for a slope definition. */
interface StageDocs {
  geometry: Json;
  soilLayers: Json;
  waternet: Json;
  state: Json;
  loads: Json;
  reinforcements: Json;
}

/**
 * The documents of one stage of `def` (in its own coordinates). Layers are
 * labelled by material and their order within it, so that the layers of an
 * earlier stage match those of the next one. `inherits` (material name):
 * the layers take the stress history of the earlier stage and get no state
 * point.
 */
function stageDocs(
  def: SlopeDefinition,
  id: () => string,
  soilOf: (material: string) => { soilId: string; state?: SoilStrength["state"] } | undefined,
  inherits: (material: string) => boolean,
  options: { seismicHorizontal?: number; seismicVertical?: number; waterUnitWeight?: number },
  notes: string[],
): StageDocs {
  const outline = def.coordinates;
  const names = def.materials.map((m) => m.name);
  const regions = computeRegions(
    outline,
    (def.materialBoundaries ?? []).map((b, i) => ({ id: `b${String(i).padStart(4, "0")}`, coordinates: b.coordinates })),
    (def.regionAssignments ?? []).map((a) => ({ point: a.point, materialId: a.materialName })),
    names[0],
  );
  // layers may not overlap: a region around a lens is written as pieces without holes
  const pieces = holeFreeRegions(regions);
  if (pieces.some((r) => r.holes && r.holes.length > 0)) notes.push("A region that surrounds another (a hole) could not be split into pieces and is written without the hole; layers may not overlap in the format, so check it.");
  const { points, rings } = sharedRings(pieces);
  const count = new Map<string, number>();
  const layers = rings.map((r) => {
    const k = (count.get(r.materialId) ?? 0) + 1;
    count.set(r.materialId, k);
    // clockwise, as the format's files give the layers
    const ring = r.ids.map((q) => points[q - 1]);
    if (ringArea2(ring) > 0) ring.reverse();
    return { id: id(), label: `${r.materialId} ${k}`, ring, material: r.materialId };
  });

  // state: a state point in each layer of a SHANSEP soil
  const statePoints = layers.flatMap((l) => {
    const st = soilOf(l.material)?.state;
    if (!st || inherits(l.material)) return [];
    // a point inside the layer: the middle of the lowest vertical chord at its mean x
    const cx = l.ring.reduce((t, p) => t + p[0], 0) / l.ring.length;
    const ys: number[] = [];
    for (let i = 0; i < l.ring.length; i++) {
      const a = l.ring[i], b = l.ring[(i + 1) % l.ring.length];
      if ((a[0] - cx) * (b[0] - cx) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((cx - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
    }
    ys.sort((a, b) => a - b);
    const z = ys.length >= 2 ? (ys[0] + ys[1]) / 2 : l.ring[0][1];
    const stress =
      "pop" in st
        ? { StateType: "Pop", Pop: st.pop, PopStochasticParameter: det, Ocr: 1, YieldStress: 0 }
        : "ocr" in st
          ? { StateType: "Ocr", Pop: 0, PopStochasticParameter: det, Ocr: st.ocr, YieldStress: 0 }
          : { StateType: "YieldStress", Pop: 0, PopStochasticParameter: det, Ocr: 1, YieldStress: st.yieldStress };
    return [{ Id: id(), LayerId: l.id, Label: `SP ${l.label}`, Notes: null, IsProbabilistic: false, Point: xz([cx, z]), Stress: stress }];
  });

  // water: the main line as the phreatic line; a waternet with its head and reference lines
  const headLines: Json[] = [];
  const referenceLines: Json[] = [];
  let phreaticId: string | null = null;
  if (def.waternet) {
    const ids = new Map<string, string>();
    for (const h of def.waternet.headLines) {
      const hid = id();
      ids.set(h.id, hid);
      headLines.push({ Id: hid, Label: `Head line ${headLines.length + 1}`, Notes: null, Points: h.points.map(xz) });
    }
    phreaticId = def.waternet.phreaticLineId !== undefined ? ids.get(def.waternet.phreaticLineId) ?? null : null;
    def.waternet.referenceLines.forEach((r, i) =>
      referenceLines.push({
        Id: id(), Label: `Reference line ${i + 1}`, Notes: null, Points: r.points.map(xz),
        TopHeadLineId: r.topHeadLineId !== undefined ? ids.get(r.topHeadLineId) ?? null : null,
        BottomHeadLineId: r.bottomHeadLineId !== undefined ? ids.get(r.bottomHeadLineId) ?? null : null,
      }),
    );
  }
  if (!phreaticId && def.waterTable && Array.isArray(def.waterTable.value) && def.waterTable.value.length >= 2) {
    phreaticId = id();
    headLines.unshift({ Id: phreaticId, Label: "Phreatic line", Notes: null, Points: (def.waterTable.value as Pt[]).map(xz) });
  }
  if ((def.waterTables ?? []).length > 0) notes.push("The materials' own water lines are not written; the format has one phreatic line (and head lines through reference lines).");
  // B-bar: the weight of the fills not yet consolidated in the B̄ materials
  // (degree of consolidation 1 − B̄; the format has no B̄ above 1)
  const bBarOf = (name: string) => (def.materials.find((m) => m.name === name)?.model as { bBar?: number } | undefined)?.bBar ?? 0;
  const isFill = (name: string) => (def.materials.find((m) => m.name === name)?.model as { bBarLoad?: boolean } | undefined)?.bBarLoad === true;
  if (def.materials.some((m) => bBarOf(m.name) > 1)) notes.push("A B̄ above 1 is written as a degree of consolidation of 0 % (B̄ = 1).");
  if (def.materials.some((m) => bBarOf(m.name) > 0) && !def.materials.some((m) => isFill(m.name))) notes.push("Materials have B̄ but none is marked as fill, so no excess pore pressure is written.");

  // loads
  const full = layers.map((l) => ({ LayerId: l.id, Degree: 100 }));
  const uniformLoads = (def.udls ?? []).map((u, i) => {
    if (u.direction === "normal") notes.push(`Distributed load ${i + 1} acts normal to the ground in cSlope; it is written as vertical.`);
    const consolidations = layers.map((l) => {
      const e = (u.excessPorePressure ?? []).find((q) => q.material === l.material);
      return { LayerId: l.id, Degree: e ? 100 * (1 - e.ratio) : 100 };
    });
    return { Label: `Load ${i + 1}`, Notes: null, Start: Math.min(u.x1, u.x2), End: Math.max(u.x1, u.x2), Magnitude: u.magnitude, Spread: 0, Consolidations: consolidations };
  });
  const lineLoads = (def.lineLoads ?? []).map((l, i) => ({
    Label: `Line load ${i + 1}`, Notes: null, Location: xz([l.x, l.y ?? groundAt(outline, l.x)]), Magnitude: l.magnitude, Angle: l.angle ?? 0, Spread: 0, Consolidations: full,
  }));
  const layerLoads = layers.map((l) => ({
    LayerId: l.id,
    Consolidations: layers
      .filter((o) => o.id !== l.id)
      .map((o) => ({ LayerId: o.id, Degree: isFill(l.material) && bBarOf(o.material) > 0 ? 100 * (1 - Math.min(1, bBarOf(o.material))) : 100 })),
  }));
  const kh = options.seismicHorizontal ?? 0, kv = options.seismicVertical ?? 0;

  // reinforcement: elements with a developed pullout as geotextiles
  const geotextiles = (def.reinforcements ?? []).flatMap((r, i) => {
    const dev = r.pullout?.kind === "development" ? r.pullout : undefined;
    if (!dev) {
      notes.push(`Reinforcement ${i + 1} is not written (only elements with a development length carry over, as geotextiles).`);
      return [];
    }
    if (dev.length1 !== dev.length2) notes.push(`Reinforcement ${i + 1}: the format has one reduction length; ${dev.length1} m (end 1) is written.`);
    return [{ Label: `Geotextile ${i + 1}`, Notes: null, Start: xz([r.x1, r.y1]), End: xz([r.x2, r.y2]), TensileStrength: r.tensileCapacity / (r.spacing ?? 1), ReductionArea: dev.length1 }];
  });
  if ((def.piles ?? []).length > 0) notes.push(`${def.piles!.length} pile row(s) not written.`);

  return {
    geometry: { Layers: layers.map((l) => ({ Id: l.id, Label: l.label, Notes: null, Points: l.ring.map(xz) })) },
    soilLayers: { SoilLayers: layers.map((l) => ({ LayerId: l.id, SoilId: soilOf(l.material)?.soilId })) },
    waternet: { UnitWeightWater: options.waterUnitWeight ?? WATER_UNIT_WEIGHT, PhreaticLineId: phreaticId, HeadLines: headLines, ReferenceLines: referenceLines },
    state: { StatePoints: statePoints, StateLines: [] },
    loads: {
      LayerLoads: layerLoads, UniformLoads: uniformLoads, LineLoads: lineLoads, Trees: [],
      Earthquake: { IsEnabled: kh !== 0 || kv !== 0, Label: "Earthquake", Notes: null, HorizontalFactor: kh, VerticalFactor: kv, FreeWaterFactor: 0, Consolidations: full },
    },
    reinforcements: { ForbiddenLines: [], Geotextiles: geotextiles, Nails: [] },
  };
}

/** The documents of a .stix file for the model (path → JSON), with what is not written. */
export function modelToStixDocuments(model: ModelEntry): { docs: Map<string, Json>; notes: string[] } {
  const notes: string[] = [];
  // the definition in the model's own coordinates (the analysis input is
  // mirrored for a right-to-left slope; mirroring it again restores them)
  const canonical = buildSlopeDTOFromModel(model);
  const def: SlopeDefinition = canonical.orientation === "rtl" ? toCanonicalSlopeDefinition(canonical) : canonical;
  if (def.coordinates.length < 3 || def.materials.length === 0) throw new Error("The model has no outline or no materials to export.");
  let next = 1;
  const id = () => String(next++);
  const earlier = def.earlierStage;

  // soils: one per material name, those of the earlier stage first (as in a file written stage by stage)
  const soilByName = new Map<string, { soilId: string; state?: SoilStrength["state"]; colour?: string }>();
  const soils: Json[] = [];
  const addSoils = (materials: SlopeDefinition["materials"]) => {
    for (const m of materials) {
      if (!m.model) continue;
      const had = soilByName.get(m.name);
      if (had) continue;
      const soilId = id();
      const { soil, state } = soilJson(soilId, m.name, m.model, notes);
      soils.push(soil);
      soilByName.set(m.name, { soilId, ...(state ? { state } : {}), ...(m.color ? { colour: m.color } : {}) });
    }
  };
  addSoils(def.materials);
  if (earlier) {
    for (const m of earlier.materials) {
      const now = def.materials.find((q) => q.name === m.name);
      if (now && JSON.stringify({ ...now.model, yieldFromEarlierStage: undefined }) !== JSON.stringify({ ...m.model, yieldFromEarlierStage: undefined })) {
        notes.push(`"${m.name}" differs between the earlier stage and the model; the format has one soil per name, so the model's is written.`);
      }
    }
    addSoils(earlier.materials);
  }
  const soilOf = (name: string) => soilByName.get(name);
  const fromEarlier = (name: string) => {
    const m = def.materials.find((q) => q.name === name)?.model as { yieldFromEarlierStage?: boolean; aboveWater?: { yieldFromEarlierStage?: boolean } } | undefined;
    return m?.yieldFromEarlierStage === true || m?.aboveWater?.yieldFromEarlierStage === true;
  };
  if (earlier) {
    const missing = def.materials.filter((m) => fromEarlier(m.name) && !earlier.materials.some((q) => q.name === m.name)).map((m) => `"${m.name}"`);
    if (missing.length > 0) notes.push(`${missing.join(", ")} take the stress history of the earlier stage, which has no material of that name (renamed?); the receiving program matches layers by their names, so the history may not carry over.`);
  }
  const opts = model.options;
  const seismic = { seismicHorizontal: opts.seismicHorizontal, seismicVertical: opts.seismicVertical, waterUnitWeight: opts.waterUnitWeight };

  // stages: the earlier one (its stress history) and the model's
  const stages: { label: string; docs: StageDocs }[] = [];
  if (earlier) stages.push({ label: "Earlier stage", docs: stageDocs(earlier, id, soilOf, () => false, seismic, notes) });
  stages.push({ label: earlier ? "Stage 2" : "Stage 1", docs: stageDocs(def, id, soilOf, (name) => !!earlier && fromEarlier(name), seismic, notes) });
  if (model.piezometricLine?.rapidDrawdown) notes.push("Rapid drawdown is not written; the water written is the water after drawdown.");

  // calculation: Bishop on a given circle, Spencer on a given surface, else Bishop over a grid
  const outline = def.coordinates;
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  const circle = def.customSearchPlanes?.[0];
  const surface = def.customSurfaces?.[0];
  let analysisType = "BishopBruteForce";
  if (def.customPlanesOnly && surface && opts.method !== "Bishop") analysisType = "Spencer";
  else if (def.customPlanesOnly && circle && (def.customSearchPlanes?.length ?? 0) === 1 && !surface) analysisType = "Bishop";
  if (opts.method !== "Bishop" && analysisType !== "Spencer") notes.push(`The method ${opts.method} is written as Bishop over a search grid (the format's Spencer analyzes given slip planes); check the method there.`);
  if (opts.method === "Bishop" && analysisType === "Spencer") notes.push("Bishop on a non-circular surface is written as Spencer.");
  if (analysisType === "BishopBruteForce") notes.push("The search grid and tangent lines are set from the model's extent; adjust them to the slope there.");
  if (def.analysisLimits) notes.push("The entry and exit ranges are not written (the format limits the search with zones).");
  if (opts.partialFactors) notes.push("The partial factors are not written; the calculation is deterministic with the given values.");
  if (opts.tensionCrackDepth || opts.tensionCrackAuto || opts.tensionCrackAngle) notes.push("The tension crack is not written.");
  if (analysisType === "Spencer" && opts.method === "Morgenstern-Price" && opts.intersliceFunction && opts.intersliceFunction !== "constant") notes.push(`Morgenstern-Price with the ${opts.intersliceFunction} interslice function is written as Spencer (a constant function).`);
  if ((def.customSearchPlanes?.length ?? 0) + (def.customSurfaces?.length ?? 0) > 1) notes.push("Only the first custom circle or surface is written.");
  if ((def.blockSearchObjects ?? []).length > 0) notes.push("The block search objects are not written.");
  for (const m of def.materials) {
    if (m.model && suctionAngle(m.model) > 0) notes.push(`"${m.name}": the strength from suction (φb) is not written.`);
    if (m.model?.ru) notes.push(`"${m.name}": the pore pressure ratio rᵤ = ${m.model.ru} is not written (the format has none).`);
    if (m.model && (m.model as { anisotropy?: unknown[] }).anisotropy?.length) notes.push(`"${m.name}": the anisotropy of the undrained strength is not written.`);
  }
  const nx = 10, nz = 10;
  const settings: Json = {
    Id: id(),
    AnalysisType: analysisType,
    CalculationType: "Deterministic",
    ModelFactorMean: 1,
    ModelFactorStandardDeviation: 0,
    Bishop: { Label: null, Notes: null, Circle: circle ? { Center: xz([circle.cx, circle.cy]), Radius: circle.radius } : { Center: { X: NaN_, Z: NaN_ }, Radius: NaN_ } },
    BishopBruteForce: {
      SearchGrid: { Label: null, Notes: null, BottomLeft: xz([x0 + 0.25 * w, y1 + 0.1 * h]), Space: Math.max(0.1, +((0.5 * w) / nx).toPrecision(2)), NumberOfPointsInX: nx, NumberOfPointsInZ: nz },
      TangentLines: { Label: null, Notes: null, BottomTangentLineZ: y0 + 0.1 * h, Space: Math.max(0.1, +((0.8 * h) / 10).toPrecision(2)), NumberOfTangentLines: 10 },
      GridEnhancements: { ExtrapolateSearchSpace: true },
      SlipPlaneConstraints: { IsSizeConstraintsEnabled: false, MinimumSlipPlaneDepth: 0, MinimumSlipPlaneLength: 0, IsZoneAConstraintsEnabled: false, XLeftZoneA: 0, WidthZoneA: 0, IsZoneBConstraintsEnabled: false, XLeftZoneB: 0, WidthZoneB: 0 },
    },
    UpliftVan: { Label: null, Notes: null, SlipPlane: { FirstCircleCenter: { X: NaN_, Z: NaN_ }, FirstCircleRadius: NaN_, SecondCircleCenter: { X: NaN_, Z: NaN_ } } },
    UpliftVanParticleSwarm: {
      SearchAreaA: { Label: null, Notes: null, TopLeft: null, Width: 0, Height: 0 },
      SearchAreaB: { Label: null, Notes: null, TopLeft: null, Width: 0, Height: 0 },
      TangentArea: { Label: null, Notes: null, TopZ: null, Height: 0 },
      SlipPlaneConstraints: { IsSizeConstraintsEnabled: false, MinimumSlipPlaneDepth: 0, MinimumSlipPlaneLength: 0, IsZoneAConstraintsEnabled: false, XLeftZoneA: 0, WidthZoneA: 0, IsZoneBConstraintsEnabled: false, XLeftZoneB: 0, WidthZoneB: 0 },
      OptionsType: "Default",
    },
    Spencer: { Label: null, Notes: null, SlipPlane: surface ? surface.points.map(xz) : null, SlipPlaneConstraints: { IsEnabled: false, MinimumAngleBetweenSlices: 120, MinimumThrustLinePercentageInsideSlices: 80 } },
    SpencerGenetic: { Label: null, Notes: null, SlipPlaneA: null, SlipPlaneB: null, SlipPlaneConstraints: { IsEnabled: false, MinimumAngleBetweenSlices: 0, MinimumThrustLinePercentageInsideSlices: 0 }, OptionsType: "Default" },
    ContentVersion: VERSION,
  };

  const name = model.name || "cSlope model";
  const docs = new Map<string, Json>();
  docs.set("projectinfo.json", {
    Path: "", Project: name, CrossSection: "", Remarks: "Exported from cSlope", Analyst: "", LastModifier: "", Date: null, LastModified: null, Created: null,
    ApplicationCreated: APPLICATION, ApplicationModified: APPLICATION, IsDataValidated: false, ContentVersion: VERSION,
  });
  // the documents of each stage, numbered as the format numbers them (name.json, name_1.json, …)
  const path = (dir: string, base: string, k: number) => `${dir}/${base}${k === 0 ? "" : `_${k}`}.json`;
  const stageEntries = stages.map(({ label, docs: d }, k) => {
    const ids = {
      geometry: id(), decorations: id(), soilLayers: id(), waternet: id(), creator: id(), waterMesh: id(), state: id(), correlations: id(), loads: id(), reinforcements: id(),
    };
    docs.set(path("geometries", "geometry", k), { Id: ids.geometry, ...d.geometry, ContentVersion: VERSION });
    docs.set(path("decorations", "decorations", k), { Id: ids.decorations, Excavations: [], Elevations: [], ContentVersion: VERSION });
    docs.set(path("soillayers", "soillayers", k), { Id: ids.soilLayers, ...d.soilLayers, ContentVersion: VERSION });
    docs.set(path("waternets", "waternets", k), { Id: ids.waternet, ...d.waternet, ContentVersion: VERSION });
    docs.set(path("waternetcreatorsettings", "waternetcreatorsettings", k), { Id: ids.creator, ...WATERNET_CREATOR, ContentVersion: VERSION });
    docs.set(path("watermeshes", "watermeshes", k), { Id: ids.waterMesh, UnitWeightWater: 0, Elements: null, WaterMeshProperties: null, ContentVersion: VERSION });
    docs.set(path("states", "states", k), { Id: ids.state, ...d.state, ContentVersion: VERSION });
    docs.set(path("statecorrelations", "statecorrelations", k), { Id: ids.correlations, StateCorrelations: [], ContentVersion: VERSION });
    docs.set(path("loads", "loads", k), { Id: ids.loads, ...d.loads, ContentVersion: VERSION });
    docs.set(path("reinforcements", "reinforcements", k), { Id: ids.reinforcements, ...d.reinforcements, ContentVersion: VERSION });
    return {
      Id: id(), Label: label, Notes: null, GeometryId: ids.geometry, DecorationsId: ids.decorations, SoilLayersId: ids.soilLayers, WaternetId: ids.waternet,
      WaternetCreatorSettingsId: ids.creator, WaterMeshId: ids.waterMesh, WaterDefinitionType: "WaterLines", StateId: ids.state, StateCorrelationsId: ids.correlations,
      LoadsId: ids.loads, ReinforcementsId: ids.reinforcements,
    };
  });
  docs.set("scenarios/scenario.json", {
    Id: "0", Label: name, Notes: null, Stages: stageEntries,
    Calculations: [{ Id: id(), Label: "Calculation 1", Notes: null, CalculationSettingsId: settings.Id, ResultId: null }],
    ContentVersion: VERSION,
  });
  docs.set("calculationsettings/calculationsettings.json", settings);
  docs.set("soils.json", { Soils: soils, ContentVersion: VERSION });
  const colour = (hex: string | undefined) => `#80${(hex?.match(/^#?([0-9a-f]{6})/i)?.[1] ?? "c8c8c8").toUpperCase()}`;
  const soilList = [...soilByName.values()];
  docs.set("soilvisualizations.json", {
    SoilVisualizations: soilList.map((s) => ({ SoilId: s.soilId, Color: colour(s.colour), PersistableShadingType: "DiagonalA" })),
    ContentVersion: VERSION,
  });
  docs.set("soilcorrelations.json", { SoilCorrelations: [], ContentVersion: VERSION });
  docs.set("nailpropertiesforsoils.json", {
    NailPropertiesForSoils: soilList.map((s) => ({ SoilId: s.soilId, CompressionRatio: 1, RheologicalCoefficient: 0, AreBondStressesActive: false, BondStresses: [] })),
    ContentVersion: VERSION,
  });
  return { docs, notes: [...new Set(notes)] };
}

/** The waternet creator's settings, unused (the water is given as lines). */
const WATERNET_CREATOR: Json = {
  EmbankmentCharacteristics: { EmbankmentToeWaterSide: NaN_, EmbankmentTopWaterSide: NaN_, EmbankmentTopLandSide: NaN_, ShoulderBaseLandSide: NaN_, EmbankmentToeLandSide: NaN_ },
  DitchCharacteristics: { DitchEmbankmentSide: NaN_, DitchBottomEmbankmentSide: NaN_, DitchBottomLandSide: NaN_, DitchLandSide: NaN_ },
  IsDitchPresent: false, EmbankmentSoilScenario: "ClayEmbankmentOnClay", NormativeWaterLevel: NaN_, MeanWaterLevel: NaN_, WaterLevelHinterland: NaN_,
  InitialLevelEmbankmentTopWaterSide: NaN_, InitialLevelEmbankmentTopLandSide: NaN_, UseDefaultOffsets: true, OffsetEmbankmentTopWaterSide: NaN_,
  OffsetEmbankmentTopLandSide: NaN_, OffsetShoulderBaseLandSide: NaN_, OffsetEmbankmentToeLandSide: NaN_, IsDrainageConstructionPresent: false,
  DrainageConstruction: { X: NaN_, Z: NaN_ }, AquiferLayerId: null, AquiferInsideAquitardLayerId: null, AdjustForUplift: false, IsAquiferLayerInsideAquitard: false,
  PleistoceneLeakageLengthOutwards: NaN_, AquiferLayerInsideAquitardLeakageLengthOutwards: NaN_, PleistoceneLeakageLengthInwards: NaN_,
  AquiferLayerInsideAquitardLeakageLengthInwards: NaN_, AquitardHeadWaterSide: NaN_, AquitardHeadLandSide: NaN_, IntrusionLength: NaN_,
};

/** The model as the bytes of a .stix file, with what is not written. */
export function modelToStix(model: ModelEntry): { bytes: Uint8Array; notes: string[] } {
  const { docs, notes } = modelToStixDocuments(model);
  const bytes = writeZip([...docs.entries()].map(([name, doc]) => ({ name, data: JSON.stringify(doc, null, 2) })));
  return { bytes, notes };
}
