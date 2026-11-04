import { describe, expect, it } from "vitest";
import { colorBarRange, colorBarScheme, colorScaleOf, colorScaleOfBar, firstColorBar } from "./colorScale";
import { fosColor, fosSchemeColorAt } from "../../utils/fos-color";
import type { PaperAnnotation } from "../../store/types";

const res = { minFOS: 1.234, maxFOS: 9 };
const bar = (over: Partial<PaperAnnotation> = {}): PaperAnnotation => ({ id: "c", type: "color-bar", x: 0.8, y: 0.3, ...over });

describe("colorScaleOfBar", () => {
  it("is the automatic range and the default scheme without a bar or settings", () => {
    for (const anno of [undefined, bar(), bar({ scaleMode: "auto", scheme: "classic" })]) {
      const scale = colorScaleOfBar(anno, res, { fosFilterMax: 1.5 });
      expect(scale.range).toEqual({ min: 1.234, max: 2.468, capped: true });
      expect(scale.scheme).toEqual({ id: "classic" });
      expect(scale.colorOf(1.5)).toBe(fosColor(1.5, 1.234, 2.468));
    }
  });

  it("uses fixed bounds, falling back to automatic when they are out of order", () => {
    expect(colorBarRange(bar({ scaleMode: "fixed", scaleMin: 1, scaleMax: 2 }), res)).toEqual({
      min: 1,
      max: 2,
      capped: true,
    });
    expect(colorBarRange(bar({ scaleMode: "fixed", scaleMin: 2, scaleMax: 1 }), res)).toEqual({
      min: 1.234,
      max: 2.468,
      capped: true,
    });
    expect(colorBarRange(bar({ scaleMode: "fixed" }), res)).toEqual({ min: 1.234, max: 2.468, capped: true });
  });

  it("follows the surface filter, or the automatic range without one or when it shows nothing", () => {
    const anno = bar({ scaleMode: "filter" });
    expect(colorBarRange(anno, res, { fosFilterMax: 1.6 })).toEqual({ min: 1.234, max: 1.6, capped: true });
    expect(colorBarRange(anno, res, { fosFilterMax: 1.0 })).toEqual({ min: 1.234, max: 2.468, capped: true });
    expect(colorBarRange(anno, res)).toEqual({ min: 1.234, max: 2.468, capped: true });
  });

  it("colours by the chosen scheme", () => {
    const preset = colorScaleOfBar(bar({ scheme: "greyscale" }), { minFOS: 1, maxFOS: 2 });
    expect(preset.colorOf(1)).toBe("#000000");
    expect(preset.colorOf(2)).toBe("#c8c8c8");
    const custom = colorScaleOfBar(
      bar({ scheme: "custom", schemeFrom: "#112233", schemeMid: "#ffffff", schemeTo: "#445566" }),
      { minFOS: 1, maxFOS: 2 },
    );
    expect(custom.scheme).toEqual({ id: "custom", from: "#112233", mid: "#ffffff", to: "#445566" });
    expect(custom.colorOf(0)).toBe("#112233");
    expect(custom.colorOf(1.5)).toBe("#ffffff");
    expect(custom.colorOf(5)).toBe("#445566");
    expect(custom.colorOf(1.25)).toBe(fosSchemeColorAt(custom.scheme, 0.25));
    // An unknown scheme id (an old file) is the default.
    expect(colorBarScheme({ scheme: "rainbow" as never })).toEqual({ id: "classic" });
  });
});

describe("colorScaleOf", () => {
  it("takes the first colour bar of the view", () => {
    const text: PaperAnnotation = { id: "t", type: "text", x: 0, y: 0, text: "x" };
    const a = bar({ id: "a", scaleMode: "fixed", scaleMin: 1, scaleMax: 3, scheme: "viridis" });
    const b = bar({ id: "b", scaleMode: "fixed", scaleMin: 0, scaleMax: 1 });
    expect(firstColorBar([text, a, b])).toBe(a);
    const scale = colorScaleOf({ annotations: [text, a, b], fosFilterMax: 1.5 }, res);
    expect(scale.range).toEqual({ min: 1, max: 3, capped: true });
    expect(scale.scheme).toEqual({ id: "viridis" });
    expect(colorScaleOf({ annotations: [text], fosFilterMax: 1.5 }, res).range).toEqual({
      min: 1.234,
      max: 2.468,
      capped: true,
    });
  });
});
