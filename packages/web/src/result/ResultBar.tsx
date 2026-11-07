/**
 * The phone's result bar (below the two-column width, where the result card
 * is below the form): F with its label, a small picture of the section with
 * the critical surface, and a link to the card. The picture opens the
 * drawing across the whole screen, in a sheet that Close, Escape or a tap on
 * the drawing closes; the focus stays in the sheet while it is open and goes
 * back to the picture after.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ResultSummary, SliceData } from "@cslope/engine";
import { X } from "lucide-react";
import type { Layer } from "@/templates/common";
import { Section } from "@/section/Section";
import type { SectionShapes } from "@/section/section-geometry";

export interface ResultBarProps {
  summary: ResultSummary;
  /** The section drawn; null when there is none to show. */
  section: { shapes: SectionShapes; layers: Layer[]; slices: SliceData[] | null; label: string; caption: string } | null;
}

/** The drawing across the screen, as a modal sheet. */
function SectionSheet({ summary, section, onClose }: { summary: ResultSummary; section: NonNullable<ResultBarProps["section"]>; onClose: () => void }) {
  const headingId = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    // The page under the sheet does not scroll; Escape closes, Tab stays on Close (the sheet's only control).
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        e.preventDefault();
        close.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h2 id={headingId} className="text-sm font-semibold">
          Section
        </h2>
        <span className="text-sm tabular">F {summary.fosText}</span>
        <button
          ref={close}
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close the drawing"
          className="ml-auto grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {/* A tap on the drawing closes it too. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3" onClick={onClose}>
        <figure className="rounded-lg border bg-card p-3">
          <Section shapes={section.shapes} layers={section.layers} slices={section.slices} label={section.label} />
          <figcaption className="mt-1 text-xs text-muted-foreground">{section.caption}</figcaption>
        </figure>
      </div>
    </div>
  );
}

export function ResultBar({ summary, section }: ResultBarProps) {
  const [open, setOpen] = useState(false);
  const thumb = useRef<HTMLButtonElement>(null);
  const shown = open && section;
  const closeSheet = useCallback(() => {
    setOpen(false);
    thumb.current?.focus();
  }, []);
  return (
    <>
    <aside
      aria-label="Result summary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 text-sm">
        {section && (
          <button
            ref={thumb}
            type="button"
            onClick={() => (open ? closeSheet() : setOpen(true))}
            aria-label="Show the section"
            aria-haspopup="dialog"
            aria-expanded={!!shown}
            title="Show the section across the screen"
            className="h-10 w-16 shrink-0 overflow-hidden rounded-sm border bg-card p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Section thumbnail shapes={section.shapes} layers={section.layers} slices={section.slices} label="" />
          </button>
        )}
        <span className="shrink-0 font-semibold tabular">F {summary.fosText}</span>
        <span className="min-w-0 truncate text-muted-foreground">{summary.fosHeading}</span>
        <a href="#result" className="ml-auto shrink-0 text-primary underline-offset-4 hover:underline">
          Result
        </a>
      </div>
    </aside>
    {/* Not inside the bar: its backdrop filter would make it the sheet's frame. */}
    {shown && <SectionSheet summary={summary} section={section} onClose={closeSheet} />}
    </>
  );
}
