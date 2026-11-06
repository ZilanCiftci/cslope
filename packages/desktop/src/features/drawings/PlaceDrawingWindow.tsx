/**
 * The Place drawing window: choose a drawing of the project (or add a
 * file), a page of it, the part of the page that is the section (crop),
 * and how it lies in the model (calibrate); then place it under the
 * active model. The main window keeps the files and the placements
 * (window-sync.ts); this window asks for a file's bytes when it shows it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as RPointerEvent } from "react";
import { isElectron } from "../../utils/is-electron";
import { useToolWindowState } from "../../utils/tool-window-sync";
import { sha256Hex } from "../project/input-hash";
import { MAX_DRAWING_BYTES, fileTooLarge } from "../project/file-limits";
import type { BackgroundImage } from "../../store/types";
import { drawingError, pageSizeOf, peekSource, rasterFor, setAssetLoader, vectorsFor } from "./drawing-cache";
import { DRAWING_ACCEPT, DRAWING_MIME, drawingKindName, pageRect, sniffDrawingMime, type DrawingSource } from "./sources";
import { DRAWING_UNIT_CHOICES, INSUNITS, type VectorDrawing } from "./vectors";
import { drawVectorTexts, vectorPath } from "./vector-render";
import { cssVar } from "../canvas/constants";
import { GroupHeading } from "../properties/GroupHeading";
import { WorkspaceWindowFrame } from "../../components/ui/ToolWindowFrame";
import { apply, cropCorners, normalizeCrop, type Affine, type Crop, type Pt } from "./transform";
import { newPlacementId, placementLabel } from "./placement";
import {
  axisScalesOf,
  buildPlacement,
  emptyForm,
  evaluateForm,
  formFromCalibration,
  formForVector,
  initialForm,
  nextTarget,
  pickTargets,
  sameTarget,
  targetLabel,
  targetSource,
  withSource,
  type CalibrationForm,
  type CalibrationMode,
  type FormResult,
  type PickTarget,
  type PointRow,
  type ScaleUnit,
  type TickRow,
} from "./calibration-form";
import type { DrawingAssetInfo, DrawingCommand, DrawingWindowState } from "./window-sync";
import { NewModelsWindow } from "./NewModelsWindow";
import { drawingExtentText, fileUnitCode, receiveAsset, rememberLocalBytes, useDrawingsTick, windowLoader } from "./place-window-shared";

export function PlaceDrawingDialogApp() {
  const send = useCallback((c: DrawingCommand) => window.cslope.sendDrawingCommand(c), []);
  useEffect(() => {
    if (!isElectron) return;
    setAssetLoader(windowLoader(send));
    return window.cslope.onDrawingAsset((_e, payload) => receiveAsset(payload));
  }, [send]);
  const state = useToolWindowState<DrawingWindowState>({
    enabled: isElectron,
    request: () => window.cslope.requestDrawingState(),
    onState: (l) => window.cslope.onDrawingState(l),
    onChanged: (l) => window.cslope.onDrawingChanged(l),
  });
  // "New models from drawing…" (opened so, or switched to in the window).
  const [sheets, setSheets] = useState<{ on: boolean; nonce: number }>({ on: false, nonce: -1 });
  if (state?.edit && state.edit.nonce !== sheets.nonce) setSheets({ on: !!state.edit.newModels, nonce: state.edit.nonce });
  if (!state) {
    return (
      <WorkspaceWindowFrame
        title="Place drawing"
        description="Crop and calibrate a drawing of the section, then place it under the model."
        buttons={
          <button className="btn" onClick={() => window.close()}>
            Cancel
          </button>
        }
      >
        <p role="status" className="p-3 text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>
          Waiting for the main window…
        </p>
      </WorkspaceWindowFrame>
    );
  }
  if (sheets.on) {
    return <NewModelsWindow state={state} onCommand={send} onClose={() => window.close()} onBack={() => setSheets((s) => ({ ...s, on: false }))} />;
  }
  return (
    <PlaceDrawingWindow
      key={state.modelId}
      state={state}
      onCommand={send}
      onClose={() => window.close()}
      onNewModels={() => setSheets((s) => ({ ...s, on: true }))}
    />
  );
}

// ── The window ──────────────────────────────────────────────────────

/** The source unit of a drawing file: a DWG or DXF drawing's unit, a PDF point or a pixel. */
const unitOfMime = (mime: string | undefined): ScaleUnit =>
  mime && DRAWING_MIME[mime] === "vector" ? "du" : mime === "application/pdf" ? "pt" : "px";

export type Tool = "pick" | "crop" | "pan";

const muted = { color: "var(--color-vsc-text-muted)" } as const;

