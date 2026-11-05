import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { DEFAULT_PIEZO_LINE } from "./defaults";
import {
  canDeletePoint,
  canvasObjectLabel,
  canvasPointLabel,
  groupHasUnlocked,
  hasLocks,
  importedGeometryLocks,
  isObjectLocked,
  nextCycleIndex,
  normalizeLocks,
  remapLocks,
  sameObject,
  validSelection,
  withGroupLocked,
  withObjectLocked,
  withoutGeometryLocks,
} from "./canvas-selection";
import { isProjectDirty, markProjectClean } from "./unsaved";
import type { CanvasObjectRef, ModelLocks } from "./types";

const s = () => useAppStore.getState();
const EXT: CanvasObjectRef = { type: "exterior" };

function withObjects() {
  s().newProject();
  useAppStore.setState({
    coordinates: [
      [0, 0],
      [0, 10],
      [10, 10],
      [20, 5],
      [30, 5],
      [30, 0],
    ],
    coordinateExpressions: [],
    materialBoundaries: [
      { id: "b1", coordinates: [[0, 4], [30, 3]] },
      { id: "b2", coordinates: [[2, 2], [6, 2], [6, 4], [2, 2]] },
    ],
    piezometricLine: {
      ...DEFAULT_PIEZO_LINE,
      lines: [
        { id: "w1", name: "Line 1", color: "#00f", coordinates: [[0, 8], [10, 8], [30, 4]] },
        { id: "w2", name: "Line 2", color: "#00f", coordinates: [[0, 1], [30, 1]] },
      ],
      activeLineId: "w2",
    },
    udls: [{ id: "u1", magnitude: 10, x1: 2, x2: 8 }],
    lineLoads: [{ id: "l1", magnitude: 5, x: 25 }],
    customSearchPlanes: [
      { id: "c1", cx: 15, cy: 14, radius: 10 },
      { id: "p1", cx: 0, cy: 0, radius: 0, points: [[5, 8], [15, 2], [25, 4]] },
    ],
    analysisLimits: { enabled: true, entryLeftX: 1, entryRightX: 9, exitLeftX: 21, exitRightX: 29 },
  });
  useAppStore.temporal.getState().clear();
}

beforeEach(withObjects);
afterEach(() => s().newProject());

