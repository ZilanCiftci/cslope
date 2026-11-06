import { describe, expect, it } from "vitest";
import { publicDefaultOptions, SCHEMA_NAMES, schemaVersion, summarizeResult, validateDefinition } from "./validate";
import { runAnalysis } from "./run-analysis";
import { swedishPartialFactors, type AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";

const definition: SlopeDefinition = {
  coordinates: [[0, 0], [0, 15], [15, 15], [35, 5], [50, 5], [50, 0]],
  materials: [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 40 } }],
};

describe("schemas", () => {
  it("are versioned as the engine", () => {
    expect(schemaVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SCHEMA_NAMES).toContain("analysis-document");
  });
});

describe("validateDefinition", () => {
  it("accepts a valid definition", () => {
    expect(validateDefinition(definition, { method: "Bishop" })).toEqual([]);
  });

  it("reports an unknown key and a missing one with their paths", () => {
    const bad = {
      ...definition,
      materials: [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, su: 40 } }],
    };
    const issues = validateDefinition({ format: "cslope-analysis", formatVersion: 1, definition: bad });
    expect(issues).toContainEqual(expect.objectContaining({ path: "/definition/materials/0/model/su", code: "unknown-key", severity: "error" }));
    expect(issues).toContainEqual(
      expect.objectContaining({ path: "/definition/materials/0/model/undrainedShearStrength", code: "missing-key" }),
    );
  });
});

describe("summarizeResult", () => {
  const quick: Partial<AnalysisOptions> = { ...publicDefaultOptions(), iterations: 500, refinedIterations: 0 };

  it("says factor of safety on characteristic values", () => {
    const r = runAnalysis(definition, quick as AnalysisOptions);
    const s = summarizeResult(r, quick, "test");
    expect(s.fosLabel).toBe("factor of safety");
    expect(s.valueBasis).toBe("characteristic");
    expect(s.fos).toBe(r.minFOS);
    expect(s.method).toMatch(/^Morgenstern-Price/);
    expect(s.criticalSurface?.entry).toEqual(r.criticalSurface?.entryPoint);
  });

  it("says over-design factor with partial factors, and lists them", () => {
    const pf = swedishPartialFactors({ safetyClass: 3, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 });
    const o = { ...quick, partialFactors: pf };
    const s = summarizeResult(runAnalysis(definition, o as AnalysisOptions), o);
    expect(s.fosLabel).toBe("over-design factor");
    expect(s.valueBasis).toBe("design");
    expect(s.partialFactors?.cu).toBe(1.5);
    expect(s.partialFactors?.basis?.safetyClass).toBe(3);
    expect(s.engineBuild).toMatch(/^cslope-wasm/);
  });
});
