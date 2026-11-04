/**
 * The project file's thumbnail.png: the active model's result sheet as the
 * result view shows it, about 320 px wide, when it is cheap to draw. The
 * export's drawing (paper-png.ts) is used at a fraction of its scale.
 * Nothing without a result on screen (the edit canvas has no paper), and
 * nothing once a drawing took longer than THUMBNAIL_BUDGET_MS: a save must
 * not wait for a large result's slices and mesh to be drawn again.
 */
import { paperPngDataUrl, PNG_PAPER_LAYOUT_WIDTH_PX } from "../export/paper-png";

/** The thumbnail's width (px), about. */
export const THUMBNAIL_WIDTH_PX = 320;
/** Drawing the thumbnail may take this long; past it, no more thumbnails this session. */
export const THUMBNAIL_BUDGET_MS = 100;

let tooSlow = false;

/** The thumbnail as PNG bytes, or null when there is none to draw (or it is too slow). */
export function projectThumbnail(): Uint8Array | null {
  if (tooSlow || typeof document === "undefined") return null;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const start = now();
  let dataUrl: string | null;
  try {
    dataUrl = paperPngDataUrl({ scale: THUMBNAIL_WIDTH_PX / PNG_PAPER_LAYOUT_WIDTH_PX });
  } catch {
    return null;
  }
  const took = now() - start;
  if (took > THUMBNAIL_BUDGET_MS) {
    tooSlow = true;
    return null;
  }
  return dataUrl ? pngBytes(dataUrl) : null;
}

/** For tests: draw thumbnails again after a slow one. */
export function resetThumbnailBudget(): void {
  tooSlow = false;
}

/** The bytes of a PNG data URL, or null when it is not one. */
function pngBytes(dataUrl: string): Uint8Array | null {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return null;
  try {
    const binary = atob(dataUrl.slice(prefix.length));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
