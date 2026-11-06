/**
 * The drawings in the Models panel. Under each model, the drawings placed
 * in it (topmost first), each with its visibility and lock, and on hover a
 * grip (drag to change the drawing order, or Alt+Up and Alt+Down) and an
 * "×" that removes it from the model. A click selects one (making its
 * model the active one) and opens its settings below it: opacity, "Show in
 * results", Recalibrate…, Rename, Pick lines… and a DWG or DXF drawing's
 * layers. Below the models, Attachments lists the project's files and the
 * models that use each ("No files." without any). Every change is an undo
 * step of the model (an opacity drag is one step).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, FileImage, FileText, GripVertical, Lock, LockOpen, PencilRuler, X } from "lucide-react";
import { FoldChevron, SECTION_HEADING_ROW, SECTION_HEADING_TEXT } from "../../components/ui/Section";
import { useAppStore } from "../../store/app-store";
import { isObjectLocked, sameObject } from "../../store/canvas-selection";
import { sortedBackgrounds } from "../../store/slices/backgroundsSlice";
import type { BackgroundImage } from "../../store/types";
import { onProjectAssetsChanged, openedProjectAssets, projectAsset } from "./asset-registry";
import { placementLabel } from "./placement";
import { openPlaceDrawing } from "./window-sync";
import { onDrawingsChanged, peekSource, vectorsFor } from "./drawing-cache";
import { startLinePick, useLinePick } from "./line-pick-store";
import { PICK_LINES_HIDDEN } from "./pick-lines-target";
import { DRAWING_MIME } from "./sources";

const muted = { color: "var(--color-vsc-text-muted)" } as const;

/** Apply a series of live changes as one undo step: from `start` to the last value. */
function oneStep(id: string, start: Partial<BackgroundImage>, end: Partial<BackgroundImage>): void {
  const temporal = useAppStore.temporal.getState();
  temporal.pause();
  useAppStore.getState().updateBackground(id, start);
  temporal.resume();
  useAppStore.getState().updateBackground(id, end);
}

/** The icon of a drawing file's kind (an image, a PDF, line work). */
function KindIcon({ mime, size = 13 }: { mime: string | undefined; size?: number }) {
  const kind = mime ? DRAWING_MIME[mime] : undefined;
  const Icon = kind === "vector" ? PencilRuler : kind === "pdf" ? FileText : FileImage;
  return <Icon size={size} strokeWidth={1.75} className="shrink-0" aria-hidden color="var(--color-vsc-text-muted)" />;
}

const iconButton =
  "w-6 h-6 flex items-center justify-center rounded-sm hover:bg-(--color-vsc-list-active) disabled:opacity-35 disabled:pointer-events-none shrink-0";

/** A text link of the panels ("+ Add drawing…", "Show all"). */
const textLink = "text-[11px] font-medium cursor-pointer hover:underline disabled:cursor-default disabled:no-underline";
/** A text link's color: the link color, or the disabled text color. */
const linkColor = (disabled = false) =>
  ({ color: disabled ? "var(--color-vsc-field-disabled-text)" : "var(--color-vsc-link)" }) as const;

/** Make `modelId` the active model (a drawing of another model was clicked). */
function activate(modelId: string): void {
  const st = useAppStore.getState();
  if (st.activeModelId !== modelId) st.switchModel(modelId);
}

/** A model's placed drawings (the active model's as they are now), topmost first. */
function useModelDrawings(modelId: string): BackgroundImage[] {
  const own = useAppStore((s) => (s.activeModelId === modelId ? s.backgrounds : s.models.find((m) => m.id === modelId)?.backgrounds));
  return sortedBackgrounds(own ?? []).reverse();
}

/**
 * The drawings of a model, as rows under it in the models tree. The
 * settings of the selected one open below its row. A row is dragged by its
 * grip, or moved with Alt+Up and Alt+Down, to change the drawing order
 * within its model; Delete or its "×" removes it from the model.
 */
