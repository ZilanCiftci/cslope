import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as RMouseEvent } from "react";
import { useContextMenu } from "./useContextMenu";
import { useAppStore } from "../../../store/app-store";
import { DEFAULT_PIEZO_LINE, DEFAULT_RESULT_VIEW_SETTINGS } from "../../../store/defaults";
import { computePaperFrame } from "../helpers";
import type { CanvasCandidate } from "../object-hits";
import type { CanvasObjectRef } from "../../../store/types";

type Params = Parameters<typeof useContextMenu>[0];

const RECT = { left: 10, top: 20, width: 800, height: 600 };

function canvasStub() {
  return {
    getBoundingClientRect: () => RECT,
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
}

function setup(over: Partial<Params> = {}) {
  const params: Params = {
    canvasRef: { current: canvasStub() },
    mode: "edit",
    selectedAnnotationIds: [],
    setSelectedAnnotations: vi.fn(),
    alignAnnotations: vi.fn(),
    getEventWorldPos: vi.fn(() => [1, 2] as [number, number]),
    findObjectsAt: vi.fn(() => []),
    edgeAt: vi.fn(() => null),
    findRegionAtPoint: vi.fn(() => null),
    setMaterialPicker: vi.fn(),
    ...over,
  };
  const hook = renderHook(() => useContextMenu(params));
  const open = (clientX = 110, clientY = 220) => {
    const preventDefault = vi.fn();
    act(() =>
      hook.result.current.handleContextMenu({
        clientX,
        clientY,
        preventDefault,
      } as unknown as RMouseEvent<HTMLCanvasElement>),
    );
    return preventDefault;
  };
  const menu = () => hook.result.current.contextMenu;
  const click = (label: string) => {
    const item = menu()!.items.find((i) => i.label === label)!;
    act(() => item.action());
  };
  return { params, open, menu, click };
}


/** Objects under the pointer, as the canvas's hit test reports them. */
const under = (...c: CanvasCandidate[]) => vi.fn(() => c.map((x) => ({ ...x })));
const EXT: CanvasObjectRef = { type: "exterior" };
const labels = (m: ReturnType<ReturnType<typeof setup>["menu"]>) => m!.items.map((i) => i.label);
const item = (m: ReturnType<ReturnType<typeof setup>["menu"]>, label: string) => m!.items.find((i) => i.label === label)!;

describe("useContextMenu — edit mode", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.setState({
      coordinates: [
        [0, 0],
        [0, 10],
        [10, 10],
        [20, 0],
      ],
      coordinateExpressions: [],
      materialBoundaries: [{ id: "b", coordinates: [[0, 5], [10, 5], [20, 2]] }],
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        lines: [
          { id: "w", name: "w", color: "#000", coordinates: [[0, 8], [10, 8], [20, 6]] },
          { id: "v", name: "v", color: "#000", coordinates: [[0, 1], [20, 1]] },
        ],
        activeLineId: "v",
      },
    });
  });
  const st = () => useAppStore.getState();

  it("selects the point under the pointer and offers to delete it, at the click position relative to the canvas", () => {
    const { open, menu, click } = setup({ findObjectsAt: under({ object: EXT, point: 1 }) });
    const prevent = open(110, 220);
    expect(prevent).toHaveBeenCalled();
    expect(menu()).toMatchObject({ screenX: 100, screenY: 200 });
    expect(labels(menu())).toEqual(["Delete point", "Lock exterior boundary"]);
    expect(item(menu(), "Lock exterior boundary").separator).toBe(true);
    // The right-click selects what the menu acts on.
    expect(st().canvasSelection).toEqual({ object: EXT, point: 1 });
    click("Delete point");
    expect(st().coordinates).toHaveLength(3);
    expect(st().canvasSelection).toEqual({ object: EXT, point: null });
    expect(menu()).toBeNull();
  });

  it("disables deleting a point of a triangle, of a two-point line, and of a locked object", () => {
    act(() => st().removeCoordinate(3));
    const triangle = setup({ findObjectsAt: under({ object: EXT, point: 1 }) });
    triangle.open();
    expect(item(triangle.menu(), "Delete point").disabled).toBe(true);
    triangle.click("Delete point");
    expect(st().coordinates).toHaveLength(3);

    const water = setup({ findObjectsAt: under({ object: { type: "waterLine", id: "v" }, point: 0 }) });
    water.open();
    expect(item(water.menu(), "Delete point").disabled).toBe(true);

    act(() => st().setObjectLocked({ type: "waterLine", id: "w" }, true));
    const locked = setup({ findObjectsAt: under({ object: { type: "waterLine", id: "w" }, point: 1 }) });
    locked.open();
    expect(item(locked.menu(), "Delete point").disabled).toBe(true);
    locked.click("Delete point");
    expect(st().piezometricLine.lines[0].coordinates).toHaveLength(3);
  });

  it("deletes a point of the water line it is on (made the active one) and of a boundary", () => {
    const water = setup({ findObjectsAt: under({ object: { type: "waterLine", id: "w" }, point: 1 }) });
    water.open();
    expect(st().piezometricLine.activeLineId).toBe("w");
    water.click("Delete point");
    expect(st().piezometricLine.lines[0].coordinates).toEqual([
      [0, 8],
      [20, 6],
    ]);
    const boundary = setup({ findObjectsAt: under({ object: { type: "boundary", id: "b" }, point: 1 }) });
    boundary.open();
    boundary.click("Delete point");
    expect(st().materialBoundaries[0].coordinates).toHaveLength(2);
    expect(st().selectedMaterialBoundaryId).toBe("b");
  });

  it("adds a point on the line of an object at the snapped position and selects it", () => {
    const edgeAt = vi.fn(() => ({ kind: "external" as const, insertIndex: 2, snapPoint: [5, 10] as [number, number] }));
    const { open, menu, click } = setup({ findObjectsAt: under({ object: EXT, point: null }), edgeAt });
    open();
    expect(edgeAt).toHaveBeenCalledWith(EXT, 1, 2);
    expect(labels(menu())).toEqual(["Add point", "Lock exterior boundary"]);
    click("Add point");
    expect(st().coordinates[2]).toEqual([5, 10]);
    expect(st().canvasSelection).toEqual({ object: EXT, point: 2 });
  });

  it("adds a point on a water line (made the active one) and on a boundary", () => {
    const water = setup({
      findObjectsAt: under({ object: { type: "waterLine", id: "w" }, point: null }),
      edgeAt: vi.fn(() => ({ kind: "piezo" as const, lineId: "w", insertIndex: 1, snapPoint: [5, 8] as [number, number] })),
    });
    water.open();
    water.click("Add point");
    expect(st().piezometricLine.lines[0].coordinates[1]).toEqual([5, 8]);
    const boundary = setup({
      findObjectsAt: under({ object: { type: "boundary", id: "b" }, point: null }),
      edgeAt: vi.fn(() => ({ kind: "boundary" as const, boundaryId: "b", insertIndex: 1, snapPoint: [5, 5] as [number, number] })),
    });
    boundary.open();
    boundary.click("Add point");
    expect(st().materialBoundaries[0].coordinates[1]).toEqual([5, 5]);
  });

  it("offers only Lock for objects without point editing (a load handle)", () => {
    act(() => st().addUdl());
    const id = st().udls[0].id;
    const { open, menu } = setup({ findObjectsAt: under({ object: { type: "udl", id }, point: "x1" }) });
    open();
    expect(labels(menu())).toEqual(["Lock distributed load 1"]);
    expect(item(menu(), "Lock distributed load 1").separator).toBeFalsy();
  });

  it("locks and unlocks an object, as one undo step each", () => {
    useAppStore.temporal.getState().clear();
    const lock = setup({ findObjectsAt: under({ object: { type: "boundary", id: "b" }, point: null }) });
    lock.open();
    lock.click("Lock material boundary 1");
    expect(st().locks).toEqual({ boundaries: ["b"] });
    const unlock = setup({ findObjectsAt: under({ object: { type: "boundary", id: "b" }, point: null }) });
    unlock.open();
    // A locked object offers no point editing.
    expect(item(unlock.menu(), "Unlock material boundary 1")).toBeDefined();
    unlock.click("Unlock material boundary 1");
    expect(st().locks).toEqual({});
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(2);
    act(() => useAppStore.temporal.getState().undo());
    expect(st().locks).toEqual({ boundaries: ["b"] });
  });

  it("acts on the selected object where objects overlap", () => {
    act(() => st().selectCanvasObject({ type: "boundary", id: "b" }));
    const { open } = setup({
      findObjectsAt: under({ object: EXT, point: 1 }, { object: { type: "boundary", id: "b" }, point: 0 }),
    });
    open();
    expect(st().canvasSelection).toEqual({ object: { type: "boundary", id: "b" }, point: 0 });
  });

  it("offers Assign material, Lock all by type and Unlock all on empty canvas", () => {
    const setMaterialPicker = vi.fn();
    const { open, menu, click } = setup({
      findObjectsAt: under(),
      findRegionAtPoint: vi.fn(() => ({ regionKey: "r1" })),
      setMaterialPicker,
    });
    open(110, 220);
    expect(labels(menu())).toEqual(["Assign material…", "Lock all", "Unlock all"]);
    expect(item(menu(), "Unlock all").disabled).toBe(true);
    const groups = item(menu(), "Lock all").submenu!;
    expect(groups.map((g) => g.label)).toEqual([
      "Exterior boundary",
      "Material boundaries",
      "Water lines",
      "Loads",
      "Reinforcement",
      "Search limits",
      "Custom surfaces",
      "Drawings",
    ]);
    // Nothing to lock among loads, reinforcement and custom surfaces here.
    expect(groups.filter((g) => g.disabled).map((g) => g.label)).toEqual(
      expect.arrayContaining(["Loads", "Reinforcement", "Custom surfaces"]),
    );
    act(() => groups.find((g) => g.label === "Water lines")!.action());
    expect(st().locks).toEqual({ waterLines: ["w", "v"] });
    act(() => groups.find((g) => g.label === "Exterior boundary")!.action());
    expect(st().locks.exterior).toBe(true);
    // Unlock all, now that something is locked.
    open(110, 220);
    expect(item(menu(), "Unlock all").disabled).toBe(false);
    click("Unlock all");
    expect(st().locks).toEqual({});
    // Assign material opens the picker at the click.
    open(110, 220);
    click("Assign material…");
    expect(setMaterialPicker).toHaveBeenLastCalledWith({ screenX: 100, screenY: 200, worldPoint: [1, 2] });
    expect(st().selectedRegionKey).toBe("r1");
  });

  it("leaves out Assign material outside the model", () => {
    const { open, menu } = setup({ findObjectsAt: under(), findRegionAtPoint: vi.fn(() => null) });
    open();
    expect(labels(menu())).toEqual(["Lock all", "Unlock all"]);
  });

  it("does nothing without a canvas", () => {
    const { params, open, menu } = setup({ canvasRef: { current: null }, findObjectsAt: under({ object: EXT, point: 1 }) });
    open();
    expect(menu()).toBeNull();
    expect(params.findObjectsAt).not.toHaveBeenCalled();
  });
});

