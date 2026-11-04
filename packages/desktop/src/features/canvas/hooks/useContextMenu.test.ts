import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as RMouseEvent } from "react";
import { useContextMenu } from "./useContextMenu";
import { useAppStore } from "../../../store/app-store";
import { DEFAULT_PIEZO_LINE, DEFAULT_RESULT_VIEW_SETTINGS } from "../../../store/defaults";
import { computePaperFrame } from "../helpers";
import type { EdgeHit, PointHit } from "../types";

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
    findNearPointUnified: vi.fn(() => null),
    findNearEdgeUnified: vi.fn(() => null),
    coordinates: [
      [0, 0],
      [0, 10],
      [10, 10],
      [20, 0],
    ],
    materialBoundaries: [],
    piezometricLine: DEFAULT_PIEZO_LINE,
    setActivePiezoLine: vi.fn(),
    removeCoordinate: vi.fn(),
    removeBoundaryPoint: vi.fn(),
    removePiezoPoint: vi.fn(),
    insertCoordinateAt: vi.fn(),
    insertBoundaryPointAt: vi.fn(),
    insertPiezoPointAt: vi.fn(),
    setSelectedPoint: vi.fn(),
    setSelectedMaterialBoundary: vi.fn(),
    setMaterialPicker: vi.fn(),
    customSearchPlanes: [],
    removeCustomSearchPlane: vi.fn(),
    removeCustomPlanePoint: vi.fn(),
    insertCustomPlanePointAt: vi.fn(),
    setSelectedCustomPlane: vi.fn(),
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

const pointHit = (hit: PointHit) => vi.fn(() => hit);
const edgeHit = (hit: EdgeHit) => vi.fn(() => hit);

