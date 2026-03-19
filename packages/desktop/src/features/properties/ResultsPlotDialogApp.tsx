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
  Line,
  LineChart,
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

export function ResultsPlotDialogApp() {
  const [snapshot, setSnapshot] = useState<ResultsPlotStatePayload | null>(
    null,
  );
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const [selectedSurfaceIndex, setSelectedSurfaceIndex] = useState(0);
  const [axisMode, setAxisMode] = useState<AxisMode>("slice");
  const [metric, setMetric] = useState<MetricKey>("shearStrength");

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

  const hasCritical =
    !!snapshot?.result?.criticalSurface &&
    !!selectedSurface &&
    isSameSurface(snapshot.result.criticalSurface, selectedSurface);

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
            Plot slice-level variables for critical and non-critical slip
            surfaces.
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
          Run an analysis first to plot slip-surface variables.
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-2.5 p-2.5 rounded border"
            style={{
              borderColor: "var(--color-vsc-border)",
              background: "var(--color-vsc-surface-tint)",
            }}
          >
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
                style={{
                  background: "var(--color-vsc-input-bg)",
                  color: "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
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
              <select
                value={axisMode}
                onChange={(e) => setAxisMode(e.target.value as AxisMode)}
                className="text-[11px] px-2 py-1 rounded"
                style={{
                  background: "var(--color-vsc-input-bg)",
                  color: "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
              >
                <option value="slice">Slice number</option>
                <option value="x">X value</option>
              </select>
            </label>

            <label className="text-[10px] flex flex-col gap-1">
              <span style={{ color: "var(--color-vsc-text-muted)" }}>
                Y variable
              </span>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as MetricKey)}
                className="text-[11px] px-2 py-1 rounded"
                style={{
                  background: "var(--color-vsc-input-bg)",
                  color: "var(--color-vsc-text)",
                  border: "1px solid var(--color-vsc-border)",
                }}
              >
                {METRIC_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className="mt-2 text-[10px] flex items-center gap-3 px-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            <span>FoS: {formatNumber(selectedSurface.fos, 4)}</span>
            <span>Slices: {plotData.length}</span>
            <span>
              {hasCritical ? "Critical surface" : "Non-critical surface"}
            </span>
            <span>Metric unit: {metricMeta.unit}</span>
          </div>

          <div
            className="flex-1 mt-2 rounded border p-2"
            style={{
              borderColor: "var(--color-vsc-border)",
              background: "var(--color-vsc-panel)",
            }}
          >
            {plotData.length === 0 ? (
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
                    dataKey={xKey}
                    tick={{ fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
                    tickLine={{ stroke: "var(--color-vsc-border)" }}
                    axisLine={{ stroke: "var(--color-vsc-border)" }}
                    label={{
                      value: axisMode === "slice" ? "Slice number" : "X value",
                      position: "insideBottom",
                      offset: -8,
                      fill: "var(--color-vsc-text-muted)",
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
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
