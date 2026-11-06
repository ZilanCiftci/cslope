/**
 * "New models from drawing…" in the Place drawing window: choose a drawing
 * (one of the project's, or a new file), draw a frame around each section
 * on its pages, name each (a name is suggested from the texts in it) and
 * calibrate each (as a placement is; a frame may reuse the scale of one
 * calibrated before, so one known value per axis is enough); then one
 * model is made per frame, the drawing placed under it, cropped to the
 * frame, the file shared.
 */
import { useRef, useState, type ChangeEvent } from "react";
import { sha256Hex } from "../project/input-hash";
import { MAX_DRAWING_BYTES, fileTooLarge } from "../project/file-limits";
import { drawingError, pageSizeOf, peekSource, vectorsFor } from "./drawing-cache";
import { DRAWING_ACCEPT, DRAWING_MIME, sniffDrawingMime } from "./sources";
import {
  emptyForm,
  nextTarget,
  withSource,
  type CalibrationForm,
  type CalibrationMode,
  type PickTarget,
} from "./calibration-form";
import { evaluateFrame, frameKey, framesToModels, reusableFrames, suggestFrameName, type SheetFrame } from "./sheet";
import type { Crop, Pt } from "./transform";
import type { DrawingCommand, DrawingWindowState } from "./window-sync";
import {
  AssetStrip,
  AxesInputs,
  CalibrationMessage,
  DrawingInputs,
  EmptyViewer,
  PageStrip,
  PointsInputs,
  ScaleInputs,
  Viewer,
  ViewerToolbar,
  type Tool,
} from "./PlaceDrawingWindow";
import { drawingExtentText, fileUnitCode, rememberLocalBytes, useDrawingsTick } from "./place-window-shared";
import { GroupHeading } from "../properties/GroupHeading";
import { WorkspaceWindowFrame } from "../../components/ui/ToolWindowFrame";

const muted = { color: "var(--color-vsc-text-muted)" } as const;

