import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Label } from "../../components/ui/Label";
import { DraftNumberInput } from "../../components/ui/DraftNumberInput";
import { ToolWindowFrame } from "../../components/ui/ToolWindowFrame";
import { useWidth } from "../../utils/use-width";
import { downloadFile, safeFileName } from "../../utils/download";
import { isElectron } from "../../utils/is-electron";
import { useToolWindowState } from "../../utils/tool-window-sync";
import { listVariables, sensitivityCsv, sensitivityValues } from "./sensitivity";
import type { SensitivityCommand, SensitivityWindowState } from "./window-sync";

const TITLE = "Sensitivity analysis";
const DESCRIPTION =
  "The minimum FOS of the active model for a range of values of one parameter or material property.";

/**
 * The Sensitivity window: run the active model for a range of values of
 * one parameter or material property and plot the minimum FOS. The main
 * window runs the analyses and sends the model and the results here.
 */
export function SensitivityDialogApp() {
  const state = useToolWindowState<SensitivityWindowState>({
    enabled: isElectron,
    request: () => window.cslope.requestSensitivityState(),
    onState: (l) => window.cslope.onSensitivityState(l),
    onChanged: (l) => window.cslope.onSensitivityChanged(l),
  });
  return (
    <SensitivityWindow
      state={state}
      onCommand={(command) => window.cslope.sendSensitivityCommand(command)}
    />
  );
}

/** The window's content for the given state (null: not there yet). */
export function SensitivityWindow({
  state,
  onCommand,
}: {
  state: SensitivityWindowState | null;
  onCommand: (command: SensitivityCommand) => void;
}) {
  if (!state) {
    return <ToolWindowFrame title={TITLE} description={DESCRIPTION} waiting />;
  }
  // The inputs belong to the model: another model starts afresh.
  return <SensitivityBody key={state.model.id} state={state} onCommand={onCommand} />;
}

