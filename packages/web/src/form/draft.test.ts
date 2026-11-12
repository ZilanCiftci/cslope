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
import { embankmentDocument, type EmbankmentParams } from "../templates/embankment";
import { EXCAVATION_DEFAULTS, EXCAVATION_EXAMPLES } from "../templates/excavation-examples";
import { excavationDocument, type ExcavationParams } from "../templates/excavation";
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
      ["Crust", "mohr-coulomb", "1.5"],
      ["Clay", "undrained", "2"],
      ["Sand", "mohr-coulomb", "5.5"],
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
    expect((formState(d).params as ExcavationParams).road!.trafficLoad).toBeNull();
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
    expect((formState(on).params as ExcavationParams).road).toEqual(EXCAVATION_DEFAULTS.road);
    const off = withGroup(on, "road", false);
    expect((formState(off).params as ExcavationParams).road).toBeNull();
    expect(toQuery(off)).toBe(toQuery(plain()));
  });

  it("gives back every example of both templates through the address, to the same document", () => {
    for (const [name, params] of Object.entries(EMBANKMENT_EXAMPLES)) {
      const query = toQuery(draftOf("embankment", params));
      expect(new URLSearchParams(query).get("t"), name).toBe("embankment");
      const back = formState(fromQuery("?" + query));
      expect(back.ready, name).toBe(true);
      expect(back.params, name).toEqual(params);
      expect(embankmentDocument(back.params as EmbankmentParams), name).toEqual(embankmentDocument(params));
    }
    for (const [name, params] of Object.entries(EXCAVATION_EXAMPLES)) {
      const query = toQuery(draftOf("excavation", params));
      const back = formState(fromQuery("?" + query));
      expect(back.ready, name).toBe(true);
      expect(back.params, name).toEqual(params);
      expect(excavationDocument(back.params as ExcavationParams), name).toEqual(excavationDocument(params));
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
    expect(strengthSummary(d.layers[0])).toBe("Su\u00a025\u00a0kPa, +1.5\u00a0kPa/m");
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
    expect(rangeText(13.5, -1.5, -15)).toBe("13.5\u00a0m (−1.5 to −15\u00a0m)");
    expect(rangeText(1.5, 0, -1.5)).toBe("1.5\u00a0m (0 to −1.5\u00a0m)");
    expect(rangeText(2, NaN, NaN)).toBe("2\u00a0m");
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
      "layers.0.thickness": "Ends at −3.98 m, 0.02 m from the excavation bottom (−4 m): end it at the excavation bottom (4 m thick), or make it at most 3.95 m or at least 4.05 m thick.",
    });
    // On the bottom itself, it is taken (an excavation down to the top of a layer); 2 cm below it, refused with the same offer.
    d.layers[0].thickness = "4";
    expect(Object.fromEntries(formState(d).errors)).toEqual({});
    expect(formState(d).params.layers.map((l: Layer) => l.bottomLevel)).toEqual([-4, -22.5]);
    d.layers[0].thickness = "4.02";
    expect(Object.fromEntries(formState(d).errors)).toEqual({
      "layers.0.thickness": "Ends at −4.02 m, 0.02 m from the excavation bottom (−4 m): end it at the excavation bottom (4 m thick), or make it at most 3.95 m or at least 4.05 m thick.",
    });
    // Three layers, the middle one ending on the bottom: the crust 1.5 m, the clay 2.5 m, the gravel 5 m.
    d.layers[0].thickness = "1.5";
    d.layers[1].thickness = "2.5";
    d.layers.push({ ...d.layers[1], key: "gravel", name: "Gravel", thickness: "5" });
    expect(Object.fromEntries(formState(d).errors)).toEqual({});
    d.layers.pop();
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

  it("opens the bare excavation link at the defaults, the same section as the defaults' full link", () => {
    const full =
      "t=excavation&ground=0&H=3&slope=1&bottomWidth=2&water=-1&layers=3" +
      "&layer1.name=Crust&layer1.kind=mohr-coulomb&layer1.t=1.5&layer1.gamma=18&layer1.c=15&layer1.phi=0" +
      "&layer2.name=Clay&layer2.kind=undrained&layer2.t=2&layer2.gamma=16.5&layer2.su=18&layer2.suRate=1.2" +
      "&layer3.name=Sand&layer3.kind=mohr-coulomb&layer3.t=5.5&layer3.gamma=20&layer3.c=0&layer3.phi=38" +
      "&road=on&road.distanceFromCrest=1&road.width=4&road.height=0.3&road.gamma=20&road.c=0&road.phi=38&road.trafficLoad=20";
    expect(toQuery(fromQuery("?t=excavation"))).toBe(full);
    expect(formState(fromQuery("?" + full)).params).toEqual(EXCAVATION_DEFAULTS);
    expect(formState(fromQuery("?t=excavation")).params).toEqual(EXCAVATION_DEFAULTS);
  });

  it("keeps the meaning of links shared before the defaults changed: a link with layers says every field", () => {
    // The page's address at the earlier defaults: the same section today.
    const before =
      "?t=excavation&ground=0&H=2.5&slope=2&layers=3" +
      "&layer1.name=Dry+crust&layer1.kind=undrained&layer1.t=1&layer1.gamma=17&layer1.su=30" +
      "&layer2.name=Clay&layer2.kind=undrained&layer2.t=3&layer2.gamma=17&layer2.su=15" +
      "&layer3.name=Sand+and+gravel&layer3.kind=mohr-coulomb&layer3.t=5&layer3.gamma=22&layer3.c=0&layer3.phi=35" +
      "&road=on&road.distanceFromCrest=1&road.width=4&road.height=0.3&road.gamma=18&road.c=0&road.phi=39&road.trafficLoad=15";
    const earlier: ExcavationParams = {
      groundLevel: 0,
      excavationDepth: 2.5,
      slope: 2,
      bottomWidth: null,
      layers: [
        { name: "Dry crust", bottomLevel: -1, material: { kind: "undrained", gamma: 17, su: 30 } },
        { name: "Clay", bottomLevel: -4, material: { kind: "undrained", gamma: 17, su: 15 } },
        { name: "Sand and gravel", bottomLevel: -9, material: { kind: "drained", gamma: 22, c: 0, phi: 35 } },
      ],
      waterLevel: null,
      road: { distanceFromCrest: 1, width: 4, height: 0.3, fill: { gamma: 18, c: 0, phi: 39 }, trafficLoad: 15 },
    };
    expect("?" + toQuery(draftOf("excavation", earlier))).toBe(before);
    expect(formState(fromQuery(before)).params).toEqual(earlier);
    // A link with a few fields: the others stay empty (none is taken from the defaults), the road off.
    const few = fromQuery("?t=excavation&H=4&layers=1&layer1.kind=undrained&layer1.t=10&layer1.su=20");
    expect(few.fields).toEqual({ groundLevel: "", excavationDepth: "4", slope: "", bottomWidth: "", waterLevel: "" });
    expect(few.on).toEqual([]);
    expect(few.layers.map((l) => [l.thickness, l.gamma, l.su, l.suRate])).toEqual([["10", "", "20", ""]]);
    expect(formState(few).missing).toEqual(["groundLevel", "slope", "layers.0.gamma"]);
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