export function ModelDrawings({ modelId }: { modelId: string }) {
  const drawings = useModelDrawings(modelId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  // The row to focus after a change of the list (a moved or removed row's).
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (pendingFocus.current === null) return;
    rowRefs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  if (drawings.length === 0) return null;
  const n = drawings.length;
  /** Move `id` to `displayIndex` of the list (topmost first, after the move). */
  const moveTo = (id: string, displayIndex: number) => {
    const from = drawings.findIndex((d) => d.id === id);
    const to = Math.max(0, Math.min(n - 1, displayIndex));
    if (from < 0 || from === to) return;
    activate(modelId);
    useAppStore.getState().moveBackgroundTo(id, n - 1 - to);
  };
  const endDrag = () => {
    setDragId(null);
    setDrop(null);
  };
  return (
    <div
      role="group"
      aria-label="Drawings of the model"
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
    >
      {drawings.map((b, i) => (
        <DrawingRow
          key={b.id}
          modelId={modelId}
          placement={b}
          rowRef={(el) => {
            if (el) rowRefs.current.set(b.id, el);
            else rowRefs.current.delete(b.id);
          }}
          dragging={dragId === b.id}
          dragActive={dragId !== null}
          dropLine={drop?.id === b.id && dragId !== null && dragId !== b.id ? (drop.after ? "after" : "before") : null}
          onDragStart={() => setDragId(b.id)}
          onDragOver={(after) => {
            if (drop?.id !== b.id || drop.after !== after) setDrop({ id: b.id, after });
          }}
          onDrop={() => {
            if (dragId !== null && dragId !== b.id) {
              const from = drawings.findIndex((d) => d.id === dragId);
              let to = i + (drop?.id === b.id && drop.after ? 1 : 0);
              if (from < to) to -= 1;
              pendingFocus.current = dragId;
              moveTo(dragId, to);
            }
            endDrag();
          }}
          onDragEnd={endDrag}
          onMove={(step) => {
            pendingFocus.current = b.id;
            moveTo(b.id, i + step);
          }}
          onRemoved={() => {
            const next = drawings[i + 1] ?? drawings[i - 1];
            if (next) pendingFocus.current = next.id;
          }}
        />
      ))}
    </div>
  );
}

function DrawingRow({
  modelId,
  placement: b,
  rowRef,
  dragging,
  dragActive,
  dropLine,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onRemoved,
}: {
  modelId: string;
  placement: BackgroundImage;
  rowRef: (el: HTMLElement | null) => void;
  dragging: boolean;
  /** A drawing of this model is being dragged. */
  dragActive: boolean;
  dropLine: "before" | "after" | null;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  /** Move one step in the list: -1 up (over the others), 1 down. */
  onMove: (step: -1 | 1) => void;
  /** Called before the drawing is removed (to focus the next row). */
  onRemoved: () => void;
}) {
  const isActiveModel = useAppStore((s) => s.activeModelId === modelId);
  const locked = useAppStore((s) =>
    isObjectLocked(s.activeModelId === modelId ? s.locks : (s.models.find((m) => m.id === modelId)?.locks ?? {}), { type: "background", id: b.id }),
  );
  const selected = useAppStore((s) => s.activeModelId === modelId && sameObject(s.canvasSelection?.object, { type: "background", id: b.id }));
  const [editing, setEditing] = useState<string | null>(null);
  const mime = projectAsset(b.assetId)?.mime;
  const label = placementLabel(b, projectAsset(b.assetId)?.originalName);
  const st = () => useAppStore.getState();
  // Acts on the model's drawing: its model is made the active one first.
  const act = (f: () => void) => {
    activate(modelId);
    f();
  };
  const commitName = () => {
    if (editing !== null) {
      const name = editing.trim();
      if (name && name !== b.name) act(() => st().updateBackground(b.id, { name }));
      setEditing(null);
    }
  };
  const remove = () => {
    onRemoved();
    act(() => st().removeBackground(b.id));
  };
  return (
    <div role="none">
      <div
        ref={rowRef}
        role="treeitem"
        aria-label={label}
        aria-selected={selected}
        aria-level={2}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
        tabIndex={selected ? 0 : -1}
        className="group relative flex items-center gap-1.5 h-6 pl-[43px] pr-1 mx-1 rounded-sm text-[12px] cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-(--color-vsc-accent)"
        style={{
          background: selected ? "var(--color-vsc-selected-bg)" : undefined,
          color: selected ? "var(--color-vsc-text-bright)" : "var(--color-vsc-text)",
          opacity: dragging ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (!selected) (e.currentTarget as HTMLElement).style.background = "var(--color-vsc-list-hover)";
        }}
        onMouseLeave={(e) => {
          if (!selected) (e.currentTarget as HTMLElement).style.background = "";
        }}
        onClick={() => {
          if (editing !== null) return;
          act(() => (selected ? st().clearCanvasSelection() : st().selectCanvasObject({ type: "background", id: b.id })));
        }}
        onDoubleClick={() => setEditing(label)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Delete" || e.key === "Backspace") {
            // This drawing only (not the canvas's Delete of the selection).
            e.preventDefault();
            e.stopPropagation();
            remove();
          } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            e.stopPropagation();
            onMove(e.key === "ArrowUp" ? -1 : 1);
          }
        }}
        draggable={editing === null}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", label);
          onDragStart();
        }}
        onDragOver={(e) => {
          // Only a drawing of the same model: drawings stay under their model.
          if (!dragActive) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const r = e.currentTarget.getBoundingClientRect();
          onDragOver(e.clientY > r.top + r.height / 2);
        }}
        onDrop={(e) => {
          if (!dragActive) return;
          e.preventDefault();
          e.stopPropagation();
          onDrop();
        }}
        onDragEnd={onDragEnd}
        title={`${label}: click for its settings, double-click to rename`}
        data-testid="drawing-tree-row"
      >
        {dropLine && (
          <span
            aria-hidden
            data-testid="drawing-drop-indicator"
            className="pointer-events-none absolute left-1 right-1 h-[2px] rounded-full"
            style={{ background: "var(--color-vsc-accent)", [dropLine === "after" ? "bottom" : "top"]: -1 }}
          />
        )}
        <span
          className="absolute left-[26px] inset-y-0 w-3 flex items-center justify-center opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60 cursor-grab"
          style={muted}
          aria-hidden
          title="Drag to change the drawing order (or Alt+Up, Alt+Down)"
        >
          <GripVertical size={12} strokeWidth={1.75} />
        </span>
        <KindIcon mime={mime} />
        {editing !== null ? (
          <input
            autoFocus
            className="flex-1 min-w-0 h-[22px] text-[11px] py-0"
            value={editing}
            aria-label="Drawing name"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(null);
              }
            }}
          />
        ) : (
          // A hidden drawing's name in the muted color; the eye-off icon tells why.
          <span className="flex-1 min-w-0 truncate" style={b.visible ? undefined : muted}>
            {label}
          </span>
        )}
        <button
          className={iconButton}
          onClick={(e) => {
            e.stopPropagation();
            act(() => st().updateBackground(b.id, { visible: !b.visible }));
          }}
          aria-label={b.visible ? `Hide ${label}` : `Show ${label}`}
          title={b.visible ? "Hide" : "Show"}
          aria-pressed={!b.visible}
        >
          {b.visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
        </button>
        <button
          className={iconButton}
          onClick={(e) => {
            e.stopPropagation();
            act(() => st().setObjectLocked({ type: "background", id: b.id }, !locked));
          }}
          aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
          title={locked ? "Locked: clicks on the canvas go to the model. Click to unlock (then it can be selected and moved)." : "Unlocked: click to lock"}
          aria-pressed={locked}
        >
          {locked ? <Lock size={12} aria-hidden /> : <LockOpen size={12} aria-hidden />}
        </button>
        {/* Shown on hover (and on the focused row); Delete does the same. */}
        <button
          className={`${iconButton} opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus:opacity-100`}
          style={muted}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            remove();
          }}
          aria-label={`Remove ${label} from the model`}
          title="Remove from the model (the file stays in Attachments while another model uses it)"
        >
          <X size={13} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      {selected && isActiveModel && <DrawingSettings placement={b} label={label} onRename={() => setEditing(label)} />}
    </div>
  );
}

