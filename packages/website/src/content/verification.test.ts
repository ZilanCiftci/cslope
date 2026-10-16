import { describe, expect, it } from "vitest";
import { VERIFICATION, filterProblems, homeExamples, methodFamily } from "./verification";
import { HOME_EXAMPLES } from "./home-examples";

describe("home page examples", () => {
  it("are the chosen problems and checks, each with a computed value", () => {
    const examples = homeExamples();
    expect(examples.map((e) => e.problem.id)).toEqual(HOME_EXAMPLES.map((e) => e.id));
    for (const [i, { problem, check }] of examples.entries()) {
      expect(problem.checks.indexOf(check)).toBe(HOME_EXAMPLES[i].check);
      expect(check.computed).not.toBeNull();
    }
  });

  it("skip a problem that is missing or has no computed value", () => {
    const d = structuredClone(VERIFICATION);
    d.problems = d.problems.filter((p) => p.id !== HOME_EXAMPLES[0].id);
    const second = d.problems.find((p) => p.id === HOME_EXAMPLES[1].id)!;
    second.checks[HOME_EXAMPLES[1].check].computed = null;
    expect(homeExamples(d).map((e) => e.problem.id)).toEqual(HOME_EXAMPLES.slice(2).map((e) => e.id));
  });
});

describe("verification filter", () => {
  const all = { query: "", source: "all", method: "all" } as const;

  it("keeps everything without a filter", () => {
    expect(filterProblems(VERIFICATION.problems, all)).toEqual(VERIFICATION.problems);
  });

  it("matches every word of the query against id, title and reference", () => {
    const r = filterProblems(VERIFICATION.problems, { ...all, query: "fredlund KRAHN" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((p) => /fredlund/i.test(p.title + p.reference))).toBe(true);
  });

  it("filters checks by method family and source, dropping problems left empty", () => {
    const spencer = filterProblems(VERIFICATION.problems, { ...all, method: "Spencer" });
    expect(spencer.flatMap((p) => p.checks).every((k) => methodFamily(k.method) === "Spencer")).toBe(true);
    const lit = filterProblems(VERIFICATION.problems, { ...all, source: "literature" });
    const com = filterProblems(VERIFICATION.problems, { ...all, source: "program" });
    const n = (ps: typeof lit) => ps.reduce((a, p) => a + p.checks.length, 0);
    expect(n(lit) + n(com)).toBe(VERIFICATION.summary.checks);
    expect(n(com)).toBeGreaterThan(0);
    expect(com.flatMap((p) => p.checks).every((k) => /\b[Pp]rogram [A-Z]\b/.test(k.source))).toBe(true);
    expect(lit.every((p) => p.checks.length > 0)).toBe(true);
  });

  it("names method families from the sources' labels", () => {
    expect(methodFamily("Spencer (M-P, constant f(x))")).toBe("Spencer");
    expect(methodFamily("Bishop simplified")).toBe("Bishop");
    expect(methodFamily("Janbu simplified (f0)")).toBe("Janbu");
    expect(methodFamily("Morgenstern-Price (half-sine)")).toBe("Morgenstern-Price");
  });
});
