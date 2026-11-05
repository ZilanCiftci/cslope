import { useAppStore } from "../../store/app-store";
import { limitsDirectionMessage, limitsDirectionMismatch } from "./analysis-error";

/**
 * A warning, before any run, when the search limits are drawn for the other
 * sliding direction (they would find no surface), with a button that turns
 * the direction round. Nothing when they agree.
 */
export function LimitsDirectionWarning() {
  const limits = useAppStore((s) => s.analysisLimits);
  const orientation = useAppStore((s) => s.orientation);
  const setOrientation = useAppStore((s) => s.setOrientation);
  const drawnFor = limitsDirectionMismatch(limits, orientation);
  if (!drawnFor) return null;
  return (
    <div
      role="status"
      data-testid="limits-direction-warning"
      className="col-span-2 flex flex-col gap-1.5 px-2 py-1.5 rounded-xs text-[11px]"
      style={{
        background: "color-mix(in srgb, var(--color-vsc-warning) 12%, transparent)",
        border: "1px solid var(--color-vsc-warning)",
        color: "var(--color-vsc-text)",
      }}
    >
      <span>{limitsDirectionMessage(drawnFor)} No slip surface will be found.</span>
      <button type="button" className="btn self-start" onClick={() => setOrientation(drawnFor)}>
        {drawnFor === "ltr" ? "Use left to right" : "Use right to left"}
      </button>
    </div>
  );
}
