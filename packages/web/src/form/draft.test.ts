// @vitest-environment node
/**
 * The form's state: the excavation's first visit is complete, empty
 * strengths keep a form from running, each
 * problem is at its field, and the address round-trips every example.
 */
import { describe, expect, it } from "vitest";
import { MATERIAL_MODEL_LABELS } from "@cslope/engine";
import type { Layer } from "../templates/common";
import { EMBANKMENT_EXAMPLES } from "../templates/embankment-examples";
import { embankmentDocument } from "../templates/embankment";
import { EXCAVATION_DEFAULTS, EXCAVATION_EXAMPLES } from "../templates/excavation-examples";
import { excavationDocument } from "../templates/excavation";
import { LAYER_COLORS } from "../templates/colors";
import { draftOf, draftLevels, emptyLayer, LAYER_KINDS, moveLayer, strengthSummary, formState, fromQuery, initialDraft, parseNumber, toQuery, withGroup, withNewLayer, type Draft } from "./draft";
import { bottomLevels, rangeText, thicknesses } from "./layers";

const filled = (): Draft => draftOf("excavation", EXCAVATION_EXAMPLES["clay-road"]);
/** A plain excavation: one clay layer without strengths, no road. */
const plain = (): Draft => ({ template: "excavation", fields: { groundLevel: "0", excavationDepth: "3", slope: "1.5" }, on: [], layers: [{ ...emptyLayer("15"), name: "Clay" }], ponded: false });

