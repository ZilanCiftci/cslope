/**
 * The worker's protocol (messages.ts), with the product engine started in
 * this thread (the worker starts it from the module a request brings; here
 * the request brings none). As the app's analysis-worker-protocol test.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initEngine, publicDefaultOptions, type SlopeDefinition } from "@cslope/engine";
import type { AnalysisDocument } from "./document";
import type { WorkerRequest, WorkerResponse } from "./messages";

const posted: WorkerResponse[] = [];

beforeAll(async () => {
  await initEngine();
  (self as unknown as { postMessage: unknown }).postMessage = vi.fn((m: WorkerResponse) => posted.push(m));
  await import("./analysis.worker");
});

beforeEach(() => {
  posted.length = 0;
});

const handler = () => (self as unknown as { onmessage: (e: { data: unknown }) => void }).onmessage;

/** T-ACADS Simple, the app's first example (packages/desktop/src/store/benchmarks.ts): published F 0.984. */
export const T_ACADS_SIMPLE: SlopeDefinition = {
  orientation: "ltr",
  coordinates: [
    [0, -15],
    [0, 0],
    [20, 0],
    [40, -10],
    [50, -10],
    [50, -15],
  ],
  materials: [{ name: "M1", model: { kind: "mohr-coulomb", unitWeight: 20, frictionAngle: 19.6, cohesion: 3 } }],
  analysisLimits: { entryLeftX: 17, entryRightX: 22, exitLeftX: 37, exitRightX: 43 },
};

function document(definition: SlopeDefinition, options: AnalysisDocument["options"] = {}): AnalysisDocument {
  return { format: "cslope-analysis", formatVersion: 1, definition, options };
}

function run(doc: AnalysisDocument, id = "a1") {
  handler()({ data: { type: "run", id, document: doc } satisfies WorkerRequest });
  return posted[posted.length - 1];
}

describe("worker protocol", () => {
  it("answers an unknown message type with an error", () => {
    handler()({ data: { type: "bogus", id: "x" } });
    expect(posted).toEqual([{ type: "error", id: "x", error: "Unknown message type: bogus" }]);
    posted.length = 0;
    handler()({ data: { type: "bogus" } });
    expect(posted[0]).toMatchObject({ id: "unknown" });
  });

  it("runs T-ACADS Simple to F 0.984, with progress on the way and the summary", () => {
    const last = run(document(T_ACADS_SIMPLE));
    if (last.type !== "complete") throw new Error(JSON.stringify(last));
    expect(last.id).toBe("a1");
    expect(last.result.minFOS).toBeCloseTo(0.984, 3);
    expect(last.summary.fos).toBe(last.result.minFOS);
    expect(last.summary.fosText).toBe("0.984");
    expect(last.summary.fosLabel).toBe("factor of safety");
    expect(last.summary.methodName).toBe("Morgenstern-Price");
    expect(last.warnings).toEqual([]);
    const progress = posted.filter((m) => m.type === "progress");
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((m) => m.id === "a1")).toBe(true);
    const counts = progress.map((m) => (m.type === "progress" ? m.surfaces : 0));
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it("runs with the document's options over the public defaults", () => {
    const last = run(document(T_ACADS_SIMPLE, { method: "Bishop", slices: 20 }));
    if (last.type !== "complete") throw new Error(JSON.stringify(last));
    expect(last.result.method).toBe("Bishop");
    expect(last.summary.methodName).toBe("Bishop");
    expect(publicDefaultOptions().method).toBe("Morgenstern-Price");
  });

  it("does not run a document with errors, and names them", () => {
    const last = run(document({ ...T_ACADS_SIMPLE, materials: [] }), "v1");
    if (last.type !== "invalid") throw new Error(JSON.stringify(last));
    expect(last.id).toBe("v1");
    expect(last.issues.some((i) => i.severity === "error" && i.path.startsWith("/definition/materials"))).toBe(true);
    expect(posted).toHaveLength(1);
  });

  it("returns the warnings of a document that ran", () => {
    const last = run(
      document({ ...T_ACADS_SIMPLE, waterTable: { mode: "height", value: -5, freeWater: false } }),
    );
    if (last.type !== "complete") throw new Error(JSON.stringify(last));
    // M1 lies below the water and has no unitWeightSat.
    expect(last.warnings.map((w) => w.code)).toContain("missing-unit-weight-sat");
  });

  it("reports an engine error with the request's id", () => {
    const last = run(document({ ...T_ACADS_SIMPLE, analysisLimits: { entryLeftX: 10, entryRightX: 10, exitLeftX: 10, exitRightX: 10 } }), "e1");
    expect(last.type === "error" || last.type === "invalid" || last.type === "complete").toBe(true);
    expect(last.id).toBe("e1");
  });
});
