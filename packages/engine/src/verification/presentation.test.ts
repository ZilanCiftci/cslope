import { describe, expect, it } from "vitest";
import { VERIFICATION_CASES } from "./index";
import {
  analysisLabel,
  formatPaperValue,
  formatRange,
  isProgramSource,
  paperValues,
  presentedAnalyses,
} from "./presentation";

const byId = (id: string) => VERIFICATION_CASES.find((c) => c.id === id)!;

describe("verification presentation", () => {
  it("names the analyses as cSlope runs them", () => {
    expect(analysisLabel("Bishop")).toBe("Bishop simplified");
    expect(analysisLabel("Janbu", { janbuCorrection: true })).toBe("Janbu corrected");
    expect(analysisLabel("Janbu")).toBe("Janbu simplified");
    expect(analysisLabel("Morgenstern-Price", { intersliceFunction: "constant", nonCircularOptimization: true })).toBe(
      "Spencer, non-circular",
    );
    expect(analysisLabel("Morgenstern-Price")).toBe("Morgenstern-Price (half-sine)");
    expect(analysisLabel("Morgenstern-Price", { intersliceFunction: "data-point-specified" })).toBe(
      "Morgenstern-Price (specified f(x))",
    );
  });

  it("tells programs from papers", () => {
    expect(isProgramSource("Commercial program A (non-circular)")).toBe(true);
    expect(isProgramSource("Program D")).toBe(true);
    expect(isProgramSource("Duncan & Wright (reference)")).toBe(false);
    expect(isProgramSource("Theory (infinite slope)")).toBe(false);
  });

  it("gives each analysis the range of the other programs' values (V001)", () => {
    const a = presentedAnalyses(byId("V001"));
    const bishop = a.find((x) => x.label === "Bishop simplified")!;
    expect(bishop.programs).toEqual({ min: 1.409, max: 1.417, count: 2 });
    expect(a.map((x) => x.label)).toContain("Spencer, non-circular");
  });

  it("merges a default and its explicit value, and qualifies analyses that would share a name", () => {
    for (const c of VERIFICATION_CASES) {
      const labels = presentedAnalyses(c).map((x) => x.label);
      expect(new Set(labels).size, c.id).toBe(labels.length);
    }
    // V047a has Bishop with and without slices: 50, the verification default, is one analysis.
    expect(presentedAnalyses(byId("V047a")).filter((x) => x.label.startsWith("Bishop")).length).toBe(1);
  });

  it("lists the papers' values: the literature checks and the further values, once each", () => {
    const v = paperValues(byId("V001"));
    expect(v[0]).toEqual({
      value: 1.451,
      method: "Bishop simplified",
      source: "Arai & Tagyo (1985)",
      analysis: "Bishop simplified",
    });
    expect(paperValues(byId("V021d")).some((x) => x.source === "Chowdhury & Xu" && x.value === 1.0639)).toBe(true);
    const fe = paperValues(byId("V055")).find((x) => x.source === "Griffiths & Lane");
    expect(fe?.method).toBe("finite elements");
    expect(paperValues(byId("V005"))[0]).toMatchObject({ source: "Theory", method: "infinite slope" });
    expect(paperValues(byId("V009b"))[0]).toMatchObject({ source: "Baker & Leshchinsky", method: "Spencer" });
    const twice = { checks: [], paper: [{ value: 1, source: "X" }, { value: 1, source: "X" }] };
    expect(paperValues(twice)).toHaveLength(1);
  });

  it("formats values as the source prints them", () => {
    expect(formatPaperValue({ value: 1.24, upper: 1.27, source: "x" })).toBe("1.24–1.27");
    expect(formatPaperValue({ value: 1.451, source: "x" })).toBe("1.451");
    expect(formatPaperValue({ value: 1, source: "x" })).toBe("1.00");
    expect(formatPaperValue({ value: 1.0639, source: "x" })).toBe("1.0639");
    expect(formatRange({ min: 1.409, max: 1.417 })).toBe("1.409–1.417");
    expect(formatRange({ min: 1.4, max: 1.4 })).toBe("1.400");
  });

  it("names no program in what is published", () => {
    const text = JSON.stringify(
      VERIFICATION_CASES.map((c) => [c.title, c.description, c.publicNote, paperValues(c), presentedAnalyses(c).map((a) => a.label)]),
    );
    expect(text).not.toMatch(/\b[Pp]rogram [A-Z]\b/);
  });

  it("gives each published value with a method cSlope has an analysis, adding the missing ones untested", () => {
    const c = byId("V001");
    const a = presentedAnalyses(c);
    const janbu = a.find((x) => x.label === "Janbu corrected, non-circular")!;
    expect(janbu.checks).toEqual([]);
    expect(janbu.options).toMatchObject({ janbuCorrection: true, nonCircularOptimization: true });
    for (const v of paperValues(c)) expect(a.map((x) => x.label)).toContain(v.analysis);
    // A method cSlope does not have gets none.
    expect(paperValues(byId("V084b"))[0].analysis).toBeUndefined();
    expect(paperValues(byId("V067")).find((v) => v.method === "Ordinary")?.analysis).toBeUndefined();
    // Every analysis label a published value names exists.
    for (const p of VERIFICATION_CASES) {
      const labels = presentedAnalyses(p).map((x) => x.label);
      for (const v of paperValues(p)) if (v.analysis) expect(labels, p.id).toContain(v.analysis);
    }
  });
});
