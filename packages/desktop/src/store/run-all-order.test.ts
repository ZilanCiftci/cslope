/**
 * The order Run All analyses the models in: the longest expected first,
 * so that the cores stay busy to the end; the list keeps its order.
 */
import { describe, expect, it } from "vitest";
import { expectedAnalysisWork, runAllOrder } from "./slices/analysisSlice";
import { DEFAULT_FEM_SETTINGS } from "@cslope/engine";
import { INITIAL_MODEL } from "./slices/modelsSlice";
import type { ModelEntry } from "./types";

const model = (name: string, patch: Partial<ModelEntry> = {}, options: Partial<ModelEntry["options"]> = {}): ModelEntry => ({
  ...structuredClone(INITIAL_MODEL),
  id: name,
  name,
  ...patch,
  options: { ...INITIAL_MODEL.options, ...options },
});

const names = (models: ModelEntry[]) => models.map((m) => m.name);

describe("expectedAnalysisWork", () => {
  it("grows with the surfaces and the slices", () => {
    const base = expectedAnalysisWork(model("base"));
    expect(expectedAnalysisWork(model("more", {}, { iterations: 3000, refinedIterations: 1000 }))).toBeGreaterThan(base);
    expect(expectedAnalysisWork(model("slices", {}, { slices: 50 }))).toBeGreaterThan(base);
    expect(expectedAnalysisWork(model("fewer", {}, { iterations: 500, refinedIterations: 0 }))).toBeLessThan(base);
  });

  it("weights Morgenstern-Price, a block search, the optimisation and both directions higher", () => {
    const base = expectedAnalysisWork(model("base", {}, { method: "Bishop" }));
    expect(expectedAnalysisWork(model("mp", {}, { method: "Morgenstern-Price" }))).toBeGreaterThan(base);
    expect(expectedAnalysisWork(model("block", {}, { method: "Bishop", searchMethod: "block" }))).toBeGreaterThan(base);
    expect(expectedAnalysisWork(model("opt", {}, { method: "Bishop", nonCircularOptimization: true }))).toBeGreaterThan(
      expectedAnalysisWork(model("block", {}, { method: "Bishop", searchMethod: "block" })),
    );
    expect(expectedAnalysisWork(model("both", {}, { method: "Bishop", bothDirections: true }))).toBe(2 * base);
  });

  it("puts a finite element analysis above any search, and custom surfaces alone below", () => {
    const fem = { ...DEFAULT_FEM_SETTINGS, enabled: true, refinementLevels: 0, limitAnalysis: false };
    const search = model("search", {}, { iterations: 100_000, refinedIterations: 100_000, slices: 500, nonCircularOptimization: true, bothDirections: true });
    expect(expectedAnalysisWork(model("fem", {}, { iterations: 500, refinedIterations: 0, fem }))).toBeGreaterThan(
      expectedAnalysisWork(search),
    );
    expect(expectedAnalysisWork(model("refined", {}, { fem: { ...fem, refinementLevels: 2 } }))).toBeGreaterThan(
      expectedAnalysisWork(model("fem", {}, { fem })),
    );
    const planes = [{ id: "csp-1", cx: 10, cy: 20, radius: 15 }];
    const custom = model("custom", { customSearchPlanes: planes, customPlanesOnly: true });
    expect(expectedAnalysisWork(custom)).toBeLessThan(expectedAnalysisWork(model("small", {}, { iterations: 500, refinedIterations: 0 })));
    // (a custom surface on top of the search adds a little)
    expect(expectedAnalysisWork(model("plus", { customSearchPlanes: planes }))).toBeGreaterThan(expectedAnalysisWork(model("base")));
  });
});

describe("runAllOrder", () => {
  it("orders the longest expected first and keeps the list's order among equals", () => {
    const models = [
      model("A"),
      model("B custom", { customSearchPlanes: [{ id: "csp-1", cx: 10, cy: 20, radius: 15 }], customPlanesOnly: true }),
      model("C big", {}, { iterations: 3000, refinedIterations: 1000, slices: 50 }),
      model("D"),
      model("E fem", {}, { fem: { ...DEFAULT_FEM_SETTINGS, enabled: true } }),
      model("F opt", {}, { nonCircularOptimization: true }),
    ];
    expect(names(runAllOrder(models))).toEqual(["E fem", "C big", "F opt", "A", "D", "B custom"]);
    // The list itself is not touched.
    expect(names(models)).toEqual(["A", "B custom", "C big", "D", "E fem", "F opt"]);
    expect(runAllOrder([])).toEqual([]);
  });
});