describe("locks", () => {
  it("lock and unlock single objects by id, the exterior and the limits by type", () => {
    let locks: ModelLocks = {};
    locks = withObjectLocked(locks, EXT, true);
    locks = withObjectLocked(locks, { type: "boundary", id: "b1" }, true);
    locks = withObjectLocked(locks, { type: "lineLoad", id: "l1" }, true);
    locks = withObjectLocked(locks, { type: "pile", id: "p" }, true);
    expect(locks).toEqual({ exterior: true, boundaries: ["b1"], loads: ["l1"], reinforcement: ["p"] });
    expect(isObjectLocked(locks, EXT)).toBe(true);
    expect(isObjectLocked(locks, { type: "boundary", id: "b1" })).toBe(true);
    expect(isObjectLocked(locks, { type: "boundary", id: "b2" })).toBe(false);
    expect(isObjectLocked(locks, { type: "udl", id: "l1" })).toBe(true); // one group for the loads
    locks = withObjectLocked(locks, { type: "boundary", id: "b1" }, false);
    locks = withObjectLocked(locks, EXT, false);
    expect(locks).toEqual({ loads: ["l1"], reinforcement: ["p"] });
    expect(hasLocks(locks)).toBe(true);
    expect(hasLocks({})).toBe(false);
  });

  it("lock a whole group, and know whether there is anything left to lock", () => {
    const locks = withGroupLocked({}, s(), "waterLines");
    expect(locks).toEqual({ waterLines: ["w1", "w2"] });
    expect(groupHasUnlocked(locks, s(), "waterLines")).toBe(false);
    expect(groupHasUnlocked(locks, s(), "boundaries")).toBe(true);
    expect(groupHasUnlocked(locks, s(), "reinforcement")).toBe(false); // none in the model
    expect(groupHasUnlocked({}, s(), "searchLimits")).toBe(true);
    expect(withGroupLocked({}, s(), "searchLimits")).toEqual({ searchLimits: true });
    expect(withGroupLocked({}, s(), "loads")).toEqual({ loads: ["u1", "l1"] });
  });

  it("mark an imported model's geometry, and drop the mark once the geometry is unlocked", () => {
    const locks = importedGeometryLocks(["b1", "b2"]);
    expect(locks).toEqual({ exterior: true, boundaries: ["b1", "b2"], fromImport: true });
    expect(withObjectLocked(withObjectLocked(locks, EXT, false), { type: "boundary", id: "b1" }, false)).toEqual({
      boundaries: ["b2"],
      fromImport: true,
    });
    expect(withoutGeometryLocks({ ...locks, loads: ["u1"] })).toEqual({ loads: ["u1"] });
    expect(importedGeometryLocks([])).toEqual({ exterior: true, fromImport: true });
  });

  it("read from a file: known keys of the right shape, ids of objects the model has", () => {
    expect(normalizeLocks(undefined)).toBeUndefined();
    expect(normalizeLocks([])).toBeUndefined();
    expect(normalizeLocks({ exterior: "yes", boundaries: [] })).toBeUndefined();
    expect(
      normalizeLocks(
        { exterior: true, boundaries: ["b1", 3, "gone"], waterLines: "w1", searchLimits: true, fromImport: true, other: 1 },
        { boundaries: new Set(["b1"]) },
      ),
    ).toEqual({ exterior: true, boundaries: ["b1"], searchLimits: true, fromImport: true });
    // The import mark alone, without locked geometry, is dropped.
    expect(normalizeLocks({ fromImport: true, loads: ["u1"] })).toEqual({ loads: ["u1"] });
  });

  it("follow a copied model's new ids", () => {
    expect(remapLocks(undefined, new Map())).toBeUndefined();
    expect(remapLocks({ exterior: true, boundaries: ["b1"], loads: ["u1", "x"] }, new Map([["b1", "B1"], ["u1", "U1"]]))).toEqual({
      exterior: true,
      boundaries: ["B1"],
      loads: ["U1", "x"],
    });
  });
});

