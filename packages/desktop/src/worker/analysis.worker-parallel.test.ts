/**
 * The analysis worker with evaluators: the request brings MessagePorts to
 * evaluators (here served in-process by the engine over real channels) and
 * the result is the one without them, apart from the run time.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ANALYSIS_OPTIONS,
  serveEvaluator,
  toCanonicalSlopeDefinition,
  webEndpoint,
  type AnalysisOptions,
  type RandomVariable,
  type SlopeDefinition,
} from "@cslope/engine";
import type { AnalysisResponse, WorkerMessage } from "./messages";

const posted: AnalysisResponse[] = [];

beforeAll(async () => {
  (self as unknown as { postMessage: unknown }).postMessage = vi.fn((msg: AnalysisResponse) => posted.push(msg));
  await import("./analysis.worker");
});

const handler = () => (self as unknown as { onmessage: (e: unknown) => Promise<void> }).onmessage;

/** Ports to `n` evaluators served in-process (the other ends of the channels). */
function evaluators(n: number): MessagePort[] {
  return Array.from({ length: n }, () => {
    const channel = new MessageChannel();
    serveEvaluator(webEndpoint(channel.port1));
    return channel.port2;
  });
}

/** The worker's last answer to a request. */
async function send(data: WorkerMessage): Promise<AnalysisResponse> {
  posted.length = 0;
  await handler()({ data });
  const last = posted.filter((m) => m.type !== "analysis-progress").at(-1);
  if (!last) throw new Error("no answer");
  return last;
}

const T_ACADS: SlopeDefinition = {
  coordinates: [[0, -15], [0, 0], [20, 0], [40, -10], [50, -10], [50, -15]],
  materials: [{ name: "M1", unitWeight: 20, frictionAngle: 19.6, cohesion: 3 }],
  udls: [{ magnitude: 10, x1: 5, x2: 15 }],
};
const slope = toCanonicalSlopeDefinition(T_ACADS);

function result(msg: AnalysisResponse) {
  if (msg.type !== "analysis-complete" && msg.type !== "reliability-complete") throw new Error(JSON.stringify(msg));
  const r = { ...msg.result } as Record<string, unknown>;
  delete r.elapsedMs;
  return r;
}

describe("analysis worker with evaluators", () => {
  const cases: [string, Partial<AnalysisOptions>][] = [
    ["circular, Morgenstern-Price", { method: "Morgenstern-Price", iterations: 300, refinedIterations: 200 }],
    ["both directions, Bishop", { method: "Bishop", iterations: 300, refinedIterations: 100, bothDirections: true }],
    ["non-circular optimisation", { method: "Morgenstern-Price", intersliceFunction: "constant", iterations: 200, refinedIterations: 100, nonCircularOptimization: true }],
  ];
  for (const [label, extra] of cases) {
    it(`${label}: the same result as without`, async () => {
      const options = { ...DEFAULT_ANALYSIS_OPTIONS, ...extra };
      const alone = await send({ type: "run-analysis", id: "a", slope, options });
      const shared = await send({ type: "run-analysis", id: "b", slope, options, evaluators: evaluators(2) });
      expect(shared).toMatchObject({ type: "analysis-complete", id: "b" });
      expect(result(shared)).toEqual(result(alone));
      // the critical slices are there, restored by the analysis worker
      expect((result(shared).criticalSlices as unknown[]).length).toBeGreaterThan(0);
    });
  }

  it("a Monte Carlo analysis: the same samples, and real progress", async () => {
    const variables: RandomVariable[] = [{ material: 0, field: "cohesion", sd: 1 }];
    const base = {
      type: "run-reliability" as const,
      slope,
      options: { ...DEFAULT_ANALYSIS_OPTIONS, method: "Bishop", iterations: 300, refinedIterations: 100 } as AnalysisOptions,
      variables,
      reliability: { method: "monte-carlo" as const, samples: 300, seed: 2 },
    };
    const alone = await send({ ...base, id: "r1" });
    const shared = await send({ ...base, id: "r2", evaluators: evaluators(3) });
    expect(result(shared)).toEqual(result(alone));
    expect(posted.some((m) => m.type === "analysis-progress")).toBe(true);
  });

  it("an error with evaluators is reported as without", async () => {
    const options = { ...DEFAULT_ANALYSIS_OPTIONS, iterations: 100 };
    const msg = await send({ type: "run-analysis", id: "e", slope: { ...slope, coordinates: [] }, options, evaluators: evaluators(1) });
    expect(msg).toMatchObject({ type: "analysis-error", id: "e" });
  });
});
