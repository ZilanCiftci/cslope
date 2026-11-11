import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult, ResultSummary, SliceData } from "@cslope/engine";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { CancelledError, type AnalysisClient, type RunOutcome } from "@/engine/client";
import { dumps, type AnalysisDocument } from "@/engine/document";
import { projectFileName, writeProject as writeEngineProject, type ProjectFile } from "@/engine/project";
import { draftFields, formState, fromQuery, headerIdOf, initialDraft, toQuery, type Draft, type FormState, type TemplateId } from "@/form/draft";
import { Choices, Form } from "@/form/Form";
import { issuesByField } from "@/form/issues";
import { SPECS, specOf, type AnySpec, type TemplateParams } from "@/form/specs";
import { ResultBar } from "@/result/ResultBar";
import { ResultCard, type CardState, type Notice } from "@/result/ResultCard";
import { Section } from "@/section/Section";

/** The engine's state, shown while it loads. */
type EngineState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };

/** A run of a document (`key`: the document as JSON). */
type Run =
  | { kind: "running"; key: string; surfaces: number }
  | { kind: "done"; key: string; outcome: RunOutcome }
  | { kind: "failed"; key: string; message: string }
  | { kind: "cancelled"; key: string };

/** The fields of the layers' geometry: the list and each thickness. */
const LAYER_GEOMETRY = /^layers(\.\d+\.thickness)?$/;

/** How long the form waits after a change before it runs (ms). */
const RUN_DELAY = 300;

/** How long a message shows (ms); one with Undo, longer. */
const NOTICE_TIME = 4000;
const UNDO_TIME = 8000;

/** The form's first field, which gets the focus after a reset is undone. */
const firstField = () => document.querySelector<HTMLElement>('form[aria-label="Parameters"] :is(input, select)');

/** The parameters to draw, or null when a field of the geometry is empty or wrong. */
function drawable(spec: AnySpec, form: FormState): TemplateParams | null {
  const bad = (f: string) => spec.geometry.test(f);
  if (form.missing.some(bad) || [...form.errors.keys()].some(bad)) return null;
  return spec.drawable(form.params, (f: string) => !form.errors.has(f) && !form.missing.includes(f));
}

