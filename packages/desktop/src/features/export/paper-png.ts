import { useAppStore } from "../../store/app-store";
import { computePaperFrame } from "../view/paper";

/**
 * The result plot as a PNG data URL: the drawing canvas cut to the paper
 * frame, on white. This is what "Export PNG" saves, and what the website's
 * result images are captured with. Null without a canvas.
 */
export function paperPngDataUrl(): string | null {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-testid='slope-canvas']");
  if (!canvas) return null;

  const dpr = window.devicePixelRatio || 1;
  const { paperFrame } = useAppStore.getState().resultViewSettings;
  const pf = computePaperFrame(
    canvas.width / dpr,
    canvas.height / dpr,
    paperFrame.paperSize,
    paperFrame.landscape,
    paperFrame.zoom ?? 1,
    paperFrame.offsetX ?? 0,
    paperFrame.offsetY ?? 0,
  );
  const sx = pf.x * dpr;
  const sy = pf.y * dpr;
  const sw = pf.w * dpr;
  const sh = pf.h * dpr;

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL("image/png");
}
