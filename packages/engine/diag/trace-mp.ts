/**
 * Diagnostic: trace Morgenstern-Price lambda convergence on Talbingo single circle.
 *
 * Uses the EXACT benchmark model definition from benchmarks.ts and the same
 * buildSlopeFromModel conversion pipeline the desktop app uses.
 */
import {
  buildSlope,
  analyseSlope,
  analyseMorgensternPrice,
  analyseBishop,
  analyseJanbu,
  toCanonicalSlopeDefinition,
} from "../src/index";
import type { SlopeDefinition } from "../src/types/index";

// ── Import the benchmark model directly ──────────────────────────
import { EXAMPLE_MODELS } from "../../desktop/src/store/benchmarks";
import {
  computeRegions,
  findMaterialBelowBoundary,
} from "../../desktop/src/utils/regions";

const model = EXAMPLE_MODELS.find(
  (m) => m.id === "example-talbingo-dam-single",
)!;
if (!model) throw new Error("Talbingo Dam Single Circle benchmark not found");

console.log("Model:", model.name);
console.log("Orientation:", model.orientation);
console.log("Custom planes:", model.customSearchPlanes);

// ── Convert ModelEntry → SlopeDefinition (same as desktop app) ──

function buildSlopeDefFromModel(
  model: (typeof EXAMPLE_MODELS)[number],
): SlopeDefinition {
  const materials = model.materials ?? [];
  const slopeDef: SlopeDefinition = {
    orientation: model.orientation ?? "ltr",
    coordinates: model.coordinates,
    materials: materials.map((m) => ({
      name: m.name,
      unitWeight: m.unitWeight,
      frictionAngle: m.frictionAngle,
      cohesion: m.cohesion,
      color: m.color,
    })),
    customSearchPlanes: model.customSearchPlanes?.map((p) => ({
      cx: p.cx,
      cy: p.cy,
      radius: p.radius,
    })),
    customPlanesOnly: model.customPlanesOnly,
  };

  if (model.materialBoundaries?.length) {
    const defaultMatId = materials[0]?.id ?? "";
    const regions = computeRegions(
      model.coordinates,
      model.materialBoundaries,
      model.regionMaterials,
      defaultMatId,
    );

    slopeDef.materialBoundaries = model.materialBoundaries.map((b) => {
      const matId = findMaterialBelowBoundary(b, regions, defaultMatId);
      const matName =
        materials.find((m) => m.id === matId)?.name ?? materials[0]?.name ?? "";
      return { coordinates: b.coordinates, materialName: matName };
    });

    const topRegion = regions.find((r) => r.regionKey === "top");
    if (topRegion && topRegion.materialId !== defaultMatId) {
      const topMatName = materials.find(
        (m) => m.id === topRegion.materialId,
      )?.name;
      if (topMatName) slopeDef.topRegionMaterialName = topMatName;
    }
  }

  if (model.analysisLimits?.enabled) {
    slopeDef.analysisLimits = {
      entryLeftX: model.analysisLimits.entryLeftX,
      entryRightX: model.analysisLimits.entryRightX,
      exitLeftX: model.analysisLimits.exitLeftX,
      exitRightX: model.analysisLimits.exitRightX,
    };
  }

  if (model.piezometricLine?.lines?.length) {
    const firstLine = model.piezometricLine.lines[0];
    if (firstLine.coordinates.length >= 2) {
      slopeDef.waterTable = { mode: "custom", value: firstLine.coordinates };
    }
  }

  if (model.udls?.length) {
    slopeDef.udls = model.udls.map((u) => ({
      magnitude: u.magnitude,
      x1: u.x1,
      x2: u.x2,
    }));
  }

  if (model.lineLoads?.length) {
    slopeDef.lineLoads = model.lineLoads.map((l) => ({
      magnitude: l.magnitude,
      x: l.x,
    }));
  }

  return toCanonicalSlopeDefinition(slopeDef);
}

// ── Build the slope the same way the app does ────────────────────

const slopeDef = buildSlopeDefFromModel(model);
console.log("\nCanonical cx:", slopeDef.customSearchPlanes?.[0]?.cx);

// Print material boundary assignments to verify
console.log("\nMaterial boundary assignments:");
for (const b of slopeDef.materialBoundaries ?? []) {
  console.log(`  ${b.materialName}: ${b.coordinates.length} pts`);
}
console.log(
  "Top region material:",
  slopeDef.topRegionMaterialName ?? "(default)",
);

const slope = buildSlope(slopeDef);
slope.updateAnalysisOptions({
  ...(model.options ?? {}),
  method: "Morgenstern-Price",
});

// ════════════════════════════════════════════════════════════════
// PHASE 1: Verify Slip Surface Geometry
// ════════════════════════════════════════════════════════════════

console.log("\n╔══════════════════════════════════════════╗");
console.log("║  PHASE 1: Slip Surface Geometry Check    ║");
console.log("╚══════════════════════════════════════════╝");

const origCx = model.customSearchPlanes![0].cx;
const origCy = model.customSearchPlanes![0].cy;
const origR = model.customSearchPlanes![0].radius;
const mirCx = slopeDef.customSearchPlanes![0].cx;

console.log("\n── 1.1 Mirroring ──");
console.log(`  Original (RTL):  cx=${origCx}, cy=${origCy}, R=${origR}`);
console.log(`  Mirrored (LTR):  cx=${mirCx}, cy=${origCy}, R=${origR}`);