function SensitivityBody({
  state,
  onCommand,
}: {
  state: SensitivityWindowState;
  onCommand: (command: SensitivityCommand) => void;
}) {
  const { model, designValues, running, points, total, label, runValue } = state;
  const variables = useMemo(() => listVariables(model), [model]);
  const [chartRef, chartWidth] = useWidth(430);
  const [key, setKey] = useState(variables[0]?.key ?? "");
  const selected = variables.find((v) => v.key === key);
  const defaultRange = (v: number) =>
    v === 0
      ? [-5, 5]
      : [Math.min(v * 0.8, v * 1.2), Math.max(v * 0.8, v * 1.2)].map(sig);
  const [from, setFrom] = useState(() => defaultRange(selected?.value ?? 0)[0]);
  const [to, setTo] = useState(() => defaultRange(selected?.value ?? 0)[1]);
  const [steps, setSteps] = useState(9);

  const chooseVariable = (next: string) => {
    setKey(next);
    const v = variables.find((o) => o.key === next);
    if (v) {
      const [a, b] = defaultRange(v.value);
      setFrom(a);
      setTo(b);
    }
  };
  // The variable was removed from the model: take the first one left.
  if (!selected && variables.length > 0) chooseVariable(variables[0].key);

  const data = points
    .filter((p) => p.fos != null)
    .map((p) => ({ value: p.value, fos: p.fos! }));
  const failed = points.filter((p) => p.fos == null);

  return (
    <ToolWindowFrame
      title={TITLE}
      description={DESCRIPTION}
      footer={
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {running ? (
            <button onClick={() => onCommand({ type: "cancel" })} className="btn">
              Cancel
            </button>
          ) : (
            <button
              onClick={() =>
                selected &&
                onCommand({
                  type: "run",
                  variable: selected.variable,
                  info: { key: selected.key, label: selected.label, value: selected.value },
                  values: sensitivityValues(from, to, steps),
                })
              }
              disabled={!selected || from === to}
              className="btn btn-primary min-w-[64px]"
            >
              Run
            </button>
          )}
          <span className="whitespace-nowrap" style={{ color: "var(--color-vsc-text-muted)" }}>
            {running ? `${points.length} / ${total}` : points.length > 0 ? `${data.length} of ${points.length} values gave a FOS` : ""}
          </span>
          <span className="flex-1" />
          {([false, true] as const).map((swedish) => (
            <button
              key={String(swedish)}
              onClick={() =>
                downloadFile(
                  safeFileName(`${model.name || "cslope"} sensitivity`, "csv"),
                  "\uFEFF" + sensitivityCsv(label, points, swedish),
                  "text/csv;charset=utf-8",
                )
              }
              disabled={points.length === 0 || running}
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
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-[12px]">
        {variables.length === 0 ? (
          <p style={{ color: "var(--color-vsc-text-muted)" }}>
            The model has no parameters or material values to vary.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-0.5">
              <Label>Vary</Label>
              <select value={key} onChange={(e) => chooseVariable(e.target.value)} aria-label="Variable">
                {variables.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}, now {round(v.value)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-0.5">
                <Label>From</Label>
                <DraftNumberInput value={from} onValueChange={setFrom} aria-label="From" />
              </label>
              <label className="flex flex-col gap-0.5">
                <Label>To</Label>
                <DraftNumberInput value={to} onValueChange={setTo} aria-label="To" />
              </label>
              <label className="flex flex-col gap-0.5">
                <Label>Number of values</Label>
                <DraftNumberInput
                  value={steps}
                  min={2}
                  max={101}
                  step={1}
                  onValueChange={(v) => v >= 2 && v <= 101 && setSteps(Math.round(v))}
                  aria-label="Number of values"
                />
              </label>
            </div>
            <p className="text-[10px]" style={{ color: "var(--color-vsc-text-muted)" }}>
              Each value is a full analysis of the model as it is now, with the
              current search settings.
            </p>
          </>
        )}

        {data.length > 0 && (
          <div aria-label="FOS against the varied value" ref={chartRef}>
            <LineChart width={chartWidth} height={240} data={data} margin={{ top: 10, right: 16, left: 0, bottom: 14 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,130,140,0.35)" />
                <XAxis
                  type="number"
                  dataKey="value"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
                  tickFormatter={(v) => String(round(Number(v)))}
                  label={{ value: label, position: "insideBottom", offset: -8, fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fontSize: 10, fill: "var(--color-vsc-text-muted)" }}
                  tickFormatter={(v) => Number(v).toFixed(2)}
                  width={44}
                />
                <ReferenceLine
                  y={1}
                  stroke="var(--color-vsc-error)"
                  strokeDasharray="4 3"
                  ifOverflow="extendDomain"
                  label={{ value: designValues ? "1.0 (design)" : "1.0", fontSize: 9, fill: "var(--color-vsc-error)", position: "insideTopRight" }}
                />
                {runValue != null && (
                  // The model's value of the variable that was run.
                  <ReferenceLine x={runValue} stroke="var(--color-vsc-text-muted)" strokeDasharray="2 3" />
                )}
                <Tooltip
                  contentStyle={{
                    background: "var(--color-vsc-input-bg)",
                    border: "1px solid var(--color-vsc-border)",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(v) => [Number(v).toFixed(3), "FOS"]}
                  labelFormatter={(v) => `${label} = ${round(Number(v))}`}
                />
                <Line type="monotone" dataKey="fos" stroke="#26a69a" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
            </LineChart>
          </div>
        )}

        {data.length === 0 && !running && points.length === 0 && selected && (
          // Before the first run: where the chart will be, and how to get it.
          <div
            className="h-[240px] rounded flex items-center justify-center text-[11px] text-center px-4"
            style={{ border: "1px dashed var(--color-vsc-border)", color: "var(--color-vsc-text-muted)" }}
            data-testid="sensitivity-empty"
          >
            Run to plot the FOS against {selected.label}.
          </div>
        )}

        {points.length > 0 && (
          // Two narrow columns side by side, easy to read across.
          <table className="w-auto min-w-[200px] text-[11px] tabular-nums">
            <thead>
              <tr style={{ color: "var(--color-vsc-text-muted)" }}>
                <th className="text-left font-normal pr-8">{label}</th>
                <th className="text-right font-normal">FOS</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i} title={p.error}>
                  <td className="pr-8">{round(p.value)}</td>
                  <td className="text-right">{p.fos == null ? "no surface" : p.fos.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {failed.length > 0 && !running && (
          <p className="text-[10px]" style={{ color: "var(--color-vsc-warning-text)" }}>
            {failed.length} value(s) gave no result; hover the row for the reason.
          </p>
        )}
      </div>
    </ToolWindowFrame>
  );
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Four significant digits (keeps small values distinct). */
function sig(v: number): number {
  return Number(v.toPrecision(4));
}
