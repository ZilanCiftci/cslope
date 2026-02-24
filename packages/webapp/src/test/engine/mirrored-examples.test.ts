import { describe, expect, it } from "vitest";
import { EXAMPLE_MODELS } from "../../store/examples";
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

  const critical = slope.search[0];

  return {
    model,
    canonicalDefinition,
    minFos: slope.getMinFOS(),
    critical,
  };
}

describe("Mirrored example parity", () => {
  const tolerance = 0.01;

  it.skip("mirrored examples produce equivalent minimum FOS", () => {
    // Skipped: auto-mirrored examples (id ending with "-rtl") are commented out in examples.ts.
    // Re-enable when mirrorModelEntry calls are uncommented.
    const mirroredExamples = EXAMPLE_MODELS.filter((model) =>
      model.id.endsWith("-rtl"),
    );

    expect(mirroredExamples.length).toBe(3);

    for (const rtlModel of mirroredExamples) {
      const baseModelId = rtlModel.id.replace(/-rtl$/, "");
      const ltrModel = EXAMPLE_MODELS.find((model) => model.id === baseModelId);

      expect(ltrModel).toBeDefined();
      if (!ltrModel) continue;

      const ltrRun = analyseExample(ltrModel);
      const rtlRun = analyseExample(rtlModel);

      expect(Math.abs(ltrRun.minFos - rtlRun.minFos)).toBeLessThanOrEqual(
        tolerance,
      );
    }
  }, 30_000);

  it("critical surfaces mirror correctly in model space", () => {
    const mirroredExamples = EXAMPLE_MODELS.filter((model) =>
      model.id.endsWith("-rtl"),
    );

    for (const rtlModel of mirroredExamples) {
      const baseModelId = rtlModel.id.replace(/-rtl$/, "");
      const ltrModel = EXAMPLE_MODELS.find((model) => model.id === baseModelId);

      expect(ltrModel).toBeDefined();
      if (!ltrModel) continue;

      const ltrRun = analyseExample(ltrModel);
      const rtlRun = analyseExample(rtlModel);

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
          method: ltrModel.options.method,
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
          method: rtlModel.options.method,
          elapsedMs: 0,
        },
        rtlRun.canonicalDefinition,
      );

      const ltrCritical = ltrResultModelSpace.criticalSurface;
      const rtlCritical = rtlResultModelSpace.criticalSurface;

      expect(ltrCritical).not.toBeNull();
      expect(rtlCritical).not.toBeNull();
      if (!ltrCritical || !rtlCritical) continue;

      const [xMin, xMax] = getDomainX(ltrModel.coordinates);

      expect(
        Math.abs(rtlCritical.cx - mirrorX(ltrCritical.cx, xMin, xMax)),
      ).toBeLessThanOrEqual(tolerance);

      expect(
        Math.abs(
          rtlCritical.entryPoint[0] -
            mirrorX(ltrCritical.entryPoint[0], xMin, xMax),
        ),
      ).toBeLessThanOrEqual(tolerance);

      expect(
        Math.abs(
          rtlCritical.exitPoint[0] -
            mirrorX(ltrCritical.exitPoint[0], xMin, xMax),
        ),
      ).toBeLessThanOrEqual(tolerance);
    }
  }, 30_000);
});