export function PlaceDrawingWindow({
  state,
  onCommand,
  onClose,
  onNewModels,
}: {
  state: DrawingWindowState;
  onCommand: (c: DrawingCommand) => void;
  onClose: () => void;
  /** Switch to "New models from drawing…". */
  onNewModels?: () => void;
}) {
  const tick = useDrawingsTick();
  const [assetId, setAssetId] = useState<string | null>(state.assets[0]?.id ?? null);
  const [page, setPage] = useState(1);
  const [crop, setCrop] = useState<Crop | null>(null);
  // The drawing shown first starts as a drawing chosen later does (chooseAsset).
  const [form, setForm] = useState<CalibrationForm>(() => initialForm(unitOfMime(state.assets[0]?.mime)));
  const [target, setTarget] = useState<PickTarget | null>(() => nextTarget(initialForm(unitOfMime(state.assets[0]?.mime)), null));
  const [tool, setTool] = useState<Tool>("pick");
  const [editing, setEditing] = useState<BackgroundImage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [seenNonce, setSeenNonce] = useState(0);

  const asset = state.assets.find((a) => a.id === assetId) ?? null;
  // (opens the file when it is first shown; re-rendered when it is ready)
  void tick;
  const source = assetId ? peekSource(assetId) : null;
  const error = assetId ? drawingError(assetId) : null;
  const vector = !!asset && DRAWING_MIME[asset.mime] === "vector";
  const drawing = vector && assetId ? vectorsFor(assetId, 1) : null;
  const fileUnit = fileUnitCode(drawing);
  const unit = unitOfMime(asset?.mime);
  // ("pt": a PDF point, 1/72 in, not a point picked in the drawing)
  const unitName = vector ? (drawing?.unitName ?? "drawing unit") : unit === "pt" ? "pt" : "pixel";
  const [fitNonce, setFitNonce] = useState(0);

  // A placement to recalibrate: its file, page, crop and inputs.
  if (state.edit && state.edit.nonce !== seenNonce) {
    setSeenNonce(state.edit.nonce);
    const ref = state.placements.find((p) => p.modelId === state.modelId && p.placement.id === state.edit!.placementId);
    if (ref) {
      const p = ref.placement;
      const pMime = state.assets.find((a) => a.id === p.assetId)?.mime ?? "";
      const pUnit: ScaleUnit = pMime === "application/pdf" ? "pt" : "px";
      setEditing(p);
      setAssetId(p.assetId);
      setPage(p.page ?? 1);
      setCrop(p.crop ?? null);
      const fallback = () => {
        // A placement without inputs: two corners of what it shows, where they are now.
        const size = pageSizeOf(p.assetId, p.page ?? 1);
        const c = p.crop ?? (size ? pageRect(size) : null);
        if (!c) return [];
        return [
          { source: [c.x0, c.y1] as Pt, model: apply(p.transform, [c.x0, c.y1]) },
          { source: [c.x1, c.y1] as Pt, model: apply(p.transform, [c.x1, c.y1]) },
        ];
      };
      const f =
        DRAWING_MIME[pMime] === "vector"
          ? formForVector(p.calibration, p.transform, 0, fallback)
          : formFromCalibration(p.calibration, pUnit, fallback);
      setForm(f);
      setTarget(nextTarget(f, null));
      setTool("pick");
    } else if (state.edit.assetId && state.assets.some((a) => a.id === state.edit!.assetId)) {
      // A file of the project to place in this model (Attachments › Place…).
      const mime = state.assets.find((a) => a.id === state.edit!.assetId)?.mime ?? "";
      setEditing(null);
      setAssetId(state.edit.assetId);
      setPage(1);
      setCrop(null);
      setForm((f) => initialForm(unitOfMime(mime), f));
      setTarget(null);
      setTool("pick");
    }
  }

  const reuseOptions = useMemo(
    () =>
      state.placements.filter(
        (r) => assetId && r.placement.assetId === assetId && r.placement.id !== editing?.id && axisScalesOf(r.placement.transform),
      ),
    [state.placements, assetId, editing],
  );
  const reuseRef = reuseOptions.find((r) => `${r.modelId}/${r.placement.id}` === form.reuseFrom) ?? null;
  const reuseScale = reuseRef ? axisScalesOf(reuseRef.placement.transform) : null;
  // (drawing mode: the file's unit unless one was chosen)
  const effective = form.mode === "drawing" && form.drawingUnit === 0 ? { ...form, drawingUnit: fileUnit ?? 6 } : form;
  const result = evaluateForm(effective, reuseScale, unitName);

  const pageSize = assetId ? pageSizeOf(assetId, page) : null;
  const shown: Crop | null = crop ?? (pageSize ? pageRect(pageSize) : null);

  const chooseAsset = (id: string, mime = state.assets.find((a) => a.id === id)?.mime ?? "") => {
    if (id === assetId) return;
    setAssetId(id);
    setPage(1);
    setCrop(null);
    setForm((f) => initialForm(unitOfMime(mime), f));
    setTarget(null);
    setEditing(null);
  };
  const choosePage = (n: number) => {
    setPage(n);
    setCrop(null);
    setForm((f) => ({ ...emptyForm(f.scale.unit), mode: f.mode, reuseFrom: f.reuseFrom }));
    setTarget(null);
  };

  // ── Add a file ──
  const fileInput = useRef<HTMLInputElement>(null);
  const addFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const tooLarge = fileTooLarge(file, MAX_DRAWING_BYTES);
    if (tooLarge) {
      setMessage(tooLarge);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffDrawingMime(bytes);
    if (!mime) {
      setMessage(`${file.name} is not a PNG, JPEG, TIFF, PDF, DWG or DXF file.`);
      return;
    }
    const sha256 = await sha256Hex(bytes);
    const known = state.assets.find((a) => a.sha256 === sha256);
    if (known) {
      chooseAsset(known.id);
      setMessage(`${file.name} is in the project already.`);
      return;
    }
    const id = crypto.randomUUID();
    rememberLocalBytes(id, bytes, mime);
    onCommand({ type: "addAsset", id, name: file.name, mime, sha256, data: bytes });
    setMessage(null);
    chooseAsset(id, mime);
  };

  // ── Place ──
  const place = () => {
    if (!result.fit.ok || !asset || !shown) return;
    const placement = buildPlacement({
      id: editing?.id ?? newPlacementId(),
      assetId: asset.id,
      name: editing?.name ?? placementLabel({ page: source && source.pageCount > 1 ? page : undefined }, asset.originalName),
      page: asset.mime === "application/pdf" || (source?.pageCount ?? 1) > 1 ? page : undefined,
      crop: shown,
      calibration: result.calibration,
      transform: result.fit.transform,
      existing: editing ?? undefined,
      // Line work has no sheet to see through: more opaque at first; layers the file has off stay hidden.
      opacity: vector ? 0.8 : undefined,
      hiddenLayers: vector && drawing && drawing.layersOff.length > 0 ? drawing.layersOff : undefined,
    });
    onCommand({ type: "place", placement });
    onClose();
  };

  const pick = (pt: Pt) => {
    const t = target ?? nextTarget(form, null);
    if (!t) return;
    const next = withSource(form, t, pt);
    setForm(next);
    setTarget(nextTarget(next, t));
  };

  const setMode = (mode: CalibrationMode) => {
    const next = { ...form, mode };
    setForm(next);
    setTarget(nextTarget(next, null));
    setTool("pick");
  };

  const modelName = state.modelName || "the active model";
  return (
    <WorkspaceWindowFrame
      title={editing ? "Recalibrate drawing" : "Place drawing"}
      description={
        editing
          ? `Change the crop and calibration of ${editing.name || "the drawing"}, then update it under ${modelName}.`
          : `Crop and calibrate a drawing of the section, then place it under ${modelName}.`
      }
      buttons={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={place} disabled={!result.fit.ok || !shown}>
            {editing ? "Update" : "Place"}
          </button>
        </>
      }
    >
      <AssetStrip
        assets={state.assets}
        selected={assetId}
        onSelect={chooseAsset}
        onAdd={() => fileInput.current?.click()}
        onNewModels={editing ? undefined : onNewModels}
      />
      <input ref={fileInput} type="file" accept={DRAWING_ACCEPT} className="hidden" onChange={(e) => void addFile(e)} aria-label="Drawing file" />
      {message && (
        <div role="status" className="px-3 py-1 text-[11px]" style={{ background: "var(--color-vsc-input-bg)" }}>
          {message}
        </div>
      )}
      {drawing && drawing.notes.length > 0 && (
        <div className="px-3 py-1 text-[11px]" style={{ ...muted, background: "var(--color-vsc-input-bg)" }} data-testid="drawing-notes">
          {drawing.notes.join(" ")}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        {source && source.pageCount > 1 && <PageStrip source={source} assetId={assetId!} page={page} onPage={choosePage} />}
        <div className="flex-1 min-w-0 flex flex-col">
          <ViewerToolbar
            tool={tool}
            setTool={setTool}
            disabled={!source}
            onFit={() => setFitNonce((n) => n + 1)}
            extent={pageSize && asset ? drawingExtentText(DRAWING_MIME[asset.mime] ?? "image", pageSize, vector ? (INSUNITS[effective.drawingUnit]?.meters ?? (drawing?.metersPerUnit || null)) : null) : null}
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
                Opening the drawing…
              </p>
            ) : (
              <Viewer
                assetId={assetId}
                page={page}
                tool={tool}
                crop={crop}
                onCrop={(c) => {
                  setCrop(c);
                  setTool("pick");
                }}
                form={form}
                target={target}
                onPick={pick}
                fitNonce={fitNonce}
              />
            )}
          </div>
        </div>
        <div className="w-[340px] shrink-0 border-l flex flex-col min-h-0" style={{ borderColor: "var(--color-vsc-border)" }}>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {!asset && (
              <p className="text-[11px]" style={muted} data-testid="no-drawing-steps">
                Add a drawing to crop and calibrate it.
              </p>
            )}
            {asset && (
              <>
            <section aria-label="Crop">
              <GroupHeading>1 · Crop</GroupHeading>
              <p className="text-[11px]" style={muted}>
                Optional: with Crop in the toolbar, drag a rectangle around the section.{" "}
                {crop ? "" : vector ? "The whole drawing is placed now." : "The whole page is placed now."}
              </p>
              <div className="flex gap-2 mt-1.5">
                <button className="btn" onClick={() => setCrop(null)} disabled={!crop}>
                  Clear crop
                </button>
              </div>
            </section>
            <section aria-label="Calibrate">
              <GroupHeading>2 · Calibrate</GroupHeading>
              <div role="radiogroup" aria-label="Calibration" className="flex gap-1">
                {(
                  [
                    ...(vector ? ([["drawing", "Drawing coordinates"]] as const) : []),
                    ["axes", "Axes"],
                    ["points", "Points"],
                    ["scale", "Scale"],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} role="radio" aria-checked={form.mode === m} className="btn text-[11px]" aria-pressed={form.mode === m} onClick={() => setMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
              {form.mode === "drawing" && <DrawingInputs form={effective} setForm={setForm} drawing={drawing} fileUnit={fileUnit} />}
              {form.mode === "axes" && (
                <AxesInputs
                  form={form}
                  setForm={setForm}
                  target={target}
                  setTarget={setTarget}
                  reuseOptions={reuseOptions.map((r) => ({ key: `${r.modelId}/${r.placement.id}`, label: `${r.modelName}: ${placementLabel(r.placement)}` }))}
                />
              )}
              {form.mode === "points" && (
                <PointsInputs form={form} setForm={setForm} target={target} setTarget={setTarget} residuals={result.fit.ok ? result.fit.residuals : null} />
              )}
              {form.mode === "scale" && (
                <ScaleInputs form={form} setForm={setForm} target={target} setTarget={setTarget} isPdf={unit === "pt"} unitName={unitName} />
              )}
              <div className="mt-2 text-[11px]" aria-live="polite">
                {result.fit.ok ? (
                  <p data-testid="calibration-summary">{result.summary.join(" · ")}</p>
                ) : (
                  <CalibrationMessage result={result} testId="calibration-message" />
                )}
              </div>
            </section>
              </>
            )}
            <section aria-label="Preview">
              <GroupHeading>Preview</GroupHeading>
              <p className="text-[11px]" style={muted}>
                The drawing under {state.modelName || "the model"}, with its outline.
              </p>
              <Preview state={state} assetId={assetId} page={page} crop={shown} transform={result.fit.ok ? result.fit.transform : null} />
            </section>
          </div>
        </div>
      </div>
    </WorkspaceWindowFrame>
  );
}

// ── The files ───────────────────────────────────────────────────────

/** The drawings of the project, as a strip under the window's heading. */
export function AssetStrip({
  assets,
  selected,
  onSelect,
  onAdd,
  onNewModels,
}: {
  assets: DrawingAssetInfo[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onNewModels?: () => void;
}) {
  const kind = drawingKindName;
  return (
    <div className="border-b px-3 py-2 flex items-center gap-3" style={{ borderColor: "var(--color-vsc-border)" }}>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] mb-1" style={muted}>
          Drawings in this project
        </div>
        <div role="listbox" aria-label="Drawings in this project" className="flex gap-1.5 overflow-x-auto">
          {assets.length === 0 && (
            <span className="text-[11px]" style={muted}>
              None yet: add a PNG, JPEG, TIFF, PDF, DWG or DXF file.
            </span>
          )}
          {assets.map((a) => (
            <button
              key={a.id}
              role="option"
              aria-selected={a.id === selected}
              onClick={() => onSelect(a.id)}
              className="btn text-left shrink-0 max-w-[260px]"
              aria-pressed={a.id === selected}
              title={a.usedBy.length > 0 ? `Placed in ${a.usedBy.join(", ")}` : "Not placed yet"}
            >
              <span className="block truncate">{a.originalName || a.id}</span>
              <span className="block text-[10px]" style={muted}>
                {kind(a.mime)}
                {a.bytes ? ` · ${formatBytes(a.bytes)}` : ""}
                {a.usedBy.length > 0 ? ` · in ${a.usedBy.length} model${a.usedBy.length > 1 ? "s" : ""}` : ""}
              </span>
            </button>
          ))}
        </div>
      </div>
      <button className="btn shrink-0" onClick={onAdd}>
        Add file…
      </button>
      {onNewModels && (
        <button className="btn shrink-0" onClick={onNewModels} title="Draw a frame around each section of the drawing and make a model of each">
          New models from drawing…
        </button>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`;
}

export function EmptyViewer({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2" style={muted}>
      <p>Add a drawing of the section: a PNG, JPEG, TIFF, PDF, DWG or DXF file.</p>
      <button className="btn" onClick={onAdd}>
        Add file…
      </button>
    </div>
  );
}

// ── Pages ───────────────────────────────────────────────────────────

export function PageStrip({ source, assetId, page, onPage }: { source: DrawingSource; assetId: string; page: number; onPage: (n: number) => void }) {
  const pages = Array.from({ length: Math.min(source.pageCount, 200) }, (_, i) => i + 1);
  return (
    <div role="listbox" aria-label="Pages" className="w-[132px] shrink-0 overflow-y-auto border-r p-2 flex flex-col gap-2" style={{ borderColor: "var(--color-vsc-border)" }}>
      {pages.map((n) => (
        <button
          key={n}
          role="option"
          aria-selected={n === page}
          onClick={() => onPage(n)}
          className="flex flex-col items-center gap-1 p-1 rounded"
          style={{ outline: n === page ? "2px solid var(--color-vsc-accent)" : "1px solid var(--color-vsc-border)" }}
        >
          <PageThumb source={source} assetId={assetId} page={n} />
          <span className="text-[10px]">Page {n}</span>
        </button>
      ))}
    </div>
  );
}

function PageThumb({ source, assetId, page }: { source: DrawingSource; assetId: string; page: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const size = await source.loadPageSize(page);
      const scale = 100 / Math.max(size.width, size.height);
      const raster = await source.render(page, scale);
      const c = ref.current;
      if (!live || !c) return;
      c.width = Math.round(size.width * scale);
      c.height = Math.round(size.height * scale);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = cssVar("--color-canvas-page");
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(raster.image, 0, 0, c.width, c.height);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [source, assetId, page]);
  return <canvas ref={ref} width={100} height={100} className="max-w-[100px] max-h-[100px]" aria-hidden />;
}

// ── The viewer ──────────────────────────────────────────────────────

export function ViewerToolbar({
  tool,
  setTool,
  onFit,
  disabled = false,
  extent,
  cropLabel = "Crop",
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  /** Fit the drawing (or its crop) to the viewer. */
  onFit: () => void;
  /** No drawing shown: the tools do nothing. */
  disabled?: boolean;
  /** The size of the page or drawing (drawingExtentText), or null. */
  extent: string | null;
  /** The crop tool's name (the sheet view: "Draw frame"). */
  cropLabel?: string;
}) {
  // The size first: a narrow window cuts the end of the hint.
  const hint = `${extent ? `${extent} · ` : ""}Wheel: zoom · middle button or Space + drag: pan`;
  return (
    <div className="px-2 py-1 border-b flex items-center gap-1.5 text-[11px]" style={{ borderColor: "var(--color-vsc-border)" }}>
      {(
        [
          ["pick", "Pick points"],
          ["crop", cropLabel],
          ["pan", "Pan"],
        ] as const
      ).map(([t, label]) => (
        <button key={t} className="btn text-[11px] shrink-0" aria-pressed={tool === t} onClick={() => setTool(t)} disabled={disabled}>
          {label}
        </button>
      ))}
      <button className="btn text-[11px] shrink-0" onClick={onFit} disabled={disabled} title="Fit the drawing to the view (Home)">
        Fit
      </button>
      <span className="flex-1" />
      {/* One line: cut short (the whole text in the tooltip) rather than wrapped. */}
      <span className="min-w-0 truncate" style={muted} title={hint} data-testid="viewer-hint">
        {hint}
      </span>
    </div>
  );
}

interface View {
  zoom: number;
  x: number;
  y: number;
}

/** Marks of the inputs on the drawing: the clicked points with their labels. */
function formMarks(form: CalibrationForm): { at: Pt; label: string; target: PickTarget }[] {
  return pickTargets(form).flatMap((t) => {
    const at = targetSource(form, t);
    return at ? [{ at, label: targetLabel(t), target: t }] : [];
  });
}

/** The pointer's guide lines across the drawing. */
const CROSSHAIR_GUIDE = "1px dashed color-mix(in srgb, var(--color-canvas-crosshair-strong) 70%, transparent)";

const LOUPE = 140;
const LOUPE_ZOOM = 4;

/** A frame drawn on the sheet ("New models from drawing…"). */
export interface FrameMark {
  crop: Crop;
  label: string;
  selected: boolean;
}

export function Viewer({
  assetId,
  page,
  tool,
  crop,
  onCrop,
  form,
  target,
  onPick,
  frames = [],
  fitNonce = 0,
}: {
  assetId: string;
  page: number;
  tool: Tool;
  crop: Crop | null;
  onCrop: (c: Crop) => void;
  form: CalibrationForm;
  target: PickTarget | null;
  onPick: (p: Pt) => void;
  frames?: FrameMark[];
  /** A change fits the drawing to the viewer again (the toolbar's Fit). */
  fitNonce?: number;
}) {
  const tick = useDrawingsTick();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ kind: "pan"; x: number; y: number; view: View } | { kind: "crop"; start: Pt } | null>(null);
  const [cropDraft, setCropDraft] = useState<Crop | null>(null);
  const pageSize = pageSizeOf(assetId, page);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit the page (or the crop) when the page changes, on Fit (or Home), and
  // when the viewer is resized, until the user zooms or pans.
  const [homeNonce, setHomeNonce] = useState(0);
  const baseKey = `${assetId}|${page}|${pageSize ? 1 : 0}|${fitNonce}|${homeNonce}`;
  const baseKeyRef = useRef(baseKey);
  useEffect(() => {
    baseKeyRef.current = baseKey;
  }, [baseKey]);
  const [fitted, setFitted] = useState("");
  // The fit the user zoomed or panned away from (no refit on a resize then).
  const [moved, setMoved] = useState<string | null>(null);
  const fitKey = moved === baseKey ? fitted : `${baseKey}|${size.w}x${size.h}`;
  if (pageSize && fitted !== fitKey && size.w > 0) {
    setFitted(fitKey);
    const r = crop ?? pageRect(pageSize);
    const zoom = Math.min((size.w - 40) / (r.x1 - r.x0), (size.h - 40) / (r.y1 - r.y0));
    setView({ zoom, x: size.w / 2 - ((r.x0 + r.x1) / 2) * zoom, y: size.h / 2 - ((r.y0 + r.y1) / 2) * zoom });
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        setSpace(true);
      }
      if (e.key === "Home" && !typing) {
        e.preventDefault();
        setHomeNonce((n) => n + 1);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const toSource = useCallback((x: number, y: number): Pt => (view ? [(x - view.x) / view.zoom, (y - view.y) / view.zoom] : [0, 0]), [view]);
  const toScreen = useCallback((p: Pt): Pt => (view ? [view.x + p[0] * view.zoom, view.y + p[1] * view.zoom] : [0, 0]), [view]);

  // Draw the page, the crop and the marks.
  useEffect(() => {
    void tick;
    const c = canvas.current;
    if (!c || !view) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar("--color-canvas-paper-outside");
    ctx.fillRect(0, 0, size.w, size.h);
    const lines = peekSource(assetId)?.kind === "vector" ? vectorsFor(assetId, page) : null;
    const raster = lines ? null : rasterFor({ assetId, page }, view.zoom * dpr);
    const pr = pageSize ? pageRect(pageSize) : null;
    if (pr) {
      ctx.fillStyle = cssVar("--color-canvas-page");
      ctx.fillRect(view.x + pr.x0 * view.zoom, view.y + pr.y0 * view.zoom, (pr.x1 - pr.x0) * view.zoom, (pr.y1 - pr.y0) * view.zoom);
    }
    if (lines) drawLineWork(ctx, lines, view.zoom, view.x, view.y);
    if (raster) {
      ctx.save();
      ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
      ctx.imageSmoothingQuality = "high";
      const r = raster.region;
      ctx.drawImage(raster.image, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
    }
    const shownCrop = cropDraft ?? crop;
    if (shownCrop && pageSize) {
      const [x0, y0] = toScreen([shownCrop.x0, shownCrop.y0]);
      const [x1, y1] = toScreen([shownCrop.x1, shownCrop.y1]);
      ctx.save();
      ctx.fillStyle = cssVar("--color-canvas-crop-mask");
      ctx.beginPath();
      const pr2 = pageRect(pageSize);
      ctx.rect(view.x + pr2.x0 * view.zoom, view.y + pr2.y0 * view.zoom, pageSize.width * view.zoom, pageSize.height * view.zoom);
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.fill("evenodd");
      ctx.strokeStyle = cssVar("--color-vsc-accent");
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }
    const accent = cssVar("--color-vsc-accent");
    const frame = cssVar("--color-canvas-frame");
    for (const f of frames) {
      const [x0, y0] = toScreen([f.crop.x0, f.crop.y0]);
      const [x1, y1] = toScreen([f.crop.x1, f.crop.y1]);
      ctx.save();
      ctx.strokeStyle = f.selected ? accent : frame;
      ctx.lineWidth = f.selected ? 2.5 : 1.5;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.font = "bold 11px system-ui, sans-serif";
      const w = ctx.measureText(f.label).width + 8;
      ctx.fillStyle = f.selected ? accent : frame;
      ctx.fillRect(x0, y0 - 16, w, 16);
      ctx.fillStyle = cssVar("--color-canvas-mark-text");
      ctx.fillText(f.label, x0 + 4, y0 - 4);
      ctx.restore();
    }
    drawMarks(ctx, formMarks(form), target, toScreen);
  }, [tick, view, size, assetId, page, crop, cropDraft, form, target, pageSize, toScreen, frames]);

  // The loupe: the drawing around the pointer, magnified, with a crosshair.
  useEffect(() => {
    const l = loupe.current;
    if (!l || !pointer || !view) return;
    const dpr = window.devicePixelRatio || 1;
    l.width = LOUPE * dpr;
    l.height = LOUPE * dpr;
    const ctx = l.getContext("2d");
    if (!ctx) return;
    const z = view.zoom * LOUPE_ZOOM;
    const [u, v] = toSource(pointer.x, pointer.y);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar("--color-canvas-page");
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    const lines = peekSource(assetId)?.kind === "vector" ? vectorsFor(assetId, page) : null;
    if (lines) drawLineWork(ctx, lines, z, LOUPE / 2 - u * z, LOUPE / 2 - v * z);
    const raster = lines ? null : (rasterFor({ assetId, page }, z * dpr, "loupe") ?? rasterFor({ assetId, page }, view.zoom * dpr));
    if (raster) {
      ctx.save();
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (LOUPE / 2 - u * z), dpr * (LOUPE / 2 - v * z));
      ctx.imageSmoothingQuality = "high";
      const r = raster.region;
      ctx.drawImage(raster.image, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
    }
    drawMarks(ctx, formMarks(form), target, (p) => [LOUPE / 2 + (p[0] - u) * z, LOUPE / 2 + (p[1] - v) * z]);
    ctx.strokeStyle = cssVar("--color-canvas-crosshair-strong");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, 0);
    ctx.lineTo(LOUPE / 2, LOUPE);
    ctx.moveTo(0, LOUPE / 2);
    ctx.lineTo(LOUPE, LOUPE / 2);
    ctx.stroke();
  }, [pointer, view, assetId, page, form, target, toSource, tick]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clampToPage = ([u, v]: Pt): Pt => {
    if (!pageSize) return [u, v];
    const r = pageRect(pageSize);
    return [Math.min(Math.max(u, r.x0), r.x1), Math.min(Math.max(v, r.y0), r.y1)];
  };

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const p = local(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || space || tool === "pan") {
      e.preventDefault();
      setMoved(baseKeyRef.current);
      drag.current = { kind: "pan", x: p.x, y: p.y, view };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    if (tool === "crop") {
      drag.current = { kind: "crop", start: clampToPage(toSource(p.x, p.y)) };
      return;
    }
    onPick(toSource(p.x, p.y));
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    setPointer(p);
    const d = drag.current;
    if (d?.kind === "pan") setView({ ...d.view, x: d.view.x + p.x - d.x, y: d.view.y + p.y - d.y });
    if (d?.kind === "crop") {
      const [u, v] = clampToPage(toSource(p.x, p.y));
      setCropDraft(normalizeCrop({ x0: d.start[0], y0: d.start[1], x1: u, y1: v }));
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (d?.kind === "crop" && cropDraft) {
      if (cropDraft.x1 - cropDraft.x0 > 2 && cropDraft.y1 - cropDraft.y0 > 2) onCrop(cropDraft);
      setCropDraft(null);
    }
  };
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setMoved(baseKeyRef.current);
      setView((v) => {
        if (!v) return v;
        const r = c.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const f = Math.exp(-e.deltaY * 0.0015);
        const zoom = Math.min(Math.max(v.zoom * f, 0.01), 200);
        const k = zoom / v.zoom;
        return { zoom, x: x - (x - v.x) * k, y: y - (y - v.y) * k };
      });
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, []);

  const cursor = panning || space || tool === "pan" ? "grab" : "crosshair";
  const src = pointer && view ? toSource(pointer.x, pointer.y) : null;
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden select-none" data-testid="drawing-viewer" data-view={view ? JSON.stringify(view) : undefined}>
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setPointer(null)}
        onAuxClick={(e) => e.preventDefault()}
        aria-label="Drawing"
      />
      {pointer && view && (
        <>
          <div className="absolute pointer-events-none" style={{ left: 0, top: pointer.y, width: size.w, height: 0, borderTop: CROSSHAIR_GUIDE }} />
          <div className="absolute pointer-events-none" style={{ top: 0, left: pointer.x, height: size.h, width: 0, borderLeft: CROSSHAIR_GUIDE }} />
          <canvas
            ref={loupe}
            aria-hidden
            className="absolute pointer-events-none rounded-full shadow-md"
            style={{
              width: LOUPE,
              height: LOUPE,
              left: Math.min(pointer.x + 24, size.w - LOUPE - 4),
              top: pointer.y - LOUPE - 24 < 0 ? pointer.y + 24 : pointer.y - LOUPE - 24,
              border: "2px solid var(--color-vsc-accent)",
            }}
          />
          {src && (
            <div className="absolute right-2 bottom-2 px-1.5 py-0.5 text-[10px] rounded pointer-events-none" style={{ background: "var(--color-vsc-input-bg)" }}>
              {src[0].toFixed(1)}, {src[1].toFixed(1)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A DWG or DXF drawing's line work at `zoom` px per unit, its origin at (x, y) px. */
function drawLineWork(ctx: CanvasRenderingContext2D, drawing: VectorDrawing, zoom: number, x: number, y: number) {
  // The page is white paper in both themes, so the line work is dark on it.
  const ink = cssVar("--color-canvas-page-ink");
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.stroke(vectorPath(drawing, new Set(), { a: zoom, b: 0, c: 0, d: zoom }));
  ctx.restore();
  drawVectorTexts(ctx, drawing, new Set(), { a: zoom, b: 0, c: 0, d: zoom, e: x, f: y }, ink);
}

function drawMarks(ctx: CanvasRenderingContext2D, marks: { at: Pt; label: string; target: PickTarget }[], target: PickTarget | null, toScreen: (p: Pt) => Pt) {
  const [axisX, axisY, axisScale, markText] = [
    "--color-canvas-axis-x",
    "--color-canvas-axis-y",
    "--color-canvas-axis-scale",
    "--color-canvas-mark-text",
  ].map(cssVar);
  ctx.save();
  ctx.font = "bold 11px system-ui, sans-serif";
  for (const m of marks) {
    const [x, y] = toScreen(m.at);
    const active = sameTarget(m.target, target);
    const color = m.target.kind === "x" ? axisX : m.target.kind === "y" ? axisY : axisScale;
    ctx.strokeStyle = color;
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
    const w = ctx.measureText(m.label).width + 6;
    ctx.fillStyle = color;
    ctx.fillRect(x + 8, y - 20, w, 14);
    ctx.fillStyle = markText;
    ctx.fillText(m.label, x + 11, y - 9);
  }
  ctx.restore();
}

// ── The inputs ──────────────────────────────────────────────────────

/**
 * Why the calibration gives no transform yet: the next step (plain text,
 * with a pointer) or an error (in the warning text color).
 */
export function CalibrationMessage({ result, testId }: { result: FormResult; testId?: string }) {
  if (result.fit.ok) return null;
  return result.prompt ? (
    <p data-testid={testId} data-kind="prompt" className="flex items-start gap-1">
      <span aria-hidden style={muted}>
        ›
      </span>
      {result.fit.error}
    </p>
  ) : (
    <p data-testid={testId} data-kind="error" style={{ color: "var(--color-vsc-warning-text)" }}>
      {result.fit.error}
    </p>
  );
}

interface InputsProps {
  form: CalibrationForm;
  setForm: (f: CalibrationForm) => void;
  target: PickTarget | null;
  setTarget: (t: PickTarget | null) => void;
}

const fieldClass = "w-full min-w-0 text-[12px]";

/** A row's "pick" button: the next click in the drawing goes to it. */
function PickButton({ t, form, target, setTarget }: { t: PickTarget } & Pick<InputsProps, "form" | "target" | "setTarget">) {
  // (as wide as the column heads' first cell)
  const has = !!targetSource(form, t);
  const active = sameTarget(t, target);
  return (
    <button
      className={`btn text-[11px] shrink-0 ${t.kind === "origin" ? "w-[68px]" : "w-[44px]"}`}
      aria-pressed={active}
      title={active ? "Click in the drawing" : "Pick this point in the drawing"}
      onClick={() => setTarget(active ? null : t)}
    >
      {targetLabel(t)}
      {has ? " ✓" : ""}
    </button>
  );
}

export function AxesInputs({ form, setForm, target, setTarget, reuseOptions }: InputsProps & { reuseOptions: { key: string; label: string }[] }) {
  const reuse = form.reuseFrom ? (reuseOptions.find((r) => r.key === form.reuseFrom) ?? null) : null;
  const n = form.reuseFrom ? 1 : 2;
  const setTick = (axis: "x" | "y", i: number, value: string) =>
    setForm({ ...form, axes: { ...form.axes, [axis]: form.axes[axis].map((t: TickRow, k: number) => (k === i ? { ...t, value } : t)) } });
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {/* Above the rows it changes: reusing a scale leaves one point per axis. */}
      {reuseOptions.length > 0 && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px]" style={muted}>
            Reuse scale from
          </span>
          <select
            value={form.reuseFrom ?? ""}
            aria-label="Reuse scale from"
            onChange={(e) => {
              const next = { ...form, reuseFrom: e.target.value || null };
              setForm(next);
              setTarget(nextTarget(next, null));
            }}
          >
            <option value="">No: two points per axis</option>
            {reuseOptions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label} (one point per axis)
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-[11px]" style={muted} data-testid="axes-help">
        {form.reuseFrom ? (
          <>
            Click one point on each axis and type its value; the scale comes from {reuse ? reuse.label : "the chosen drawing"}.
          </>
        ) : (
          <>
            Click two points on the horizontal axis and type their x; then two on the vertical axis and type their y. The x and y
            scales are found separately, so a section drawn with vertical exaggeration is placed true to scale.
          </>
        )}
      </p>
      {(["x", "y"] as const).map((axis) =>
        form.axes[axis].slice(0, n).map((t, i) => (
          <div key={`${axis}${i}`} className="flex items-center gap-1.5">
            <PickButton t={{ kind: axis, index: i }} form={form} target={target} setTarget={setTarget} />
            <span className="w-[48px] text-[11px]" style={muted}>
              {axis} (m)
            </span>
            <input className={fieldClass} value={t.value} aria-label={`${axis}${i + 1} value`} onChange={(e) => setTick(axis, i, e.target.value)} inputMode="decimal" />
          </div>
        )),
      )}
    </div>
  );
}

/** Column headings over the rows of points, aligned with their fields. */
function ColumnHeads({ misfit, remove, origin = false }: { misfit: boolean; remove: boolean; origin?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]" style={muted} aria-hidden>
      <span className={`shrink-0 ${origin ? "w-[68px]" : "w-[44px]"}`} />
      <span className="w-full min-w-0">x (m)</span>
      <span className="w-full min-w-0">y (m)</span>
      {misfit && <span className="w-[58px] shrink-0 text-right">misfit</span>}
      {remove && <span className="w-[22px] shrink-0" />}
    </div>
  );
}

export function PointsInputs({ form, setForm, target, setTarget, residuals }: InputsProps & { residuals: number[] | null }) {
  const setRow = (i: number, patch: Partial<PointRow>) => setForm({ ...form, points: form.points.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const filled = form.points.filter((p) => p.source && p.x.trim() && p.y.trim());
  const showMisfit = !!residuals && filled.length >= 3;
  const removable = form.points.length > 2;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11px]" style={muted}>
        Click a point in the drawing and type its model x and y; then a second one. Two points give the scale and the rotation;
        three or more are fitted (least squares), with the misfit of each point.
      </p>
      <ColumnHeads misfit={showMisfit} remove={removable} />
      {form.points.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <PickButton t={{ kind: "point", index: i }} form={form} target={target} setTarget={setTarget} />
          <input className={fieldClass} placeholder="x (m)" value={p.x} aria-label={`Point ${i + 1} x`} onChange={(e) => setRow(i, { x: e.target.value })} inputMode="decimal" />
          <input className={fieldClass} placeholder="y (m)" value={p.y} aria-label={`Point ${i + 1} y`} onChange={(e) => setRow(i, { y: e.target.value })} inputMode="decimal" />
          {showMisfit && (
            <span className="text-[10px] w-[58px] shrink-0 text-right whitespace-nowrap" style={muted} title="Misfit of this point">
              {residuals![filled.indexOf(p)] !== undefined ? `${residuals![filled.indexOf(p)].toFixed(3)} m` : ""}
            </span>
          )}
          {removable && (
            <button
              className="btn text-[11px] px-1.5 w-[22px] shrink-0"
              aria-label={`Remove point ${i + 1}`}
              title={`Remove point ${i + 1}`}
              onClick={() => {
                setForm({ ...form, points: form.points.filter((_, k) => k !== i) });
                setTarget(null);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div>
        <button
          className="btn text-[11px]"
          onClick={() => {
            const next = { ...form, points: [...form.points, { source: null, x: "", y: "" }] };
            setForm(next);
            setTarget({ kind: "point", index: next.points.length - 1 });
          }}
        >
          Add point
        </button>
      </div>
    </div>
  );
}

export function ScaleInputs({ form, setForm, target, setTarget, isPdf, unitName }: InputsProps & { isPdf: boolean; unitName: string }) {
  const o = form.scale.origin;
  const set = (patch: Partial<CalibrationForm["scale"]>) => setForm({ ...form, scale: { ...form.scale, ...patch } });
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11px]" style={muted}>
        Click a point whose model coordinates you know and type them; then the drawing&apos;s scale.
      </p>
      <ColumnHeads misfit={false} remove={false} origin />
      <div className="flex items-center gap-1.5">
        <PickButton t={{ kind: "origin" }} form={form} target={target} setTarget={setTarget} />
        <input className={fieldClass} placeholder="x (m)" value={o.x} aria-label="Origin x" onChange={(e) => set({ origin: { ...o, x: e.target.value } })} inputMode="decimal" />
        <input className={fieldClass} placeholder="y (m)" value={o.y} aria-label="Origin y" onChange={(e) => set({ origin: { ...o, y: e.target.value } })} inputMode="decimal" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] whitespace-nowrap">1 drawing</span>
        {isPdf ? (
          <select value={form.scale.unit} aria-label="Drawing unit" onChange={(e) => set({ unit: e.target.value as ScaleUnit })}>
            <option value="mm">mm</option>
            <option value="pt">pt (1/72 in)</option>
          </select>
        ) : (
          <span className="text-[11px]">{unitName}</span>
        )}
        <span className="text-[11px]">=</span>
        <input className={fieldClass} value={form.scale.metersPerUnit} aria-label="Meters per drawing unit" onChange={(e) => set({ metersPerUnit: e.target.value })} inputMode="decimal" />
        <span className="text-[11px]">m</span>
      </div>
      {isPdf && (
        <p className="text-[10px]" style={muted}>
          A sheet at 1:200 has 1 mm = 0.2 m.
        </p>
      )}
    </div>
  );
}

/** Drawing coordinates: the drawing as it is, its unit converted to metres. */
export function DrawingInputs({
  form,
  setForm,
  drawing,
  fileUnit,
}: {
  form: CalibrationForm;
  setForm: (f: CalibrationForm) => void;
  drawing: VectorDrawing | null;
  fileUnit: number | null;
}) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11px]" style={muted}>
        The drawing is placed at its own coordinates: a point at x, y in the drawing is at x, y in the model, in meters. Use
        this when the section is drawn at its true coordinates (for example, its elevations as y).
      </p>
      <label className="flex items-center gap-1.5">
        <span className="text-[11px] whitespace-nowrap">Drawing unit</span>
        <select aria-label="Drawing unit" value={form.drawingUnit} onChange={(e) => setForm({ ...form, drawingUnit: Number(e.target.value) })}>
          {DRAWING_UNIT_CHOICES.map((c) => (
            <option key={c.insunits} value={c.insunits}>
              {c.label}
              {c.insunits === fileUnit ? " (from the file)" : ""}
            </option>
          ))}
        </select>
      </label>
      {drawing && fileUnit === null && (
        <p className="text-[10px]" style={muted}>
          The file does not say its unit: choose the one it is drawn in.
        </p>
      )}
    </div>
  );
}

// ── The preview ─────────────────────────────────────────────────────

const PREVIEW_W = 310;
const PREVIEW_H = 200;

function Preview({
  state,
  assetId,
  page,
  crop,
  transform,
}: {
  state: DrawingWindowState;
  assetId: string | null;
  page: number;
  crop: Crop | null;
  transform: Affine | null;
}) {
  const tick = useDrawingsTick();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    void tick;
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = PREVIEW_W * dpr;
    c.height = PREVIEW_H * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar("--color-canvas-bg");
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const pts: Pt[] = [...state.outline.exterior, ...state.outline.lines.flat()];
    if (transform && crop) pts.push(...cropCorners(transform, crop));
    if (pts.length === 0) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((PREVIEW_W - 16) / Math.max(x1 - x0, 1e-9), (PREVIEW_H - 16) / Math.max(y1 - y0, 1e-9));
    const toPx = (x: number, y: number): Pt => [PREVIEW_W / 2 + (x - (x0 + x1) / 2) * s, PREVIEW_H / 2 - (y - (y0 + y1) / 2) * s];
    if (transform && crop && assetId) {
      const m = { a: s * transform.a, b: -s * transform.b, c: s * transform.c, d: -s * transform.d, e: 0, f: 0 };
      const [ex, ey] = toPx(transform.e, transform.f);
      const raster = rasterFor({ assetId, page, crop }, Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * dpr);
      if (raster) {
        ctx.save();
        ctx.transform(m.a, m.b, m.c, m.d, ex, ey);
        ctx.beginPath();
        ctx.rect(crop.x0, crop.y0, crop.x1 - crop.x0, crop.y1 - crop.y0);
        ctx.clip();
        ctx.globalAlpha = 0.7;
        const r = raster.region;
        ctx.drawImage(raster.image, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        ctx.restore();
      }
    }
    ctx.strokeStyle = cssVar("--color-vsc-accent");
    ctx.lineWidth = 1.5;
    const line = (p: Pt[], closed: boolean) => {
      if (p.length < 2) return;
      ctx.beginPath();
      p.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(...toPx(x, y)) : ctx.lineTo(...toPx(x, y))));
      if (closed) ctx.closePath();
      ctx.stroke();
    };
    line(state.outline.exterior, true);
    ctx.lineWidth = 1;
    for (const l of state.outline.lines) line(l, false);
  }, [tick, state.outline, assetId, page, crop, transform]);
  return (
    <canvas
      ref={ref}
      data-testid="placement-preview"
      className="mt-1.5 rounded border"
      style={{ width: PREVIEW_W, height: PREVIEW_H, borderColor: "var(--color-vsc-border)" }}
      aria-label="Preview of the placed drawing over the model"
    />
  );
}
