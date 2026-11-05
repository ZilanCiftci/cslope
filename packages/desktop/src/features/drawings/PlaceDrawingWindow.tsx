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
import { drawingError, onDrawingsChanged, pageSizeOf, peekSource, rasterFor, setAssetLoader } from "./drawing-cache";
import { DRAWING_ACCEPT, sniffDrawingMime, type DrawingSource } from "./sources";
import { apply, cropCorners, normalizeCrop, type Affine, type Crop, type Pt } from "./transform";
import { newPlacementId, placementLabel } from "./placement";
import {
  axisScalesOf,
  buildPlacement,
  emptyForm,
  evaluateForm,
  formFromCalibration,
  nextTarget,
  pickTargets,
  sameTarget,
  targetLabel,
  targetSource,
  withSource,
  type CalibrationForm,
  type CalibrationMode,
  type PickTarget,
  type PointRow,
  type ScaleUnit,
  type TickRow,
} from "./calibration-form";
import type { DrawingAssetInfo, DrawingAssetPayload, DrawingCommand, DrawingWindowState } from "./window-sync";

// ── Bytes from the main window ──────────────────────────────────────

const localBytes = new Map<string, { bytes: Uint8Array; mime: string }>();
const waiting = new Map<string, { resolve: (v: { bytes: Uint8Array; mime: string }) => void; reject: (e: Error) => void }[]>();

function receiveAsset(payload: DrawingAssetPayload): void {
  const list = waiting.get(payload.id) ?? [];
  waiting.delete(payload.id);
  for (const w of list) {
    if ("error" in payload) w.reject(new Error(payload.error));
    else w.resolve({ bytes: payload.data, mime: payload.mime });
  }
}

/** The window's loader: a file added here is in memory; the others are asked of the main window. */
function windowLoader(send: (c: DrawingCommand) => void) {
  return (id: string) => {
    const local = localBytes.get(id);
    if (local) return Promise.resolve(local);
    return new Promise<{ bytes: Uint8Array; mime: string }>((resolve, reject) => {
      const list = waiting.get(id) ?? [];
      list.push({ resolve, reject });
      waiting.set(id, list);
      if (list.length === 1) send({ type: "requestAsset", id });
    });
  };
}

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
  if (!state) {
    return (
      <div className="h-screen p-3 text-[11px]" style={{ background: "var(--color-vsc-bg)", color: "var(--color-vsc-text-muted)" }}>
        Waiting for the main window…
      </div>
    );
  }
  return <PlaceDrawingWindow key={state.modelId} state={state} onCommand={send} onClose={() => window.close()} />;
}

// ── The window ──────────────────────────────────────────────────────

type Tool = "pick" | "crop" | "pan";

const muted = { color: "var(--color-vsc-text-muted)" } as const;

/** Re-render when a drawing opened or a raster became ready. */
function useDrawingsTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => onDrawingsChanged(() => setTick((t) => t + 1)), []);
  return tick;
}

