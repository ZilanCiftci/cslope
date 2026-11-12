/**
 * The result card: F, a factor of safety on characteristic values, with
 * the engine's own label, the method, the critical surface's entry and exit,
 * the surfaces searched; then the commands (run, cancel, the downloads of
 * the analysis document and of a cSlope project, the link) and a note that this is a template calculation to be checked before use in a design.
 * The engine's warnings are not shown: the page's users cannot act on them
 * (the geometry and the options are the template's), and the templates
 * avoid what they are about (TEMPLATE_OPTIONS); the app shows them.
 */
import type { ResultSummary, ValidationIssue } from "@cslope/engine";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorText } from "@/form/Form";
import { DOWNLOAD_URL, LIMITATIONS_URL, TEMPLATE_NOTE } from "@/links";

/** What the card shows. */
export type CardState =
  | { kind: "loading" }
  | { kind: "engine-failed"; message: string }
  /** The form cannot be built yet. */
  | { kind: "incomplete"; missing: number; errors: number }
  | { kind: "waiting" }
  | { kind: "running"; surfaces: number }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string }
  /** The engine refused the model: the issues it could not put at a field. */
  | { kind: "invalid"; general: ValidationIssue[] }
  | { kind: "complete"; summary: ResultSummary };

/** A short message after a command ("Link copied."); after a removed layer or a reset, with Undo. */
export interface Notice {
  /** A new id for each message, so that the same text is announced again. */
  id: number;
  text: string;
  /** Puts the draft back as it was before the change. */
  onUndo?: () => void;
}

export interface ResultCardProps {
  state: CardState;
  /** The last result, shown dimmed while the next one runs. */
  previous: ResultSummary | null;
  canRun: boolean;
  /** The document can be built (the engine is not needed for it). */
  canDownload: boolean;
  onRun: () => void;
  onCancel: () => void;
  onDownload: () => void;
  /** The project can be written: the document can be built, and no project is being written. */
  canDownloadProject: boolean;
  onDownloadProject: () => void;
  onCopyLink: () => void;
  /** A short message after a command ("Link copied."), with Undo after a structural change. */
  notice: Notice | null;
  /** The phone's result bar shows: on a phone the message floats just above it, not at the bottom. */
  aboveBar?: boolean;
}

function statusText(state: CardState): string {
  switch (state.kind) {
    case "loading":
      return "Loading the engine";
    case "engine-failed":
      return `The engine could not load: ${state.message}`;
    case "incomplete": {
      const parts: string[] = [];
      if (state.errors) parts.push(state.errors === 1 ? "correct the field marked in red" : `correct the ${state.errors} fields marked in red`);
      if (state.missing) parts.push(state.missing === 1 ? "fill in 1 empty field" : `fill in ${state.missing} empty fields`);
      const text = parts.join(" and ");
      return `To get F, ${text}.`;
    }
    case "waiting":
      return "Engine ready";
    case "running":
      return "Analyzing";
    case "cancelled":
      return "The analysis was cancelled. Run it again with Run.";
    case "failed":
      return `The analysis failed: ${state.message}`;
    case "invalid":
      return "The engine found errors in the model. Correct the fields marked in red.";
    case "complete":
      return "";
  }
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Value({ summary, dim }: { summary: ResultSummary; dim?: boolean }) {
  const cs = summary.criticalSurface;
  return (
    <div className={dim ? "opacity-50" : undefined}>
      {dim && <p className="mb-1 text-xs font-medium">Previous result</p>}
      <p className="text-4xl font-semibold tracking-tight tabular">
        F {summary.fosText}
      </p>
      <p className="mt-1 text-sm">{summary.fosHeading}</p>
      <dl className="mt-3 space-y-1 text-sm">
        <Row term="Method">{summary.method}</Row>
        {cs && <Row term="Entry, exit">{cs.entryExitText.replace(" / ", " and ")}</Row>}
        {cs && <Row term="Surface">{cs.text}</Row>}
        <Row term="Surfaces">
          {summary.surfacesText} searched
          {summary.nonConvergedText ? `; ${summary.nonConvergedText}` : ""}
        </Row>
      </dl>
    </div>
  );
}

export function ResultCard({ state, previous, canRun, canDownload, onRun, onCancel, onDownload, canDownloadProject, onDownloadProject, onCopyLink, notice, aboveBar = false }: ResultCardProps) {
  const status = statusText(state);
  const complete = state.kind === "complete" ? state : null;
  return (
    <section id="result" aria-labelledby="result-heading" className="rounded-lg border bg-card p-4">
      <h2 id="result-heading" className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        Result
      </h2>
      {complete && <Value summary={complete.summary} />}
      {!complete && previous && state.kind === "running" && <Value summary={previous} dim />}
      <p className="mt-2 min-h-5 text-sm text-muted-foreground">
        {/* Only the status is announced, not each count of surfaces. */}
        <span role="status">{status}</span>
        {state.kind === "running" && state.surfaces > 0 && <span className="tabular"> · {state.surfaces} surfaces</span>}
      </p>
      {state.kind === "invalid" && state.general.length > 0 && (
        <ul className="mt-1 space-y-1">
          {state.general.map((issue, i) => (
            <li key={i}>
              <ErrorText>{issue.message}</ErrorText>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {state.kind === "running" ? (
          <Button key="cancel" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button key="run" size="sm" onClick={onRun} disabled={!canRun} title={canRun ? "Run the analysis now; it also runs by itself when a value changes." : "Fill in the form to run."}>
            Run
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onDownload} disabled={!canDownload} title={canDownload ? "The analysis document, which cslope analyze runs." : "Fill in the form to download it."}>
          Download JSON
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDownloadProject}
          disabled={!canDownloadProject}
          title={canDownload ? "A cSlope project of this section with its result, which the cSlope app opens." : "Fill in the form to download it."}
        >
          Download .cslp
        </Button>
        <Button size="sm" variant="outline" onClick={onCopyLink} title="Copy the address of this section: the parameters are in it, nothing is stored.">
          Copy link
        </Button>
        <Button size="sm" variant="link" asChild>
          <a href={DOWNLOAD_URL}>Get the cSlope app</a>
        </Button>
      </div>
      {/*
        The message's one live region: in the card's status line, and on a phone (where the card is
        below the form, out of view) a toast fixed at the bottom of the screen, above the result bar.
      */}
      <div className="mt-2 min-h-4">
      <p
        aria-live="polite"
        className={cn(
          "text-xs text-muted-foreground",
          notice &&
            "max-sm:fixed max-sm:inset-x-3 max-sm:z-40 max-sm:rounded-md max-sm:border max-sm:bg-popover max-sm:px-3 max-sm:py-1.5 max-sm:text-sm max-sm:text-popover-foreground max-sm:shadow-lg",
          notice && (aboveBar ? "max-sm:bottom-[calc(3.5rem+env(safe-area-inset-bottom))]" : "max-sm:bottom-[calc(0.75rem+env(safe-area-inset-bottom))]"),
        )}
      >
        {notice && (
          <span key={notice.id}>
            {notice.text}
            {notice.onUndo && (
              <>
                {" "}
                <button type="button" onClick={notice.onUndo} className="inline-flex min-h-6 items-center font-medium text-primary underline underline-offset-2 hover:no-underline">
                  Undo
                </button>
              </>
            )}
          </span>
        )}
      </p>
      </div>
      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
        {TEMPLATE_NOTE} See the{" "}
        <a href={LIMITATIONS_URL} className="text-primary underline underline-offset-2">
          limitations
        </a>
        .
      </p>
    </section>
  );
}
