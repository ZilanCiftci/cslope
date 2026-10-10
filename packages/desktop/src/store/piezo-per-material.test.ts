import { beforeEach, describe, expect, it } from "vitest";
import { buildSlope, getSlices, WATER_UNIT_WEIGHT } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { buildSlopeDTOFromModel } from "./helpers";

function dto() {
  const s = useAppStore.getState();
  s.saveCurrentModel();
  const model = useAppStore
    .getState()
    .models.find((m) => m.id === s.activeModelId)!;
  return buildSlopeDTOFromModel(model);
}

describe("piezometric line per material", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.getState().addMaterial();
    const [m1, m2] = useAppStore.getState().materials;
    useAppStore.setState({
      piezometricLine: {
        enabled: true,
        activeLineId: "l1",
        lines: [
          { id: "l1", name: "L1", color: "#00f", coordinates: [[0, -3], [50, -3]] },
          { id: "l2", name: "L2", color: "#0f0", coordinates: [[0, -8], [50, -8]] },
        ],
        materialAssignment: { [m2.id]: "l2" },
      },
    });
    expect(m1).toBeDefined();
  });

  it("sends every line and each material's assigned line", () => {
    const def = dto();
    expect(def.waterTables?.map((w) => w.id)).toEqual(["l1", "l2"]);
    expect(def.materials[0].waterTableId).toBeUndefined();
    expect(def.materials[1].waterTableId).toBe("l2");
  });

  it("makes the engine use the assigned line for that material", () => {
    // The whole slope is the second material, which uses L2 (y = -8).
    const second = useAppStore.getState().materials[1];
    useAppStore.setState({
      materialBoundaries: [],
      regionMaterials: [{ point: [5, -5], materialId: second.id }],
    });
    const slope = buildSlope(dto());
    const [cx, cy, r] = [25, 10, 22];
    const pts = slope.getCircleExternalIntersection(cx, cy, r);
    const slices = getSlices(slope, pts[0][0], pts[1][0], cx, cy, r);
    expect(slices.length).toBeGreaterThan(0);
    // Where the ground is above -8 the line is flat at -8 (no clipping).
    const inland = slices.filter((s) => s.xRight < 30);
    expect(inland.length).toBeGreaterThan(0);
    expect(inland.some((s) => s.U > 0)).toBe(true);
    for (const s of inland) {
      const head = Math.max(-8 - s.yBottom, 0);
      expect(s.U).toBeCloseTo(head * WATER_UNIT_WEIGHT, 9);
    }
  });

  it("keeps the request unchanged for a single line", () => {
    useAppStore.setState({
      piezometricLine: {
        ...useAppStore.getState().piezometricLine,
        lines: useAppStore.getState().piezometricLine.lines.slice(0, 1),
      },
    });
    const def = dto();
    expect(def.waterTables).toBeUndefined();
    expect(def.materials.every((m) => m.waterTableId === undefined)).toBe(true);
  });
});
