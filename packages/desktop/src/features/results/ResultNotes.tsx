import { useState } from "react";
import type { AnalysisResult } from "@cslope/engine";
import {
  closestPairWarning,
  DISCARDED_BY_SIZE_TITLE,
  discardedBySizeText,
  NON_CONVERGED_TITLE,
  nonConvergedText,
} from "../../utils/result-summary";

/** Remembered per user: whether the notes are unfolded. */
const OPEN_KEY = "cslope-result-notes-open";

interface ResultNote {
  key: string;
  text: string;
  /** Warnings are coloured; information is not. */
  warning: boolean;
  /** A longer explanation, shown on request. */
  detail?: string;
}

/** The notes of a limit equilibrium result, in the order they are shown. */
function resultNotes(result: AnalysisResult): ResultNote[] {
  const notes: ResultNote[] = [];
  const nonConverged = result.nonConvergedSurfaces ?? 0;
  if (nonConverged > 0) {
    notes.push({ key: "non-converged", text: nonConvergedText(nonConverged), warning: true, detail: NON_CONVERGED_TITLE });
  }
  const discarded = result.discardedBySize ?? 0;
  if (discarded > 0) {
    notes.push({ key: "discarded", text: discardedBySizeText(discarded), warning: false, detail: DISCARDED_BY_SIZE_TITLE });
  }
  const closest = closestPairWarning(result.criticalSurface);
  if (closest) notes.push({ key: "closest-pair", text: closest, warning: true });
  const splits = result.splitFailureCount ?? 0;
  if (splits > 0) {
    notes.push({ key: "splits", text: `${splits} material boundary split(s) failed — check the interior boundaries`, warning: true });
  }
  result.warnings?.forEach((w, i) => notes.push({ key: `${w.code}-${i}`, text: w.message, warning: true }));
  return notes;
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The notes of a result (surfaces left out, slices with N′ < 0, ...) as
 * one folded line, "3 notes", unfolded on a click; each note is one line,
 * with its explanation behind an info button instead of a long tooltip.
 */
export function ResultNotes({ result }: { result: AnalysisResult }) {
  const notes = resultNotes(result);
  const [open, setOpen] = useState(readOpen);
  const [detailOpen, setDetailOpen] = useState<string | null>(null);
  if (notes.length === 0) return null;
  const warnings = notes.filter((n) => n.warning).length;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Private window or blocked storage: the choice just is not kept.
    }
  };
  const colour = warnings > 0 ? "var(--color-vsc-warning-text)" : "var(--color-vsc-text-muted)";
  return (
    <div className="mt-1.5 border-t pt-1.5" style={{ borderColor: "var(--color-vsc-border)" }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-[11px] cursor-pointer"
        style={{ color: colour }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {warnings > 0 ? (
            <>
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </>
          )}
        </svg>
        <span className="flex-1">{notes.length === 1 ? "1 note" : `${notes.length} notes`}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1 text-[11px]">
          {notes.map((n) => (
            <li key={n.key} style={{ color: n.warning ? "var(--color-vsc-warning-text)" : "var(--color-vsc-text)" }}>
              <div className="flex items-start gap-1">
                <span className="flex-1">{n.text}</span>
                {n.detail && (
                  <button
                    type="button"
                    aria-label={detailOpen === n.key ? "Hide the explanation" : "Explain"}
                    aria-expanded={detailOpen === n.key}
                    onClick={() => setDetailOpen(detailOpen === n.key ? null : n.key)}
                    className="shrink-0 cursor-pointer rounded-sm px-0.5 leading-none"
                    style={{ color: "var(--color-vsc-text-muted)" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                  </button>
                )}
              </div>
              {n.detail && detailOpen === n.key && (
                <p className="mt-0.5 pl-2 border-l" style={{ color: "var(--color-vsc-text-muted)", borderColor: "var(--color-vsc-border)" }}>
                  {n.detail}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
