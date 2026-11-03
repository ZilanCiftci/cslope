// Fixtures for the model core (model/slope.ts, composite.ts, surface.ts,
// reinforcement.ts, search.ts (generation), build-slope.ts): a snapshot of
// every getter and derived value of the Slope built from each verification
// problem, reliability case and app example (as given and mirrored to
// right-to-left, through toCanonicalSlopeDefinition), with the options of
// each verification check and composite variants; the planes
// setEntryExitPlanes generates, and the refined and local planes generated
// around them (with made-up factors of safety); polylines fitted from the
// circles; and the error messages of buildSlope and the setters. Run under
// Node:
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts model-core
import { rmSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, writeFixture } from "./write";
import { PROBLEMS } from "../../../engine/src/verification/problems";
import { RELIABILITY_CASES } from "../../../engine/src/verification/reliability-cases";
import { verificationOptions } from "../../../engine/src/verification/cases";
import { FHWA_PULLOUT_TABLES } from "../../../engine/src/verification/pullout-tables";
import { getDomainX, mirrorPoints, toCanonicalSlopeDefinition } from "../../../engine/src/model/canonical";
import { buildSlope } from "../../../engine/src/model/build-slope";
import { Slope, type SearchPlane } from "../../../engine/src/model/slope";
import {
  addSingleCircularPlane,
  addSingleEntryExitPlane,
  generateLocalPlanes,
  generatePlanes,
  generateRefinedPlanes,
  isPlaneWithinExternalBoundary,
  planeKey,
  selectEntryExit,
  setEntryExitPlanes,
} from "../../../engine/src/model/search";
import {
  boundaryCornerInMass,
  circleLeavesModel,
  circleToPolyline,
  defaultAxisPoint,
  fitPolylineToGround,
  isAdmissiblePolyline,
  polylineCrossingsX,
  polylineYAt,
} from "../../../engine/src/model/surface";
import { circleBelowBareBase, compositeFloor, floorYAt } from "../../../engine/src/model/composite";
import {
  effectiveVerticalStress,
  effectiveVerticalStressWithLoads,
  envelopeAt,
  itoMatsuiCoefficients,
  pileForce,
  pileForceDirection,
  pulloutBeyond,
  verticalStress,
} from "../../../engine/src/model/reinforcement";
import { Material } from "../../../engine/src/types/material";
import type { AnalysisOptions } from "../../../engine/src/types/analysis";
import type { SlopeDefinition } from "../../../engine/src/types/slope-definition";
import type { GeometryWithMaterial } from "../../../engine/src/types/geometry";
import { BENCHMARK_MODELS } from "../../../desktop/src/store/benchmarks";
import { buildSlopeDTOFromModel } from "../../../desktop/src/store/helpers";

type Pt = [number, number];

const attempt = <T>(f: () => T) => {
  try {
    return { ok: f() };
  } catch (e) {
    return { error: (e as Error).message };
  }
};

