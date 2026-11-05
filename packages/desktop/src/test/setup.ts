import "@testing-library/jest-dom/vitest";
import { setAnalysisThreads } from "../store/analysis-workers";

// (the engine is started by vitest.engine-setup.ts, which runs first)

// One thread per analysis: the store tests count the analysis workers a
// run starts (analysis-workers.test.ts covers the evaluators).
setAnalysisThreads(1);

// ── jsdom polyfills for canvas & ResizeObserver ───────────────

// Mock ResizeObserver (not available in jsdom)
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof globalThis.ResizeObserver;

// Mock HTMLCanvasElement.getContext (not available without `canvas` npm package)
HTMLCanvasElement.prototype.getContext = (() => {
  return {
    canvas: { width: 800, height: 600 },
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    setTransform: () => {},
    transform: () => {},
    rect: () => {},
    clip: () => {},
    drawImage: () => {},
    setLineDash: () => {},
    measureText: () => ({ width: 0 }),
    fillText: () => {},
    strokeText: () => {},
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;
