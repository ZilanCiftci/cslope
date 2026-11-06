import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSlope,
  getDomainX,
  getSlices,
  mirrorPoints,
  mirrorX,
  solvedEffectiveNormals,
  type AnalysisResult,
  type SlipSurfaceResult,
} from "@cslope/engine";
import { type ModelEntry, type ModelOrientation } from "../../store/types";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART } from "../../components/ui/chart-colors";
import { CsvExportButton } from "../../components/ui/CsvExportButton";
import { lambdaPlotCsv, slicePlotCsv } from "./results-plot-csv";
import { downloadFile, safeFileName } from "../../utils/download";
import { ChartTooltip } from "../../components/ui/ChartTooltip";
import { resultDefinition } from "./result-definition";
import { isElectron } from "../../utils/is-electron";
import { sameSurface } from "../../utils/arc";

interface ResultsPlotStatePayload {
  model: ModelEntry;
  result: AnalysisResult | null;
}

type AxisMode = "slice" | "x";
type PlotMode = "slipSurface" | "lambdaFmFf";

type MetricKey =
  | "shearStrength"
  | "frictionAngle"
  | "cohesion"
  | "baseCohesion"
  | "porePressure"
  | "pwp"
  | "sliceWeight"
  | "cohesionStrength"
  | "resistingForce"
  | "pullingForce"
  | "normalEffective"
  | "frictionStrength"
  | "mobilizedShearForce"
  | "baseNormalStress"
  | "mobilizedShearStress"
  | "localFos"
  | "surchargeLoad"
  | "baseInclination"
  | "baseLength"
  | "sliceWidth"
  | "sliceHeight"
  | "baseElevation";

interface PlotPoint {
  sliceNumber: number;
  xValue: number;
  shearStrength: number;
  frictionAngle: number;
  cohesion: number;
  baseCohesion: number;
  porePressure: number;
  pwp: number;
  sliceWeight: number;
  cohesionStrength: number;
  resistingForce: number;
  pullingForce: number;
  /** The effective normal force on the base, N′ (negative: the slice is in tension, see the result's notes). */
  normalEffective: number;
  frictionStrength: number;
  mobilizedShearForce: number;
  baseNormalStress: number;
  mobilizedShearStress: number;
  localFos: number;
  surchargeLoad: number;
  baseInclination: number;
  baseLength: number;
  sliceWidth: number;
  sliceHeight: number;
  baseElevation: number;
  /** The slice's outline in model coordinates (marked on the canvas while hovered). */
  outline: [number, number][];
}

interface LffPoint {
  lambda: number;
  momentFos: number;
  forceFos: number;
  gap: number;
}

/** The quantities of the slice plot, in the groups the select shows. */
const METRIC_OPTIONS: Array<{ key: MetricKey; label: string; unit: string; group: string }> = [
  { key: "shearStrength", label: "Shear strength", unit: "kPa", group: "Stresses on the base" },
  { key: "mobilizedShearStress", label: "Mobilized shear stress (τ)", unit: "kPa", group: "Stresses on the base" },
  { key: "baseNormalStress", label: "Effective normal stress (σ′)", unit: "kPa", group: "Stresses on the base" },
  { key: "porePressure", label: "Pore pressure", unit: "kPa", group: "Stresses on the base" },
  { key: "localFos", label: "Local F", unit: "", group: "Stresses on the base" },
  { key: "normalEffective", label: "Effective normal force (N′)", unit: "kN", group: "Forces" },
  { key: "mobilizedShearForce", label: "Mobilized shear force", unit: "kN", group: "Forces" },
  { key: "resistingForce", label: "Resisting force", unit: "kN", group: "Forces" },
  { key: "pullingForce", label: "Pulling force", unit: "kN", group: "Forces" },
  { key: "cohesionStrength", label: "Cohesion strength", unit: "kN", group: "Forces" },
  { key: "frictionStrength", label: "Friction strength", unit: "kN", group: "Forces" },
  { key: "pwp", label: "Pore water force", unit: "kN", group: "Forces" },
  { key: "sliceWeight", label: "Slice weight (with loads)", unit: "kN", group: "Forces" },
  { key: "surchargeLoad", label: "Surcharge on the slice", unit: "kN", group: "Forces" },
  { key: "frictionAngle", label: "Friction angle", unit: "deg", group: "Strength parameters" },
  { key: "cohesion", label: "Cohesion", unit: "kPa", group: "Strength parameters" },
  { key: "baseCohesion", label: "Base cohesion", unit: "kPa", group: "Strength parameters" },
  { key: "baseInclination", label: "Base inclination (α)", unit: "deg", group: "Geometry" },
  { key: "baseLength", label: "Base length", unit: "m", group: "Geometry" },
  { key: "sliceWidth", label: "Slice width", unit: "m", group: "Geometry" },
  { key: "sliceHeight", label: "Slice height", unit: "m", group: "Geometry" },
  { key: "baseElevation", label: "Base elevation", unit: "m", group: "Geometry" },
];
const METRIC_GROUPS = [...new Set(METRIC_OPTIONS.map((m) => m.group))];

