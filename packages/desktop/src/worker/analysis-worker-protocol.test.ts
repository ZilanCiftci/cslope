import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ANALYSIS_OPTIONS,
  toCanonicalSlopeDefinition,
  type AnalysisOptions,
  type SlopeDefinition,
} from "@cslope/engine";
import type { AnalysisResponse } from "./messages";

const reliability = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("./reliability-run", () => ({
  runReliabilityRequest: reliability.run,
}));

const posted: AnalysisResponse[] = [];

beforeAll(async () => {
  (self as unknown as { postMessage: unknown }).postMessage = vi.fn(
    (msg: AnalysisResponse) => posted.push(msg),
  );
  await import("./analysis.worker");
});

beforeEach(() => {
  posted.length = 0;
  reliability.run.mockReset();
});

const handler = () =>
  (self as unknown as { onmessage: (e: unknown) => void }).onmessage;

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
};

function analyse(slope: SlopeDefinition, extra: Partial<AnalysisOptions> = {}) {
  handler()({
    data: {
      type: "run-analysis",
      id: "a1",
      slope: toCanonicalSlopeDefinition(slope),
      options: { ...DEFAULT_ANALYSIS_OPTIONS, iterations: 300, ...extra },
    },
  });
  return posted[posted.length - 1];
}

describe("worker protocol", () => {
  it("answers an unknown message type with an error", () => {
    handler()({ data: { type: "bogus", id: "x" } });
    expect(posted).toEqual([
      { type: "analysis-error", id: "x", error: "Unknown message type: bogus" },
    ]);
    posted.length = 0;
    handler()({ data: { type: "bogus" } });
    expect(posted[0]).toMatchObject({ id: "unknown" });
  });

  it("runs a reliability request, forwarding progress, and returns its result", () => {
    reliability.run.mockImplementation((_req, onProgress: (p: number) => void) => {
      onProgress(0.25);
      onProgress(1);
      return { pf: 0.02 };
    });
    const req = {
      type: "run-reliability",
      id: "r1",
      slope: T_ACADS,
      options: DEFAULT_ANALYSIS_OPTIONS,
      variables: [],
      reliability: { method: "taylor" },
    };
    handler()({ data: req });
    expect(reliability.run).toHaveBeenCalledWith(req, expect.any(Function));
    expect(posted).toEqual([
      { type: "analysis-progress", id: "r1", progress: 0.25 },
      { type: "analysis-progress", id: "r1", progress: 1 },
      { type: "reliability-complete", id: "r1", result: { pf: 0.02 } },
    ]);
  });

  it("reports reliability failures, including non-Error throws", () => {
    reliability.run.mockImplementationOnce(() => {
      throw new Error("No variables");
    });
    handler()({ data: { type: "run-reliability", id: "r2" } });
    expect(posted.at(-1)).toEqual({
      type: "analysis-error",
      id: "r2",
      error: "No variables",
    });
    reliability.run.mockImplementationOnce(() => {
      throw "plain";
    });
    handler()({ data: { type: "run-reliability", id: "r3" } });
    expect(posted.at(-1)).toEqual({ type: "analysis-error", id: "r3", error: "plain" });
  });

  it("reports an analysis error for a broken definition", () => {
    const msg = analyse({ ...T_ACADS, coordinates: [] });
    expect(msg.type).toBe("analysis-error");
    expect(msg).toMatchObject({ id: "a1" });
  });

  it("returns a complete result with timing, moments and volume", () => {
    const msg = analyse(T_ACADS);
    if (msg.type !== "analysis-complete") throw new Error(JSON.stringify(msg));
    const r = msg.result;
    expect(r.minFOS).toBeGreaterThan(0.5);
    expect(r.minFOS).toBeLessThan(3);
    expect(r.maxFOS).toBeGreaterThanOrEqual(r.minFOS);
    expect(r.criticalSurface!.fos).toBeCloseTo(r.minFOS, 9);
    expect(r.allSurfaces[0].fos).toBeCloseTo(r.minFOS, 9);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(r.criticalSlipVolume).toBeGreaterThan(0);
    expect(r.criticalResistingMoment).toBeCloseTo(
      r.criticalPushingMoment! * r.minFOS,
      6,
    );
    expect(r.nonConvergedSurfaces).toBeGreaterThanOrEqual(0);
  });

  it("reports the interslice force function only for Morgenstern-Price", () => {
    const mp = analyse(T_ACADS, { method: "Morgenstern-Price" });
    const bishop = analyse(T_ACADS, { method: "Bishop" });
    if (mp.type !== "analysis-complete" || bishop.type !== "analysis-complete") {
      throw new Error("analysis failed");
    }
    expect(mp.result.criticalLffArray).toBeDefined();
    expect(bishop.result.criticalLffArray).toBeUndefined();
    expect(bishop.result.method).toBe("Bishop");
  });

  it("custom planes only ignores the both-directions option", () => {
    const msg = analyse(
      {
        ...T_ACADS,
        customPlanesOnly: true,
        customSearchPlanes: [{ cx: 30, cy: 20, radius: 30 }],
      },
      { bothDirections: true },
    );
    if (msg.type !== "analysis-complete") throw new Error(JSON.stringify(msg));
    expect(msg.result.slidingDirection).toBeUndefined();
    expect(msg.result.allSurfaces).toHaveLength(1);
  });

  it("counts an active anchor on the driving side of the moment balance", () => {
    const circle = {
      ...T_ACADS,
      customPlanesOnly: true,
      customSearchPlanes: [{ cx: 30, cy: 20, radius: 30 }],
    };
    const plain = analyse(circle);
    const anchored = analyse({
      ...circle,
      reinforcements: [
        { x1: 32, y1: -4, x2: 10, y2: -4, tensileCapacity: 200, application: "active" },
      ],
    } as SlopeDefinition);
    if (plain.type !== "analysis-complete" || anchored.type !== "analysis-complete") {
      throw new Error("analysis failed");
    }
    const a = anchored.result;
    expect(a.criticalPushingMoment).toBeDefined();
    expect(a.criticalPushingMoment).not.toBeCloseTo(plain.result.criticalPushingMoment!, 3);
    expect(a.criticalResistingMoment).toBeCloseTo(a.criticalPushingMoment! * a.minFOS, 6);
    expect(a.criticalSurface!.reinforcementForces!.length).toBeGreaterThan(0);
  });

  it("reports no moments for a non-circular surface", () => {
    const msg = analyse({
      ...T_ACADS,
      customPlanesOnly: true,
      customSurfaces: [{ points: [[8, 0], [30, -12], [45, -10]] }],
    } as SlopeDefinition);
    if (msg.type !== "analysis-complete") throw new Error(JSON.stringify(msg));
    expect(msg.result.criticalSurface!.points!.length).toBeGreaterThanOrEqual(2);
    expect(msg.result.criticalPushingMoment).toBeUndefined();
    expect(msg.result.criticalResistingMoment).toBeUndefined();
    expect(msg.result.criticalSlipVolume).toBeGreaterThan(0);
  });
});
