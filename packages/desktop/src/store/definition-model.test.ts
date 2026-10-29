import { describe, expect, it } from "vitest";
import { VERIFICATION_CASES } from "@cslope/engine/verification";
import { resolveOrientation, toCanonicalSlopeDefinition, type SlopeDefinition } from "@cslope/engine";
import { modelFromDefinition } from "./definition-model";
import { buildSlopeDTOFromModel } from "./helpers";

/** What the analysis sees of a definition. */
function analysed(d: SlopeDefinition) {
  return {
    orientation: resolveOrientation(d.orientation, d.coordinates),
    coordinates: d.coordinates,
    materials: d.materials.map((m) => ({ name: m.name, model: m.model })),
    // The engine cuts by all boundaries at once, so their order does not matter.
    boundaries: (d.materialBoundaries ?? []).map((b) => JSON.stringify(b.coordinates)).sort(),
    regions: d.regionAssignments ?? [],
    water: d.waterTable?.value ?? null,
    // Clipped at the ground unless stated otherwise (the engine's default).
    clipped: d.waterTable ? d.waterTable.followBoundary !== false : null,
    // The water line each material uses (its own, or the main one).
    materialWater: d.materials.map((m) =>
      m.waterTableId ? (d.waterTables ?? []).find((w) => w.id === m.waterTableId)?.coordinates : d.waterTable?.value ?? null,
    ),
    // With engine defaults filled in, and without what the analysis does
    // not use: end capacities of fully anchored elements, the diameter of
    // a pile with a given force, whether a pile row is a wall (finite
    // elements only).
    reinforcements: (d.reinforcements ?? []).map(({ end1Capacity, end2Capacity, ...r }) => ({
      ...r,
      spacing: r.spacing ?? 1,
      direction: r.direction ?? "axial",
      application: r.application ?? "active",
      ...(r.pullout ? { end1Capacity: end1Capacity ?? 0, end2Capacity: end2Capacity ?? 0 } : {}),
    })),
    piles: (d.piles ?? []).map(({ diameter, ...withWall }) => {
      const p = { ...withWall };
      delete p.wall;
      return {
        ...p,
        ...(p.force == null ? { diameter } : {}),
        spacing: p.spacing ?? 1,
        angle: p.angle ?? 0,
        application: p.application ?? "active",
      };
    }),
    udls: d.udls ?? [],
    lineLoads: d.lineLoads ?? [],
    limits: d.analysisLimits ?? null,
    planes: d.customSearchPlanes ?? [],
    surfaces: (d.customSurfaces ?? []).map((s) => s.points),
    only: d.customPlanesOnly ?? false,
  };
}


describe("modelFromDefinition", () => {
  it.each(VERIFICATION_CASES.map((c) => [c.id, c] as const))("%s: the app sends the analysis the same slope", (_, c) => {
    const model = modelFromDefinition(c.definition, { id: c.id, name: c.title });
    const back = buildSlopeDTOFromModel(model);
    // The app sends the canonical form (right-to-left slopes mirrored).
    const given = analysed(toCanonicalSlopeDefinition(c.definition));
    const got = analysed(back);
    // Materials without a model get one from the flat fields.
    given.materials = given.materials.map((m, i) => ({ ...m, model: m.model ?? got.materials[i].model }));
    expect(got).toEqual(given);
  });

  it("refuses what it cannot carry over", () => {
    const base = VERIFICATION_CASES[0].definition;
    expect(() =>
      modelFromDefinition({ ...base, waterTable: { mode: "height", value: 3 } }, { id: "x", name: "x" }),
    ).toThrow(/not supported/);
  });

  it("gives a definition without an orientation the one the engine infers", () => {
    const leftFacing = VERIFICATION_CASES.find((c) => c.id === "V027")!.definition;
    expect(leftFacing.orientation).toBeUndefined();
    expect(modelFromDefinition(leftFacing, { id: "x", name: "x" }).orientation).toBe("rtl");
  });

  it("takes the analysis options on top of the app defaults", () => {
    const m = modelFromDefinition(VERIFICATION_CASES[0].definition, {
      id: "x",
      name: "x",
      options: { method: "Bishop", slices: 50 },
    });
    expect(m.options.method).toBe("Bishop");
    expect(m.options.slices).toBe(50);
  });
});
