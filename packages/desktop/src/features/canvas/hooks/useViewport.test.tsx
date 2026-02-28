import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../../store/app-store";
import { INITIAL_MODEL } from "../../../store/slices/modelsSlice";
import { useViewport } from "./useViewport";

function clone<T>(value: T): T {
  const sc = globalThis.structuredClone as ((v: T) => T) | undefined;
  return sc ? sc(value) : JSON.parse(JSON.stringify(value));
}

function resetViewportState() {
  const baseModel = clone(INITIAL_MODEL);
  useAppStore.setState({
    activeModelId: baseModel.id,
    models: [baseModel],
    mode: "edit",
    coordinates: clone(baseModel.coordinates),
    editViewOffset: [0, 0],
    editViewScale: 1,
    resultViewOffset: [0, 0],
    resultViewScale: 1,
    resultViewSettings: {
      ...useAppStore.getState().resultViewSettings,
      viewLock: undefined,
    },
  });
}

describe("useViewport", () => {
  beforeEach(() => {
    resetViewportState();
  });

  it("maps world↔canvas consistently in edit mode", () => {
    useAppStore.setState({
      mode: "edit",
      editViewOffset: [10, -5],
      editViewScale: 2,
      coordinates: [],
    });

    const canvasRef = { current: null };
    const { result } = renderHook(() => useViewport(canvasRef));

    const pCanvas = result.current.worldToCanvas(2, 3, 200, 100);
    expect(pCanvas[0]).toBeCloseTo(124, 8);
    expect(pCanvas[1]).toBeCloseTo(54, 8);

    const pWorld = result.current.canvasToWorld(
      pCanvas[0],
      pCanvas[1],
      200,
      100,
    );
    expect(pWorld[0]).toBeCloseTo(2, 8);
    expect(pWorld[1]).toBeCloseTo(3, 8);
  });

  it("updates active viewport state based on mode", () => {
    const canvasRef = { current: null };
    const { result } = renderHook(() => useViewport(canvasRef));

    act(() => {
      result.current.setActiveViewOffset([1, 2]);
      result.current.setActiveViewScale(3);
    });

    let state = useAppStore.getState();
    expect(state.editViewOffset).toEqual([1, 2]);
    expect(state.editViewScale).toBe(3);
    expect(state.resultViewOffset).toEqual([0, 0]);

    act(() => {
      useAppStore.setState({ mode: "result" });
    });

    act(() => {
      result.current.setActiveViewOffset([7, 8]);
      result.current.setActiveViewScale(4);
    });

    state = useAppStore.getState();
    expect(state.resultViewOffset).toEqual([7, 8]);
    expect(state.resultViewScale).toBe(4);
    expect(state.editViewOffset).toEqual([1, 2]);
  });

  it("derives world position from pointer event and canvas rect", () => {
    useAppStore.setState({
      mode: "edit",
      coordinates: [],
      editViewOffset: [1, 2],
      editViewScale: 2,
    });

    const fakeCanvas = {
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        width: 200,
        height: 100,
      }),
    } as HTMLCanvasElement;

    const canvasRef = { current: fakeCanvas };
    const { result } = renderHook(() => useViewport(canvasRef));

    const [wx, wy] = result.current.getEventWorldPos({
      clientX: 110,
      clientY: 60,
    });

    expect(wx).toBeCloseTo(-1, 8);
    expect(wy).toBeCloseTo(3, 8);
  });
});
