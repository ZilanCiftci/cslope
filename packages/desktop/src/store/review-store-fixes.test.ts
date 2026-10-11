/**
 * Store findings from the review of the day's work: the main piezometric
 * line in the analysis signature, model duplication, old files without
 * the newer arrays, ids from files, CSV formulas.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { getAnalysisInputSignature } from "./helpers";
import { isProjectDirty, markProjectClean } from "./unsaved";
import { parseProjectFile, serializeProject } from "./persistence";
import { toCsv } from "../features/export/sliceTable";

function twoLines() {
  useAppStore.setState({
    piezometricLine: {
      enabled: true,
      activeLineId: "l1",
      lines: [
        { id: "l1", name: "L1", color: "#00f", coordinates: [[0, -3], [50, -3]] },
        { id: "l2", name: "L2", color: "#0f0", coordinates: [[0, -8], [50, -8]] },
      ],
      materialAssignment: {},
    },
  });
}

describe("review fixes: store", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("the main piezometric line is part of the analysis signature", () => {
    twoLines();
    const before = getAnalysisInputSignature(useAppStore.getState());
    useAppStore.getState().setPiezoMainLine("l2");
    expect(getAnalysisInputSignature(useAppStore.getState())).not.toBe(before);
  });

  it("duplicating a model remaps its main line", () => {
    twoLines();
    useAppStore.getState().setPiezoMainLine("l2");
    const s = useAppStore.getState();
    s.duplicateModel(s.activeModelId);
    const copy = useAppStore.getState().models.at(-1)!;
    const ids = copy.piezometricLine.lines.map((l) => l.id);
    expect(copy.piezometricLine.mainLineId).toBeDefined();
    expect(ids).toContain(copy.piezometricLine.mainLineId);
    expect(copy.piezometricLine.mainLineId).not.toBe("l2");
  });

  it("removing the main line clears the reference", () => {
    twoLines();
    useAppStore.getState().setPiezoMainLine("l2");
    useAppStore.getState().removePiezoLine("l2");
    expect(useAppStore.getState().piezometricLine.mainLineId).toBeUndefined();
  });

  it("a project saved without reinforcements and piles stays clean when switching models", () => {
    const s = useAppStore.getState();
    s.addModel();
    const file = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState()))) as { models: Record<string, unknown>[] };
    for (const m of file.models) {
      delete m.reinforcements;
      delete m.piles;
      delete m.parameters;
      delete m.coordinateExpressions;
    }
    const parsed = parseProjectFile(JSON.stringify(file));
    useAppStore.getState().loadProject(parsed);
    markProjectClean(useAppStore.getState());
    expect(isProjectDirty(useAppStore.getState())).toBe(false);
    const other = useAppStore.getState().models.find((m) => m.id !== useAppStore.getState().activeModelId)!;
    useAppStore.getState().switchModel(other.id);
    expect(isProjectDirty(useAppStore.getState())).toBe(false);
  });

  it("reinforcements and piles without an id get unique ids", () => {
    const file = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState()))) as { models: Record<string, unknown>[] };
    const base = { type: "nail", x1: 0, y1: 0, x2: 5, y2: -1 };
    file.models[0].reinforcements = [{ ...base, id: "reinf-2" }, base, base];
    file.models[0].piles = [{ type: "pile", x1: 1, y1: 0, x2: 1, y2: -5, id: "pile-2" }, { type: "pile", x1: 1, y1: 0, x2: 1, y2: -5 }];
    const model = parseProjectFile(JSON.stringify(file)).models[0];
    const rIds = model.reinforcements!.map((r) => r.id);
    const pIds = model.piles!.map((p) => p.id);
    expect(new Set(rIds).size).toBe(3);
    expect(new Set(pIds).size).toBe(2);
  });

  it("CSV text that a spreadsheet would run as a formula is quoted", () => {
    expect(toCsv([["=1+1", 2]])).toBe("\"'=1+1\",2\r\n");
    expect(toCsv([["-x", "@a", "+b"]])).toBe("\"'-x\",\"'@a\",\"'+b\"\r\n");
    expect(toCsv([["Clay", -0.5]])).toBe("Clay,-0.5\r\n");
  });
});
