import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReliabilityResult } from "@cslope/engine";
import { useAppStore } from "../../store/app-store";
import { snapshotFromState } from "../../store/slices/analysisSlice";
import { defaultSd, histogram, listRandomCandidates, reliabilityCsv, toRandomVariables } from "./reliability";

const fake: ReliabilityResult = {
  method: "taylor",
  fos: 1.5,
  meanFOS: 1.5,
  sdFOS: 0.3,
  cov: 0.2,
  betaLognormal: 1.948,
  pfLognormal: 0.0257,
  betaNormal: 1.667,
  terms: [{ variable: 0, mean: 10, sd: 2, fPlus: 1.8, fMinus: 1.2 }],
  surface: { cx: 0, cy: 0, radius: 1, lc: [0, 0], rc: [1, 0] },
  failed: 0,
};

vi.mock("../../store/slices/analysisSlice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../store/slices/analysisSlice")>();
  return {
    ...actual,
    executeReliability: vi.fn((_model, variables) => ({
      promise: variables.length > 1 ? Promise.reject(new Error("no surface")) : Promise.resolve(fake),
      cancel: () => {},
    })),
  };
});

const { useReliabilityStore } = await import("./store");
const activeModel = () => snapshotFromState(useAppStore.getState());

describe("probabilistic analysis", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("lists material values and maps them to engine variables by material index", () => {
    const model = activeModel();
    const candidates = listRandomCandidates(model);
    const phi = candidates.find((c) => c.field === "frictionAngle")!;
    expect(phi).toBeDefined();
    expect(defaultSd(phi)).toBeCloseTo(phi.value * 0.1, 1);
    const vars = toRandomVariables(model, [
      { key: phi.key, sd: 3, distribution: "lognormal" },
      { key: phi.key.replace("frictionAngle", "nothing"), sd: 1, distribution: "normal" },
      { key: phi.key, sd: 0, distribution: "normal" },
    ]);
    const index = model.materials.findIndex((m) => m.id === phi.materialId);
    expect(vars).toEqual([{ material: index, field: "frictionAngle", sd: 3, distribution: "lognormal" }]);
  });

  it("bins samples and writes CSV", () => {
    const bins = histogram([1, 1.5, 2, 2], 2);
    expect(bins.map((b) => b.count)).toEqual([1, 3]);
    expect(histogram([1.2, 1.2])).toEqual([{ from: 1.2, to: 1.2, count: 2 }]);
    const csv = reliabilityCsv(fake, ["Clay: c (kPa)"], true);
    expect(csv).toContain("β (lognormal);1,948");
    expect(csv).toContain("Clay: c (kPa);10;2;1,8;1,2");
  });

  it("runs through the store and reports errors", async () => {
    const model = activeModel();
    const v = { material: 0, field: "cohesion", sd: 1 };
    await useReliabilityStore.getState().run(model, [v], ["c"], { method: "taylor" });
    expect(useReliabilityStore.getState()).toMatchObject({ running: false, result: fake, labels: ["c"], error: null });
    await useReliabilityStore.getState().run(model, [v, v], ["c", "c"], { method: "taylor" });
    expect(useReliabilityStore.getState()).toMatchObject({ running: false, result: null, error: "no surface" });
  });
});
