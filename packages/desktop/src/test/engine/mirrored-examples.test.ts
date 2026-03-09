import { describe, expect, it } from "vitest";
import { EXAMPLE_MODELS, mirrorModelEntry } from "../../store/benchmarks";
import type { ModelEntry } from "../../store/types";
import type { SlopeDefinition } from "@cslope/engine";
import {
  analyseSlope,
  buildSlope,
  getDomainX,
  mapAnalysisResultToModelSpace,
  mirrorX,
  toCanonicalSlopeDefinition,
} from "@cslope/engine";
import { computeRegions, findMaterialBelowBoundary } from "../../utils/regions";

function modelToSlopeDefinition(model: ModelEntry): SlopeDefinition {
  const materials = model.materials;
  const slope: SlopeDefinition = {
    orientation: model.orientation,
    coordinates: model.coordinates,
    materials: materials.map((material) => ({
      name: material.name,
      unitWeight: material.unitWeight,
      frictionAngle: material.frictionAngle,
      cohesion: material.cohesion,
      color: material.color,
      depthRange: material.depthRange,
      model: material.model,
    })),
  };

  if (model.materialBoundaries.length > 0) {
    const defaultMaterialId = materials[0]?.id ?? "";
    const regions = computeRegions(
      model.coordinates,
      model.materialBoundaries,
      model.regionMaterials,
      defaultMaterialId,
    );

    slope.materialBoundaries = model.materialBoundaries.map((boundary) => {
      const materialId = findMaterialBelowBoundary(
        boundary,
        regions,
        defaultMaterialId,
      );
      const materialName =
        materials.find((material) => material.id === materialId)?.name ??
        materials[0]?.name ??
        "";
      return {
        coordinates: boundary.coordinates,
        materialName,
      };
    });

    const topRegion = regions.find((region) => region.regionKey === "top");
    if (topRegion && topRegion.materialId !== defaultMaterialId) {
      const topMaterialName = materials.find(
        (material) => material.id === topRegion.materialId,
      )?.name;
      if (topMaterialName) {
        slope.topRegionMaterialName = topMaterialName;
      }
    }
  }

  if (model.analysisLimits.enabled) {
    slope.analysisLimits = {
      entryLeftX: model.analysisLimits.entryLeftX,
      entryRightX: model.analysisLimits.entryRightX,
      exitLeftX: model.analysisLimits.exitLeftX,
      exitRightX: model.analysisLimits.exitRightX,
    };
  }

  if (model.piezometricLine.lines.length > 0) {
    const firstLine = model.piezometricLine.lines[0];
    if (firstLine.coordinates.length >= 2) {
      slope.waterTable = {
        mode: "custom",
        value: firstLine.coordinates,
      };
    }
  }

  if (model.udls.length > 0) {
    slope.udls = model.udls.map((udl) => ({
      magnitude: udl.magnitude,
      x1: udl.x1,
      x2: udl.x2,
    }));
  }

  if (model.lineLoads.length > 0) {
    slope.lineLoads = model.lineLoads.map((lineLoad) => ({
      magnitude: lineLoad.magnitude,
      x: lineLoad.x,
    }));
  }

  return slope;
}

function analyseExample(model: ModelEntry) {
  const originalDefinition = modelToSlopeDefinition(model);
  const canonicalDefinition = toCanonicalSlopeDefinition(originalDefinition);
  const slope = buildSlope(canonicalDefinition);

  slope.updateAnalysisOptions({
    ...model.options,
  });

  analyseSlope(slope);

  const critical = slope.search.find((surface) => surface.fos != null);
  if (!critical || critical.fos == null) {
    throw new Error("No valid critical surface found in example analysis");
  }

  const criticalWithFos = {
    ...critical,
    fos: critical.fos,
  };

  return {
    model,
    canonicalDefinition,
    minFos: slope.getMinFOS(),
    critical: criticalWithFos,
  };
}

