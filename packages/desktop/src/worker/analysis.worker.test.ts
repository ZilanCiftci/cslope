import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ANALYSIS_OPTIONS,
  toCanonicalSlopeDefinition,
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

function run(slope: SlopeDefinition): AnalysisResponse {
  posted.length = 0;
  const handler = (self as unknown as { onmessage: (e: unknown) => void })
    .onmessage;
  handler({
    data: {
      type: "run-analysis",
      id: "t",
      slope: toCanonicalSlopeDefinition(slope),
      options: { ...DEFAULT_ANALYSIS_OPTIONS, iterations: 500 },
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
