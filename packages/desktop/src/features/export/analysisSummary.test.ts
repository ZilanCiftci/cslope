import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS, type AnalysisResult } from "@cslope/engine";
import { buildAnalysisSummary, methodText, strengthText, type AnalysisSummaryInput } from "./analysisSummary";
import { DEFAULT_ANALYSIS_LIMITS, DEFAULT_MATERIAL } from "../../store/defaults";

const RESULT = {
  minFOS: 1.2346,
  maxFOS: 3,
  method: "Bishop",
  criticalSurface: { cx: 10, cy: 20, radius: 15, fos: 1.2346, entryPoint: [1, 5], exitPoint: [20, 0] },
  allSurfaces: [{ fos: 0.9 }, { fos: 1.2346 }, { fos: 2 }],
  criticalSlices: [],
  elapsedMs: 1,
} as unknown as AnalysisResult;

function input(over: Partial<AnalysisSummaryInput> = {}): AnalysisSummaryInput {
  return {
    result: RESULT,
    options: { ...DEFAULT_ANALYSIS_OPTIONS },
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, enabled: false },
    orientation: "ltr",
    piezometricLine: { enabled: true, lines: [], activeLineId: null, materialAssignment: {} },
    materials: [{ ...DEFAULT_MATERIAL }],
    udls: [],
    lineLoads: [],
    ...over,
  };
}

const section = (s: ReturnType<typeof buildAnalysisSummary>, title: string) => s.find((x) => x.title === title)!;
const value = (s: ReturnType<typeof buildAnalysisSummary>, title: string, label: string) =>
  section(s, title).rows!.find((r) => r.label === label)?.value;

