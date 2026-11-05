import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { Label } from "../../components/ui/Label";
import { DraftNumberInput } from "../../components/ui/DraftNumberInput";
import { ToolWindowFrame } from "../../components/ui/ToolWindowFrame";
import { CHART } from "../../components/ui/chart-colors";
import { ChartTooltip } from "../../components/ui/ChartTooltip";
import { useWidth } from "../../utils/use-width";
import { downloadFile, safeFileName } from "../../utils/download";
import { isElectron } from "../../utils/is-electron";
import { useToolWindowState } from "../../utils/tool-window-sync";
import {
  defaultSd,
  histogram,
  listRandomCandidates,
  reliabilityCsv,
  toRandomVariables,
  type RandomRow,
} from "./reliability";
import type { ReliabilityCommand, ReliabilityWindowState } from "./window-sync";

const TITLE = "Probabilistic analysis";
const DESCRIPTION =
  "Material values as random variables: the reliability index and the probability of failure of the active model.";

/**
 * The Probabilistic analysis window: material values as random variables
 * (mean = the model value), reliability index and probability of failure
 * by the Taylor series method or Monte Carlo sampling. The main window
 * runs the analyses and sends the model and the result here.
 */
export function ReliabilityDialogApp() {
  const state = useToolWindowState<ReliabilityWindowState>({
    enabled: isElectron,
    request: () => window.cslope.requestReliabilityState(),
    onState: (l) => window.cslope.onReliabilityState(l),
    onChanged: (l) => window.cslope.onReliabilityChanged(l),
  });
  return (
    <ReliabilityWindow
      state={state}
      onCommand={(command) => window.cslope.sendReliabilityCommand(command)}
    />
  );
}

/** The window's content for the given state (null: not there yet). */
export function ReliabilityWindow({
  state,
  onCommand,
}: {
  state: ReliabilityWindowState | null;
  onCommand: (command: ReliabilityCommand) => void;
}) {
  if (!state) {
    return <ToolWindowFrame title={TITLE} description={DESCRIPTION} waiting />;
  }
  // The variables belong to the model: another model starts afresh.
  return <ReliabilityBody key={state.model.id} state={state} onCommand={onCommand} />;
}

