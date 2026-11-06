import { useEffect, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { useAppStore } from "../../store/app-store";
import { useLinePick } from "../drawings/line-pick-store";
import { isElectron } from "../../utils/is-electron";
import {
  isNoSlipSurfaceError,
  limitsDirectionMessage,
  limitsDirectionMismatch,
} from "./analysis-error";

/**
 * The error of a failed run, over the canvas in both modes (the results
 * sidebar's summary repeats it). Dismissed until the next run or another
 * model. When no surface was found and the search limits are drawn for the
 * other sliding direction, it says so and offers to switch.
 */
export function AnalysisErrorBanner() {
  const runState = useAppStore((s) => s.runState);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const activeModelId = useAppStore((s) => s.activeModelId);
  // The "click a region to assign" hint and the pick-lines bar sit at the
  // top centre too: the banner moves down below them.
  const assigning = useAppStore((s) => s.assigningMaterialId !== null);
  const pickingLines = useLinePick((s) => !!s.placementId);
  const limits = useAppStore((s) => s.analysisLimits);
  const orientation = useAppStore((s) => s.orientation);

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

  if (errorKey === null || dismissedKey === errorKey) {
    return null;
  }

  const noSurface = isNoSlipSurfaceError(errorMessage);
  const drawnFor = noSurface ? limitsDirectionMismatch(limits, orientation) : null;

  const openSearchLimits = () => {
    // The limits are what the message is about: select them on the canvas.
    const st = useAppStore.getState();
    if (st.analysisLimits.enabled) st.selectCanvasObject({ type: "searchLimits" });
    if (isElectron) window.cslope.openSearchLimitsDialog();
  };

  return (
    <div
      role="alert"
      data-testid="analysis-error-banner"
      className={`absolute ${pickingLines ? "top-20" : assigning ? "top-14" : "top-3"} left-1/2 -translate-x-1/2 z-20 flex items-start gap-2.5 pl-3 pr-1.5 py-2 rounded-xs text-[12px]`}
      style={{
        width: "min(640px, calc(100% - 32px))",
        boxShadow: "var(--color-vsc-shadow-float)",
        background:
          "color-mix(in srgb, var(--color-vsc-error) 10%, var(--color-vsc-panel))",
        border: "1px solid var(--color-vsc-error)",
        color: "var(--color-vsc-text)",
      }}
    >
      <CircleAlert
        size={16}
        strokeWidth={1.75}
        className="shrink-0 mt-px"
        style={{ color: "var(--color-vsc-error)" }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        {/* The heading in the text colour: the red is on the icon and the
            border (the error colour on its tint is below 4.5:1). */}
        <div className="font-semibold">Analysis failed</div>
        {/* The specific cause first, the general message after it. */}
        {drawnFor && (
          <div className="mt-0.5 break-words font-semibold" data-testid="limits-direction-hint">
            {limitsDirectionMessage(drawnFor)}
          </div>
        )}
        <div className="mt-0.5 break-words">{errorMessage}</div>
      </div>
      {drawnFor && (
        <button
          onClick={() => useAppStore.getState().setOrientation(drawnFor)}
          className="btn shrink-0 self-center"
        >
          {drawnFor === "ltr" ? "Use left to right" : "Use right to left"}
        </button>
      )}
      {noSurface && (
        <button
          onClick={openSearchLimits}
          className="btn shrink-0 self-center"
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
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