describe("analysis summary", () => {
  it("states the result, the method and characteristic values", () => {
    const s = buildAnalysisSummary(input());
    expect(value(s, "Result", "Minimum factor of safety")).toBe("1.235");
    expect(value(s, "Result", "Method")).toBe("Bishop simplified (moment equilibrium)");
    expect(value(s, "Result", "Critical surface")).toBe("circle, centre (10, 20) m, radius 15 m");
    expect(value(s, "Result", "Surfaces analysed")).toBe("3 (1 below 1.0)");
    expect(value(s, "Result", "Below minimum size")).toBeUndefined();
    const small = buildAnalysisSummary(input({ result: { ...RESULT, discardedBySize: 7 } }));
    expect(value(small, "Result", "Below minimum size")).toBe(
      "7 surfaces smaller than the minimum slip area or depth were skipped",
    );
    expect(value(s, "Search", "Search limits")).toBe("automatic");
    expect(value(s, "Partial factors", "Values")).toBe("characteristic (no partial factors)");
    expect(value(s, "Water and tension crack", "Piezometric lines")).toBe("none (no pore pressure)");
  });

  it("warns of a Morgenstern-Price closest pair, not of an iteration limit", () => {
    const cs = { ...RESULT.criticalSurface!, converged: false, closestPair: true, equilibriumGap: 0.0196 };
    const s = buildAnalysisSummary(input({ result: { ...RESULT, criticalSurface: cs } }));
    const warnings = section(s, "Result").rows!.filter((r) => r.label === "Warning").map((r) => r.value);
    expect(warnings).toEqual(["No complete equilibrium: force equilibrium met within 0.020 (closest λ)"]);
    const unconverged = { ...RESULT.criticalSurface!, converged: false };
    const s2 = buildAnalysisSummary(input({ result: { ...RESULT, criticalSurface: unconverged } }));
    expect(value(s2, "Result", "Warning")).toBe("The critical surface did not converge within the iteration limit");
  });

  it("names the method options a checker needs", () => {
    expect(methodText({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Janbu", janbuCorrection: true })).toContain("with correction factor f0");
    expect(methodText({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", intersliceFunction: "constant" })).toBe(
      "Morgenstern-Price (complete equilibrium), interslice function constant (Spencer)",
    );
  });

  it("marks design values and lists the partial factors", () => {
    const s = buildAnalysisSummary(
      input({
        options: { ...DEFAULT_ANALYSIS_OPTIONS, partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 } },
        udls: [{ x1: 8, x2: 2, magnitude: 10 }],
      }),
    );
    expect(value(s, "Result", "Over-design factor (design values)")).toBe("1.235");
    expect(value(s, "Partial factors", "γcu (undrained strength)")).toBe("1.5");
    expect(section(s, "Partial factors").note).toContain("material values in this summary are characteristic");
    const loads = section(s, "Loads and structures");
    expect(loads.table!.rows[0]).toEqual(["Distributed load", "x 2 to 8 m", "10 kPa"]);
    expect(loads.note).toContain("γQ = 1.3");
  });

  it("describes the water the analysis uses: complete lines, the main line, each material's line", () => {
    const line = (id: string, name: string, n = 2) => ({
      id,
      name,
      color: "#00f",
      coordinates: Array.from({ length: n }, (_, i) => [i * 10, 5] as [number, number]),
    });
    const clay = { ...DEFAULT_MATERIAL, id: "clay", name: "Clay" };
    const sand = { ...DEFAULT_MATERIAL, id: "sand", name: "Sand" };
    const s = buildAnalysisSummary(
      input({
        materials: [clay, sand],
        piezometricLine: {
          // "enabled" does not switch the water off in the analysis.
          enabled: false,
          lines: [line("a", "A"), line("b", "B"), line("c", "Unfinished", 1)],
          activeLineId: null,
          mainLineId: "b",
          materialAssignment: { clay: "a", sand: "c" },
          freeWater: false,
        },
        options: { ...DEFAULT_ANALYSIS_OPTIONS, tensionCrackDepth: 2, tensionCrackWater: 0.5 },
      }),
    );
    expect(value(s, "Water and tension crack", "Piezometric lines")).toBe("A, B");
    expect(value(s, "Water and tension crack", "Main line")).toContain("B");
    expect(value(s, "Water and tension crack", "Water above ground")).toBe("line clipped to the ground");
    expect(value(s, "Water and tension crack", "Tension crack")).toBe("2 m deep");
    expect(value(s, "Water and tension crack", "Water in crack")).toBe("50 % of the crack depth");
    const rows = section(s, "Materials (characteristic values)").table!.rows;
    expect(rows.map((r) => r[4])).toEqual(["A", "B"]);
  });

  it("reports both directions and custom surfaces", () => {
    const s = buildAnalysisSummary(
      input({
        result: { ...RESULT, slidingDirection: "rtl", otherDirectionMinFOS: 1.5 },
        options: { ...DEFAULT_ANALYSIS_OPTIONS, bothDirections: true },
      }),
    );
    expect(value(s, "Result", "Sliding direction")).toBe("towards -x (left)");
    expect(value(s, "Result", "Other direction")).toBe("1.500 (automatic search limits)");
    const custom = buildAnalysisSummary(input({ customPlanesOnly: true, customSurfaceCount: 2 }));
    expect(value(custom, "Search", "Surfaces")).toBe("custom surfaces only (2)");
    expect(value(custom, "Search", "Search limits")).toBeUndefined();
  });

  it("lists the result warnings", () => {
    const s = buildAnalysisSummary(
      input({
        result: {
          ...RESULT,
          warnings: [
            { code: "dangling-boundary", message: "Material boundary 2 ends inside a region and does not split it; check its end points.", boundaryIndex: 1 },
            { code: "low-m-alpha", message: "3 slices of the critical surface have m_α below 0.2 (steep base); the factor of safety may be unreliable.", count: 3 },
          ],
        },
      }),
    );
    const warnings = section(s, "Result").rows!.filter((r) => r.label === "Warning").map((r) => r.value);
    expect(warnings).toEqual([
      "Material boundary 2 ends inside a region and does not split it; check its end points.",
      "3 slices of the critical surface have m_α below 0.2 (steep base); the factor of safety may be unreliable.",
    ]);
  });

  it("writes the strength of each material model", () => {
    expect(strengthText({ kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 })).toBe("c' = 5 kPa, φ' = 30°");
    expect(
      strengthText({ kind: "undrained", unitWeight: 16, undrainedShearStrength: 20, suRateOfChange: 1.5, suRefDepth: 3, suMax: 40 }),
    ).toBe("Su = 20 kPa, + 1.5 kPa/m below y = 3 m, maximum 40 kPa");
    expect(
      strengthText({ kind: "s-f-depth", unitWeight: 16, suRef: 10, depthRef: 0, rate: -1, suMax: 4, depthReference: "layer-top" }),
    ).toBe("Su = 10 kPa at 0 m below the layer top, -1 kPa/m with depth, minimum 4 kPa");
    expect(
      strengthText({ kind: "lime-cement-columns", unitWeight: 16, soilSu: 10, columnSu: 100, areaRatio: 0.2, columnCohesion: 20, columnFrictionAngle: 30 }),
    ).toBe("soil Su = 10 kPa; columns Su = 100 kPa, area ratio 0.2, drained c' = 20 kPa, φ' = 30°");
    expect(strengthText({ kind: "impenetrable", unitWeight: 22 })).toContain("impenetrable");
  });
});