describe("useContextMenu — result mode", () => {
  const ANNOS = [
    { id: "a", type: "text" as const, x: 0.2, y: 0.2, text: "A" },
    { id: "b", type: "text" as const, x: 0.6, y: 0.6, text: "B" },
  ];
  // Click positions (client coordinates) on each annotation anchor.
  const at = (fx: number, fy: number): [number, number] => {
    const pf = computePaperFrame(RECT.width, RECT.height, "A4", true, 1, 0, 0);
    return [RECT.left + pf.x + fx * pf.w, RECT.top + pf.y + fy * pf.h];
  };

  beforeEach(() => {
    useAppStore.setState({
      result: null,
      resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: ANNOS },
    });
  });
  afterEach(() => useAppStore.getState().newProject());

  it("selects a single annotation under the pointer without opening a menu", () => {
    const { params, open, menu } = setup({ mode: "result" });
    open(...at(0.6, 0.6));
    expect(params.setSelectedAnnotations).toHaveBeenCalledWith(["b"]);
    expect(menu()).toBeNull();
    expect(params.findObjectsAt).not.toHaveBeenCalled();
  });

  it("offers alignment for a multi-selection and runs the chosen alignment", () => {
    const { params, open, menu, click } = setup({ mode: "result", selectedAnnotationIds: ["a", "b"] });
    open(...at(0.2, 0.2));
    expect(menu()!.items.map((i) => i.label)).toEqual([
      "Align left",
      "Align right",
      "Align top",
      "Align bottom",
      "Center horizontally",
      "Center vertically",
    ]);
    const dirs = ["left", "right", "top", "bottom", "center-h", "center-v"];
    for (const [i, label] of ["Align left", "Align right", "Align top", "Align bottom", "Center horizontally", "Center vertically"].entries()) {
      open(...at(0.2, 0.2));
      click(label);
      expect(params.alignAnnotations).toHaveBeenLastCalledWith(dirs[i]);
      expect(menu()).toBeNull();
    }
  });

  it("ignores clicks away from annotations", () => {
    const { params, open, menu } = setup({ mode: "result", selectedAnnotationIds: ["a", "b"] });
    open(...at(0.4, 0.9));
    expect(params.setSelectedAnnotations).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });
});

