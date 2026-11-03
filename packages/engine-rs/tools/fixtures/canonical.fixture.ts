// Fixtures for model/canonical.ts and model/waternet.ts: canonical
// definitions (as given, mirrored to right-to-left, the opposite direction)
// of every verification problem, reliability case and app example, a
// definition with every field, results mapped to model space, and waternet
// pore pressures on a grid. Run under Node:
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts canonical
import { writeFixture } from "./write";
import { PROBLEMS } from "../../../engine/src/verification/problems";
import { RELIABILITY_CASES } from "../../../engine/src/verification/reliability-cases";
import {
  getDomainX,
  inferOrientationFromCoordinates,
  mapAnalysisResultToModelSpace,
  mirrorLimits,
  mirrorPoints,
  mirrorX,
  oppositeDirectionDefinition,
  toCanonicalSlopeDefinition,
} from "../../../engine/src/model/canonical";
import { waternetPorePressure, type Waternet } from "../../../engine/src/model/waternet";
import { Material } from "../../../engine/src/types/material";
import type { AnalysisResult } from "../../../engine/src/types/analysis";
import type { SlopeDefinition } from "../../../engine/src/types/slope-definition";
import { BENCHMARK_MODELS } from "../../../desktop/src/store/benchmarks";
import { buildSlopeDTOFromModel } from "../../../desktop/src/store/helpers";

const attempt = <T>(f: () => T) => {
  try {
    return { ok: f() };
  } catch (e) {
    return { error: (e as Error).message };
  }
};

/** A right-to-left model with every field that is mirrored. */
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
    { name: "Spatial", model: { kind: "spatial-mohr-coulomb", unitWeight: 18, dataPoints: [[5, -5, 10, 30, 18], [35, -5, 12, 28, 19]] } },
  ],
  waterTable: { mode: "custom", value: [[0, -1], [20, 2], [40, 8]], followBoundary: false },
  waterTables: [{ id: "p2", coordinates: [[0, -3], [40, 5]], followBoundary: true }],
  udls: [{ magnitude: 10, x1: 30, x2: 36, direction: "normal", excessPorePressure: [{ material: "Clay", ratio: 0.4 }] }, { magnitude: 5, x1: 38, x2: 32 }],
  lineLoads: [{ magnitude: 50, x: 35, angle: 20, y: 11 }, { magnitude: 20, x: 33, angle: 0 }, { magnitude: 20, x: 31, angle: NaN }, { magnitude: 7, x: 30 }],
  rapidDrawdown: { waterBefore: [[0, 5], [40, 9]] },
  waternet: {
    headLines: [{ id: "h1", points: [[0, 2], [40, 8]] }, { id: "h2", points: [[0, 0], [20, 1], [40, 3]] }],
    referenceLines: [{ points: [[0, -4], [40, -2]], topHeadLineId: "h1", bottomHeadLineId: "h2" }, { points: [[0, -8], [40, -8]], bottomHeadLineId: "h2" }],
    phreaticLineId: "h1",
  },
  reinforcements: [{ x1: 24, y1: 9, x2: 34, y2: 4, tensileCapacity: 100, spacing: 2, pullout: { kind: "bond", strength: 20, bondedLength: 4 }, direction: "tangent", application: "passive", prestress: 10 }],
  piles: [{ x1: 30, y1: 10, x2: 30, y2: -6, diameter: 0.6, spacing: 1.5, angle: 10, direction: "angle", location: "slip-surface", wall: false }],
  materialBoundaries: [{ coordinates: [[0, -3], [40, 3]], materialName: "" }, { coordinates: [[0, -6], [40, -6]], materialName: "Spatial" }],
  topRegionMaterialName: "Fill",
  regionAssignments: [{ point: [38, 9], materialName: "Fill" }, { point: [20, -1], materialName: "Clay" }],
  analysisLimits: { entryLeftX: 26, entryRightX: 38, exitLeftX: 2, exitRightX: 14 },
  customSearchPlanes: [{ cx: 18, cy: 22, radius: 20 }],
  customSurfaces: [{ points: [[30, 10], [20, -2], [10, 0]], axis: [21, 23] }, { points: [[28, 10], [12, 0]] }],
  customPlanesOnly: false,
  blockSearchObjects: [{ points: [[20, -3]] }, { points: [[10, -2], [14, -2]] }],
};
const STAGED: SlopeDefinition = { ...FULL, earlierStage: { ...FULL, coordinates: [[5, -10], [5, 0], [15, 0], [20, 12], [35, 12], [35, -10]], earlierStage: undefined } };

