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
    expect(sensitivityValues(25.6, 38.4, 9)[1]).toBe(27.2);
    expect(sensitivityCsv("c", [{ value: 1.5, fos: 2 }], true)).toBe("c;FOS;Note\r\n1,5;2;\r\n");
    expect(sensitivityCsv("c (kPa)", [{ value: 10, fos: 1.2345678 }, { value: 20, fos: null, error: "x, y" }])).toBe(
      'c (kPa),FOS,Note\r\n10,1.2346,\r\n20,,"x, y"\r\n',
    );
  });

  it("runs every value, keeping the ones that fail", async () => {
    const model = activeModel();
    const mat = model.materials[0];
    await useSensitivityStore
      .getState()
      .run(model, { kind: "material", materialId: mat.id, field: "cohesion" }, { key: "k", label: "c", value: 3 }, [20, -5, 10]);
    const { points, running } = useSensitivityStore.getState();
    expect(running).toBe(false);
    // Sorted by value whatever order the workers finish in.
    expect(points.map((p) => p.value)).toEqual([-5, 10, 20]);
    expect(points.map((p) => p.fos)).toEqual([null, 1, 2]);
    expect(points[0].error).toBe("no surface");
  });
});

describe("sensitivity cancel", () => {
  it("cancelling stops the workers of the current run", async () => {
    const { executeModelAnalysis } = await import("../../store/slices/analysisSlice");
    const cancels: (() => void)[] = [];
    vi.mocked(executeModelAnalysis).mockImplementation(() => {
      let reject: (e: Error) => void = () => {};
      const promise = new Promise<never>((_, r) => (reject = r));
      const cancel = vi.fn(() => reject(new Error("cancelled")));
      cancels.push(cancel);
      return { promise, cancel } as never;
    });
    useAppStore.getState().newProject();
    const model = snapshotFromState(useAppStore.getState());
    const v = { kind: "material", materialId: model.materials[0].id, field: "cohesion" } as const;
    const first = useSensitivityStore.getState().run(model, v, { key: "k", label: "c", value: 3 }, [1, 2]);
    const second = useSensitivityStore.getState().run(model, v, { key: "k", label: "c", value: 3 }, [3, 4]);
    await Promise.resolve();
    useSensitivityStore.getState().cancel();
    await Promise.all([first, second]);
    // Every handle that was started has been cancelled, including the
    // second run's (the first run's cleanup must not lose them).
    expect(cancels.length).toBeGreaterThan(0);
    for (const c of cancels) expect(c).toHaveBeenCalled();
    expect(useSensitivityStore.getState().running).toBe(false);
  });
});
