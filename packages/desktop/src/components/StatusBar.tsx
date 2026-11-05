import { useEffect, useState, type ReactNode } from "react";
import type { AnalysisResult, RunAllStatus, RunState } from "../store/types";
import { APP_VERSION } from "../utils/app-version";
import { elapsedText } from "../utils/elapsed-text";
import { fosStatusColor } from "../utils/fos-color";

interface Props {
  mode: "edit" | "result";
  runState: RunState;
  result: AnalysisResult | null;
  /** The FOS is on design values (partial factors applied). */
  designValues?: boolean;
  /** The error of a failed run (shown while `runState` is "error"). */
  errorMessage?: string | null;
  /** What the run is doing (the finite element analysis's stage), shown while it runs. */
  runStage?: string | null;
  /** When the run started (ms since the epoch): its elapsed time is shown while it runs. */
  runStartedAt?: number | null;
  snapToGrid: boolean;
  gridSnapSize: number;
  setSnapToGrid: (value: boolean) => void;
  setGridSnapSize: (size: number) => void;
  coordinateCount: number;
  cursorWorld: [number, number] | null;
  /** A Run All batch: its progress while it runs, then its summary. */
  runAll?: RunAllStatus | null;
  /** The edit canvas's selection and locks, after the point count. */
  selectionStatus?: ReactNode;
}

/** "Run All 7/20" and a small bar while the batch runs, then its outcome. */
function RunAllProgress({ status }: { status: RunAllStatus }) {
  const { total, finished, failed, progress, running } = status;
  return (
    <>
      <span style={{ color: "var(--color-vsc-border)" }}>|</span>
      {running ? (
        <span
          data-testid="status-run-all"
          className="flex items-center gap-1.5"
          style={{ color: "var(--color-vsc-accent)", fontWeight: 600 }}
        >
          Run all {finished}/{total}
          <span
            role="progressbar"
            aria-label="Run all progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="inline-block w-16 h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--color-vsc-input-bg)" }}
          >
            {/* No width transition: the batch updates it every 120 ms, and
                with every core busy each transition restarted from where
                the last one had not yet moved, so the bar stood still. */}
            <span
              className="block h-1.5 rounded-full"
              style={{
                width: `${Math.max(2, Math.round(progress * 100))}%`,
                background: "var(--color-vsc-accent)",
              }}
            />
          </span>
        </span>
      ) : (
        <span data-testid="status-run-all">
          Run all done: {total} {total === 1 ? "model" : "models"}
          {failed > 0 && (
            <span style={{ color: "var(--color-vsc-error)", fontWeight: 600 }}>, {failed} failed</span>
          )}
        </span>
      )}
    </>
  );
}

/** The time since `since`, counting each second: the run is alive. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span data-testid="status-run-elapsed" className="tabular-nums" title="Time since the run started" style={{ opacity: 0.8 }}>
      {elapsedText(now - since)}
    </span>
  );
}

export function StatusBar({
  mode,
  runState,
  result,
  designValues = false,
  errorMessage = null,
  runStage = null,
  runStartedAt = null,
  snapToGrid,
  gridSnapSize,
  setSnapToGrid,
  setGridSnapSize,
  coordinateCount,
  cursorWorld,
  runAll = null,
  selectionStatus = null,
}: Props) {
  return (
    <div
      data-testid="status-bar"
      className="flex items-center h-6 px-4 text-[11px] shrink-0"
      style={{
        background: "var(--color-vsc-status)",
        borderTop: "1px solid var(--color-vsc-border)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex items-center gap-1">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background:
                mode === "edit"
                  ? "var(--color-vsc-accent)"
                  : "var(--color-vsc-success)",
            }}
          />
          {mode === "edit" ? "EDIT" : "RESULT"}
        </span>
        <span style={{ color: "var(--color-vsc-border)" }}>|</span>
        <span>Points: {coordinateCount}</span>
        {selectionStatus}
        {result && (
          <>
            <span style={{ color: "var(--color-vsc-border)" }}>|</span>
            <span>
              FOS:{" "}
              <strong
                style={{ color: fosStatusColor(result.minFOS, designValues) }}
              >
                {result.minFOS.toFixed(3)}
              </strong>{" "}
              ({result.method})
            </span>
          </>
        )}
        {runAll && <RunAllProgress status={runAll} />}
        {runState === "running" && !runAll?.running && (
          <>
            <span style={{ color: "var(--color-vsc-border)" }}>|</span>
            <span style={{ color: "var(--color-vsc-accent)", fontWeight: 600 }}>
              Analyzing...
            </span>
            {runStage && (
              <span data-testid="status-run-stage" className="truncate" title={runStage}>
                {runStage}
              </span>
            )}
            {runStartedAt !== null && <Elapsed since={runStartedAt} />}
          </>
        )}
        {runState === "error" && (
          <>
            <span style={{ color: "var(--color-vsc-border)" }}>|</span>
            <span
              role="status"
              data-testid="status-run-error"
              className="truncate"
              title={errorMessage ?? undefined}
              style={{ color: "var(--color-vsc-error)", fontWeight: 600 }}
            >
              Analysis failed{errorMessage ? `: ${errorMessage}` : ""}
            </span>
          </>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2 shrink-0 pl-3">
        <label className="flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={snapToGrid}
            onChange={(e) => setSnapToGrid(e.target.checked)}
            className="accent-blue-500 w-3 h-3"
          />
          <span>Snap</span>
        </label>
        <select
          value={gridSnapSize}
          onChange={(e) => setGridSnapSize(parseFloat(e.target.value))}
          disabled={!snapToGrid}
          aria-label="Snap grid size"
          title="Snap grid size (m)"
          className="text-[11px] min-h-0 h-[18px] py-0"
        >
          <option value="0.1">0.1 m</option>
          <option value="0.25">0.25 m</option>
          <option value="0.5">0.5 m</option>
          <option value="1">1.0 m</option>
          <option value="2">2.0 m</option>
          <option value="5">5.0 m</option>
        </select>
        <span style={{ color: "var(--color-vsc-border)" }}>|</span>
        {cursorWorld && cursorWorld.every(Number.isFinite) ? (
          <span className="font-mono">
            X:{" "}
            <span className="inline-block w-12 text-right">
              {cursorWorld[0].toFixed(2)}
            </span>{" "}
            &nbsp; Y:{" "}
            <span className="inline-block w-12 text-right">
              {cursorWorld[1].toFixed(2)}
            </span>
          </span>
        ) : (
          <span className="font-mono">
            X:{" "}
            <span
              className="inline-block w-12 text-right"
              style={{ opacity: 0.4 }}
            >
              —
            </span>{" "}
            &nbsp; Y:{" "}
            <span
              className="inline-block w-12 text-right"
              style={{ opacity: 0.4 }}
            >
              —
            </span>
          </span>
        )}
        <span style={{ color: "var(--color-vsc-border)" }}>|</span>
        <span style={{ color: "var(--color-vsc-text-muted)" }}>
          {APP_VERSION ? `cSlope v${APP_VERSION}` : "cSlope"}
        </span>
      </div>
    </div>
  );
}
