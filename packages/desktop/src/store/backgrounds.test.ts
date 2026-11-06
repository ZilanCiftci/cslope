/**
 * The active model's drawings in the store: place, change, remove, order;
 * each an undo step that makes the project unsaved; kept per model and
 * saved in the project file (one attachment for a drawing two models place).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { performRedo, performUndo } from "./selectors";
import { isProjectDirty, markProjectClean } from "./unsaved";
import { adoptProjectAssets, buildProjectArchive, readProject } from "../features/project/cslp";
import { openZip } from "../utils/zip";
import type { BackgroundImage } from "./types";
import { validSelection } from "./canvas-selection";

const s = () => useAppStore.getState();
const history = () => useAppStore.temporal.getState();

const placement = (id: string, over: Partial<BackgroundImage> = {}): BackgroundImage => ({
  id,
  assetId: "sheet",
  name: `Drawing ${id}`,
  page: 1,
  crop: { x0: 0, y0: 0, x1: 100, y1: 50 },
  calibration: { mode: "scale", points: [{ source: [0, 50], model: [0, 0] }], scale: { metersPerUnit: 0.1, unit: "pt" } },
  transform: { a: 0.1, b: 0, c: 0, d: -0.1, e: 0, f: 5 },
  opacity: 0.5,
  visible: true,
  order: 0,
  ...over,
});

const PDF = new TextEncoder().encode("%PDF-1.4 stand-in");

beforeEach(() => {
  s().newProject();
  history().clear();
  markProjectClean(s());
  adoptProjectAssets([{ id: "sheet", mime: "application/pdf", originalName: "sheet.pdf", addedAt: "2026-11-05T00:00:00.000Z", data: () => PDF }]);
});

describe("placing a drawing", () => {
  it("adds it locked, last in the order, as one undo step that makes the project unsaved", () => {
    s().addBackground(placement("d1"));
    s().addBackground(placement("d2", { order: 7 }));
    expect(s().backgrounds.map((b) => [b.id, b.order])).toEqual([
      ["d1", 0],
      ["d2", 1],
    ]);
    expect(s().locks.backgrounds).toEqual(["d1", "d2"]);
    expect(s().models.find((m) => m.id === s().activeModelId)?.backgrounds).toHaveLength(2);
    expect(isProjectDirty(s())).toBe(true);
    expect(history().pastStates).toHaveLength(2);
    performUndo();
    expect(s().backgrounds.map((b) => b.id)).toEqual(["d1"]);
    expect(s().locks.backgrounds).toEqual(["d1"]);
    performUndo();
    expect(s().backgrounds).toEqual([]);
    expect(isProjectDirty(s())).toBe(false);
    performRedo();
    expect(s().backgrounds.map((b) => b.id)).toEqual(["d1"]);
  });

  it("changes opacity (clamped), visibility, name and calibration, each undoable", () => {
    s().addBackground(placement("d1"));
    s().updateBackground("d1", { opacity: 1.7 });
    expect(s().backgrounds[0].opacity).toBe(1);
    s().updateBackground("d1", { visible: false });
    s().updateBackground("d1", { name: "Section A-A" });
    const recalibrated = { ...placement("d1").transform, e: 3 };
    s().updateBackground("d1", { transform: recalibrated, calibration: { mode: "points", points: [] } });
    expect(s().backgrounds[0]).toMatchObject({ opacity: 1, visible: false, name: "Section A-A", transform: recalibrated });
    performUndo();
    expect(s().backgrounds[0].transform.e).toBe(0);
    performUndo();
    expect(s().backgrounds[0].name).toBe("Drawing d1");
    performUndo();
    expect(s().backgrounds[0].visible).toBe(true);
    performUndo();
    expect(s().backgrounds[0].opacity).toBe(0.5);
    s().updateBackground("missing", { opacity: 0 });
    expect(s().backgrounds).toHaveLength(1);
  });

  it("removes it with its lock; the selection follows", () => {
    s().addBackground(placement("d1"));
    s().selectCanvasObject({ type: "background", id: "d1" });
    expect(s().canvasSelection?.object).toEqual({ type: "background", id: "d1" });
    s().removeBackground("d1");
    expect(s().backgrounds).toEqual([]);
    expect(s().locks.backgrounds).toBeUndefined();
    expect(s().canvasSelection).toBeNull();
    expect(validSelection(s(), { object: { type: "background", id: "d1" }, point: null })).toBeNull();
    performUndo();
    expect(s().backgrounds.map((b) => b.id)).toEqual(["d1"]);
    expect(s().locks.backgrounds).toEqual(["d1"]);
  });

  it("moves one up or down in the drawing order", () => {
    for (const id of ["a", "b", "c"]) s().addBackground(placement(id));
    s().moveBackground("a", "up");
    const order = () => [...s().backgrounds].sort((x, y) => x.order - y.order).map((b) => b.id);
    expect(order()).toEqual(["b", "a", "c"]);
    s().moveBackground("c", "up");
    expect(order()).toEqual(["b", "a", "c"]);
    s().moveBackground("b", "down");
    expect(order()).toEqual(["b", "a", "c"]);
    s().moveBackground("c", "down");
    expect(order()).toEqual(["b", "c", "a"]);
  });

  it("moves one to a place in the drawing order (a drop in the models tree)", () => {
    for (const id of ["a", "b", "c"]) s().addBackground(placement(id));
    const order = () => [...s().backgrounds].sort((x, y) => x.order - y.order).map((b) => b.id);
    s().moveBackgroundTo("a", 2);
    expect(order()).toEqual(["b", "c", "a"]);
    s().moveBackgroundTo("a", 0);
    expect(order()).toEqual(["a", "b", "c"]);
    s().moveBackgroundTo("c", 9);
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("locks and unlocks like the model's objects", () => {
    s().addBackground(placement("d1"));
    s().setObjectLocked({ type: "background", id: "d1" }, false);
    expect(s().locks.backgrounds).toBeUndefined();
    s().lockAllOfGroup("backgrounds");
    expect(s().locks.backgrounds).toEqual(["d1"]);
    s().unlockAll();
    expect(s().locks).toEqual({});
  });
});

describe("drawings per model and in the project file", () => {
  it("are kept per model over a switch", () => {
    const first = s().activeModelId;
    s().addBackground(placement("d1"));
    s().addModel();
    expect(s().backgrounds).toEqual([]);
    s().addBackground(placement("d2", { page: 2 }));
    s().switchModel(first);
    expect(s().backgrounds.map((b) => b.id)).toEqual(["d1"]);
  });

  it("write the shared file once and read every model's placements back", async () => {
    const first = s().activeModelId;
    s().addBackground(placement("d1"));
    s().addModel();
    s().addBackground(placement("d2", { page: 2, crop: { x0: 10, y0: 10, x1: 90, y1: 40 } }));
    s().switchModel(first);
    s().saveCurrentModel();
    const bytes = await buildProjectArchive(s());
    const names = openZip(bytes).entries().map((e) => e.name);
    expect(names.filter((n) => n.startsWith("assets/"))).toEqual(["assets/index.json", "assets/sheet.pdf"]);
    expect(names.filter((n) => n.endsWith("backgrounds.json"))).toHaveLength(2);
    const read = await readProject(bytes);
    const [m1, m2] = read.file.models;
    expect(m1.backgrounds?.map((b) => b.id)).toEqual(["d1"]);
    expect(m1.locks?.backgrounds).toEqual(["d1"]);
    expect(m2.backgrounds?.[0]).toMatchObject({ id: "d2", page: 2, crop: { x0: 10, y0: 10, x1: 90, y1: 40 } });
    // loaded: the active model's drawings in the store
    adoptProjectAssets(read.assets);
    s().loadProject(read.file);
    expect(s().backgrounds.map((b) => b.id)).toEqual(["d1"]);
  });

  it("a drawing removed from every model is not saved", async () => {
    s().addBackground(placement("d1"));
    s().removeBackground("d1");
    s().saveCurrentModel();
    const names = openZip(await buildProjectArchive(s())).entries().map((e) => e.name);
    expect(names.some((n) => n.startsWith("assets/"))).toBe(false);
  });
});
