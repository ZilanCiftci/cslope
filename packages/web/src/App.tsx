import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResultSummary, SliceData } from "@cslope/engine";
import { Header } from "@/components/Header";
import { CancelledError, type AnalysisClient, type RunOutcome } from "@/engine/client";
import { dumps, type AnalysisDocument } from "@/engine/document";
import { draftFields, formState, fromQuery, toQuery, type FormState } from "@/form/draft";
import { Form } from "@/form/Form";
import { issuesByField } from "@/form/issues";
import { ResultCard, type CardState } from "@/result/ResultCard";
import { Section } from "@/section/Section";
import { excavationDocument, excavationNotes, excavationTemplate, type ExcavationParams } from "@/templates/excavation";

/** The engine's state, shown while it loads. */
type EngineState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };

/** A run of a document (`key`: the document as JSON). */
type Run =
  | { kind: "running"; key: string; surfaces: number }
  | { kind: "done"; key: string; outcome: RunOutcome }
  | { kind: "failed"; key: string; message: string }
  | { kind: "cancelled"; key: string };

/** How long the form waits after a change before it runs (ms). */
const RUN_DELAY = 300;

/** The fields the drawing needs; the others (strengths, safety) do not change it. */
const GEOMETRY_FIELD = /^(groundLevel|excavationDepth|slope|bottomWidth|layers|layers\.\d+\.bottomLevel|road\.(distanceFromCrest|width|height))$/;

/** The parameters to draw, or null when a field of the geometry is empty or wrong. */
function drawable(form: FormState): ExcavationParams | null {
  const bad = (f: string) => GEOMETRY_FIELD.test(f);
  if (form.missing.some(bad) || [...form.errors.keys()].some(bad)) return null;
  const p = form.params;
  const ok = (f: string) => !form.errors.has(f) && !form.missing.includes(f);
  return {
    ...p,
    waterLevel: ok("waterLevel") ? p.waterLevel : null,
    road: p.road && { ...p.road, trafficLoad: ok("road.trafficLoad") ? p.road.trafficLoad : null },
  };
}

