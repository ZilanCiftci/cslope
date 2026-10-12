import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import type { ModelEntry } from "./types";

const store = () => useAppStore.getState();

beforeEach(() => {
  store().newProject();
});

describe("duplicating a sparse model (as read from an older file)", () => {
  it("fills in empty lists and leaves absent views absent", () => {
    const src = store().models[0];
    const sparse = {
      ...src,
      id: "sparse",
      coordinateExpressions: [{ x: "1" }, null],
      parameters: undefined,
      reinforcements: undefined,
      piles: undefined,
      customSearchPlanes: undefined,
      customPlanesOnly: undefined,
      editViewOffset: undefined,
      editViewScale: undefined,
      resultViewOffset: undefined,
      resultViewScale: undefined,
      viewOffset: undefined,
      viewScale: undefined,
      resultViewSettings: undefined,
      materialBoundaries: [
        { id: "b", coordinates: [[0, 1], [5, 1]], coordinateExpressions: [null, { y: "2" }] },
      ],
      piezometricLine: {
        ...src.piezometricLine,
        lines: [{ id: "w", name: "W", coordinates: [[0, 1], [9, 1]], coordinateExpressions: [null] }],
        activeLineId: null,
        materialAssignment: { [src.materials[0].id]: "w", orphan: "other" },
      },
      runState: "done",
      result: { minFOS: 1.4 },
    } as unknown as ModelEntry;
    useAppStore.setState({ models: [src, sparse] });

    store().duplicateModel("sparse");
    const copy = store().models[2];
    expect(store().activeModelId).toBe(copy.id);
    expect(copy.coordinateExpressions).toEqual([{ x: "1" }, {}]);
    expect(copy.parameters).toEqual([]);
    expect(copy.reinforcements).toEqual([]);
    expect(copy.piles).toEqual([]);
    expect(copy.customSearchPlanes).toEqual([]);
    expect(copy.customPlanesOnly).toBe(false);
    expect(copy.editViewOffset).toBeUndefined();
    expect(copy.resultViewOffset).toBeUndefined();
    expect(copy.resultViewSettings).toBeUndefined();
    expect(copy.materialBoundaries[0].coordinateExpressions).toEqual([{}, { y: "2" }]);
    expect(copy.materialBoundaries[0].id).not.toBe("b");
    const line = copy.piezometricLine.lines[0];
    expect(line.coordinateExpressions).toEqual([{}]);
    expect(copy.piezometricLine.activeLineId).toBeNull();
    expect(copy.piezometricLine.mainLineId).toBeUndefined();
    // Assignments follow the new ids; unknown ones are kept as they were.
    expect(copy.piezometricLine.materialAssignment).toEqual({
      [copy.materials[0].id]: line.id,
      orphan: "other",
    });
    // A copy starts without results.
    expect(copy).toMatchObject({ runState: "idle", result: null, mode: "edit" });
  });
});