describe("the form's state", () => {
  it("starts the excavation complete with its defaults, the road on: ready, nothing missing", () => {
    const first = initialDraft();
    expect(first.on).toEqual(["road"]);
    expect(first.layers.map((l) => [l.name, l.kind, l.thickness])).toEqual([
      ["Dry crust", "undrained", "1"],
      ["Clay", "undrained", "3"],
      ["Sand and gravel", "mohr-coulomb", "5"],
    ]);
    const f = formState(first);
    expect(f.missing).toEqual([]);
    expect(f.errors.size).toBe(0);
    expect(f.ready).toBe(true);
    expect(f.params).toEqual(EXCAVATION_DEFAULTS);
    // An address without the road has it off.
    expect(fromQuery("?" + toQuery(plain())).on).toEqual([]);
  });

  it("asks for the strengths of a section without them: not ready, nothing marked red", () => {
    const s = formState(plain());
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
    d.layers[0].thickness = "0.01";
    d.fields["road.width"] = "1";
    const s = formState(d);
    expect(Object.fromEntries(s.errors)).toEqual({
      excavationDepth: "Must be from 0.5 to 20 m.",
      "layers.0.thickness": "Must be at least 0.05 m.",
      "road.width": "Must be from 2 to 20 m.",
    });
    expect(s.ready).toBe(false);
  });

  it("leaves optional fields empty without a problem", () => {
    const d = filled();
    d.fields.waterLevel = "";
    d.fields["road.trafficLoad"] = "";
    expect(formState(d).ready).toBe(true);
    expect(formState(d).params.road!.trafficLoad).toBeNull();
  });

  it("starts the embankment with its geometry and without the fill's and the clay's strengths", () => {
    const s = formState(initialDraft("embankment"));
    expect(s.errors.size).toBe(0);
    expect(s.missing).toEqual(["fill.gamma", "fill.c", "fill.phi", "layers.0.gamma", "layers.0.su"]);
    expect(s.params).toMatchObject({ groundLevel: 0, embankmentHeight: 3, crestWidth: 6, slope: 2, crestLoad: null, waterLevel: null });
  });

  it("switches the road on with its size and off again", () => {
    const on = withGroup(plain(), "road", true);
    expect(on.on).toEqual(["road"]);
    // The first visit's road.
    expect(formState(on).params.road).toEqual(EXCAVATION_DEFAULTS.road);
    const off = withGroup(on, "road", false);
    expect(formState(off).params.road).toBeNull();
    expect(toQuery(off)).toBe(toQuery(plain()));
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
    expect(toQuery(d)).toContain("layer1.kind=undrained&layer1.t=20&layer1.gamma=16&layer1.su=25&layer1.suRate=1.5");
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

  it("adds a layer 5 m thick at the bottom and inserts one 1 m thick, within the lowest level, each with the next free color", () => {
    const d = plain();
    const added = withNewLayer(d, 1);
    expect(added.layers.map((l) => l.thickness)).toEqual(["15", "5"]);
    expect(added.layer).toBe(added.layers[1]);
    expect(added.layer.color).toBe(LAYER_COLORS[1].color);
    const inserted = withNewLayer({ ...d, layers: added.layers }, 0);
    expect(inserted.layers.map((l) => l.thickness)).toEqual(["1", "15", "5"]);
    // The first layer's color is taken: the new one gets the first free one.
    expect(inserted.layer.color).toBe(LAYER_COLORS[2].color);
    expect(withNewLayer({ ...d, layers: [{ ...d.layers[0], thickness: "97.5" }] }, 1).layer.thickness).toBe("2.5");
    expect(withNewLayer({ ...d, layers: [{ ...d.layers[0], thickness: "abc" }] }, 1).layer.thickness).toBe("5");
  });

  it("turns thicknesses into bottom levels from the ground and back, without the rest of a sum", () => {
    expect(bottomLevels(0, [1.5, 13.5])).toEqual([-1.5, -15]);
    expect(bottomLevels(30.2, [0.4, 0.1, 0.2])).toEqual([29.8, 29.7, 29.5]);
    expect(bottomLevels(0, [1, NaN, 2])).toEqual([-1, NaN, NaN]);
    expect(thicknesses(30.2, [29.8, 29.7, 29.5])).toEqual([0.4, 0.1, 0.2]);
    expect(thicknesses(0, [-1.5, -15])).toEqual([1.5, 13.5]);
    expect(rangeText(13.5, -1.5, -15)).toBe("13.5 m (−1.5 to −15 m)");
    expect(rangeText(1.5, 0, -1.5)).toBe("1.5 m (0 to −1.5 m)");
    expect(rangeText(2, NaN, NaN)).toBe("2 m");
    const d = draftOf("excavation", EXCAVATION_EXAMPLES["crust-over-clay"]);
    expect(d.layers.map((l) => l.thickness)).toEqual(["1.5", "18.5"]);
    expect(draftLevels(d)).toEqual(EXCAVATION_EXAMPLES["crust-over-clay"].layers.map((l) => l.bottomLevel));
  });

  it("moves a layer with its thickness: the levels below follow, and the problems stay with the layer's fields", () => {
    const d = draftOf("excavation", EXCAVATION_EXAMPLES["crust-over-clay"]);
    const [crust, clay] = d.layers;
    expect(moveLayer(d.layers, 0, -1)).toBe(d.layers);
    expect(moveLayer(d.layers, 1, 2)).toBe(d.layers);
    const moved = { ...d, layers: moveLayer(d.layers, 1, 0) };
    expect(moved.layers).toEqual([clay, crust]);
    expect(draftLevels(moved)).toEqual([-18.5, -20]);
    // The crust's c′ is wrong: its problem follows it to the second place.
    moved.layers[1] = { ...crust, c: "-1" };
    const s = formState(moved);
    expect([...s.errors.keys()]).toEqual(["layers.1.c"]);
    expect(s.params.layers.map((l: Layer) => l.name)).toEqual(["Clay", "Crust"]);
    // The colors stay with the layers: written when not the position's own.
    expect(s.params.layers.map((l: Layer) => l.color)).toEqual([clay.color, crust.color]);
    expect(new URLSearchParams(toQuery(moved)).get("layer1.color")).toBe(clay.color.slice(1));
    expect(fromQuery("?" + toQuery(moved)).layers.map((l) => l.color)).toEqual([clay.color, crust.color]);
  });

  it("checks the thicknesses with the template's rules, in words for a thickness", () => {
    const d = draftOf("excavation", EXCAVATION_EXAMPLES["crust-over-clay"]);
    // The excavation is 4 m deep: a layer that ends 2 cm from its bottom, then layers that end above it.
    d.layers[0].thickness = "3.98";
    expect(Object.fromEntries(formState(d).errors)).toEqual({
      "layers.0.thickness": "Ends at −3.98 m, within 0.05 m of the excavation bottom (−4 m): make it at most 3.95 m or at least 4.05 m thick.",
    });
    d.layers[0].thickness = "1";
    d.layers[1].thickness = "2.5";
    expect(Object.fromEntries(formState(d).errors)).toEqual({
      "layers.1.thickness": "The layers must reach at least 0.05 m below the excavation bottom (−4 m), 4.05 m in all: make this one at least 3.05 m thick.",
    });
    d.layers[1].thickness = "120";
    expect(Object.fromEntries(formState(d).errors)).toEqual({
      "layers.1.thickness": "Must be at most 99 m: the layer would end at −121 m, below the lowest level (−100 m).",
    });
    d.layers[1].thickness = "0";
    expect(formState(d).errors.get("layers.1.thickness")).toBe("Must be at least 0.05 m.");
    // A wrong ground level is its own problem; the thicknesses are not checked against it.
    d.layers[1].thickness = "18.5";
    d.fields.groundLevel = "2000";
    expect([...formState(d).errors.keys()]).toEqual(["groundLevel"]);
  });

  it("opens an unknown template as the excavation", () => {
    expect(fromQuery("?t=nonsense&layers=1").template).toBe("excavation");
  });

  it("writes a readable address with only the filled fields", () => {
    const q = toQuery(filled());
    expect(q).toBe(
      "t=excavation&ground=0&H=4&slope=2&water=-1&layers=1&layer1.kind=undrained&layer1.t=20&layer1.gamma=16&layer1.su=25" +
        "&road=on&road.distanceFromCrest=3&road.width=4&road.height=0.8&road.gamma=20&road.c=0&road.phi=38&road.trafficLoad=20",
    );
    expect(toQuery(fromQuery(""))).toEqual(toQuery(initialDraft()));
    expect(toQuery(fromQuery("?t=embankment"))).toEqual(toQuery(initialDraft("embankment")));
    expect(toQuery(draftOf("embankment", EMBANKMENT_EXAMPLES["clay-3m-traffic"]))).toBe(
      "t=embankment&ground=0&h=3&B=6&slope=2.5&fill.gamma=19&fill.c=0&fill.phi=35&q=20&water=-1" +
        "&layers=1&layer1.name=Clay&layer1.kind=undrained&layer1.t=15&layer1.gamma=16&layer1.su=15",
    );
    expect(fromQuery("?layers=99&layer1.kind=nonsense").layers).toHaveLength(12);
    expect(fromQuery("?layers=1&layer1.kind=nonsense").layers[0].kind).toBe("undrained");
  });
});
