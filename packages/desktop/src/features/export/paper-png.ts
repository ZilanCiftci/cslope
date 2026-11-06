import { useAppStore } from "../../store/app-store";
import { computePaperFrame, getPaperDimensions } from "../view/paper";
import { drawCanvas, type DrawCanvasParams } from "../canvas/draw";
import { PAPER_FRAME_MARGIN_PX } from "../../constants";

/**
 * Paper frame width the export is laid out at (px): the sizes the canvas
 * draws in pixels (ticks, labels, load arrows) relate to this width as they
 * do to the paper on a typical screen.
 */
export const PNG_PAPER_LAYOUT_WIDTH_PX = 800;
/** Pixels per layout pixel in the PNG (whatever the screen's pixel ratio). */
export const PNG_SCALE = 3;

type DrawSource = () => DrawCanvasParams | null;
let drawSource: DrawSource | null = null;

/**
 * The result canvas registers what it draws, so the export can draw the
 * same paper again at its own size. Returns the function that unregisters.
 */
export function setPaperDrawSource(source: DrawSource): () => void {
  drawSource = source;
  return () => {
    if (drawSource === source) drawSource = null;
  };
}

/** Light-theme paper colours for the export, white paper and no shadow. */
const EXPORT_CSS_OVERRIDES: Record<string, string> = {
  "--color-canvas-paper": "#ffffff",
  "--color-canvas-paper-shadow": "rgba(0,0,0,0)",
};

/** The dark theme's paper as the result view shows it, without the shadow. */
const DARK_EXPORT_CSS_OVERRIDES: Record<string, string> = {
  "--color-canvas-paper-shadow": "rgba(0,0,0,0)",
};

/**
 * Draws with the light theme and white paper, whatever the app's theme;
 * with `theme` "dark", with the dark theme and its paper (the website's
 * dark-theme images). Returns what `draw` returns and the paper's colour.
 */
function withExportTheme<T>(theme: "light" | "dark", draw: (paper: string) => T): T {
  const root = document.documentElement;
  const appTheme = root.dataset.theme;
  const overrides = theme === "dark" ? DARK_EXPORT_CSS_OVERRIDES : EXPORT_CSS_OVERRIDES;
  const previous = Object.keys(overrides).map((k) => [k, root.style.getPropertyValue(k)] as const);
  root.dataset.theme = theme;
  for (const [k, v] of Object.entries(overrides)) root.style.setProperty(k, v);
  try {
    const paper = getComputedStyle(root).getPropertyValue("--color-canvas-paper").trim() || EXPORT_CSS_OVERRIDES["--color-canvas-paper"];
    return draw(paper);
  } finally {
    for (const [k, v] of previous) {
      if (v) root.style.setProperty(k, v);
      else root.style.removeProperty(k);
    }
    if (appTheme === undefined) delete root.dataset.theme;
    else root.dataset.theme = appTheme;
  }
}

/**
 * The result plot as a PNG data URL: the paper as the result view shows
 * it, drawn again at PNG_PAPER_LAYOUT_WIDTH_PX × PNG_SCALE pixels wide
 * (2400 px; the height follows the paper size), on white, without the
 * paper's border and shadow. This is what "Export PNG" saves, and what the
 * website's result images are captured with. It is drawn again without
 * the selection or the hover highlight, so the view needs no redraw first.
 * Null without a result view or without a result (the canvas has no paper
 * then). `scale` replaces PNG_SCALE (the project file's thumbnail is drawn
 * at a fraction of it). `theme` "dark" draws the dark theme's paper instead
 * (used by the website's media capture only).
 */
export function paperPngDataUrl(options: { scale?: number; theme?: "light" | "dark" } = {}): string | null {
  const args = drawSource?.();
  if (!args?.result || args.w <= 0 || args.h <= 0) return null;
  const pngScale = options.scale ?? PNG_SCALE;

  const state = useAppStore.getState();
  const scale = state.resultViewScale;
  const [ox, oy] = state.resultViewOffset;
  if (!(scale > 0)) return null;

  const { paperFrame } = args.resultViewSettings;
  const screenFrame = computePaperFrame(
    args.w,
    args.h,
    paperFrame.paperSize,
    paperFrame.landscape,
    paperFrame.zoom ?? 1,
    paperFrame.offsetX ?? 0,
    paperFrame.offsetY ?? 0,
    args.paperBottomReserve ?? 0,
  );
  // The world point at the centre of the paper on screen.
  const cx = (screenFrame.x + screenFrame.w / 2 - args.w / 2) / scale - ox;
  const cy = -(screenFrame.y + screenFrame.h / 2 - args.h / 2) / scale - oy;

  // A canvas just around a paper of the layout width, at zoom 1.
  const { width: paperW, height: paperH } = getPaperDimensions(paperFrame.paperSize, paperFrame.landscape);
  const layoutW = PNG_PAPER_LAYOUT_WIDTH_PX + 2 * PAPER_FRAME_MARGIN_PX;
  const layoutH = (PNG_PAPER_LAYOUT_WIDTH_PX * paperH) / paperW + 2 * PAPER_FRAME_MARGIN_PX;
  const frame = computePaperFrame(layoutW, layoutH, paperFrame.paperSize, paperFrame.landscape);
  const s = scale * (frame.w / screenFrame.w);
  const worldToCanvas = (wx: number, wy: number, w: number, h: number): [number, number] => [
    w / 2 + (wx - cx) * s,
    h / 2 - (wy - cy) * s,
  ];
  const canvasToWorld = (px: number, py: number, w: number, h: number): [number, number] => [
    (px - w / 2) / s + cx,
    -(py - h / 2) / s + cy,
  ];
  const params: DrawCanvasParams = {
    ...args,
    w: layoutW,
    h: layoutH,
    // The export lays the sheet out without the screen's toolbar band.
    paperBottomReserve: 0,
    viewScale: s,
    worldToCanvas,
    canvasToWorld,
    resultViewSettings: {
      ...args.resultViewSettings,
      paperFrame: { ...paperFrame, zoom: 1, offsetX: 0, offsetY: 0 },
    },
    mouseWorld: null,
    hoverHit: null,
    selectedAnnotationIds: [],
    selectedResultObject: null,
  };

  const full = document.createElement("canvas");
  full.width = Math.ceil(layoutW * pngScale);
  full.height = Math.ceil(layoutH * pngScale);
  const fullCtx = full.getContext("2d");
  if (!fullCtx) return null;
  fullCtx.setTransform(pngScale, 0, 0, pngScale, 0, 0);
  const paper = withExportTheme(options.theme ?? "light", (paperColor) => {
    drawCanvas(fullCtx, params);
    return paperColor;
  });

  // The paper alone, its edge pixels inside it.
  const sx = Math.ceil(frame.x * pngScale);
  const sy = Math.ceil(frame.y * pngScale);
  const sw = Math.floor((frame.x + frame.w) * pngScale) - sx;
  const sh = Math.floor((frame.y + frame.h) * pngScale) - sy;
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL("image/png");
}