/** The document of a form that is ready, or the sentence of why the template could not build it. */
function buildDocument(spec: AnySpec, form: FormState): { doc: AnalysisDocument | null; error: string | null } {
  if (!form.ready) return { doc: null, error: null };
  try {
    return { doc: spec.template.toDocument(form.params), error: null };
  } catch (err) {
    return { doc: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function download(name: string, data: string | Uint8Array<ArrayBuffer>, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface AppProps {
  client: AnalysisClient;
  /** Writes the .cslp project (default: the engine's project writer, loaded on the first download). */
  writeProject?: (doc: AnalysisDocument, result: AnalysisResult | null, name: string) => Promise<ProjectFile>;
}

export function App({ client, writeProject = writeEngineProject }: AppProps) {
  const [engine, setEngine] = useState<EngineState>({ kind: "loading" });
  const [draft, setDraft] = useState(() => fromQuery(window.location.search));
  const spec = specOf(draft.template);
  // Each template's last draft, so that switching back finds it as it was.
  const drafts = useRef<Partial<Record<TemplateId, Draft>>>({});
  const switchTo = (id: TemplateId) => {
    if (id === draft.template) return;
    drafts.current[draft.template] = draft;
    setDraft(drafts.current[id] ?? initialDraft(id));
    setPrevious(null);
    // An Undo would bring back the other template's draft.
    setNoticeState(null);
  };
  const [run, setRun] = useState<Run | null>(null);
  const [previous, setPrevious] = useState<ResultSummary | null>(null);
  const [notice, setNoticeState] = useState<Notice | null>(null);
  const notices = useRef(0);
  const setNotice = (text: string, onUndo?: () => void) => setNoticeState({ id: ++notices.current, text, onUndo });
  const runs = useRef(0);

  // Undo of the last structural change (a removed layer, a reset): the draft before it comes back whole, and the focus goes where the change was.
  const focusAfterUndo = useRef<(() => HTMLElement | null) | null>(null);
  const offerUndo = (text: string, before: Draft, focus: () => HTMLElement | null) =>
    setNotice(text, () => {
      setDraft(before);
      setNoticeState(null);
      focusAfterUndo.current = focus;
    });
  useEffect(() => {
    const focus = focusAfterUndo.current;
    if (!focus) return;
    focusAfterUndo.current = null;
    focus()?.focus();
  });
  // Back to the template's defaults (the first visit's values).
  const resetDraft = () => {
    setDraft(initialDraft(draft.template));
    setPrevious(null);
    offerUndo("Reset to the template's defaults.", draft, firstField);
  };
  const onRemoveLayer = (index: number, before: Draft) => {
    const layer = before.layers[index];
    offerUndo(`Removed ${layer.name.trim() || `Layer ${index + 1}`}.`, before, () => document.getElementById(headerIdOf(layer)));
  };

  // The tab's title names the template.
  useEffect(() => {
    document.title = `${spec.template.title} — cSlope`;
  }, [spec]);

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
  const { doc, error: buildError } = useMemo(() => buildDocument(spec, form), [spec, form]);
  const key = useMemo(() => (doc ? JSON.stringify(doc) : null), [doc]);
  const notes = useMemo(() => (form.ready ? spec.template.notes(form.params) : []), [spec, form]);

  // The drawing keeps the last section it could draw while a geometry field is being typed;
  // while the layers cannot be built, only its outline, greyed (not layers that are no longer there).
  const shape = useMemo(() => drawable(spec, form), [spec, form]);
  const layersBroken = form.missing.some((f) => LAYER_GEOMETRY.test(f)) || [...form.errors.keys()].some((f) => LAYER_GEOMETRY.test(f));
  const [lastShape, setLastShape] = useState(() => ({ template: draft.template, params: shape }));
  if (shape && shape !== lastShape.params) setLastShape({ template: draft.template, params: shape });

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
    const timer = setTimeout(() => setNoticeState(null), notice.onUndo ? UNDO_TIME : NOTICE_TIME);
    return () => clearTimeout(timer);
  }, [notice]);

  const current = run && run.key === key ? run : null;
  const outcome = current?.kind === "done" ? current.outcome : null;
  const engineIssues = useMemo(() => {
    if (outcome?.kind !== "invalid") return null;
    const shown = new Set([...draftFields(draft).map(([f]) => f), ...draft.layers.map((_, i) => `layers.${i}.name`)]);
    return issuesByField(outcome.issues, spec.targets(form.params), shown);
  }, [outcome, form.params, draft, spec]);
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
  else if (engineIssues) state = { kind: "invalid", general: engineIssues.general };
  else if (outcome?.kind === "complete") state = { kind: "complete", summary: outcome.summary };
  else state = engine.kind === "loading" ? { kind: "loading" } : { kind: "waiting" };

  // The project of the section, with the result only when it is this document's (a run of other
  // input, or one not finished, leaves the project without a result).
  const [writing, setWriting] = useState(false);
  const downloadProject = () => {
    if (!doc || writing) return;
    const result = outcome?.kind === "complete" ? outcome.result : null;
    const fileName = projectFileName(spec.fileName);
    setWriting(true);
    writeProject(doc, result, spec.template.title)
      .then(
        (file) => {
          download(fileName, file.bytes as Uint8Array<ArrayBuffer>, "application/zip");
          if (!file.resultSaved) setNotice("Downloaded without a result: F is not computed yet.");
        },
        (err: unknown) => setNotice(`The project could not be written: ${err instanceof Error ? err.message : String(err)}`),
      )
      .finally(() => setWriting(false));
  };

  const slices: SliceData[] | null = outcome?.kind === "complete" ? outcome.result.criticalSlices : null;
  const drawn = lastShape.template === draft.template ? lastShape.params : null;
  const outlineOnly = !!drawn && !shape && layersBroken;
  const sectionLabel = !drawn
    ? ""
    : outlineOnly
      ? "Outline of the section; the layers are drawn when they are correct."
      : `Section of ${spec.describe(drawn)}${slices && outcome?.kind === "complete" ? `, and the critical surface of F ${outcome.summary.fosText}` : ""}.`;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-6">
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span id="template-label" className="text-xs text-muted-foreground">
            Template
          </span>
          <Choices wrap labelledBy="template-label" value={draft.template} onChange={switchTo} options={SPECS.map((s) => ({ value: s.template.id as TemplateId, label: s.template.title }))} />
          <Button size="sm" variant="outline" className="sm:ml-auto" onClick={resetDraft} title="Put every field back to the template's defaults.">
            Reset to defaults
          </Button>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{spec.template.title}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {spec.template.description} F is computed on your own computer by the cSlope engine.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <Form key={draft.template} spec={spec} draft={draft} onChange={setDraft} errors={errors} missing={form.missing} notes={notes} onRemoveLayer={onRemoveLayer} />
          <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <figure className="rounded-lg border bg-card p-3">
              {drawn ? (
                <Section shapes={spec.shapes(drawn)} layers={drawn.layers} slices={slices} label={sectionLabel} outlineOnly={outlineOnly} />
              ) : (
                <p className="p-6 text-sm text-muted-foreground">The section is drawn when the geometry is filled in.</p>
              )}
              <figcaption className="mt-1 text-xs text-muted-foreground">{outlineOnly ? `Fix the layers to draw the section. ${spec.caption}` : spec.caption}</figcaption>
            </figure>
            <ResultCard
              state={state}
              previous={previous}
              canRun={!!doc && engine.kind !== "failed"}
              canDownload={!!doc}
              onRun={() => doc && key && start(doc, key)}
              onCancel={() => client.cancel()}
              onDownload={() => doc && download(spec.fileName, dumps(doc))}
              canDownloadProject={!!doc && !writing}
              onDownloadProject={downloadProject}
              onCopyLink={() => {
                // (no clipboard outside a secure context)
                const clipboard = navigator.clipboard as Clipboard | undefined;
                if (!clipboard) setNotice("Copy the address from the address bar.");
                else
                  clipboard.writeText(window.location.href).then(
                    () => setNotice("Link copied."),
                    () => setNotice("The link could not be copied; copy the address from the address bar."),
                  );
              }}
              notice={notice}
              aboveBar={state.kind === "complete"}
            />
          </div>
        </div>
      </main>
      {/* On a phone the result card is below the form: a bar keeps F and a picture of the section in view. */}
      {state.kind === "complete" && (
        <ResultBar
          summary={state.summary}
          section={drawn && !outlineOnly ? { shapes: spec.shapes(drawn), layers: drawn.layers, slices, label: sectionLabel, caption: spec.caption } : null}
        />
      )}
    </>
  );
}
