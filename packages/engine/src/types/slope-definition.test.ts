import { describe, expect, it } from "vitest";
import { materialModelOf, withMaterialModel, type SlopeDefinition } from "./slope-definition";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import { buildSlope } from "../model/build-slope";
import { analyseSlope } from "../model/solvers";

const slope = (materials: SlopeDefinition["materials"]): SlopeDefinition => ({
  coordinates: [[0, 0], [0, 10], [10, 10], [30, 0]],
  materials,
});

describe("materials of a definition", () => {
  it("takes the model, and builds one from the flat fields of an older definition", () => {
    const model = { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 } as const;
    expect(materialModelOf({ name: "a", model })).toBe(model);
    expect(materialModelOf({ name: "b", unitWeight: 19, cohesion: 5, frictionAngle: 28 })).toEqual({
      kind: "mohr-coulomb",
      unitWeight: 19,
      cohesion: 5,
      frictionAngle: 28,
    });
    expect(() => materialModelOf({ name: "c" })).toThrow(/no model/);
  });

  it("keeps no flat fields next to the model", () => {
    const m = withMaterialModel({ name: "a", unitWeight: 0, cohesion: 0, frictionAngle: 0, model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 30 }, color: "#fff" });
    expect(m).toEqual({ name: "a", color: "#fff", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 30 } });
    const canonical = toCanonicalSlopeDefinition(slope([{ name: "a", unitWeight: 18, cohesion: 10, frictionAngle: 30 }]));
    expect(canonical.materials[0]).toEqual({ name: "a", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 30 } });
  });

  it("gives an older definition the result of the same material as a model", () => {
    const fos = (d: SlopeDefinition) => {
      const s = buildSlope(d);
      s.updateAnalysisOptions({ method: "Bishop", iterations: 200, refinedIterations: 50 });
      return analyseSlope(s);
    };
    const old = fos(slope([{ name: "a", unitWeight: 18, cohesion: 10, frictionAngle: 30 }]));
    const withModel = fos(slope([{ name: "a", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 30 } }]));
    expect(old).not.toBeNull();
    expect(old).toBe(withModel);
  });
});
