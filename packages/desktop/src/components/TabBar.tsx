import { useState } from "react";
import type { AnalysisRunState } from "../store/types";
import { EditModeIcon, ResultsModeIcon } from "./icons/ModeIcons";

interface Props {
  mode: "edit" | "result";
  setMode: (mode: "edit" | "result") => void;
  runState: AnalysisRunState;
  hasResult: boolean;
  onRun: () => void;
  onCancel: () => void;
  onRunAll: () => void;
  onReset: () => void;
  onResetAll: () => void;
}

export function TabBar({
  mode,
  setMode,
  runState,
  hasResult,
  onRun,
  onCancel,
  onRunAll,
  onReset,
  onResetAll,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="flex items-stretch h-9 shrink-0 gap-px"
      style={{
        background: "var(--color-vsc-tab-inactive)",
        borderBottom: "1px solid var(--color-vsc-border)",
      }}
    >
      <button
        onClick={() => setMode("edit")}
        className="px-5 text-[12px] font-medium cursor-pointer relative flex items-center gap-1.5"
        style={{
          background:
            mode === "edit" ? "var(--color-vsc-tab-active)" : "transparent",
          color:
            mode === "edit"
              ? "var(--color-vsc-text-bright)"
              : "var(--color-vsc-text-muted)",
          borderRight: "1px solid var(--color-vsc-border)",
        }}
      >
        <EditModeIcon />
        Edit
        {mode === "edit" && (
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
            style={{ background: "var(--color-vsc-accent)" }}
          />
        )}
      </button>

      <div
        className="flex items-stretch relative"
        style={{ borderRight: "1px solid var(--color-vsc-border)" }}
      >
        <button
          onClick={runState === "running" ? onCancel : onRun}
          className="px-4 text-[12px] font-medium cursor-pointer flex items-center gap-2 group"
          style={{ background: "transparent" }}
          title={
            runState === "running"
              ? "Cancel running analysis"
              : "Run analysis and view results"
          }
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] group-hover:scale-110 transition-transform"
            style={{
              background:
                runState === "running"
                  ? "var(--color-vsc-error, #f44747)"
                  : "var(--color-vsc-success)",
              color: "var(--color-vsc-bg)",
            }}
          >
            {runState === "running" ? "■" : "▶"}
          </div>
          <span
            style={{
              color:
                runState === "running"
                  ? "var(--color-vsc-error, #f44747)"
                  : "var(--color-vsc-success)",
            }}
          >
            {runState === "running" ? "Cancel" : "Run"}
          </span>
        </button>
        <button
          aria-label="Run menu"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={runState === "running"}
          className="px-2 text-[12px] font-medium cursor-pointer flex items-center disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "transparent",
            borderLeft: "1px solid var(--color-vsc-border)",
          }}
        >
          ▾
        </button>

        {menuOpen && (
          <div
            className="absolute top-full right-0 mt-1 min-w-[160px] rounded-md shadow-lg z-40"
            style={{
              background: "var(--color-vsc-input-bg)",
              border: "1px solid var(--color-vsc-border)",
            }}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              className="w-full text-left px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
              onClick={() => {
                setMenuOpen(false);
                onRunAll();
              }}
            >
              Run all
            </button>
            <div
              className="mx-2 my-1"
              style={{ borderTop: "1px solid var(--color-vsc-border)" }}
            />
            <button
              className="w-full text-left px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
              style={{
                color: hasResult
                  ? "var(--color-vsc-text)"
                  : "var(--color-vsc-badge)",
                pointerEvents: hasResult ? "auto" : "none",
              }}
              onClick={() => {
                setMenuOpen(false);
                onReset();
              }}
            >
              Reset
            </button>
            <button
              className="w-full text-left px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
              onClick={() => {
                setMenuOpen(false);
                onResetAll();
              }}
            >
              Reset all
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => {
          if (hasResult) setMode("result");
        }}
        className="px-5 text-[12px] font-medium cursor-pointer relative flex items-center gap-1.5"
        style={{
          background:
            mode === "result" ? "var(--color-vsc-tab-active)" : "transparent",
          color:
            mode === "result"
              ? "var(--color-vsc-text-bright)"
              : hasResult
                ? "var(--color-vsc-text-muted)"
                : "var(--color-vsc-badge)",
          borderRight: "1px solid var(--color-vsc-border)",
          pointerEvents: hasResult ? "auto" : "none",
        }}
      >
        <ResultsModeIcon />
        Results
        {hasResult && mode !== "result" && (
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--color-vsc-success)" }}
          />
        )}
        {mode === "result" && (
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
            style={{ background: "var(--color-vsc-accent)" }}
          />
        )}
      </button>

      <div className="flex-1" />
    </div>
  );
}
