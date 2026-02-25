/**
 * AxisOverlay — Fixed ruler-style axes on the left and bottom edges of the canvas.
 * Stays pinned to the viewport regardless of scroll or zoom.
 */

import { useRef, useEffect, type RefObject } from "react";
import { useAppStore } from "../../store/app-store";
import { cssVar, GRID_STEP_MIN } from "../canvas/constants";
import { GRID_RAW_STEP_PX } from "../../constants";

const RULER_SIZE = 32; // px width/height of the ruler band
const TICK_LEN = 6;
const FONT = "10px 'Segoe UI', sans-serif";

interface Props {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewOffset: [number, number];
  viewScale: number;
  worldToCanvas: (
    wx: number,
    wy: number,
    w: number,
    h: number,
  ) => [number, number];
  canvasToWorld: (
    cx: number,
    cy: number,
    w: number,
    h: number,
  ) => [number, number];
}

export function AxisOverlay({
  containerRef,
  canvasRef,
  viewOffset,
  viewScale,
  worldToCanvas,
  canvasToWorld,
}: Props) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mode = useAppStore((s) => s.mode);
  const result = useAppStore((s) => s.result);

  useEffect(() => {
    const overlay = overlayRef.current;
    const container = containerRef.current;
    const main = canvasRef.current;
    if (!overlay || !container || !main) return;

    // Skip in result mode with paper frame
    if (mode === "result" && result) {
      const ctx = overlay.getContext("2d");
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const fullW = main.clientWidth || main.getBoundingClientRect().width;
    const fullH = main.clientHeight || main.getBoundingClientRect().height;
    if (w <= 0 || h <= 0 || fullW <= 0 || fullH <= 0) return;

    overlay.width = Math.max(1, Math.floor(w * dpr));
    overlay.height = Math.max(1, Math.floor(h * dpr));
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;

    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const BG = cssVar("--color-canvas-bg");
    const AXIS_COLOR = cssVar("--color-canvas-axis");
    const TEXT_COLOR = cssVar("--color-canvas-grid-text");

    // Compute grid step (same algorithm as draw.ts)
    const safeScale = Math.max(viewScale || 0, 0.0001);
    const rawStep = GRID_RAW_STEP_PX / safeScale;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const steps = [1, 2, 5, 10];
    const gridStep = Math.max(
      GRID_STEP_MIN,
      (steps.find((s) => s * mag >= rawStep) ?? 10) * mag,
    );

    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;

    const [tlx, tly] = canvasToWorld(scrollLeft, scrollTop, fullW, fullH);
    const [brx, bry] = canvasToWorld(
      scrollLeft + w,
      scrollTop + h,
      fullW,
      fullH,
    );
    const worldLeft = Math.min(tlx, brx);
    const worldRight = Math.max(tlx, brx);
    const worldBottom = Math.min(tly, bry);
    const worldTop = Math.max(tly, bry);

    // ── Bottom ruler (X axis) ──
    ctx.save();
    ctx.fillStyle = BG;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(RULER_SIZE, h - RULER_SIZE, w - RULER_SIZE, RULER_SIZE);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE, h - RULER_SIZE);
    ctx.lineTo(w, h - RULER_SIZE);
    ctx.stroke();

    ctx.font = FONT;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const startX = Math.floor(worldLeft / gridStep) * gridStep;
    for (let gx = startX; gx <= worldRight; gx += gridStep) {
      const [pxFull] = worldToCanvas(gx, 0, fullW, fullH);
      const px = pxFull - scrollLeft;
      if (px < RULER_SIZE || px > w) continue;
      ctx.beginPath();
      ctx.moveTo(px, h - RULER_SIZE);
      ctx.lineTo(px, h - RULER_SIZE + TICK_LEN);
      ctx.strokeStyle = AXIS_COLOR;
      ctx.stroke();
      ctx.fillText(formatLabel(gx), px, h - RULER_SIZE + TICK_LEN + 2);
    }
    ctx.restore();

    // ── Left ruler (Y axis) ──
    ctx.save();
    ctx.fillStyle = BG;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(0, 0, RULER_SIZE, h - RULER_SIZE);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE, 0);
    ctx.lineTo(RULER_SIZE, h - RULER_SIZE);
    ctx.stroke();

    ctx.font = FONT;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const startY = Math.floor(worldBottom / gridStep) * gridStep;
    for (let gy = startY; gy <= worldTop; gy += gridStep) {
      const [, pyFull] = worldToCanvas(0, gy, fullW, fullH);
      const py = pyFull - scrollTop;
      if (py < 0 || py > h - RULER_SIZE) continue;
      ctx.beginPath();
      ctx.moveTo(RULER_SIZE, py);
      ctx.lineTo(RULER_SIZE - TICK_LEN, py);
      ctx.strokeStyle = AXIS_COLOR;
      ctx.stroke();
      ctx.fillText(formatLabel(gy), RULER_SIZE - TICK_LEN - 2, py);
    }
    ctx.restore();

    ctx.fillStyle = BG;
    ctx.fillRect(0, h - RULER_SIZE, RULER_SIZE, RULER_SIZE);
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, h - RULER_SIZE, RULER_SIZE, RULER_SIZE);
  }, [
    containerRef,
    canvasRef,
    viewOffset,
    viewScale,
    worldToCanvas,
    canvasToWorld,
    mode,
    result,
  ]);

  // Hide overlay in result mode with paper frame
  if (mode === "result" && result) return null;

  return (
    <canvas
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 60 }}
    />
  );
}

function formatLabel(value: number): string {
  if (value === 0) return "0";
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}