/** The selected drawing's settings, below its row (the active model's). */
function DrawingSettings({ placement: b, label, onRename }: { placement: BackgroundImage; label: string; onRename: () => void }) {
  const st = () => useAppStore.getState();
  const [drag, setDrag] = useState<number | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => onDrawingsChanged(() => setTick((t) => t + 1)), []);
  const picking = useLinePick((s) => s.placementId === b.id);
  const kind = peekSource(b.assetId)?.kind;
  const drawing = kind === "vector" ? vectorsFor(b.assetId, b.page ?? 1) : null;
  return (
    <div
      className="ml-[47px] mr-2 mt-0.5 mb-1.5 px-2 py-1.5 rounded text-[11px]"
      style={{ border: "1px solid var(--color-vsc-border)", background: "var(--color-vsc-panel, transparent)" }}
      data-testid="drawing-settings"
    >
      <div className="flex items-center gap-1.5" style={b.visible ? undefined : muted} title={b.visible ? undefined : "The drawing is hidden"}>
        <span style={muted}>Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          className="flex-1 min-w-0"
          aria-label={`Opacity of ${label}`}
          value={Math.round((drag ?? b.opacity) * 100)}
          onPointerDown={() => setDrag(b.opacity)}
          onChange={(e) => {
            const opacity = Number(e.target.value) / 100;
            if (drag !== null) {
              // Live while dragging, one undo step at the end.
              const temporal = useAppStore.temporal.getState();
              temporal.pause();
              st().updateBackground(b.id, { opacity });
              temporal.resume();
            } else {
              st().updateBackground(b.id, { opacity });
            }
          }}
          onPointerUp={() => {
            if (drag !== null) {
              const end = useAppStore.getState().backgrounds.find((x) => x.id === b.id)?.opacity ?? drag;
              if (end !== drag) oneStep(b.id, { opacity: drag }, { opacity: end });
              setDrag(null);
            }
          }}
        />
        <span className="w-8 text-right tabular-nums">{Math.round(b.opacity * 100)}%</span>
      </div>
      {/* The checkbox on a line of its own, so its label is never cut. */}
      <label className="flex items-center gap-1 mt-1 min-w-0" title="Also draw it in the result view and the PDF export">
        <input type="checkbox" checked={b.showInResults === true} onChange={(e) => st().updateBackground(b.id, { showInResults: e.target.checked || undefined })} />
        <span className="truncate">Show in results</span>
      </label>
      <div className="flex items-center flex-wrap gap-1 mt-1">
        <button className="btn text-[11px]" onClick={() => openPlaceDrawing(b.id)}>
          Recalibrate…
        </button>
        <button className="btn text-[11px]" onClick={onRename}>
          Rename
        </button>
        {(kind === "vector" || kind === "pdf") && (
          <button
            className="btn text-[11px]"
            aria-pressed={picking}
            disabled={!b.visible}
            title={
              b.visible
                ? "Pick lines of the drawing on the canvas and use them as the exterior boundary, material boundaries or water lines"
                : PICK_LINES_HIDDEN
            }
            onClick={() => (picking ? useLinePick.getState().stop() : startLinePick(b.id))}
          >
            {picking ? "Done picking" : "Pick lines…"}
          </button>
        )}
      </div>
      {drawing && drawing.layers.length > 0 && (
        <LayerList
          label={label}
          layers={drawing.layers}
          hidden={b.hiddenLayers ?? []}
          open={layersOpen}
          setOpen={setLayersOpen}
          onChange={(hiddenLayers) => st().updateBackground(b.id, { hiddenLayers: hiddenLayers.length > 0 ? hiddenLayers : undefined })}
        />
      )}
    </div>
  );
}

