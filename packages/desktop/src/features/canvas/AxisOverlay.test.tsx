import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { AxisOverlay } from "./AxisOverlay";
import { useAppStore } from "../../store/app-store";
import { createRecordingContext, type RecordingContext } from "../../test/recording-context";
import { RULER_SIZE_PX } from "./constants";

const W = 800;
const H = 600;

let rec: RecordingContext;

function sized<T extends HTMLElement>(el: T): T {
  Object.defineProperty(el, "clientWidth", { value: W, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: H, configurable: true });
  return el;
}

function renderOverlay() {
  const containerRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
  const canvasRef = createRef<HTMLCanvasElement>() as { current: HTMLCanvasElement | null };
  containerRef.current = sized(document.createElement("div"));
  canvasRef.current = sized(document.createElement("canvas"));
  const view = render(<AxisOverlay containerRef={containerRef} canvasRef={canvasRef} />);
  act(() => {
    vi.advanceTimersByTime(20);
  });
  return view;
}

/** World value of a screen x with the store viewport. */
const worldX = (px: number) => {
  const { editViewScale: s, editViewOffset: o } = useAppStore.getState();
  return (px - W / 2) / s - o[0];
};
const worldY = (py: number) => {
  const { editViewScale: s, editViewOffset: o } = useAppStore.getState();
  return -(py - H / 2) / s - o[1];
};

beforeEach(() => {
  vi.useFakeTimers();
  rec = createRecordingContext(W, H);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => rec.ctx as never);
  useAppStore.getState().newProject();
  useAppStore.setState({ mode: "edit", result: null, editViewScale: 20, editViewOffset: [-15, -5] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("AxisOverlay", () => {
  it("labels the bottom ruler with world x at each tick", () => {
    renderOverlay();
    const xLabels = rec.texts.filter((t) => t.state.textBaseline === "top");
    expect(xLabels.length).toBeGreaterThan(5);
    for (const t of xLabels) {
      expect(worldX(t.x)).toBeCloseTo(Number(t.text), 6);
      expect(t.y).toBe(H - RULER_SIZE_PX + 6 + 2);
      expect(t.x).toBeGreaterThanOrEqual(RULER_SIZE_PX);
    }
    // Round step: consecutive labels differ by a 1-2-5 value.
    const step = Number(xLabels[1].text) - Number(xLabels[0].text);
    expect([1, 2, 5, 10]).toContain(step);
  });

  it("labels the left ruler with world y at each tick, above the bottom ruler", () => {
    renderOverlay();
    const yLabels = rec.texts.filter((t) => t.state.textAlign === "right");
    expect(yLabels.length).toBeGreaterThan(3);
    for (const t of yLabels) {
      expect(worldY(t.y)).toBeCloseTo(Number(t.text), 6);
      expect(t.y).toBeLessThanOrEqual(H - RULER_SIZE_PX);
    }
    expect(rec.depth()).toBe(0);
  });

  it("never ticks finer than 1 m, and coarsens when zoomed out", () => {
    useAppStore.setState({ editViewScale: 400, editViewOffset: [-1.05, 0] });
    renderOverlay();
    const fine = rec.texts.filter((t) => t.state.textBaseline === "top").map((t) => Number(t.text));
    expect(fine.length).toBeGreaterThan(0);
    expect(fine.every(Number.isInteger)).toBe(true);
    rec.reset();
    cleanup();
    useAppStore.setState({ editViewScale: 0.5, editViewOffset: [0, 0] });
    renderOverlay();
    const coarse = rec.texts.filter((t) => t.state.textBaseline === "top").map((t) => Number(t.text));
    expect(coarse.length).toBeGreaterThan(2);
    expect(coarse[1] - coarse[0]).toBeGreaterThanOrEqual(100);
  });

  it("leaves out ruler labels the edges or the corner would cut", () => {
    // Ticks every 2 m (50 px). The -6 tick two pixels right of the ruler, the
    // 140 tick three pixels below the top, then the 110 tick at the right edge.
    const scale = 25;
    const at = (x: number, px: number) => (px - W / 2) / scale - x;
    const atY = (y: number, py: number) => (H / 2 - py) / scale - y;
    // 6 px per character in the recording context.
    const check = () => {
      const xLabels = rec.texts.filter((t) => t.state.textBaseline === "top");
      const yLabels = rec.texts.filter((t) => t.state.textAlign === "right");
      expect(xLabels.length).toBeGreaterThan(3);
      expect(yLabels.length).toBeGreaterThan(3);
      for (const t of xLabels) {
        expect(t.x - (t.text.length * 6) / 2).toBeGreaterThanOrEqual(RULER_SIZE_PX);
        expect(t.x + (t.text.length * 6) / 2).toBeLessThanOrEqual(W);
      }
      for (const t of yLabels) expect(t.y).toBeGreaterThanOrEqual(6);
      return { x: xLabels.map((t) => t.text), y: yLabels.map((t) => t.text) };
    };
    useAppStore.setState({ editViewScale: scale, editViewOffset: [at(-6, RULER_SIZE_PX + 2), atY(140, 3)] });
    renderOverlay();
    const first = check();
    expect(first.x).not.toContain("-6");
    expect(first.x).toContain("-4");
    expect(first.y).not.toContain("140");
    expect(first.y).toContain("138");
    rec.reset();
    cleanup();
    useAppStore.setState({ editViewScale: scale, editViewOffset: [at(110, W - 3), atY(140, 3)] });
    renderOverlay();
    const second = check();
    expect(second.x).not.toContain("110");
    expect(second.x).toContain("108");
  });

  it("redraws when the viewport changes", () => {
    renderOverlay();
    const before = rec.findText("10")!.x;
    rec.reset();
    act(() => {
      useAppStore.setState({ editViewOffset: [-14, -5] });
      vi.advanceTimersByTime(20);
    });
    // Panned 1 m right: the "10" tick moves 20 px right.
    expect(rec.findText("10")!.x).toBeCloseTo(before + 20, 6);
  });

  it("is hidden in the result view with a result", () => {
    useAppStore.setState({ mode: "result", result: { allSurfaces: [] } as never });
    const { container } = renderOverlay();
    expect(container.querySelector("canvas")).toBeNull();
    expect(rec.texts).toHaveLength(0);
  });
});