/** A right-to-left model with every field (as in canonical.fixture.ts), and staged. */
const FULL: SlopeDefinition = {
  orientation: "rtl",
  coordinates: [[0, -10], [0, 0], [15, 0], [25, 10], [40, 10], [40, -10]],
  materials: [
    { name: "Fill", unitWeight: 19, cohesion: 2, frictionAngle: 32, cohesionRefDepth: 1, color: "#aaa", depthRange: [0, 3], waterTableId: "p2" },
    {
      name: "Clay",
      model: {
        kind: "mohr-coulomb", unitWeight: 17, cohesion: 5, frictionAngle: 25,
        aboveWater: { kind: "spatial-mohr-coulomb", unitWeight: 18, dataPoints: [[2, 5, 10, 30, 18], [38, 5, 12, 28, 18]], interpolation: "nearest" },
      },
    },
    { name: "Spatial", model: { kind: "spatial-mohr-coulomb", unitWeight: 18, unitWeightSat: 20, ru: 0.1, dataPoints: [[5, -5, 10, 30, 18], [35, -5, 12, 28, 19]] } },
    { name: "Rock", model: { kind: "impenetrable", unitWeight: 22 } },
  ],
  waterTable: { mode: "custom", value: [[0, -1], [20, 2], [40, 8]], followBoundary: false },
  waterTables: [{ id: "p2", coordinates: [[0, -3], [40, 5]], followBoundary: true }],
  udls: [{ magnitude: 10, x1: 30, x2: 36, direction: "normal", excessPorePressure: [{ material: "Clay", ratio: 0.4 }, { material: "Fill", ratio: 0.5 }] }, { magnitude: 5, x1: 38, x2: 32 }, { magnitude: 0, x1: 1, x2: 2 }],
  lineLoads: [{ magnitude: 50, x: 35, angle: 20, y: 11 }, { magnitude: 20, x: 33, angle: 0 }, { magnitude: 7, x: 30 }, { magnitude: 0, x: 31 }],
  rapidDrawdown: { waterBefore: [[0, 5], [40, 9]] },
  waternet: {
    headLines: [{ id: "h1", points: [[40, 8], [0, 2]] }, { id: "h2", points: [[0, 0], [20, 1], [40, 3]] }],
    referenceLines: [{ points: [[0, -4], [40, -2]], topHeadLineId: "h1", bottomHeadLineId: "h2" }, { points: [[40, -8], [0, -8]], bottomHeadLineId: "h2" }],
    phreaticLineId: "h1",
  },
  reinforcements: [
    { x1: 24, y1: 9, x2: 34, y2: 4, tensileCapacity: 100, spacing: 2, pullout: { kind: "bond", strength: 20, bondedLength: 4 }, direction: "tangent", application: "passive", prestress: 10 },
    { x1: 22, y1: 8, x2: 36, y2: 2, tensileCapacity: 80, pullout: { kind: "interface", adhesion: 3, frictionAngle: 20, coverage: 0.8 }, end1Capacity: 5 },
    { x1: 20, y1: 6, x2: 32, y2: 0, tensileCapacity: 60, pullout: { kind: "development", length1: 2, length2: 3 } },
    { x1: 18, y1: 4, x2: 30, y2: -2, tensileCapacity: 40 },
    { x1: 14, y1: 2, x2: 26, y2: -1, tensileCapacity: 50, pullout: { kind: "bond", strength: 15 } },
  ],
  piles: [
    { x1: 30, y1: 10, x2: 30, y2: -6, diameter: 0.6, spacing: 1.5, angle: 10, direction: "angle", location: "slip-surface", wall: false },
    { x1: 34, y1: 10, x2: 34, y2: -4, diameter: 0.5, spacing: 1.2, shearCapacity: 40, momentCapacity: 30 },
    { x1: 27, y1: 11, x2: 28, y2: -3, force: 25, spacing: 2, direction: "perpendicular" },
    { x1: 37, y1: 10, x2: 37, y2: 0, force: 15, direction: "tangent", application: "passive" },
  ],
  materialBoundaries: [{ coordinates: [[0, -3], [40, 3]], materialName: "" }, { coordinates: [[0, -6], [40, -6]], materialName: "Spatial" }, { coordinates: [[0, -8], [40, -8]], materialName: "Rock" }],
  topRegionMaterialName: "Fill",
  regionAssignments: [{ point: [38, 9], materialName: "Fill" }, { point: [20, -1], materialName: "Clay" }, { point: [20, -7], materialName: "Spatial" }, { point: [20, -9], materialName: "Rock" }],
  analysisLimits: { entryLeftX: 26, entryRightX: 38, exitLeftX: 2, exitRightX: 14 },
  customSearchPlanes: [{ cx: 18, cy: 22, radius: 20 }, { cx: 18, cy: 22, radius: 25 }, { cx: 100, cy: 100, radius: 1 }],
  customSurfaces: [{ points: [[30, 10], [20, -2], [10, 0]], axis: [21, 23] }, { points: [[28, 10], [12, 0]] }, { points: [[30, 12], [29, 11]] }],
  customPlanesOnly: false,
  blockSearchObjects: [{ points: [[20, -3]] }, { points: [[10, -2], [14, -2]] }, { points: [[16, -4], [20, -4], [20, -2]] }],
};
const STAGED: SlopeDefinition = { ...FULL, earlierStage: { ...FULL, coordinates: [[5, -10], [5, 0], [15, 0], [20, 12], [35, 12], [35, -10]], earlierStage: undefined } };
/** Legacy boundary-name assignment, partial factors on the piles, a vertical face. */
const LEGACY: SlopeDefinition = {
  coordinates: [[0, 0], [0, 10], [10, 10], [10, 4], [20, 4], [30, 0]],
  materials: [
    { name: "Top", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 8, frictionAngle: 28 } },
    { name: "Mid", model: { kind: "undrained", unitWeight: 17, cohesion: 25 } as never },
    { name: "Base", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 15, frictionAngle: 30, cFactor: 5, cohesionUndrained: 30 } },
  ],
  materialBoundaries: [{ coordinates: [[0, 6], [30, 2]], materialName: "Mid" }, { coordinates: [[0, 3], [30, 0.5]], materialName: "Base" }],
  waterTable: { mode: "depth", value: 4 },
  piles: [{ x1: 15, y1: 4, x2: 15, y2: 0.2, diameter: 0.4, spacing: 1 }, { x1: 5, y1: 10, x2: 5, y2: 1, diameter: 0.3, spacing: 0.9, momentCapacity: 5 }],
  udls: [{ magnitude: 12, x1: 2, x2: 6 }],
  lineLoads: [{ magnitude: 30, x: 8 }],
};