/** The project's files: a new list each time they change. */
function useProjectAssets() {
  return useSyncExternalStore(onProjectAssetsChanged, openedProjectAssets);
}

const sizeText = (bytes: number | undefined) =>
  bytes === undefined ? "" : bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;

/**
 * The project's attached files (the drawings' files), each with the models
 * that place it; one no model uses is left out when the project is saved.
 * Without files it says "No files.". "+ Add drawing…" under the list opens
 * the Place drawing window; "Place…" on a file places it in the active model.
 */
export function AttachmentsPanel() {
  const assets = useProjectAssets().filter((a) => DRAWING_MIME[a.mime] !== undefined);
  const models = useAppStore((s) => s.models);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const activeBackgrounds = useAppStore((s) => s.backgrounds);
  const [open, setOpen] = useState(true);
  const usedBy = (assetId: string) =>
    models.filter((m) => (m.id === activeModelId ? activeBackgrounds : (m.backgrounds ?? [])).some((b) => b.assetId === assetId)).map((m) => m.name);
  return (
    <div data-testid="attachments-panel">
      {/* The same heading row as Models: 24 px between borders, on the tint. */}
      <button
        className={`${SECTION_HEADING_ROW} ${SECTION_HEADING_TEXT} w-full cursor-pointer text-left`}
        style={{
          background: "var(--color-vsc-surface-tint)",
          color: "var(--color-vsc-text-muted)",
          borderTop: "1px solid var(--color-vsc-border)",
          borderBottom: "1px solid var(--color-vsc-border)",
        }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Toggle attachments list"
      >
        <FoldChevron open={open} />
        Attachments
      </button>
      {open && assets.length === 0 && (
        <p className="px-4 pt-1.5 text-[11px]" style={muted}>
          No files.
        </p>
      )}
      {open && assets.length > 0 && (
        <ul className="pt-1" aria-label="Attached files">
          {assets.map((a) => {
            const users = usedBy(a.id);
            return (
              <li
                key={a.id}
                aria-label={a.originalName}
                className="group flex items-start gap-2 px-4 py-1 mx-1 rounded-sm text-[12px] hover:bg-(--color-vsc-list-hover)"
              >
                <span className="mt-[2px]">
                  <KindIcon mime={a.mime} size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate" title={a.originalName}>
                    {a.originalName}
                  </div>
                  <div className="text-[10px] truncate" style={muted} title={users.join(", ")}>
                    {[sizeText(a.bytes), users.length > 0 ? `in ${users.join(", ")}` : "not used (left out when saved)"].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <button
                  className="btn text-[11px] shrink-0 self-center opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => openPlaceDrawing({ assetId: a.id })}
                  aria-label={`Place ${a.originalName} in the active model`}
                  title="Place in the active model"
                >
                  Place…
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <button
          className={`${textLink} mx-4 mt-0.5 mb-1.5`}
          style={linkColor()}
          onClick={() => openPlaceDrawing()}
          title="Add a drawing file and place it in the active model"
        >
          + Add drawing…
        </button>
      )}
    </div>
  );
}

/** A DWG or DXF drawing's layers, each shown or hidden (the placement's `hiddenLayers`). */
function LayerList({
  label,
  layers,
  hidden,
  open,
  setOpen,
  onChange,
}: {
  label: string;
  layers: string[];
  hidden: string[];
  open: boolean;
  setOpen: (v: boolean) => void;
  onChange: (hidden: string[]) => void;
}) {
  const shown = layers.filter((l) => !hidden.includes(l)).length;
  return (
    <div className="mt-1">
      {/* The heading row; with the list open, Show all and Hide all as text links at its end. */}
      <div className="flex items-center gap-2 min-w-0">
        <button className="flex items-center gap-1 text-[11px] min-w-0" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Layers of ${label}`}>
          <FoldChevron open={open} />
          <span className="truncate">
            Layers <span style={muted}>({shown} of {layers.length} shown)</span>
          </span>
        </button>
        {open && (
          <span className="ml-auto flex items-center gap-2 shrink-0">
            <button className={textLink} style={linkColor(hidden.length === 0)} onClick={() => onChange([])} disabled={hidden.length === 0}>
              Show all
            </button>
            <button className={textLink} style={linkColor(shown === 0)} onClick={() => onChange([...layers])} disabled={shown === 0}>
              Hide all
            </button>
          </span>
        )}
      </div>
      {open && (
        // One row per layer with its eye, as the drawings' rows in the tree.
        <ul className="mt-0.5 -mr-1 max-h-[180px] overflow-y-auto" aria-label={`Layers of ${label}`}>
          {layers.map((name) => {
            const on = !hidden.includes(name);
            const shownName = name || "(no name)";
            return (
              <li key={name} aria-label={shownName} className="flex items-center gap-1.5 h-6 pl-4 rounded-sm min-w-0 hover:bg-(--color-vsc-list-hover)">
                <span className="flex-1 min-w-0 truncate" style={on ? undefined : muted} title={shownName}>
                  {shownName}
                </span>
                <button
                  className={iconButton}
                  onClick={() => onChange(on ? [...hidden, name] : hidden.filter((h) => h !== name))}
                  aria-label={on ? `Hide layer ${shownName}` : `Show layer ${shownName}`}
                  title={on ? "Hide" : "Show"}
                  aria-pressed={!on}
                >
                  {on ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