describe("Mirrored example parity", () => {
  const tolerance = 0.01;
  const baseExamples = EXAMPLE_MODELS.filter(
    (model) => model.orientation === "ltr",
  );
  const mirroredPairs = baseExamples.map((model) => ({
    ltr: model,
    rtl: mirrorModelEntry(model),
  }));

  const runCache = new Map<string, ReturnType<typeof analyseExample>>();

  const getRun = (model: ModelEntry) => {
    const cached = runCache.get(model.id);
    if (cached) return cached;
    const run = analyseExample(model);
    runCache.set(model.id, run);
    return run;
  };

  it("baseline and mirrored examples analyse with valid minimum FOS", () => {
    expect(mirroredPairs.length).toBeGreaterThan(0);

    for (const { ltr, rtl } of mirroredPairs) {
      const ltrRun = getRun(ltr);
      const rtlRun = getRun(rtl);

      expect(ltrRun.minFos, `ltr=${ltr.id}`).toBeGreaterThan(0.3);
      expect(ltrRun.minFos, `ltr=${ltr.id}`).toBeLessThan(5.0);

      expect(rtlRun.minFos, `rtl=${rtl.id}`).toBeGreaterThan(0.3);
      expect(rtlRun.minFos, `rtl=${rtl.id}`).toBeLessThan(5.0);
    }
  }, 60_000);

  it("mirrored examples produce equivalent minimum FOS", () => {
    for (const { ltr, rtl } of mirroredPairs) {
      const ltrRun = getRun(ltr);
      const rtlRun = getRun(rtl);

      expect(Math.abs(ltrRun.minFos - rtlRun.minFos)).toBeLessThanOrEqual(
        tolerance,
      );
    }
  }, 60_000);

  it("critical surfaces mirror correctly in model space", () => {
    for (const { ltr, rtl } of mirroredPairs) {
      const ltrRun = getRun(ltr);
      const rtlRun = getRun(rtl);

      const ltrResultModelSpace = mapAnalysisResultToModelSpace(
        {
          minFOS: ltrRun.minFos,
          maxFOS: ltrRun.minFos,
          criticalSurface: {
            cx: ltrRun.critical.cx,
            cy: ltrRun.critical.cy,
            radius: ltrRun.critical.radius,
            fos: ltrRun.critical.fos,
            entryPoint: ltrRun.critical.lc,
            exitPoint: ltrRun.critical.rc,
          },
          allSurfaces: [],
          criticalSlices: [],
          method: ltr.options.method,
          elapsedMs: 0,
        },
        ltrRun.canonicalDefinition,
      );

      const rtlResultModelSpace = mapAnalysisResultToModelSpace(
        {
          minFOS: rtlRun.minFos,
          maxFOS: rtlRun.minFos,
          criticalSurface: {
            cx: rtlRun.critical.cx,
            cy: rtlRun.critical.cy,
            radius: rtlRun.critical.radius,
            fos: rtlRun.critical.fos,
            entryPoint: rtlRun.critical.lc,
            exitPoint: rtlRun.critical.rc,
          },
          allSurfaces: [],
          criticalSlices: [],
          method: rtl.options.method,
          elapsedMs: 0,
        },
        rtlRun.canonicalDefinition,
      );

      const ltrCritical = ltrResultModelSpace.criticalSurface;
      const rtlCritical = rtlResultModelSpace.criticalSurface;

      expect(ltrCritical).not.toBeNull();
      expect(rtlCritical).not.toBeNull();
      if (!ltrCritical || !rtlCritical) continue;

      const [xMin, xMax] = getDomainX(ltr.coordinates);

      expect(
        Math.abs(rtlCritical.cx - mirrorX(ltrCritical.cx, xMin, xMax)),
      ).toBeLessThanOrEqual(tolerance);

      expect(Math.abs(rtlCritical.cy - ltrCritical.cy)).toBeLessThanOrEqual(
        tolerance,
      );

      expect(
        Math.abs(rtlCritical.radius - ltrCritical.radius),
      ).toBeLessThanOrEqual(tolerance);

      expect(Math.abs(rtlCritical.fos - ltrCritical.fos)).toBeLessThanOrEqual(
        tolerance,
      );

      expect(
        Math.abs(
          rtlCritical.entryPoint[0] -
            mirrorX(ltrCritical.entryPoint[0], xMin, xMax),
        ),
      ).toBeLessThanOrEqual(tolerance);

      expect(
        Math.abs(rtlCritical.entryPoint[1] - ltrCritical.entryPoint[1]),
      ).toBeLessThanOrEqual(tolerance);

      expect(
        Math.abs(
          rtlCritical.exitPoint[0] -
            mirrorX(ltrCritical.exitPoint[0], xMin, xMax),
        ),
      ).toBeLessThanOrEqual(tolerance);

      expect(
        Math.abs(rtlCritical.exitPoint[1] - ltrCritical.exitPoint[1]),
      ).toBeLessThanOrEqual(tolerance);
    }
  }, 60_000);
});