function isSameSurface(a: SlipSurfaceResult, b: SlipSurfaceResult): boolean {
  const tol = 1e-6;
  if (a.points || b.points) return sameSurface(a, b);
  return (
    Math.abs(a.cx - b.cx) < tol &&
    Math.abs(a.cy - b.cy) < tol &&
    Math.abs(a.radius - b.radius) < tol &&
    Math.abs(a.entryPoint[0] - b.entryPoint[0]) < tol &&
    Math.abs(a.exitPoint[0] - b.exitPoint[0]) < tol
  );
}

function toCanonicalSurface(
  surface: SlipSurfaceResult,
  orientation: ModelOrientation | undefined,
  coordinates: [number, number][],
): {
  cx: number;
  entryX: number;
  exitX: number;
  radius: number;
  points?: [number, number][];
} {
  if (orientation !== "rtl") {
    return {
      cx: surface.cx,
      entryX: surface.entryPoint[0],
      exitX: surface.exitPoint[0],
      radius: surface.radius,
      points: surface.points,
    };
  }

  const [xMin, xMax] = getDomainX(coordinates);
  return {
    cx: mirrorX(surface.cx, xMin, xMax),
    entryX: mirrorX(surface.entryPoint[0], xMin, xMax),
    exitX: mirrorX(surface.exitPoint[0], xMin, xMax),
    radius: surface.radius,
    // Entry first in both spaces, so mirroring keeps x increasing.
    points: surface.points && mirrorPoints(surface.points, xMin, xMax),
  };
}

function formatNumber(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

/** An axis this plot fixes: its name and the quantity, as plain text. */
function FixedAxis({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-[10px] flex flex-col gap-1">
      <span style={{ color: "var(--color-vsc-text-muted)" }}>{label}</span>
      <span className="h-[22px] flex items-center text-[12px]" style={{ color: "var(--color-vsc-text)" }}>
        {value}
      </span>
    </div>
  );
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatAxisNumber(value: number, maxDigits = 3): string {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(maxDigits).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "");
}

function niceStep(range: number, targetTicks: number): number {
  const safeRange = Number.isFinite(range) && range > 0 ? range : 1;
  const raw = safeRange / Math.max(targetTicks, 2);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step = 1;
  if (norm > 1.5) step = 2;
  if (norm > 3) step = 5;
  if (norm > 7) step = 10;
  return step * mag;
}

function buildNiceTicks(min: number, max: number, targetTicks = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (Math.abs(max - min) < 1e-9) return [min];

  const step = niceStep(max - min, targetTicks);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(Number(v.toPrecision(10)));
  }
  return ticks;
}

