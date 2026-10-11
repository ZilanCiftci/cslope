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
  it("sends the effective normal force and surface load for each slice", () => {
    const msg = run(T_ACADS);
    expect(msg.type).toBe("analysis-complete");
    if (msg.type !== "analysis-complete") return;
    const slices = msg.result.criticalSlices;
    expect(slices.length).toBeGreaterThan(0);
    expect(slices.some((s) => s.normalForce > 0)).toBe(true);
    for (const s of slices) {
      const expected =
        (s.weight + (s.surfaceLoad ?? 0)) * Math.cos(s.alpha) -
        s.porePressure * s.baseLength;
      expect(s.normalForce).toBeCloseTo(expected, 9);
    }
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
});
