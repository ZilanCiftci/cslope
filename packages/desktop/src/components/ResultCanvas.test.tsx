import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";
import { ResultCanvas } from "./ResultCanvas";
import { useAppStore } from "../store/app-store";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "../store/defaults";
import { createRecordingContext } from "../test/recording-context";
import { computePaperFrame } from "../features/canvas/helpers";
import { PLOT_MARGINS } from "../store/defaults";
import type { Annotation } from "../store/types";

const W = 1000;
const H = 700;

const ANNOS: Annotation[] = [
  { id: "a", type: "text", x: 0.2, y: 0.2, text: "A" },
  { id: "b", type: "text", x: 0.6, y: 0.6, text: "B" },
];

function fakeResult(): AnalysisResult {
  const surface = { cx: 12, cy: 15, radius: 9, fos: 1.2, entryPoint: [6, 10] as [number, number], exitPoint: [18, 7.5] as [number, number] };
  return {
    minFOS: 1.2,
    maxFOS: 1.2,
    criticalSurface: surface,
    allSurfaces: [surface],
    criticalSlices: [],
    method: "Bishop",
    elapsedMs: 1,
  } as AnalysisResult;
}

const paper = () => useAppStore.getState().resultViewSettings.paperFrame;
const toolbar = () => useAppStore.getState().canvasToolbar!;
const canvas = () => screen.getByTestId("slope-canvas");
const anno = (id: string) => useAppStore.getState().resultViewSettings.annotations.find((a) => a.id === id);

function renderCanvas() {
  render(<ResultCanvas />);
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: W,
    bottom: H,
    width: W,
    height: H,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => createRecordingContext(W, H).ctx as never,
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  useAppStore.getState().newProject();
  useAppStore.setState({
    mode: "result",
    result: fakeResult(),
    runState: "done",
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: ANNOS },
    selectedAnnotationIds: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ResultCanvas keyboard", () => {
  it("nudges selected annotations with the arrow keys (finer with Shift)", () => {
    renderCanvas();
    act(() => useAppStore.getState().setSelectedAnnotations(["a", "b"]));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowDown", shiftKey: true });
    expect(anno("a")!.x).toBeCloseTo(0.21, 9);
    expect(anno("a")!.y).toBeCloseTo(0.202, 9);
    expect(anno("b")!.x).toBeCloseTo(0.61, 9);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(anno("b")!.x).toBeCloseTo(0.6, 9);
    expect(anno("b")!.y).toBeCloseTo(0.592, 9);
  });

  it("deletes the selected annotations, but not while typing in a field", () => {
    renderCanvas();
    act(() => useAppStore.getState().setSelectedAnnotations(["b"]));
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(anno("b")).toBeDefined();
    input.remove();
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(anno("b")).toBeUndefined();
    expect(anno("a")).toBeDefined();
    expect(useAppStore.getState().selectedAnnotationIds).toEqual([]);
  });

  it("does nothing on arrow keys without a selection", () => {
    renderCanvas();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(anno("a")!.x).toBe(0.2);
  });
});

