import { useEffect, useMemo, useState } from "react";
import {
  buildSlope,
  getDomainX,
  getSlices,
  mirrorX,
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
import { buildSlopeDTOFromModel } from "../../store/helpers";
import { isElectron } from "../../utils/is-electron";

interface ResultsPlotStatePayload {
  model: ModelEntry;
  result: AnalysisResult | null;
}

type AxisMode = "slice" | "x";
type PlotMode = "slipSurface" | "lambdaFmFf";

type MetricKey =
  | "shearStrength"
  | "cohesion"
  | "cohesionStrength"
  | "resistingForce"
  | "pullingForce";

interface PlotPoint {
  sliceNumber: number;
  xValue: number;
  shearStrength: number;
  cohesion: number;
  cohesionStrength: number;
  resistingForce: number;
  pullingForce: number;
}

interface LffPoint {
  lambda: number;
  momentFos: number;
  forceFos: number;
  gap: number;
}

const SELECT_STYLE: React.CSSProperties = {
  background: "var(--color-vsc-input-bg)",
  color: "var(--color-vsc-text)",
  border: "1px solid var(--color-vsc-border)",
};

const METRIC_OPTIONS: Array<{ key: MetricKey; label: string; unit: string }> = [
  { key: "shearStrength", label: "Shear strength", unit: "kPa" },
  { key: "cohesion", label: "Cohesion", unit: "kPa" },
  { key: "cohesionStrength", label: "Cohesion strength", unit: "kN" },
  { key: "resistingForce", label: "Resisting force", unit: "kN" },
  { key: "pullingForce", label: "Pulling force", unit: "kN" },
];

function isSameSurface(a: SlipSurfaceResult, b: SlipSurfaceResult): boolean {
  const tol = 1e-6;
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
): { cx: number; entryX: number; exitX: number; radius: number } {
  if (orientation !== "rtl") {
    return {
      cx: surface.cx,
      entryX: surface.entryPoint[0],
      exitX: surface.exitPoint[0],
      radius: surface.radius,
    };
  }

  const [xMin, xMax] = getDomainX(coordinates);
  return {
    cx: mirrorX(surface.cx, xMin, xMax),
    entryX: mirrorX(surface.entryPoint[0], xMin, xMax),
    exitX: mirrorX(surface.exitPoint[0], xMin, xMax),
    radius: surface.radius,
  };
}

function formatNumber(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(digits);
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

    window.cslope.onResultsPlotState(applyState);
    window.cslope.onResultsPlotChanged(applyState);
    window.cslope.requestResultsPlotState();

    return () => {
      window.cslope.offResultsPlotState(applyState);
      window.cslope.offResultsPlotChanged(applyState);
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
      const slopeDef = buildSlopeDTOFromModel(snapshot.model);
      const slope = buildSlope(slopeDef);
      slope.updateAnalysisOptions(snapshot.model.options);

      const canonical = toCanonicalSurface(
        selectedSurface,
        snapshot.model.orientation,
        snapshot.model.coordinates,
      );

      const slices = getSlices(
        slope,
        canonical.entryX,
        canonical.exitX,
        canonical.cx,
        selectedSurface.cy,
        canonical.radius,
      );

      return slices.map((slice, index) => {
        const totalWeight = slice.weight + slice.udl + slice.ll;
        const normalEffective =
          totalWeight * Math.cos(slice.alpha) - slice.U * slice.baseLength;
        const frictionStrength =
          Math.max(normalEffective, 0) * Math.tan(slice.phi);
        const cohesionStrength = slice.cohesion * slice.baseLength;
        const resistingForce = cohesionStrength + frictionStrength;
        const pullingForce = totalWeight * Math.sin(slice.alpha);
        const shearStrength =
          slice.baseLength > 1e-9 ? resistingForce / slice.baseLength : 0;

        return {
          sliceNumber: index + 1,
          xValue: slice.x,
          shearStrength,
          cohesion: slice.cohesion,
          cohesionStrength,
          resistingForce,
          pullingForce,
        };
      });
    } catch {
      return [];
    }
  }, [snapshot, selectedSurface]);

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
    if (rows.length < 2) return [];
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
          <h2 className="text-[12px] font-semibold">Results Plot</h2>
          <p
            className="text-[10px] mt-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Plot slip-surface variables and Lambda vs Fm/Ff analysis curves.
          </p>
        </div>
        <div
          className="text-[10px] px-2 py-1 rounded"
          style={{
            background: "var(--color-vsc-surface-tint)",
            border: "1px solid var(--color-vsc-border)",
            color: "var(--color-vsc-text-muted)",
          }}
        >
          {isHydrated ? "Synced" : "Waiting for state"}
        </div>
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
                className="text-[11px] px-2 py-1 rounded"
                style={SELECT_STYLE}
              >
                <option value="slipSurface">Slip Surface Variables</option>
                <option value="lambdaFmFf" disabled={!canShowLambdaPlot}>
                  Lambda vs Fm/Ff
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
                className="text-[11px] px-2 py-1 rounded"
                style={SELECT_STYLE}
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
                      {tag} - FoS {formatNumber(surface.fos, 4)}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="text-[10px] flex flex-col gap-1">
              <span style={{ color: "var(--color-vsc-text-muted)" }}>
                X axis
              </span>
              {plotMode === "slipSurface" ? (
                <select
                  value={axisMode}
                  onChange={(e) => setAxisMode(e.target.value as AxisMode)}
                  className="text-[11px] px-2 py-1 rounded"
                  style={SELECT_STYLE}
                >
                  <option value="slice">Slice number</option>
                  <option value="x">X value</option>
                </select>
              ) : (
                <div
                  className="text-[11px] px-2 py-1 rounded"
                  style={SELECT_STYLE}
                >
                  Lambda
                </div>
              )}
            </label>

            <label className="text-[10px] flex flex-col gap-1">
              <span style={{ color: "var(--color-vsc-text-muted)" }}>
                Y axis
              </span>
              {plotMode === "slipSurface" ? (
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as MetricKey)}
                  className="text-[11px] px-2 py-1 rounded"
                  style={SELECT_STYLE}
                >
                  {METRIC_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="text-[11px] px-2 py-1 rounded"
                  style={SELECT_STYLE}
                >
                  Factor of Safety
                </div>
              )}
            </label>
          </div>

          <div
            className="mt-2 text-[10px] flex items-center gap-3 px-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            {plotMode === "slipSurface" ? (
              <>
                <span>FoS: {formatNumber(selectedSurface.fos, 4)}</span>
                <span>Slices: {plotData.length}</span>
                <span>
                  {hasCritical ? "Critical surface" : "Non-critical surface"}
                </span>
                <span>Metric unit: {metricMeta.unit}</span>
              </>
            ) : (
              <>
                <span>Method: {snapshot?.result?.method ?? "-"}</span>
                <span>Lambda points: {lambdaData.length}</span>
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
                    margin={{ top: 16, right: 20, left: 6, bottom: 12 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(120,130,140,0.35)"
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
                        value: `${metricMeta.label} (${metricMeta.unit})`,
                        angle: -90,
                        position: "insideLeft",
                        fill: "var(--color-vsc-text-muted)",
                        fontSize: 10,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-vsc-input-bg)",
                        border: "1px solid var(--color-vsc-border)",
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                      formatter={(value) => {
                        const numeric = toFiniteNumber(value);
                        return numeric == null
                          ? `- ${metricMeta.unit}`
                          : `${formatNumber(numeric, 4)} ${metricMeta.unit}`;
                      }}
                      labelFormatter={(label) => {
                        const numeric = toFiniteNumber(label);
                        if (numeric == null) {
                          return axisMode === "slice" ? "Slice -" : "X -";
                        }
                        return axisMode === "slice"
                          ? `Slice ${formatNumber(numeric, 0)}`
                          : `X ${formatNumber(numeric, 3)}`;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey={metric}
                      stroke="#26a69a"
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
                Lambda vs Fm/Ff is available only for Morgenstern-Price runs.
              </div>
            ) : lambdaData.length === 0 ? (
              <div
                className="h-full flex items-center justify-center text-[11px]"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                No Lambda vs Fm/Ff data is available for the selected slip
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
                    stroke="rgba(120,130,140,0.35)"
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
                      value: "Lambda",
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
                      value: "Factor of Safety",
                      angle: -90,
                      position: "insideLeft",
                      fill: "var(--color-vsc-text-muted)",
                      fontSize: 10,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-vsc-input-bg)",
                      border: "1px solid var(--color-vsc-border)",
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                    formatter={(value, name) => {
                      const numeric = toFiniteNumber(value);
                      if (numeric == null) {
                        return ["-", name];
                      }
                      return [formatNumber(numeric, 4), name];
                    }}
                    labelFormatter={(label) => {
                      const numeric = toFiniteNumber(label);
                      return numeric == null
                        ? "Lambda -"
                        : `Lambda ${formatNumber(numeric, 3)}`;
                    }}
                  />
                  {equilibriumPoint && (
                    <ReferenceLine
                      x={equilibriumPoint.lambda}
                      stroke="#98c379"
                      strokeDasharray="4 3"
                      ifOverflow="extendDomain"
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="momentFos"
                    name="Moment (Fm)"
                    stroke="#e06c75"
                    strokeWidth={2.2}
                    dot={{ r: 2.5, strokeWidth: 1.2 }}
                    activeDot={{ r: 4.5 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forceFos"
                    name="Force (Ff)"
                    stroke="#61afef"
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
                      fill="#98c379"
                      stroke="#98c379"
                    />
                  )}
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: 10 }}
                    formatter={(value) => (
                      <span style={{ color: "var(--color-vsc-text-muted)" }}>
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
        className="pt-3 mt-2 border-t"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        <button
          onClick={() => window.close()}
          className="w-full text-[11px] py-1 rounded cursor-pointer font-medium"
          style={{
            background: "var(--color-vsc-accent)",
            color: "#fff",
            border: "1px solid var(--color-vsc-accent)",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
