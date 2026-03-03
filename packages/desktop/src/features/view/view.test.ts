import { describe, expect, it } from "vitest";
import {
  getPaperDimensions,
  computePaperFrame,
  computeInnerFrame,
  getPlotAspectRatio,
  surfaceYAtX,
  computeViewLockFit,
} from "./index";
import { PAPER_FRAME_MARGIN_PX } from "../../constants";
import { PLOT_MARGINS } from "../../store/defaults";

// ── getPaperDimensions ──────────────────────────────────────────

describe("getPaperDimensions", () => {
  it("returns landscape A4 dimensions (wider > taller)", () => {
    const d = getPaperDimensions("A4", true);
    expect(d.width).toBe(297);
    expect(d.height).toBe(210);
  });

  it("returns portrait A4 dimensions (taller > wider)", () => {
    const d = getPaperDimensions("A4", false);
    expect(d.width).toBe(210);
    expect(d.height).toBe(297);
  });

  it("handles all paper sizes", () => {
    const sizes = ["A4", "A3", "A2", "A1", "A0"] as const;
    for (const size of sizes) {
      const ls = getPaperDimensions(size, true);
      expect(ls.width).toBeGreaterThan(ls.height);
      const pt = getPaperDimensions(size, false);
      expect(pt.height).toBeGreaterThan(pt.width);
    }
  });
});

// ── computePaperFrame ───────────────────────────────────────────

describe("computePaperFrame", () => {
  it("fits A4 landscape into canvas while preserving aspect", () => {
    const frame = computePaperFrame(1000, 600, "A4");
    const a4Aspect = 297 / 210;
    expect(frame.w / frame.h).toBeCloseTo(a4Aspect, 8);
    // Must be centered
    expect(frame.x).toBeCloseTo((1000 - frame.w) / 2, 8);
    expect(frame.y).toBeCloseTo((600 - frame.h) / 2, 8);
  });

  it("respects margin", () => {
    const frame = computePaperFrame(800, 600, "A3");
    expect(frame.x).toBeGreaterThanOrEqual(PAPER_FRAME_MARGIN_PX - 1);
    expect(frame.y).toBeGreaterThanOrEqual(PAPER_FRAME_MARGIN_PX - 1);
    expect(frame.x + frame.w).toBeLessThanOrEqual(
      800 - PAPER_FRAME_MARGIN_PX + 1,
    );
    expect(frame.y + frame.h).toBeLessThanOrEqual(
      600 - PAPER_FRAME_MARGIN_PX + 1,
    );
  });

  it("handles portrait orientation", () => {
    const frame = computePaperFrame(600, 800, "A4", false);
    expect(frame.w / frame.h).toBeLessThan(1);
    expect(frame.w).toBeGreaterThan(0);
    expect(frame.h).toBeGreaterThan(0);
  });

  it("uses width-fit branch when canvas is tall", () => {
    const frame = computePaperFrame(600, 1000, "A3");
    const availW = 600 - PAPER_FRAME_MARGIN_PX * 2;
    expect(frame.w).toBeCloseTo(availW, 8);
  });

  it("uses height-fit branch when canvas is wide", () => {
    const frame = computePaperFrame(2000, 600, "A4");
    const availH = 600 - PAPER_FRAME_MARGIN_PX * 2;
    expect(frame.h).toBeCloseTo(availH, 8);
  });
});

// ── computeInnerFrame ───────────────────────────────────────────

describe("computeInnerFrame", () => {
  it("insets frame by default margins", () => {
    const pf = { x: 100, y: 50, w: 800, h: 500 };
    const inner = computeInnerFrame(pf);
    expect(inner.x).toBeCloseTo(100 + 800 * PLOT_MARGINS.L, 8);
    expect(inner.y).toBeCloseTo(50 + 500 * PLOT_MARGINS.T, 8);
    expect(inner.w).toBeCloseTo(800 * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R), 8);
    expect(inner.h).toBeCloseTo(500 * (1 - PLOT_MARGINS.T - PLOT_MARGINS.B), 8);
  });

  it("accepts custom margins", () => {
    const pf = { x: 0, y: 0, w: 100, h: 200 };
    const inner = computeInnerFrame(pf, { L: 0.1, R: 0.1, T: 0.2, B: 0.2 });
    expect(inner.x).toBeCloseTo(10, 8);
    expect(inner.y).toBeCloseTo(40, 8);
    expect(inner.w).toBeCloseTo(80, 8);
    expect(inner.h).toBeCloseTo(120, 8);
  });

  it("returns zero-width frame with full margins", () => {
    const pf = { x: 0, y: 0, w: 100, h: 100 };
    const inner = computeInnerFrame(pf, { L: 0.5, R: 0.5, T: 0.5, B: 0.5 });
    expect(inner.w).toBeCloseTo(0, 8);
    expect(inner.h).toBeCloseTo(0, 8);
  });
});

// ── getPlotAspectRatio ──────────────────────────────────────────

