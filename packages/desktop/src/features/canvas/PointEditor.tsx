import { useState } from "react";
import { useAppStore } from "../../store/app-store";
import { canvasObjectLabel, canvasPointLabel, isObjectLocked } from "../../store/canvas-selection";
import type { CanvasObjectRef, CanvasPointKey } from "../../store/types";
import { surfaceYAtX } from "../view/surface";
import { handleAxes, handlePosition, moveHandleTo } from "./handle-edit";

/** The point the editor is open for, and where (canvas px). */
export interface PointEditorState {
  object: CanvasObjectRef;
  point: CanvasPointKey;
  x: number;
  y: number;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * A small editor beside a point (a double-click on it): its exact x and y
 * (x only for a load or search limit, the radius for a circle's rim).
 * Enter applies them as one undo step, Escape closes it. A locked object's
 * point is shown but cannot be changed.
 */
export function PointEditor({ editor, onClose }: { editor: PointEditorState; onClose: () => void }) {
  const st = useAppStore.getState();
  const ground = (x: number) => surfaceYAtX(st.coordinates, x);
  const at = handlePosition(st, editor.object, editor.point, ground);
  const axes = handleAxes(editor.object, editor.point);
  const plane = editor.object.type === "customPlane" ? st.customSearchPlanes.find((p) => p.id === (editor.object as { id: string }).id) : undefined;
  const locked = isObjectLocked(st.locks, editor.object);
  const [x, setX] = useState(() => (axes === "radius" ? fmt(plane?.radius ?? 0) : at ? fmt(at[0]) : ""));
  const [y, setY] = useState(() => (at ? fmt(at[1]) : ""));

  const apply = () => {
    const s = useAppStore.getState();
    if (isObjectLocked(s.locks, editor.object)) return;
    const nx = parseFloat(x);
    const ny = parseFloat(y);
    if (!Number.isFinite(nx) || (axes === "xy" && !Number.isFinite(ny))) return;
    if (axes === "radius") {
      if (plane && !plane.points && nx > 0) s.updateCustomSearchPlane(plane.id, { radius: nx });
    } else {
      const cur = handlePosition(s, editor.object, editor.point, (v) => surfaceYAtX(s.coordinates, v));
      moveHandleTo(s, s, editor.object, editor.point, [nx, axes === "x" ? (cur?.[1] ?? 0) : ny]);
    }
    onClose();
  };

  const field = (label: string, value: string, set: (v: string) => void, focus = false) => (
    <label className="flex items-center gap-1.5">
      <span className="w-3 text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>
        {label}
      </span>
      <input
        autoFocus={focus}
        onFocus={(e) => e.target.select()}
        type="text"
        inputMode="decimal"
        value={value}
        disabled={locked}
        aria-label={`${label} (m)`}
        onChange={(e) => set(e.target.value)}
        className="w-20 text-[12px]"
      />
    </label>
  );

  return (
    <div
      role="dialog"
      aria-label="Edit point"
      data-testid="point-editor"
      className="absolute z-50 p-2 rounded-md shadow-xl flex flex-col gap-1.5"
      style={{
        left: editor.x + 12,
        top: editor.y + 12,
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        color: "var(--color-vsc-text)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          apply();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        // The canvas's own keys (Delete, the arrows) stay in the fields.
        e.stopPropagation();
      }}
    >
      <div className="text-[11px] font-medium">
        {canvasObjectLabel(st, editor.object)}, {canvasPointLabel(editor.point)}
      </div>
      {axes === "radius" ? field("R", x, setX, true) : field("x", x, setX, true)}
      {axes === "xy" && field("y", y, setY)}
      {locked ? (
        <div className="text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>
          Locked · right-click to unlock
        </div>
      ) : (
        <div className="flex gap-1.5 justify-end">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={apply}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
