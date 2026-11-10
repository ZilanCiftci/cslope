import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as RPointerEvent } from "react";
import { DRAG_THRESHOLD_PX, usePointerHandlers } from "./usePointerHandlers";
import type { CanvasCandidate } from "../object-hits";
import type { BackgroundImage, CanvasObjectRef, CanvasPointKey } from "../../../store/types";
import { useAppStore } from "../../../store/app-store";
import { DEFAULT_PIEZO_LINE, DEFAULT_RESULT_VIEW_SETTINGS } from "../../../store/defaults";
import { computePaperFrame } from "../helpers";
import { SCREEN_PAPER_BOTTOM_RESERVE_PX } from "../../../constants";
import { VIEW_SCALE_MAX } from "../constants";
import type { PointHit } from "../types";

type Deps = Parameters<typeof usePointerHandlers>[0];

const W = 800;
const H = 600;
const SCALE = 10;
const RECT = { left: 0, top: 0, width: W, height: H };

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];

function view() {
  const s = useAppStore.getState();
  return s.mode === "result"
    ? { scale: s.resultViewScale, offset: s.resultViewOffset }
    : { scale: s.editViewScale, offset: s.editViewOffset };
}

/** Screen position of a world point with the store's current viewport. */
function toScreen(x: number, y: number): [number, number] {
  const { scale, offset } = view();
  return [W / 2 + (x + offset[0]) * scale, H / 2 - (y + offset[1]) * scale];
}

function toWorld(cx: number, cy: number): [number, number] {
  const { scale, offset } = view();
  return [(cx - W / 2) / scale - offset[0], -(cy - H / 2) / scale - offset[1]];
}

function ev(clientX: number, clientY: number, extra: Partial<Record<string, unknown>> = {}) {
  return {
    clientX,
    clientY,
    button: 0,
    pointerId: 1,
    ctrlKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() },
    ...extra,
  } as unknown as RPointerEvent<HTMLCanvasElement>;
}

