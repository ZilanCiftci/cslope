import { describe, expect, it } from "vitest";
import { VERIFICATION, filterProblems, homeExamples, methodFamily } from "./verification";

describe("home page examples", () => {
  it("finds three literature problems with a literature value", () => {
    const examples = homeExamples();
    expect(examples).toHaveLength(3);
    for (const { problem, check } of examples) {
      expect(problem.literature).toBe(true);
      expect(check.source).not.toMatch(/program/i);
      expect(check.computed).not.toBeNull();
    }
  });

  it("skips a problem whose value comes from a program", () => {
    const d = structuredClone(VERIFICATION);
    for (const p of d.problems) for (const k of p.checks) k.source = "Commercial program A";
    expect(homeExamples(d)).toEqual([]);
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
    const com = filterProblems(VERIFICATION.problems, { ...all, source: "commercial" });
    const same = filterProblems(VERIFICATION.problems, { ...all, source: "same-input" });
    const n = (ps: typeof lit) => ps.reduce((a, p) => a + p.checks.length, 0);
    expect(n(lit) + n(com) + n(same)).toBe(VERIFICATION.summary.checks);
    expect(n(same)).toBeGreaterThan(0);
    expect(com.flatMap((p) => p.checks).every((k) => /commercial program/i.test(k.source))).toBe(true);
    expect(lit.every((p) => p.checks.length > 0)).toBe(true);
  });

  it("names method families from the sources' labels", () => {
    expect(methodFamily("Spencer (M-P, constant f(x))")).toBe("Spencer");
    expect(methodFamily("Bishop simplified")).toBe("Bishop");
    expect(methodFamily("Janbu simplified (f0)")).toBe("Janbu");
    expect(methodFamily("Morgenstern-Price (half-sine)")).toBe("Morgenstern-Price");
  });
});
