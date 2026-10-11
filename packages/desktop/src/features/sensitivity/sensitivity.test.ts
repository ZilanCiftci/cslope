import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { snapshotFromState } from "../../store/slices/analysisSlice";
import { listVariables, modelWithValue, sensitivityCsv, sensitivityValues } from "./sensitivity";

vi.mock("../../store/slices/analysisSlice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../store/slices/analysisSlice")>();
  return {
    ...actual,
    // FOS = cohesion / 10 of the first material; errors for negative c.
    executeModelAnalysis: vi.fn((model) => {
      const c = (model.materials[0].model as { cohesion?: number }).cohesion ?? 0;
      return {
        promise: c < 0 ? Promise.reject(new Error("no surface")) : Promise.resolve({ minFOS: c / 10 }),
        cancel: () => {},
      };
    }),
  };
});

const { useSensitivityStore } = await import("./store");

const activeModel = () => snapshotFromState(useAppStore.getState());

describe("sensitivity analysis", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("lists parameters and material values", () => {
    const vars = listVariables(activeModel());
    expect(vars.some((v) => v.variable.kind === "material" && v.label.includes("φ"))).toBe(true);
  });

  it("varies a material value and drops that field's expression", () => {
    const model = activeModel();
    const mat = model.materials[0];
    const withExpr = { ...model, materials: [{ ...mat, modelExpressions: { cohesion: "k" } }] };
    const next = modelWithValue(withExpr, { kind: "material", materialId: mat.id, field: "cohesion" }, 42);
    expect((next.materials[0].model as { cohesion: number }).cohesion).toBe(42);
    expect(next.materials[0].modelExpressions?.cohesion).toBeUndefined();
  });

  it("varies a parameter and re-resolves the geometry that uses it", () => {
    const model = activeModel();
    const withParam = {
      ...model,
      parameters: [{ id: "p1", name: "h", expression: "10" }],
      coordinateExpressions: model.coordinates.map((_, i) => (i === 1 ? { y: "h" } : {})),
    };
    const next = modelWithValue(withParam, { kind: "parameter", name: "h" }, 7.5);
    expect(next.coordinates[1][1]).toBe(7.5);
    expect(next.parameters![0].expression).toBe("7.5");
  });

  it("spaces values evenly and writes CSV", () => {
    expect(sensitivityValues(10, 20, 3)).toEqual([10, 15, 20]);
    expect(sensitivityCsv("c (kPa)", [{ value: 10, fos: 1.2345678 }, { value: 20, fos: null, error: "x, y" }])).toBe(
      'c (kPa),FOS,Note\r\n10,1.2346,\r\n20,,"x, y"\r\n',
    );
  });

  it("runs every value, keeping the ones that fail", async () => {
    const model = activeModel();
    const mat = model.materials[0];
    await useSensitivityStore
      .getState()
      .run(model, { kind: "material", materialId: mat.id, field: "cohesion" }, "c", [-5, 10, 20]);
    const { points, running } = useSensitivityStore.getState();
    expect(running).toBe(false);
    expect(points.map((p) => p.fos)).toEqual([null, 1, 2]);
    expect(points[0].error).toBe("no surface");
  });
});
