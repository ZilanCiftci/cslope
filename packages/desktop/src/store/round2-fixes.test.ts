import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";
import { buildSlopeDTOFromModel } from "./helpers";
import { buildMaterialTableData } from "../features/canvas/helpers";
import { resolveMaterialModel } from "../utils/expression";

function fileWith(mutate: (model: Record<string, unknown>) => void) {
  const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
  mutate(raw.models[0]);
  return parseProjectFile(JSON.stringify(raw)).models[0];
}

describe("round 2 store fixes", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("parameter changes keep a closed boundary closed", () => {
    useAppStore.setState({
      materialBoundaries: [
        {
          id: "ring",
          coordinates: [[5, -5], [8, -5], [8, -2], [5, -2], [5, -5]],
          coordinateExpressions: [{ x: "a" }, {}, {}, {}, {}],
        },
      ],
    });
    useAppStore.getState().setParameters([{ id: "p", name: "a", expression: "6" }]);
    const c = useAppStore.getState().materialBoundaries[0].coordinates;
    expect(c[0]).toEqual([6, -5]);
    expect(c[c.length - 1]).toEqual([6, -5]);
  });

  it("parameter changes move boundary points that sit on an exterior vertex", () => {
    const s = useAppStore.getState();
    const vertex = s.coordinates[1];
    const exprs = s.coordinates.map((_, i) => (i === 1 ? { y: "h" } : {}));
    useAppStore.setState({
      coordinateExpressions: exprs,
      materialBoundaries: [
        {
          id: "layer",
          coordinates: [vertex, [vertex[0] + 10, vertex[1] - 3]],
          coordinateExpressions: [{}, {}],
        },
      ],
    });
    useAppStore.getState().setParameters([{ id: "p", name: "h", expression: "-1" }]);
    const after = useAppStore.getState();
    expect(after.coordinates[1]).toEqual([vertex[0], -1]);
    expect(after.materialBoundaries[0].coordinates[0]).toEqual([vertex[0], -1]);
  });

  it("ignores expressions for fields the material model does not have", () => {
    const model = resolveMaterialModel(
      { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 },
      { cohesion: "40" },
      {},
    );
    expect(model).not.toHaveProperty("cohesion");
  });

  it("does not restrict the search when a file has no analysis limits", () => {
    const loaded = fileWith((m) => delete m.analysisLimits);
    expect(loaded.analysisLimits.enabled).toBe(false);
    expect(buildSlopeDTOFromModel(loaded).analysisLimits).toBeUndefined();
  });

  it("drops malformed points, planes and offsets instead of crashing later", () => {
    const loaded = fileWith((m) => {
      m.materialBoundaries = [{ coordinates: [[0, -5], null, [50, -5]] }];
      m.customSearchPlanes = [null, { cx: "12", cy: 4, radius: 9 }, { cx: 20, cy: 10, radius: 15 }];
      m.editViewOffset = "nope";
      m.piezometricLine = { lines: [{ id: "w", coordinates: [[0, -2], "x", [50, -2]] }] };
      m.runState = "bogus";
      m.options = { ...(m.options as object), evil: 1 };
    });
    expect(loaded.materialBoundaries[0].id).toEqual(expect.any(String));
    expect(loaded.materialBoundaries[0].coordinates).toEqual([[0, -5], [50, -5]]);
    expect(loaded.customSearchPlanes).toHaveLength(1);
    expect(loaded.editViewOffset).toBeUndefined();
    expect(loaded.piezometricLine.lines[0].coordinates).toEqual([[0, -2], [50, -2]]);
    expect(loaded.piezometricLine.activeLineId).toBe("w");
    expect(loaded.runState).toBe("idle");
    expect(loaded.options).not.toHaveProperty("evil");
    expect(() => buildSlopeDTOFromModel(loaded)).not.toThrow();
  });

  it("deleting a material clears its references and keeps the last one", () => {
    const store = useAppStore.getState();
    store.addMaterial();
    const m2 = useAppStore.getState().materials[1];
    useAppStore.setState({
      assigningMaterialId: m2.id,
      piezometricLine: {
        ...useAppStore.getState().piezometricLine,
        materialAssignment: { [m2.id]: "w" },
      },
    });
    useAppStore.getState().removeMaterial(m2.id);
    const s = useAppStore.getState();
    expect(s.assigningMaterialId).toBeNull();
    expect(s.piezometricLine.materialAssignment).not.toHaveProperty(m2.id);
    useAppStore.getState().removeMaterial(s.materials[0].id);
    expect(useAppStore.getState().materials).toHaveLength(1);
  });

  it("material table shows '-' for models without c or phi", () => {
    const table = buildMaterialTableData(
      { id: "t", type: "material-table", x: 0, y: 0 } as never,
      [
        { id: "r", name: "Rock", color: "#000", modelExpressions: {}, model: { kind: "impenetrable", unitWeight: 25 } },
        { id: "c", name: "Clay", color: "#111", modelExpressions: {}, model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 } },
      ] as never,
    );
    const cohesionCol = table.columnKeys.indexOf("cohesion");
    const phiCol = table.columnKeys.indexOf("frictionAngle");
    expect(table.rows[0][cohesionCol]).toBe("-");
    expect(table.rows[0][phiCol]).toBe("-");
    expect(table.rows[1][cohesionCol]).toBe("30");
    expect(table.rows[1][phiCol]).toBe("0°");
  });
});
