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
