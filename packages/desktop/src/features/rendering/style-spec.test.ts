import { describe, expect, it } from "vitest";
import {
  ANNOTATION_DEFAULT_FONT_FAMILY,
  ANNOTATION_DEFAULT_FONT_SIZE,
  ANNOTATION_DEFAULT_TEXT_COLOR,
  ANNOTATION_LINE_HEIGHT,
  ANNOTATION_SCALE_DIVISOR,
  COLOR_BAR_NUM_TICKS,
  CRITICAL_SURFACE_COLOR,
  type DualColor,
  ENTRY_DOT_COLOR,
  ENTRY_EXIT_DOT_RADIUS_PX,
  ENTRY_EXIT_DOT_SPACING_PX,
  EXIT_DOT_COLOR,
  FAILURE_MASS_COLOR,
  FAILURE_MASS_FILL_OPACITY,
  FOS_LABEL_BG_COLOR,
  LINE_LOAD_COLOR,
  MARKER_BAR_H_PX,
  MARKER_COLOR,
  MARKER_SZ_PX,
  PIEZO_BAR_GAP1_PX,
  PIEZO_BAR_GAP2_PX,
  PIEZO_BAR_W_PX,
  PIEZO_COLOR,
  PIEZO_TRI_HALF_PX,
  PIEZO_TRI_H_PX,
  SLICE_LINE_OPACITY,
  SLICE_LINE_WIDTH_PX,
  SLIP_SURFACE_OPACITY,
  UDL_LOAD_COLOR,
} from "./style-spec";

// ── Helpers ────────────────────────────────────────────────────

/** Convert a hex colour string to an RGB triple. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Assert that a DualColor's hex and rgb agree. */
function expectConsistent(dc: DualColor, label: string) {
  const [r, g, b] = hexToRgb(dc.hex);
  expect(dc.rgb, `${label}: rgb should match hex ${dc.hex}`).toEqual([r, g, b]);
}

// ── Colour consistency ─────────────────────────────────────────

describe("style-spec colour consistency", () => {
  const colors: [string, DualColor][] = [
    ["ENTRY_DOT_COLOR", ENTRY_DOT_COLOR],
    ["EXIT_DOT_COLOR", EXIT_DOT_COLOR],
    ["MARKER_COLOR", MARKER_COLOR],
    ["PIEZO_COLOR", PIEZO_COLOR],
    ["UDL_LOAD_COLOR", UDL_LOAD_COLOR],
    ["LINE_LOAD_COLOR", LINE_LOAD_COLOR],
    ["CRITICAL_SURFACE_COLOR", CRITICAL_SURFACE_COLOR],
    ["FOS_LABEL_BG_COLOR", FOS_LABEL_BG_COLOR],
    ["FAILURE_MASS_COLOR", FAILURE_MASS_COLOR],
  ];

  it.each(colors)("%s hex matches its RGB triple", (label, dc) => {
    expectConsistent(dc, label);
  });

  it("every hex string is a valid 6-digit hex colour", () => {
    for (const [label, dc] of colors) {
      expect(dc.hex, `${label}.hex`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("every RGB channel is 0-255", () => {
    for (const [label, dc] of colors) {
      for (const ch of dc.rgb) {
        expect(ch, `${label} channel`).toBeGreaterThanOrEqual(0);
        expect(ch, `${label} channel`).toBeLessThanOrEqual(255);
      }
    }
  });
});

// ── Geometric constants ────────────────────────────────────────

describe("style-spec geometric constants", () => {
  const positiveFinite: [string, number][] = [
    ["MARKER_SZ_PX", MARKER_SZ_PX],
    ["MARKER_BAR_H_PX", MARKER_BAR_H_PX],
    ["ENTRY_EXIT_DOT_SPACING_PX", ENTRY_EXIT_DOT_SPACING_PX],
    ["ENTRY_EXIT_DOT_RADIUS_PX", ENTRY_EXIT_DOT_RADIUS_PX],
    ["PIEZO_TRI_HALF_PX", PIEZO_TRI_HALF_PX],
    ["PIEZO_TRI_H_PX", PIEZO_TRI_H_PX],
    ["PIEZO_BAR_W_PX", PIEZO_BAR_W_PX],
    ["PIEZO_BAR_GAP1_PX", PIEZO_BAR_GAP1_PX],
    ["PIEZO_BAR_GAP2_PX", PIEZO_BAR_GAP2_PX],
    ["SLICE_LINE_WIDTH_PX", SLICE_LINE_WIDTH_PX],
    ["ANNOTATION_SCALE_DIVISOR", ANNOTATION_SCALE_DIVISOR],
    ["ANNOTATION_DEFAULT_FONT_SIZE", ANNOTATION_DEFAULT_FONT_SIZE],
    ["ANNOTATION_LINE_HEIGHT", ANNOTATION_LINE_HEIGHT],
    ["COLOR_BAR_NUM_TICKS", COLOR_BAR_NUM_TICKS],
  ];

  it.each(positiveFinite)("%s is a positive finite number", (_, v) => {
    expect(v).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
  });
});

// ── Opacity constants ──────────────────────────────────────────

describe("style-spec opacity constants", () => {
  const opacities: [string, number][] = [
    ["SLIP_SURFACE_OPACITY", SLIP_SURFACE_OPACITY],
    ["FAILURE_MASS_FILL_OPACITY", FAILURE_MASS_FILL_OPACITY],
    ["SLICE_LINE_OPACITY", SLICE_LINE_OPACITY],
  ];

  it.each(opacities)("%s is in [0, 1]", (_, v) => {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

// ── String defaults ────────────────────────────────────────────

describe("style-spec string defaults", () => {
  it("annotation default colour is a valid hex colour", () => {
    expect(ANNOTATION_DEFAULT_TEXT_COLOR).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("annotation default font family is a non-empty string", () => {
    expect(ANNOTATION_DEFAULT_FONT_FAMILY.length).toBeGreaterThan(0);
  });
});
