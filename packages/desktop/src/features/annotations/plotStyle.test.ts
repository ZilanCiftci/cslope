import { describe, expect, it } from "vitest";
import {
  defaultPlotLineWidthMm,
  defaultPlotMarkerSizeMm,
  markerShape,
  normalizePlotStyle,
  plotAxisTicks,
  plotLayout,
  plotStylePatched,
  resolvePlotStyle,
} from "./plotStyle";
import { axisTicks } from "./plotAxis";

describe("normalizePlotStyle", () => {
  it("keeps valid members that differ from the default", () => {
    expect(
      normalizePlotStyle({
        color: "#CC0000",
        line: "dashed",
        lineWidth: 0.5,
        marker: "plus",
        markerSize: 2,
        markerOpen: true,
        showTitle: false,
        showAxisTitle: false,
        showGrid: false,
        showBorder: false,
        fontSize: 12,
        xMin: 1,
        xMax: 9,
        yMin: -5,
        yMax: 100,
      }),
    ).toEqual({
      color: "#cc0000",
      line: "dashed",
      lineWidth: 0.5,
      marker: "plus",
      markerSize: 2,
      markerOpen: true,
      showTitle: false,
      showAxisTitle: false,
      showGrid: false,
      showBorder: false,
      fontSize: 12,
      xMin: 1,
      xMax: 9,
      yMin: -5,
      yMax: 100,
    });
  });

  it("drops bad values, unknown members and defaults without an error", () => {
    expect(
      normalizePlotStyle({
        color: "red",
        line: "solid",
        lineWidth: 50,
        marker: "circle",
        markerSize: -1,
        markerOpen: false,
        showTitle: true,
        showGrid: "no",
        fontSize: 1,
        xMin: "1",
        yMax: Infinity,
        legend: true,
      }),
    ).toBeUndefined();
    expect(normalizePlotStyle(null)).toBeUndefined();
    expect(normalizePlotStyle([1])).toBeUndefined();
    expect(normalizePlotStyle("dashed")).toBeUndefined();
  });
});

describe("plotStylePatched", () => {
  it("sets, clears and drops defaults; nothing left is no style", () => {
    const a = plotStylePatched(undefined, { color: "#0066cc", line: "dashed" });
    expect(a).toEqual({ color: "#0066cc", line: "dashed" });
    expect(plotStylePatched(a, { line: undefined })).toEqual({ color: "#0066cc" });
    expect(plotStylePatched(a, { color: undefined, line: undefined })).toBeUndefined();
    expect(plotStylePatched(undefined, { showGrid: true, marker: "circle" })).toBeUndefined();
  });
});

describe("resolvePlotStyle", () => {
  it("gives the plot's long-standing look without a style", () => {
    for (const mmPerAnnoPx of [210 / 600, 420 / 600, 841 / 600]) {
      const s = resolvePlotStyle(undefined, mmPerAnnoPx);
      expect(s).toMatchObject({
        color: undefined,
        line: "solid",
        dashMm: [],
        marker: "circle",
        markerOpen: false,
        showTitle: true,
        showAxisTitle: true,
        showGrid: true,
        showBorder: true,
        textScale: 1,
      });
      // As the canvas and the PDF drew it before the style.
      expect(s.lineWidthMm).toBe(Math.max(0.25, 0.35 * mmPerAnnoPx));
      expect(s.markerRadiusMm).toBe(Math.max(0.35, 1.8 * mmPerAnnoPx));
      expect(defaultPlotLineWidthMm(mmPerAnnoPx)).toBe(s.lineWidthMm);
      expect(defaultPlotMarkerSizeMm(mmPerAnnoPx)).toBe(2 * s.markerRadiusMm);
    }
  });

  it("takes the style's sizes in mm and a dash in line widths", () => {
    const s = resolvePlotStyle({ line: "dashed", lineWidth: 0.4, markerSize: 3, fontSize: 18 }, 0.35);
    expect(s.lineWidthMm).toBe(0.4);
    expect(s.dashMm.map((d) => Math.round(d * 1000) / 1000)).toEqual([2.4, 1.2]);
    expect(s.markerRadiusMm).toBe(1.5);
    expect(s.textScale).toBe(2);
  });
});

describe("plotLayout", () => {
  it("lays out an unstyled plot as before", () => {
    const [x, y, w, h, s, mm] = [10, 20, 300, 200, 1.7, 4];
    const L = plotLayout(x, y, w, h, s, mm, resolvePlotStyle(undefined, s / mm));
    const titleSize = 10 * s;
    const axisSize = 9 * s;
    const padTop = titleSize + 6 * s + axisSize / 2 + 3 * s;
    const padBottom = 22 * s + axisSize + 2 * s;
    expect(L.titleSize).toBe(titleSize);
    expect(L.axisSize).toBe(axisSize);
    expect(L.titleX).toBe(x + 6 * s);
    expect(L.titleY).toBe(y + 4 * s);
    expect(L.chartX).toBe(x + 32 * s);
    expect(L.chartY).toBe(y + padTop);
    expect(L.chartW).toBeCloseTo(w - 32 * s - 12 * s, 12);
    expect(L.chartH).toBeCloseTo(h - padTop - padBottom, 12);
    expect(L.xTitleY).toBeCloseTo(L.chartY + L.chartH + 1.2 * s + 2 * s + axisSize + 2 * s, 12);
  });

  it("gives the chart the room of a hidden title and axis title", () => {
    const base = plotLayout(0, 0, 300, 200, 1, 1, resolvePlotStyle(undefined, 1));
    const bare = plotLayout(0, 0, 300, 200, 1, 1, resolvePlotStyle({ showTitle: false, showAxisTitle: false }, 1));
    expect(bare.chartY).toBeLessThan(base.chartY);
    expect(bare.chartH).toBeGreaterThan(base.chartH);
  });
});

describe("plotAxisTicks", () => {
  it("is the round ticks of the data without fixed ends", () => {
    expect(plotAxisTicks(3, 47, undefined, undefined, 4, false)).toEqual(axisTicks(3, 47, 4, false));
  });

  it("runs exactly between fixed ends, with the round ticks inside", () => {
    const t = plotAxisTicks(3, 47, 5, 35, 4, false);
    expect(t.min).toBe(5);
    expect(t.max).toBe(35);
    expect(t.values.every((v) => v >= 5 && v <= 35)).toBe(true);
    expect(t.values).toContain(10);
  });

  it("fixes one end and takes the other from the data", () => {
    const t = plotAxisTicks(3, 47, 0, undefined, 4, false);
    expect(t.min).toBe(0);
    expect(t.max).toBeGreaterThanOrEqual(47);
  });

  it("does not take ends that leave no range", () => {
    expect(plotAxisTicks(3, 47, 10, 10, 4, false)).toEqual(axisTicks(3, 47, 4, false));
    expect(plotAxisTicks(3, 47, 60, undefined, 4, false)).toEqual(axisTicks(3, 47, 4, false));
  });
});

describe("markerShape", () => {
  it("draws each marker around its point within about its size", () => {
    for (const m of ["circle", "square", "triangle", "plus", "cross"] as const) {
      const shape = markerShape(m, 10, 20, 2)!;
      const pts =
        shape.kind === "circle"
          ? [[shape.x, shape.y]]
          : shape.kind === "polygon"
            ? shape.points
            : shape.segments.flatMap(([a, b, c, d]) => [[a, b], [c, d]]);
      for (const [px, py] of pts) expect(Math.hypot(px - 10, py - 20)).toBeLessThanOrEqual(2.6);
    }
    expect(markerShape("none", 0, 0, 1)).toBeNull();
  });
});