describe("useContextMenu — custom search planes", () => {
  const LINE = { id: "p1", cx: 0, cy: 0, radius: 0, points: [[5, 8], [15, 2], [25, 4]] as [number, number][] };
  const CIRCLE = { id: "c1", cx: 15, cy: 14, radius: 10 };
  const P1: CanvasObjectRef = { type: "customPlane", id: "p1" };
  const C1: CanvasObjectRef = { type: "customPlane", id: "c1" };
  const planes = () => useAppStore.getState().customSearchPlanes;
  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.setState({ customSearchPlanes: [LINE, CIRCLE] });
  });

  it("offers to delete a vertex (a surface keeps two) or the whole surface", () => {
    const { open, menu, click } = setup({ findObjectsAt: under({ object: P1, point: 1 }) });
    open();
    expect(labels(menu())).toEqual(["Delete point", "Delete surface", "Lock custom surface 2"]);
    click("Delete point");
    expect(planes()[0].points).toEqual([
      [5, 8],
      [25, 4],
    ]);
    open();
    expect(item(menu(), "Delete point").disabled).toBe(true);
    click("Delete surface");
    expect(planes().map((p) => p.id)).toEqual(["c1"]);
  });

  it("offers to delete a circle from its centre or its rim, not when it is locked", () => {
    const rim = setup({ findObjectsAt: under({ object: C1, point: "rim" }) });
    rim.open();
    expect(labels(rim.menu())).toEqual(["Delete circle", "Lock custom circle 1"]);
    expect(useAppStore.getState().canvasSelection).toEqual({ object: C1, point: "rim" });
    act(() => useAppStore.getState().setObjectLocked(C1, true));
    const centre = setup({ findObjectsAt: under({ object: C1, point: "centre" }) });
    centre.open();
    expect(item(centre.menu(), "Delete circle").disabled).toBe(true);
    centre.click("Delete circle");
    expect(planes().map((p) => p.id)).toEqual(["p1", "c1"]);
  });

  it("adds a point on a surface segment at the snapped position", () => {
    const { open, click } = setup({
      findObjectsAt: under({ object: P1, point: null }),
      edgeAt: vi.fn(() => ({ kind: "customPlane" as const, planeId: "p1", insertIndex: 2, snapPoint: [20, 3] as [number, number] })),
    });
    open();
    click("Add point");
    expect(planes()[0].points![2]).toEqual([20, 3]);
    expect(useAppStore.getState().canvasSelection).toEqual({ object: P1, point: 2 });
  });

  it("offers to add a custom search plane as a reference line in the edit view", () => {
    const addReferenceFromCustomPlane = vi.fn();
    const vertex = setup({ addReferenceFromCustomPlane, findObjectsAt: under({ object: P1, point: 1 }) });
    vertex.open();
    expect(labels(vertex.menu())).toEqual(["Delete point", "Delete surface", "Add as reference line", "Lock custom surface 2"]);
    vertex.click("Add as reference line");
    expect(addReferenceFromCustomPlane).toHaveBeenCalledWith("p1");
    expect(vertex.menu()).toBeNull();

    const circle = setup({ addReferenceFromCustomPlane, findObjectsAt: under({ object: C1, point: "rim" }) });
    circle.open();
    expect(labels(circle.menu())).toEqual(["Delete circle", "Add as reference line", "Lock custom circle 1"]);

    const edge = setup({
      addReferenceFromCustomPlane,
      findObjectsAt: under({ object: P1, point: null }),
      edgeAt: vi.fn(() => ({ kind: "customPlane" as const, planeId: "p1", insertIndex: 2, snapPoint: [20, 3] as [number, number] })),
    });
    edge.open();
    expect(labels(edge.menu())).toEqual(["Add point", "Delete surface", "Add as reference line", "Lock custom surface 2"]);

    // Without the action (the result canvas) the item is not offered.
    const none = setup({ findObjectsAt: under({ object: P1, point: 1 }) });
    none.open();
    expect(labels(none.menu())).toEqual(["Delete point", "Delete surface", "Lock custom surface 2"]);
  });
});

