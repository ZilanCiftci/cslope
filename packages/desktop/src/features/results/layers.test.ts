import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@cslope/engine";
import {
  annotationsInLayerOrder,
  baseLayerCount,
  defaultLayers,
  layerSteps,
  mergeLayerOrder,
  movedLayerOrder,
  normalizeLayerOrder,
  resultLayerKeys,
  resultLayers,
  type LayerSource,
} from "./layers";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";
import type { Annotation, BackgroundImage, ResultViewSettings } from "../../store/types";

const ANNOS: Annotation[] = [
  { id: "t", type: "text", x: 0.1, y: 0.1, text: "Hello" },
  { id: "r", type: "reference", shape: "polyline", points: [[0, 0], [1, 1]] },
  { id: "m", type: "material-table", x: 0.9, y: 0.05 },
];

const CS = { cx: 10, cy: 12, radius: 10, fos: 1.2, entryPoint: [2, 8], exitPoint: [18, 2] };

function src(over: Partial<ResultViewSettings> = {}, extra: Partial<LayerSource> = {}): LayerSource {
  return {
    // (the grid off unless a test turns it on: its place is tested on its own)
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, showGrid: false, annotations: ANNOS, ...over },
    result: { criticalSurface: CS } as unknown as AnalysisResult,
    ...extra,
  };
}

const drawing = (id: string, order: number, over: Partial<BackgroundImage> = {}): BackgroundImage => ({
  id,
  assetId: "a",
  calibration: { mode: "drawing", points: [] },
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  opacity: 1,
  visible: true,
  order,
  showInResults: true,
  ...over,
});

