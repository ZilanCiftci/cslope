/**
 * The Drawings section of the Models panel: the active model's placed
 * drawings, topmost first, each with its visibility, lock, opacity,
 * "Show in results", name, order, Recalibrate… and Remove. Every change
 * is an undo step of the model (an opacity drag is one step).
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Trash2 } from "lucide-react";
import { useAppStore } from "../../store/app-store";
import { isObjectLocked, sameObject } from "../../store/canvas-selection";
import { sortedBackgrounds } from "../../store/slices/backgroundsSlice";
import type { BackgroundImage } from "../../store/types";
import { projectAsset } from "./asset-registry";
import { placementLabel } from "./placement";
import { openPlaceDrawing } from "./window-sync";

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
  const label = placementLabel(b, projectAsset(b.assetId)?.originalName);
  const iconButton = "w-6 h-6 flex items-center justify-center rounded-sm hover:bg-(--color-vsc-list-active)";
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
      <div className="flex items-center gap-1.5 mt-1">
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
      <div className="flex items-center gap-1 mt-1">
        <button className="btn text-[11px] px-2 py-0.5" onClick={() => openPlaceDrawing(b.id)}>
          Recalibrate…
        </button>
        <button className="btn text-[11px] px-2 py-0.5" onClick={() => setEditing(label)}>
          Rename
        </button>
      </div>
    </div>
  );
}
