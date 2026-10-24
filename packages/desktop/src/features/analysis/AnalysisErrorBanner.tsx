import { useEffect, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { isElectron } from "../../utils/is-electron";
import { isNoSlipSurfaceError } from "./analysis-error";

/**
 * The error of a failed run, over the edit canvas (the results sidebar shows
 * it in results mode).  Dismissed until the next run or another model.
 */
export function AnalysisErrorBanner() {
  const mode = useAppStore((s) => s.mode);
  const runState = useAppStore((s) => s.runState);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  // The "click a region to assign" hint sits at the top centre too.
  const assigning = useAppStore((s) => s.assigningMaterialId !== null);

  const errorKey =
    runState === "error" ? `${activeModelId}\n${errorMessage ?? ""}` : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // A new run shows its error again, even when it is the same message. The
  // store is watched directly: a run that fails at once (an expression
  // error) sets "running" and "error" in one call, so no render sees it.
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (s.runState === "running" && prev.runState !== "running") setDismissedKey(null);
      }),
    [],
  );

  if (mode !== "edit" || errorKey === null || dismissedKey === errorKey) {
    return null;
  }

  const openSearchLimits = () => {
    setActiveSection("Search Limits");
    if (isElectron) window.cslope.openSearchLimitsDialog();
  };

  return (
    <div
      role="alert"
      data-testid="analysis-error-banner"
      className={`absolute ${assigning ? "top-14" : "top-3"} left-1/2 -translate-x-1/2 z-20 flex items-start gap-2.5 pl-3 pr-1.5 py-2 rounded-md shadow-lg text-[12px]`}
      style={{
        width: "min(640px, calc(100% - 32px))",
        background:
          "color-mix(in srgb, var(--color-vsc-error) 10%, var(--color-vsc-panel))",
        border: "1px solid var(--color-vsc-error)",
        color: "var(--color-vsc-text)",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-vsc-error)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 mt-px"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 7v6M12 16.5v.5" />
      </svg>
      <div className="flex-1 min-w-0">
        <div
          className="font-semibold"
          style={{ color: "var(--color-vsc-error)" }}
        >
          Analysis failed
        </div>
        <div className="mt-0.5 break-words">{errorMessage}</div>
      </div>
      {isNoSlipSurfaceError(errorMessage) && (
        <button
          onClick={openSearchLimits}
          className="shrink-0 self-center px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer"
          style={{
            border: "1px solid var(--color-vsc-border)",
            background: "var(--color-vsc-input-bg)",
            color: "var(--color-vsc-text)",
          }}
        >
          Search limits…
        </button>
      )}
      <button
        onClick={() => setDismissedKey(errorKey)}
        aria-label="Dismiss"
        title="Dismiss"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        ✕
      </button>
    </div>
  );
}