describe("result layers", () => {
  it("lists the layers drawn in the order the result was always drawn in (bottom first)", () => {
    const keys = resultLayerKeys(
      src(
        { surfaceDisplay: "all", showCustomSurfaces: true, showFemMesh: true },
        {
          result: { criticalSurface: CS, fem: {}, customSurfaces: [{ surface: CS }] } as unknown as AnalysisResult,
          backgrounds: [drawing("b", 2), drawing("a", 1), drawing("hidden", 0, { showInResults: false }), drawing("off", 3, { visible: false })],
        },
      ),
    );
    expect(keys).toEqual([
      "soilColor",
      "drawing:a",
      "drawing:b",
      "femMesh",
      "femPlasticZone",
      "r",
      "customSurfaces",
      "surfaces",
      "slices",
      "center",
      "fosLabel",
      "t",
      "m",
    ]);
  });

  it("leaves out the display layers turned off and those with nothing to draw", () => {
    const keys = resultLayerKeys(
      src({ showSoilColor: false, showSlices: false, showCustomSurfaces: true }, { result: null }),
    );
    expect(keys).toEqual(["r", "surfaces", "center", "fosLabel", "t", "m"]);
    // The surfaces layer turned off: no surface at all, the critical one neither.
    expect(resultLayerKeys(src({ showSurfaces: false, surfaceDisplay: "all" }))).not.toContain("surfaces");
  });

  it("applies the stored order, putting a new paper annotation on top and a new reference at its default place", () => {
    const s = src({ layerOrder: ["fosLabel", "soilColor", "m", "slices", "surfaces", "center", "gone", "t"] });
    const added: Annotation[] = [...ANNOS, { id: "t2", type: "text", x: 0, y: 0 }, { id: "r2", type: "reference", shape: "polyline", points: [] }];
    const keys = resultLayerKeys({ ...s, resultViewSettings: { ...s.resultViewSettings, annotations: added } });
    // r, r2 after soilColor (their default predecessor), t2 on top
    expect(keys).toEqual(["fosLabel", "soilColor", "r", "r2", "m", "slices", "surfaces", "center", "t", "t2"]);
  });

  it("is the default order without a stored one, and for an empty one", () => {
    expect(resultLayerKeys(src({ layerOrder: [] }))).toEqual(defaultLayers(src()).map((l) => l.key));
    expect(mergeLayerOrder(undefined, ["a", "b"], () => false)).toEqual(["a", "b"]);
  });

  it("moves a layer and remembers where the layers turned off were", () => {
    const s = src({ layerOrder: ["slices", "soilColor"], showSlices: false });
    // slices is off: soilColor, r, criticalSurface, center, fosLabel, t, m
    const order = movedLayerOrder(s, "soilColor", 3);
    expect(order).toEqual(["slices", "r", "surfaces", "center", "soilColor", "fosLabel", "t", "m"]);
    // turned on again: back where it was, under the reference line
    expect(resultLayerKeys(src({ layerOrder: order }))).toEqual(["slices", "r", "surfaces", "center", "soilColor", "fosLabel", "t", "m"]);
  });

  it("drops the keys of removed annotations and drawings when it stores an order", () => {
    const s = src({ layerOrder: ["old-anno", "drawing:old", "soilColor"] }, { backgrounds: [drawing("kept", 0, { showInResults: false })] });
    const order = movedLayerOrder({ ...s, resultViewSettings: { ...s.resultViewSettings, layerOrder: [...s.resultViewSettings.layerOrder!, "drawing:kept"] } }, "m", 0);
    expect(order).not.toContain("old-anno");
    expect(order).not.toContain("drawing:old");
    expect(order).toContain("drawing:kept");
    expect(order[0]).toBe("m");
  });

  it("orders the annotations as drawn, for the hit test (topmost last)", () => {
    expect(annotationsInLayerOrder(src({ layerOrder: ["m", "t"] })).map((a) => a.id)).toEqual(["m", "r", "t"]);
  });

  it("reads the critical surface's old layer as the surfaces layer, in the place of the first of the two", () => {
    expect(normalizeLayerOrder(["soilColor", "surfaces", "customSurfaces", "criticalSurface", "slices"], ANNOS)).toEqual([
      "soilColor",
      "surfaces",
      "customSurfaces",
      "slices",
    ]);
    expect(normalizeLayerOrder(["criticalSurface", "slices", "surfaces", "t"], ANNOS)).toEqual(["surfaces", "slices", "t"]);
    expect(normalizeLayerOrder(["criticalSurface"], ANNOS)).toEqual(["surfaces"]);
  });

  it("normalizes a stored order read from a file", () => {
    expect(normalizeLayerOrder(["soilColor", 3, "soilColor", "t", "nope", "drawing:", "drawing:x", "r"], ANNOS)).toEqual(["soilColor", "t", "drawing:x", "r"]);
    expect(normalizeLayerOrder("soilColor", ANNOS)).toBeUndefined();
    expect(normalizeLayerOrder(["nope"], ANNOS)).toBeUndefined();
  });

  it("draws the slices, center and FOS label with the critical surface while they follow it in their default order", () => {
    const steps = (order?: string[]) => layerSteps(resultLayers(src({ layerOrder: order })));
    expect(steps()).toContainEqual({ kind: "critical", withSlices: true, withCenter: true, withFosLabel: true });
    // the FOS label on top: drawn on its own, after the annotations
    const top = steps(["soilColor", "r", "surfaces", "slices", "center", "t", "m", "fosLabel"]);
    expect(top).toContainEqual({ kind: "critical", withSlices: true, withCenter: true, withFosLabel: false });
    expect(top.at(-1)).toEqual({ kind: "display", layer: "fosLabel" });
    // the center under the slices: the slices on their own
    const swapped = steps(["soilColor", "r", "surfaces", "center", "slices", "fosLabel", "t", "m"]);
    expect(swapped).toContainEqual({ kind: "critical", withSlices: false, withCenter: true, withFosLabel: false });
    expect(swapped.filter((s) => s.kind === "display").map((s) => (s.kind === "display" ? s.layer : ""))).toEqual(["soilColor", "slices", "fosLabel"]);
  });

  it("draws runs of reference lines and of drawings as one step each", () => {
    const annos: Annotation[] = [...ANNOS, { id: "r2", type: "reference", shape: "polyline", points: [] }];
    const s = src({ annotations: annos }, { backgrounds: [drawing("a", 0), drawing("b", 1)] });
    const st = layerSteps(resultLayers(s));
    expect(st.filter((x) => x.kind === "references")).toHaveLength(1);
    expect(st.filter((x) => x.kind === "drawings")).toHaveLength(1);
  });
});