function definitions(): { id: string; definition: SlopeDefinition }[] {
  const out = PROBLEMS.map((p) => ({ id: p.id, definition: p.definition }));
  RELIABILITY_CASES.forEach((c, i) => out.push({ id: `reliability-${i}`, definition: c.definition }));
  BENCHMARK_MODELS.forEach((m, i) => out.push({ id: `app-${i}`, definition: buildSlopeDTOFromModel(m) }));
  out.push({ id: "full", definition: FULL }, { id: "staged", definition: STAGED }, { id: "full-ltr", definition: { ...FULL, orientation: "ltr" } }, { id: "legacy", definition: LEGACY });
  return out;
}

/** The definition as a right-to-left model: mirrored outline, the same other fields. */
function asRtl(d: SlopeDefinition): SlopeDefinition {
  const [x0, x1] = getDomainX(d.coordinates);
  return { ...d, orientation: "rtl", coordinates: mirrorPoints(d.coordinates, x0, x1) };
}

const mat = (m: Material) => ({ name: m.name, color: m.color, model: m.model });
const geom = (g: GeometryWithMaterial) => ({ px: g.px, py: g.py, material: mat(g.material), xMin: g.xMin, xMax: g.xMax, yMax: g.yMax });
const planeJson = (p: SearchPlane) => ({
  key: planeKey(p), lc: p.lc, rc: p.rc, cx: p.cx, cy: p.cy, radius: p.radius, fos: p.fos, tangentTo: p.tangentTo, unchecked: p.unchecked, points: p.points,
});