describe("useContextMenu — edit mode", () => {
  it("offers to delete an exterior point at the click position, relative to the canvas", () => {
    const { params, open, menu, click } = setup({
      coordinates: [
        [0, 0],
        [0, 10],
        [10, 10],
        [20, 5],
        [20, 0],
      ],
      findNearPointUnified: pointHit({ kind: "external", index: 2 }),
    });
    const prevented = open(110, 220);
    expect(prevented).toHaveBeenCalled();
    expect(params.setMaterialPicker).toHaveBeenCalledWith(null);
    expect(menu()).toMatchObject({ screenX: 100, screenY: 200 });
    expect(menu()!.items).toEqual([expect.objectContaining({ label: "Delete Point", danger: true, disabled: false })]);
    click("Delete Point");
    expect(params.removeCoordinate).toHaveBeenCalledWith(2);
    expect(params.setSelectedPoint).toHaveBeenCalledWith(null);
    expect(menu()).toBeNull();
  });

  it("disables deleting an exterior point of a triangle", () => {
    const { params, open, menu, click } = setup({
      coordinates: [
        [0, 0],
        [0, 10],
        [10, 0],
      ],
      findNearPointUnified: pointHit({ kind: "external", index: 0 }),
    });
    open();
    expect(menu()!.items[0].disabled).toBe(true);
    click("Delete Point");
    expect(params.removeCoordinate).not.toHaveBeenCalled();
  });

  it("activates the water line of a point and only deletes beyond two points", () => {
    const line = (n: number) => ({
      id: "w",
      name: "w",
      color: "#000",
      coordinates: Array.from({ length: n }, (_, i) => [i, 5] as [number, number]),
    });
    const three = setup({
      piezometricLine: { ...DEFAULT_PIEZO_LINE, lines: [line(3)] },
      findNearPointUnified: pointHit({ kind: "piezo", lineId: "w", index: 1 }),
    });
    three.open();
    expect(three.params.setActivePiezoLine).toHaveBeenCalledWith("w");
    expect(three.menu()!.items[0].disabled).toBe(false);
    three.click("Delete Point");
    expect(three.params.removePiezoPoint).toHaveBeenCalledWith(1);

    const two = setup({
      piezometricLine: { ...DEFAULT_PIEZO_LINE, lines: [line(2)] },
      findNearPointUnified: pointHit({ kind: "piezo", lineId: "w", index: 1 }),
    });
    two.open();
    expect(two.menu()!.items[0].disabled).toBe(true);
    two.click("Delete Point");
    expect(two.params.removePiezoPoint).not.toHaveBeenCalled();
  });

  it("selects the boundary of a point; a closed boundary keeps at least a triangle", () => {
    const closedTriangle = {
      id: "c",
      coordinates: [
        [1, 1],
        [3, 1],
        [2, 3],
        [1, 1],
      ] as [number, number][],
    };
    const openLine = {
      id: "o",
      coordinates: [
        [0, 5],
        [5, 4],
        [10, 5],
      ] as [number, number][],
    };
    const closed = setup({
      materialBoundaries: [closedTriangle, openLine],
      findNearPointUnified: pointHit({ kind: "boundary", boundaryId: "c", pointIndex: 1 }),
    });
    closed.open();
    expect(closed.params.setSelectedMaterialBoundary).toHaveBeenCalledWith("c");
    expect(closed.menu()!.items[0].disabled).toBe(true);

    const open = setup({
      materialBoundaries: [closedTriangle, openLine],
      findNearPointUnified: pointHit({ kind: "boundary", boundaryId: "o", pointIndex: 1 }),
    });
    open.open();
    expect(open.menu()!.items[0].disabled).toBe(false);
    open.click("Delete Point");
    expect(open.params.removeBoundaryPoint).toHaveBeenCalledWith("o", 1);

    const missing = setup({
      findNearPointUnified: pointHit({ kind: "boundary", boundaryId: "gone", pointIndex: 0 }),
    });
    missing.open();
    expect(missing.menu()!.items[0].disabled).toBe(true);
  });

  it("offers no items for other point kinds (e.g. a load handle)", () => {
    const { open, menu } = setup({ findNearPointUnified: pointHit({ kind: "lineLoad", loadId: "l" }) });
    open();
    expect(menu()!.items).toEqual([]);
  });

  it("adds a point on an exterior edge at the snapped position and selects it", () => {
    const { params, open, click } = setup({
      findNearEdgeUnified: edgeHit({ kind: "external", insertIndex: 3, snapPoint: [15, 5] }),
    });
    open();
    expect(params.findNearPointUnified).toHaveBeenCalledWith(1, 2);
    click("Add Point");
    expect(params.insertCoordinateAt).toHaveBeenCalledWith(3, [15, 5]);
    expect(params.setSelectedPoint).toHaveBeenCalledWith(3);
  });

  it("adds a point on a water line or boundary edge, activating it first", () => {
    const water = setup({
      findNearEdgeUnified: edgeHit({ kind: "piezo", lineId: "w", insertIndex: 1, snapPoint: [4, 5] }),
    });
    water.open();
    expect(water.params.setActivePiezoLine).toHaveBeenCalledWith("w");
    water.click("Add Point");
    expect(water.params.insertPiezoPointAt).toHaveBeenCalledWith(1, [4, 5]);

    const boundary = setup({
      findNearEdgeUnified: edgeHit({ kind: "boundary", boundaryId: "b", insertIndex: 2, snapPoint: [6, 3] }),
    });
    boundary.open();
    expect(boundary.params.setSelectedMaterialBoundary).toHaveBeenCalledWith("b");
    boundary.click("Add Point");
    expect(boundary.params.insertBoundaryPointAt).toHaveBeenCalledWith("b", 2, [6, 3]);
  });

  it("leaves the menu closed when nothing is under the pointer", () => {
    const empty = setup();
    empty.open();
    expect(empty.params.findNearEdgeUnified).toHaveBeenCalledWith(1, 2);
    expect(empty.menu()).toBeNull();
  });

  it("does nothing without a canvas", () => {
    const { params, open, menu } = setup({
      canvasRef: { current: null },
      findNearPointUnified: pointHit({ kind: "external", index: 0 }),
    });
    open();
    expect(menu()).toBeNull();
    expect(params.findNearPointUnified).not.toHaveBeenCalled();
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
    expect(params.findNearPointUnified).not.toHaveBeenCalled();
  });

  it("offers alignment for a multi-selection and runs the chosen alignment", () => {
    const { params, open, menu, click } = setup({ mode: "result", selectedAnnotationIds: ["a", "b"] });
    open(...at(0.2, 0.2));
    expect(menu()!.items.map((i) => i.label)).toEqual([
      "Align Left",
      "Align Right",
      "Align Top",
      "Align Bottom",
      "Center Horizontally",
      "Center Vertically",
    ]);
    const dirs = ["left", "right", "top", "bottom", "center-h", "center-v"];
    for (const [i, label] of ["Align Left", "Align Right", "Align Top", "Align Bottom", "Center Horizontally", "Center Vertically"].entries()) {
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
  const LINE = { id: "p1", points: [[5, 8], [15, 2], [25, 4]] as [number, number][] };

  it("offers to delete a vertex (a surface keeps two) or the whole surface", () => {
    const { params, open, menu, click } = setup({
      customSearchPlanes: [LINE],
      findNearPointUnified: pointHit({ kind: "customVertex", planeId: "p1", pointIndex: 1 }),
    });
    open();
    expect(params.setSelectedCustomPlane).toHaveBeenCalledWith("p1");
    expect(menu()!.items.map((i) => i.label)).toEqual(["Delete Point", "Delete Surface"]);
    expect(menu()!.items[0]).toMatchObject({ danger: true, disabled: false });
    click("Delete Point");
    expect(params.removeCustomPlanePoint).toHaveBeenCalledWith("p1", 1);
    expect(menu()).toBeNull();
    open();
    click("Delete Surface");
    expect(params.removeCustomSearchPlane).toHaveBeenCalledWith("p1");
    expect(menu()).toBeNull();

    const two = setup({
      customSearchPlanes: [{ id: "p1", points: [[5, 8], [25, 4]] }],
      findNearPointUnified: pointHit({ kind: "customVertex", planeId: "p1", pointIndex: 0 }),
    });
    two.open();
    expect(two.menu()!.items[0]).toMatchObject({ label: "Delete Point", disabled: true });
    two.click("Delete Point");
    expect(two.params.removeCustomPlanePoint).not.toHaveBeenCalled();
  });

  it("offers to delete a circle from its centre or its rim", () => {
    for (const handle of ["centre", "rim"] as const) {
      const { params, open, menu, click } = setup({
        customSearchPlanes: [{ id: "c1" }],
        findNearPointUnified: pointHit({ kind: "customCircle", planeId: "c1", handle }),
      });
      open();
      expect(params.setSelectedCustomPlane).toHaveBeenCalledWith("c1");
      expect(menu()!.items).toEqual([expect.objectContaining({ label: "Delete Circle", danger: true })]);
      click("Delete Circle");
      expect(params.removeCustomSearchPlane).toHaveBeenCalledWith("c1");
      expect(menu()).toBeNull();
    }
  });

  it("adds a point on a surface segment at the snapped position", () => {
    const { params, open, menu, click } = setup({
      customSearchPlanes: [LINE],
      findNearEdgeUnified: edgeHit({ kind: "customPlane", planeId: "p1", insertIndex: 2, snapPoint: [20, 3] }),
    });
    open();
    expect(params.setSelectedCustomPlane).toHaveBeenCalledWith("p1");
    expect(menu()!.items.map((i) => i.label)).toEqual(["Add Point"]);
    click("Add Point");
    expect(params.insertCustomPlanePointAt).toHaveBeenCalledWith("p1", 2, [20, 3]);
    expect(menu()).toBeNull();
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
    expect(menu()!.items.map((i) => i.label)).toEqual(["Remove Point", "Delete Reference Line"]);
    click("Remove Point");
    expect(line()!.points).toEqual([
      [2, 10],
      [22, 5],
    ]);
    expect(menu()).toBeNull();
    open(...at(2, 10));
    expect(menu()!.items[0]).toMatchObject({ label: "Remove Point", disabled: true });
    click("Delete Reference Line");
    expect(line()).toBeUndefined();
  });

  it("adds a point on a segment at the snapped position", () => {
    const { open, menu, click } = setup({ mode: "result", snapValue: (v) => Math.round(v) });
    open(...at(17.2, 4.6));
    expect(menu()!.items.map((i) => i.label)).toEqual(["Add Point", "Delete Reference Line"]);
    click("Add Point");
    expect(line()!.points).toEqual([
      [2, 10],
      [12, 4],
      [17, 5],
      [22, 5],
    ]);
  });

  it("deletes a circle from its arc or centre", () => {
    const { open, menu, click } = setup({ mode: "result" });
    open(...at(15, 6));
    expect(menu()!.items.map((i) => i.label)).toEqual(["Delete Reference Circle"]);
    click("Delete Reference Circle");
    expect(refs().map((a) => a.id)).toEqual(["l"]);
  });

  it("offers to add a custom search plane as a reference line in the edit view", () => {
    const LINE_PLANE = { id: "p1", points: [[5, 8], [15, 2], [25, 4]] as [number, number][] };
    const addReferenceFromCustomPlane = vi.fn();
    const vertex = setup({
      customSearchPlanes: [LINE_PLANE],
      addReferenceFromCustomPlane,
      findNearPointUnified: pointHit({ kind: "customVertex", planeId: "p1", pointIndex: 1 }),
    });
    vertex.open();
    expect(vertex.menu()!.items.map((i) => i.label)).toEqual(["Delete Point", "Delete Surface", "Add as Reference Line"]);
    vertex.click("Add as Reference Line");
    expect(addReferenceFromCustomPlane).toHaveBeenCalledWith("p1");
    expect(vertex.menu()).toBeNull();

    const circle = setup({
      customSearchPlanes: [{ id: "c1" }],
      addReferenceFromCustomPlane,
      findNearPointUnified: pointHit({ kind: "customCircle", planeId: "c1", handle: "rim" }),
    });
    circle.open();
    expect(circle.menu()!.items.map((i) => i.label)).toEqual(["Delete Circle", "Add as Reference Line"]);

    const edge = setup({
      customSearchPlanes: [LINE_PLANE],
      addReferenceFromCustomPlane,
      findNearEdgeUnified: edgeHit({ kind: "customPlane", planeId: "p1", insertIndex: 2, snapPoint: [20, 3] }),
    });
    edge.open();
    expect(edge.menu()!.items.map((i) => i.label)).toEqual(["Add Point", "Add as Reference Line"]);

    // Without the action (the result canvas) the item is not offered.
    const none = setup({
      customSearchPlanes: [LINE_PLANE],
      findNearPointUnified: pointHit({ kind: "customVertex", planeId: "p1", pointIndex: 1 }),
    });
    none.open();
    expect(none.menu()!.items.map((i) => i.label)).toEqual(["Delete Point", "Delete Surface"]);
  });
});
