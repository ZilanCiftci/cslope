// @vitest-environment node
/** The engine's validation issues land at the form's fields. */
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine, validateDefinition } from "@cslope/engine";
import { EXCAVATION_EXAMPLES } from "../templates/excavation-examples";
import { excavationDocument } from "../templates/excavation";
import { issueField, issuesByField } from "./issues";

beforeAll(() => initEngine());

const params = EXCAVATION_EXAMPLES["clay-road-design-sk2"];

describe("the engine's issues at the fields", () => {
  it("maps the materials to the layers and the road's fill, the loads, the water and the factors", () => {
    expect(issueField("/definition/materials/0/model/undrainedShearStrength", params)).toBe("layers.0.su");
    expect(issueField("/definition/materials/0/model/unitWeight", params)).toBe("layers.0.gamma");
    expect(issueField("/definition/materials/1/model/frictionAngle", params)).toBe("road.phi");
    expect(issueField("/definition/regionAssignments/0/point", params)).toBe("layers.0.bottomLevel");
    expect(issueField("/definition/udls/0/magnitude", params)).toBe("road.trafficLoad");
    expect(issueField("/definition/waterTable/value", params)).toBe("waterLevel");
    expect(issueField("/options/partialFactors/cu", params)).toBe("values.etaCu");
    expect(issueField("/options/tensionCrackDepth", params)).toBe("tensionCrackDepth");
    expect(issueField("/definition/coordinates/3", params)).toBeNull();
    expect(issueField("/definition/materials/5/model/cohesion", params)).toBeNull();
  });

  it("puts a real issue of the engine at its field", () => {
    const doc = excavationDocument(params);
    (doc.definition.materials[0].model as { unitWeight: number }).unitWeight = -16;
    (doc.definition.materials[1].model as { frictionAngle: number }).frictionAngle = 95;
    const issues = validateDefinition(doc).filter((i) => i.severity === "error");
    expect(issues.length).toBeGreaterThan(0);
    const { fields, general } = issuesByField(issues, params);
    expect([...fields.keys()].sort()).toEqual(["layers.0.gamma", "road.phi"]);
    expect(general).toEqual([]);
  });
});