describe("objects and their points", () => {
  it("name objects as the windows number them", () => {
    expect(canvasObjectLabel(s(), EXT)).toBe("Exterior boundary");
    expect(canvasObjectLabel(s(), { type: "boundary", id: "b2" })).toBe("Material boundary 2");
    expect(canvasObjectLabel(s(), { type: "waterLine", id: "w1" })).toBe("Water line 1");
    expect(canvasObjectLabel(s(), { type: "udl", id: "u1" })).toBe("Distributed load 1");
    expect(canvasObjectLabel(s(), { type: "lineLoad", id: "l1" })).toBe("Line load 1");
    expect(canvasObjectLabel(s(), { type: "searchLimits" })).toBe("Search limits");
    // Custom surfaces as the result numbers them: circles first.
    expect(canvasObjectLabel(s(), { type: "customPlane", id: "c1" })).toBe("Custom circle 1");
    expect(canvasObjectLabel(s(), { type: "customPlane", id: "p1" })).toBe("Custom surface 2");
    expect(canvasPointLabel(2)).toBe("point 3");
    expect(canvasPointLabel("centre")).toBe("center");
    expect(canvasPointLabel("x1")).toBe("left end");
  });

  it("keep a selection only while its object and point exist", () => {
    expect(validSelection(s(), { object: { type: "boundary", id: "b1" }, point: 1 })).toEqual({ object: { type: "boundary", id: "b1" }, point: 1 });
    expect(validSelection(s(), { object: { type: "boundary", id: "gone" }, point: null })).toBeNull();
    expect(validSelection(s(), { object: { type: "boundary", id: "b1" }, point: 5 })).toEqual({ object: { type: "boundary", id: "b1" }, point: null });
    expect(validSelection(s(), { object: { type: "customPlane", id: "c1" }, point: "rim" })?.point).toBe("rim");
    expect(validSelection(s(), { object: { type: "customPlane", id: "p1" }, point: "rim" })?.point).toBeNull();
    expect(validSelection(s(), { object: { type: "udl", id: "u1" }, point: "x2" })?.point).toBe("x2");
    expect(validSelection(s(), { object: { type: "searchLimits" }, point: "exitLeftX" })?.point).toBe("exitLeftX");
    useAppStore.setState({ analysisLimits: { ...s().analysisLimits, enabled: false } });
    expect(validSelection(s(), { object: { type: "searchLimits" }, point: null })).toBeNull();
  });

  it("delete points only above each object's minimum, as the context menu", () => {
    expect(canDeletePoint(s(), EXT, 1)).toBe(true);
    expect(canDeletePoint(s(), EXT, null)).toBe(false);
    expect(canDeletePoint(s(), { type: "waterLine", id: "w1" }, 1)).toBe(true);
    expect(canDeletePoint(s(), { type: "waterLine", id: "w2" }, 1)).toBe(false);
    expect(canDeletePoint(s(), { type: "boundary", id: "b1" }, 0)).toBe(false); // open: keeps two
    expect(canDeletePoint(s(), { type: "boundary", id: "b2" }, 1)).toBe(false); // closed: keeps a triangle
    expect(canDeletePoint(s(), { type: "customPlane", id: "p1" }, 1)).toBe(true);
    expect(canDeletePoint(s(), { type: "udl", id: "u1" }, "x1")).toBe(false);
  });

  it("cycle through overlapping objects after the selected one", () => {
    const cands: CanvasObjectRef[] = [EXT, { type: "boundary", id: "b1" }, { type: "waterLine", id: "w1" }];
    expect(nextCycleIndex(cands, null)).toBe(0);
    expect(nextCycleIndex(cands, EXT)).toBe(1);
    expect(nextCycleIndex(cands, { type: "waterLine", id: "w1" })).toBe(0);
    expect(nextCycleIndex(cands, { type: "udl", id: "u1" })).toBe(0);
    expect(sameObject({ type: "boundary", id: "b1" }, { type: "boundary", id: "b2" })).toBe(false);
  });
});