describe("listed layers (Properties › Layers)", () => {
  it("lists the built-in layers turned off where they stand; the renderers take only those drawn", () => {
    const s = src({ showSlices: false, showSurfaces: false, annotations: ANNOS.filter((a) => a.type !== "material-table") });
    expect(resultLayerKeys(s)).not.toContain("slices");
    const listed = resultLayers(s, true);
    expect(listed.filter((l) => l.off).map((l) => l.key)).toEqual(["grid", "surfaces", "slices", "material-table", "color-bar"]);
    // Off layers of a kind the result has nothing for are not listed.
    expect(listed.map((l) => l.key)).not.toContain("femMesh");
    expect(listed.map((l) => l.key)).not.toContain("customSurfaces");
    // The custom surfaces are listed with custom planes in the model, before a run too.
    const planes = resultLayers({ ...s, result: null, hasCustomPlanes: true }, true);
    expect(planes.find((l) => l.key === "customSurfaces")?.off).toBe(true);
    const on = resultLayers({ ...src({ showCustomSurfaces: true }), result: null, hasCustomPlanes: true }, true);
    expect(on.find((l) => l.key === "customSurfaces")?.off).toBeUndefined();
    expect(resultLayerKeys({ ...src({ showCustomSurfaces: true }), result: null, hasCustomPlanes: true })).not.toContain("customSurfaces");
  });

  it("lists a hidden material table off where it stands; the renderers and the hit test leave it out", () => {
    const annos = ANNOS.map((a): Annotation => (a.id === "m" && a.type !== "reference" ? { ...a, hidden: true } : a));
    const s = src({ annotations: annos, layerOrder: ["soilColor", "r", "surfaces", "slices", "center", "fosLabel", "m", "t"] });
    expect(resultLayerKeys(s)).not.toContain("m");
    expect(annotationsInLayerOrder(s).map((a) => a.id)).not.toContain("m");
    const listed = resultLayers(s, true);
    expect(listed.find((l) => l.key === "m")?.off).toBe(true);
    // in its place: under the text, as stored
    expect(listed.map((l) => l.key).slice(-3)).toEqual(["m", "t", "color-bar"]);
    const order = movedLayerOrder(s, "t", 0, true);
    expect(order).toContain("m");
    expect(order).not.toContain("color-bar");
  });
  it("lists the grid as a built-in layer over the soil colors and drawings, under the model's lines, on or off by showGrid", () => {
    const on = src({ showGrid: true }, { backgrounds: [drawing("a", 1)] });
    expect(resultLayerKeys(on).slice(0, 4)).toEqual(["soilColor", "drawing:a", "grid", "r"]);
    // drawn with the model's base drawing (under its lines), as always
    expect(baseLayerCount(resultLayers(on))).toBe(3);
    // off: not drawn, listed greyed where it stands
    const off = src({ showGrid: false });
    expect(resultLayerKeys(off)).not.toContain("grid");
    expect(resultLayers(off, true).find((l) => l.key === "grid")).toMatchObject({ kind: "display", off: true });
    // moved over the surfaces: a step of its own, over the model's lines
    const moved = src({ showGrid: true, layerOrder: ["soilColor", "r", "surfaces", "grid"] });
    const layers = resultLayers(moved);
    expect(baseLayerCount(layers)).toBe(1);
    expect(layerSteps(layers.slice(1))).toContainEqual({ kind: "display", layer: "grid" });
    // a stored order of an older file (without the grid) puts it in its default place
    expect(resultLayerKeys(src({ showGrid: true, layerOrder: ["soilColor", "r", "surfaces"] })).slice(0, 2)).toEqual(["soilColor", "grid"]);
    expect(normalizeLayerOrder(["grid", "soilColor"], [])).toEqual(["grid", "soilColor"]);
  });
});
