// @vitest-environment node
/** The engine's validation issues land at the form's fields. */
import { beforeAll, describe, expect, it } from "vitest";
import { initEngine, validateDefinition } from "@cslope/engine";
import { EXCAVATION_EXAMPLES } from "../templates/excavation-examples";
import { excavationDocument } from "../templates/excavation";
import { EMBANKMENT_EXAMPLES } from "../templates/embankment-examples";
import { embankmentDocument } from "../templates/embankment";
import { draftFields, draftOf } from "./draft";
import { issueField, issuesByField } from "./issues";
import { embankmentSpec, excavationSpec } from "./specs";

beforeAll(() => initEngine());

const params = EXCAVATION_EXAMPLES["clay-road-design-sk2"];
const targets = excavationSpec.targets(params);
/** The fields the form shows for these parameters. */
const shown = new Set(draftFields(draftOf("excavation", params)).map(([f]) => f));

describe("the engine's issues at the fields", () => {
  it("maps the materials to the layers and the road's fill, the loads, the water and the factors", () => {
    expect(issueField("/definition/materials/0/model/undrainedShearStrength", targets)).toBe("layers.0.su");
    expect(issueField("/definition/materials/0/model/unitWeight", targets)).toBe("layers.0.gamma");
    expect(issueField("/definition/materials/1/model/frictionAngle", targets)).toBe("road.phi");
    expect(issueField("/definition/regionAssignments/0/point", targets)).toBe("layers.0.bottomLevel");
    expect(issueField("/definition/udls/0/magnitude", targets)).toBe("road.trafficLoad");
    expect(issueField("/definition/waterTable/value", targets)).toBe("waterLevel");
    expect(issueField("/options/partialFactors/cu", targets)).toBe("values.etaCu");
    expect(issueField("/options/tensionCrackDepth", targets)).toBe("tensionCrackDepth");
    expect(issueField("/definition/coordinates/3", targets)).toBeNull();
    expect(issueField("/definition/materials/5/model/cohesion", targets)).toBeNull();
  });

  it("maps the embankment's materials to the layers and the fill, its load and its region", () => {
    const p = EMBANKMENT_EXAMPLES["crust-over-clay"];
    const t = embankmentSpec.targets(p);
    expect(issueField("/definition/materials/1/model/undrainedShearStrength", t)).toBe("layers.1.su");
    expect(issueField("/definition/materials/2/model/frictionAngle", t)).toBe("fill.phi");
    expect(issueField("/definition/regionAssignments/2/point", t)).toBe("embankmentHeight");
    expect(issueField("/definition/udls/0/magnitude", t)).toBe("crestLoad");
    expect(issueField("/definition/materials/3/model/cohesion", t)).toBeNull();
    const doc = embankmentDocument(p);
    (doc.definition.materials[2].model as { cohesion: number }).cohesion = -1;
    const issues = validateDefinition(doc).filter((i) => i.severity === "error");
    const { fields } = issuesByField(issues, t, new Set(draftFields(draftOf("embankment", p)).map(([f]) => f)));
    expect([...fields.keys()]).toEqual(["fill.c"]);
  });

  it("puts a real issue of the engine at its field", () => {
    const doc = excavationDocument(params);
    (doc.definition.materials[0].model as { unitWeight: number }).unitWeight = -16;
    (doc.definition.materials[1].model as { frictionAngle: number }).frictionAngle = 95;
    const issues = validateDefinition(doc).filter((i) => i.severity === "error");
    expect(issues.length).toBeGreaterThan(0);
    const { fields, general } = issuesByField(issues, targets, shown);
    expect([...fields.keys()].sort()).toEqual(["layers.0.gamma", "road.phi"]);
    expect(general).toEqual([]);
  });

  it("keeps warnings off the fields, reads past the material's name, and lists issues of fields not shown", () => {
    const issue = (message: string, severity: "error" | "warning" = "error") => ({ path: "/definition/materials/0/model", code: "invalid-material-model", message, severity });
    const named = issue('Material "Rate": Unit weight (γ) must be a positive number.');
    const warning = issue('Material "Layer 1": Unit weight (γ) is low.', "warning");
    const hidden = issue('Material "Layer 1": Saturated unit weight (γsat) must be a positive number.');
    const r = issuesByField([named, warning, hidden], targets, shown);
    expect(Object.fromEntries(r.fields)).toEqual({ "layers.0.gamma": named.message });
    expect(r.warnings).toEqual([warning]);
    expect(r.general).toEqual([hidden]);
  });
});
