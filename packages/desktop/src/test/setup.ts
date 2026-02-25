import "@testing-library/jest-dom/vitest";

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
