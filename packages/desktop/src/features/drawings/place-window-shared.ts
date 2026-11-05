/**
 * What the Place drawing window and its "New models from drawing…" view
 * share: the drawing files' bytes (a file added in the window is kept
 * here; the others are asked of the main window), a re-render when a
 * drawing is ready, and a DWG or DXF drawing's unit.
 */
import { useEffect, useState } from "react";
import { onDrawingsChanged } from "./drawing-cache";
import { INSUNITS, type VectorDrawing } from "./vectors";
import type { DrawingAssetPayload, DrawingCommand } from "./window-sync";

// ── Bytes from the main window ──────────────────────────────────────

const localBytes = new Map<string, { bytes: Uint8Array; mime: string }>();
const waiting = new Map<string, { resolve: (v: { bytes: Uint8Array; mime: string }) => void; reject: (e: Error) => void }[]>();

/** A file added in this window: its bytes kept here (the main window has them too). */
export function rememberLocalBytes(id: string, bytes: Uint8Array, mime: string): void {
  localBytes.set(id, { bytes, mime });
}

export function receiveAsset(payload: DrawingAssetPayload): void {
  const list = waiting.get(payload.id) ?? [];
  waiting.delete(payload.id);
  for (const w of list) {
    if ("error" in payload) w.reject(new Error(payload.error));
    else w.resolve({ bytes: payload.data, mime: payload.mime });
  }
}

/** The window's loader: a file added here is in memory; the others are asked of the main window. */
export function windowLoader(send: (c: DrawingCommand) => void) {
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

/** Re-render when a drawing opened or a raster became ready. */
export function useDrawingsTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => onDrawingsChanged(() => setTick((t) => t + 1)), []);
  return tick;
}

/** The $INSUNITS code of a drawing's unit, or null when the file does not say. */
export function fileUnitCode(drawing: VectorDrawing | null): number | null {
  if (!drawing?.metersPerUnit) return null;
  const hit = Object.entries(INSUNITS).find(([, u]) => u.meters === drawing.metersPerUnit);
  return hit ? Number(hit[0]) : null;
}

