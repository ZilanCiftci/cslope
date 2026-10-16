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
    udls: d.udls ?? [],
    lineLoads: d.lineLoads ?? [],
    limits: d.analysisLimits ?? null,
    planes: d.customSearchPlanes ?? [],
    surfaces: (d.customSurfaces ?? []).map((s) => s.points),
    only: d.customPlanesOnly ?? false,
  };
}

const convertible = VERIFICATION_CASES.filter((c) => {
  try {
    modelFromDefinition(c.definition, { id: c.id, name: c.title });
    return true;
  } catch {
    return false;
  }
});

describe("modelFromDefinition", () => {
  it("converts most verification problems", () => {
    expect(convertible.length).toBeGreaterThan(VERIFICATION_CASES.length / 2);
  });

  it.each(convertible.map((c) => [c.id, c] as const))("%s: the app sends the analysis the same slope", (_, c) => {
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
