import { beforeEach, describe, expect, it } from "vitest";
import { buildSlope } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { buildSlopeDTOFromModel } from "./helpers";

function activeModel() {
  const s = useAppStore.getState();
  s.saveCurrentModel();
  return useAppStore.getState().models.find((m) => m.id === s.activeModelId)!;
}

describe("material identity in the analysis request", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("does not reuse a default name after a material is deleted", () => {
    const store = useAppStore.getState();
    store.addMaterial();
    store.addMaterial();
    const mats = useAppStore.getState().materials;
    store.removeMaterial(mats[mats.length - 2].id);
    store.addMaterial();
    const names = useAppStore.getState().materials.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("maps a region to the right material when two share a name", () => {
    const store = useAppStore.getState();
    store.addMaterial();
    store.addMaterial();
    const [, first, second] = useAppStore.getState().materials;
    const renamed = useAppStore
      .getState()
      .materials.map((m) =>
        m.id === first.id || m.id === second.id ? { ...m, name: "Clay" } : m,
      );
    useAppStore.setState({
      materials: renamed,
      regionMaterials: [{ point: [1, 1], materialId: first.id }],
    });

    const dto = buildSlopeDTOFromModel(activeModel());
    const names = dto.materials.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    const assigned = dto.regionAssignments?.[0].materialName;
    const firstIndex = useAppStore
      .getState()
      .materials.findIndex((m) => m.id === first.id);
    expect(assigned).toBe(dto.materials[firstIndex].name);
  });

  it("sends a whole-slope assignment when there are no boundaries", () => {
    const store = useAppStore.getState();
    store.addMaterial();
    const second = useAppStore.getState().materials[1];
    const [x, y] = useAppStore.getState().coordinates[1];
    useAppStore.setState({
      materialBoundaries: [],
      regionMaterials: [{ point: [x + 1, y - 1], materialId: second.id }],
    });
    const dto = buildSlopeDTOFromModel(activeModel());
    const slope = buildSlope(dto);
    expect(slope.materialGeometries[0].material.name).toBe(
      dto.materials[1].name,
    );
  });
});
