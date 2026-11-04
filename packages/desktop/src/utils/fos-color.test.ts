import { describe, expect, it } from "vitest";
import chroma from "chroma-js";
import {
  CUSTOM_SCHEME_DEFAULTS,
  DEFAULT_FOS_SCHEME,
  DEFAULT_FOS_SCHEME_ID,
  FOS_SCHEME_PRESETS,
  fosColor,
  fosColorIn,
  fosFilterRange,
  fosFixedRange,
  fosScaleRange,
  fosSchemeColorAt,
  fosSchemeGradient,
  fosSchemeStops,
  fosTickLabel,
  isFosSchemeId,
  isFosSchemePreset,
  isHexColor,
  validFosScaleBounds,
} from "./fos-color";

describe("fosColor", () => {
  it("returns a valid hex color string", () => {
    const color = fosColor(1.5);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("returns red-ish at the minimum FOS (0.5)", () => {
    const color = fosColor(0.5);
    // At t=0 the scale starts at red → high R, low G, low B
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
  });

  it("returns blue-ish at the maximum FOS (3.0)", () => {
    const color = fosColor(3.0);
    const b = parseInt(color.slice(5, 7), 16);
    expect(b).toBeGreaterThan(200);
  });

  it("returns a mid-scale color for FOS around 1.75", () => {
    const color = fosColor(1.75);
    // Mid scale → should be in the yellow-green range, not pure red or pure blue
    const r = parseInt(color.slice(1, 3), 16);
    const b = parseInt(color.slice(5, 7), 16);
    // Not dominated by either extreme
    expect(r).toBeLessThan(255);
    expect(b).toBeLessThan(200);
  });

  it("clamps below minimum to red", () => {
    const atMin = fosColor(0.5);
    const below = fosColor(-10);
    expect(below).toBe(atMin);
  });

  it("clamps above maximum to blue", () => {
    const atMax = fosColor(3.0);
    const above = fosColor(100);
    expect(above).toBe(atMax);
  });

  it("accepts custom min/max range", () => {
    const color = fosColor(1.0, 0, 2.0); // t = 0.5
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    // At midpoint of red-yellow-green-blue, should be greenish
    const g = parseInt(color.slice(3, 5), 16);
    expect(g).toBeGreaterThan(100);
  });

  it("handles min === max without crashing", () => {
    const color = fosColor(1.0, 1.0, 1.0);
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("produces different colors for different FOS values", () => {
    const c1 = fosColor(0.5);
    const c2 = fosColor(1.5);
    const c3 = fosColor(3.0);
    expect(c1).not.toBe(c2);
    expect(c2).not.toBe(c3);
    expect(c1).not.toBe(c3);
  });

  it("is monotonically transitioning across the range", () => {
    // Blue channel should generally increase from min to max
    const values = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const blues = values.map((v) => {
      const c = fosColor(v);
      return parseInt(c.slice(5, 7), 16);
    });
    // Overall trend: last should be much higher than first
    expect(blues[blues.length - 1]).toBeGreaterThan(blues[0]);
  });
});

describe("fosScaleRange", () => {
  it("keeps the full range when max FOS is moderate", () => {
    expect(fosScaleRange({ minFOS: 1.2, maxFOS: 2.0 })).toEqual({ min: 1.2, max: 2.0, capped: false });
  });

  it("caps very high max FOS near the critical value", () => {
    const r = fosScaleRange({ minFOS: 1.2, maxFOS: 477 });
    expect(r).toEqual({ min: 1.2, max: 2.4, capped: true });
    expect(fosTickLabel(r, 0, 5)).toBe("≥ 2.40");
    expect(fosTickLabel(r, 5, 5)).toBe("1.20");
    // Surfaces above the cap get the top colour.
    expect(fosColor(477, r.min, r.max)).toBe(fosColor(r.max, r.min, r.max));
  });

  it("spans at least one unit for low critical FOS", () => {
    expect(fosScaleRange({ minFOS: 0.4, maxFOS: 50 }).max).toBeCloseTo(1.4);
  });
});

describe("fixed and filter ranges", () => {
  const res = { minFOS: 1.234, maxFOS: 9 };

  it("keeps fixed bounds, marking surfaces beyond either end", () => {
    expect(fosFixedRange(1.0, 2.0, res)).toEqual({ min: 1.0, max: 2.0, capped: true });
    const floored = fosFixedRange(1.5, 20, res)!;
    expect(floored).toEqual({ min: 1.5, max: 20, capped: false, floored: true });
    expect(fosTickLabel(floored, 5, 5)).toBe("≤ 1.50");
    expect(fosTickLabel(floored, 0, 5)).toBe("20.00");
    expect(fosTickLabel(fosFixedRange(1.0, 2.0, res)!, 0, 5, ">= ", "<= ")).toBe(">= 2.00");
  });

  it("rejects bounds out of order or not finite", () => {
    expect(fosFixedRange(2, 1, res)).toBeNull();
    expect(fosFixedRange(1, 1, res)).toBeNull();
    expect(fosFixedRange(undefined, 2, res)).toBeNull();
    expect(fosFixedRange(1, Number.NaN, res)).toBeNull();
    expect(validFosScaleBounds(1, 2)).toBe(true);
    expect(validFosScaleBounds("1", 2)).toBe(false);
  });

  it("follows the surface filter from the critical FOS to its limit", () => {
    expect(fosFilterRange(res, 2)).toEqual({ min: 1.234, max: 2, capped: true });
    expect(fosFilterRange({ minFOS: 1.234, maxFOS: 1.8 }, 2)).toEqual({ min: 1.234, max: 2, capped: false });
    // A limit at or below the critical FOS shows no other surface.
    expect(fosFilterRange(res, 1.234)).toBeNull();
    expect(fosFilterRange(res, 1)).toBeNull();
  });
});

describe("colour schemes", () => {
  it("keeps the default scheme's colours byte for byte", () => {
    // The values existing drawings and tests were made with.
    expect(fosColor(0.5)).toBe("#ff0000");
    expect(fosColor(1.0)).toBe("#ff9900");
    expect(fosColor(1.5)).toBe("#cce600");
    expect(fosColor(1.75)).toBe("#7fc000");
    expect(fosColor(3.0)).toBe("#0000ff");
    for (const fos of [0.5, 1.0, 1.5, 1.75, 2.2, 3.0, 9]) {
      expect(fosColorIn(DEFAULT_FOS_SCHEME, fos, 0.5, 3.0)).toBe(fosColor(fos));
      expect(fosColorIn({ id: "classic" }, fos, 1.2, 2.4)).toBe(fosColor(fos, 1.2, 2.4));
    }
    expect(DEFAULT_FOS_SCHEME_ID).toBe("classic");
    expect(FOS_SCHEME_PRESETS[0].id).toBe(DEFAULT_FOS_SCHEME_ID);
  });

  it("has presets that run from their first stop to their last", () => {
    for (const preset of FOS_SCHEME_PRESETS) {
      const scheme = { id: preset.id };
      expect(fosSchemeStops(scheme)).toEqual([...preset.colors]);
      expect(fosSchemeColorAt(scheme, 0)).toBe(chroma(preset.colors[0]).hex());
      expect(fosSchemeColorAt(scheme, 1)).toBe(chroma(preset.colors[preset.colors.length - 1]).hex());
      expect(fosColorIn(scheme, 0, 1, 2)).toBe(fosSchemeColorAt(scheme, 0));
      expect(fosColorIn(scheme, 99, 1, 2)).toBe(fosSchemeColorAt(scheme, 1));
      expect(fosSchemeColorAt(scheme, 0.5)).not.toBe(fosSchemeColorAt(scheme, 0));
    }
    expect(fosSchemeColorAt({ id: "traffic" }, 0)).toBe("#d7191c");
    expect(fosSchemeColorAt({ id: "greyscale" }, 1)).toBe("#c8c8c8");
    expect(isFosSchemePreset("viridis")).toBe(true);
    expect(isFosSchemeId("custom")).toBe(true);
    expect(isFosSchemeId("rainbow")).toBe(false);
  });

  it("blends a custom scheme between its colours, through the middle one when set", () => {
    const two = { id: "custom" as const, from: "#ff0000", to: "#0000ff" };
    expect(fosSchemeStops(two)).toEqual(["#ff0000", "#0000ff"]);
    expect(fosSchemeColorAt(two, 0)).toBe("#ff0000");
    expect(fosSchemeColorAt(two, 1)).toBe("#0000ff");
    // Blended in OKLab, not RGB: the middle is not the dull RGB average #800080.
    const mid = fosSchemeColorAt(two, 0.5);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(mid).not.toBe("#800080");
    expect(chroma(mid).luminance()).toBeGreaterThan(chroma("#800080").luminance());

    const three = { ...two, mid: "#ffffff" };
    expect(fosSchemeStops(three)).toEqual(["#ff0000", "#ffffff", "#0000ff"]);
    expect(fosSchemeColorAt(three, 0.5)).toBe("#ffffff");
    expect(fosColorIn(three, 1.5, 1, 2)).toBe("#ffffff");
  });

  it("falls back to the default custom colours and ignores bad ones", () => {
    expect(fosSchemeStops({ id: "custom" })).toEqual([CUSTOM_SCHEME_DEFAULTS.from, CUSTOM_SCHEME_DEFAULTS.to]);
    expect(fosSchemeStops({ id: "custom", from: "red", mid: "#12345", to: "#ABCDEF" })).toEqual([
      CUSTOM_SCHEME_DEFAULTS.from,
      "#ABCDEF",
    ]);
    expect(isHexColor("#ABCDEF")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor(123)).toBe(false);
  });

  it("gives a CSS gradient from the low to the high colour", () => {
    const gradient = fosSchemeGradient({ id: "greyscale" }, 2);
    const mid = fosSchemeColorAt({ id: "greyscale" }, 0.5);
    expect(gradient).toBe(`linear-gradient(to right, #000000, ${mid}, #c8c8c8)`);
    expect(mid).toBe("#4c4c4c");
  });
});
