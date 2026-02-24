import type { AnalysisResult } from "../store/types";

interface Props {
  mode: "edit" | "result";
  result: AnalysisResult | null;
  snapToGrid: boolean;
  gridSnapSize: number;
  setSnapToGrid: (value: boolean) => void;
  setGridSnapSize: (size: number) => void;
  coordinateCount: number;
}

export function StatusBar({
  mode,
  result,
  snapToGrid,
  gridSnapSize,
  setSnapToGrid,
  setGridSnapSize,
  coordinateCount,
}: Props) {
  return (
    <div
      className="flex items-center h-6 px-4 text-[11px] shrink-0"
      style={{
        background: "var(--color-vsc-status)",
        borderTop: "1px solid var(--color-vsc-border)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="flex items-center gap-3">
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
                style={{
                  color:
                    result.minFOS < 1.0
                      ? "var(--color-vsc-error)"
                      : result.minFOS < 1.5
                        ? "var(--color-vsc-warning)"
                        : "var(--color-vsc-success)",
                }}
              >
                {result.minFOS.toFixed(3)}
              </strong>{" "}
              ({result.method})
            </span>
          </>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
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
          className="bg-transparent border border-(--color-vsc-border) rounded text-[11px] px-1 py-0 cursor-pointer disabled:opacity-40"
          style={{ color: "inherit" }}
        >
          <option value="0.1">0.1</option>
          <option value="0.25">0.25</option>
          <option value="0.5">0.5</option>
          <option value="1">1.0</option>
          <option value="2">2.0</option>
          <option value="5">5.0</option>
        </select>
        <span style={{ color: "var(--color-vsc-border)" }}>|</span>
        <span style={{ opacity: 0.6 }}>cSlope v0.1</span>
      </div>
    </div>
  );
}
