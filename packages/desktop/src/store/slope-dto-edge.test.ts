import { describe, expect, it } from "vitest";
import { buildSlopeDTOFromModel } from "./helpers";
import type { ModelEntry } from "./types";

const mat = (id: string, name: string) => ({
  id,
  name,
  color: "#000",
  model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 25 },
});

/** Only the fields a model must have; the rest is left to the defaults. */
function model(patch: Record<string, unknown> = {}): ModelEntry {
  return {
    id: "m",
    name: "M",
    coordinates: [
      [0, 0],
      [0, 10],
      [20, 10],
      [30, 0],
    ],
    materials: [mat("a", "Clay")],
    materialBoundaries: [],
    regionMaterials: [],
    udls: [],
    lineLoads: [],
    ...patch,
  } as unknown as ModelEntry;
}

describe("buildSlopeDTOFromModel edge cases", () => {
  it("works without optional sections (water, loads, orientation)", () => {
    const dto = buildSlopeDTOFromModel(model());
    expect(dto.materials).toHaveLength(1);
    expect(dto.waterTable).toBeUndefined();
    expect(dto.reinforcements).toBeUndefined();
    expect(dto.piles).toBeUndefined();
    expect(dto.customSearchPlanes).toBeUndefined();
  });

  it("gives materials with the same name unique engine names and maps regions by id", () => {
    const dto = buildSlopeDTOFromModel(
      model({
        materials: [mat("a", "Clay"), mat("b", "Clay"), mat("c", "Clay (2)"), mat("d", "Clay")],
        regionMaterials: [
          { point: [5, 5], materialId: "d" },
          { point: [6, 6], materialId: "gone" },
        ],
      }),
    );
    expect(dto.materials.map((m) => m.name)).toEqual([
      "Clay",
      "Clay (2)",
      "Clay (2) (2)",
      "Clay (3)",
    ]);
    expect(dto.regionAssignments).toEqual([{ point: [5, 5], materialName: "Clay (3)" }]);
  });

  it("orders open boundaries before closed ones, each by id", () => {
    const closed: [number, number][] = [[5, 2], [8, 2], [8, 4], [5, 2]];
    const open1: [number, number][] = [[0, 5], [30, 5]];
    const open2: [number, number][] = [[0, 3], [30, 3]];
    const dto = buildSlopeDTOFromModel(
      model({
        materialBoundaries: [
          { id: "a-closed", coordinates: closed },
          { id: "c-open", coordinates: open1 },
          { id: "b-open", coordinates: open2 },
        ],
      }),
    );
    expect(dto.materialBoundaries!.map((b) => b.coordinates)).toEqual([open2, open1, closed]);
  });

  it("uses the first complete water line when the main line is still being drawn", () => {
    const dto = buildSlopeDTOFromModel(
      model({
        piezometricLine: {
          lines: [
            { id: "main", name: "Main", coordinates: [[0, 5]] },
            { id: "w2", name: "Second", coordinates: [[0, 4], [30, 2]] },
          ],
          activeLineId: null,
          mainLineId: "main",
          materialAssignment: { a: "main" },
        },
      }),
    );
    expect(dto.waterTable).toMatchObject({ mode: "custom", followBoundary: false });
    // Only complete lines are offered per material; an assignment to an
    // incomplete line falls back to the main water table.
    expect(dto.waterTables).toHaveLength(1);
    expect(dto.materials[0].waterTableId).toBeUndefined();
  });

  it("assigns per-material water lines and follows free water", () => {
    const dto = buildSlopeDTOFromModel(
      model({
        materials: [mat("a", "Clay"), mat("b", "Sand")],
        piezometricLine: {
          lines: [
            { id: "w1", name: "One", coordinates: [[0, 5], [30, 3]] },
            { id: "w2", name: "Two", coordinates: [[0, 4], [30, 2]] },
          ],
          activeLineId: null,
          materialAssignment: { b: "w2" },
          freeWater: true,
        },
      }),
    );
    expect(dto.waterTable!.followBoundary).toBe(false);
    expect(dto.waterTables!.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(dto.materials[0].waterTableId).toBeUndefined();
    expect(dto.materials[1].waterTableId).toBe("w2");
  });

  it("clipped water (freeWater false) follows the ground surface", () => {
    const dto = buildSlopeDTOFromModel(
      model({
        piezometricLine: {
          lines: [{ id: "w1", name: "One", coordinates: [[0, 5], [30, 3]] }],
          activeLineId: null,
          materialAssignment: {},
          freeWater: false,
        },
      }),
    );
    expect(dto.waterTable!.followBoundary).toBe(true);
    expect(dto.waterTables).toBeUndefined();
  });

  it("splits custom planes into circles and complete polylines", () => {
    const dto = buildSlopeDTOFromModel(
      model({
        customSearchPlanes: [
          { id: "c", cx: 10, cy: 20, radius: 15 },
          { id: "p", cx: 0, cy: 0, radius: 0, points: [[2, 10], [25, 1]] },
          { id: "q", cx: 0, cy: 0, radius: 0, points: [[2, 10]] },
        ],
        customPlanesOnly: true,
      }),
    );
    expect(dto.customSearchPlanes).toHaveLength(1);
    expect(dto.customSurfaces).toHaveLength(1);
    expect(dto.customPlanesOnly).toBe(true);
  });

  it("only incomplete polylines leave no custom surfaces", () => {
    const dto = buildSlopeDTOFromModel(
      model({
        customSearchPlanes: [{ id: "q", cx: 0, cy: 0, radius: 0, points: [] }],
      }),
    );
    expect(dto.customSearchPlanes).toBeUndefined();
    expect(dto.customSurfaces).toBeUndefined();
    expect(dto.customPlanesOnly).toBe(false);
  });
});
