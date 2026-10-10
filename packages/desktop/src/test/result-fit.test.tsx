import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";
import App from "../App";
import { useAppStore } from "../store/app-store";

const W = 1000;
const H = 700;
const frames = (n: number) =>
  act(() => new Promise<void>((r) => setTimeout(r, 20 * n)));

function fakeResult(): AnalysisResult {
  const [a, b] = useAppStore.getState().coordinates;
  const surface = {
    cx: (a[0] + b[0]) / 2,
    cy: Math.max(a[1], b[1]) + 5,
    radius: 8,
    fos: 1.2,
    entryPoint: a,
    exitPoint: b,
  };
  return {
    minFOS: 1.2,
    maxFOS: 1.2,
    criticalSurface: surface,
    allSurfaces: [surface],
    criticalSlices: [],
    method: "Bishop",
    elapsedMs: 1,
  };
}

describe("fit to screen in the result view", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        new Proxy(
          { canvas: { width: W, height: H } },
          {
            get: (t, k) =>
              k in t
                ? (t as Record<string | symbol, unknown>)[k]
                : k === "measureText"
                  ? () => ({ width: 0 })
                  : () => {},
            set: () => true,
          },
        ) as unknown as CanvasRenderingContext2D,
    );
    useAppStore.getState().newProject();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fits the model even when the paper was zoomed", async () => {
    act(() => {
      useAppStore.setState({ mode: "result", result: fakeResult(), runState: "done" });
    });
    render(<App />);
    await frames(3);

    const setZoom = (zoom: number) =>
      act(() => {
        const rvs = useAppStore.getState().resultViewSettings;
        useAppStore.setState({
          resultViewSettings: {
            ...rvs,
            paperFrame: { ...rvs.paperFrame, zoom, offsetX: 0, offsetY: 0 },
          },
        });
      });
    const fit = async () => {
      act(() => useAppStore.setState({ _pendingFitToScreen: true } as never));
      await frames(3);
      return useAppStore.getState().resultViewScale;
    };

    const baseline = await fit();
    setZoom(1.5);
    await frames(3);
    // The user also zooms the model, so the view is no longer fitted.
    act(() => {
      const s = useAppStore.getState();
      useAppStore.setState({ resultViewScale: s.resultViewScale * 0.4 });
    });
    await frames(3);
    const afterZoom = await fit();

    expect(useAppStore.getState().resultViewSettings.paperFrame.zoom).toBe(1);
    expect(afterZoom).toBeCloseTo(baseline, 6);
  });
});
