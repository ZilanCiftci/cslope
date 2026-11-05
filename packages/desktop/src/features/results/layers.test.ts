import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@cslope/engine";
import {
  annotationsInLayerOrder,
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
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: ANNOS, ...over },
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
      "surfaces",
      "customSurfaces",
      "criticalSurface",
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
    expect(keys).toEqual(["r", "center", "fosLabel", "t", "m"]);
  });

  it("applies the stored order, putting a new paper annotation on top and a new reference at its default place", () => {
    const s = src({ layerOrder: ["fosLabel", "soilColor", "m", "slices", "criticalSurface", "center", "gone", "t"] });
    const added: Annotation[] = [...ANNOS, { id: "t2", type: "text", x: 0, y: 0 }, { id: "r2", type: "reference", shape: "polyline", points: [] }];
    const keys = resultLayerKeys({ ...s, resultViewSettings: { ...s.resultViewSettings, annotations: added } });
    // r, r2 after soilColor (their default predecessor), t2 on top
    expect(keys).toEqual(["fosLabel", "soilColor", "r", "r2", "m", "slices", "criticalSurface", "center", "t", "t2"]);
  });

  it("is the default order without a stored one, and for an empty one", () => {
    expect(resultLayerKeys(src({ layerOrder: [] }))).toEqual(defaultLayers(src()).map((l) => l.key));
    expect(mergeLayerOrder(undefined, ["a", "b"], () => false)).toEqual(["a", "b"]);
  });

  it("moves a layer and remembers where the layers turned off were", () => {
    const s = src({ layerOrder: ["slices", "soilColor"], showSlices: false });
    // slices is off: soilColor, r, criticalSurface, center, fosLabel, t, m
    const order = movedLayerOrder(s, "soilColor", 3);
    expect(order).toEqual(["slices", "r", "criticalSurface", "center", "soilColor", "fosLabel", "t", "m"]);
    // turned on again: back where it was, under the reference line
    expect(resultLayerKeys(src({ layerOrder: order }))).toEqual(["slices", "r", "criticalSurface", "center", "soilColor", "fosLabel", "t", "m"]);
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

  it("normalizes a stored order read from a file", () => {
    expect(normalizeLayerOrder(["soilColor", 3, "soilColor", "t", "nope", "drawing:", "drawing:x", "r"], ANNOS)).toEqual(["soilColor", "t", "drawing:x", "r"]);
    expect(normalizeLayerOrder("soilColor", ANNOS)).toBeUndefined();
    expect(normalizeLayerOrder(["nope"], ANNOS)).toBeUndefined();
  });

  it("draws the slices, center and FOS label with the critical surface while they follow it in their default order", () => {
    const steps = (order?: string[]) => layerSteps(resultLayers(src({ layerOrder: order })));
    expect(steps()).toContainEqual({ kind: "critical", withSlices: true, withCenter: true, withFosLabel: true });
    // the FOS label on top: drawn on its own, after the annotations
    const top = steps(["soilColor", "r", "criticalSurface", "slices", "center", "t", "m", "fosLabel"]);
    expect(top).toContainEqual({ kind: "critical", withSlices: true, withCenter: true, withFosLabel: false });
    expect(top.at(-1)).toEqual({ kind: "display", layer: "fosLabel" });
    // the center under the slices: the slices on their own
    const swapped = steps(["soilColor", "r", "criticalSurface", "center", "slices", "fosLabel", "t", "m"]);
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