describe("useContextMenu — reference annotations", () => {
  const COORDS: [number, number][] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [20, 5],
    [30, 5],
    [30, 0],
  ];
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
  const line = () => refs().find((a) => a.id === "l") as typeof LINE | undefined;
  // Client position of a world point: 10 px per metre, the world origin at the canvas centre.
  const at = (x: number, y: number): [number, number] => [RECT.left + RECT.width / 2 + x * 10, RECT.top + RECT.height / 2 - y * 10];

  beforeEach(() => {
    useAppStore.setState({
      result: null,
      coordinates: COORDS,
      resultViewScale: 10,
      resultViewOffset: [0, 0],
      resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [LINE, CIRCLE] },
    });
  });
  afterEach(() => useAppStore.getState().newProject());

  it("removes a vertex of a polyline (it keeps two) or the whole line", () => {
    const { params, open, menu, click } = setup({ mode: "result" });
    open(...at(12, 4));
    expect(params.setSelectedAnnotations).toHaveBeenCalledWith(["l"]);
    expect(menu()!.items.map((i) => i.label)).toEqual(["Delete point", "Delete reference line"]);
    click("Delete point");
    expect(line()!.points).toEqual([
      [2, 10],
      [22, 5],
    ]);
    expect(menu()).toBeNull();
    open(...at(2, 10));
    expect(menu()!.items[0]).toMatchObject({ label: "Delete point", disabled: true });
    click("Delete reference line");
    expect(line()).toBeUndefined();
  });

  it("adds a point on a segment at the snapped position", () => {
    const { open, menu, click } = setup({ mode: "result", snapValue: (v) => Math.round(v) });
    open(...at(17.2, 4.6));
    expect(menu()!.items.map((i) => i.label)).toEqual(["Add point", "Delete reference line"]);
    click("Add point");
    expect(line()!.points).toEqual([
      [2, 10],
      [12, 4],
      [17, 5],
      [22, 5],
    ]);
  });

  it("takes a colour bar drawn over a reference line, not the line", () => {
    const [cx, cy] = at(12, 4);
    const pf = computePaperFrame(RECT.width, RECT.height, "A4", true, 1, 0, 0);
    const bar = { id: "bar", type: "color-bar" as const, x: (cx - RECT.left - pf.x) / pf.w, y: (cy - RECT.top - pf.y) / pf.h };
    useAppStore.setState({ resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [LINE, CIRCLE, bar] } });
    const { params, open, menu } = setup({ mode: "result" });
    open(cx, cy);
    expect(params.setSelectedAnnotations).toHaveBeenCalledWith(["bar"]);
    expect(params.setSelectedAnnotations).not.toHaveBeenCalledWith(["l"]);
    expect(menu()).toBeNull();
  });

  it("deletes a circle from its arc or centre", () => {
    const { open, menu, click } = setup({ mode: "result" });
    open(...at(15, 6));
    expect(menu()!.items.map((i) => i.label)).toEqual(["Delete reference circle"]);
    click("Delete reference circle");
    expect(refs().map((a) => a.id)).toEqual(["l"]);
  });
});