function snap(slope: Slope, depth = 0): unknown {
  const geoms = slope.materialGeometries;
  const { x: bx, y: by } = slope.externalBoundaryXY;
  const x0 = Math.min(...bx), x1 = Math.max(...bx), y0 = Math.min(...by), y1 = Math.max(...by);
  const xs = Array.from({ length: 9 }, (_, i) => x0 + ((x1 - x0) * i) / 8);
  const probe = [];
  for (let i = 0; i <= 6; i++)
    for (let j = 0; j <= 6; j++) {
      const x = x0 + ((x1 - x0) * (i + 0.37)) / 7, y = y0 + ((y1 - y0) * (j + 0.21)) / 7;
      probe.push({ x, y, inside: slope.isInsideExternalBoundary(x, y), evs: effectiveVerticalStress(slope, x, y), evsl: effectiveVerticalStressWithLoads(slope, x, y), total: verticalStress(slope, x, y, false) });
    }
  const envelopes = slope.reinforcementEnvelopes.map((e) => ({
    length: e.length, s: Array.from(e.s), fromEnd1: Array.from(e.fromEnd1), tensile: e.tensile, end1: e.end1, end2: e.end2, anchored: e.anchored, development: e.development,
    at: [-0.1, 0, 0.05, 0.25, 0.5, 0.75, 0.99, 1, 1.2].map((t) => [envelopeAt(e, t * e.length), pulloutBeyond(e, t * e.length)]),
  }));
  const profiles = attempt(() => slope.pileProfiles.map((p) => (p ? { z: Array.from(p.z), F: Array.from(p.F), Q: Array.from(p.Q) } : null)));
  const pileForces = "ok" in profiles
    ? slope.piles.map((p, k) => [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((t) => {
        const r = pileForce(slope, p, p.x1 + t * (p.x2 - p.x1), p.y1 + t * (p.y2 - p.y1), slope.pileProfiles[k]);
        return [r.perPile, r.perMetre, r.governs, r.resultantAbove];
      }))
    : null;
  const circles: [number, number, number][] = [
    [(x0 + x1) / 2, y1 + (y1 - y0), 1.6 * (y1 - y0)],
    [x0 + 0.4 * (x1 - x0), y1 + 0.5 * (y1 - y0), (y1 - y0)],
    [x0 + 0.6 * (x1 - x0), y1, 0.5 * (y1 - y0)],
  ];
  return {
    geometries: geoms.map(geom),
    externalBoundary: slope.externalBoundaryXY,
    surface: slope.surfaceLineXY,
    water: slope.waterRLXY,
    hasWaterTable: slope.hasWaterTable,
    hasMaterialWaterTables: slope.hasMaterialWaterTables,
    allWaterLines: slope.allWaterLines,
    waterPerGeometry: geoms.map((g) => slope.getWaterLineForMaterial(g.material)),
    waterNoMaterial: slope.getWaterLineForMaterial(null),
    udls: slope.udls.map((u) => ({ magnitude: u.magnitude, x1: u.x1, x2: u.x2, length: u.length, color: u.color, direction: u.direction, excessPorePressure: u.excessPorePressure })),
    lineLoads: slope.lineLoads.map((l) => ({ magnitude: l.magnitude, x: l.x, angle: l.angle, y: l.y, color: l.color })),
    reinforcements: slope.reinforcements,
    piles: slope.piles,
    envelopes,
    profiles,
    pileForces,
    pileDirections: slope.piles.map((p) => [pileForceDirection(p, 0.8, -0.6), pileForceDirection(p, 0.6, 0.8), pileForceDirection(p, 1, 0)]),
    options: {
      sliceCount: slope.sliceCount, iterations: slope.iterations, tolerance: slope.tolerance, refinedIterations: slope.refinedIterations,
      maxIterations: slope.maxIterations, method: slope.method, limits: slope.limits, searchLimits: slope.searchLimits,
      minFailureDistance: slope.minFailureDistance, fixedSlices: slope.fixedSlices, customPlanesOnly: slope.customPlanesOnly,
      janbuCorrection: slope.janbuCorrection, porePressureHead: slope.porePressureHead, tensionCrackDepth: slope.tensionCrackDepth,
      tensionCrackWater: slope.tensionCrackWater, tensionCrackAngle: slope.tensionCrackAngle, tensionCrackAuto: slope.tensionCrackAuto,
      compositeSurfaces: slope.compositeSurfaces, compositeBase: slope.compositeBase, seismicHorizontal: slope.seismicHorizontal,
      seismicVertical: slope.seismicVertical, partialFactors: slope.partialFactors, nonCircularOptimization: slope.nonCircularOptimization,
      searchMethod: slope.searchMethod, blockActiveAngle: slope.blockActiveAngle, blockPassiveAngle: slope.blockPassiveAngle,
      blockSearchObjects: slope.blockSearchObjects, minSlipArea: slope.minSlipArea, groundRelief: slope.groundRelief,
      modelArea: slope.modelArea, modelHeight: slope.modelHeight, minSlipDepth: slope.minSlipDepth,
      intersliceFunction: slope.intersliceFunction, intersliceDataPoints: slope.intersliceDataPoints, mirrored: slope.mirrored,
      splitFailureCount: slope.splitFailureCount, splitFailed: slope.splitFailed, danglingBoundaries: slope.danglingBoundaries,
    },
    compositeFloor: slope.compositeFloor,
    floorFollowingBase: compositeFloor(slope.externalBoundaryXY, geoms),
    floorY: slope.compositeFloor ? xs.map((x) => [floorYAt(slope.compositeFloor!, x), floorYAt(slope.compositeFloor!, x, "right")]) : null,
    toModelX: xs.map((x) => attempt(() => slope.toModelX(x))),
    individualPlanes: slope.individualPlanes.map(planeJson),
    waternet: slope.waternet ? { headLines: slope.waternet.headLines, referenceLines: slope.waternet.referenceLines, phreaticLineId: slope.waternet.phreaticLineId } : null,
    probe,
    ground: xs.map((x) => slope.getExternalYIntersection(x)),
    waterY: xs.map((x) => attempt(() => slope.getWaterYIntersection(x))),
    circles: circles.map(([cx, cy, r]) => ({
      crossings: slope.getCircleExternalIntersection(cx, cy, r),
      ends: selectEntryExit(slope, cx, cy, r),
      leaves: circleLeavesModel(slope, cx, cy, r, cx - r, cx + r),
      bare: slope.compositeFloor ? circleBelowBareBase(slope.compositeFloor, cx, cy, r, cx - r, cx + r, 1e-6) : null,
    })),
    earlierStage: depth < 2 && slope.earlierStage ? snap(slope.earlierStage, depth + 1) : null,
    drawdownBefore: depth < 2 && slope.drawdownBefore ? snap(slope.drawdownBefore, depth + 1) : null,
  };
}

/** Surface functions on polylines from the first planes. */
function surfaceProbe(slope: Slope, planes: readonly SearchPlane[]) {
  const out = [];
  const step = Math.max(1, Math.floor(planes.length / 25));
  for (let i = 0; i < planes.length; i += step) {
    const p = planes[i];
    const poly = circleToPolyline(p.cx, p.cy, p.radius, p.lc, p.rc, 7);
    // a polyline extended beyond the ends (fitted back to the ground)
    const ext: Pt[] = [[poly[0][0] - 0.5, poly[0][1] - 1], ...poly.slice(1, -1), [poly[6][0] + 0.5, poly[6][1] - 1]];
    const fitted = fitPolylineToGround(slope, ext);
    out.push({
      poly,
      admissible: isAdmissiblePolyline(slope, poly),
      fitted,
      fittedAdmissible: fitted ? isAdmissiblePolyline(slope, fitted, Infinity) : null,
      axis: defaultAxisPoint(poly),
      corner: boundaryCornerInMass(slope, poly[0][0], poly[6][0], (x) => polylineYAt(poly, x)),
      crossings: polylineCrossingsX(poly, slope.externalBoundaryXY.x, slope.externalBoundaryXY.y, true),
      within: isPlaneWithinExternalBoundary(slope, p),
      withinCircle: isPlaneWithinExternalBoundary(slope, p, true),
    });
  }
  return out;
}

/**
 * Made-up factors of safety for the refined and local generation: a hash of
 * the plane's key, so that a plane gets the same value in both engines
 * whatever its position in the list.
 */
const fakeFos = (key: string, salt: number) => {
  let h = salt;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 1000003;
  return 1 + (h % 997) / 997;
};

/** The options that change which planes are generated. */
const generationKey = (s: Slope) => JSON.stringify([s.iterations, s.minFailureDistance, s.compositeSurfaces, s.compositeBase]);

function planesOf(slope: Slope) {
  setEntryExitPlanes(slope);
  const planes = slope.search;
  const ranked = planes.map((p) => ({ ...p, fos: fakeFos(planeKey(p), 0) }));
  const refined = generateRefinedPlanes(slope, ranked, slope.refinedIterations);
  const keys = new Set(ranked.map(planeKey));
  const local0 = generateLocalPlanes(slope, [...ranked, ...refined.map((p) => ({ ...p, fos: 0.5 + fakeFos(planeKey(p), 7) }))], 150, 0, keys);
  const local2 = generateLocalPlanes(slope, ranked, 60, 2, undefined, 2);
  return {
    planes: planes.map(planeJson),
    refined: refined.map(planeJson),
    local0: local0.map(planeJson),
    local2: local2.map(planeJson),
    keysAfter: keys.size,
    surface: surfaceProbe(slope, planes),
  };
}

it("exports the model core fixtures", () => {
  rmSync(join(FIXTURES, "model-core"), { recursive: true, force: true });
  const index: { id: string; variants: string[] }[] = [];
  for (const { id, definition } of definitions()) {
    const variants: Record<string, unknown> = {};
    const seen = new Set<string>();
    const run = (name: string, def: SlopeDefinition, options?: Partial<AnalysisOptions>, planes = true) => {
      const built = attempt(() => {
        const slope = buildSlope(def);
        if (options) slope.updateAnalysisOptions(options);
        return slope;
      });
      if ("error" in built) {
        variants[name] = { definition: def, options, error: built.error };
        return;
      }
      const slope = built.ok;
      const key = JSON.stringify(def.coordinates) + generationKey(slope);
      const withPlanes = planes && !seen.has(key);
      if (withPlanes) seen.add(key);
      variants[name] = { definition: def, options, snapshot: snap(slope), ...(withPlanes ? planesOf(slope) : {}) };
    };
    const canonical = toCanonicalSlopeDefinition(definition);
    run("canonical", canonical);
    run("rtl", toCanonicalSlopeDefinition(asRtl(definition)));
    const problem = PROBLEMS.find((p) => p.id === id);
    problem?.checks.forEach((c, k) => run(`check-${k}`, canonical, verificationOptions(c.method, c.options)));
    const n = index.length;
    if (n % 4 === 0) {
      run("composite-base", canonical, { compositeBase: true });
      run("no-composite", canonical, { compositeSurfaces: false });
    }
    if (n % 5 === 1) run("limits", canonical, { minFailureDist: 3, iterations: 600 });
    writeFixture("model-core", `def-${id}`, variants);
    index.push({ id, variants: Object.keys(variants) });
  }
  writeFixture("model-core", "index", index);
  // the FHWA pullout tables (reinforcement.test.ts)
  writeFixture("model-core", "fhwa", FHWA_PULLOUT_TABLES);

  // ── buildSlope errors (definitions JSON can carry) ──
  const base: SlopeDefinition = {
    coordinates: [[0, 0], [0, 10], [10, 10], [20, 0]],
    materials: [{ name: "A", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 } }],
  };
  const pile = { x1: 5, y1: 10, x2: 5, y2: 0, diameter: 0.5, spacing: 1.5 };
  const reinf = { x1: 2, y1: 9, x2: 12, y2: 4, tensileCapacity: 100 };
  const bad: { name: string; definition: SlopeDefinition }[] = [
    { name: "no-materials", definition: { ...base, materials: [] } },
    { name: "invalid-model", definition: { ...base, materials: [{ name: "B", model: { kind: "mohr-coulomb", unitWeight: -1, cohesion: 5, frictionAngle: 100 } }] } },
    { name: "no-model", definition: { ...base, materials: [{ name: "C", unitWeight: 18 }] } },
    { name: "unknown-region", definition: { ...base, regionAssignments: [{ point: [1, 1], materialName: "Nope" }] } },
    { name: "excess-ratio", definition: { ...base, udls: [{ magnitude: 5, x1: 1, x2: 3 }, { magnitude: 5, x1: 1, x2: 3, excessPorePressure: [{ material: "A", ratio: 1.5 }] }] } },
    { name: "circle-radius", definition: { ...base, customSearchPlanes: [{ cx: 5, cy: 20, radius: 0 }] } },
    { name: "circle-radius-neg", definition: { ...base, customSearchPlanes: [{ cx: 5.25, cy: -20, radius: -1.5e-7 }] } },
    { name: "water-one-point", definition: { ...base, waterTable: { mode: "custom", value: [[0, 5]] } } },
    { name: "water-by-id-one-point", definition: { ...base, waterTables: [{ id: "w", coordinates: [[0, 5]] }] } },
    { name: "few-coordinates", definition: { ...base, coordinates: [[0, 0], [1, 1]] } },
    { name: "reinf-capacity", definition: { ...base, reinforcements: [{ ...reinf, tensileCapacity: -1 }] } },
    { name: "reinf-end", definition: { ...base, reinforcements: [{ ...reinf, end2Capacity: -1 }] } },
    { name: "reinf-spacing", definition: { ...base, reinforcements: [{ ...reinf, spacing: 0 }] } },
    { name: "reinf-bond", definition: { ...base, reinforcements: [{ ...reinf, pullout: { kind: "bond", strength: -1 } }] } },
    { name: "reinf-bond-length", definition: { ...base, reinforcements: [{ ...reinf, pullout: { kind: "bond", strength: 1, bondedLength: -2 } }] } },
    { name: "reinf-development", definition: { ...base, reinforcements: [{ ...reinf, pullout: { kind: "development", length1: -1, length2: 1 } }] } },
    { name: "reinf-interface", definition: { ...base, reinforcements: [{ ...reinf, pullout: { kind: "interface", adhesion: 1, frictionAngle: 95 } }] } },
    { name: "reinf-coverage", definition: { ...base, reinforcements: [{ ...reinf, pullout: { kind: "interface", adhesion: 1, frictionAngle: 20, coverage: 0 } }] } },
    { name: "pile-force", definition: { ...base, piles: [{ ...pile, force: -1 }] } },
    { name: "pile-diameter", definition: { ...base, piles: [{ ...pile, diameter: 0 }] } },
    { name: "pile-stiffness", definition: { ...base, piles: [{ ...pile, bendingStiffness: 0 }] } },
    { name: "pile-angle", definition: { ...base, piles: [{ ...pile, angle: 95 }] } },
    { name: "pile-nothing", definition: { ...base, piles: [{ x1: 5, y1: 10, x2: 5, y2: 0 }] } },
    { name: "pile-inclined", definition: { ...base, piles: [{ ...pile, x2: 6 }] } },
    { name: "pile-spacing", definition: { ...base, piles: [{ ...pile, spacing: 0.5 }] } },
    { name: "pile-direction", definition: { ...base, piles: [{ ...pile, force: 3, direction: "sideways" as never }] } },
    { name: "block-empty", definition: { ...base, blockSearchObjects: [{ points: [[1, 1]] }, { points: [] }] } },
    { name: "block-line", definition: { ...base, blockSearchObjects: [{ points: [[1, 1], [1, 1]] }] } },
    { name: "block-window", definition: { ...base, blockSearchObjects: [{ points: [[1, 1], [2, 2], [3, 3]] }] } },
    { name: "fine", definition: { ...base, piles: [{ ...pile, force: 3 }], reinforcements: [reinf] } },
  ];
  writeFixture("model-core", "build-errors", bad.map(({ name, definition }) => ({ name, definition, out: attempt(() => (buildSlope(definition), "ok")) })));

  // ── setter scenarios (the Rust test runs the same steps by name) ──
  const built = () => buildSlope(base);
  const state = (s: Slope) => ({
    sliceCount: s.sliceCount, iterations: s.iterations, refinedIterations: s.refinedIterations, maxIterations: s.maxIterations,
    tolerance: s.tolerance, minFailureDistance: s.minFailureDistance, limits: s.limits, method: s.method,
    seismicHorizontal: s.seismicHorizontal, seismicVertical: s.seismicVertical, minSlipArea: s.minSlipArea,
    intersliceDataPoints: s.intersliceDataPoints, blockActiveAngle: s.blockActiveAngle,
  });
  const scenarios: Record<string, () => unknown> = {
    "boundaries-before-external": () => new Slope().setMaterialBoundaries([[[0, 1], [5, 1]]]),
    "material-boundary-1pt": () => built().setMaterialBoundary([[0, 0]]),
    "assign-non-material": () => built().assignMaterial([1, 1], {} as Material),
    "water-depth-no-boundary": () => new Slope().setWaterTable({ depth: 2 }),
    "water-height-no-boundary": () => new Slope().setWaterTable({ height: 2 }),
    "water-custom-no-boundary": () => new Slope().setWaterTable({ coordinates: [[0, 1], [10, 1]] }),
    "water-custom-no-boundary-free": () => { const s = new Slope(); s.setWaterTable({ coordinates: [[10, 1], [0, 2]], followBoundary: false }); s.setExternalBoundary(base.coordinates); return [s.waterRLXY, s.hasWaterTable]; },
    "water-not-finite": () => built().setWaterTable({ coordinates: [[0, NaN], [1, 1]] }),
    "water-one-point": () => built().setWaterTable({ coordinates: [[0, 1]] }),
    "water-by-id-infinite": () => built().setWaterTableById("w", [[0, 1], [Infinity, 1]]),
    "remove-limits-no-surface": () => new Slope().removeAnalysisLimits(),
    "external-y-no-surface": () => new Slope().getExternalYIntersection(1),
    "water-y-none": () => built().getWaterYIntersection(1),
    "circle-no-surface": () => new Slope().getCircleExternalIntersection(1, 1, 1),
    "min-fos-none": () => built().getMinFOS(),
    "max-fos-none": () => built().getMaxFOS(),
    "min-fos-circle-none": () => built().getMinFOSCircle(),
    "end-points-none": () => built().getMinFOSEndPoints(),
    "to-model-x-no-boundary": () => { const s = new Slope(); s.setMirrored(true); return s.toModelX(1); },
    "to-model-circle-points": () => built().toModelCircle({ cx: 1, cy: 2, radius: 3, points: [[0, 0]] }),
    "few-coordinates": () => new Slope().setExternalBoundary([[0, 0], [1, 1]]),
    "boundaries-nan-vertex": () => {
      const s = new Slope();
      s.setExternalBoundary([[NaN, 0], [0, 10], [10, 10], [20, 0]]);
      s.setMaterialBoundaries([[[0, 5], [20, 5]]]);
      return s.materialGeometries.length;
    },
    "slices-nan": () => built().updateAnalysisOptions({ slices: NaN }),
    "iterations-inf": () => built().updateAnalysisOptions({ iterations: Infinity }),
    "refined-nan": () => built().updateAnalysisOptions({ refinedIterations: NaN }),
    "max-iterations-nan": () => built().updateAnalysisOptions({ maxIterations: NaN }),
    "tolerance-nan": () => built().updateAnalysisOptions({ tolerance: NaN }),
    "min-failure-nan": () => built().updateAnalysisOptions({ minFailureDist: -Infinity }),
    "tolerance-zero": () => built().updateAnalysisOptions({ tolerance: 0 }),
    "crack-depth": () => built().updateAnalysisOptions({ tensionCrackDepth: -1 }),
    "crack-depth-nan": () => built().updateAnalysisOptions({ tensionCrackDepth: NaN }),
    "seismic-h": () => built().updateAnalysisOptions({ seismicHorizontal: 2 }),
    "seismic-v": () => built().updateAnalysisOptions({ seismicVertical: NaN }),
    "crack-angle": () => built().updateAnalysisOptions({ tensionCrackAngle: 90 }),
    "crack-angle-neg": () => built().updateAnalysisOptions({ tensionCrackAngle: -1 }),
    "crack-water": () => built().updateAnalysisOptions({ tensionCrackWater: 1.5 }),
    "block-active": () => built().updateAnalysisOptions({ blockActiveAngle: [0, 10] }),
    "block-passive": () => built().updateAnalysisOptions({ blockPassiveAngle: [50, 40] }),
    "block-active-90": () => built().updateAnalysisOptions({ blockActiveAngle: [10, 90] }),
    "min-slip-depth": () => built().updateAnalysisOptions({ minSlipDepth: -1 }),
    "min-slip-area": () => built().updateAnalysisOptions({ minSlipArea: -1 }),
    "partial-factors": () => built().updateAnalysisOptions({ partialFactors: { cu: 0, cohesion: 1, tanPhi: 1, variableLoad: 1 } }),
    "partial-factors-nan": () => built().updateAnalysisOptions({ partialFactors: { cu: 1, cohesion: 1, tanPhi: NaN, variableLoad: 1 } }),
    "partial-midway": () => { const s = built(); const r = attempt(() => s.updateAnalysisOptions({ slices: 33, method: "Janbu", seismicHorizontal: 0.1, tensionCrackWater: 3 })); return [r, state(s)]; },
    "clamps": () => {
      const s = built();
      const out = [];
      for (const o of [{ slices: 3.6 }, { slices: 600 }, { slices: 20.5 }, { slices: -20.5 }, { iterations: 1 }, { iterations: 1e9 }, { maxIterations: 2 }, { minFailureDist: 1000 }, { minFailureDist: -3 }, { refinedIterations: -5 }, { minSlipArea: null }, { minSlipArea: 2 }, { intersliceDataPoints: [[0, 0], [0.5, NaN], [1, 1]] as Pt[] }, { blockActiveAngle: [20, 30] as [number, number] }, { blockActiveAngle: null }]) {
        s.updateAnalysisOptions(o as Partial<AnalysisOptions>);
        out.push(state(s));
      }
      return out;
    },
    "limits": () => {
      const s = built();
      const out = [];
      for (const l of [{ entryLeftX: 5 }, { exitLeftX: 9, exitRightX: 3 }, { entryRightX: 1 }, { exitRightX: 2 }]) {
        s.setAnalysisLimits(l);
        out.push([s.limits, s.searchLimits]);
      }
      s.removeAnalysisLimits();
      out.push([s.limits, s.searchLimits]);
      return out;
    },
    "search-limits-corner": () => {
      const s = built();
      s.setAnalysisLimits({ entryLeftX: 10, entryRightX: 10, exitLeftX: 10, exitRightX: 15 });
      return [s.limits, s.searchLimits];
    },
    "drawdown-options": () => {
      const s = buildSlope({ ...base, rapidDrawdown: { waterBefore: [[0, 8], [20, 8]] } });
      s.updateAnalysisOptions({ slices: 40, seismicHorizontal: 0.1, method: "Janbu" });
      const b = s.drawdownBefore!;
      const before = [b.sliceCount, b.seismicHorizontal, b.method, b.minFailureDistance];
      const r = attempt(() => s.updateAnalysisOptions({ tensionCrackDepth: -1 }));
      return [before, r, state(s), state(b)];
    },
    "single-entry-exit": () => {
      const s = built();
      addSingleEntryExitPlane(s, 2, 18, 4);
      addSingleCircularPlane(s, 10, 25, 20);
      addSingleCircularPlane(s, 100, 100, 1);
      return s.individualPlanes.map(planeJson);
    },
    "generate-planes": () => {
      const s = built();
      return [generatePlanes(s, [2, 10], [18, 2]).map(planeJson), generatePlanes(s, [1, 10], [19, 1], 9).map(planeJson)];
    },
    "ito-matsui": () => [[1, 0.5, 0], [1, 0.5, 0.005], [1, 0.5, 10], [0.6, 0.6, 30], [2, 0.3, 45]].map(([a, b, c]) => itoMatsuiCoefficients(a, b, c)),
    "mirrored-interslice": () => {
      const s = built();
      s.updateAnalysisOptions({ intersliceDataPoints: [[0, 0.2], [0.3, 1], [1, 0.5]] });
      s.setMirrored(true);
      return [s.intersliceDataPoints, s.toModelX(3), s.toModelCircle({ cx: 4, cy: 20, radius: 15 })];
    },
    "material-boundary": () => {
      const s = built();
      const a = s.setMaterialBoundary([[0, 5], [15, 5]]);
      const b = s.setMaterialBoundary([[30, 30], [31, 31]]);
      return [a, b, s.materialGeometries.map((g) => [g.px, g.py]), s.splitFailureCount];
    },
    "udls-lls": () => {
      const s = built();
      s.removeUdls();
      s.removeLineLoads();
      s.addFixedSlices([1, 2, 3]);
      return [s.udls.length, s.lineLoads.length, s.fixedSlices];
    },
  };
  writeFixture("model-core", "scenarios", Object.entries(scenarios).map(([name, f]) => ({ name, out: attempt(f) })));
});
