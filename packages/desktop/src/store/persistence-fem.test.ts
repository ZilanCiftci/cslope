import { describe, expect, it } from "vitest";
import { DEFAULT_FEM_SETTINGS } from "@cslope/engine";
import { LEGACY_FEM_FLOW_RULE, parseProjectFile } from "./persistence";

const model = (extra: Record<string, unknown>) =>
  JSON.stringify({
    version: 1,
    activeModelId: "m1",
    models: [
      {
        id: "m1",
        name: "FE",
        coordinates: [[0, 0], [0, 10], [10, 5], [10, 0]],
        materials: [{ id: "mat-1", name: "M1", unitWeight: 20, frictionAngle: 30, cohesion: 5, color: "#6d5f2a" }],
        ...extra,
      },
    ],
  });

const fem = {
  factorOfSafety: 1.3,
  failedF: 1.31,
  flowRule: "davis-b",
  levels: [{ elements: 1, fos: 1.3 }],
  warnings: [],
  elapsedMs: 10,
  x: [0, 1, 0],
  y: [0, 0, 1],
  triangles: [0, 1, 2],
  plasticShear: [0.01],
  displacement: [0, 0, 0, 0, 0, 0],
};
const result = { minFOS: 1.2, maxFOS: 2, criticalSurface: null, allSurfaces: [], criticalSlices: [], method: "Bishop", elapsedMs: 1 };

describe("persistence of the finite element analysis", () => {
  it("keeps valid settings and replaces invalid fields with defaults", () => {
    const parsed = parseProjectFile(
      model({ options: { method: "Bishop", fem: { enabled: true, flowRule: "bogus", youngsModulus: 5e4, poissonsRatio: 0.495, refinementLevels: 2 } } }),
    );
    const f = parsed.models[0].options.fem!;
    expect(f.enabled).toBe(true);
    expect(f.flowRule).toBe("non-associated"); // as before Davis B became the default of new projects
    expect(f.youngsModulus).toBe(5e4);
    expect(f.poissonsRatio).toBe(0.3);
    expect(f.refinementLevels).toBe(2);
    expect(f.elementSize).toBeNull();
  });

  it("reads a file without a flow rule as before (non-associated), one with a flow rule as saved", () => {
    expect(DEFAULT_FEM_SETTINGS.flowRule).toBe("davis-b"); // new projects
    expect(LEGACY_FEM_FLOW_RULE).toBe("non-associated");
    const without = parseProjectFile(model({ options: { method: "Bishop", fem: { enabled: true, youngsModulus: 5e4 } } }));
    expect(without.models[0].options.fem!.flowRule).toBe("non-associated");
    for (const flowRule of ["davis-b", "associated", "non-associated"] as const) {
      const saved = parseProjectFile(model({ options: { method: "Bishop", fem: { ...DEFAULT_FEM_SETTINGS, enabled: true, flowRule } } }));
      expect(saved.models[0].options.fem!.flowRule).toBe(flowRule);
    }
  });

  it("keeps a valid finite element result and drops a damaged one", () => {
    const ok = parseProjectFile(model({ runState: "done", result: { ...result, fem } }));
    expect(ok.models[0].result?.fem?.factorOfSafety).toBe(1.3);
    const bad = parseProjectFile(model({ runState: "done", result: { ...result, fem: { ...fem, triangles: [0, 1, 7] } } }));
    expect(bad.models[0].result?.minFOS).toBe(1.2);
    expect(bad.models[0].result?.fem).toBeUndefined();
    for (const damaged of [
      { levels: [null] },
      { levels: [{ elements: "many", fos: 1.3 }] },
      { warnings: [42] },
      { flowRule: "bogus" },
      { displacement: [0, 0] },
    ]) {
      const r = parseProjectFile(model({ runState: "done", result: { ...result, fem: { ...fem, ...damaged } } }));
      expect(r.models[0].result?.fem).toBeUndefined();
    }
  });

  it("keeps the error of a failed finite element analysis with the limit equilibrium result", () => {
    const r = parseProjectFile(model({ runState: "done", result: { ...result, femError: "no free degrees of freedom" } }));
    expect(r.models[0].result?.minFOS).toBe(1.2);
    expect(r.models[0].result?.femError).toBe("no free degrees of freedom");
    const bad = parseProjectFile(model({ runState: "done", result: { ...result, femError: 7 } }));
    expect(bad.models[0].result?.femError).toBeUndefined();
  });
});
