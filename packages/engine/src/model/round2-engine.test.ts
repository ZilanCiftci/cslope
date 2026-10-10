import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { analyseSlope, analyseBishop } from "./solvers";
import { generatePlanes } from "./search";
import { toCanonicalSlopeDefinition } from "./canonical";
import { validateMaterialModel } from "../types/validation";
import { resolveStrength } from "../types/strength";
import type { SlopeDefinition } from "../types/slope-definition";

const BASE: SlopeDefinition = {
  coordinates: [
    [0, -15],
    [0, 0],
    [20, 0],
    [40, -10],
    [60, -10],
    [60, -15],
  ],
  materials: [{ name: "A", unitWeight: 20, frictionAngle: 30, cohesion: 5 }],
};

describe("search respects limits on the actual surfaces", () => {
  it("refinement does not add surfaces outside the entry/exit limits", () => {
    const limits = { entryLeftX: 0, entryRightX: 12, exitLeftX: 50, exitRightX: 60 };
    const slope = buildSlope({ ...BASE, analysisLimits: limits });
    slope.updateAnalysisOptions({ iterations: 1000, refinedIterations: 2000 });
    analyseSlope(slope);
    const valid = slope.search.filter((p) => p.fos != null);
    expect(valid.length).toBeGreaterThan(0);
    for (const p of valid) {
      expect(p.lc[0]).toBeGreaterThanOrEqual(limits.entryLeftX - 1e-9);
      expect(p.lc[0]).toBeLessThanOrEqual(limits.entryRightX + 1e-9);
      expect(p.rc[0]).toBeGreaterThanOrEqual(limits.exitLeftX - 1e-9);
      expect(p.rc[0]).toBeLessThanOrEqual(limits.exitRightX + 1e-9);
    }
  });

  it("enforces the minimum failure distance horizontally on each surface", () => {
    const slope = buildSlope(BASE);
    slope.updateAnalysisOptions({ iterations: 1000, minFailureDist: 30 });
    analyseSlope(slope);
    for (const p of slope.search.filter((q) => q.fos != null)) {
      expect(p.rc[0] - p.lc[0]).toBeGreaterThan(30);
    }
  });

  it("keeps circles that pass exactly through a surface vertex", () => {
    const slope = buildSlope(BASE);
    const planes = generatePlanes(slope, [20, 0], [45, -10], 5);
    expect(planes).toHaveLength(5);
    for (const p of planes) expect(p.lc[0]).toBeCloseTo(20, 9);
  });
});

describe("geometry and slices", () => {
  it("finds the ground surface even when the toe has many vertices", () => {
    const toe: [number, number][] = [];
    for (let x = 42; x <= 100; x += 2) toe.push([x, -10]);
    const slope = buildSlope({
      ...BASE,
      coordinates: [[0, -12], [0, 0], [20, 0], [40, -10], ...toe, [100, -12]],
    });
    expect(slope.surfaceLineXY!.y.every((y) => y >= -10)).toBe(true);
  });

  it("does not drop the slice next to a vertical face", () => {
    const slope = buildSlope({
      ...BASE,
      coordinates: [[0, -20], [0, 0], [20, 0], [20, -10], [60, -10], [60, -20]],
      materials: [{ name: "A", unitWeight: 20, frictionAngle: 30, cohesion: 10 }],
    });
    const [cx, cy, r] = [22, 2, 4];
    const pts = slope.getCircleExternalIntersection(cx, cy, r);
    const slices = getSlices(slope, pts[0][0], pts[1][0], cx, cy, r);
    expect(slices[slices.length - 1].xRight).toBeCloseTo(pts[1][0], 9);
    const covered = slices.reduce((sum, s) => sum + s.width, 0);
    expect(covered).toBeCloseTo(pts[1][0] - pts[0][0], 9);
  });

  it("FOS does not jump when a line load crosses a slice boundary", () => {
    const run = (x: number) => {
      const slope = buildSlope({ ...BASE, lineLoads: [{ magnitude: 300, x }] });
      slope.updateAnalysisOptions({ slices: 25 });
      const [cx, cy, r] = [32.63, 17.7, 30.33];
      const pts = slope.getCircleExternalIntersection(cx, cy, r);
      return analyseBishop(slope, getSlices(slope, pts[0][0], pts[1][0], cx, cy, r))[0]!;
    };
    // FOS must change smoothly with the load position: previously it stayed
    // flat and then jumped by 0.016 at the slice boundary (x = 9.5).
    const fos = [9.3, 9.35, 9.4, 9.45, 9.5, 9.55, 9.6, 9.65, 9.7].map(run);
    for (let i = 1; i < fos.length; i++) {
      const step = fos[i] - fos[i - 1];
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(0.002);
    }
  });
});

describe("materials and mirroring", () => {
  it("gives the same FOS for a spatial Mohr-Coulomb model and its mirror", () => {
    const spatial: SlopeDefinition = {
      ...BASE,
      materials: [
        {
          name: "S",
          unitWeight: 20,
          frictionAngle: 0,
          cohesion: 0,
          model: {
            kind: "spatial-mohr-coulomb",
            unitWeight: 20,
            dataPoints: [
              [5, -2, 2, 25, 20],
              [40, -12, 12, 35, 20],
            ],
          },
        },
      ],
    };
    const ltr = buildSlope(toCanonicalSlopeDefinition(spatial));
    const mirrored = buildSlope(
      toCanonicalSlopeDefinition({
        ...spatial,
        orientation: "rtl",
        coordinates: spatial.coordinates.map(([x, y]) => [60 - x, y]),
        materials: [
          {
            ...spatial.materials[0],
            model: {
              kind: "spatial-mohr-coulomb",
              unitWeight: 20,
              dataPoints: [
                [55, -2, 2, 25, 20],
                [20, -12, 12, 35, 20],
              ],
            },
          },
        ],
      }),
    );
    for (const s of [ltr, mirrored]) s.updateAnalysisOptions({ iterations: 500 });
    expect(analyseSlope(mirrored)!).toBeCloseTo(analyseSlope(ltr)!, 9);
  });

  it("rejects φ ≥ 90° and keeps a modified φ below 90°", () => {
    expect(
      validateMaterialModel({ kind: "mohr-coulomb", unitWeight: 20, cohesion: 1, frictionAngle: 120 }),
    ).not.toHaveLength(0);
    const r = resolveStrength(
      { kind: "anisotropic-function", unitWeight: 20, cohesion: 5, frictionAngle: 35, modifierFunction: [[-90, 3], [90, 3]] },
      { yBottom: 0, x: 0, yGround: 0, alpha: 0 },
    );
    expect(r.frictionAngle).toBeLessThan(90);
  });

  it("keeps surfaces when the inner iteration limit is tiny", () => {
    const slope = buildSlope(BASE);
    slope.updateAnalysisOptions({ iterations: 500, maxIterations: 3 });
    expect(analyseSlope(slope)).not.toBeNull();
  });
});