/** The document of a form that is ready, or the sentence of why the template could not build it. */
function buildDocument(form: FormState): { doc: AnalysisDocument | null; error: string | null } {
  if (!form.ready) return { doc: null, error: null };
  try {
    return { doc: excavationDocument(form.params), error: null };
  } catch (err) {
    return { doc: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App({ client }: { client: AnalysisClient }) {
  const [engine, setEngine] = useState<EngineState>({ kind: "loading" });
  const [draft, setDraft] = useState(() => fromQuery(window.location.search));
  const [run, setRun] = useState<Run | null>(null);
  const [previous, setPrevious] = useState<ResultSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runs = useRef(0);

  useEffect(() => {
    let current = true;
    client.ready().then(
      () => current && setEngine({ kind: "ready" }),
      (err: unknown) => current && setEngine({ kind: "failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      current = false;
    };
  }, [client]);

  // The address holds the parameters, so that the link opens this section;
  // written a moment after the last change (Safari refuses more than 100
  // changes of the address in a short time, and must not stop the page).
  useEffect(() => {
    const timer = setTimeout(() => {
      const query = toQuery(draft);
      if (window.location.search.slice(1) === query) return;
      try {
        window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
      } catch {
        // The address stays as it was; Copy link then gives the older one, which is what the browser shows.
      }
    }, RUN_DELAY);
    return () => clearTimeout(timer);
  }, [draft]);

  const form = useMemo(() => formState(draft), [draft]);
  const { doc, error: buildError } = useMemo(() => buildDocument(form), [form]);
  const key = useMemo(() => (doc ? JSON.stringify(doc) : null), [doc]);
  const notes = useMemo(() => (form.ready ? excavationNotes(form.params) : []), [form]);

  // The drawing keeps the last section it could draw while a geometry field is being typed.
  const shape = useMemo(() => drawable(form), [form]);
  const [lastShape, setLastShape] = useState(shape);
  if (shape && shape !== lastShape) setLastShape(shape);

  // The document last asked for: a change back to it, or the timer after Run, does not run it again.
  const lastKey = useRef<string | null>(null);
  const start = useCallback(
    (document: AnalysisDocument, docKey: string) => {
      lastKey.current = docKey;
      const id = ++runs.current;
      setRun({ kind: "running", key: docKey, surfaces: 0 });
      client
        .run(document, (surfaces) => id === runs.current && setRun({ kind: "running", key: docKey, surfaces }))
        .then(
          (outcome) => {
            if (id !== runs.current) return;
            setRun({ kind: "done", key: docKey, outcome });
            if (outcome.kind === "complete") setPrevious(outcome.summary);
          },
          (err: unknown) => {
            if (id !== runs.current) return;
            if (err instanceof CancelledError) setRun({ kind: "cancelled", key: docKey });
            else setRun({ kind: "failed", key: docKey, message: err instanceof Error ? err.message : String(err) });
          },
        );
    },
    [client],
  );

  // Runs by itself a moment after the last change of a form that is ready;
  // a form that is not stops the run going on.
  useEffect(() => {
    if (!doc || !key) {
      runs.current++;
      lastKey.current = null;
      client.cancel();
      return;
    }
    const timer = setTimeout(() => lastKey.current !== key && start(doc, key), RUN_DELAY);
    return () => clearTimeout(timer);
  }, [client, doc, key, start]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const current = run && run.key === key ? run : null;
  const outcome = current?.kind === "done" ? current.outcome : null;
  const engineIssues = useMemo(() => {
    if (outcome?.kind !== "invalid") return null;
    const shown = new Set([...draftFields(draft).map(([f]) => f), ...draft.layers.map((_, i) => `layers.${i}.name`)]);
    return issuesByField(outcome.issues, form.params, shown);
  }, [outcome, form.params, draft]);
  const errors = useMemo(() => {
    if (!engineIssues?.fields.size) return form.errors;
    const merged = new Map(engineIssues.fields);
    for (const [k, v] of form.errors) merged.set(k, v);
    return merged;
  }, [form.errors, engineIssues]);

  let state: CardState;
  if (engine.kind === "failed") state = { kind: "engine-failed", message: engine.message };
  else if (!form.ready) state = { kind: "incomplete", missing: form.missing.length, errors: form.errors.size };
  else if (buildError) state = { kind: "failed", message: buildError };
  else if (current?.kind === "running") state = { kind: "running", surfaces: current.surfaces };
  else if (current?.kind === "cancelled") state = { kind: "cancelled" };
  else if (current?.kind === "failed") state = { kind: "failed", message: current.message };
  else if (engineIssues) state = { kind: "invalid", general: engineIssues.general, warnings: engineIssues.warnings };
  else if (outcome?.kind === "complete") state = { kind: "complete", summary: outcome.summary, warnings: outcome.warnings };
  else state = engine.kind === "loading" ? { kind: "loading" } : { kind: "waiting" };

  const slices: SliceData[] | null = outcome?.kind === "complete" ? outcome.result.criticalSlices : null;
  const drawn = lastShape;
  const sectionLabel = drawn
    ? `Section of the excavation: ${drawn.layers.length === 1 ? "1 layer" : `${drawn.layers.length} layers`}${drawn.waterLevel !== null ? `, ground water at ${drawn.waterLevel} m` : ""}${drawn.road ? ", a working road" : ""}${slices && outcome?.kind === "complete" ? `, and the critical surface of F ${outcome.summary.fosText}` : ""}.`
    : "";

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 lg:pb-6">
        <h1 className="text-xl font-semibold tracking-tight">{excavationTemplate.title}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {excavationTemplate.description} F is computed on your own computer by the cSlope engine.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <Form draft={draft} onChange={setDraft} errors={errors} notes={notes} />
          <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <figure className="rounded-lg border bg-card p-3">
              {drawn ? (
                <Section params={drawn} slices={slices} label={sectionLabel} />
              ) : (
                <p className="p-6 text-sm text-muted-foreground">The section is drawn when the geometry is filled in.</p>
              )}
              <figcaption className="mt-1 text-xs text-muted-foreground">Elevation and distance from the crest (m).</figcaption>
            </figure>
            <ResultCard
              state={state}
              previous={previous}
              canRun={!!doc && engine.kind !== "failed"}
              canDownload={!!doc}
              onRun={() => doc && key && start(doc, key)}
              onCancel={() => client.cancel()}
              onDownload={() => doc && download("cslope-excavation.json", dumps(doc))}
              onCopyLink={() => {
                const copied = navigator.clipboard?.writeText(window.location.href);
                if (!copied) setNotice("Copy the address from the address bar.");
                else
                  copied.then(
                    () => setNotice("Link copied."),
                    () => setNotice("The link could not be copied; copy the address from the address bar."),
                  );
              }}
              notice={notice}
            />
          </div>
        </div>
      </main>
      {/* On a phone the result card is below the form: a bar keeps F in view. */}
      {state.kind === "complete" && (
        <aside aria-label="Result summary" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur lg:hidden">
          <div className="mx-auto flex h-11 max-w-6xl items-center gap-3 px-4 text-sm">
            <span className="font-semibold tabular">F {state.summary.fosText}</span>
            <span className="min-w-0 truncate text-muted-foreground">{state.summary.fosLabel === "over-design factor" ? "Over-design factor" : "Factor of safety"}</span>
            <a href="#result" className="ml-auto text-primary underline-offset-4 hover:underline">
              Result
            </a>
          </div>
        </aside>
      )}
    </>
  );
}
