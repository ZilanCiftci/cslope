import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { MIN_LOAD_MAGNITUDE, resolveModelParameters } from "./slices/parametersSlice";
import type { ParameterDrivenFields } from "./slices/parametersSlice";

const store = () => useAppStore.getState();
const active = () => store().models.find((m) => m.id === store().activeModelId)!;

const SQUARE: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

function fields(patch: Partial<ParameterDrivenFields> = {}): ParameterDrivenFields {
  return {
    coordinates: SQUARE,
    coordinateExpressions: [],
    materials: [],
    materialBoundaries: [],
    piezometricLine: { lines: [] } as unknown as ParameterDrivenFields["piezometricLine"],
    udls: [],
    lineLoads: [],
    ...patch,
  };
}

beforeEach(() => {
  store().newProject();
});

describe("parameter actions", () => {
  it("adds, renames, re-evaluates and removes parameters on the active model", () => {
    useAppStore.setState({
      udls: [{ id: "u", magnitude: 1, x1: 0, x2: 2, expressions: { magnitude: "q" } }],
    });
    store().addParameter();
    const [p] = store().parameters;
    expect(p).toMatchObject({ name: "p1", expression: "0" });
    store().updateParameter(p.id, { name: "q", expression: "25" });
    expect(store().udls[0].magnitude).toBe(25);
    expect(active().parameters).toEqual([{ id: p.id, name: "q", expression: "25" }]);
    expect(active().udls[0].magnitude).toBe(25);

    // Other parameters are untouched by an update.
    store().addParameter();
    const other = store().parameters[1];
    store().updateParameter(p.id, { expression: "30" });
    expect(store().parameters[1]).toEqual(other);
    expect(store().udls[0].magnitude).toBe(30);

    // Removing the parameter keeps the last good value.
    store().removeParameter(p.id);
    expect(store().parameters.map((x) => x.id)).toEqual([other.id]);
    expect(store().udls[0].magnitude).toBe(30);
  });

  it("setParameters replaces the list and resolves line loads", () => {
    useAppStore.setState({
      lineLoads: [{ id: "l", magnitude: 5, x: 1, expressions: { x: "X*2", magnitude: "" } }],
    });
    const params = [{ id: "a", name: "X", expression: "4" }];
    store().setParameters(params);
    expect(store().parameters).toEqual(params);
    expect(store().parameters).not.toBe(params);
    expect(store().lineLoads[0]).toMatchObject({ x: 8, magnitude: 5 });
  });

  it("changing a parameter discards the analysis result", () => {
    useAppStore.setState({ runState: "done", result: { minFOS: 1 } as never });
    store().addParameter();
    expect(store().runState).toBe("idle");
    expect(store().result).toBeNull();
  });
});

describe("resolveModelParameters", () => {
  it("never lets a parameter turn a load upward", () => {
    const out = resolveModelParameters(
      fields({
        udls: [{ id: "u", magnitude: 10, x1: 0, x2: 5, expressions: { magnitude: "-q" } }],
        lineLoads: [{ id: "l", magnitude: 10, x: 1, expressions: { magnitude: "q-q" } }],
      }),
      [{ id: "p", name: "q", expression: "20" }],
    );
    expect(out.udls[0].magnitude).toBe(MIN_LOAD_MAGNITUDE);
    expect(out.lineLoads[0].magnitude).toBe(MIN_LOAD_MAGNITUDE);
  });

  it("keeps the current value when a load expression fails", () => {
    const out = resolveModelParameters(
      fields({
        udls: [{ id: "u", magnitude: 7, x1: 1, x2: 5, expressions: { x1: "missing", x2: "  " } }],
        lineLoads: [{ id: "l", magnitude: 3, x: 2, expressions: { x: "1/" } }],
      }),
      [],
    );
    expect(out.udls[0]).toMatchObject({ magnitude: 7, x1: 1, x2: 5 });
    expect(out.lineLoads[0]).toMatchObject({ magnitude: 3, x: 2 });
  });

  it("boundary and water points without expressions follow a moved exterior vertex", () => {
    const out = resolveModelParameters(
      fields({
        coordinateExpressions: [{}, { x: "W" }, {}, {}],
        materialBoundaries: [
          // Starts on vertex 1 (10, 0), which moves to (W, 0).
          { id: "b", coordinates: [[10, 0], [0, 5]], coordinateExpressions: [] },
          // Same start, but with its own expression: stays where it says.
          { id: "c", coordinates: [[10, 0], [0, 6]], coordinateExpressions: [{ x: "3" }] },
        ],
        piezometricLine: {
          lines: [{ id: "w", name: "W", coordinates: [[10, 0], [0, 2]] }],
        } as unknown as ParameterDrivenFields["piezometricLine"],
      }),
      [{ id: "p", name: "W", expression: "12" }],
    );
    expect(out.coordinates[1]).toEqual([12, 0]);
    expect(out.materialBoundaries[0].coordinates).toEqual([[12, 0], [0, 5]]);
    expect(out.materialBoundaries[1].coordinates[0]).toEqual([3, 0]);
    expect(out.piezometricLine.lines[0].coordinates).toEqual([[12, 0], [0, 2]]);
  });

  it("keeps a closed boundary closed when one end is driven by an expression", () => {
    const loop: [number, number][] = [[2, 2], [4, 2], [4, 4], [2, 2]];
    const lastDriven = resolveModelParameters(
      fields({
        materialBoundaries: [
          { id: "b", coordinates: loop, coordinateExpressions: [{}, {}, {}, { x: "A" }] },
        ],
      }),
      [{ id: "p", name: "A", expression: "3" }],
    );
    const pts = lastDriven.materialBoundaries[0].coordinates;
    expect(pts[0]).toEqual([3, 2]);
    expect(pts[3]).toEqual([3, 2]);

    const firstDriven = resolveModelParameters(
      fields({
        materialBoundaries: [
          { id: "b", coordinates: loop, coordinateExpressions: [{ y: "A" }, {}, {}, {}] },
        ],
      }),
      [{ id: "p", name: "A", expression: "3" }],
    );
    const pts2 = firstDriven.materialBoundaries[0].coordinates;
    expect(pts2[0]).toEqual([2, 3]);
    expect(pts2[3]).toEqual([2, 3]);
  });

  it("resolves material model expressions", () => {
    const out = resolveModelParameters(
      fields({
        materials: [
          {
            id: "m",
            name: "Clay",
            color: "#000",
            model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 1, frictionAngle: 20 },
            modelExpressions: { cohesion: "c*2" },
          },
        ],
      }),
      [{ id: "p", name: "c", expression: "6" }],
    );
    expect(out.materials[0].model).toMatchObject({ cohesion: 12, frictionAngle: 20 });
  });
});
