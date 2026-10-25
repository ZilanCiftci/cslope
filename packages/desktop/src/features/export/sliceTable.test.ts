import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@cslope/engine";
import { buildSliceTable, toCsv } from "./sliceTable";

const result = {
  minFOS: 1.23456,
  maxFOS: 2,
  method: "Bishop",
  criticalSurface: { cx: 10, cy: 20, radius: 15, fos: 1.23456, entryPoint: [1, 5], exitPoint: [20, 0] },
  allSurfaces: [],
  elapsedMs: 1,
  criticalSlices: [
    {
      x: 2, xLeft: 1, xRight: 3, width: 2, yTop: 5, yBottom: 3, height: 2, area: 4,
      alpha: Math.PI / 6, baseLength: 2.31, weight: 76, surfaceLoad: 10, cohesion: 5,
      frictionAngle: 30, normalForce: 50, porePressure: 0, baseMaterial: { name: "Clay, soft" },
    },
  ],
} as unknown as AnalysisResult;

describe("slice table export", () => {
  it("has a header block, column headers and one row per slice", () => {
    const rows = buildSliceTable(result, { modelName: "Section A" });
    expect(rows[0]).toEqual(["Model", "Section A"]);
    expect(rows).toContainEqual(["Minimum FOS", 1.2346]);
    expect(rows).toContainEqual(["Radius (m)", 15]);
    const header = rows.findIndex((r) => r[0] === "Slice");
    const slice = rows[header + 1];
    expect(slice[0]).toBe(1);
    expect(slice[9]).toBeCloseTo(30, 6); // α in degrees
    expect(slice[13]).toBe("Clay, soft");
    // c·l + N'·tan φ
    expect(slice[18]).toBeCloseTo(5 * 2.31 + 50 * Math.tan(Math.PI / 6), 3);
  });

  it("states characteristic values without partial factors", () => {
    const rows = buildSliceTable(result, { modelName: "M" });
    expect(rows).toContainEqual(["Values", "characteristic (no partial factors)"]);
    expect(rows.find((r) => r[0] === "Slice")).toContain("Cohesion c (kPa)");
  });

  it("marks design values and lists the partial factors", () => {
    const rows = buildSliceTable(result, {
      modelName: "M",
      partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 },
    });
    expect(rows).toContainEqual(["Over-design factor (design values)", 1.2346]);
    expect(rows).toContainEqual(["γcu", 1.5]);
    expect(rows).toContainEqual(["γQ", 1.3]);
    const header = rows.find((r) => r[0] === "Slice")!;
    expect(header).toContain("Design cohesion c_d (kPa)");
    expect(header).toContain("Design friction angle φ_d (°)");
    expect(header).toContain("Surface load, design (kN/m)");
    expect(header).not.toContain("Cohesion c (kPa)");
  });

  it("writes CSV with quoting, and the Swedish variant with ; and decimal commas", () => {
    const rows = [["Clay, soft", 1.5], ['He said "hi"', -0.25]];
    expect(toCsv(rows)).toBe('"Clay, soft",1.5\r\n"He said ""hi""",-0.25\r\n');
    expect(toCsv(rows, true)).toBe('"Clay, soft";1,5\r\n"He said ""hi""";-0,25\r\n');
  });
});
