import { describe, expect, it } from "vitest";
import {
  evaluate,
  resolveCoordinates,
  resolveMaterialModel,
  resolveParameters,
} from "./expression";
import type { MaterialModel } from "@cslope/engine";

const p = (name: string, expression: string, id = name) => ({ id, name, expression });

describe("evaluate: errors", () => {
  it.each([
    ["", "Expression is empty."],
    ["   ", "Expression is empty."],
    [".", "Invalid number literal '.'."],
    ["1e999", "Invalid number literal '1e999'."],
    ["1e308*10", "Result is not a finite number."],
    ["4/(2-2)", "Division by zero."],
    ["2 $ 3", "Unexpected character '$'."],
    ["(1+2", "Expected ')' after expression."],
    ["1 2", "Unexpected token at end of expression."],
    ["*3", "Expected number, variable, or '(' ."],
    ["toString", "Unknown variable: toString."],
  ])("%j → %s", (source, message) => {
    expect(() => evaluate(source, {})).toThrow(message);
  });

  it("an exponent without digits is not part of the number", () => {
    // "2e" is the number 2 followed by the variable e.
    expect(() => evaluate("2e", {})).toThrow("Unexpected token at end of expression.");
    expect(evaluate("2*e", { e: 3 })).toBe(6);
    expect(evaluate("2e+1", {})).toBe(20);
    expect(evaluate(".5+1.", {})).toBe(1.5);
  });

  it("honours precedence, unary signs and whitespace", () => {
    expect(evaluate(" 2 +\t3 * 4\n", {})).toBe(14);
    expect(evaluate("(2+3)*4", {})).toBe(20);
    expect(evaluate("--2", {})).toBe(2);
    expect(evaluate("-(H/2)", { H: 10 })).toBe(-5);
    expect(evaluate("10/4/5", {})).toBe(0.5);
  });
});

describe("resolveParameters", () => {
  it("resolves chains in any order", () => {
    const { resolved, errors } = resolveParameters([
      p("C", "B*2"),
      p("B", "A+1"),
      p("A", "1"),
    ]);
    expect(errors).toEqual({});
    expect(resolved).toEqual({ A: 1, B: 2, C: 4 });
  });

  it("trims names and ignores blank ones", () => {
    const { resolved, errors } = resolveParameters([p("  H ", "5"), p("  ", "3")]);
    expect(resolved).toEqual({ H: 5 });
    expect(errors).toEqual({});
  });

  it("reports cycles and parameters depending on them", () => {
    const { resolved, errors } = resolveParameters([
      p("A", "B+1"),
      p("B", "A+1"),
      p("S", "S"),
      p("D", "A*2"),
    ]);
    expect(resolved).toEqual({});
    expect(errors).toEqual({
      A: "Circular reference detected.",
      B: "Depends on invalid parameter: A.",
      S: "Circular reference detected.",
      D: "Depends on invalid parameter: A.",
    });
  });

  it("reports unknown variables, tokenizer errors and evaluation errors", () => {
    const { resolved, errors } = resolveParameters([
      p("U", "missing*2"),
      p("T", "2 # 3"),
      p("Z", "1/0"),
      p("OK", "3"),
      p("Dep", "Z+OK"),
    ]);
    expect(errors).toEqual({
      U: "Unknown variable: missing.",
      T: "Unexpected character '#'.",
      Z: "Division by zero.",
      Dep: "Depends on invalid parameter: Z.",
    });
    expect(resolved).toEqual({ OK: 3 });
  });

  it("a parameter using a duplicated name is invalid too", () => {
    const { errors } = resolveParameters([
      p("D", "1", "1"),
      p("D", "2", "2"),
      p("E", "D+1"),
    ]);
    expect(errors.D).toBe("Duplicate parameter name.");
    expect(errors.E).toBe("Unknown variable: D.");
  });
});

describe("resolveCoordinates", () => {
  it("evaluates x and y separately and keeps the old value on failure", () => {
    const out = resolveCoordinates(
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      [{ x: "H", y: "bad" }, { y: " " }],
      { H: 10 },
    );
    expect(out).toEqual([
      [10, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("keeps the old x when only x fails", () => {
    expect(resolveCoordinates([[1, 2]], [{ x: "1/0", y: "7" }], {})).toEqual([[1, 7]]);
  });
});

describe("resolveMaterialModel", () => {
  const model = {
    kind: "mohr-coulomb",
    unitWeight: 18,
    cohesion: 5,
    frictionAngle: 30,
  } as MaterialModel;

  it("returns the model itself without expressions", () => {
    expect(resolveMaterialModel(model, undefined, {})).toBe(model);
  });

  it("evaluates numeric fields only and keeps values on failure", () => {
    const out = resolveMaterialModel(
      model,
      {
        cohesion: "c*2",
        frictionAngle: "nope",
        unitWeight: "  ",
        kind: "1",
        cuTop: "5",
        rate: undefined,
      },
      { c: 4 },
    ) as unknown as Record<string, unknown>;
    expect(out).toEqual({
      kind: "mohr-coulomb",
      unitWeight: 18,
      cohesion: 8,
      frictionAngle: 30,
    });
    expect(out).not.toHaveProperty("cuTop");
  });
});
