import { describe, expect, it } from "vitest";
import { VERIFICATION, filterProblems, formatPublished, formatRange, homeExamples, methodFamily } from "./verification";
import { HOME_EXAMPLES } from "./home-examples";

describe("home page examples", () => {
  it("are the chosen problems and analyses, each with a result", () => {
    const examples = homeExamples();
    expect(examples.map((e) => e.problem.id)).toEqual(HOME_EXAMPLES.map((e) => e.id));
    for (const [i, { result }] of examples.entries()) {
      expect(result.method).toBe(HOME_EXAMPLES[i].method);
      expect(result.computed).not.toBeNull();
    }
  });

  it("skip a problem that is missing or has no result", () => {
    const d = structuredClone(VERIFICATION);
    d.problems = d.problems.filter((p) => p.id !== HOME_EXAMPLES[0].id);
    const second = d.problems.find((p) => p.id === HOME_EXAMPLES[1].id)!;
    second.results.find((r) => r.method === HOME_EXAMPLES[1].method)!.computed = null;
    expect(homeExamples(d).map((e) => e.problem.id)).toEqual(HOME_EXAMPLES.slice(2).map((e) => e.id));
  });
});

describe("verification filter", () => {
  const all = { query: "", published: "all", method: "all" } as const;

  it("keeps everything without a filter", () => {
    expect(filterProblems(VERIFICATION.problems, all)).toEqual(VERIFICATION.problems);
  });

  it("matches every word of the query against id, title, reference and sources", () => {
    const r = filterProblems(VERIFICATION.problems, { ...all, query: "fredlund KRAHN" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((p) => /fredlund/i.test(p.title + p.reference + JSON.stringify(p.published)))).toBe(true);
  });

  it("filters analyses by method family, dropping problems left empty", () => {
    const spencer = filterProblems(VERIFICATION.problems, { ...all, method: "Spencer" });
    expect(spencer.length).toBeGreaterThan(0);
    expect(spencer.flatMap((p) => p.results).every((r) => methodFamily(r.method) === "Spencer")).toBe(true);
  });

  it("splits the problems by whether a source publishes a value", () => {
    const withV = filterProblems(VERIFICATION.problems, { ...all, published: "with" });
    const without = filterProblems(VERIFICATION.problems, { ...all, published: "without" });
    expect(withV.length + without.length).toBe(VERIFICATION.problems.length);
    expect(withV.every((p) => p.published.length > 0)).toBe(true);
    expect(without.every((p) => p.published.length === 0)).toBe(true);
  });

  it("names method families from cSlope's labels", () => {
    expect(methodFamily("Spencer, non-circular")).toBe("Spencer");
    expect(methodFamily("Bishop simplified")).toBe("Bishop");
    expect(methodFamily("Janbu corrected")).toBe("Janbu");
    expect(methodFamily("Morgenstern-Price (half-sine)")).toBe("Morgenstern-Price");
    expect(methodFamily("Strength reduction (FE)")).toBe("Finite elements");
  });

  it("prints values as the sources do, and ranges", () => {
    expect(formatPublished({ value: 1.24, upper: 1.27 })).toBe("1.24–1.27");
    expect(formatPublished({ value: 1.0639 })).toBe("1.0639");
    expect(formatPublished({ value: 1 })).toBe("1.00");
    expect(formatRange({ min: 1.409, max: 1.417 })).toBe("1.409–1.417");
    expect(formatRange({ min: 1.4, max: 1.4 })).toBe("1.400");
    expect(formatRange(null)).toBe("–");
  });
});
