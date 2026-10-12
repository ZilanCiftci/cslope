import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store/app-store";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "../../../store/defaults";
import { computeInnerFrame, computePaperFrame } from "../../view/paper";
import { useViewport } from "./useViewport";

const W = 800;
const H = 600;
const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } as HTMLCanvasElement;
// A stable ref, as components pass (a new object per render would refit on every render).
const canvasRef = { current: canvas };

const MODEL_A: [number, number][] = [
  [0, 0],
  [0, 10],
  [20, 10],
  [20, 0],
];
const MODEL_B: [number, number][] = [
  [100, 50],
  [100, 60],
  [140, 60],
  [140, 50],
];

/** The auto-fit of a model: 5 % margin of the larger side on each side, centred. */
function expectedFit(coords: [number, number][]) {
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const m = Math.max(w, h) * 0.05;
  return {
    scale: Math.min(W / (w + 2 * m), H / (h + 2 * m)),
    offset: [-(Math.min(...xs) + Math.max(...xs)) / 2, -(Math.min(...ys) + Math.max(...ys)) / 2],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.getState().newProject();
  useAppStore.setState({
    mode: "edit",
    coordinates: MODEL_A,
    editViewScale: 0,
    editViewOffset: [0, 0],
    resultViewScale: 0,
    resultViewOffset: [0, 0],
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, viewLock: undefined },
  });
});

afterEach(() => vi.useRealTimers());

describe("useViewport fitting", () => {
  it("fits the model when there is no view yet", () => {
    renderHook(() => useViewport(canvasRef));
    const s = useAppStore.getState();
    const fit = expectedFit(MODEL_A);
    expect(s.editViewScale).toBeCloseTo(fit.scale, 9);
    expect(s.editViewOffset).toEqual(fit.offset);
  });

  it("keeps an existing view when the geometry changes", () => {
    useAppStore.setState({ editViewScale: 7, editViewOffset: [1, 2] });
    renderHook(() => useViewport(canvasRef));
    act(() => useAppStore.setState({ coordinates: MODEL_B }));
    expect(useAppStore.getState().editViewScale).toBe(7);
    expect(useAppStore.getState().editViewOffset).toEqual([1, 2]);
  });

  it("refits when another model becomes active", () => {
    useAppStore.setState({ editViewScale: 7, editViewOffset: [1, 2] });
    renderHook(() => useViewport(canvasRef));
    act(() => useAppStore.setState({ activeModelId: "other-model", coordinates: MODEL_B }));
    const fit = expectedFit(MODEL_B);
    expect(useAppStore.getState().editViewScale).toBeCloseTo(fit.scale, 9);
    expect(useAppStore.getState().editViewOffset).toEqual(fit.offset);
  });

  it("applies a locked result view to the plot frame, and follows lock edits", () => {
    const lock = { bottomLeft: [-2, -1] as [number, number], topRight: [30, 18] as [number, number] };
    useAppStore.setState({
      mode: "result",
      resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, viewLock: lock },
    });
    renderHook(() => useViewport(canvasRef));
    const inner = () => {
      const pf = useAppStore.getState().resultViewSettings.paperFrame;
      return computeInnerFrame(computePaperFrame(W, H, pf.paperSize, pf.landscape, pf.zoom ?? 1, pf.offsetX ?? 0, pf.offsetY ?? 0));
    };
    const worldAt = (cx: number, cy: number) => {
      const s = useAppStore.getState();
      return [(cx - W / 2) / s.resultViewScale - s.resultViewOffset[0], -(cy - H / 2) / s.resultViewScale - s.resultViewOffset[1]];
    };
    let f = inner();
    // Lock centred horizontally in the plot frame, its bottom on the frame bottom.
    expect(worldAt(f.x + f.w / 2, f.y + f.h)[0]).toBeCloseTo(14, 6);
    expect(worldAt(f.x, f.y + f.h)[1]).toBeCloseTo(-1, 6);

    act(() =>
      useAppStore.setState({
        resultViewSettings: {
          ...useAppStore.getState().resultViewSettings,
          viewLock: { bottomLeft: [10, 0], topRight: [20, 7] },
        },
      }),
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    f = inner();
    expect(worldAt(f.x + f.w / 2, f.y + f.h)[0]).toBeCloseTo(15, 6);
    expect(worldAt(f.x, f.y + f.h)[1]).toBeCloseTo(0, 6);
  });

  it("does nothing without a canvas size", () => {
    const empty = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) } as HTMLCanvasElement;
    const emptyRef = { current: empty };
    renderHook(() => useViewport(emptyRef));
    expect(useAppStore.getState().editViewScale).toBe(0);
  });
});
