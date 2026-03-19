import { describe, expect, it } from "vitest";
import type { MaterialModel } from "@cslope/engine";
import {
  ExpressionError,
  evaluate,
  resolveCoordinates,
  resolveMaterialModel,
  resolveParameters,
} from "./expression";

describe("evaluate", () => {
  it("handles literals and arithmetic precedence", () => {
    expect(evaluate("2 + 3 * 4", {})).toBe(14);
    expect(evaluate("(2 + 3) * 4", {})).toBe(20);
    expect(evaluate("10 / 2 + 1", {})).toBe(6);
  });

  it("handles unary operators and whitespace", () => {
    expect(evaluate("-5 + 8", {})).toBe(3);
    expect(evaluate("  - ( 2 + 1 ) * 3 ", {})).toBe(-9);
  });

  it("resolves variables", () => {
    expect(evaluate("depth + 0.15", { depth: 2.1 })).toBe(2.25);
    expect(evaluate("C * 2", { C: 17 })).toBe(34);
  });

  it("throws for unknown variable", () => {
    expect(() => evaluate("depth + x", { depth: 2 })).toThrow(
      /Unknown variable: x\./,
    );
  });

  it("throws for invalid tokens/syntax", () => {
    expect(() => evaluate("2 + @", {})).toThrow(/Unexpected character '@'/);
    expect(() => evaluate("2 +", {})).toThrow(/Expected number, variable/);
    expect(() => evaluate("(2 + 3", {})).toThrow(/Expected '\)'/);
  });

  it("throws division by zero", () => {
    expect(() => evaluate("1 / 0", {})).toThrow(/Division by zero/);
  });

  it("throws typed ExpressionError", () => {
    try {
      evaluate("1 / 0", {});
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      const exprError = error as ExpressionError;
      expect(exprError.code).toBe("DIVISION_BY_ZERO");
    }
  });
});

describe("resolveParameters", () => {
  it("resolves literals and dependency chains", () => {
    const result = resolveParameters([
      { name: "depth", expression: "2.1" },
      { name: "berm", expression: "depth + 0.5" },
      { name: "toe", expression: "berm + 1.4" },
    ]);

    expect(result.errors).toEqual({});
    expect(result.resolved.depth).toBe(2.1);
    expect(result.resolved.berm).toBe(2.6);
    expect(result.resolved.toe).toBe(4);
  });

  it("reports duplicate names and invalid identifiers", () => {
    const result = resolveParameters([
      { name: "C", expression: "17" },
      { name: "C", expression: "20" },
      { name: "1bad", expression: "10" },
    ]);

    expect(result.errors.C).toMatch(/Duplicate parameter name/);
    expect(Object.keys(result.resolved)).toHaveLength(0);
  });

  it("reports unknown references", () => {
    const result = resolveParameters([
      { name: "depth", expression: "base + 2" },
    ]);

    expect(result.errors.depth).toMatch(/Unknown variable: base/);
    expect(result.resolved.depth).toBeUndefined();
  });

  it("reports circular references", () => {
    const result = resolveParameters([
      { name: "a", expression: "b + 1" },
      { name: "b", expression: "a + 1" },
    ]);

    expect(result.errors.a).toBeTruthy();
    expect(result.errors.b).toBeTruthy();
    expect(result.resolved.a).toBeUndefined();
    expect(result.resolved.b).toBeUndefined();
  });
});

describe("resolveCoordinates", () => {
  it("resolves expression-backed axes", () => {
    const next = resolveCoordinates(
      [
        [0, 0],
        [10, 1],
      ],
      [{ y: "depth" }, { x: "load_distance + 2", y: "depth + 0.15" }],
      { depth: 2.1, load_distance: 3 },
    );

    expect(next).toEqual([
      [0, 2.1],
      [5, 2.25],
    ]);
  });

  it("keeps last values when expression fails", () => {
    const next = resolveCoordinates([[1, 2]], [{ x: "bad_ref", y: "" }], {});

    expect(next).toEqual([[1, 2]]);
  });
});

describe("resolveMaterialModel", () => {
  it("resolves scalar numeric material fields", () => {
    const model: MaterialModel = {
      kind: "mohr-coulomb",
      unitWeight: 20,
      cohesion: 5,
      frictionAngle: 30,
    };

    const next = resolveMaterialModel(
      model,
      {
        cohesion: "C",
        frictionAngle: "phi + 2",
      },
      { C: 17, phi: 30 },
    );

    expect(next.kind).toBe("mohr-coulomb");
    if (next.kind !== "mohr-coulomb") {
      throw new Error("Expected mohr-coulomb model.");
    }
    expect(next.cohesion).toBe(17);
    expect(next.frictionAngle).toBe(32);
    expect(next.unitWeight).toBe(20);
  });

  it("ignores non-numeric fields and preserves old value on error", () => {
    const model: MaterialModel = {
      kind: "undrained",
      unitWeight: 19,
      undrainedShearStrength: 25,
      suRateOfChange: 0.5,
    };

    const next = resolveMaterialModel(
      model,
      {
        kind: "whatever",
        undrainedShearStrength: "Su",
        suRateOfChange: "not_defined",
      },
      { Su: 31 },
    );

    expect(next.kind).toBe("undrained");
    if (next.kind !== "undrained") {
      throw new Error("Expected undrained model.");
    }
    expect(next.undrainedShearStrength).toBe(31);
    expect(next.suRateOfChange).toBe(0.5);
  });
});
