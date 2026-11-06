/**
 * Window sizes limited to the screen (#48). Dialog and tool windows open at
 * fixed sizes (760 px high, the drawing window 860 px); at 150 % display
 * scaling a 1920 × 1080 screen is 1280 × 720 DIP, less the taskbar, so they
 * would open taller than the screen with their button row hidden. Each
 * window is therefore capped to the work area of the display it opens on
 * (the screen less the taskbar), keeping a small margin, and centered in it.
 * Large screens keep the sizes as they are.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** The size a window asks for (DIPs, the outer size, as BrowserWindow takes it). */
export interface WindowSizeRequest extends Size {
  minWidth?: number;
  minHeight?: number;
}

export interface PlacedWindow extends Rect {
  minWidth?: number;
  minHeight?: number;
}

/** DIPs kept free around a capped window (half on each side). */
export const WORK_AREA_MARGIN = 16;
/** The smallest cap, so that a window on a tiny screen still has something to show. */
const MIN_CAP = 200;

/**
 * The window's size capped to the work area less `margin`, its minimum size
 * no larger than that, and centered in the work area.
 */
export function fitWindowToWorkArea(request: WindowSizeRequest, workArea: Rect, margin = WORK_AREA_MARGIN): PlacedWindow {
  const maxWidth = Math.max(MIN_CAP, Math.floor(workArea.width - margin));
  const maxHeight = Math.max(MIN_CAP, Math.floor(workArea.height - margin));
  const width = Math.min(request.width, maxWidth);
  const height = Math.min(request.height, maxHeight);
  const placed: PlacedWindow = {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
  if (request.minWidth !== undefined) placed.minWidth = Math.min(request.minWidth, width);
  if (request.minHeight !== undefined) placed.minHeight = Math.min(request.minHeight, height);
  return placed;
}

/**
 * The tallest content a window with a frame of `frame` DIPs may be fitted to
 * on a work area (the same margin as fitWindowToWorkArea).
 */
export function maxContentHeight(workArea: Size, frame: number, margin = WORK_AREA_MARGIN): number {
  return Math.max(MIN_CAP, Math.floor(workArea.height - margin)) - Math.max(0, frame);
}

/**
 * The work area less a simulated taskbar of `taskbar` DIPs at the bottom (the
 * design review's 150 % pass: its virtual screen has none).
 */
export function withTaskbar(workArea: Rect, taskbar: number): Rect {
  if (!Number.isFinite(taskbar) || taskbar <= 0) return workArea;
  return { ...workArea, height: Math.max(0, workArea.height - taskbar) };
}
