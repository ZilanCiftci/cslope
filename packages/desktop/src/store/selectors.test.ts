import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { getActiveViewport, performUndo, performRedo } from "./selectors";

function resetForTests() {
  // Clear temporal history
  useAppStore.temporal.getState().clear();

  useAppStore.setState({
    mode: "edit",
    editViewOffset: [0, 0],
    editViewScale: 1,
    resultViewOffset: [5, 5],
    resultViewScale: 2,
    runState: "idle",
    progress: 0,
    result: null,
    errorMessage: null,
  });

  // Clear again after setState to remove the setState itself from history
  useAppStore.temporal.getState().clear();
}

describe("selectors", () => {
  beforeEach(resetForTests);

  // ── getActiveViewport ────────────────────────────────────────

  it("returns edit viewport in edit mode", () => {
    useAppStore.setState({
      mode: "edit",
      editViewOffset: [10, 20],
      editViewScale: 3,
    });
    const { viewOffset, viewScale } = getActiveViewport(useAppStore.getState());
    expect(viewOffset).toEqual([10, 20]);
    expect(viewScale).toBe(3);
  });

  it("returns result viewport in result mode", () => {
    useAppStore.setState({
      mode: "result",
      resultViewOffset: [30, 40],
      resultViewScale: 5,
    });
    const { viewOffset, viewScale } = getActiveViewport(useAppStore.getState());
    expect(viewOffset).toEqual([30, 40]);
    expect(viewScale).toBe(5);
  });

  // ── performUndo / performRedo ────────────────────────────────

  it("performUndo reverts the last state change", () => {
    const original = useAppStore.getState().coordinates.slice();
    // Make a change that gets captured by temporal
    useAppStore.getState().addCoordinate([99, 99]);
    expect(useAppStore.getState().coordinates).not.toEqual(original);

    performUndo();
    expect(useAppStore.getState().coordinates).toEqual(original);
  });

  it("performRedo reapplies an undone change", () => {
    useAppStore.getState().addCoordinate([99, 99]);
    const withNew = useAppStore.getState().coordinates.slice();

    performUndo();
    expect(useAppStore.getState().coordinates).not.toEqual(withNew);

    performRedo();
    expect(useAppStore.getState().coordinates).toEqual(withNew);
  });

  it("performUndo resets analysis when inputs changed", () => {
    useAppStore.setState({
      runState: "done",
      result: { minFOS: 1.2 } as never,
    });

    // Make a coordinate change (analysis-affecting)
    useAppStore.getState().addCoordinate([50, 50]);
    // Set analysis back to done
    useAppStore.setState({
      runState: "done",
      result: { minFOS: 1.2 } as never,
    });

    performUndo();
    // Since coordinates changed, analysis should be reset
    expect(useAppStore.getState().runState).toBe("idle");
    expect(useAppStore.getState().result).toBeNull();
  });

  it("performUndo is a no-op when there is nothing to undo", () => {
    const before = useAppStore.getState().coordinates.slice();
    performUndo(); // should not throw
    expect(useAppStore.getState().coordinates).toEqual(before);
  });

  it("performRedo is a no-op when there is nothing to redo", () => {
    const before = useAppStore.getState().coordinates.slice();
    performRedo(); // should not throw
    expect(useAppStore.getState().coordinates).toEqual(before);
  });
});
