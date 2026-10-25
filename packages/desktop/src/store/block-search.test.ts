import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { buildSlopeDTO, getAnalysisInputSignature } from "./helpers";
import { parseProjectFile, serializeProject } from "./persistence";

function roundTrip() {
  useAppStore.getState().saveCurrentModel();
  const json = JSON.stringify(serializeProject(useAppStore.getState()));
  return parseProjectFile(json).models[0];
}

describe("block search objects in the store", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("adds, edits and removes objects", () => {
    const s = useAppStore.getState();
    s.addBlockSearchObject();
    s.addBlockSearchObject();
    const [a, b] = useAppStore.getState().blockSearchObjects;
    s.updateBlockSearchObject(a.id, [[1, 2], [3, 2]]);
    s.removeBlockSearchObject(b.id);
    expect(useAppStore.getState().blockSearchObjects).toEqual([{ id: a.id, points: [[1, 2], [3, 2]] }]);
  });

  it("sends the objects to the engine only for a block search", () => {
    const s = useAppStore.getState();
    s.addBlockSearchObject();
    s.addBlockSearchObject();
    const [a] = useAppStore.getState().blockSearchObjects;
    s.updateBlockSearchObject(a.id, [[1, 2], [3, 2]]);
    // The circular search ignores them.
    expect(buildSlopeDTO(useAppStore.getState()).blockSearchObjects).toBeUndefined();
    s.setOptions({ searchMethod: "block" });
    // The empty object (still being entered) is left out.
    expect(buildSlopeDTO(useAppStore.getState()).blockSearchObjects).toEqual([{ points: [[1, 2], [3, 2]] }]);
  });

  it("invalidates the result signature when an object changes", () => {
    const s = useAppStore.getState();
    s.addBlockSearchObject();
    const before = getAnalysisInputSignature(useAppStore.getState());
    s.updateBlockSearchObject(useAppStore.getState().blockSearchObjects[0].id, [[5, 5]]);
    expect(getAnalysisInputSignature(useAppStore.getState())).not.toBe(before);
  });

  it("keeps objects, method and angle ranges in the project file", () => {
    const s = useAppStore.getState();
    s.addBlockSearchObject();
    s.updateBlockSearchObject(useAppStore.getState().blockSearchObjects[0].id, [[0, 0], [4, 0], [4, 1]]);
    s.setOptions({ searchMethod: "block", blockActiveAngle: [50, 60], blockPassiveAngle: [20, 30] });
    const loaded = roundTrip();
    expect(loaded.blockSearchObjects?.map((o) => o.points)).toEqual([[[0, 0], [4, 0], [4, 1]]]);
    expect(loaded.options.searchMethod).toBe("block");
    expect(loaded.options.blockActiveAngle).toEqual([50, 60]);
    expect(loaded.options.blockPassiveAngle).toEqual([20, 30]);
  });

  it("drops invalid angle ranges and reads old files without objects", () => {
    const file = serializeProject(useAppStore.getState());
    const raw = JSON.parse(JSON.stringify(file));
    delete raw.models[0].blockSearchObjects;
    raw.models[0].options.searchMethod = "spiral";
    raw.models[0].options.blockActiveAngle = [70, 40];
    raw.models[0].options.blockPassiveAngle = [0, 30];
    const loaded = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(loaded.blockSearchObjects ?? []).toEqual([]);
    expect(loaded.options.searchMethod).toBeUndefined();
    expect(loaded.options.blockActiveAngle).toBeUndefined();
    expect(loaded.options.blockPassiveAngle).toBeUndefined();
  });

  it("copies objects with new ids when a model is duplicated", () => {
    const s = useAppStore.getState();
    s.addBlockSearchObject();
    s.updateBlockSearchObject(useAppStore.getState().blockSearchObjects[0].id, [[1, 1]]);
    s.saveCurrentModel();
    const sourceId = useAppStore.getState().activeModelId;
    useAppStore.getState().duplicateModel(sourceId);
    const models = useAppStore.getState().models;
    const copy = models[models.length - 1];
    expect(copy.blockSearchObjects?.map((o) => o.points)).toEqual([[[1, 1]]]);
    expect(copy.blockSearchObjects?.[0].id).not.toBe(models[0].blockSearchObjects?.[0].id);
  });
});
