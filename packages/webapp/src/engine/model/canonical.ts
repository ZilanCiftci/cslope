import type { AnalysisResult, AnalysisLimits } from "../types/analysis";
import type { SlopeDefinition } from "../../worker/messages";

export type SlopeOrientation = "ltr" | "rtl";

export function mirrorX(x: number, xMin: number, xMax: number): number {
  return xMin + xMax - x;
}

export function mirrorPoint(
  point: [number, number],
  xMin: number,
  xMax: number,
): [number, number] {
  return [mirrorX(point[0], xMin, xMax), point[1]];
}

export function mirrorPoints(
  points: [number, number][],
  xMin: number,
  xMax: number,
): [number, number][] {
  return points.map((point) => mirrorPoint(point, xMin, xMax));
}

export function getDomainX(coordinates: [number, number][]): [number, number] {
  const xs = coordinates.map((coord) => coord[0]);
  return [Math.min(...xs), Math.max(...xs)];
}

function getSideCrestY(
  coordinates: [number, number][],
  sideX: number,
  tolerance = 1e-9,
): number {
  let crestY = -Infinity;
  for (const [x, y] of coordinates) {
    if (Math.abs(x - sideX) <= tolerance) {
      crestY = Math.max(crestY, y);
    }
  }
  return crestY;
}

export function inferOrientationFromCoordinates(
  coordinates: [number, number][],
): SlopeOrientation {
  if (coordinates.length < 2) return "ltr";
  const [xMin, xMax] = getDomainX(coordinates);
  const leftCrestY = getSideCrestY(coordinates, xMin);
  const rightCrestY = getSideCrestY(coordinates, xMax);
  return rightCrestY > leftCrestY ? "rtl" : "ltr";
}

export function resolveOrientation(
  orientation: SlopeOrientation | undefined,
  coordinates: [number, number][],
): SlopeOrientation {
  if (orientation === "ltr" || orientation === "rtl") return orientation;
  return inferOrientationFromCoordinates(coordinates);
}

function mirrorRange(
  left: number,
  right: number,
  xMin: number,
  xMax: number,
): [number, number] {
  const a = mirrorX(left, xMin, xMax);
  const b = mirrorX(right, xMin, xMax);
  return [Math.min(a, b), Math.max(a, b)];
}

export function mirrorLimits(
  limits: AnalysisLimits,
  xMin: number,
  xMax: number,
): AnalysisLimits {
  const [entryLeftX, entryRightX] = mirrorRange(
    limits.entryLeftX,
    limits.entryRightX,
    xMin,
    xMax,
  );
  const [exitLeftX, exitRightX] = mirrorRange(
    limits.exitLeftX,
    limits.exitRightX,
    xMin,
    xMax,
  );

  return {
    entryLeftX,
    entryRightX,
    exitLeftX,
    exitRightX,
  };
}

export function toCanonicalSlopeDefinition(
  slopeDefinition: SlopeDefinition,
): SlopeDefinition {
  const orientation = resolveOrientation(
    slopeDefinition.orientation,
    slopeDefinition.coordinates,
  );

  if (orientation === "ltr") {
    return { ...slopeDefinition, orientation };
  }

  const [xMin, xMax] = getDomainX(slopeDefinition.coordinates);

  return {
    ...slopeDefinition,
    orientation,
    coordinates: mirrorPoints(slopeDefinition.coordinates, xMin, xMax),
    materialBoundaries: slopeDefinition.materialBoundaries?.map((boundary) => ({
      ...boundary,
      coordinates: mirrorPoints(boundary.coordinates, xMin, xMax),
    })),
    waterTable:
      slopeDefinition.waterTable?.mode === "custom" &&
      Array.isArray(slopeDefinition.waterTable.value)
        ? {
            ...slopeDefinition.waterTable,
            value: mirrorPoints(slopeDefinition.waterTable.value, xMin, xMax),
          }
        : slopeDefinition.waterTable,
    udls: slopeDefinition.udls?.map((udl) => {
      const x1 = mirrorX(udl.x2, xMin, xMax);
      const x2 = mirrorX(udl.x1, xMin, xMax);
      return {
        ...udl,
        x1: Math.min(x1, x2),
        x2: Math.max(x1, x2),
      };
    }),
    lineLoads: slopeDefinition.lineLoads?.map((lineLoad) => ({
      ...lineLoad,
      x: mirrorX(lineLoad.x, xMin, xMax),
    })),
    analysisLimits: slopeDefinition.analysisLimits
      ? mirrorLimits(slopeDefinition.analysisLimits, xMin, xMax)
      : undefined,
  };
}

export function mapAnalysisResultToModelSpace(
  analysisResult: AnalysisResult,
  canonicalSlopeDefinition: SlopeDefinition,
): AnalysisResult {
  const orientation = resolveOrientation(
    canonicalSlopeDefinition.orientation,
    canonicalSlopeDefinition.coordinates,
  );

  if (orientation === "ltr") {
    return analysisResult;
  }

  const [xMin, xMax] = getDomainX(canonicalSlopeDefinition.coordinates);

  return {
    ...analysisResult,
    criticalSurface: analysisResult.criticalSurface
      ? {
          ...analysisResult.criticalSurface,
          cx: mirrorX(analysisResult.criticalSurface.cx, xMin, xMax),
          entryPoint: mirrorPoint(
            analysisResult.criticalSurface.entryPoint,
            xMin,
            xMax,
          ),
          exitPoint: mirrorPoint(
            analysisResult.criticalSurface.exitPoint,
            xMin,
            xMax,
          ),
        }
      : null,
    allSurfaces: analysisResult.allSurfaces.map((surface) => ({
      ...surface,
      cx: mirrorX(surface.cx, xMin, xMax),
      entryPoint: mirrorPoint(surface.entryPoint, xMin, xMax),
      exitPoint: mirrorPoint(surface.exitPoint, xMin, xMax),
    })),
    criticalSlices: analysisResult.criticalSlices.map((slice) => {
      const mirroredLeft = mirrorX(slice.xLeft, xMin, xMax);
      const mirroredRight = mirrorX(slice.xRight, xMin, xMax);
      return {
        ...slice,
        x: mirrorX(slice.x, xMin, xMax),
        xLeft: Math.min(mirroredLeft, mirroredRight),
        xRight: Math.max(mirroredLeft, mirroredRight),
      };
    }),
  };
}