export function ResultsPlotDialogApp() {
  const [snapshot, setSnapshot] = useState<ResultsPlotStatePayload | null>(
    null,
  );
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const [selectedSurfaceIndex, setSelectedSurfaceIndex] = useState(0);
  const [axisMode, setAxisMode] = useState<AxisMode>("slice");
  const [metric, setMetric] = useState<MetricKey>("shearStrength");
  const [plotMode, setPlotMode] = useState<PlotMode>("slipSurface");

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (_event: unknown, next: ResultsPlotStatePayload) => {
      setSnapshot(next);
      setIsHydrated(true);
    };

    const unsubscribeResultsPlotState = window.cslope.onResultsPlotState(applyState);
    const unsubscribeResultsPlotChanged = window.cslope.onResultsPlotChanged(applyState);
    window.cslope.requestResultsPlotState();

    return () => {
      unsubscribeResultsPlotState();
      unsubscribeResultsPlotChanged();
    };
  }, []);

  const surfaces = useMemo(() => {
    const all = snapshot?.result?.allSurfaces ?? [];
    return [...all].sort((a, b) => a.fos - b.fos);
  }, [snapshot]);

  const effectiveSurfaceIndex =
    surfaces.length === 0
      ? 0
      : Math.max(0, Math.min(selectedSurfaceIndex, surfaces.length - 1));

  const selectedSurface = surfaces[effectiveSurfaceIndex] ?? null;

  const plotData = useMemo<PlotPoint[]>(() => {
    if (!snapshot?.result || !selectedSurface) return [];

    try {
      const { slopeDef, orientation } = resultDefinition(snapshot.model, snapshot.result);
      const slope = buildSlope(slopeDef);
      slope.updateAnalysisOptions(snapshot.model.options);

      const canonical = toCanonicalSurface(
        selectedSurface,
        orientation,
        snapshot.model.coordinates,
      );

      const slices = getSlices(
        slope,
        canonical.entryX,
        canonical.exitX,
        canonical.cx,
        selectedSurface.cy,
        canonical.radius,
        canonical.points,
      );

      // Slices are computed in canonical (left-to-right) space; plot x in
      // model coordinates so it matches the canvas.
      const [xMin, xMax] = getDomainX(snapshot.model.coordinates);
      const toModelX = (x: number) =>
        orientation === "rtl" ? mirrorX(x, xMin, xMax) : x;

      // The method's own base normal forces at this surface's FOS.
      const solved = solvedEffectiveNormals(slope, slices, selectedSurface.fos, selectedSurface.lffArray);
      return slices.map((slice, index) => {
        const totalWeight =
          slice.weight + slice.udl + slice.ll + (slice.waterLoad ?? 0);
        const normalEffective =
          solved?.[index] ?? totalWeight * Math.cos(slice.alpha) - slice.U * slice.baseLength;
        const frictionStrength =
          Math.max(normalEffective, 0) * Math.tan(slice.phi);
        const frictionAngle = (slice.phi * 180) / Math.PI;
        const cohesionStrength = slice.cohesion * slice.baseLength;
        const resistingForce = cohesionStrength + frictionStrength;
        const pullingForce = totalWeight * Math.sin(slice.alpha);
        const shearStrength =
          slice.baseLength > 1e-9 ? resistingForce / slice.baseLength : 0;
        // The method's shear on the base at this surface's FOS, and the
        // ratio of the strength to the shear the base must carry.
        const fos = selectedSurface.fos;
        const mobilizedShearForce = fos > 0 ? resistingForce / fos : 0;
        const localFos = Math.abs(pullingForce) > 1e-9 ? resistingForce / pullingForce : NaN;

        return {
          sliceNumber: index + 1,
          xValue: toModelX(slice.x),
          shearStrength,
          frictionAngle,
          cohesion: slice.cohesion,
          baseCohesion: slice.cohesion,
          // negative above the line in a material with φb (the suction)
          porePressure: slice.U - (slice.suction ?? 0),
          pwp: (slice.U - (slice.suction ?? 0)) * slice.baseLength,
          sliceWeight: totalWeight,
          cohesionStrength,
          resistingForce,
          pullingForce,
          normalEffective,
          frictionStrength,
          mobilizedShearForce,
          baseNormalStress: slice.baseLength > 1e-9 ? normalEffective / slice.baseLength : 0,
          mobilizedShearStress: slice.baseLength > 1e-9 ? mobilizedShearForce / slice.baseLength : 0,
          localFos,
          surchargeLoad: slice.udl + slice.ll,
          baseInclination: (slice.alpha * 180) / Math.PI,
          baseLength: slice.baseLength,
          sliceWidth: slice.width,
          sliceHeight: slice.height,
          baseElevation: slice.yBottom,
          outline: [
            [toModelX(slice.xLeft), slice.y0Top],
            [toModelX(slice.xRight), slice.y1Top],
            [toModelX(slice.xRight), slice.y1Bottom],
            [toModelX(slice.xLeft), slice.y0Bottom],
          ],
        };
      });
    } catch {
      return [];
    }
  }, [snapshot, selectedSurface]);

  // The hovered slice, marked on the main window's result canvas.
  const hoveredRef = useRef<number | null>(null);
  const hoverSlice = useCallback(
    (index: number | null) => {
      if (!isElectron || hoveredRef.current === index) return;
      hoveredRef.current = index;
      const outline = index === null ? null : (plotData[index]?.outline ?? null);
      window.cslope.sendResultsPlotHover(outline);
    },
    [plotData],
  );
  // Another surface or plot: nothing stays marked.
  useEffect(() => () => hoverSlice(null), [hoverSlice]);

  const metricMeta =
    METRIC_OPTIONS.find((m) => m.key === metric) ?? METRIC_OPTIONS[0];

  const xKey: keyof PlotPoint = axisMode === "slice" ? "sliceNumber" : "xValue";

  const slipXAxisConfig = useMemo(() => {
    if (axisMode === "slice") {
      return {
        ticks: undefined as number[] | undefined,
        allowDecimals: false,
        formatTick: (value: unknown) => formatAxisNumber(Number(value), 0),
      };
    }

    const xs = plotData.map((d) => d.xValue).filter(Number.isFinite);
    if (xs.length === 0) {
      return {
        ticks: undefined as number[] | undefined,
        allowDecimals: true,
        formatTick: (value: unknown) => formatAxisNumber(Number(value), 3),
      };
    }

    const min = Math.min(...xs);
    const max = Math.max(...xs);

    const intStart = Math.ceil(min);
    const intEnd = Math.floor(max);
    const intSpan = intEnd - intStart;

    if (intSpan >= 2) {
      const maxTickCount = 8;
      const intStep = Math.max(1, Math.ceil(intSpan / (maxTickCount - 1)));
      const ticks: number[] = [];
      for (let t = intStart; t <= intEnd; t += intStep) {
        ticks.push(t);
      }
      if (ticks.length === 0 || ticks[ticks.length - 1] !== intEnd) {
        ticks.push(intEnd);
      }

      return {
        ticks,
        allowDecimals: false,
        formatTick: (value: unknown) => formatAxisNumber(Number(value), 0),
      };
    }

    return {
      ticks: buildNiceTicks(min, max, 6),
      allowDecimals: true,
      formatTick: (value: unknown) => formatAxisNumber(Number(value), 3),
    };
  }, [axisMode, plotData]);

  const hasCritical =
    !!snapshot?.result?.criticalSurface &&
    !!selectedSurface &&
    isSameSurface(snapshot.result.criticalSurface, selectedSurface);

  const lambdaData = useMemo<LffPoint[]>(() => {
    const rows = selectedSurface?.lffArray ?? [];
    if (rows.length < 1) return [];
    return [...rows]
      .map(([lambda, momentFos, forceFos, gap]) => ({
        lambda,
        momentFos,
        forceFos,
        gap,
      }))
      .sort((a, b) => a.lambda - b.lambda);
  }, [selectedSurface]);

  const equilibriumPoint = useMemo(() => {
    if (lambdaData.length === 0) return null;
    return lambdaData.reduce((best, row) => (row.gap < best.gap ? row : best));
  }, [lambdaData]);

  const lambdaXAxisDomain = useMemo<[number, number] | undefined>(() => {
    if (lambdaData.length === 0) return undefined;
    const xs = lambdaData.map((d) => d.lambda).filter(Number.isFinite);
    if (xs.length === 0) return undefined;
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    if (Math.abs(max - min) < 1e-9) {
      const pad = Math.max(Math.abs(min) * 0.05, 0.01);
      return [min - pad, max + pad];
    }
    return [min, max];
  }, [lambdaData]);

  const lambdaYAxisDomain = useMemo<[number, number] | undefined>(() => {
    if (lambdaData.length === 0) return undefined;
    const ys = lambdaData
      .flatMap((d) => [d.momentFos, d.forceFos])
      .filter(Number.isFinite);
    if (ys.length === 0) return undefined;

    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const span = max - min;
    const margin =
      span > 1e-9 ? span * 0.08 : Math.max(Math.abs(max) * 0.05, 0.02);
    return [min - margin, max + margin];
  }, [lambdaData]);

  const canShowLambdaPlot = snapshot?.result?.method === "Morgenstern-Price";

  // Reset plotMode during render when lambda plot is unavailable.
  if (plotMode === "lambdaFmFf" && !canShowLambdaPlot) {
    setPlotMode("slipSurface");
  }

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="pb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-semibold">Results plot</h2>
          <p
            className="text-[11px] mt-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Values per slice along a slip surface, or F from moment (Fm) and force (Ff) equilibrium against λ.
          </p>
        </div>
        {/* Only while the result is not there yet: once it is, the plot
            simply follows the main window. */}
        {!isHydrated && (
          <div
            role="status"
            className="text-[10px] shrink-0"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Waiting for the main window
          </div>
        )}
      </div>

      {!snapshot?.result || surfaces.length === 0 ? (
        <div
          className="flex-1 rounded border p-4 text-[11px]"
          style={{
            borderColor: "var(--color-vsc-border)",
            background: "var(--color-vsc-surface-tint)",
            color: "var(--color-vsc-text-muted)",
          }}
        >
          Run an analysis first to open results plots.
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-1 md:grid-cols-4 gap-2.5 p-2.5 rounded border"
            style={{
              borderColor: "var(--color-vsc-border)",
              background: "var(--color-vsc-surface-tint)",
            }}
          >
            <label className="text-[10px] flex flex-col gap-1">
              <span style={{ color: "var(--color-vsc-text-muted)" }}>Plot</span>
              <select
                value={plotMode}
                onChange={(e) => setPlotMode(e.target.value as PlotMode)}
              >
                <option value="slipSurface">Slip surface variables</option>
                <option value="lambdaFmFf" disabled={!canShowLambdaPlot}>
                  F against λ
                </option>
              </select>
            </label>

            <label className="text-[10px] flex flex-col gap-1">
              <span style={{ color: "var(--color-vsc-text-muted)" }}>
                Slip surface
              </span>
              <select
                value={effectiveSurfaceIndex}
                onChange={(e) =>
                  setSelectedSurfaceIndex(Number(e.target.value))
                }
              >
                {surfaces.map((surface, idx) => {
                  const tag =
                    idx === 0
                      ? "Critical"
                      : `${idx + 1}${
                          snapshot.result?.criticalSurface &&
                          isSameSurface(
                            surface,
                            snapshot.result.criticalSurface,
                          )
                            ? " (Critical)"
                            : ""
                        }`;
                  return (
                    <option
                      key={`${surface.cx}-${surface.cy}-${surface.radius}-${idx}`}
                      value={idx}
                    >
                      {tag} – F {formatNumber(surface.fos, 3)}
                    </option>
                  );
                })}
              </select>
            </label>

            {plotMode === "slipSurface" ? (
              <label className="text-[10px] flex flex-col gap-1">
                <span style={{ color: "var(--color-vsc-text-muted)" }}>
                  X axis
                </span>
                <select
                  value={axisMode}
                  onChange={(e) => setAxisMode(e.target.value as AxisMode)}
                >
                  <option value="slice">Slice number</option>
                  <option value="x">X value</option>
                </select>
              </label>
            ) : (
              // Fixed for this plot: plain text, not a field that cannot be used.
              <FixedAxis label="X axis" value="λ" />
            )}

            {plotMode !== "slipSurface" ? (
              <FixedAxis label="Y axis" value="F" />
            ) : (
              <label className="text-[10px] flex flex-col gap-1">
                <span style={{ color: "var(--color-vsc-text-muted)" }}>
                  Y axis
                </span>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as MetricKey)}
                >
                  {METRIC_GROUPS.map((group) => (
                    <optgroup key={group} label={group}>
                      {METRIC_OPTIONS.filter((o) => o.group === group).map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div
            className="mt-2 text-[10px] flex items-center gap-3 px-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            {plotMode === "slipSurface" ? (
              <>
                <span>F: {formatNumber(selectedSurface.fos, 3)}</span>
                <span>Slices: {plotData.length}</span>
                <span>
                  {hasCritical ? "Critical surface" : "Non-critical surface"}
                </span>
              </>
            ) : (
              <>
                <span>Method: {snapshot?.result?.method ?? "-"}</span>
                <span>λ points: {lambdaData.length}</span>
                <span>
                  Equilibrium λ:{" "}
                  {formatNumber(equilibriumPoint?.lambda ?? NaN, 4)}
                </span>
              </>
            )}
          </div>

          <div
            className="flex-1 mt-2 rounded border p-2"
            style={{
              borderColor: "var(--color-vsc-border)",
              background: "var(--color-vsc-panel)",
            }}
          >
            {plotMode === "slipSurface" ? (
              plotData.length === 0 ? (
                <div
                  className="h-full flex items-center justify-center text-[11px]"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Unable to derive slice values for the selected surface.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={plotData}
                    onMouseMove={(state) => {
                      const i = Number(state?.activeTooltipIndex);
                      hoverSlice(Number.isInteger(i) && i >= 0 && i < plotData.length ? i : null);
                    }}
                    onMouseLeave={() => hoverSlice(null)}
                    margin={{ top: 16, right: 20, left: 6, bottom: 12 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART.grid}
                    />
                    <XAxis
                      type="number"
                      dataKey={xKey}
                      domain={["dataMin", "dataMax"]}
                      tickCount={axisMode === "slice" ? 8 : 7}
                      interval={0}
                      ticks={slipXAxisConfig.ticks}
                      allowDecimals={slipXAxisConfig.allowDecimals}
                      tickFormatter={slipXAxisConfig.formatTick}
                      tick={{
                        fontSize: 10,
                        fill: "var(--color-vsc-text-muted)",
                      }}
                      tickLine={{ stroke: "var(--color-vsc-border)" }}
                      axisLine={{ stroke: "var(--color-vsc-border)" }}
                      label={{
                        value:
                          axisMode === "slice" ? "Slice number" : "X value",
                        position: "insideBottom",
                        offset: -8,
                        fill: "var(--color-vsc-text-muted)",
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      tick={{
                        fontSize: 10,
                        fill: "var(--color-vsc-text-muted)",
                      }}
                      tickLine={{ stroke: "var(--color-vsc-border)" }}
                      axisLine={{ stroke: "var(--color-vsc-border)" }}
                      label={{
                        value: metricMeta.unit ? `${metricMeta.label} (${metricMeta.unit})` : metricMeta.label,
                        angle: -90,
                        position: "insideLeft",
                        fill: "var(--color-vsc-text-muted)",
                        fontSize: 10,
                      }}
                    />
                    <Tooltip
                      content={(p) => (
                        <ChartTooltip
                          {...p}
                          formatValue={(value) => {
                            const numeric = toFiniteNumber(value);
                            return numeric == null
                              ? `- ${metricMeta.unit}`.trimEnd()
                              : `${formatNumber(numeric, 2)} ${metricMeta.unit}`.trimEnd();
                          }}
                          formatLabel={(label) => {
                            const numeric = toFiniteNumber(label);
                            if (numeric == null) {
                              return axisMode === "slice" ? "Slice -" : "X -";
                            }
                            return axisMode === "slice"
                              ? `Slice ${formatNumber(numeric, 0)}`
                              : `X ${formatNumber(numeric, 3)}`;
                          }}
                        />
                      )}
                    />
                    {/* Straight segments: a smoothed curve between slices
                        suggests values that were never computed. */}
                    <Line
                      type="linear"
                      dataKey={metric}
                      name={metricMeta.label}
                      stroke={CHART.series}
                      strokeWidth={2.2}
                      dot={{ r: 2.5, strokeWidth: 1.2 }}
                      activeDot={{ r: 4.5 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )
            ) : !canShowLambdaPlot ? (
              <div
                className="h-full flex items-center justify-center text-[11px]"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                F against λ is available only for Morgenstern-Price runs.
              </div>
            ) : lambdaData.length === 0 ? (
              <div
                className="h-full flex items-center justify-center text-[11px]"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                No values of F against λ are available for the selected slip
                surface.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={lambdaData}
                  margin={{ top: 34, right: 20, left: 6, bottom: 12 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART.grid}
                  />
                  <XAxis
                    type="number"
                    dataKey="lambda"
                    domain={lambdaXAxisDomain ?? ["dataMin", "dataMax"]}
                    tickCount={6}
                    interval={0}
                    tick={{ fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
                    tickFormatter={(value) => formatNumber(Number(value), 3)}
                    tickLine={{ stroke: "var(--color-vsc-border)" }}
                    axisLine={{ stroke: "var(--color-vsc-border)" }}
                    label={{
                      value: "λ",
                      position: "insideBottom",
                      offset: -8,
                      fill: "var(--color-vsc-text-muted)",
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    type="number"
                    domain={lambdaYAxisDomain ?? ["auto", "auto"]}
                    tickFormatter={(value) =>
                      formatAxisNumber(Number(value), 3)
                    }
                    tick={{ fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
                    tickLine={{ stroke: "var(--color-vsc-border)" }}
                    axisLine={{ stroke: "var(--color-vsc-border)" }}
                    label={{
                      value: "F",
                      angle: -90,
                      position: "insideLeft",
                      fill: "var(--color-vsc-text-muted)",
                      fontSize: 10,
                    }}
                  />
                  <Tooltip
                    content={(p) => (
                      <ChartTooltip
                        {...p}
                        formatValue={(value) => {
                          const numeric = toFiniteNumber(value);
                          return numeric == null ? "-" : formatNumber(numeric, 3);
                        }}
                        formatLabel={(label) => {
                          const numeric = toFiniteNumber(label);
                          return numeric == null
                            ? "λ -"
                            : `λ ${formatNumber(numeric, 3)}`;
                        }}
                      />
                    )}
                  />
                  {equilibriumPoint && (
                    <ReferenceLine
                      x={equilibriumPoint.lambda}
                      stroke={CHART.mark}
                      strokeDasharray="4 3"
                      ifOverflow="extendDomain"
                    />
                  )}
                  <Line
                    type="linear"
                    dataKey="momentFos"
                    name="Moment (Fm)"
                    stroke={CHART.moment}
                    strokeWidth={2.2}
                    dot={{ r: 2.5, strokeWidth: 1.2 }}
                    activeDot={{ r: 4.5 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="forceFos"
                    name="Force (Ff)"
                    stroke={CHART.force}
                    strokeWidth={2.2}
                    dot={{ r: 2.5, strokeWidth: 1.2 }}
                    activeDot={{ r: 4.5 }}
                    isAnimationActive={false}
                  />
                  {equilibriumPoint && (
                    <ReferenceDot
                      x={equilibriumPoint.lambda}
                      y={
                        (equilibriumPoint.momentFos +
                          equilibriumPoint.forceFos) /
                        2
                      }
                      r={4}
                      fill={CHART.mark}
                      stroke={CHART.mark}
                    />
                  )}
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: 10 }}
                    formatter={(value) => (
                      // The text in the text color; the series color is the marker.
                      <span style={{ color: "var(--color-vsc-text)" }}>
                        {value}
                      </span>
                    )}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}

      <div
        className="pt-3 mt-2 border-t dialog-buttons items-center"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        <CsvExportButton
          disabled={plotMode === "slipSurface" ? plotData.length === 0 : !canShowLambdaPlot || lambdaData.length === 0}
          onExport={(decimalComma) => {
            const name = snapshot?.model.name || "cslope";
            const [file, text] =
              plotMode === "slipSurface"
                ? [`${name} slices`, slicePlotCsv(plotData, METRIC_OPTIONS, decimalComma)]
                : [`${name} F against lambda`, lambdaPlotCsv(lambdaData, decimalComma)];
            downloadFile(safeFileName(file, "csv"), "\uFEFF" + text, "text/csv;charset=utf-8");
          }}
        />
        <span className="flex-1" />
        <button
          onClick={() => window.close()}
          className="btn btn-primary"
        >
          Close
        </button>
      </div>
    </div>
  );
}
