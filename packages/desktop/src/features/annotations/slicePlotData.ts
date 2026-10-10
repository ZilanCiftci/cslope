import type { AnalysisResult } from "@cslope/engine";
import type { PlotAxisMode, PlotMetricKey } from "../../store/types";

export const PLOT_METRIC_META: Record<
  PlotMetricKey,
  { label: string; unit: string }
> = {
  shearStrength: { label: "Shear", unit: "kPa" },
  frictionAngle: { label: "Friction angle", unit: "deg" },
  cohesion: { label: "Cohesion", unit: "kPa" },
  baseCohesion: { label: "Base cohesion", unit: "kPa" },
  porePressure: { label: "Pore pressure", unit: "kPa" },
  pwp: { label: "PWP", unit: "kN" },
  sliceWeight: { label: "Slice weight", unit: "kN" },
  cohesionStrength: { label: "Cohesion F", unit: "kN" },
  resistingForce: { label: "Resisting", unit: "kN" },
  pullingForce: { label: "Pulling", unit: "kN" },
};

export interface SlicePlotData {
  title: string;
  points: { x: number; y: number }[];
  /** Axis ranges, widened when degenerate. Undefined with < 2 points. */
  range?: { xMin: number; xMax: number; yMin: number; yMax: number };
  xDecimals: number;
}

/**
 * Data series for a slice plot annotation, shared by the canvas and the
 * PDF export so both show the same numbers.
 */
export function computeSlicePlotData(
  result: AnalysisResult,
  axisMode: PlotAxisMode = "slice",
  metric: PlotMetricKey = "shearStrength",
): SlicePlotData {
  const points = result.criticalSlices.map((slice, index) => {
    // SliceData.frictionAngle is always in degrees.
    const phiDeg = slice.frictionAngle;
    const phiRad = (phiDeg * Math.PI) / 180;
    const totalWeight = slice.weight + (slice.surfaceLoad ?? 0);
    const cohesionStrength = slice.cohesion * slice.baseLength;
    const frictionStrength = Math.max(slice.normalForce, 0) * Math.tan(phiRad);
    const resistingForce = cohesionStrength + frictionStrength;
    const values: Record<PlotMetricKey, number> = {
      shearStrength:
        slice.baseLength > 1e-9 ? resistingForce / slice.baseLength : 0,
      frictionAngle: phiDeg,
      cohesion: slice.cohesion,
      baseCohesion: slice.cohesion,
      porePressure: slice.porePressure,
      pwp: slice.porePressure * slice.baseLength,
      sliceWeight: totalWeight,
      cohesionStrength,
      resistingForce,
      pullingForce: totalWeight * Math.sin(slice.alpha),
    };
    return { x: axisMode === "slice" ? index + 1 : slice.x, y: values[metric] };
  });

  const meta = PLOT_METRIC_META[metric];
  const data: SlicePlotData = {
    title: `${meta.label} (${meta.unit})`,
    points,
    xDecimals: axisMode === "slice" ? 0 : 1,
  };
  if (points.length < 2) return data;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (Math.abs(xMax - xMin) < 1e-9) {
    xMin -= 0.5;
    xMax += 0.5;
  }
  if (Math.abs(yMax - yMin) < 1e-9) {
    const bump = Math.max(1, Math.abs(yMax) * 0.1);
    yMin -= bump;
    yMax += bump;
  }
  data.range = { xMin, xMax, yMin, yMax };
  return data;
}