export function PlaceDrawingWindow({
  state,
  onCommand,
  onClose,
}: {
  state: DrawingWindowState;
  onCommand: (c: DrawingCommand) => void;
  onClose: () => void;
}) {
  const tick = useDrawingsTick();
  const [assetId, setAssetId] = useState<string | null>(state.assets[0]?.id ?? null);
  const [page, setPage] = useState(1);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [form, setForm] = useState<CalibrationForm>(() => emptyForm());
  const [target, setTarget] = useState<PickTarget | null>({ kind: "x", index: 0 });
  const [tool, setTool] = useState<Tool>("pick");
  const [editing, setEditing] = useState<BackgroundImage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [seenNonce, setSeenNonce] = useState(0);

  const asset = state.assets.find((a) => a.id === assetId) ?? null;
  // (opens the file when it is first shown; re-rendered when it is ready)
  void tick;
  const source = assetId ? peekSource(assetId) : null;
  const error = assetId ? drawingError(assetId) : null;
  const unit: ScaleUnit = asset?.mime === "application/pdf" ? "pt" : "px";
  const unitName = unit === "pt" ? "point" : "pixel";

  // A placement to recalibrate: its file, page, crop and inputs.
  if (state.edit && state.edit.nonce !== seenNonce) {
    setSeenNonce(state.edit.nonce);
    const ref = state.placements.find((p) => p.modelId === state.modelId && p.placement.id === state.edit!.placementId);
    if (ref) {
      const p = ref.placement;
      const pUnit: ScaleUnit = state.assets.find((a) => a.id === p.assetId)?.mime === "application/pdf" ? "pt" : "px";
      setEditing(p);
      setAssetId(p.assetId);
      setPage(p.page ?? 1);
      setCrop(p.crop ?? null);
      const f = formFromCalibration(p.calibration, pUnit, () => {
        // A placement without inputs: two corners of what it shows, where they are now.
        const c = p.crop ?? (pageSizeOf(p.assetId, p.page ?? 1) ? { x0: 0, y0: 0, ...toXY(pageSizeOf(p.assetId, p.page ?? 1)!) } : null);
        if (!c) return [];
        return [
          { source: [c.x0, c.y1] as Pt, model: apply(p.transform, [c.x0, c.y1]) },
          { source: [c.x1, c.y1] as Pt, model: apply(p.transform, [c.x1, c.y1]) },
        ];
      });
      setForm(f);
      setTarget(nextTarget(f, null));
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
  const result = useMemo(() => evaluateForm(form, reuseScale, unitName), [form, reuseScale, unitName]);

  const pageSize = assetId ? pageSizeOf(assetId, page) : null;
  const shown: Crop | null = crop ?? (pageSize ? { x0: 0, y0: 0, x1: pageSize.width, y1: pageSize.height } : null);

  const chooseAsset = (id: string) => {
    if (id === assetId) return;
    setAssetId(id);
    setPage(1);
    setCrop(null);
    setForm((f) => ({ ...emptyForm(f.scale.unit), mode: f.mode }));
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
      setMessage(`${file.name} is not a PNG, JPEG, TIFF or PDF file.`);
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
    localBytes.set(id, { bytes, mime });
    onCommand({ type: "addAsset", id, name: file.name, mime, sha256, data: bytes });
    setMessage(null);
    chooseAsset(id);
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

  return (
    <div className="h-screen flex flex-col text-[12px]" style={{ background: "var(--color-vsc-bg)", color: "var(--color-vsc-text)" }}>
      <AssetStrip
        assets={state.assets}
        selected={assetId}
        onSelect={chooseAsset}
        onAdd={() => fileInput.current?.click()}
        modelName={state.modelName}
        editing={editing}
      />
      <input ref={fileInput} type="file" accept={DRAWING_ACCEPT} className="hidden" onChange={(e) => void addFile(e)} aria-label="Drawing file" />
      {message && (
        <div role="status" className="px-3 py-1 text-[11px]" style={{ background: "var(--color-vsc-input-bg)" }}>
          {message}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        {source && source.pageCount > 1 && <PageStrip source={source} assetId={assetId!} page={page} onPage={choosePage} />}
        <div className="flex-1 min-w-0 flex flex-col">
          <ViewerToolbar tool={tool} setTool={setTool} crop={crop} onClearCrop={() => setCrop(null)} unitName={unitName} pageSize={pageSize} />
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
              />
            )}
          </div>
        </div>
        <div className="w-[340px] shrink-0 border-l flex flex-col min-h-0" style={{ borderColor: "var(--color-vsc-border)" }}>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            <section aria-label="Crop">
              <h3 className="font-semibold text-[12px]">1. Crop</h3>
              <p className="text-[11px] mt-0.5" style={muted}>
                Optional: drag a rectangle around the section with the crop tool. {crop ? "" : "The whole page is placed now."}
              </p>
              <div className="flex gap-2 mt-1.5">
                <button className="btn" aria-pressed={tool === "crop"} onClick={() => setTool(tool === "crop" ? "pick" : "crop")} disabled={!source}>
                  Crop rectangle
                </button>
                <button className="btn" onClick={() => setCrop(null)} disabled={!crop}>
                  Whole page
                </button>
              </div>
            </section>
            <section aria-label="Calibrate">
              <h3 className="font-semibold text-[12px]">2. Calibrate</h3>
              <div role="radiogroup" aria-label="Calibration" className="flex gap-1 mt-1.5">
                {(
                  [
                    ["axes", "Axes (x and y separately)"],
                    ["points", "Points"],
                    ["scale", "Scale"],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} role="radio" aria-checked={form.mode === m} className="btn text-[11px]" aria-pressed={form.mode === m} onClick={() => setMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
              {form.mode === "axes" && (
                <AxesInputs form={form} setForm={setForm} target={target} setTarget={setTarget} reuseOptions={reuseOptions} />
              )}
              {form.mode === "points" && (
                <PointsInputs form={form} setForm={setForm} target={target} setTarget={setTarget} residuals={result.fit.ok ? result.fit.residuals : null} />
              )}
              {form.mode === "scale" && (
                <ScaleInputs form={form} setForm={setForm} target={target} setTarget={setTarget} isPdf={unit === "pt"} />
              )}
              <div className="mt-2 text-[11px]" aria-live="polite">
                {result.fit.ok ? (
                  <p data-testid="calibration-summary">{result.summary.join(" · ")}</p>
                ) : (
                  <p data-testid="calibration-message" style={{ color: "var(--color-vsc-warning, #c78a00)" }}>
                    {result.fit.error}
                  </p>
                )}
              </div>
            </section>
            <section aria-label="Preview">
              <h3 className="font-semibold text-[12px]">Preview</h3>
              <p className="text-[11px] mt-0.5" style={muted}>
                The drawing under {state.modelName || "the model"}, with its outline.
              </p>
              <Preview state={state} assetId={assetId} page={page} crop={shown} transform={result.fit.ok ? result.fit.transform : null} />
            </section>
          </div>
          <div className="p-3 border-t flex justify-end gap-2" style={{ borderColor: "var(--color-vsc-border)" }}>
            <button className="btn btn-primary min-w-[80px]" onClick={place} disabled={!result.fit.ok || !shown}>
              {editing ? "Update" : "Place"}
            </button>
            <button className="btn min-w-[80px]" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const toXY = (s: { width: number; height: number }) => ({ x1: s.width, y1: s.height });

// ── The files ───────────────────────────────────────────────────────

function AssetStrip({
  assets,
  selected,
  onSelect,
  onAdd,
  modelName,
  editing,
}: {
  assets: DrawingAssetInfo[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  modelName: string;
  editing: BackgroundImage | null;
}) {
  const kind = (mime: string) => (mime === "application/pdf" ? "PDF" : mime === "image/tiff" ? "TIFF" : mime === "image/jpeg" ? "JPEG" : "PNG");
  return (
    <div className="border-b px-3 py-2 flex items-center gap-3" style={{ borderColor: "var(--color-vsc-border)" }}>
      <div className="shrink-0">
        <div className="font-semibold">{editing ? "Recalibrate drawing" : "Place drawing"}</div>
        <div className="text-[11px]" style={muted}>
          into {modelName || "the active model"}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] mb-1" style={muted}>
          Drawings in this project
        </div>
        <div role="listbox" aria-label="Drawings in this project" className="flex gap-1.5 overflow-x-auto">
          {assets.length === 0 && (
            <span className="text-[11px]" style={muted}>
              None yet: add a PNG, JPEG, TIFF or PDF file.
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
    </div>
  );
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`;
}

function EmptyViewer({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2" style={muted}>
      <p>Add a drawing of the section: a PNG, JPEG, TIFF or PDF file.</p>
      <button className="btn" onClick={onAdd}>
        Add file…
      </button>
    </div>
  );
}

// ── Pages ───────────────────────────────────────────────────────────

function PageStrip({ source, assetId, page, onPage }: { source: DrawingSource; assetId: string; page: number; onPage: (n: number) => void }) {
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
      ctx.fillStyle = "#fff";
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

function ViewerToolbar({
  tool,
  setTool,
  crop,
  onClearCrop,
  unitName,
  pageSize,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  crop: Crop | null;
  onClearCrop: () => void;
  unitName: string;
  pageSize: { width: number; height: number } | null;
}) {
  return (
    <div className="px-2 py-1 border-b flex items-center gap-1.5 text-[11px]" style={{ borderColor: "var(--color-vsc-border)" }}>
      {(
        [
          ["pick", "Pick points"],
          ["crop", "Crop"],
          ["pan", "Pan"],
        ] as const
      ).map(([t, label]) => (
        <button key={t} className="btn text-[11px]" aria-pressed={tool === t} onClick={() => setTool(t)}>
          {label}
        </button>
      ))}
      {crop && (
        <button className="btn text-[11px]" onClick={onClearCrop}>
          Clear crop
        </button>
      )}
      <span className="flex-1" />
      <span style={muted}>
        Wheel: zoom · middle button or Space + drag: pan
        {pageSize ? ` · page ${Math.round(pageSize.width)} × ${Math.round(pageSize.height)} ${unitName}s` : ""}
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

const LOUPE = 140;
const LOUPE_ZOOM = 4;

function Viewer({
  assetId,
  page,
  tool,
  crop,
  onCrop,
  form,
  target,
  onPick,
}: {
  assetId: string;
  page: number;
  tool: Tool;
  crop: Crop | null;
  onCrop: (c: Crop) => void;
  form: CalibrationForm;
  target: PickTarget | null;
  onPick: (p: Pt) => void;
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

  // Fit the page (or the crop) when the page changes.
  const fitKey = `${assetId}|${page}|${pageSize ? 1 : 0}`;
  const [fitted, setFitted] = useState("");
  if (pageSize && fitted !== fitKey && size.w > 0) {
    setFitted(fitKey);
    const r = crop ?? { x0: 0, y0: 0, x1: pageSize.width, y1: pageSize.height };
    const zoom = Math.min((size.w - 40) / (r.x1 - r.x0), (size.h - 40) / (r.y1 - r.y0));
    setView({ zoom, x: size.w / 2 - ((r.x0 + r.x1) / 2) * zoom, y: size.h / 2 - ((r.y0 + r.y1) / 2) * zoom });
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setSpace(true);
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
    ctx.fillStyle = "#6b7078";
    ctx.fillRect(0, 0, size.w, size.h);
    const raster = rasterFor({ assetId, page }, view.zoom * dpr);
    if (pageSize) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(view.x, view.y, pageSize.width * view.zoom, pageSize.height * view.zoom);
    }
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
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.rect(view.x, view.y, pageSize.width * view.zoom, pageSize.height * view.zoom);
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#0a84ff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }
    drawMarks(ctx, formMarks(form), target, toScreen);
  }, [tick, view, size, assetId, page, crop, cropDraft, form, target, pageSize, toScreen]);

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
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    const raster = rasterFor({ assetId, page }, z * dpr, "loupe") ?? rasterFor({ assetId, page }, view.zoom * dpr);
    if (raster) {
      ctx.save();
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (LOUPE / 2 - u * z), dpr * (LOUPE / 2 - v * z));
      ctx.imageSmoothingQuality = "high";
      const r = raster.region;
      ctx.drawImage(raster.image, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
    }
    drawMarks(ctx, formMarks(form), target, (p) => [LOUPE / 2 + (p[0] - u) * z, LOUPE / 2 + (p[1] - v) * z]);
    ctx.strokeStyle = "#e5484d";
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
  const clampToPage = ([u, v]: Pt): Pt => (pageSize ? [Math.min(Math.max(u, 0), pageSize.width), Math.min(Math.max(v, 0), pageSize.height)] : [u, v]);

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const p = local(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || space || tool === "pan") {
      e.preventDefault();
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
          <div className="absolute pointer-events-none" style={{ left: 0, top: pointer.y, width: size.w, height: 0, borderTop: "1px dashed rgba(229,72,77,0.7)" }} />
          <div className="absolute pointer-events-none" style={{ top: 0, left: pointer.x, height: size.h, width: 0, borderLeft: "1px dashed rgba(229,72,77,0.7)" }} />
          <canvas
            ref={loupe}
            aria-hidden
            className="absolute pointer-events-none rounded-full"
            style={{
              width: LOUPE,
              height: LOUPE,
              left: Math.min(pointer.x + 24, size.w - LOUPE - 4),
              top: pointer.y - LOUPE - 24 < 0 ? pointer.y + 24 : pointer.y - LOUPE - 24,
              border: "2px solid var(--color-vsc-accent)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
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

function drawMarks(ctx: CanvasRenderingContext2D, marks: { at: Pt; label: string; target: PickTarget }[], target: PickTarget | null, toScreen: (p: Pt) => Pt) {
  ctx.save();
  ctx.font = "bold 11px system-ui, sans-serif";
  for (const m of marks) {
    const [x, y] = toScreen(m.at);
    const active = sameTarget(m.target, target);
    const color = m.target.kind === "x" ? "#d9480f" : m.target.kind === "y" ? "#2b8a3e" : "#0a63c9";
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
    ctx.fillStyle = "#ffffff";
    ctx.fillText(m.label, x + 11, y - 9);
  }
  ctx.restore();
}

// ── The inputs ──────────────────────────────────────────────────────

interface InputsProps {
  form: CalibrationForm;
  setForm: (f: CalibrationForm) => void;
  target: PickTarget | null;
  setTarget: (t: PickTarget | null) => void;
}

const fieldClass = "w-full min-w-0 text-[12px]";

/** A row's "pick" button: the next click in the drawing goes to it. */
function PickButton({ t, form, target, setTarget }: { t: PickTarget } & Pick<InputsProps, "form" | "target" | "setTarget">) {
  const has = !!targetSource(form, t);
  const active = sameTarget(t, target);
  return (
    <button
      className="btn text-[11px] min-w-[44px]"
      aria-pressed={active}
      title={active ? "Click in the drawing" : "Pick this point in the drawing"}
      onClick={() => setTarget(active ? null : t)}
    >
      {targetLabel(t)}
      {has ? " ✓" : ""}
    </button>
  );
}

function AxesInputs({ form, setForm, target, setTarget, reuseOptions }: InputsProps & { reuseOptions: DrawingWindowState["placements"] }) {
  const n = form.reuseFrom ? 1 : 2;
  const setTick = (axis: "x" | "y", i: number, value: string) =>
    setForm({ ...form, axes: { ...form.axes, [axis]: form.axes[axis].map((t: TickRow, k: number) => (k === i ? { ...t, value } : t)) } });
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11px]" style={muted}>
        Click two points on the horizontal axis and type their x; then two on the vertical axis and type their y. The x and y
        scales are found separately, so a section drawn with vertical exaggeration is placed true to scale.
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
      {reuseOptions.length > 0 && (
        <label className="flex flex-col gap-0.5 mt-1">
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
              <option key={`${r.modelId}/${r.placement.id}`} value={`${r.modelId}/${r.placement.id}`}>
                {r.modelName}: {placementLabel(r.placement)} (one point per axis)
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function PointsInputs({ form, setForm, target, setTarget, residuals }: InputsProps & { residuals: number[] | null }) {
  const setRow = (i: number, patch: Partial<PointRow>) => setForm({ ...form, points: form.points.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const filled = form.points.filter((p) => p.source && p.x.trim() && p.y.trim());
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11px]" style={muted}>
        Click a point in the drawing and type its model x and y; then a second one. Two points give the scale and the rotation;
        three or more are fitted (least squares), with the misfit of each point.
      </p>
      {form.points.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <PickButton t={{ kind: "point", index: i }} form={form} target={target} setTarget={setTarget} />
          <input className={fieldClass} placeholder="x (m)" value={p.x} aria-label={`Point ${i + 1} x`} onChange={(e) => setRow(i, { x: e.target.value })} inputMode="decimal" />
          <input className={fieldClass} placeholder="y (m)" value={p.y} aria-label={`Point ${i + 1} y`} onChange={(e) => setRow(i, { y: e.target.value })} inputMode="decimal" />
          {residuals && filled.length >= 3 && residuals[filled.indexOf(p)] !== undefined && (
            <span className="text-[10px] w-[58px] shrink-0 text-right whitespace-nowrap" style={muted} title="Misfit of this point">
              {residuals[filled.indexOf(p)].toFixed(3)} m
            </span>
          )}
          {form.points.length > 2 && (
            <button
              className="btn text-[11px] px-1.5"
              aria-label={`Remove point ${i + 1}`}
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

function ScaleInputs({ form, setForm, target, setTarget, isPdf }: InputsProps & { isPdf: boolean }) {
  const o = form.scale.origin;
  const set = (patch: Partial<CalibrationForm["scale"]>) => setForm({ ...form, scale: { ...form.scale, ...patch } });
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11px]" style={muted}>
        Click a point whose model coordinates you know and type them; then the drawing&apos;s scale.
      </p>
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
            <option value="pt">point (1/72 in)</option>
          </select>
        ) : (
          <span className="text-[11px]">pixel</span>
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
    ctx.fillStyle = "#ffffff";
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
    ctx.strokeStyle = "#0a84ff";
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