console.log("\n── 1.2 Surface line ──");
const surfXY = slope.surfaceLineXY;
if (surfXY) {
  console.log(
    `  ${surfXY.x.length} points, X: [${Math.min(...surfXY.x).toFixed(1)}, ${Math.max(...surfXY.x).toFixed(1)}]`,
  );
  for (let i = 0; i < surfXY.x.length; i++) {
    console.log(
      `    [${i}] (${surfXY.x[i].toFixed(2)}, ${surfXY.y[i].toFixed(2)})`,
    );
  }
}

console.log("\n── 1.3 Circle–surface intersections ──");
const allInts = slope.getCircleExternalIntersection(mirCx, origCy, origR);
console.log(`  Found ${allInts.length} intersection(s):`);
for (const [i, pt] of allInts.entries()) {
  console.log(`    [${i}] x=${pt[0].toFixed(4)}, y=${pt[1].toFixed(4)}`);
}

console.log("\n── 1.4 SearchPlane geometry ──");
const indPlanes = slope.individualPlanes;
console.log(`  individualPlanes: ${indPlanes.length}`);
if (indPlanes.length > 0) {
  const p = indPlanes[0];
  console.log(`    lc (entry): (${p.lc[0].toFixed(4)}, ${p.lc[1].toFixed(4)})`);
  console.log(`    rc (exit):  (${p.rc[0].toFixed(4)}, ${p.rc[1].toFixed(4)})`);
  console.log(`    cx=${p.cx}, cy=${p.cy}, R=${p.radius}`);
  console.log(`    Arc span: ${(p.rc[0] - p.lc[0]).toFixed(2)}`);
}

// ════════════════════════════════════════════════════════════════
// Run analysis
// ════════════════════════════════════════════════════════════════

console.log("\n╔══════════════════════════════════════════╗");
console.log("║  Analysis Results                        ║");
console.log("╚══════════════════════════════════════════╝");

const fos = analyseSlope(slope);
console.log("\nanalyseSlope FOS:", fos, "(published: 2.29)");

const results = slope.search;
const critPlane = results[0];

if (critPlane?.lffArray) {
  console.log("\nlffArray (lambda, Fm, Ff, gap):");
  for (const row of critPlane.lffArray) {
    console.log(
      `  λ=${row[0].toFixed(4)}  Fm=${row[1].toFixed(4)}  Ff=${row[2].toFixed(4)}  gap=${row[3].toFixed(4)}`,
    );
  }
}

if (critPlane?.slices) {
  const slices = critPlane.slices;
  console.log("\n# slices:", slices.length);

  // Moment arm consistency
  console.log("\n── Moment arm consistency ──");
  let sumWdx = 0,
    sumWRsinA = 0,
    totalPush = 0,
    totalResist = 0;
  for (const s of slices) {
    const W = s.weight + s.udl + s.ll;
    sumWdx += W * s.dx;
    sumWRsinA += W * s.R * Math.sin(s.alpha);
    totalPush += W * Math.sin(s.alpha);
    totalResist +=
      s.cohesion * s.baseLength +
      Math.max(0, W * Math.cos(s.alpha) - s.U * s.baseLength) * Math.tan(s.phi);
  }
  console.log(`  Σ W×dx       = ${sumWdx.toFixed(2)}`);
  console.log(`  Σ W×R×sin(α) = ${sumWRsinA.toFixed(2)}`);
  console.log(`  Ratio        = ${(sumWdx / sumWRsinA).toFixed(6)}`);

  console.log(
    `\n  Ordinary FOS = ${totalPush > 0 ? (totalResist / totalPush).toFixed(4) : "null"}`,
  );

  // Bishop & Janbu comparison
  const [bishopFOS] = analyseBishop(slope, slices);
  const [janbuFOS] = analyseJanbu(slope, slices);
  console.log(`  Bishop FOS   = ${bishopFOS?.toFixed(4)} (= Fm at λ=0)`);
  console.log(`  Janbu FOS    = ${janbuFOS?.toFixed(4)} (= Ff at λ=0)`);

  // Per-slice detail
  console.log("\n── Per-slice detail ──");
  console.log(
    "  i  |    x     |   α(°)   |    dx    |    bl    |     W     |   c    |  φ(°) |   U    | material",
  );
  console.log(
    "  ---|----------|----------|---------|---------|-----------|--------|-------|--------|----------",
  );
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    console.log(
      `  ${String(i).padStart(2)} | ${s.x.toFixed(2).padStart(8)} | ${((s.alpha * 180) / Math.PI).toFixed(2).padStart(8)} | ${s.dx.toFixed(2).padStart(7)} | ${s.baseLength.toFixed(2).padStart(7)} | ${s.weight.toFixed(1).padStart(9)} | ${s.cohesion.toFixed(1).padStart(6)} | ${s.frictionAngle.toFixed(1).padStart(5)} | ${s.U.toFixed(2).padStart(6)} | ${s.baseMaterial?.name ?? "??"}`,
    );
  }

  // Direct M-P call
  console.log("\nDirect analyseMorgensternPrice:");
  const [mpFos, lff, , , converged] = analyseMorgensternPrice(slope, slices);
  console.log(`  FOS: ${mpFos} converged: ${converged}`);
  if (lff) {
    for (const row of lff) {
      console.log(
        `  λ=${row[0].toFixed(4)}  Fm=${row[1].toFixed(4)}  Ff=${row[2].toFixed(4)}  gap=${row[3].toFixed(4)}`,
      );
    }
  }
}
