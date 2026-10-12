import { describe, expect, it } from "vitest";
import { VERIFICATION, homeExamples } from "./verification";

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
