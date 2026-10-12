import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";
import { isProjectDirty, markProjectClean } from "./unsaved";
import type { ModelEntry } from "./types";

const store = () => useAppStore.getState();
const entry = (id: string) => store().models.find((m) => m.id === id)!;
const dirty = () => isProjectDirty(store());

/** Two models, A active. */
function twoModels() {
  const a = store().activeModelId;
  store().addModel("B");
  const b = store().activeModelId;
  store().switchModel(a);
  return { a, b };
}

const MINIMAL = (id: string, name: string) => ({
  id,
  name,
  coordinates: [
    [0, 0],
    [0, 10],
    [20, 10],
    [30, 0],
  ],
  materials: [
    {
      id: `${id}-mat`,
      name: "Clay",
      color: "#abc",
      model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 25 },
    },
  ],
});

beforeEach(() => {
  store().newProject();
});

describe("unsaved-changes tracking", () => {
  it("a new project is clean; an edit makes it dirty; saving makes it clean", () => {
    expect(dirty()).toBe(false);
    store().renameModel(store().activeModelId, "Renamed");
    expect(dirty()).toBe(true);
    markProjectClean(store());
    expect(dirty()).toBe(false);
  });

  it("view changes, mode switches and analysis results are not unsaved changes", () => {
    useAppStore.setState({
      mode: "result",
      runState: "done",
      progress: 1,
      result: { minFOS: 1.2 } as never,
      editViewOffset: [5, 5],
      editViewScale: 3,
    });
    store().saveCurrentModel();
    expect(dirty()).toBe(false);
  });

  it("switching between the models of an opened file does not dirty it", () => {
    const file = parseProjectFile(
      JSON.stringify({ version: 3, models: [MINIMAL("a", "A"), MINIMAL("b", "B")] }),
    );
    store().loadProject(file);
    expect(dirty()).toBe(false);
    store().switchModel("b");
    expect(dirty()).toBe(false);
    store().switchModel("a");
    expect(dirty()).toBe(false);
  });

  it("an older file without optional arrays is clean after opening", () => {
    const file = parseProjectFile(JSON.stringify({ version: 3, models: [MINIMAL("a", "A")] }));
    // As in a file written before parameters and piles existed.
    const legacy = file.models.map((m) => {
      const copy = { ...m } as Partial<ModelEntry>;
      delete copy.parameters;
      delete copy.coordinateExpressions;
      delete copy.reinforcements;
      delete copy.piles;
      return copy as ModelEntry;
    });
    store().loadProject({ ...file, models: legacy });
    expect(dirty()).toBe(false);
  });

  it("reordering and deleting models are unsaved changes", () => {
    const { a, b } = twoModels();
    markProjectClean(store());
    store().reorderModels(b, a);
    expect(store().models.map((m) => m.id)).toEqual([b, a]);
    expect(dirty()).toBe(true);
    markProjectClean(store());
    store().deleteModel(b);
    expect(dirty()).toBe(true);
  });

  it("a save/open round trip of an edited project is clean", () => {
    twoModels();
    store().setOptions({ slices: 40 });
    store().saveCurrentModel();
    const reopened = parseProjectFile(
      JSON.stringify(serializeProject(store())),
    );
    store().loadProject(reopened);
    expect(dirty()).toBe(false);
    expect(store().options.slices).toBe(40);
  });
});

