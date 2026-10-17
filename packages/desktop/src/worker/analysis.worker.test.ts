import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ANALYSIS_OPTIONS,
  toCanonicalSlopeDefinition,
  type AnalysisOptions,
  type SlopeDefinition,
} from "@cslope/engine";
import type { AnalysisResponse } from "./messages";

const posted: AnalysisResponse[] = [];

beforeAll(async () => {
  (self as unknown as { postMessage: unknown }).postMessage = vi.fn(
    (msg: AnalysisResponse) => posted.push(msg),
  );
  await import("./analysis.worker");
});

function run(
  slope: SlopeDefinition,
  extra: Partial<AnalysisOptions> = {},
): AnalysisResponse {
  posted.length = 0;
  const handler = (self as unknown as { onmessage: (e: unknown) => void })
    .onmessage;
  handler({
    data: {
      type: "run-analysis",
      id: "t",
      slope: toCanonicalSlopeDefinition(slope),
      options: { ...DEFAULT_ANALYSIS_OPTIONS, iterations: 500, ...extra },
    },
  });
  return posted[posted.length - 1];
}

const T_ACADS: SlopeDefinition = {
  coordinates: [
    [0, -15],
    [0, 0],
    [20, 0],
    [40, -10],
    [50, -10],
    [50, -15],
  ],
  materials: [{ name: "M1", unitWeight: 20, frictionAngle: 19.6, cohesion: 3 }],
  udls: [{ magnitude: 10, x1: 5, x2: 15 }],
};

describe("analysis worker result", () => {
  it("sends the method's own effective normal force for each slice", () => {
    // Bishop on a circle, no loads: moment equilibrium about the centre
    // gives F = Σ (c·l + N′·tan φ) / Σ W·sin α with the solved N′ (the
    // ordinary-method estimate did not add up to the FOS).
    const msg = run({ ...T_ACADS, udls: [], lineLoads: [] }, { method: "Bishop" });
    expect(msg.type).toBe("analysis-complete");
    if (msg.type !== "analysis-complete") return;
    const slices = msg.result.criticalSlices;
    expect(slices.length).toBeGreaterThan(0);
    let resisting = 0;
    let driving = 0;
    for (const s of slices) {
      resisting += s.cohesion * s.baseLength + s.normalForce * Math.tan((s.frictionAngle * Math.PI) / 180);
      driving += (s.weight + (s.surfaceLoad ?? 0)) * Math.sin(s.alpha);
      expect(Number.isFinite(s.normalForce)).toBe(true);
    }
    // Within the solver tolerance (0.005 by default).
    expect(Math.abs(resisting / driving - msg.result.minFOS)).toBeLessThan(0.005 * msg.result.minFOS);
    const ordinary = slices.map((s) => (s.weight + (s.surfaceLoad ?? 0)) * Math.cos(s.alpha) - s.porePressure * s.baseLength);
    expect(slices.some((s, i) => Math.abs(s.normalForce - ordinary[i]) > 1)).toBe(true);
  });

  it("reports an error instead of FOS 0 when no surface is valid", () => {
    const msg = run({
      ...T_ACADS,
      udls: [],
      materials: [
        {
          name: "Rock",
          unitWeight: 25,
          frictionAngle: 0,
          cohesion: 0,
          model: { kind: "impenetrable", unitWeight: 25 },
        },
      ],
    });
    expect(msg.type).toBe("analysis-error");
  });
});

