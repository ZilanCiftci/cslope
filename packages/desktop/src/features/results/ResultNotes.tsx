import { useState } from "react";
import type { AnalysisResult } from "@cslope/engine";
import { ChevronRight, Info, TriangleAlert } from "lucide-react";
import { HelpButton } from "../../components/ui/HelpButton";
import { closestPairWarning, discardedBySizeText, nonConvergedText } from "../../utils/result-summary";

/** Remembered per user: whether the notes are unfolded. */
const OPEN_KEY = "cslope-result-notes-open";

/** The documentation of the notes (Results › The summary › Notes). */
const NOTES_HELP = "results#notes";

interface ResultNote {
  key: string;
  text: string;
  /** Warnings are coloured; information is not. */
  warning: boolean;
  /** What the documentation explains about it, for the help button's name. */
  helpTopic?: string;
}

/** The notes of a limit equilibrium result, in the order they are shown. */
function resultNotes(result: AnalysisResult): ResultNote[] {
  const notes: ResultNote[] = [];
  const nonConverged = result.nonConvergedSurfaces ?? 0;
  if (nonConverged > 0) {
    notes.push({ key: "non-converged", text: nonConvergedText(nonConverged), warning: true, helpTopic: "Surfaces without equilibrium" });
  }
  const discarded = result.discardedBySize ?? 0;
  if (discarded > 0) {
    notes.push({ key: "discarded", text: discardedBySizeText(discarded), warning: false, helpTopic: "Skipped small surfaces" });
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
 * with a help button that opens its explanation in the documentation.
 */
export function ResultNotes({ result }: { result: AnalysisResult }) {
  const notes = resultNotes(result);
  const [open, setOpen] = useState(readOpen);
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
        {warnings > 0 ? (
          <TriangleAlert size={12} strokeWidth={1.75} aria-hidden />
        ) : (
          <Info size={12} strokeWidth={1.75} aria-hidden />
        )}
        <span className="flex-1">{notes.length === 1 ? "1 note" : `${notes.length} notes`}</span>
        <ChevronRight
          size={12}
          strokeWidth={1.75}
          aria-hidden
          style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }}
        />
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1 text-[11px]">
          {notes.map((n) => (
            <li
              key={n.key}
              className="flex items-start gap-1"
              style={{ color: n.warning ? "var(--color-vsc-warning-text)" : "var(--color-vsc-text)" }}
            >
              <span className="flex-1">{n.text}</span>
              {n.helpTopic && (
                <span className="mt-px">
                  <HelpButton topic={n.helpTopic} page={NOTES_HELP} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
