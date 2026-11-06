/**
 * The drawings in the Models panel. Under each model, the drawings placed
 * in it (topmost first), each with its visibility and lock; a click selects
 * one (making its model the active one) and opens its settings below it:
 * opacity, "Show in results", order, Recalibrate…, Rename, Pick lines…,
 * Remove and a DWG or DXF drawing's layers. Below the models, Attachments
 * lists the project's files and the models that use each. Every change is
 * an undo step of the model (an opacity drag is one step).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  Lock,
  LockOpen,
  PencilRuler,
  Trash2,
} from "lucide-react";
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
 * settings of the selected one open below its row.
 */
export function ModelDrawings({ modelId }: { modelId: string }) {
  const drawings = useModelDrawings(modelId);
  if (drawings.length === 0) return null;
  return (
    <div role="group" aria-label="Drawings of the model">
      {drawings.map((b, i) => (
        <DrawingRow key={b.id} modelId={modelId} placement={b} first={i === 0} last={i === drawings.length - 1} />
      ))}
    </div>
  );
}

function DrawingRow({ modelId, placement: b, first, last }: { modelId: string; placement: BackgroundImage; first: boolean; last: boolean }) {
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
  return (
    <div role="none">
      <div
        role="treeitem"
        aria-label={label}
        aria-selected={selected}
        aria-level={2}
        className="group flex items-center gap-1.5 h-6 pl-[43px] pr-1 mx-1 rounded-sm text-[12px] cursor-pointer select-none"
        style={{
          background: selected ? "var(--color-vsc-selected-bg)" : undefined,
          color: selected ? "var(--color-vsc-text-bright)" : "var(--color-vsc-text)",
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
        title={`${label}: click for its settings, double-click to rename`}
        data-testid="drawing-tree-row"
      >
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
      </div>
      {selected && isActiveModel && (
        <DrawingSettings placement={b} label={label} first={first} last={last} onRename={() => setEditing(label)} />
      )}
    </div>
  );
}

/** The selected drawing's settings, below its row (the active model's). */
function DrawingSettings({
  placement: b,
  label,
  first,
  last,
  onRename,
}: {
  placement: BackgroundImage;
  label: string;
  first: boolean;
  last: boolean;
  onRename: () => void;
}) {
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
        <span className="ml-auto flex items-center">
          <button className={iconButton} disabled={first} onClick={() => st().moveBackground(b.id, "up")} aria-label={`Move ${label} up`} title="Draw over the drawing above it">
            <ChevronUp size={13} strokeWidth={1.75} aria-hidden />
          </button>
          <button className={iconButton} disabled={last} onClick={() => st().moveBackground(b.id, "down")} aria-label={`Move ${label} down`} title="Draw under the drawing below it">
            <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
          </button>
          <button className={iconButton} onClick={() => st().removeBackground(b.id)} aria-label={`Remove ${label} from the model`} title="Remove from the model (the file stays in Attachments while another model uses it)">
            <Trash2 size={12} strokeWidth={1.75} aria-hidden />
          </button>
        </span>
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
 * "+ Add drawing…" under the list opens the Place drawing window; "Place…" on a file places it in
 * the active model.
 */
export function AttachmentsPanel() {
  const assets = useProjectAssets().filter((a) => DRAWING_MIME[a.mime] !== undefined);
  const models = useAppStore((s) => s.models);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const activeBackgrounds = useAppStore((s) => s.backgrounds);
  const [open, setOpen] = useState(true);
  if (assets.length === 0) return null;
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
      {open && (
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
          className="mx-4 mt-0.5 mb-1.5 text-[11px] cursor-pointer hover:underline font-medium"
          style={{ color: "var(--color-vsc-accent)" }}
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
      <button className="flex items-center gap-1 text-[11px]" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Layers of ${label}`}>
        <FoldChevron open={open} />
        Layers <span style={muted}>({shown} of {layers.length} shown)</span>
      </button>
      {open && (
        <div className="mt-1 pl-3 flex flex-col gap-0.5 max-h-[180px] overflow-y-auto" role="group" aria-label={`Layers of ${label}`}>
          <div className="flex gap-2 text-[10px]">
            <button className="underline" onClick={() => onChange([])} disabled={hidden.length === 0}>
              Show all
            </button>
            <button className="underline" onClick={() => onChange([...layers])} disabled={shown === 0}>
              Hide all
            </button>
          </div>
          {layers.map((name) => (
            <label key={name} className="flex items-center gap-1.5 min-w-0">
              <input
                type="checkbox"
                checked={!hidden.includes(name)}
                onChange={(e) => onChange(e.target.checked ? hidden.filter((h) => h !== name) : [...hidden, name])}
              />
              <span className="truncate">{name || "(no name)"}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