describe("both sliding directions", () => {
  // Ridge: steep 1:1 face on the left, gentle 2:1 face on the right; the
  // model's own direction (ltr) slides down the gentle face.
  const RIDGE: SlopeDefinition = {
    orientation: "ltr",
    coordinates: [[0, -10], [0, 0], [20, 0], [30, 10], [40, 10], [60, 0], [80, 0], [80, -10]],
    materials: [{ name: "S", unitWeight: 19, frictionAngle: 25, cohesion: 8 }],
    analysisLimits: { entryLeftX: 30, entryRightX: 40, exitLeftX: 60, exitRightX: 80 },
  };

  it("reports the steeper face, its direction and the other direction's FOS", () => {
    const one = run(RIDGE);
    const both = run(RIDGE, { bothDirections: true });
    if (one.type !== "analysis-complete" || both.type !== "analysis-complete") {
      throw new Error("analysis failed");
    }
    expect(one.result.slidingDirection).toBeUndefined();
    expect(both.result.slidingDirection).toBe("rtl");
    expect(both.result.minFOS).toBeLessThan(one.result.minFOS);
    expect(both.result.otherDirectionMinFOS).toBeCloseTo(one.result.minFOS, 9);
    const surf = both.result.criticalSurface!;
    expect(Math.max(surf.entryPoint[0], surf.exitPoint[0])).toBeLessThanOrEqual(40);
  });

  it("reports the error of the model's own direction instead of the other face", () => {
    // Limits that admit no surface: the user must see that, not a green
    // FOS from the opposite face.
    const noSurface = { ...RIDGE, analysisLimits: { entryLeftX: 70, entryRightX: 75, exitLeftX: 76, exitRightX: 80 } };
    expect(run(noSurface).type).toBe("analysis-error");
    expect(run(noSurface, { bothDirections: true }).type).toBe("analysis-error");
  });
});

describe("non-circular surfaces", () => {
  // ACADS 3 weak-layer slope, drawn right-to-left as entered.
  const WEAK: SlopeDefinition = {
    orientation: "rtl",
    coordinates: [[20, 20], [20, 27.75], [43, 27.75], [67.5, 40], [84, 40], [84, 20]],
    materials: [
      { name: "Soil", unitWeight: 18.84, frictionAngle: 20, cohesion: 28.5 },
      { name: "Weak", unitWeight: 18.84, frictionAngle: 10, cohesion: 0 },
      { name: "Below", unitWeight: 18.84, frictionAngle: 20, cohesion: 28.5 },
    ],
    materialBoundaries: [
      { coordinates: [[19, 27], [85, 27]], materialName: "" },
      { coordinates: [[19, 26.5], [85, 26.5]], materialName: "" },
    ],
    regionAssignments: [
      { point: [70, 35], materialName: "Soil" },
      { point: [30, 26.75], materialName: "Weak" },
      { point: [30, 23], materialName: "Below" },
    ],
    waterTable: { mode: "custom", value: [[20, 26.5], [84, 26.5]] },
  };

  it("optimisation returns a polyline in model space along the weak layer", () => {
    const circle = run(WEAK, { method: "Morgenstern-Price", iterations: 1000 });
    const opt = run(WEAK, { method: "Morgenstern-Price", iterations: 1000, nonCircularOptimization: true });
    if (circle.type !== "analysis-complete" || opt.type !== "analysis-complete") {
      throw new Error("analysis failed");
    }
    const surf = opt.result.criticalSurface!;
    expect(surf.points!.length).toBeGreaterThan(2);
    expect(opt.result.minFOS).toBeLessThan(circle.result.minFOS - 0.1);
    // Model space: the surface slides left, entry (crest) on the right.
    expect(surf.entryPoint[0]).toBeGreaterThan(surf.exitPoint[0]);
    expect(surf.points![0]).toEqual(surf.entryPoint);
    const lowest = Math.min(...surf.points!.map((p) => p[1]));
    expect(lowest).toBeGreaterThan(26.4);
    expect(lowest).toBeLessThan(27.1);
  });

  it("analyses a user polyline given in model space", () => {
    const msg = run(
      {
        ...WEAK,
        customSurfaces: [{ points: [[73.31, 40], [63.5, 27], [44, 26.5], [41.85, 27.75]] }],
        customPlanesOnly: true,
      },
      { method: "Morgenstern-Price" },
    );
    if (msg.type !== "analysis-complete") throw new Error("analysis failed");
    expect(msg.result.minFOS).toBeCloseTo(1.26, 2);
  });
});
