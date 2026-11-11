import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";

function roundTrip() {
  useAppStore.getState().saveCurrentModel();
  const json = JSON.stringify(serializeProject(useAppStore.getState()));
  return parseProjectFile(json).models[0];
}

describe("project file round trip", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("keeps grid spacing, minor ticks and the view mode", () => {
    const s = useAppStore.getState();
    useAppStore.setState({
      mode: "result",
      resultViewSettings: {
        ...s.resultViewSettings,
        gridSpacing: 2,
        minorTicks: 4,
      },
    });
    const loaded = roundTrip();
    expect(loaded.resultViewSettings?.gridSpacing).toBe(2);
    expect(loaded.resultViewSettings?.minorTicks).toBe(4);
    expect(loaded.mode).toBe("result");
  });

  it("does not reopen a project in a running state", () => {
    useAppStore.setState({ runState: "running", progress: 0.4 });
    const loaded = roundTrip();
    expect(loaded.runState).toBe("idle");
    expect(loaded.progress).toBe(0);
  });

  it("uses the app's default options when a model has none", () => {
    const file = serializeProject(useAppStore.getState());
    const raw = JSON.parse(JSON.stringify(file));
    delete raw.models[0].options;
    const loaded = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(loaded.options.method).toBe("Morgenstern-Price");
    expect(loaded.options.slices).toBe(30);
  });

  it("drops malformed region assignments instead of throwing", () => {
    const file = serializeProject(useAppStore.getState());
    const raw = JSON.parse(JSON.stringify(file));
    raw.models[0].regionMaterials = [
      { materialId: "x" },
      { point: [1, 2], materialId: "mat-1" },
    ];
    const loaded = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(loaded.regionMaterials).toEqual([
      { point: [1, 2], materialId: "mat-1" },
    ]);
  });
});

describe("unit weight of water in the project file", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("keeps a model's value and leaves it out when not set (9.807)", () => {
    expect("waterUnitWeight" in roundTrip().options).toBe(false);
    useAppStore.getState().setOptions({ waterUnitWeight: 9.82 });
    expect(roundTrip().options.waterUnitWeight).toBe(9.82);
  });

  it("drops a value that is not a positive number without an error", () => {
    useAppStore.getState().setOptions({ waterUnitWeight: 10 });
    useAppStore.getState().saveCurrentModel();
    for (const bad of [0, -9.807, "10", null, true]) {
      const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState()))) as { models: { options: Record<string, unknown> }[] };
      raw.models[0].options.waterUnitWeight = bad;
      expect("waterUnitWeight" in parseProjectFile(JSON.stringify(raw)).models[0].options).toBe(false);
    }
  });
});