function definitions(): { id: string; definition: SlopeDefinition }[] {
  const out = PROBLEMS.map((p) => ({ id: p.id, definition: p.definition }));
  RELIABILITY_CASES.forEach((c, i) => out.push({ id: `reliability-${i}`, definition: c.definition }));
  BENCHMARK_MODELS.forEach((m, i) => out.push({ id: `app-${i}`, definition: buildSlopeDTOFromModel(m) }));
  out.push({ id: "full", definition: FULL }, { id: "staged", definition: STAGED }, { id: "full-ltr", definition: { ...FULL, orientation: "ltr" } });
  out.push({ id: "no-model", definition: { coordinates: [[0, 0], [0, 5], [10, 10], [10, 0]], materials: [{ name: "X", unitWeight: 18 }] } });
  return out;
}

/** The definition as a right-to-left model: mirrored outline, the same other fields. */
function asRtl(d: SlopeDefinition): SlopeDefinition {
  const [x0, x1] = getDomainX(d.coordinates);
  return { ...d, orientation: "rtl", coordinates: mirrorPoints(d.coordinates, x0, x1) };
}

function result(): AnalysisResult {
  const mat = new Material({ name: "Clay", color: "#abc", cohesion: 5 });
  return {
    minFOS: 1.2,
    maxFOS: 2,
    criticalSurface: {
      cx: 10, cy: 20, radius: 0, fos: 1.2, entryPoint: [5, 10], exitPoint: [30, 0], points: [[5, 10], [15, 2], [30, 0]], converged: true,
      reinforcementForces: [{ index: 0, x: 12, y: 4, fx: 30, fy: 5, force: 30.4, passive: false }], crack: { x: 5, top: 11, bottom: 10 }, lffArray: [[0, 1, 1.1, 0.1]],
    },
    allSurfaces: [
      { cx: 10, cy: 20, radius: 0, fos: 1.2, entryPoint: [5, 10], exitPoint: [30, 0], points: [[5, 10], [30, 0]] },
      { cx: 12.25, cy: 21.5, radius: 18.3, fos: 1.4, entryPoint: [6, 10], exitPoint: [29, 0], composite: true },
    ],
    criticalSlices: [0, 1, 2].map((i) => ({
      x: 5.5 + i, xLeft: 5 + i, xRight: 6 + i, width: 1, yTop: 10, yBottom: 2, height: 8, area: 8, alpha: 0.3, baseLength: 1.05, weight: 150, surfaceLoad: 3,
      cohesion: 5, frictionAngle: 30, normalForce: 120, porePressure: 4, baseMaterial: mat,
    })),
    method: "Bishop",
    elapsedMs: 1,
    warnings: [{ code: "low-m-alpha", message: "m" }],
    slidingDirection: "ltr",
    otherDirectionMinFOS: null,
  };
}

