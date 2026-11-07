// @vitest-environment node
/**
 * The form's state: empty strengths keep it from running (B5), each
 * problem is at its field, and the address round-trips every example.
 */
import { describe, expect, it } from "vitest";
import { EXCAVATION_EXAMPLES } from "../templates/excavation-examples";
import { excavationDocument } from "../templates/excavation";
import { draftOf, formState, fromQuery, initialDraft, parseNumber, toQuery, type Draft } from "./draft";

const filled = (): Draft => draftOf(EXCAVATION_EXAMPLES["clay-road-design-sk2"]);

describe("the form's state", () => {
  it("starts with the geometry and without strengths: not ready, nothing marked red", () => {
    const s = formState(initialDraft());
    expect(s.ready).toBe(false);
    expect(s.errors.size).toBe(0);
    expect(s.missing).toEqual(["layers.0.gamma", "layers.0.su"]);
  });

  it("reads numbers with a decimal point or comma; text is an error at its field", () => {
    expect(parseNumber(" 1,5 ")).toBe(1.5);
    expect(parseNumber("-2")).toBe(-2);
    expect(parseNumber("−2")).toBe(-2);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("1.2.3")).toBeNaN();
    const d = filled();
    d.layers[0].su = "abc";
    expect(formState(d).errors.get("layers.0.su")).toBe("Enter a number, such as 1.5.");
    expect(formState(d).ready).toBe(false);
  });

  it("puts the template's problems at their fields", () => {
    const d = filled();
    d.excavationDepth = "30";
    d.layers[0].bottomLevel = "5";
    d.road!.width = "1";
    d.etaCu = "2";
    const s = formState(d);
    expect(Object.fromEntries(s.errors)).toEqual({
      excavationDepth: "Excavation depth H (m) must be from 0.5 to 20 m.",
      "layers.0.bottomLevel": "Layer 1: the bottom level 5 must be at least 0.05 m below the ground (0).",
      "road.width": "Road: Width (m) must be from 2 to 20 m.",
      "values.etaCu": "η undrained must be from 0.5 to 1.2.",
    });
    expect(s.ready).toBe(false);
  });

  it("leaves optional fields empty without a problem, and needs the safety class on design values", () => {
    const d = filled();
    d.waterLevel = "";
    d.road!.trafficLoad = "";
    expect(formState(d).ready).toBe(true);
    expect(formState(d).params.road!.trafficLoad).toBeNull();
    d.safetyClass = "";
    expect(formState(d).missing).toEqual(["values.safetyClass"]);
    d.basis = "characteristic";
    expect(formState(d).ready).toBe(true);
  });

  it("gives back every example through the address, to the same document", () => {
    for (const [name, params] of Object.entries(EXCAVATION_EXAMPLES)) {
      const query = toQuery(draftOf(params));
      const back = formState(fromQuery("?" + query));
      expect(back.ready, name).toBe(true);
      expect(back.params, name).toEqual(params);
      expect(excavationDocument(back.params), name).toEqual(excavationDocument(params));
    }
  });

  it("writes a readable address with only the filled fields", () => {
    const q = toQuery(filled());
    expect(q).toBe(
      "ground=0&H=4&slope=2&water=-1&layers=1&layer1.kind=undrained&layer1.bottomLevel=-20&layer1.gamma=16&layer1.su=25" +
        "&road=on&road.distanceFromCrest=3&road.width=4&road.height=0.8&road.gamma=20&road.c=0&road.phi=38&road.trafficLoad=20" +
        "&values=design&safetyClass=2&etaCu=1&etaDrained=1&variableLoadBase=1.3",
    );
    expect(fromQuery("")).toEqual(initialDraft());
    expect(fromQuery("?layers=99&layer1.kind=nonsense").layers).toHaveLength(12);
    expect(fromQuery("?layers=1&layer1.kind=nonsense").layers[0].kind).toBe("undrained");
  });
});
