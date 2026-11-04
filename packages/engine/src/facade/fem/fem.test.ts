/**
 * Tests of the FE facade itself: the fem modules call only internal
 * functions the testing build has, the data equals the engine's, size fields and models cross as handles, callbacks run and
 * their exceptions come back.
 */
import { describe, expect, it } from "vitest";
import { engine } from "../../engine";
import { testingEngine } from "../internal";
import * as feModelData from "../../fem/model";
import * as elementsData from "../../fem/elements";
import * as pilesData from "../../fem/piles";
import * as analysisData from "../../fem/analysis";
import * as limitCommonData from "../../fem/limit-common";
import { runFemSummary } from "../../fem/summary";
import { boundSolver } from "../../fem/lower-bound";
import { buildFeModel } from "../../fem/model";
import { refinedSizeField, dorflerMark, zzIndicator } from "../../fem/adapt";
import { solveElastic } from "../../fem/model";
import { analyzeFem } from "../../fem/analysis";
import { strengthReduction } from "../../fem/srm";
import { buildSlope } from "../../model/build-slope";
import { toCanonicalSlopeDefinition } from "../../model/canonical";
import { DEFAULT_FEM_SETTINGS } from "../../types/analysis";
import type { SlopeDefinition } from "../../types/slope-definition";
import { slopeRef } from "./_handles";

declare global {
  interface ImportMeta {
    glob(patterns: string[], options?: { query?: string; import?: string; eager?: boolean }): Record<string, unknown>;
  }
}

const sources = import.meta.glob(["../../fem/*.ts", "!../../fem/*.test.ts", "./*.ts", "!./*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

const cut: SlopeDefinition = {
  coordinates: [[0, 0], [0, 10], [10, 10], [15, 5], [30, 5], [30, 0]],
  materials: [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 20 } }],
} as unknown as SlopeDefinition;

describe("FE facade", () => {
  it("calls only internal functions the testing build has", () => {
    const known = new Set(testingEngine().__test_functions());
    const used = Object.values(sources).flatMap((s) => [...s.matchAll(/testCall(?:<[^>]*>)?\("([^"]+)"/g)].map((m) => m[1]));
    expect(used.length).toBeGreaterThan(40);
    for (const name of used) expect(known.has(name), name).toBe(true);
  });

  it("keeps the TypeScript data equal to the engine's", () => {
    const e = engine().fem_constants() as Record<string, unknown>;
    const data: Record<string, unknown> = { ...feModelData, ...elementsData, ...pilesData, ...analysisData, ...limitCommonData };
    for (const [k, v] of Object.entries(e)) expect(v, k).toEqual(data[k]);
  });

  it("passes size fields as engine handles, and refuses a JavaScript function", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(cut));
    const model = buildFeModel(slope, { elementSize: 2 });
    const before = engine().size_field_count();
    const field = refinedSizeField(model, dorflerMark(zzIndicator(model, solveElastic(model).stress), 0.5));
    expect(engine().size_field_count()).toBe(before + 1);
    expect(field.min).toBeGreaterThan(0);
    expect(field(5, 5)).toBeGreaterThanOrEqual(field.min);
    expect(buildFeModel(slope, { sizeField: field }).elementCount).toBeGreaterThan(model.elementCount);
    expect(() => buildFeModel(slope, { sizeField: () => 2 })).toThrow(TypeError);
  });

  it("reads an FeModel's fields from the engine once, as typed arrays", () => {
    const model = buildFeModel(buildSlope(toCanonicalSlopeDefinition(cut)), { elementSize: 2 });
    expect(model.x).toBeInstanceOf(Float64Array);
    expect(model.el).toBeInstanceOf(Int32Array);
    expect(model.elElastic).toBeInstanceOf(Uint8Array);
    expect(model.x).toBe(model.x);
    expect(model.el.length).toBe(6 * model.elementCount);
    expect(model.materials.map((m) => m.name)).toEqual(["Clay"]);
  });

  it("calls onTrial from the engine, and rethrows its exception unchanged", () => {
    const settings = { ...DEFAULT_FEM_SETTINGS, enabled: true, elementSize: 2.5, refinementLevels: 0, limitAnalysis: false };
    const seen: number[] = [];
    const r = runFemSummary(cut, settings, (t) => seen.push(t.F));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toContain(r.factorOfSafety);
    const stop = new RangeError("stop");
    expect(() => runFemSummary(cut, settings, () => { throw stop; })).toThrow(stop);
    const slope = buildSlope(toCanonicalSlopeDefinition(cut));
    const trials: number[] = [];
    const a = analyzeFem(slope, { elementSize: 2.5, fTolerance: 0.05, onTrial: (t) => trials.push(t.F) });
    expect(trials).toEqual(a.trials.map((t) => t.F));
    const model = buildFeModel(slope, { elementSize: 2.5 });
    const srmTrials: number[] = [];
    const r2 = strengthReduction(model, { fTolerance: 0.05, onTrial: (t) => srmTrials.push(t.F) });
    expect(srmTrials).toEqual(r2.trials.map((t) => t.F));
  });

  it("gives the bounds' solver as a token: the engine solves the programs", async () => {
    await expect(boundSolver({ boundSolver: "clarabel" })).resolves.toBeTypeOf("function");
  });

  it("takes the engine slope's handle when the slope has one", () => {
    expect(slopeRef({ _h: 7 } as never)).toEqual({ $slope: 7 });
    expect(() => slopeRef({} as never)).toThrow(/needs a slope of the engine/);
  });
});