describe("model list actions", () => {
  it("reorderModels: before/after, no-ops and unknown ids", () => {
    const { a, b } = twoModels();
    store().addModel("C");
    const c = store().activeModelId;
    const order = () => store().models.map((m) => m.id);
    expect(order()).toEqual([a, b, c]);

    store().reorderModels(a, c, "after");
    expect(order()).toEqual([b, c, a]);
    store().reorderModels(a, b, "before");
    expect(order()).toEqual([a, b, c]);

    const before = store().models;
    store().reorderModels(a, a);
    store().reorderModels("nope", a);
    store().reorderModels(a, "nope");
    // Dropping right before itself or right after its predecessor.
    store().reorderModels(b, c, "before");
    store().reorderModels(b, a, "after");
    expect(store().models).toBe(before);
  });

  it("deleteModel: never the last model; deleting another keeps the active one", () => {
    const only = store().activeModelId;
    store().deleteModel(only);
    expect(store().models).toHaveLength(1);

    const { a, b } = twoModels();
    store().deleteModel(b);
    expect(store().activeModelId).toBe(a);
    expect(store().models.map((m) => m.id)).toEqual([a]);
  });

  it("deleting the active model switches to the first remaining one", () => {
    const { a, b } = twoModels();
    store().switchModel(b);
    store().deleteModel(b);
    expect(store().activeModelId).toBe(a);
  });

  it("switchModel to an unknown id changes nothing", () => {
    const before = store().activeModelId;
    store().switchModel("missing");
    expect(store().activeModelId).toBe(before);
  });

  it("updateModelProjectInfo updates the flat state only for the active model", () => {
    const { a, b } = twoModels();
    const info = { ...store().projectInfo, title: "Other" };
    store().updateModelProjectInfo(b, info);
    expect(entry(b).projectInfo?.title).toBe("Other");
    expect(store().projectInfo.title).not.toBe("Other");
    store().updateModelProjectInfo(a, { ...info, title: "Mine" });
    expect(store().projectInfo.title).toBe("Mine");
    store().setProjectInfo({ author: "Z" });
    expect(store().projectInfo).toMatchObject({ title: "Mine", author: "Z" });
    expect(entry(a).projectInfo).toMatchObject({ title: "Mine", author: "Z" });
  });

  it("duplicating copies the legacy single view and the locked result view", () => {
    const a = store().activeModelId;
    useAppStore.setState((s) => ({
      models: s.models.map((m) =>
        m.id === a
          ? {
              ...m,
              viewOffset: [1, 2] as [number, number],
              viewScale: 4,
            }
          : m,
      ),
    }));
    useAppStore.setState({
      editViewOffset: undefined,
      editViewScale: undefined,
      resultViewOffset: undefined,
      resultViewScale: undefined,
      resultViewSettings: {
        ...store().resultViewSettings,
        viewLock: { bottomLeft: [0, 0], topRight: [10, 10] } as never,
      },
    });
    store().duplicateModel(a);
    const copy = store().models[1];
    expect(store().activeModelId).toBe(copy.id);
    expect(copy.name).toMatch(/\(copy\)$/);
    expect(copy.editViewOffset).toEqual([1, 2]);
    expect(copy.resultViewOffset).toEqual([1, 2]);
    expect(copy.editViewScale).toBe(4);
    expect(copy.resultViewScale).toBe(4);
    const lock = copy.resultViewSettings!.viewLock!;
    expect(lock.bottomLeft).toEqual([0, 0]);
    expect(lock.bottomLeft).not.toBe(entry(a).resultViewSettings!.viewLock!.bottomLeft);
  });

  it("duplicating remaps piezometric material assignments and the main line", () => {
    const a = store().activeModelId;
    store().addPiezoLine();
    store().addPiezoLine();
    const lines = store().piezometricLine.lines;
    const matId = store().materials[0].id;
    store().setPiezoMaterialAssignment(matId, lines[1].id);
    store().setPiezoMainLine(lines[1].id);
    store().duplicateModel(a);
    const copy = store().models[1].piezometricLine;
    const copyMat = store().models[1].materials[0].id;
    expect(copyMat).not.toBe(matId);
    expect(copy.lines.map((l) => l.id)).not.toContain(lines[1].id);
    expect(copy.materialAssignment[copyMat]).toBe(copy.lines[1].id);
    expect(copy.mainLineId).toBe(copy.lines[1].id);
    expect(copy.activeLineId === null || copy.lines.some((l) => l.id === copy.activeLineId)).toBe(true);
  });

  it("duplicating an unknown model does nothing", () => {
    const n = store().models.length;
    store().duplicateModel("missing");
    expect(store().models).toHaveLength(n);
  });

  it("loadProject ignores an empty project and falls back to the first model", () => {
    const before = store().models;
    store().loadProject({ activeModelId: "x", models: [] });
    expect(store().models).toBe(before);

    const file = parseProjectFile(
      JSON.stringify({ version: 3, models: [MINIMAL("a", "A"), MINIMAL("b", "B")] }),
    );
    store().loadProject({ ...file, activeModelId: "missing" });
    expect(store().activeModelId).toBe("a");
    // No saved zoom: fit the drawing to the screen.
    expect(store()._pendingFitToScreen).toBe(true);
  });

  it("loadProject keeps a saved zoom", () => {
    const file = parseProjectFile(
      JSON.stringify({ version: 3, models: [{ ...MINIMAL("a", "A"), editViewScale: 2 }] }),
    );
    store().clearPendingFitToScreen();
    store().loadProject(file);
    expect(store()._pendingFitToScreen).toBe(false);
    expect(store().editViewScale).toBe(2);
  });

  it("loads the Lovö example models as a clean project", () => {
    store().loadLovoModels();
    expect(store().models.length).toBeGreaterThan(0);
    expect(store().activeModelId).toBe(store().models[0].id);
    expect(store()._pendingFitToScreen).toBe(true);
    expect(dirty()).toBe(false);
  });
});