export function NewModelsWindow({
  state,
  onCommand,
  onClose,
  onBack,
}: {
  state: DrawingWindowState;
  onCommand: (c: DrawingCommand) => void;
  onClose: () => void;
  onBack: () => void;
}) {
  const tick = useDrawingsTick();
  const [assetId, setAssetId] = useState<string | null>(state.assets[0]?.id ?? null);
  const [page, setPage] = useState(1);
  const [tool, setTool] = useState<Tool>("crop");
  const [frames, setFrames] = useState<SheetFrame[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const nextId = useRef(1);

  void tick;
  const asset = state.assets.find((a) => a.id === assetId) ?? null;
  const source = assetId ? peekSource(assetId) : null;
  const error = assetId ? drawingError(assetId) : null;
  const vector = !!asset && DRAWING_MIME[asset.mime] === "vector";
  const drawing = vector && assetId ? vectorsFor(assetId, 1) : null;
  const fileUnit = fileUnitCode(drawing);
  // ("pt": a PDF point, 1/72 in)
  const unitName = vector ? (drawing?.unitName ?? "drawing unit") : asset?.mime === "application/pdf" ? "pt" : "pixel";
  const [fitNonce, setFitNonce] = useState(0);
  const frame = frames.find((f) => f.id === selected) ?? null;
  const pageSize = assetId ? pageSizeOf(assetId, page) : null;

  const chooseAsset = (id: string) => {
    if (id === assetId) return;
    if (frames.length > 0 && !window.confirm("Another drawing: the frames drawn on this one are removed. Go on?")) return;
    setAssetId(id);
    setPage(1);
    setFrames([]);
    setSelected(null);
    setTarget(null);
  };

  const fileInput = useRef<HTMLInputElement>(null);
  const addFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const tooLarge = fileTooLarge(file, MAX_DRAWING_BYTES);
    if (tooLarge) return setMessage(tooLarge);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffDrawingMime(bytes);
    if (!mime) return setMessage(`${file.name} is not a PNG, JPEG, TIFF, PDF, DWG or DXF file.`);
    const sha256 = await sha256Hex(bytes);
    const known = state.assets.find((a) => a.sha256 === sha256);
    if (known) {
      chooseAsset(known.id);
      return setMessage(`${file.name} is in the project already.`);
    }
    const id = crypto.randomUUID();
    rememberLocalBytes(id, bytes, mime);
    onCommand({ type: "addAsset", id, name: file.name, mime, sha256, data: bytes });
    setMessage(null);
    chooseAsset(id);
  };

  /** A new frame's form: the drawing's coordinates (DWG, DXF); else axes, reusing the first calibrated frame's scale. */
  const newForm = (list: SheetFrame[]): CalibrationForm => {
    if (vector) return { ...emptyForm("du"), mode: "drawing", drawingUnit: fileUnit ?? 6 };
    const base = emptyForm(asset?.mime === "application/pdf" ? "pt" : "px");
    const probe: SheetFrame = { id: "", page, crop: { x0: 0, y0: 0, x1: 1, y1: 1 }, name: "", form: base };
    const first = reusableFrames(list, probe, unitName)[0];
    return { ...base, mode: "axes", reuseFrom: first ? frameKey(first.id) : null };
  };

  const addFrame = (crop: Crop) => {
    const id = String(nextId.current++);
    const f: SheetFrame = { id, page, crop, name: "", form: newForm(frames) };
    setFrames((list) => [...list, f]);
    setSelected(id);
    setTarget(nextTarget(f.form, null));
    setTool("pick");
    // The name from the texts in the frame (read when first asked).
    if (source) {
      void source
        .texts(page)
        .then((texts) => {
          const name = suggestFrameName(texts, crop);
          if (name) setFrames((list) => list.map((x) => (x.id === id && !x.name ? { ...x, name } : x)));
        })
        .catch(() => {});
    }
  };

  const updateFrame = (id: string, patch: Partial<SheetFrame>) => setFrames((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const setForm = (form: CalibrationForm) => frame && updateFrame(frame.id, { form });

  const pick = (pt: Pt) => {
    if (!frame) return setMessage("Draw a frame first, or select one in the list.");
    if (frame.page !== page) return;
    const t = target ?? nextTarget(frame.form, null);
    if (!t) return;
    const next = withSource(frame.form, t, pt);
    updateFrame(frame.id, { form: next });
    setTarget(nextTarget(next, t));
  };

  const selectFrame = (f: SheetFrame) => {
    setSelected(f.id);
    if (f.page !== page) setPage(f.page);
    setTarget(nextTarget(f.form, null));
  };

  const results = new Map(frames.map((f) => [f.id, evaluateFrame(frames, f, unitName)]));
  const made = asset
    ? framesToModels(frames, { id: asset.id, originalName: asset.originalName, multiPage: asset.mime === "application/pdf" || (source?.pageCount ?? 1) > 1, vector }, unitName)
    : ({ ok: false, error: "Choose a drawing." } as const);

  const create = () => {
    if (!made.ok) return;
    onCommand({ type: "createModels", models: made.models });
    onClose();
  };

  const setMode = (mode: CalibrationMode) => {
    if (!frame) return;
    const next: CalibrationForm =
      mode === "axes" && !frame.form.reuseFrom ? { ...frame.form, mode, reuseFrom: newForm(frames.filter((f) => f.id !== frame.id)).reuseFrom } : { ...frame.form, mode };
    updateFrame(frame.id, { form: next });
    setTarget(nextTarget(next, null));
    setTool("pick");
  };

  const result = frame ? results.get(frame.id) : null;
  const reuseOptions = frame
    ? reusableFrames(frames, frame, unitName).map((f) => ({ key: frameKey(f.id), label: `Frame ${frames.indexOf(f) + 1}${f.name ? `: ${f.name}` : ""}` }))
    : [];

  return (
    <WorkspaceWindowFrame
      title="New models from drawing"
      description="Draw a frame around each section of a drawing and calibrate it; each frame becomes a new model."
      status={
        <>
          <button className="btn" onClick={onBack}>
            Place drawing…
          </button>
          {!made.ok && frames.length > 0 && (
            <span className="min-w-0 truncate" data-testid="create-models-message" title={made.error}>
              {made.error}
            </span>
          )}
        </>
      }
      buttons={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={create} disabled={!made.ok}>
            {frames.length > 1 ? `Create ${frames.length} models` : "Create model"}
          </button>
        </>
      }
    >
      <AssetStrip
        assets={state.assets}
        selected={assetId}
        onSelect={chooseAsset}
        onAdd={() => fileInput.current?.click()}
      />
      <input ref={fileInput} type="file" accept={DRAWING_ACCEPT} className="hidden" onChange={(e) => void addFile(e)} aria-label="Drawing file" />
      {message && (
        <div role="status" className="px-3 py-1 text-[11px]" style={{ background: "var(--color-vsc-input-bg)" }}>
          {message}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        {source && source.pageCount > 1 && <PageStrip source={source} assetId={assetId!} page={page} onPage={(n) => setPage(n)} />}
        <div className="flex-1 min-w-0 flex flex-col">
          <ViewerToolbar
            tool={tool}
            setTool={setTool}
            disabled={!source}
            onFit={() => setFitNonce((n) => n + 1)}
            extent={pageSize && asset ? drawingExtentText(DRAWING_MIME[asset.mime] ?? "image", pageSize, vector ? drawing?.metersPerUnit || null : null) : null}
            cropLabel="Draw frame"
          />
          <div className="flex-1 min-h-0 relative">
            {!assetId ? (
              <EmptyViewer onAdd={() => fileInput.current?.click()} />
            ) : error ? (
              <p className="p-4" role="alert">
                This drawing cannot be shown: {error}
              </p>
            ) : !source ? (
              <p className="p-4" style={muted}>
                Opening the drawing
              </p>
            ) : (
              <Viewer
                assetId={assetId}
                page={page}
                tool={tool}
                crop={null}
                onCrop={addFrame}
                form={frame && frame.page === page ? frame.form : emptyForm()}
                target={target}
                onPick={pick}
                fitNonce={fitNonce}
                frames={frames
                  .filter((f) => f.page === page)
                  .map((f) => ({ crop: f.crop, label: `${frames.indexOf(f) + 1}${f.name ? ` ${f.name}` : ""}`, selected: f.id === selected }))}
              />
            )}
          </div>
        </div>
        <div className="w-[360px] shrink-0 border-l flex flex-col min-h-0" style={{ borderColor: "var(--color-vsc-border)" }}>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            <section aria-label="Frames">
              <GroupHeading>Frames</GroupHeading>
              <p className="text-[11px]" style={muted}>
                With Draw frame, drag a rectangle around each section{source && source.pageCount > 1 ? ", on any page" : ""}. Each frame becomes
                a model, named after the frame.
              </p>
              <div role="list" aria-label="Frames" className="mt-1.5 flex flex-col gap-1">
                {frames.length === 0 && (
                  <span className="text-[11px]" style={muted}>
                    No frames yet.
                  </span>
                )}
                {frames.map((f, i) => {
                  const r = results.get(f.id);
                  return (
                    <div
                      key={f.id}
                      role="listitem"
                      className="flex items-center gap-1.5 p-1 rounded"
                      style={{ border: "1px solid var(--color-vsc-border)", background: f.id === selected ? "var(--color-vsc-selected-bg)" : "transparent" }}
                    >
                      <button className="btn text-[11px] px-1.5" onClick={() => selectFrame(f)} aria-pressed={f.id === selected} title="Select the frame to calibrate it">
                        {i + 1}
                      </button>
                      <input
                        className="flex-1 min-w-0 text-[12px]"
                        placeholder="Model name"
                        value={f.name}
                        aria-label={`Name of frame ${i + 1}`}
                        onChange={(e) => updateFrame(f.id, { name: e.target.value })}
                        onFocus={() => selectFrame(f)}
                      />
                      {source && source.pageCount > 1 && (
                        <span className="text-[10px] whitespace-nowrap" style={muted}>
                          p. {f.page}
                        </span>
                      )}
                      <span className="text-[11px] w-4 text-center" title={!r ? "" : r.fit.ok ? "Calibrated" : r.fit.error} aria-label={r?.fit.ok ? "Calibrated" : "Not calibrated"}>
                        {r?.fit.ok ? "✓" : "–"}
                      </span>
                      <button
                        className="btn text-[11px] px-1.5"
                        aria-label={`Remove frame ${i + 1}`}
                        onClick={() => {
                          setFrames((list) => list.filter((x) => x.id !== f.id).map((x) => (x.form.reuseFrom === frameKey(f.id) ? { ...x, form: { ...x.form, reuseFrom: null } } : x)));
                          if (selected === f.id) setSelected(null);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
            {frame && (
              <section aria-label="Calibrate">
                <h3 className="font-semibold text-[12px]">2. Calibrate frame {frames.indexOf(frame) + 1}</h3>
                <div role="radiogroup" aria-label="Calibration" className="flex gap-1 mt-1.5 flex-wrap">
                  {(
                    [
                      ...(vector ? ([["drawing", "Drawing coordinates"]] as const) : []),
                      ["axes", "Axes"],
                      ["points", "Points"],
                      ["scale", "Scale"],
                    ] as const
                  ).map(([m, label]) => (
                    <button key={m} role="radio" aria-checked={frame.form.mode === m} className="btn text-[11px]" aria-pressed={frame.form.mode === m} onClick={() => setMode(m)}>
                      {label}
                    </button>
                  ))}
                </div>
                {frame.page !== page && (
                  <p className="text-[11px] mt-1" style={muted}>
                    The frame is on page {frame.page}.
                  </p>
                )}
                {frame.form.mode === "drawing" && <DrawingInputs form={frame.form} setForm={setForm} drawing={drawing} fileUnit={fileUnit} />}
                {frame.form.mode === "axes" && (
                  <AxesInputs form={frame.form} setForm={setForm} target={target} setTarget={setTarget} reuseOptions={reuseOptions} />
                )}
                {frame.form.mode === "points" && (
                  <PointsInputs form={frame.form} setForm={setForm} target={target} setTarget={setTarget} residuals={result?.fit.ok ? result.fit.residuals : null} />
                )}
                {frame.form.mode === "scale" && (
                  <ScaleInputs form={frame.form} setForm={setForm} target={target} setTarget={setTarget} isPdf={asset?.mime === "application/pdf"} unitName={unitName} />
                )}
                <div className="mt-2 text-[11px]" aria-live="polite">
                  {result?.fit.ok ? (
                    <p data-testid="frame-calibration-summary">{result.summary.join(" · ")}</p>
                  ) : (
                    result && <CalibrationMessage result={result} />
                  )}
                </div>
              </section>
            )}
            <p className="text-[10px]" style={muted}>
              The models start without geometry: in each, use Pick lines… (Model › Drawing, or under the drawing in the Drawings
              panel) to make its boundaries of the drawing&apos;s lines, or draw them over the drawing.
            </p>
          </div>
        </div>
      </div>
    </WorkspaceWindowFrame>
  );
}
