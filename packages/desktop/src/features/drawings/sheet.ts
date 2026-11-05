/**
 * "New models from drawing…": frames drawn on a drawing's pages, one per
 * section, each named and calibrated; a frame may reuse the x and y
 * scales of another frame (then one known value per axis is enough). And
 * the models they make: one per frame, the drawing placed with the frame
 * as its crop. Pure functions.
 */
import type { BackgroundImage } from "../../store/types";
import { axisScalesOf, buildPlacement, evaluateForm, type CalibrationForm, type FormResult } from "./calibration-form";
import { newPlacementId } from "./placement";
import type { Crop } from "./transform";
import type { VectorText } from "./vectors";

export interface SheetFrame {
  id: string;
  page: number;
  crop: Crop;
  name: string;
  form: CalibrationForm;
}

/** The value a frame's form names to reuse another frame's scale. */
export const frameKey = (id: string) => `frame:${id}`;

/** A text that only labels an axis (a number, a station, an elevation): not a section's name. */
const AXIS_LABEL = /^[+\-±]?\s*\d+([.,]\d+)?\s*(m|km|mm)?$|^\d+\s*[+/]\s*\d+([.,]\d+)?$/i;
/** A section's title: "Section A-A", "Profile 3", "Sektion 1/250", "A–A". */
const TITLE = /\b(section|profile|profil|sektion|sektionen|snitt|sec\.|cross[- ]section|tvärsektion)\b/i;
const CUT_NAME = /^[A-Z0-9]{1,3}\s*[-–—]\s*[A-Z0-9]{1,3}$/;

/**
 * A name for a frame from the texts in it (and just around it): a title
 * such as "Section 2" first, else a cut name like "A–A", else the largest
 * text that is not a number; empty when there is none.
 */
export function suggestFrameName(texts: readonly VectorText[], crop: Crop): string {
  const w = crop.x1 - crop.x0;
  const h = crop.y1 - crop.y0;
  const near = { x0: crop.x0 - 0.05 * w, x1: crop.x1 + 0.05 * w, y0: crop.y0 - 0.15 * h, y1: crop.y1 + 0.05 * h };
  let best: { text: string; score: number } | null = null;
  for (const t of texts) {
    if (t.u < near.x0 || t.u > near.x1 || t.v < near.y0 || t.v > near.y1) continue;
    const text = t.text.replace(/\s+/g, " ").trim();
    if (!text || text.length > 60 || AXIS_LABEL.test(text)) continue;
    let score = t.height;
    if (TITLE.test(text)) score += 1e6;
    else if (CUT_NAME.test(text)) score += 5e5;
    // (inside the frame before around it)
    if (t.u >= crop.x0 && t.u <= crop.x1 && t.v >= crop.y0 && t.v <= crop.y1) score *= 1.01;
    if (!best || score > best.score) best = { text, score };
  }
  return best?.text ?? "";
}

/**
 * A frame's calibration: its form, with the x and y scales of the frame
 * it reuses (that frame evaluated first; a loop is an error).
 */
export function evaluateFrame(frames: readonly SheetFrame[], frame: SheetFrame, unitName: string, seen: Set<string> = new Set()): FormResult {
  let reuse: { x: number; y: number } | null = null;
  const from = frame.form.mode === "axes" && frame.form.reuseFrom?.startsWith("frame:") ? frame.form.reuseFrom.slice(6) : null;
  if (from) {
    const other = frames.find((f) => f.id === from);
    if (other && !seen.has(frame.id)) {
      const r = evaluateFrame(frames, other, unitName, new Set([...seen, frame.id]));
      reuse = r.fit.ok ? axisScalesOf(r.fit.transform) : null;
    }
    if (!reuse) return { ...evaluateForm({ ...frame.form, reuseFrom: null }, null, unitName), fit: { ok: false, error: "The frame whose scale is reused is not calibrated yet." } };
  }
  const result = evaluateForm(frame.form, reuse, unitName);
  // (the calibration names the frame's model and placement once they exist)
  return result;
}

/** The frames a frame can reuse the scale of: the others that are calibrated with axes. */
export function reusableFrames(frames: readonly SheetFrame[], frame: SheetFrame, unitName: string): SheetFrame[] {
  return frames.filter((f) => {
    if (f.id === frame.id || f.form.mode !== "axes") return false;
    const r = evaluateFrame(frames, f, unitName, new Set([frame.id]));
    return r.fit.ok && !!axisScalesOf(r.fit.transform);
  });
}

/**
 * The models the frames make: per frame its name and the placement of the
 * drawing (cropped to the frame); or why not (a frame not calibrated).
 */
export function framesToModels(
  frames: readonly SheetFrame[],
  asset: { id: string; originalName: string; multiPage: boolean; vector: boolean },
  unitName: string,
): { ok: true; models: { name: string; placement: BackgroundImage }[] } | { ok: false; error: string } {
  if (frames.length === 0) return { ok: false, error: "Draw a frame around each section first." };
  const models: { name: string; placement: BackgroundImage }[] = [];
  const ids = new Map(frames.map((f) => [f.id, newPlacementId()]));
  for (const [i, f] of frames.entries()) {
    const r = evaluateFrame(frames, f, unitName);
    if (!r.fit.ok) return { ok: false, error: `Frame ${i + 1}${f.name ? ` (${f.name})` : ""}: ${r.fit.error}` };
    const calibration = { ...r.calibration };
    // A reused frame's scale: "placement:<id>" of the placement that frame
    // makes (the main window makes it "<model id>/<placement id>").
    const reused = calibration.axes?.reuseFrom?.startsWith("frame:") ? ids.get(calibration.axes.reuseFrom.slice(6)) : undefined;
    if (calibration.axes && reused) calibration.axes = { ...calibration.axes, reuseFrom: `placement:${reused}` };
    const name = f.name.trim();
    const placement = buildPlacement({
      id: ids.get(f.id)!,
      assetId: asset.id,
      name: name || `${asset.originalName || "Drawing"}${asset.multiPage ? `, page ${f.page}` : ""}`,
      page: asset.multiPage ? f.page : undefined,
      crop: f.crop,
      calibration,
      transform: r.fit.transform,
      opacity: asset.vector ? 0.8 : undefined,
    });
    models.push({ name, placement });
  }
  return { ok: true, models };
}