describe("the selection in the store", () => {
  it("selects an object and a point, keeps the older selection fields in step, and records no undo step", () => {
    s().selectCanvasObject(EXT, 2);
    expect(s().canvasSelection).toEqual({ object: EXT, point: 2 });
    expect(s().selectedPointIndex).toBe(2);
    s().selectCanvasPoint(null);
    expect(s().canvasSelection).toEqual({ object: EXT, point: null });
    expect(s().selectedPointIndex).toBeNull();
    s().selectCanvasObject({ type: "customPlane", id: "c1" }, "centre");
    expect(s().selectedCustomPlaneId).toBe("c1");
    s().selectCanvasObject({ type: "boundary", id: "b2" });
    expect(s().selectedMaterialBoundaryId).toBe("b2");
    expect(s().selectedCustomPlaneId).toBeNull();
    // The boundary the boundaries window shows stays when another object is selected.
    s().selectCanvasObject(EXT);
    expect(s().selectedMaterialBoundaryId).toBe("b2");
    s().clearCanvasSelection();
    expect(s().canvasSelection).toBeNull();
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("makes a selected water line the active one, without an undo step", () => {
    s().selectCanvasObject({ type: "waterLine", id: "w1" }, 1);
    expect(s().piezometricLine.activeLineId).toBe("w1");
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("keeps the cycle position until another selection", () => {
    s().selectCanvasObject(EXT, null, { position: 2, count: 3 });
    expect(s().canvasSelectionCycle).toEqual({ position: 2, count: 3 });
    s().selectCanvasPoint(1);
    expect(s().canvasSelectionCycle).toEqual({ position: 2, count: 3 });
    s().selectCanvasObject({ type: "boundary", id: "b1" });
    expect(s().canvasSelectionCycle).toBeNull();
  });

  it("routes the older setters through the selection", () => {
    s().setSelectedPoint(3);
    expect(s().canvasSelection).toEqual({ object: EXT, point: 3 });
    s().setSelectedPoint(null);
    expect(s().canvasSelection).toEqual({ object: EXT, point: null });
    s().setSelectedCustomPlane("p1");
    expect(s().canvasSelection).toEqual({ object: { type: "customPlane", id: "p1" }, point: null });
    s().setSelectedCustomPlane(null);
    expect(s().canvasSelection).toBeNull();
  });

  it("drops a selection whose object is deleted (by a window or by undo), and a deleted point", () => {
    s().selectCanvasObject({ type: "udl", id: "u1" }, "x1");
    s().removeUdl("u1");
    expect(s().canvasSelection).toBeNull();
    s().selectCanvasObject(EXT, 5);
    s().removeCoordinate(5);
    expect(s().canvasSelection).toEqual({ object: EXT, point: null });
    s().addMaterialBoundary([
      [0, 6],
      [30, 6],
    ]);
    const id = s().materialBoundaries.at(-1)!.id;
    s().selectCanvasObject({ type: "boundary", id });
    useAppStore.temporal.getState().undo();
    expect(s().canvasSelection).toBeNull();
  });

  it("starts each model with nothing selected", () => {
    s().selectCanvasObject(EXT, 1);
    s().addModel("Other");
    expect(s().canvasSelection).toBeNull();
    expect(s().selectedPointIndex).toBeNull();
  });
});

describe("locks in the store", () => {
  it("are undoable steps, kept with each model", () => {
    s().setObjectLocked(EXT, true);
    s().lockAllOfGroup("boundaries");
    expect(s().locks).toEqual({ exterior: true, boundaries: ["b1", "b2"] });
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(2);
    useAppStore.temporal.getState().undo();
    expect(s().locks).toEqual({ exterior: true });
    useAppStore.temporal.getState().redo();
    const first = s().activeModelId;
    s().addModel("Other");
    expect(s().locks).toEqual({});
    s().switchModel(first);
    expect(s().locks).toEqual({ exterior: true, boundaries: ["b1", "b2"] });
    s().unlockAll();
    expect(s().locks).toEqual({});
    expect(s().models.find((m) => m.id === first)!.locks).toBeUndefined();
  });

  it("lock nothing for a group the model has none of", () => {
    s().lockAllOfGroup("reinforcement");
    expect(s().locks).toEqual({});
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("count as an unsaved change, and no locks as none", () => {
    markProjectClean(s());
    s().setObjectLocked({ type: "waterLine", id: "w1" }, true);
    expect(isProjectDirty(s())).toBe(true);
    s().setObjectLocked({ type: "waterLine", id: "w1" }, false);
    expect(isProjectDirty(s())).toBe(false);
  });

  it("are copied with a duplicated model, on its own ids", () => {
    s().setModelLocks({ exterior: true, boundaries: ["b1"], loads: ["u1"], customSurfaces: ["p1"], waterLines: ["w2"] });
    s().saveCurrentModel();
    s().duplicateModel(s().activeModelId);
    const copy = s();
    const bnd = copy.materialBoundaries[0].id;
    expect(bnd).not.toBe("b1");
    expect(copy.locks).toEqual({
      exterior: true,
      boundaries: [bnd],
      loads: [copy.udls[0].id],
      customSurfaces: [copy.customSearchPlanes[1].id],
      waterLines: [copy.piezometricLine.lines[1].id],
    });
  });

  it("unlock the imported geometry from the status bar's Unlock", () => {
    s().setModelLocks({ ...importedGeometryLocks(["b1", "b2"]), loads: ["u1"] });
    s().unlockGeometry();
    expect(s().locks).toEqual({ loads: ["u1"] });
  });
});