describe("getPlotAspectRatio", () => {
  it("returns > 1 for landscape A4 with default margins", () => {
    const ar = getPlotAspectRatio("A4", true);
    expect(ar).toBeGreaterThan(1);
  });

  it("returns < 1 for portrait A4 with default margins", () => {
    const ar = getPlotAspectRatio("A4", false);
    expect(ar).toBeLessThan(1);
  });

  it("matches manual calculation", () => {
    const d = getPaperDimensions("A3", true);
    const expected =
      (d.width * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R)) /
      (d.height * (1 - PLOT_MARGINS.T - PLOT_MARGINS.B));
    expect(getPlotAspectRatio("A3", true)).toBeCloseTo(expected, 10);
  });
});

// ── surfaceYAtX ─────────────────────────────────────────────────

describe("surfaceYAtX", () => {
  const coords: [number, number][] = [
    [0, 10],
    [10, 10],
    [15, 5],
    [15, 0],
    [0, 0],
  ];

  it("interpolates Y on a horizontal segment", () => {
    expect(surfaceYAtX(coords, 5)).toBeCloseTo(10, 5);
  });

  it("interpolates Y on a descending slope", () => {
    expect(surfaceYAtX(coords, 11.25)).toBeCloseTo(8.75, 5);
    expect(surfaceYAtX(coords, 12.5)).toBeCloseTo(7.5, 5);
  });

  it("returns null for empty coordinates", () => {
    expect(surfaceYAtX([], 5)).toBeNull();
  });

  it("returns null for X outside all segments", () => {
    const line: [number, number][] = [
      [5, 5],
      [10, 5],
    ];
    expect(surfaceYAtX(line, 3)).toBeNull();
  });

  it("returns the highest Y when multiple segments overlap", () => {
    // Top goes 0,10 → 10,10; bottom goes 0,0 → 15,0 — both span x=5
    const y = surfaceYAtX(coords, 5);
    expect(y).toBe(10);
  });

  it("returns vertex Y at an exact vertex X", () => {
    expect(surfaceYAtX(coords, 0)).toBeCloseTo(10, 5);
    expect(surfaceYAtX(coords, 15)).toBeCloseTo(5, 5);
  });
});

// ── computeViewLockFit ──────────────────────────────────────────

describe("computeViewLockFit", () => {
  it("returns null for zero-size world", () => {
    const inner = { x: 100, y: 100, w: 400, h: 300 };
    const vl = {
      bottomLeft: [5, 5] as [number, number],
      topRight: [5, 5] as [number, number],
    };
    expect(computeViewLockFit(inner, vl, 800, 600)).toBeNull();
  });

  it("returns null for zero-size inner frame", () => {
    const inner = { x: 100, y: 100, w: 0, h: 0 };
    const vl = {
      bottomLeft: [0, 0] as [number, number],
      topRight: [10, 10] as [number, number],
    };
    expect(computeViewLockFit(inner, vl, 800, 600)).toBeNull();
  });

  it("computes correct scale for a square world in a wider frame", () => {
    const inner = { x: 100, y: 50, w: 400, h: 200 };
    const vl = {
      bottomLeft: [0, 0] as [number, number],
      topRight: [10, 10] as [number, number],
    };
    const result = computeViewLockFit(inner, vl, 800, 400);
    expect(result).not.toBeNull();
    // scale = min(400/10, 200/10) = 20
    expect(result!.scale).toBe(20);
  });

  it("centres the world in the inner frame", () => {
    const inner = { x: 100, y: 50, w: 400, h: 200 };
    const vl = {
      bottomLeft: [0, 0] as [number, number],
      topRight: [20, 10] as [number, number],
    };
    const result = computeViewLockFit(inner, vl, 800, 400);
    expect(result).not.toBeNull();
    // scale = min(400/20, 200/10) = 20
    expect(result!.scale).toBe(20);
    // worldCx = 10, worldCy = 5
    // targetCx = 100 + 200 = 300, targetCy = 50 + 100 = 150
    // ox = (300 - 400) / 20 - 10 = -5 - 10 = -15
    // oy = (200 - 150) / 20 - 5 = 2.5 - 5 = -2.5
    expect(result!.offset[0]).toBeCloseTo(-15, 8);
    expect(result!.offset[1]).toBeCloseTo(-2.5, 8);
  });

  it("handles non-origin-centered world bounds", () => {
    const inner = { x: 0, y: 0, w: 500, h: 500 };
    const vl = {
      bottomLeft: [100, 200] as [number, number],
      topRight: [110, 210] as [number, number],
    };
    const result = computeViewLockFit(inner, vl, 500, 500);
    expect(result).not.toBeNull();
    expect(result!.scale).toBe(50); // 500/10
    // worldCx=105, worldCy=205
    // targetCx=250, targetCy=250
    // ox = (250-250)/50 - 105 = -105
    // oy = (250-250)/50 - 205 = -205
    expect(result!.offset[0]).toBeCloseTo(-105, 8);
    expect(result!.offset[1]).toBeCloseTo(-205, 8);
  });
});
