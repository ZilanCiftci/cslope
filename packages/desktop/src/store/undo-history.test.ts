import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { performUndo } from "./selectors";

describe("undo history across models", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.temporal.getState().clear();
  });

  it("does not let Undo write the previous model into a newly added model", () => {
    const store = useAppStore.getState();
    const modelA = store.activeModelId;
    const [x, y] = store.coordinates[1];
    store.setCoordinate(1, [x, y + 42]);
    const editedA = useAppStore.getState().coordinates;

    store.addModel("Model B");
    const s1 = useAppStore.getState();
    const modelB = s1.activeModelId;
    const coordsB = s1.coordinates;
    expect(modelB).not.toBe(modelA);

    performUndo();

    const s2 = useAppStore.getState();
    expect(s2.activeModelId).toBe(modelB);
    expect(s2.coordinates).toEqual(coordsB);
    s2.switchModel(modelA);
    expect(useAppStore.getState().coordinates).toEqual(editedA);
  });

  it("still undoes edits made within one model", () => {
    const store = useAppStore.getState();
    const before = store.coordinates;
    const [x, y] = before[1];
    store.setCoordinate(1, [x + 3, y]);
    performUndo();
    expect(useAppStore.getState().coordinates).toEqual(before);
  });
});
