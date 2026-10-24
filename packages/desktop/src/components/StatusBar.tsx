import type { AnalysisResult, RunState } from "../store/types";
import { APP_VERSION } from "../utils/app-version";
import { fosStatusColor } from "../utils/fos-color";

interface Props {
  mode: "edit" | "result";
  runState: RunState;
  result: AnalysisResult | null;
  /** The FOS is on design values (partial factors applied). */
  designValues?: boolean;
  /** The error of a failed run (shown while `runState` is "error"). */
  errorMessage?: string | null;
  snapToGrid: boolean;
  gridSnapSize: number;
  setSnapToGrid: (value: boolean) => void;
  setGridSnapSize: (size: number) => void;
  coordinateCount: number;
  cursorWorld: [number, number] | null;
}

export function StatusBar({
  mode,
  runState,
  result,
  designValues = false,
  errorMessage = null,
  snapToGrid,
  gridSnapSize,
  setSnapToGrid,
  setGridSnapSize,
  coordinateCount,
  cursorWorld,
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
        {runState === "running" && (
          <>
            <span style={{ color: "var(--color-vsc-border)" }}>|</span>
            <span style={{ color: "var(--color-vsc-accent)", fontWeight: 600 }}>
              Analysing...
            </span>
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
          className="bg-transparent border border-(--color-vsc-border) rounded text-[11px] px-1 py-0 cursor-pointer disabled:opacity-40"
          style={{ color: "inherit" }}
        >
          <option value="0.1">0.1 m</option>
          <option value="0.25">0.25 m</option>
          <option value="0.5">0.5 m</option>
          <option value="1">1.0 m</option>
          <option value="2">2.0 m</option>
          <option value="5">5.0 m</option>
        </select>
        <span style={{ color: "var(--color-vsc-border)" }}>|</span>
        {cursorWorld ? (
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
        <span style={{ opacity: 0.6 }}>
          {APP_VERSION ? `cSlope v${APP_VERSION}` : "cSlope"}
        </span>
      </div>
    </div>
  );
}
