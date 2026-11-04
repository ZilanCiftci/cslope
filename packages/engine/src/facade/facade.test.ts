/**
 * Tests of the facade itself: the engine is started (the testing build,
 * vitest.setup.ts), the modules call only internal functions the testing
 * build has, keep the data the engine has, map errors and handles, and
 * survive a trap.
 */
import { describe, expect, it, vi } from "vitest";
import { engine, engineEpoch, engineModule, isEngineReady } from "../engine";
import * as constants from "../types/constants";
import { DEFAULT_ANALYSIS_OPTIONS, DEFAULT_FEM_SETTINGS, EC7_DA3_FACTORS, SAFETY_CLASS_GAMMA_D } from "../types/analysis";
import { MATERIAL_MODEL_LABELS } from "../types/material-models";
import { MATERIAL_COLORS, extrapolateLambda } from "../math/helpers";
import { getYAtXStrict } from "../math/interpolation";
import { Material } from "../types/material";
import { waternetPorePressure, type Waternet } from "../model/waternet";
import { testCall, testingEngine } from "./internal";

// Vite's import.meta.glob (the engine package has no Vite types)
declare global {
  interface ImportMeta {
    glob(patterns: string[], options?: { query?: string; import?: string; eager?: boolean }): Record<string, unknown>;
  }
}

const sources = import.meta.glob(["../math/*.ts", "../types/*.ts", "../model/*.ts", "../api/*.ts", "../fem/*.ts", "!../**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("facade", () => {
  it("is started, from the testing build", () => {
    expect(isEngineReady()).toBe(true);
    expect(engine().engine_build()).toMatch(/\(testing\)$/);
    expect(Object.prototype.toString.call(engineModule())).toBe("[object WebAssembly.Module]");
  });

  it("calls only internal functions the testing build has", () => {
    const known = new Set(testingEngine().__test_functions());
    const used = Object.values(sources).flatMap((s) => [...s.matchAll(/testCall(?:<[^>]*>)?\("([^"]+)"/g)].map((m) => m[1]));
    expect(used.length).toBeGreaterThan(10);
    for (const name of used) expect(known.has(name), name).toBe(true);
    expect(() => testCall("math/none::none", [])).toThrow(/no internal function "math\/none::none"/);
  });

  it("keeps the TypeScript data equal to the engine's", () => {
    const e = engine().engine_constants() as Record<string, unknown>;
    for (const [k, v] of Object.entries(constants)) expect(e[k], k).toEqual(v);
    expect(e.EC7_DA3_FACTORS).toEqual(EC7_DA3_FACTORS);
    expect(Object.fromEntries(e.SAFETY_CLASS_GAMMA_D as [number, number][])).toEqual(SAFETY_CLASS_GAMMA_D);
    expect(e.MATERIAL_COLORS).toEqual(MATERIAL_COLORS);
    expect(Object.fromEntries(engine().material_model_labels() as [string, string][])).toEqual(MATERIAL_MODEL_LABELS);
    expect(engine().default_analysis_options()).toEqual(DEFAULT_ANALYSIS_OPTIONS);
    expect(engine().default_fem_settings()).toEqual(DEFAULT_FEM_SETTINGS);
  });

  it("throws RangeError and Error as TypeScript does, with the same messages", () => {
    expect(() => getYAtXStrict([[0, 1], [0, 1]], 5)).toThrow(RangeError);
    expect(() => getYAtXStrict([[0, 1], [0, 1]], 5)).toThrow("x (5) is outside the limits of the line (0 to 1).");
    expect(() => new Material({ frictionAngle: 91 })).toThrow(new RangeError("friction_angle must be between 0 and 90"));
    try {
      extrapolateLambda([]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(RangeError);
      expect((e as Error).message).toBe("lffArray must contain at least two points for extrapolation.");
    }
  });

  it("passes NaN and the infinities unchanged", () => {
    const m = new Material({ model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30, unitWeightSat: Infinity } });
    expect(m.model.unitWeightSat).toBe(Infinity);
    expect(engine().mirror_x(NaN, 0, 1)).toBeNaN();
    expect(engine().validate_material_model({ ...m.model, cohesion: -Infinity }).join()).toMatch(/ohesion/);
  });

  it("reads a field that is undefined as absent and null as null, as TypeScript", () => {
    const mc = { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 };
    const validate = (m: unknown) => engine().validate_material_model(m) as string[];
    expect(validate({ ...mc, unitWeightSat: undefined, aboveWater: undefined })).toEqual([]);
    expect(validate({ ...mc, unitWeightSat: null })).toEqual(["Saturated unit weight (γsat) must be a positive number up to 500 kN/m³."]);
    expect(validate([{ ...mc, cohesionRateOfChange: undefined }][0])).toEqual([]);
    // TypeScript's TypeError on a nested null
    expect(() => validate({ ...mc, aboveWater: null })).toThrow(new TypeError("Cannot read properties of null (reading 'aboveWater')"));
    // the caller's object is not changed
    const given = { ...mc, ru: undefined };
    validate(given);
    expect("ru" in given).toBe(true);
  });

  it("keeps one engine copy per waternet object, as TypeScript's cache", () => {
    const wn: Waternet = { headLines: [{ id: "h", points: [[0, 5], [10, 5]] }], referenceLines: [{ points: [[0, 0], [10, 0]], topHeadLineId: "h", bottomHeadLineId: "h" }], phreaticLineId: "h" };
    const before = engine().waternet_count();
    const u = waternetPorePressure(wn, 5, 2);
    expect(u).toBeGreaterThan(0);
    expect(waternetPorePressure(wn, 5, 2)).toBe(u);
    expect(engine().waternet_count()).toBe(before + 1);
    expect(() => engine().waternet_pore_pressure_at(0, 0, 0)).toThrow(/freed, or the engine was restarted/);
  });

  it("restarts after a trap, refusing nothing but the old handles", () => {
    const wn: Waternet = { headLines: [{ id: "h", points: [[0, 5], [10, 5]] }], referenceLines: [], phreaticLineId: "h" };
    const u = waternetPorePressure(wn, 5, 2);
    const epoch = engineEpoch();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => testingEngine().engine_panic_for_test()).toThrow(WebAssembly.RuntimeError);
      expect(quiet.mock.calls.flat().join()).toMatch(/cSlope engine panicked: panicked at crates\/cslope-wasm\/src\/panic.rs:\d+:\d+:\nengine_panic_for_test/);
      // the next call starts a new instance
      expect(engine().mirror_x(1, 0, 10)).toBe(9);
      expect(engineEpoch()).toBe(epoch + 1);
      expect(quiet.mock.calls.flat().join()).toMatch(/stopped after an internal error/);
    } finally {
      quiet.mockRestore();
    }
    // a waternet made before is copied to the new instance again
    expect(engine().waternet_count()).toBe(0);
    expect(waternetPorePressure(wn, 5, 2)).toBe(u);
    expect(engine().waternet_count()).toBe(1);
  });
});