it("exports the canonical and waternet fixtures", () => {
  const cases = definitions().map(({ id, definition }) => {
    const canonical = attempt(() => toCanonicalSlopeDefinition(definition));
    const rtl = asRtl(definition);
    const canonicalRtl = attempt(() => toCanonicalSlopeDefinition(rtl));
    return {
      id,
      definition,
      orientation: inferOrientationFromCoordinates(definition.coordinates),
      domain: getDomainX(definition.coordinates),
      canonical,
      opposite: "ok" in canonical ? attempt(() => oppositeDirectionDefinition(canonical.ok)) : null,
      rtl,
      canonicalRtl,
      oppositeRtl: "ok" in canonicalRtl ? attempt(() => oppositeDirectionDefinition(canonicalRtl.ok)) : null,
      axis: attempt(() => toCanonicalSlopeDefinition(rtl, [-100, 250])),
    };
  });
  writeFixture("canonical", "definitions", cases);

  const r = result();
  const ltrDef = FULL.coordinates;
  const maps = [
    { canonical: { ...FULL, orientation: "rtl" }, result: r },
    { canonical: { ...FULL, orientation: "ltr" }, result: r },
    { canonical: { coordinates: ltrDef, materials: [] }, result: r },
    { canonical: { coordinates: asRtl(FULL).coordinates, materials: [] }, result: r },
    { canonical: { ...FULL, orientation: "rtl" }, result: { ...r, criticalSurface: null } },
    { canonical: { ...FULL, orientation: "rtl" }, result: { ...r, criticalSurface: { ...r.criticalSurface!, points: undefined, reinforcementForces: undefined, crack: undefined } } },
  ].map(({ canonical, result }) => ({ canonical, result, out: mapAnalysisResultToModelSpace(result, canonical as SlopeDefinition) }));
  const limits = [[30, 35, 5, 12], [0, 40, 0, 40], [12, 3, 50, -5]].map(([a, b, c, d]) => {
    const l = { entryLeftX: a, entryRightX: b, exitLeftX: c, exitRightX: d };
    return { limits: l, out: mirrorLimits(l, 0, 40), x: mirrorX(a, -3.5, 41.25) };
  });
  writeFixture("canonical", "results", { maps, limits });

  // ── waternet ──
  const waternets: Waternet[] = [
    FULL.waternet!,
    ...PROBLEMS.filter((p) => p.definition.waternet).map((p) => p.definition.waternet!),
    { headLines: [{ id: "a", points: [[0, 5]] }], referenceLines: [{ points: [[0, 0], [10, 0]], topHeadLineId: "a" }] },
    { headLines: [{ id: "p", points: [[0, 3], [10, 3]] }], referenceLines: [{ points: [[0, 0], [10, 0]] }, { points: [[2, 1]], topHeadLineId: "p" }], phreaticLineId: "p" },
    { headLines: [], referenceLines: [{ points: [[0, 0], [10, 0]], topHeadLineId: "missing" }], phreaticLineId: "missing" },
    { headLines: [{ id: "h", points: [[0, -2], [5, 6], [5, 2], [10, 4]] }, { id: "h", points: [[0, 100]] }], referenceLines: [{ points: [[0, 1], [10, -1]], bottomHeadLineId: "h" }, { points: [[0, 1], [10, -1]], topHeadLineId: "h" }] },
  ];
  const waternet = waternets.map((wn) => {
    const xs = [...wn.headLines, ...wn.referenceLines].flatMap((l) => l.points.map((p) => p[0]));
    const zs = [...wn.headLines, ...wn.referenceLines].flatMap((l) => l.points.map((p) => p[1]));
    const [x0, x1] = xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 10];
    const [z0, z1] = zs.length ? [Math.min(...zs), Math.max(...zs)] : [0, 10];
    const at = [];
    for (let i = 0; i <= 12; i++)
      for (let j = 0; j <= 12; j++) {
        const x = x0 - 2 + ((x1 - x0 + 4) * i) / 12, z = z0 - 3 + ((z1 - z0 + 6) * j) / 12;
        at.push({ x, z, u: waternetPorePressure(wn, x, z) });
      }
    for (const l of wn.referenceLines) for (const [x, z] of l.points) at.push({ x, z, u: waternetPorePressure(wn, x, z) });
    return { waternet: wn, at };
  });
  writeFixture("canonical", "waternet", waternet);
});