function ReliabilityBody({
  state,
  onCommand,
}: {
  state: ReliabilityWindowState;
  onCommand: (command: ReliabilityCommand) => void;
}) {
  const { model, designValues, bothDirections, running, progress, result, labels, error } = state;
  const candidates = useMemo(() => listRandomCandidates(model), [model]);
  const [chartRef, chartWidth] = useWidth(450);

  const [rows, setRows] = useState<RandomRow[]>(() => {
    const first = candidates.find((c) => c.field !== "unitWeight") ?? candidates[0];
    return first ? [{ key: first.key, sd: defaultSd(first), distribution: "normal" }] : [];
  });
  const [method, setMethod] = useState<"taylor" | "monte-carlo">("taylor");
  const [search, setSearch] = useState(true);
  const [samples, setSamples] = useState(2000);
  const [seed, setSeed] = useState(1);

  const unused = candidates.filter((c) => !rows.some((r) => r.key === c.key));
  const updateRow = (i: number, patch: Partial<RandomRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chooseKey = (i: number, key: string) => {
    const c = candidates.find((o) => o.key === key);
    if (c) updateRow(i, { key, sd: defaultSd(c) });
  };
  const variables = toRandomVariables(model, rows);
  const variableLabels = rows
    .filter((r) => r.sd > 0 && candidates.some((c) => c.key === r.key))
    .map((r) => candidates.find((c) => c.key === r.key)!.label);

  const start = () =>
    onCommand({
      type: "run",
      variables,
      labels: variableLabels,
      options: method === "taylor" ? { method, search } : { method, samples, seed },
    });

  const bars = result?.samples ? histogram(result.samples, 30).map((b) => ({ mid: (b.from + b.to) / 2, count: b.count })) : [];

  return (
    <ToolWindowFrame
      title={TITLE}
      description={DESCRIPTION}
      footer={([false, true] as const).map((swedish) => (
        <button
          key={String(swedish)}
          onClick={() =>
            result &&
            downloadFile(
              safeFileName(`${model.name || "cslope"} probabilistic`, "csv"),
              "﻿" + reliabilityCsv(result, labels, swedish),
              "text/csv;charset=utf-8",
            )
          }
          disabled={!result || running}
          className="btn"
          title={
            swedish
              ? "CSV with semicolons and decimal commas, for Excel set to a decimal-comma locale"
              : "CSV with commas and decimal points"
          }
        >
          {swedish ? "CSV (decimal comma)" : "Export CSV"}
        </button>
      ))}
      primary={
        <>
          <span style={{ color: "var(--color-vsc-text-muted)" }}>
            {running ? `${Math.round(progress * 100)} %` : ""}
          </span>
          {running ? (
            <button onClick={() => onCommand({ type: "cancel" })} className="btn">
              Cancel
            </button>
          ) : (
            <button onClick={start} disabled={variables.length === 0} className="btn btn-primary">
              Run
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[12px]">
        {candidates.length === 0 ? (
          <p style={{ color: "var(--color-vsc-text-muted)" }}>The model has no material values to vary.</p>
        ) : (
          <>
            <table className="w-full table-fixed text-[11px]" aria-label="Random variables">
              <colgroup>
                <col />
                <col className="w-[76px]" />
                <col className="w-[104px]" />
                <col className="w-[28px]" />
              </colgroup>
              <thead>
                <tr style={{ color: "var(--color-vsc-text-muted)" }}>
                  <th className="text-left font-normal pr-1">Variable</th>
                  <th className="text-left font-normal pr-1">σ</th>
                  <th className="text-left font-normal pr-1">Distribution</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const options = candidates.filter((c) => c.key === row.key || !rows.some((r) => r.key === c.key));
                  return (
                    <tr key={row.key} className="group">
                      <td className="pr-1">
                        <select
                          value={row.key}
                          onChange={(e) => chooseKey(i, e.target.value)}
                          aria-label={`Variable ${i + 1}`}
                          className="w-full"
                        >
                          {options.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}, mean {round(c.value)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="pr-1">
                        <DraftNumberInput
                          value={row.sd}
                          min={0}
                          onValueChange={(v) => v >= 0 && updateRow(i, { sd: v })}
                          aria-label={`Standard deviation ${i + 1}`}
                          className="w-full"
                        />
                      </td>
                      <td className="pr-1">
                        <select
                          value={row.distribution}
                          onChange={(e) => updateRow(i, { distribution: e.target.value as RandomRow["distribution"] })}
                          aria-label={`Distribution ${i + 1}`}
                          disabled={method === "taylor"}
                          title={method === "taylor" ? "The Taylor series uses only the mean and σ" : undefined}
                          className="w-full"
                        >
                          <option value="normal">Normal</option>
                          <option value="lognormal">Lognormal</option>
                        </select>
                      </td>
                      <td>
                        <button
                          onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                          aria-label={`Remove variable ${i + 1}`}
                          title="Remove variable"
                          className="w-6 h-6 flex items-center justify-center rounded cursor-pointer opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:bg-[var(--color-vsc-list-hover)]"
                          style={{ color: "var(--color-vsc-text-muted)" }}
                        >
                          <X size={12} strokeWidth={1.75} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] -mt-1" style={{ color: "var(--color-vsc-text-muted)" }}>
              The mean of each variable is its value in the model; σ is its standard deviation.
            </p>
            <div>
              <button
                onClick={() => {
                  const c = unused[0];
                  if (c) setRows((rs) => [...rs, { key: c.key, sd: defaultSd(c), distribution: "normal" }]);
                }}
                disabled={unused.length === 0}
                className="text-[11px] font-medium cursor-pointer hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
                style={{ color: "var(--color-vsc-accent)" }}
              >
                + Add variable
              </button>
            </div>

            <div role="group" aria-label="Method" className="flex items-center gap-1 text-[11px]">
              <span className="mr-2">
                <Label>Method</Label>
              </span>
              {(["taylor", "monte-carlo"] as const).map((m) => (
                <button key={m} type="button" className="btn" aria-pressed={method === m} onClick={() => setMethod(m)}>
                  {m === "taylor" ? "Taylor series" : "Monte Carlo"}
                </button>
              ))}
            </div>
            {method === "taylor" ? (
              <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                <input type="checkbox" checked={search} onChange={(e) => setSearch(e.target.checked)} />
                Search the critical surface again for each value ({1 + 2 * variables.length} analyses)
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5">
                  <Label>Samples</Label>
                  <DraftNumberInput
                    value={samples}
                    min={10}
                    max={100000}
                    step={100}
                    onValueChange={(v) => v >= 10 && v <= 100000 && setSamples(Math.round(v))}
                    aria-label="Samples"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <Label>Seed</Label>
                  <DraftNumberInput
                    value={seed}
                    step={1}
                    onValueChange={(v) => Number.isFinite(v) && setSeed(Math.round(v))}
                    aria-label="Seed"
                  />
                </label>
              </div>
            )}
            <p className="text-[10px]" style={{ color: "var(--color-vsc-text-muted)" }}>
              {method === "taylor"
                ? "FOS at the mean values and at mean ± σ of each variable; σ of the FOS from the differences, β and Pf for a lognormal FOS (Duncan 2000)."
                : "One search at the mean values, then each sample analyzed on that critical surface (not a new search per sample). Samples are truncated at zero."}
              {bothDirections ? " Only the model's own sliding direction is analyzed." : ""}
              {designValues ? " Partial factors are applied, so the FOS are design values." : ""}
            </p>
          </>
        )}

        {error && (
          <p className="text-[11px]" style={{ color: "var(--color-vsc-error)" }}>
            {error}
          </p>
        )}

        {!result && !running && !error && variables.length > 0 && (
          // Before the first run: where the results will be, and how to get them.
          <p className="text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }} data-testid="reliability-empty">
            Run to compute β and Pf.
          </p>
        )}

        {result && (
          <>
            <table className="w-full text-[11px] tabular-nums" aria-label="Probabilistic results">
              <tbody>
                <ResultRow label="FOS at the mean values" value={result.fos.toFixed(3)} />
                {result.method === "monte-carlo" && <ResultRow label="Mean FOS of the samples" value={result.meanFOS.toFixed(3)} />}
                <ResultRow label="σ of the FOS" value={result.sdFOS.toFixed(3)} />
                <ResultRow label="Coefficient of variation" value={result.cov.toFixed(3)} />
                <ResultRow label="Reliability index β (lognormal)" value={fmtBeta(result.betaLognormal)} bold />
                <ResultRow label="Probability of failure (lognormal)" value={fmtPct(result.pfLognormal)} bold />
                {result.pf != null && (
                  <ResultRow label="Share of samples with FOS < 1" value={fmtPct(result.pf)} bold />
                )}
                <ResultRow label="Reliability index β (normal)" value={fmtBeta(result.betaNormal)} />
                {result.failed > 0 && <ResultRow label="Samples without a FOS (left out)" value={String(result.failed)} />}
              </tbody>
            </table>
            {result.terms && (
              <table className="w-full text-[11px] tabular-nums" aria-label="Taylor series terms">
                <thead>
                  <tr style={{ color: "var(--color-vsc-text-muted)" }}>
                    <th className="text-left font-normal">Variable</th>
                    <th className="text-right font-normal">Mean</th>
                    <th className="text-right font-normal">σ</th>
                    <th className="text-right font-normal">FOS⁺</th>
                    <th className="text-right font-normal">FOS⁻</th>
                  </tr>
                </thead>
                <tbody>
                  {result.terms.map((t) => (
                    <tr key={t.variable}>
                      <td>{labels[t.variable]}</td>
                      <td className="text-right">{round(t.mean)}</td>
                      <td className="text-right">{round(t.sd)}</td>
                      <td className="text-right">{t.fPlus.toFixed(3)}</td>
                      <td className="text-right">{t.fMinus.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {bars.length > 0 && (
              <div aria-label="Distribution of the FOS" ref={chartRef}>
                <BarChart width={chartWidth} height={200} data={bars} margin={{ top: 10, right: 16, left: 0, bottom: 14 }} barCategoryGap={0}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis
                    type="number"
                    dataKey="mid"
                    domain={["dataMin", "dataMax"]}
                    tick={{ fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
                    tickFormatter={(v) => Number(v).toFixed(2)}
                    label={{ value: "FOS", position: "insideBottom", offset: -8, fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "var(--color-vsc-text-muted)" }} width={40} />
                  <ReferenceLine x={1} stroke="var(--color-vsc-error)" strokeDasharray="4 3" ifOverflow="extendDomain" />
                  <Tooltip
                    content={(p) => (
                      <ChartTooltip
                        {...p}
                        formatValue={(v) => String(v)}
                        formatLabel={(v) => `FOS ≈ ${Number(v).toFixed(3)}`}
                      />
                    )}
                  />
                  <Bar dataKey="count" name="Samples" fill={CHART.series} isAnimationActive={false} />
                </BarChart>
              </div>
            )}
          </>
        )}
      </div>
    </ToolWindowFrame>
  );
}

function ResultRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="text-right" style={bold ? { fontWeight: 600 } : undefined}>
        {value}
      </td>
    </tr>
  );
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function fmtBeta(b: number): string {
  return Number.isFinite(b) ? b.toFixed(3) : "∞ (σ = 0)";
}

function fmtPct(p: number): string {
  return p < 0.0001 ? "< 0.01 %" : `${(p * 100).toFixed(2)} %`;
}
