import { describe, it, expect } from "vitest";
import { swedishPartialFactors, SAFETY_CLASS_GAMMA_D } from "./analysis";

describe("swedishPartialFactors", () => {
  it("divides γM by η and multiplies γQ by γd", () => {
    // as Structor-type calculations: SK2, η = 1.10 on Su, γQ = 1.4·γd
    const f = swedishPartialFactors({ safetyClass: 2, etaCu: 1.1, etaDrained: 1, variableLoadBase: 1.4 });
    expect(f.cu).toBe(1.364); // 1.5 / 1.1, three decimals
    expect(f.cohesion).toBe(1.3);
    expect(f.tanPhi).toBe(1.3);
    expect(f.variableLoad).toBe(1.274);
    expect(f.basis).toEqual({ safetyClass: 2, etaCu: 1.1, etaDrained: 1, variableLoadBase: 1.4 });
  });

  it("gives the set 1.5 / 1.3 / 1.3 / 1.3 in safety class 3 with η = 1", () => {
    const f = swedishPartialFactors({ safetyClass: 3, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 });
    expect([f.cu, f.cohesion, f.tanPhi, f.variableLoad]).toEqual([1.5, 1.3, 1.3, 1.3]);
    expect(SAFETY_CLASS_GAMMA_D).toEqual({ 1: 0.83, 2: 0.91, 3: 1 });
  });

  it("rejects a bad safety class or η", () => {
    expect(() => swedishPartialFactors({ safetyClass: 4 as 1, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 })).toThrow(/Safety class/);
    expect(() => swedishPartialFactors({ safetyClass: 1, etaCu: 0, etaDrained: 1, variableLoadBase: 1.3 })).toThrow(/etaCu/);
    // a class read from text is not a class
    expect(() => swedishPartialFactors({ safetyClass: "2" as unknown as 2, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 })).toThrow(/Safety class/);
  });
});