function setup(over: Partial<Deps> = {}) {
  const canvas = {
    getBoundingClientRect: () => RECT,
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
  const deps: Deps = {
    canvasRef: { current: canvas },
    getEventWorldPos: (e) => toWorld(e.clientX, e.clientY),
    viewOffset: view().offset,
    setActiveViewOffset: vi.fn((o: [number, number]) =>
      useAppStore.setState(useAppStore.getState().mode === "result" ? { resultViewOffset: o } : { editViewOffset: o }),
    ),
    setActiveViewScale: vi.fn((s: number) =>
      useAppStore.setState(useAppStore.getState().mode === "result" ? { resultViewScale: s } : { editViewScale: s }),
    ),
    onZoomCompleted: vi.fn(),
    findObjectsAt: vi.fn(() => []),
    findRegionAtPoint: vi.fn(() => ({ regionKey: "r1" })),
    findSnapTarget: vi.fn(() => null),
    snapValue: (v: number) => Math.round(v * 10) / 10,
    updateCustomSearchPlane: vi.fn((id, patch) => useAppStore.getState().updateCustomSearchPlane(id, patch)),
    updateCustomPlanePoint: vi.fn((id, i, pt) => useAppStore.getState().updateCustomPlanePoint(id, i, pt)),
    assigningMaterialId: null,
    panActive: false,
    setRegionMaterial: vi.fn(),
    setAssigningMaterial: vi.fn(),
    setSelectedRegionKey: vi.fn(),
    updateAnnotation: vi.fn(),
    setSelectedAnnotations: vi.fn(),
    toggleAnnotationSelection: vi.fn(),
    setSelectedResultObject: vi.fn(),
    selectedAnnotationIds: [],
    mode: "edit",
    setAnalysisLimits: vi.fn(),
    updateUdl: vi.fn(),
    updateLineLoad: vi.fn(),
    setCoordinate: vi.fn(),
    setPiezoCoordinate: vi.fn(),
    updateBoundaryPoint: vi.fn(),
    setContextMenu: vi.fn(),
    setMaterialPicker: vi.fn(),
    ...over,
  };
  const hook = renderHook(() => usePointerHandlers(deps));
  const h = () => hook.result.current;
  return {
    deps,
    h,
    down: (x: number, y: number, extra?: Partial<Record<string, unknown>>) => {
      const e = ev(x, y, extra);
      act(() => h().handlePointerDown(e));
      return e;
    },
    move: (x: number, y: number) => act(() => h().handlePointerMove(ev(x, y))),
    up: (x: number, y: number) => {
      const e = ev(x, y);
      act(() => h().handlePointerUp(e));
      return e;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.getState().newProject();
  useAppStore.setState({
    mode: "edit",
    coordinates: COORDS,
    coordinateExpressions: [],
    editViewScale: SCALE,
    editViewOffset: [-15, -5],
  });
  useAppStore.temporal.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Objects under the pointer, as the canvas's hit test reports them. */
const under = (...c: CanvasCandidate[]) => vi.fn(() => c.map((x) => ({ ...x })));
const EXT: CanvasObjectRef = { type: "exterior" };
const select = (object: CanvasObjectRef | null, point: CanvasPointKey | null = null) =>
  act(() => useAppStore.getState().selectCanvasObject(object, point));
const selection = () => useAppStore.getState().canvasSelection;

describe("select, then drag (edit view)", () => {
  it("selects an object by a click, without moving it", () => {
    const { deps, down, move, up } = setup({ findObjectsAt: under({ object: EXT, point: 2 }) });
    const [sx, sy] = toScreen(10, 10);
    const e = down(sx, sy);
    expect(deps.setContextMenu).toHaveBeenCalledWith(null);
    expect((e.target as unknown as { setPointerCapture: () => void }).setPointerCapture).toHaveBeenCalledWith(1);
    // Nothing is selected until the click ends.
    expect(selection()).toBeNull();
    move(sx + 2, sy);
    up(sx + 2, sy);
    expect(selection()).toEqual({ object: EXT, point: null });
    expect(deps.setCoordinate).not.toHaveBeenCalled();
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("does nothing to an object that is not selected when it is dragged", () => {
    const { deps, down, move, up } = setup({ findObjectsAt: under({ object: EXT, point: 2 }) });
    const [sx, sy] = toScreen(10, 10);
    down(sx, sy);
    move(sx + 30, sy + 20);
    up(sx + 30, sy + 20);
    expect(deps.setCoordinate).not.toHaveBeenCalled();
    // A drag is no click: nothing is selected either.
    expect(selection()).toBeNull();
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("pans in pan mode when a drag starts on an object that is not selected", () => {
    const { deps, down, move } = setup({ panActive: true, findObjectsAt: under({ object: EXT, point: 2 }) });
    down(400, 300);
    move(380, 330);
    expect(deps.setActiveViewOffset).toHaveBeenLastCalledWith([-15 - 2, -5 - 3]);
    expect(deps.setCoordinate).not.toHaveBeenCalled();
  });

  it("keeps a dead zone of 4 px: a press that moves less is a click", () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
    select(EXT);
    const { deps, down, move, up } = setup({ findObjectsAt: under({ object: EXT, point: 2 }) });
    const [sx, sy] = toScreen(10, 10);
    down(sx, sy);
    move(sx + 3, sy + 2); // 3.6 px
    expect(deps.setCoordinate).not.toHaveBeenCalled();
    up(sx + 3, sy + 2);
    // The click picks the point under the pointer.
    expect(selection()).toEqual({ object: EXT, point: 2 });
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("drags a handle of the selected object by the pointer travel, snapped, and selects that point", () => {
    select(EXT);
    const { deps, h, down, move } = setup({ findObjectsAt: under({ object: EXT, point: 2 }) });
    const [sx, sy] = toScreen(10, 10);
    down(sx, sy);
    move(sx + 33, sy - 12);
    // 33 px → 3.3 m right, 12 px up → 1.2 m up.
    expect(deps.setCoordinate).toHaveBeenLastCalledWith(2, [13.3, 11.2]);
    // The status bar shows the snapped position.
    expect(h().mouseWorld).toEqual([13.3, 11.2]);
    expect(selection()).toEqual({ object: EXT, point: 2 });
    // The exterior's points carry their own labels: no tip beside the pointer.
    expect(h().dragTip).toBeNull();
  });

  it("snaps to a neighbouring vertex when one is in range", () => {
    select(EXT);
    const { deps, down, move } = setup({
      findObjectsAt: under({ object: EXT, point: 2 }),
      findSnapTarget: vi.fn(() => [20, 5] as [number, number]),
    });
    const [sx, sy] = toScreen(10, 10);
    down(sx, sy);
    move(sx + 95, sy + 48);
    expect(deps.findSnapTarget).toHaveBeenCalledWith(19.5, 5.2, { kind: "external", index: 2 });
    expect(deps.setCoordinate).toHaveBeenLastCalledWith(2, [20, 5]);
  });

  it("keeps an axis that a parameter expression drives", () => {
    useAppStore.setState({ coordinateExpressions: [{}, {}, { x: "L" }] });
    select(EXT);
    const { deps, down, move } = setup({ findObjectsAt: under({ object: EXT, point: 2 }) });
    const [sx, sy] = toScreen(10, 10);
    down(sx, sy);
    move(sx + 30, sy - 30);
    expect(deps.setCoordinate).toHaveBeenLastCalledWith(2, [10, 13]);
  });

  it("records one undo step per drag", () => {
    select(EXT);
    const { down, move, up } = setup({
      findObjectsAt: under({ object: EXT, point: 2 }),
      setCoordinate: (i, c) => useAppStore.getState().setCoordinate(i, c),
    });
    const [sx, sy] = toScreen(10, 10);
    down(sx, sy);
    move(sx + 10, sy);
    move(sx + 20, sy);
    move(sx + 30, sy);
    up(sx + 30, sy);
    const past = useAppStore.temporal.getState().pastStates;
    expect(past).toHaveLength(1);
    expect(past[0].coordinates![2]).toEqual([10, 10]);
    expect(useAppStore.getState().coordinates[2]).toEqual([13, 10]);
  });

  it("records dragging a drawing as one undo step, which undoes the drag only", () => {
    const drawing: BackgroundImage = {
      id: "d1",
      assetId: "a1",
      calibration: { mode: "points", points: [] },
      transform: { a: 0.1, b: 0, c: 0, d: -0.1, e: 0, f: 10 },
      opacity: 1,
      visible: true,
      order: 0,
    };
    act(() => useAppStore.getState().addBackground(drawing));
    // (a drawing placed is locked; unlocked to be moved)
    act(() => useAppStore.setState({ locks: {} }));
    act(() => useAppStore.getState().setCoordinate(0, [0, 1]));
    const before = useAppStore.temporal.getState().pastStates.length;
    const D: CanvasObjectRef = { type: "background", id: "d1" };
    select(D);
    const { down, move, up } = setup({ findObjectsAt: under({ object: D, point: null }) });
    const [sx, sy] = toScreen(5, 5);
    down(sx, sy);
    move(sx + 10, sy);
    move(sx + 20, sy);
    up(sx + 20, sy);
    const moved = useAppStore.getState().backgrounds[0].transform.e;
    expect(moved).not.toBe(0);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(before + 1);
    act(() => useAppStore.temporal.getState().undo());
    expect(useAppStore.getState().backgrounds[0].transform.e).toBe(0);
    expect(useAppStore.getState().coordinates[0]).toEqual([0, 1]);
    act(() => useAppStore.temporal.getState().redo());
    expect(useAppStore.getState().backgrounds[0].transform.e).toBe(moved);
  });

  it("does not drag the exterior or a material boundary by its line", () => {
    select(EXT);
    const { deps, down, move } = setup({ findObjectsAt: under({ object: EXT, point: null }) });
    const [sx, sy] = toScreen(5, 10);
    down(sx, sy);
    move(sx + 30, sy);
    expect(deps.setCoordinate).not.toHaveBeenCalled();
  });

  it("drags no handle of a locked object, and still selects it and its points", () => {
    act(() => useAppStore.getState().setObjectLocked(EXT, true));
    select(EXT);
    const { deps, h, down, move, up } = setup({ findObjectsAt: under({ object: EXT, point: 2 }) });
    const [sx, sy] = toScreen(10, 10);
    move(sx, sy);
    expect(h().hoverObject).toMatchObject({ object: EXT, point: 2, locked: true });
    expect(h().cursor).toBe("not-allowed");
    // No hover on a handle that cannot move.
    expect(h().hoverHit).toBeNull();
    down(sx, sy);
    move(sx + 30, sy);
    up(sx + 30, sy);
    expect(deps.setCoordinate).not.toHaveBeenCalled();
    down(sx, sy);
    up(sx, sy);
    expect(selection()).toEqual({ object: EXT, point: 2 });
  });

  it("drags search-limit handles horizontally", () => {
    useAppStore.setState({ analysisLimits: { enabled: true, entryLeftX: 2, entryRightX: 8, exitLeftX: 21, exitRightX: 28 } });
    select({ type: "searchLimits" });
    const { deps, down, move } = setup({ findObjectsAt: under({ object: { type: "searchLimits" }, point: "exitLeftX" }) });
    const [sx, sy] = toScreen(21, 4.5);
    down(sx, sy);
    move(sx - 15, sy + 40);
    expect(deps.setAnalysisLimits).toHaveBeenLastCalledWith({ exitLeftX: 19.5 });
  });

  it("drags UDL ends and line loads unless an expression fixes them", () => {
    useAppStore.setState({
      udls: [
        { id: "u", magnitude: 10, x1: 2, x2: 8 },
        { id: "fixed", magnitude: 10, x1: 2, x2: 8, expressions: { x2: "B" } },
      ],
      lineLoads: [{ id: "l", magnitude: 5, x: 25 }],
    });

    select({ type: "udl", id: "u" });
    const u = setup({ findObjectsAt: under({ object: { type: "udl", id: "u" }, point: "x2" }) });
    const [ux, uy] = toScreen(8, 12);
    u.down(ux, uy);
    u.move(ux + 20, uy);
    expect(u.deps.updateUdl).toHaveBeenLastCalledWith("u", { x2: 10 });
    expect(u.h().dragTip?.text).toBe("x 10.00 m");
    u.up(ux + 20, uy);

    select({ type: "udl", id: "fixed" });
    const fixed = setup({ findObjectsAt: under({ object: { type: "udl", id: "fixed" }, point: "x2" }) });
    fixed.down(ux, uy);
    fixed.move(ux + 20, uy);
    expect(fixed.deps.updateUdl).not.toHaveBeenCalled();
    fixed.up(ux + 20, uy);

    select({ type: "lineLoad", id: "l" });
    const l = setup({ findObjectsAt: under({ object: { type: "lineLoad", id: "l" }, point: "x" }) });
    const [lx, ly] = toScreen(25, 7);
    l.down(lx, ly);
    l.move(lx - 50, ly);
    expect(l.deps.updateLineLoad).toHaveBeenLastCalledWith("l", { x: 20 });
  });

  it("moves a selected load whole by its strip, in whole grid steps", () => {
    useAppStore.setState({ udls: [{ id: "u", magnitude: 10, x1: 2, x2: 8 }] });
    select({ type: "udl", id: "u" });
    const { deps, h, down, move } = setup({
      snapValue: (v: number) => Math.round(v),
      findObjectsAt: under({ object: { type: "udl", id: "u" }, point: null }),
    });
    const [sx, sy] = toScreen(5, 11);
    down(sx, sy);
    move(sx + 33, sy - 8);
    expect(deps.updateUdl).toHaveBeenLastCalledWith("u", { x1: 5, x2: 11 });
    expect(h().dragTip?.text).toBe("x 5.00 to 11.00 m");
  });

  it("drags interior boundary points of the selected boundary", () => {
    const boundary = { id: "b", coordinates: [[0, 4], [30, 3]] as [number, number][] };
    useAppStore.setState({ materialBoundaries: [boundary] });
    select({ type: "boundary", id: "b" });
    const { deps, down, move } = setup({ findObjectsAt: under({ object: { type: "boundary", id: "b" }, point: 1 }) });
    const [sx, sy] = toScreen(30, 3);
    down(sx, sy);
    move(sx, sy - 20);
    expect(deps.updateBoundaryPoint).toHaveBeenLastCalledWith("b", 1, [30, 5]);
    expect(selection()).toEqual({ object: { type: "boundary", id: "b" }, point: 1 });
  });

  it("drags points of the selected water line (made the active one)", () => {
    const piezometricLine = {
      ...DEFAULT_PIEZO_LINE,
      lines: [
        { id: "w", name: "w", color: "#000", coordinates: [[0, 7], [30, 6]] as [number, number][] },
        { id: "v", name: "v", color: "#000", coordinates: [[0, 2], [30, 2]] as [number, number][] },
      ],
      activeLineId: "v",
    };
    useAppStore.setState({ piezometricLine });
    select({ type: "waterLine", id: "w" });
    expect(useAppStore.getState().piezometricLine.activeLineId).toBe("w");
    const { deps, down, move } = setup({ findObjectsAt: under({ object: { type: "waterLine", id: "w" }, point: 0 }) });
    const [sx, sy] = toScreen(0, 7);
    down(sx, sy);
    move(sx + 10, sy + 10);
    expect(deps.setPiezoCoordinate).toHaveBeenLastCalledWith(0, [1, 6]);
  });

  it("drags the ends of a reinforcement element", () => {
    act(() => useAppStore.getState().addReinforcement("nail"));
    const r = useAppStore.getState().reinforcements[0];
    select({ type: "reinforcement", id: r.id });
    const { down, move, h } = setup({ findObjectsAt: under({ object: { type: "reinforcement", id: r.id }, point: "end2" }) });
    const [sx, sy] = toScreen(r.x2, r.y2);
    down(sx, sy);
    move(sx + 20, sy - 10);
    expect(useAppStore.getState().reinforcements[0]).toMatchObject({ x1: r.x1, y1: r.y1, x2: Math.round((r.x2 + 2) * 10) / 10, y2: Math.round((r.y2 + 1) * 10) / 10 });
    expect(h().dragTip).not.toBeNull();
  });

  it("pans the view when a drag nears the canvas edge", () => {
    select(EXT);
    const { down, move } = setup({ findObjectsAt: under({ object: EXT, point: 2 }) });
    const [sx, sy] = toScreen(10, 10);
    down(sx, sy);
    move(sx + 10, sy); // past the threshold
    const before = view().offset;
    move(4, sy); // 20 px inside the 24 px margin on the left
    const after = view().offset;
    expect(after[0]).toBeCloseTo(before[0] + (20 * 0.35) / SCALE, 9);
    expect(after[1]).toBe(before[1]);
  });

  it("commits the drag on pointer cancel", () => {
    select(EXT);
    const { h, down, move } = setup({
      findObjectsAt: under({ object: EXT, point: 2 }),
      setCoordinate: (i, c) => useAppStore.getState().setCoordinate(i, c),
    });
    const [sx, sy] = toScreen(10, 10);
    down(sx, sy);
    move(sx + 20, sy);
    const e = ev(sx + 20, sy);
    act(() => h().handlePointerCancel(e));
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
    expect((e.target as unknown as { releasePointerCapture: () => void }).releasePointerCapture).toHaveBeenCalledWith(1);
  });
});

describe("clicks (edit view)", () => {
  const click = (s: ReturnType<typeof setup>, x: number, y: number) => {
    s.down(x, y);
    s.up(x, y);
  };
  const WATER: CanvasObjectRef = { type: "waterLine", id: "w" };
  const BOUNDARY: CanvasObjectRef = { type: "boundary", id: "b" };

  beforeEach(() => {
    useAppStore.setState({
      materialBoundaries: [{ id: "b", coordinates: [[0, 10], [30, 3]] }],
      piezometricLine: { ...DEFAULT_PIEZO_LINE, lines: [{ id: "w", name: "w", color: "#000", coordinates: [[0, 10], [30, 6]] }], activeLineId: "w" },
    });
  });

  it("selects a point of the selected object by a click on it", () => {
    select(EXT);
    const s = setup({ findObjectsAt: under({ object: EXT, point: 3 }) });
    click(s, ...toScreen(20, 5));
    expect(selection()).toEqual({ object: EXT, point: 3 });
    // A click on the object's line drops the point, keeps the object.
    const line = setup({ findObjectsAt: under({ object: EXT, point: null }) });
    click(line, ...toScreen(25, 5));
    expect(selection()).toEqual({ object: EXT, point: null });
  });

  it("cycles through the objects under the pointer on repeated clicks at one spot", () => {
    const s = setup({
      findObjectsAt: under({ object: WATER, point: 0 }, { object: BOUNDARY, point: 0 }, { object: EXT, point: 1 }),
    });
    const at = toScreen(0, 10);
    click(s, ...at);
    expect(selection()).toEqual({ object: WATER, point: null });
    expect(useAppStore.getState().canvasSelectionCycle).toEqual({ position: 1, count: 3 });
    // Again: its point under the pointer; then the next object.
    click(s, ...at);
    expect(selection()).toEqual({ object: WATER, point: 0 });
    click(s, ...at);
    expect(selection()).toEqual({ object: BOUNDARY, point: null });
    expect(useAppStore.getState().canvasSelectionCycle).toEqual({ position: 2, count: 3 });
    click(s, ...at);
    click(s, ...at);
    expect(selection()).toEqual({ object: EXT, point: null });
    expect(useAppStore.getState().canvasSelectionCycle).toEqual({ position: 3, count: 3 });
    click(s, ...at);
    click(s, ...at);
    expect(selection()?.object).toEqual(WATER);
  });

  it("does not cycle on a click elsewhere: the selected object stays", () => {
    select(BOUNDARY);
    const s = setup({ findObjectsAt: under({ object: WATER, point: null }, { object: BOUNDARY, point: null }) });
    click(s, ...toScreen(5, 9));
    expect(selection()).toEqual({ object: BOUNDARY, point: null });
  });

  it("clears the selection by a click on empty canvas", () => {
    select(EXT, 2);
    const s = setup({ findObjectsAt: under() });
    click(s, ...toScreen(28, 2));
    expect(selection()).toBeNull();
    expect(useAppStore.getState().selectedPointIndex).toBeNull();
  });

  it("pans with the middle button, also over an object", () => {
    const { down, move, deps } = setup({ findObjectsAt: under({ object: EXT, point: 2 }) });
    const e = down(400, 300, { button: 1 });
    expect(e.preventDefault).toHaveBeenCalled();
    move(450, 280);
    expect(deps.setActiveViewOffset).toHaveBeenLastCalledWith([-15 + 5, -5 + 2]);
    expect(deps.findObjectsAt).not.toHaveBeenCalled();
  });

  it("pans with the left button in pan mode", () => {
    const { down, move, deps } = setup({ panActive: true });
    down(400, 300);
    move(380, 330);
    expect(deps.setActiveViewOffset).toHaveBeenLastCalledWith([-15 - 2, -5 - 3]);
    expect(deps.findRegionAtPoint).not.toHaveBeenCalled();
  });

  it("assigns the armed material to the clicked region, before any selection", () => {
    const { down, deps } = setup({ assigningMaterialId: "sand", findObjectsAt: under({ object: EXT, point: null }) });
    down(...toScreen(5, 5));
    expect(deps.setRegionMaterial).toHaveBeenCalledWith([5, 5], "sand");
    expect(deps.setAssigningMaterial).toHaveBeenCalledWith(null);
    expect(deps.findObjectsAt).not.toHaveBeenCalled();
  });

  it("disarms the material when clicking outside the model", () => {
    const { down, deps } = setup({ assigningMaterialId: "sand", findRegionAtPoint: vi.fn(() => null) });
    down(...toScreen(50, 5));
    expect(deps.setRegionMaterial).not.toHaveBeenCalled();
    expect(deps.setAssigningMaterial).toHaveBeenCalledWith(null);
  });

  it("ignores non-primary buttons", () => {
    const { down, up, deps } = setup({ assigningMaterialId: "sand", findObjectsAt: under({ object: EXT, point: 1 }) });
    down(...toScreen(5, 5), { button: 2 });
    up(...toScreen(5, 5));
    expect(deps.findObjectsAt).not.toHaveBeenCalled();
    expect(deps.setRegionMaterial).not.toHaveBeenCalled();
    expect(selection()).toBeNull();
  });
});

describe("double-click (edit view)", () => {
  const dbl = (s: ReturnType<typeof setup>, x: number, y: number) =>
    act(() => s.h().handleDoubleClick({ clientX: x, clientY: y } as unknown as Parameters<ReturnType<typeof usePointerHandlers>["handleDoubleClick"]>[0]));

  it("opens the point editor on a point of the selected object", () => {
    select(EXT);
    const onEditPoint = vi.fn();
    const s = setup({ onEditPoint, findObjectsAt: under({ object: EXT, point: 3 }) });
    const [sx, sy] = toScreen(20, 5);
    dbl(s, sx, sy);
    expect(onEditPoint).toHaveBeenCalledWith(EXT, 3, { x: sx, y: sy });
    expect(selection()).toEqual({ object: EXT, point: 3 });
  });

  it("opens the material picker on empty canvas in a region", () => {
    const s = setup({ findObjectsAt: under() });
    const [sx, sy] = toScreen(5, 5);
    dbl(s, sx, sy);
    expect(s.deps.setSelectedRegionKey).toHaveBeenCalledWith("r1");
    expect(s.deps.setMaterialPicker).toHaveBeenLastCalledWith({ screenX: sx, screenY: sy, worldPoint: [5, 5] });
  });

  it("does nothing on an object that is not selected", () => {
    const onEditPoint = vi.fn();
    const s = setup({ onEditPoint, findObjectsAt: under({ object: EXT, point: 3 }) });
    dbl(s, ...toScreen(20, 5));
    expect(onEditPoint).not.toHaveBeenCalled();
    expect(s.deps.setMaterialPicker).not.toHaveBeenCalled();
  });
});

describe("hover (edit view)", () => {
  it("reports the object under the pointer and keeps the same object while it does not change", () => {
    const find = vi.fn<(x: number, y: number) => CanvasCandidate[]>(() => [{ object: EXT, point: 1 }]);
    const { h, move } = setup({ findObjectsAt: find });
    move(...toScreen(0, 10));
    const first = h().hoverObject;
    expect(first).toEqual({ object: EXT, point: 1, locked: false });
    // A pointer cursor over an object that is not selected.
    expect(h().cursor).toBe("pointer");
    move(...toScreen(0.1, 10));
    expect(h().hoverObject).toBe(first);
    find.mockReturnValue([]);
    move(...toScreen(5, 5));
    expect(h().hoverObject).toBeNull();
    expect(h().cursor).toBe("default");
    expect(h().mouseWorld).toEqual([5, 5]);
  });

  it("prefers the selected object where objects overlap, with a grab cursor on its handles", () => {
    useAppStore.setState({
      piezometricLine: { ...DEFAULT_PIEZO_LINE, lines: [{ id: "w", name: "w", color: "#000", coordinates: [[0, 10], [30, 6]] }], activeLineId: "w" },
    });
    select({ type: "waterLine", id: "w" });
    const { h, move } = setup({
      findObjectsAt: under({ object: EXT, point: 1 }, { object: { type: "waterLine", id: "w" }, point: 0 }),
    });
    move(...toScreen(0, 10));
    expect(h().hoverObject?.object).toEqual({ type: "waterLine", id: "w" });
    expect(h().hoverHit).toEqual({ kind: "piezo", lineId: "w", index: 0 });
    expect(h().cursor).toBe("grab");
  });

  it("shows a move cursor over a movable body and a resize cursor over a load end", () => {
    useAppStore.setState({ udls: [{ id: "u", magnitude: 10, x1: 2, x2: 8 }] });
    select({ type: "udl", id: "u" });
    const body = setup({ findObjectsAt: under({ object: { type: "udl", id: "u" }, point: null }) });
    body.move(...toScreen(5, 11));
    expect(body.h().cursor).toBe("move");
    const end = setup({ findObjectsAt: under({ object: { type: "udl", id: "u" }, point: "x1" }) });
    end.move(...toScreen(2, 11));
    expect(end.h().cursor).toBe("ew-resize");
  });

  it("keeps the hover handle for an equal hit and replaces it for a different one", () => {
    const candidates: CanvasCandidate[] = [
      { object: { type: "waterLine", id: "w" }, point: 0 },
      { object: { type: "waterLine", id: "w" }, point: 1 },
      { object: { type: "searchLimits" }, point: "entryLeftX" },
      { object: { type: "searchLimits" }, point: "exitLeftX" },
      { object: { type: "udl", id: "u" }, point: "x1" },
      { object: { type: "udl", id: "u" }, point: "x2" },
      { object: { type: "lineLoad", id: "a" }, point: "x" },
      { object: { type: "lineLoad", id: "b" }, point: "x" },
      { object: { type: "boundary", id: "b" }, point: 0 },
      { object: { type: "boundary", id: "b" }, point: 1 },
      { object: { type: "reinforcement", id: "r" }, point: "end1" },
      { object: { type: "reinforcement", id: "r" }, point: "end2" },
      { object: EXT, point: 0 },
    ];
    let current = candidates[0];
    const { h, move } = setup({ findObjectsAt: vi.fn(() => [{ ...current }]) });
    let previous: PointHit | null = null;
    for (const c of candidates) {
      current = c;
      move(100, 100);
      const first = h().hoverHit;
      expect(first).not.toBeNull();
      if (previous) expect(first).not.toBe(previous);
      // Same hit again (a new but equal object): unchanged.
      move(101, 100);
      expect(h().hoverHit).toBe(first);
      previous = first;
    }
  });
});

describe("wheel", () => {
  const wheel = (h: ReturnType<typeof setup>["h"], e: Partial<WheelEvent>) =>
    act(() =>
      h().handleWheel({
        clientX: 0,
        clientY: 0,
        deltaX: 0,
        deltaY: 0,
        ctrlKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...e,
      }),
    );

  it("zooms around the cursor with Ctrl", () => {
    const { h, deps } = setup();
    const [cx, cy] = [200, 150];
    const before = toWorld(cx, cy);
    wheel(h, { clientX: cx, clientY: cy, deltaY: -100, ctrlKey: true });
    expect(view().scale).toBeCloseTo(12, 9);
    const after = toWorld(cx, cy);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    expect(deps.onZoomCompleted).toHaveBeenCalled();
    wheel(h, { clientX: cx, clientY: cy, deltaY: 100, ctrlKey: true });
    expect(view().scale).toBeCloseTo(9.6, 9);
  });

  it("clamps the zoom", () => {
    useAppStore.setState({ editViewScale: VIEW_SCALE_MAX });
    const { h } = setup();
    wheel(h, { deltaY: -100, ctrlKey: true });
    expect(view().scale).toBe(VIEW_SCALE_MAX);
  });

  it("pans without Ctrl", () => {
    const { h } = setup();
    wheel(h, { deltaX: 30, deltaY: 50 });
    expect(view().offset).toEqual([-15 - 3, -5 + 5]);
  });

  it("does not move a locked result view", () => {
    useAppStore.setState({ mode: "result", resultViewScale: 5, resultViewOffset: [0, 0] });
    const { h, deps } = setup({ mode: "result" });
    wheel(h, { deltaY: 50, ctrlKey: true });
    expect(deps.setActiveViewOffset).not.toHaveBeenCalled();
    expect(deps.setActiveViewScale).not.toHaveBeenCalled();
  });
});

describe("annotations in the result view", () => {
  const ANNOS = [
    { id: "a", type: "text" as const, x: 0.2, y: 0.2, text: "A" },
    { id: "b", type: "text" as const, x: 0.6, y: 0.6, text: "B" },
  ];
  const pf = () => computePaperFrame(W, H, "A4", true, 1, 0, 0, SCREEN_PAPER_BOTTOM_RESERVE_PX);
  const at = (fx: number, fy: number): [number, number] => [pf().x + fx * pf().w, pf().y + fy * pf().h];

  beforeEach(() => {
    useAppStore.setState({
      mode: "result",
      result: null,
      resultViewScale: 5,
      resultViewOffset: [0, 0],
      resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: ANNOS },
    });
  });

  it("selects an annotation and drags it by the paper fraction moved", () => {
    const { down, move, deps } = setup({ mode: "result" });
    const [x, y] = at(0.2, 0.2);
    down(x, y);
    expect(deps.setSelectedAnnotations).toHaveBeenCalledWith(["a"]);
    move(x + pf().w * 0.1, y + pf().h * 0.05);
    const [id, patch] = vi.mocked(deps.updateAnnotation).mock.calls.at(-1)!;
    expect(id).toBe("a");
    expect(patch.x).toBeCloseTo(0.3, 9);
    expect(patch.y).toBeCloseTo(0.25, 9);
  });

  it("toggles the selection with Ctrl or Shift", () => {
    const { down, deps } = setup({ mode: "result", selectedAnnotationIds: ["a"] });
    down(...at(0.6, 0.6), { shiftKey: true });
    expect(deps.toggleAnnotationSelection).toHaveBeenCalledWith("b", true);
    expect(deps.setSelectedAnnotations).not.toHaveBeenCalled();
  });

  it("moves every selected annotation together", () => {
    const { down, move, deps } = setup({ mode: "result", selectedAnnotationIds: ["a", "b"] });
    const [x, y] = at(0.6, 0.6);
    down(x, y);
    move(x - pf().w * 0.1, y);
    const calls = vi.mocked(deps.updateAnnotation).mock.calls;
    const byId = Object.fromEntries(calls.map(([id, p]) => [id, p]));
    expect(byId.a.x).toBeCloseTo(0.1, 9);
    expect(byId.b.x).toBeCloseTo(0.5, 9);
    expect(byId.a.y).toBeCloseTo(0.2, 9);
  });

  it("does not drag on right-click, and selects the paper frame on empty paper", () => {
    const right = setup({ mode: "result" });
    const [x, y] = at(0.2, 0.2);
    right.down(x, y, { button: 2 });
    right.move(x + 50, y);
    expect(right.deps.updateAnnotation).not.toHaveBeenCalled();

    const empty = setup({ mode: "result" });
    empty.down(...at(0.4, 0.9));
    expect(empty.deps.setSelectedResultObject).toHaveBeenCalledWith("paper-frame");
    expect(empty.deps.findObjectsAt).not.toHaveBeenCalled();
  });

  it("hovers annotations with the same hit area as clicks", () => {
    const { h, move } = setup({ mode: "result" });
    move(...at(0.6, 0.6));
    expect(h().hoverHit).toEqual({ kind: "annotation", annoId: "b" });
    move(...at(0.4, 0.4));
    expect(h().hoverHit).toBeNull();
  });
});

describe("custom search planes", () => {
  const CIRCLE = { id: "c1", cx: 15, cy: 14, radius: 10 };
  const LINE = { id: "p1", cx: 0, cy: 0, radius: 0, points: [[5, 8], [15, 2], [25, 4]] as [number, number][] };
  const C1: CanvasObjectRef = { type: "customPlane", id: "c1" };
  const P1: CanvasObjectRef = { type: "customPlane", id: "p1" };
  const planes = () => useAppStore.getState().customSearchPlanes;

  beforeEach(() => {
    useAppStore.setState({ customSearchPlanes: [CIRCLE, LINE] });
    useAppStore.temporal.getState().clear();
  });

  it("drags a circle's centre, snapped to the grid only, showing its numbers beside the pointer", () => {
    select(C1);
    const { deps, h, down, move, up } = setup({
      findObjectsAt: under({ object: C1, point: "centre" }),
      findSnapTarget: vi.fn(() => [0, 0] as [number, number]),
    });
    const [sx, sy] = toScreen(15, 14);
    down(sx, sy);
    move(sx + 33, sy - 12);
    expect(deps.findSnapTarget).not.toHaveBeenCalled();
    expect(planes()[0]).toMatchObject({ cx: 18.3, cy: 15.2, radius: 10 });
    expect(h().mouseWorld).toEqual([18.3, 15.2]);
    expect(h().dragTip).toEqual({ text: "cx 18.30  cy 15.20  R 10.00 m", x: sx + 33, y: sy - 12 });
    expect(selection()).toEqual({ object: C1, point: "centre" });
    up(sx + 33, sy - 12);
    expect(h().dragTip).toBeNull();
  });

  it("drags a circle's rim: the radius is the pointer's distance from the centre, at least 0.1 m", () => {
    select(C1);
    const { h, down, move } = setup({ findObjectsAt: under({ object: C1, point: "rim" }) });
    // Pressed on the rim below the centre, dragged 30 px further down.
    const [sx, sy] = toScreen(15, 4);
    down(sx, sy);
    move(sx, sy + 30);
    expect(planes()[0]).toMatchObject({ cx: 15, cy: 14, radius: 13 });
    expect(h().dragTip!.text).toBe("cx 15.00  cy 14.00  R 13.00 m");
    // Beside the centre: 6 m away.
    move(sx + 60, sy - 100);
    expect(planes()[0].radius).toBeCloseTo(6, 6);
    // On the centre: the minimum.
    move(sx, sy - 100);
    expect(planes()[0].radius).toBe(0.1);
  });

  it("drags a vertex of a non-circular surface, snapping to neighbouring points, anywhere in the soil", () => {
    select(P1);
    const { down, move, up } = setup({
      findObjectsAt: under({ object: P1, point: 1 }),
      findSnapTarget: vi.fn((x: number, y: number) => (Math.hypot(x - 20, y - 5) < 1 ? ([20, 5] as [number, number]) : null)),
    });
    const [sx, sy] = toScreen(15, 2);
    down(sx, sy);
    move(sx + 20, sy + 30);
    expect(planes()[1].points![1]).toEqual([17, -1]);
    move(sx + 48, sy - 28);
    expect(planes()[1].points![1]).toEqual([20, 5]);
    up(sx + 48, sy - 28);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
  });

  it("moves a non-circular surface whole by its line, in whole grid steps, in one undo step", () => {
    select(P1);
    const { down, move, up } = setup({
      snapValue: (v: number) => Math.round(v),
      findObjectsAt: under({ object: P1, point: null }),
    });
    const [sx, sy] = toScreen(10, 5);
    down(sx, sy);
    move(sx + 21, sy - 9);
    expect(planes()[1].points).toEqual([
      [7, 9],
      [17, 3],
      [27, 5],
    ]);
    up(sx + 21, sy - 9);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
    act(() => useAppStore.temporal.getState().undo());
    expect(planes()[1]).toEqual(LINE);
  });

  it("records one undo step for a drag, which restores the circle", () => {
    select(C1);
    const { down, move, up } = setup({ findObjectsAt: under({ object: C1, point: "centre" }) });
    const [sx, sy] = toScreen(15, 14);
    down(sx, sy);
    move(sx + 10, sy);
    move(sx + 20, sy);
    move(sx + 30, sy);
    up(sx + 30, sy);
    const past = useAppStore.temporal.getState().pastStates;
    expect(past).toHaveLength(1);
    expect(past[0].customSearchPlanes![0]).toMatchObject({ cx: 15, cy: 14 });
    expect(planes()[0].cx).toBe(18);
    act(() => useAppStore.temporal.getState().undo());
    expect(planes()[0]).toMatchObject({ cx: 15, cy: 14, radius: 10 });
    expect(planes()[1]).toEqual(LINE);
  });

  it("does not move a handle that is only clicked, and records no step", () => {
    select(C1);
    const { down, move, up } = setup({ findObjectsAt: under({ object: C1, point: "centre" }) });
    const [sx, sy] = toScreen(15, 14);
    down(sx, sy);
    move(sx + 2, sy + 1);
    up(sx + 2, sy + 1);
    expect(planes()[0]).toEqual(CIRCLE);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("picks a surface by a click on its line (the older pick follows), and clears it on empty canvas", () => {
    const onLine = setup({ findObjectsAt: under({ object: P1, point: null }) });
    onLine.down(...toScreen(20, 3));
    onLine.up(...toScreen(20, 3));
    expect(selection()).toEqual({ object: P1, point: null });
    expect(useAppStore.getState().selectedCustomPlaneId).toBe("p1");
    const empty = setup({ findObjectsAt: under() });
    empty.down(...toScreen(28, 2));
    empty.up(...toScreen(28, 2));
    expect(selection()).toBeNull();
    expect(useAppStore.getState().selectedCustomPlaneId).toBeNull();
  });
});

describe("reference annotations in the result view", () => {
  const LINE = {
    id: "l",
    type: "reference" as const,
    shape: "polyline" as const,
    points: [
      [2, 10],
      [12, 4],
      [22, 5],
    ] as [number, number][],
  };
  // Its lowest point (15, 6) lies in the soil; its arc keeps clear of the polyline.
  const CIRCLE = { id: "c", type: "reference" as const, shape: "circle" as const, cx: 15, cy: 18, radius: 12 };
  const refs = () => useAppStore.getState().resultViewSettings.annotations.filter((a) => a.type === "reference");
  const line = () => refs().find((a) => a.id === "l") as typeof LINE;
  const circle = () => refs().find((a) => a.id === "c") as typeof CIRCLE;
  const realUpdate = (id: string, patch: Parameters<Deps["updateAnnotation"]>[1]) => useAppStore.getState().updateAnnotation(id, patch);

  beforeEach(() => {
    useAppStore.setState({
      mode: "result",
      result: null,
      coordinates: COORDS,
      resultViewScale: 5,
      resultViewOffset: [0, 0],
      resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [LINE, CIRCLE] },
    });
    useAppStore.temporal.getState().clear();
  });

  it("selects a polyline by a press on its line without moving it, then drags it whole, in one undo step", () => {
    const first = setup({ mode: "result", updateAnnotation: realUpdate });
    const [sx, sy] = toScreen(7, 7);
    first.down(sx, sy);
    expect(first.deps.setSelectedAnnotations).toHaveBeenCalledWith(["l"]);
    first.move(sx + 20, sy - 20);
    first.up(sx + 20, sy - 20);
    expect(line().points).toEqual(LINE.points);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
    // Selected: a drag moves it.
    const { down, move, up } = setup({ mode: "result", selectedAnnotationIds: ["l"], updateAnnotation: realUpdate });
    down(sx, sy);
    move(sx + 10, sy - 20);
    move(sx + 20, sy - 20);
    expect(line().points).toEqual([
      [6, 14],
      [16, 8],
      [26, 9],
    ]);
    up(sx + 20, sy - 20);
    const past = useAppStore.temporal.getState().pastStates;
    expect(past).toHaveLength(1);
    act(() => useAppStore.temporal.getState().undo());
    expect(line().points).toEqual(LINE.points);
    expect(circle()).toEqual(CIRCLE);
  });

  it("drags a vertex (snapped to the grid) and a circle's centre and rim of the selected lines", () => {
    const { down, move, up } = setup({ mode: "result", selectedAnnotationIds: ["l", "c"], updateAnnotation: realUpdate });
    const [vx, vy] = toScreen(12, 4);
    down(vx, vy);
    move(vx + 6.3, vy + 4.2); // +1.26 m, -0.84 m → snapped to 0.1
    up(vx + 6.3, vy + 4.2);
    expect(line().points[1]).toEqual([13.3, 3.2]);

    const [cx, cy] = toScreen(15, 18);
    down(cx, cy);
    move(cx + 5, cy + 5);
    up(cx + 5, cy + 5);
    expect(circle()).toMatchObject({ cx: 16, cy: 17, radius: 12 });

    // The bottom of the circle (16, 5) lies in the soil: its rim.
    const [rx, ry] = toScreen(16, 5);
    down(rx, ry);
    move(rx, ry + 10);
    up(rx, ry + 10);
    expect(circle()).toMatchObject({ cx: 16, cy: 17, radius: 14 });
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(3);
  });

  it("grabs a colour bar drawn over a reference line, not the line", () => {
    // The colour bar's anchor on the polyline's vertex (12, 4).
    const [sx, sy] = toScreen(12, 4);
    const pf = computePaperFrame(W, H, "A4", true, 1, 0, 0, SCREEN_PAPER_BOTTOM_RESERVE_PX);
    const bar = { id: "bar", type: "color-bar" as const, x: (sx - pf.x) / pf.w, y: (sy - pf.y) / pf.h };
    useAppStore.setState({ resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [LINE, CIRCLE, bar] } });
    const { deps, h, down, move } = setup({ mode: "result" });
    move(sx, sy);
    expect(h().hoverHit).toEqual({ kind: "annotation", annoId: "bar" });
    down(sx, sy);
    expect(deps.setSelectedAnnotations).toHaveBeenCalledWith(["bar"]);
    move(sx + 10, sy);
    expect(vi.mocked(deps.updateAnnotation).mock.calls.at(-1)![0]).toBe("bar");
    expect(line().points).toEqual(LINE.points);
  });

  it("hovers reference handles and lines", () => {
    const { h, move } = setup({ mode: "result" });
    move(...toScreen(12, 4));
    expect(h().hoverHit).toEqual({ kind: "referenceVertex", annoId: "l", pointIndex: 1 });
    move(...toScreen(7, 7));
    expect(h().hoverHit).toEqual({ kind: "referenceLine", annoId: "l" });
    move(...toScreen(15, 6));
    expect(h().hoverHit).toEqual({ kind: "referenceCircle", annoId: "c", handle: "rim" });
    move(...toScreen(28, 2));
    expect(h().hoverHit).toBeNull();
  });

  it("adds to the selection with Ctrl and records no step for a mere click", () => {
    const { deps, down, up } = setup({ mode: "result", selectedAnnotationIds: ["c"], updateAnnotation: realUpdate });
    const [sx, sy] = toScreen(7, 7);
    down(sx, sy, { ctrlKey: true });
    expect(deps.toggleAnnotationSelection).toHaveBeenCalledWith("l", true);
    up(sx, sy);
    expect(line().points).toEqual(LINE.points);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
