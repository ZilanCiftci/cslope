/**
 * AxisOverlay — Fixed ruler-style axes on the left and bottom edges of the canvas.
 * Reads viewport state directly from the Zustand store at draw time to avoid
 * React-render-cycle lag (2-3 frames behind during panning).
 */

import { useRef, useEffect, useState, type RefObject } from "react";
import { useAppStore } from "../../store/app-store";
import { cssVar, GRID_STEP_MIN, RULER_SIZE_PX } from "../canvas/constants";
import { GRID_RAW_STEP_PX } from "../../constants";

const RULER_SIZE = RULER_SIZE_PX;
const TICK_LEN = 6;
const FONT = "10px 'Segoe UI', sans-serif";

/* ── Inline viewport math (same as useViewport.ts) ── */

function getViewportFromStore(): {
  viewOffset: [number, number];
  viewScale: number;
} {
  const s = useAppStore.getState();
  const offset = s.mode === "result" ? s.resultViewOffset : s.editViewOffset;
  const scale = s.mode === "result" ? s.resultViewScale : s.editViewScale;
  return { viewOffset: offset, viewScale: scale };
}

function w2c(
  wx: number,
  wy: number,
  w: number,
  h: number,
  offset: [number, number],
  scale: number,
): [number, number] {
  return [w / 2 + (wx + offset[0]) * scale, h / 2 - (wy + offset[1]) * scale];
}

function c2w(
  cx: number,
  cy: number,
  w: number,
  h: number,
  offset: [number, number],
  scale: number,
): [number, number] {
  return [(cx - w / 2) / scale - offset[0], -(cy - h / 2) / scale - offset[1]];
}

/* ── Component ── */

interface Props {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export function AxisOverlay({ containerRef, canvasRef }: Props) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mode = useAppStore((s) => s.mode);
  const result = useAppStore((s) => s.result);

  // Track container size so we can size the overlay canvas
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      setContainerSize({ w: container.clientWidth, h: container.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef]);

  // The core draw function — reads store state directly, zero lag
  useEffect(() => {
    const overlay = overlayRef.current;
    const container = containerRef.current;
    const main = canvasRef.current;
    if (!overlay || !container || !main) return;

    let rafId: number | null = null;

    const draw = () => {
      rafId = null;
      const storeState = useAppStore.getState();
      const curMode = storeState.mode;
      const curResult = storeState.result;

      // Skip in result mode with paper frame
      if (curMode === "result" && curResult) {
        const ctx = overlay.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, overlay.width, overlay.height);
        }
        return;
      }

      const { viewOffset, viewScale } = getViewportFromStore();

      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const fullW = main.clientWidth || main.getBoundingClientRect().width;
      const fullH = main.clientHeight || main.getBoundingClientRect().height;
      if (w <= 0 || h <= 0 || fullW <= 0 || fullH <= 0 || viewScale <= 0)
        return;

      overlay.width = Math.max(1, Math.floor(w * dpr));
      overlay.height = Math.max(1, Math.floor(h * dpr));

      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const BG = cssVar("--color-canvas-bg");
      const AXIS_COLOR = cssVar("--color-canvas-axis");
      const TEXT_COLOR = cssVar("--color-canvas-grid-text");

      // Compute grid step (same algorithm as draw.ts)
      const safeScale = Math.max(viewScale, 0.0001);
      const rawStep = GRID_RAW_STEP_PX / safeScale;
      const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const steps = [1, 2, 5, 10];
      const gridStep = Math.max(
        GRID_STEP_MIN,
        (steps.find((s) => s * mag >= rawStep) ?? 10) * mag,
      );

      const [tlx, tly] = c2w(0, 0, fullW, fullH, viewOffset, viewScale);
      const [brx, bry] = c2w(w, h, fullW, fullH, viewOffset, viewScale);
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
      ctx.moveTo(0, h - RULER_SIZE);
      ctx.lineTo(w, h - RULER_SIZE);
      ctx.stroke();

      ctx.font = FONT;
      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const startX = Math.floor(worldLeft / gridStep) * gridStep;
      for (let gx = startX; gx <= worldRight; gx += gridStep) {
        const [px] = w2c(gx, 0, fullW, fullH, viewOffset, viewScale);
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
      ctx.lineTo(RULER_SIZE, h);
      ctx.stroke();

      ctx.font = FONT;
      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      const startY = Math.floor(worldBottom / gridStep) * gridStep;
      for (let gy = startY; gy <= worldTop; gy += gridStep) {
        const [, py] = w2c(0, gy, fullW, fullH, viewOffset, viewScale);
        if (py < 0 || py > h - RULER_SIZE) continue;
        ctx.beginPath();
        ctx.moveTo(RULER_SIZE, py);
        ctx.lineTo(RULER_SIZE - TICK_LEN, py);
        ctx.strokeStyle = AXIS_COLOR;
        ctx.stroke();
        ctx.fillText(formatLabel(gy), RULER_SIZE - TICK_LEN - 2, py);
      }
      ctx.restore();

      // ── Corner box (where rulers meet) ──
      ctx.fillStyle = BG;
      ctx.fillRect(0, h - RULER_SIZE, RULER_SIZE, RULER_SIZE);
    };

    const scheduleRedraw = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(draw);
    };

    // Initial draw
    scheduleRedraw();

    // Subscribe to store — redraws synchronously on every viewport/mode/theme change
    const unsub = useAppStore.subscribe(scheduleRedraw);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      unsub();
    };
  }, [containerRef, canvasRef, containerSize]);

  // Hide overlay in result mode with paper frame
  if (mode === "result" && result) return null;

  return (
    <canvas
      ref={overlayRef}
      className="absolute top-0 left-0 pointer-events-none"
      style={{
        zIndex: 60,
        width: containerSize.w || undefined,
        height: containerSize.h || undefined,
      }}
    />
  );
}

function formatLabel(value: number): string {
  if (value === 0) return "0";
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}
