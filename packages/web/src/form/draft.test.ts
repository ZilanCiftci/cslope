// @vitest-environment node
/**
 * The form's state: empty strengths keep it from running (B5), each
 * problem is at its field, and the address round-trips every example.
 */
import { describe, expect, it } from "vitest";
import { MATERIAL_MODEL_LABELS } from "@cslope/engine";
import type { Layer, Values } from "../templates/common";
import { EMBANKMENT_EXAMPLES } from "../templates/embankment-examples";
import { embankmentDocument } from "../templates/embankment";
import { EXCAVATION_EXAMPLES } from "../templates/excavation-examples";
import { excavationDocument } from "../templates/excavation";
import { draftOf, emptyLayer, LAYER_KINDS, strengthSummary, formState, fromQuery, initialDraft, nextBottomLevel, parseNumber, toQuery, withGroup, type Draft } from "./draft";

const filled = (): Draft => draftOf("excavation", EXCAVATION_EXAMPLES["clay-road-design-sk2"]);

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
    d.fields.excavationDepth = "30";
    d.layers[0].bottomLevel = "5";
    d.fields["road.width"] = "1";
    d.etaCu = "0";
    const s = formState(d);
    expect(Object.fromEntries(s.errors)).toEqual({
      excavationDepth: "Must be from 0.5 to 20 m.",
      "layers.0.bottomLevel": "Layer 1: the bottom level 5 must be at least 0.05 m below the ground (0).",
      "road.width": "Must be from 2 to 20 m.",
      "values.etaCu": "Must be at least 0.1.",
    });
    expect(s.ready).toBe(false);
  });

  it("leaves optional fields empty without a problem, and needs the safety class on design values", () => {
    const d = filled();
    d.fields.waterLevel = "";
    d.fields["road.trafficLoad"] = "";
    expect(formState(d).ready).toBe(true);
    expect(formState(d).params.road!.trafficLoad).toBeNull();
    d.safetyClass = "";
    expect(formState(d).missing).toEqual(["values.safetyClass"]);
    d.basis = "characteristic";
    expect(formState(d).ready).toBe(true);
  });

  it("starts the embankment with its geometry and without the fill's and the clay's strengths", () => {
    const s = formState(initialDraft("embankment"));
    expect(s.errors.size).toBe(0);
    expect(s.missing).toEqual(["fill.gamma", "fill.c", "fill.phi", "layers.0.gamma", "layers.0.su"]);
    expect(s.params).toMatchObject({ groundLevel: 0, embankmentHeight: 3, crestWidth: 6, slope: 2, crestLoad: null, waterLevel: null });
  });

  it("switches the road on with its size and off again", () => {
    const on = withGroup(initialDraft(), "road", true);
    expect(on.on).toEqual(["road"]);
    expect(formState(on).params.road).toMatchObject({ distanceFromCrest: 2, width: 4, height: 0.5, trafficLoad: null });
    expect(formState(on).missing).toContain("road.gamma");
    const off = withGroup(on, "road", false);
    expect(formState(off).params.road).toBeNull();
    expect(toQuery(off)).toBe(toQuery(initialDraft()));
  });

  it("gives back every example of both templates through the address, to the same document", () => {
    for (const [name, params] of Object.entries(EMBANKMENT_EXAMPLES)) {
      const query = toQuery(draftOf("embankment", params));
      expect(new URLSearchParams(query).get("t"), name).toBe("embankment");
      const back = formState(fromQuery("?" + query));
      expect(back.ready, name).toBe(true);
      expect(back.params, name).toEqual(params);
      expect(embankmentDocument(back.params), name).toEqual(embankmentDocument(params));
    }
    for (const [name, params] of Object.entries(EXCAVATION_EXAMPLES)) {
      const query = toQuery(draftOf("excavation", params));
      const back = formState(fromQuery("?" + query));
      expect(back.ready, name).toBe(true);
      expect(back.params, name).toEqual(params);
      expect(excavationDocument(back.params), name).toEqual(excavationDocument(params));
    }
  });

  it("names the layers' material models as the app does", () => {
    expect(LAYER_KINDS.map((k) => k.label)).toEqual(["Undrained", "Mohr-Coulomb", "Impenetrable (bedrock)"]);
    for (const k of LAYER_KINDS) expect(k.label).toBe(MATERIAL_MODEL_LABELS[k.kind]);
  });

  it("makes an Undrained layer with a rate Su increasing with depth, and without one constant", () => {
    const d = filled();
    expect(formState(d).params.layers[0].material).toEqual({ kind: "undrained", gamma: 16, su: 25 });
    d.layers[0].suRate = "1.5";
    expect(formState(d).params.layers[0].material).toEqual({ kind: "undrained-increasing", gamma: 16, su: 25, suRate: 1.5 });
    expect(strengthSummary(d.layers[0])).toBe("Su 25 kPa, +1.5 kPa/m");
    expect(toQuery(d)).toContain("layer1.kind=undrained&layer1.bottomLevel=-20&layer1.gamma=16&layer1.su=25&layer1.suRate=1.5");
  });

  it("opens older links: the old layer kinds, and without the removed fields (γsat, the tension crack)", () => {
    for (const [template, examples] of [
      ["excavation", EXCAVATION_EXAMPLES],
      ["embankment", EMBANKMENT_EXAMPLES],
    ] as const) {
      for (const [name, params] of Object.entries(examples as Record<string, { layers: Layer[]; values: Values; ponded?: boolean }>)) {
        const query = toQuery(draftOf(template, params));
        // The kinds as older links wrote them: Su increasing a kind of its own, Mohr-Coulomb "drained".
        const old = new URLSearchParams(query);
        params.layers.forEach((l, i) => {
          if (l.material.kind === "undrained-increasing" || l.material.kind === "drained") old.set(`layer${i + 1}.kind`, l.material.kind);
          if (l.material.kind === "drained") old.set(`layer${i + 1}.gammaSat`, "21");
        });
        old.set("crack", "1.5");
        old.set("fill.gammaSat", "22");
        old.set("road.gammaSat", "22");
        const back = formState(fromQuery("?" + old.toString()));
        expect(back.params, name).toEqual(params);
        const doc = template === "excavation" ? excavationDocument(back.params) : embankmentDocument(back.params);
        expect(doc, name).toEqual(template === "excavation" ? excavationDocument(params as never) : embankmentDocument(params as never));
      }
    }
  });

  it("keeps ponded water in the address only with a water level", () => {
    const d = filled();
    d.ponded = true;
    expect(new URLSearchParams(toQuery(d)).get("pond")).toBe("1");
    expect(formState(fromQuery("?" + toQuery(d))).params.ponded).toBe(true);
    d.fields.waterLevel = "";
    expect(new URLSearchParams(toQuery(d)).get("pond")).toBeNull();
    expect(formState(d).params.ponded).toBeUndefined();
    expect(fromQuery("?" + toQuery(filled())).ponded).toBe(false);
  });

  it("puts a new layer 5 m below the last, within the bounds", () => {
    expect(nextBottomLevel([emptyLayer("-15")])).toBe("-20");
    expect(nextBottomLevel([emptyLayer("-97,5")])).toBe("-100");
    expect(nextBottomLevel([emptyLayer("abc")])).toBe("");
  });

  it("opens an older link without the template as the excavation, and an unknown template as the excavation", () => {
    const old = toQuery(filled()).replace(/^t=excavation&/, "");
    expect(fromQuery("?" + old)).toEqual({ ...filled(), layers: expect.any(Array) });
    expect(formState(fromQuery("?" + old)).params).toEqual(EXCAVATION_EXAMPLES["clay-road-design-sk2"]);
    expect(fromQuery("?t=nonsense&layers=1").template).toBe("excavation");
  });

  it("writes a readable address with only the filled fields", () => {
    const q = toQuery(filled());
    expect(q).toBe(
      "t=excavation&ground=0&H=4&slope=2&water=-1&layers=1&layer1.kind=undrained&layer1.bottomLevel=-20&layer1.gamma=16&layer1.su=25" +
        "&road=on&road.distanceFromCrest=3&road.width=4&road.height=0.8&road.gamma=20&road.c=0&road.phi=38&road.trafficLoad=20" +
        "&values=design&safetyClass=2&etaCu=1&etaDrained=1&variableLoadBase=1.3",
    );
    expect(toQuery(fromQuery(""))).toEqual(toQuery(initialDraft()));
    expect(toQuery(fromQuery("?t=embankment"))).toEqual(toQuery(initialDraft("embankment")));
    expect(toQuery(draftOf("embankment", EMBANKMENT_EXAMPLES["clay-3m-traffic"]))).toBe(
      "t=embankment&ground=0&h=3&B=6&slope=2.5&fill.gamma=19&fill.c=0&fill.phi=35&q=20&water=-1" +
        "&layers=1&layer1.name=Clay&layer1.kind=undrained&layer1.bottomLevel=-15&layer1.gamma=16&layer1.su=15",
    );
    expect(fromQuery("?layers=1&values=design&safetyClass=2.0").safetyClass).toBe("2");
    expect(fromQuery("?layers=99&layer1.kind=nonsense").layers).toHaveLength(12);
    expect(fromQuery("?layers=1&layer1.kind=nonsense").layers[0].kind).toBe("undrained");
  });
});
