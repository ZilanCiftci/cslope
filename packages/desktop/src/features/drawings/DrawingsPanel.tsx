/**
 * The Drawings section of the Models panel: the active model's placed
 * drawings, topmost first, each with its visibility, lock, opacity,
 * "Show in results", name, order, Recalibrate… and Remove; a DWG or DXF
 * drawing's layers (each shown or hidden), and "Pick lines…" for a drawing
 * with line work. Every change is an undo step of the model (an opacity
 * drag is one step).
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Trash2 } from "lucide-react";
import { useAppStore } from "../../store/app-store";
import { isObjectLocked, sameObject } from "../../store/canvas-selection";
import { sortedBackgrounds } from "../../store/slices/backgroundsSlice";
import type { BackgroundImage } from "../../store/types";
import { projectAsset } from "./asset-registry";
import { placementLabel } from "./placement";
import { openPlaceDrawing } from "./window-sync";
import { onDrawingsChanged, peekSource, vectorsFor } from "./drawing-cache";
import { startLinePick, useLinePick } from "./line-pick-store";
import { PICK_LINES_HIDDEN } from "./pick-lines-target";

const muted = { color: "var(--color-vsc-text-muted)" } as const;

/** Apply a series of live changes as one undo step: from `start` to the last value. */
function oneStep(id: string, start: Partial<BackgroundImage>, end: Partial<BackgroundImage>): void {
  const temporal = useAppStore.temporal.getState();
  temporal.pause();
  useAppStore.getState().updateBackground(id, start);
  temporal.resume();
  useAppStore.getState().updateBackground(id, end);
}

export function DrawingsPanel() {
  const backgrounds = useAppStore((s) => s.backgrounds);
  const [open, setOpen] = useState(true);
  const list = sortedBackgrounds(backgrounds).reverse();
  // Shown once the model has a drawing (Model › Drawing places the first).
  if (list.length === 0) return null;
  return (
    <div className="border-t" style={{ borderColor: "var(--color-vsc-border)" }} data-testid="drawings-panel">
      <div className="flex items-center">
        <button
          className="flex items-center gap-1.5 px-4 py-1.5 cursor-pointer flex-1 text-left text-[10px] font-bold uppercase tracking-[0.08em] select-none"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle drawings list"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}>
            <path d="M2 3l3 3.5L8 3z" />
          </svg>
          Drawings
        </button>
        <button className="btn text-[11px] mr-2 px-2 py-0.5" onClick={() => openPlaceDrawing()} title="Place drawing…">
          Place…
        </button>
      </div>
      {open && (
        <div className="pb-2" role="list" aria-label="Drawings of the model">
          {list.map((b, i) => (
            <DrawingRow key={b.id} placement={b} first={i === 0} last={i === list.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function DrawingRow({ placement: b, first, last }: { placement: BackgroundImage; first: boolean; last: boolean }) {
  const locked = useAppStore((s) => isObjectLocked(s.locks, { type: "background", id: b.id }));
  const selected = useAppStore((s) => sameObject(s.canvasSelection?.object, { type: "background", id: b.id }));
  const st = () => useAppStore.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => onDrawingsChanged(() => setTick((t) => t + 1)), []);
  const picking = useLinePick((s) => s.placementId === b.id);
  const kind = peekSource(b.assetId)?.kind;
  const drawing = kind === "vector" ? vectorsFor(b.assetId, b.page ?? 1) : null;
  const label = placementLabel(b, projectAsset(b.assetId)?.originalName);
  const iconButton =
    "w-6 h-6 flex items-center justify-center rounded-sm hover:bg-(--color-vsc-list-active) disabled:opacity-35 disabled:pointer-events-none";
  const commitName = () => {
    if (editing !== null) {
      const name = editing.trim();
      if (name && name !== b.name) st().updateBackground(b.id, { name });
      setEditing(null);
    }
  };
  return (
    <div
      role="listitem"
      aria-label={label}
      className="mx-2 my-1 px-2 py-1.5 rounded text-[11px]"
      style={{
        background: selected ? "var(--color-vsc-list-active)" : "transparent",
        border: "1px solid var(--color-vsc-border)",
      }}
    >
      <div className="flex items-center gap-1">
        <button
          className={iconButton}
          onClick={() => st().updateBackground(b.id, { visible: !b.visible })}
          aria-label={b.visible ? `Hide ${label}` : `Show ${label}`}
          title={b.visible ? "Hide" : "Show"}
          aria-pressed={!b.visible}
        >
          {b.visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
        </button>
        {editing !== null ? (
          <input
            autoFocus
            className="flex-1 min-w-0 text-[11px]"
            value={editing}
            aria-label="Drawing name"
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
          <button
            className="flex-1 min-w-0 truncate text-left"
            style={{ opacity: b.visible ? 1 : 0.55 }}
            onClick={() => st().selectCanvasObject({ type: "background", id: b.id })}
            onDoubleClick={() => setEditing(label)}
            title={`${label} (double-click to rename)`}
          >
            {label}
          </button>
        )}
        <button
          className={iconButton}
          onClick={() => st().setObjectLocked({ type: "background", id: b.id }, !locked)}
          aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
          title={locked ? "Locked: clicks on the canvas go to the model. Click to unlock (then it can be selected and moved)." : "Unlocked: click to lock"}
          aria-pressed={locked}
        >
          {locked ? <Lock size={12} aria-hidden /> : <LockOpen size={12} aria-hidden />}
        </button>
      </div>
      <div className="flex items-center gap-1.5 mt-1" style={{ opacity: b.visible ? 1 : 0.55 }} title={b.visible ? undefined : "The drawing is hidden"}>
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
      <div className="flex items-center gap-1 mt-1">
        <label className="flex items-center gap-1 flex-1 min-w-0" title="Also draw it in the result view and the PDF export">
          <input type="checkbox" checked={b.showInResults === true} onChange={(e) => st().updateBackground(b.id, { showInResults: e.target.checked || undefined })} />
          <span className="truncate">Show in results</span>
        </label>
        <button className={iconButton} disabled={first} onClick={() => st().moveBackground(b.id, "up")} aria-label={`Move ${label} up`} title="Draw over the drawing above it">
          <ChevronUp size={13} aria-hidden />
        </button>
        <button className={iconButton} disabled={last} onClick={() => st().moveBackground(b.id, "down")} aria-label={`Move ${label} down`} title="Draw under the drawing below it">
          <ChevronDown size={13} aria-hidden />
        </button>
        <button className={iconButton} onClick={() => st().removeBackground(b.id)} aria-label={`Remove ${label} from the model`} title="Remove from model (the file stays in the project while another model uses it)">
          <Trash2 size={12} aria-hidden />
        </button>
      </div>
      <div className="flex items-center flex-wrap gap-1 mt-1">
        <button className="btn text-[11px] px-2 py-0.5" onClick={() => openPlaceDrawing(b.id)}>
          Recalibrate…
        </button>
        <button className="btn text-[11px] px-2 py-0.5" onClick={() => setEditing(label)}>
          Rename
        </button>
        {(kind === "vector" || kind === "pdf") && (
          <button
            className="btn text-[11px] px-2 py-0.5"
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
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} aria-hidden>
          <path d="M2 3l3 3.5L8 3z" />
        </svg>
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