describe("ResultCanvas paper zoom and pan", () => {
  it("zooms the paper in steps and to a percentage, within 25–300 %", () => {
    renderCanvas();
    act(() => toolbar().onZoomIn());
    expect(paper().zoom).toBeCloseTo(1.1, 9);
    expect(toolbar().zoomPercent).toBe(110);
    act(() => toolbar().onZoomOut());
    expect(paper().zoom).toBeCloseTo(0.99, 9);
    act(() => toolbar().onSetZoomPercent(1000));
    expect(paper().zoom).toBe(3);
    act(() => toolbar().onSetZoomPercent(5));
    expect(paper().zoom).toBe(0.25);
  });

  it("zooms with Ctrl+wheel keeping the paper point under the cursor", () => {
    renderCanvas();
    const [mx, my] = [700, 200];
    const rel = () => {
      const p = paper();
      return [(mx - (W / 2 + (p.offsetX ?? 0))) / (p.zoom ?? 1), (my - (H / 2 + (p.offsetY ?? 0))) / (p.zoom ?? 1)];
    };
    const before = rel();
    act(() => {
      canvas().dispatchEvent(new WheelEvent("wheel", { clientX: mx, clientY: my, deltaY: -100, ctrlKey: true, cancelable: true }));
    });
    expect(paper().zoom).toBeCloseTo(1.2, 9);
    const after = rel();
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    // A plain wheel does not zoom the paper.
    act(() => {
      canvas().dispatchEvent(new WheelEvent("wheel", { clientX: mx, clientY: my, deltaY: 100, cancelable: true }));
    });
    expect(paper().zoom).toBeCloseTo(1.2, 9);
  });

  it("pans the paper with the middle button and in pan mode", () => {
    renderCanvas();
    fireEvent.pointerDown(canvas(), { button: 1, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas(), { clientX: 130, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(canvas(), { button: 1, clientX: 130, clientY: 80, pointerId: 1 });
    expect([paper().offsetX, paper().offsetY]).toEqual([30, -20]);

    act(() => toolbar().onTogglePan());
    expect(toolbar().panActive).toBe(true);
    fireEvent.pointerDown(canvas(), { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas(), { clientX: 90, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(canvas(), { pointerId: 1 });
    expect([paper().offsetX, paper().offsetY]).toEqual([20, -20]);
    // Pan mode and zoom box exclude each other.
    act(() => toolbar().onToggleZoomBox());
    expect(toolbar().zoomBoxActive).toBe(true);
    expect(toolbar().panActive).toBe(false);
  });

  it("zooms the paper to a dragged box centred on the canvas", () => {
    renderCanvas();
    act(() => toolbar().onToggleZoomBox());
    fireEvent.pointerDown(canvas(), { button: 0, clientX: 600, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(canvas(), { clientX: 850, clientY: 575, pointerId: 1 });
    fireEvent.pointerUp(canvas(), { button: 0, clientX: 850, clientY: 575, pointerId: 1 });
    // Box 250 × 175 in 1000 × 700: ×4, its centre (725, 487.5) moves to the middle.
    expect(paper().zoom).toBeCloseTo(3, 9); // clamped from 4
    expect(paper().offsetX).toBeCloseTo(-(725 - 500) * 3, 9);
    expect(paper().offsetY).toBeCloseTo(-(487.5 - 350) * 3, 9);
    expect(toolbar().zoomBoxActive).toBe(false);
  });

  it("keeps the same part of the model in the plot area when the paper is zoomed", () => {
    act(() =>
      useAppStore.setState((s) => ({
        resultViewSettings: { ...s.resultViewSettings, viewLock: undefined },
        resultViewScale: 15,
        resultViewOffset: [-12, -5],
      })),
    );
    renderCanvas();
    const plotEdges = () => {
      const s = useAppStore.getState();
      const pf = s.resultViewSettings.paperFrame;
      const frame = computePaperFrame(W, H, pf.paperSize, pf.landscape, pf.zoom ?? 1, pf.offsetX ?? 0, pf.offsetY ?? 0);
      const left = frame.x + frame.w * PLOT_MARGINS.L;
      const right = frame.x + frame.w * (1 - PLOT_MARGINS.R);
      const toX = (cx: number) => (cx - W / 2) / s.resultViewScale - s.resultViewOffset[0];
      return [toX(left), toX(right)];
    };
    const before = plotEdges();
    act(() => toolbar().onSetZoomPercent(200));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(useAppStore.getState().resultViewScale).toBeCloseTo(30, 6);
    const after = plotEdges();
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it("selects an annotation on click and drags it on the paper", () => {
    renderCanvas();
    const pf = computePaperFrame(W, H, "A4", true, 1, 0, 0);
    const [x, y] = [pf.x + 0.6 * pf.w + 3, pf.y + 0.6 * pf.h + 3];
    fireEvent.pointerDown(canvas(), { button: 0, clientX: x, clientY: y, pointerId: 1 });
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["b"]);
    fireEvent.pointerMove(canvas(), { clientX: x + pf.w * 0.1, clientY: y, pointerId: 1 });
    fireEvent.pointerUp(canvas(), { button: 0, clientX: x + pf.w * 0.1, clientY: y, pointerId: 1 });
    expect(anno("b")!.x).toBeCloseTo(0.7, 9);
    expect(anno("b")!.y).toBeCloseTo(0.6, 9);
    // Clicking empty paper selects the paper frame.
    fireEvent.pointerDown(canvas(), { button: 0, clientX: pf.x + 0.4 * pf.w, clientY: pf.y + 0.9 * pf.h, pointerId: 1 });
    expect(useAppStore.getState().selectedResultObject).toBe("paper-frame");
  });
});
