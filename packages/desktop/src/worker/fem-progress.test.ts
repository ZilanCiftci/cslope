import { describe, expect, it } from "vitest";
import { femProgressTracker, femStageText } from "./fem-progress";

describe("finite element progress", () => {
  it("names each stage, with the mesh where there can be several", () => {
    expect(femStageText({ stage: "mesh" })).toBe("Finite elements: mesh and initial stresses");
    expect(femStageText({ stage: "strengthReduction", mesh: 0, meshes: 1 })).toBe("Finite elements: strength reduction");
    expect(femStageText({ stage: "strengthReduction", mesh: 1, meshes: 2 })).toBe("Finite elements: strength reduction, mesh 2 of up to 2");
    expect(femStageText({ stage: "upperBound", mesh: 0, meshes: 4, davis: false })).toBe("Finite elements: upper bound, mesh 1 of up to 4");
    expect(femStageText({ stage: "lowerBound", mesh: 1, meshes: 4, davis: true })).toBe("Finite elements: Davis B lower bound, mesh 2 of up to 4");
  });

  it("counts the strength reduction's trials and moves the fraction forward only", () => {
    const t = femProgressTracker();
    expect(t.stage({ stage: "mesh" }).progress).toBe(0.3);
    t.stage({ stage: "strengthReduction", mesh: 0, meshes: 1 });
    const a = t.trial(1);
    expect(a.text).toBe("Finite elements: strength reduction, trial F = 1.00 (1)");
    const b = t.trial(1.234);
    expect(b.text).toBe("Finite elements: strength reduction, trial F = 1.23 (2)");
    expect(b.progress).toBeGreaterThan(a.progress);
    // many trials stay within the strength reduction's share
    let last = b;
    for (let k = 0; k < 100; k++) last = t.trial(1.5);
    expect(last.progress).toBeLessThanOrEqual(0.6);
    const ub = t.stage({ stage: "upperBound", mesh: 0, meshes: 4, davis: false });
    expect(ub.text).toBe("Finite elements: upper bound, mesh 1 of up to 4");
    const lb = t.stage({ stage: "lowerBound", mesh: 0, meshes: 4, davis: false });
    expect(lb.progress).toBeGreaterThan(ub.progress);
    const davis = t.stage({ stage: "upperBound", mesh: 0, meshes: 4, davis: true });
    expect(davis.progress).toBeGreaterThanOrEqual(0.8);
    const end = t.stage({ stage: "lowerBound", mesh: 3, meshes: 4, davis: true }).progress;
    expect(end).toBeLessThanOrEqual(0.9);
    // a stage that comes back to an earlier mesh does not move it back
    expect(t.stage({ stage: "upperBound", mesh: 0, meshes: 4, davis: false }).progress).toBe(end);
  });
});
