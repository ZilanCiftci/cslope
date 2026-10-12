import { describe, expect, it } from "vitest";
import { findExpressionErrors } from "./expression-check";
import type { ModelEntry } from "./types";

/** A model with only the fields findExpressionErrors reads. */
function model(overrides: Record<string, unknown> = {}): ModelEntry {
  return {
    parameters: [],
    coordinateExpressions: [],
    materialBoundaries: [],
    piezometricLine: { lines: [] },
    materials: [],
    udls: [],
    lineLoads: [],
    ...overrides,
  } as unknown as ModelEntry;
}

describe("findExpressionErrors", () => {
  it("reports nothing for a model without expressions", () => {
    expect(findExpressionErrors(model())).toEqual([]);
    expect(
      findExpressionErrors(
        model({ parameters: undefined, coordinateExpressions: undefined }),
      ),
    ).toEqual([]);
  });

  it("accepts expressions that use defined parameters and ignores blank ones", () => {
    const m = model({
      parameters: [
        { id: "1", name: "H", expression: "10" },
        { id: "2", name: "W", expression: "H*2" },
      ],
      coordinateExpressions: [{ x: "W", y: "H" }, { x: "  ", y: "" }, {}],
      udls: [
        { id: "u", magnitude: 1, x1: 0, x2: 1, expressions: { magnitude: "H/2" } },
      ],
    });
    expect(findExpressionErrors(m)).toEqual([]);
  });

  it("reports invalid, duplicate and empty parameters", () => {
    const errors = findExpressionErrors(
      model({
        parameters: [
          { id: "1", name: "1bad", expression: "1" },
          { id: "2", name: "D", expression: "1" },
          { id: "3", name: "D", expression: "2" },
          { id: "4", name: "E", expression: " " },
        ],
      }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'parameter "1bad": Parameter name is invalid.',
        'parameter "D": Duplicate parameter name.',
        'parameter "E": Expression is empty.',
      ]),
    );
    expect(errors).toHaveLength(3);
  });

  it("an expression using a broken parameter is reported as well", () => {
    const errors = findExpressionErrors(
      model({
        parameters: [{ id: "1", name: "E", expression: "" }],
        lineLoads: [{ id: "l", magnitude: 1, x: 0, expressions: { x: "E+1" } }],
      }),
    );
    expect(errors[0]).toBe('parameter "E": Expression is empty.');
    expect(errors[1]).toMatch(/^Line load 1 x "E\+1": /);
  });

  it("labels failing expressions in every part of the model", () => {
    const m = model({
      parameters: [{ id: "1", name: "H", expression: "10" }],
      coordinateExpressions: [{ x: "H" }, { y: "gone" }],
      materialBoundaries: [
        { id: "b1", coordinates: [], coordinateExpressions: [{ x: "nope" }] },
        { id: "b2", coordinates: [] },
      ],
      piezometricLine: {
        lines: [
          {
            id: "p",
            name: "Water",
            coordinates: [],
            coordinateExpressions: [{}, { y: "W+" }],
          },
          { id: "q", name: "Dry", coordinates: [] },
        ],
      },
      materials: [
        {
          id: "m",
          name: "Clay",
          color: "#000",
          model: {},
          modelExpressions: { cohesion: "c0", phi: "30" },
        },
        { id: "n", name: "Sand", color: "#111", model: {} },
      ],
      udls: [
        { id: "u", magnitude: 1, x1: 0, x2: 1, expressions: { x2: "L" } },
        { id: "v", magnitude: 1, x1: 0, x2: 1 },
      ],
      lineLoads: [
        { id: "l", magnitude: 1, x: 0, expressions: { magnitude: "P*2" } },
        { id: "k", magnitude: 1, x: 0 },
      ],
    });
    const errors = findExpressionErrors(m);
    expect(errors).toHaveLength(6);
    expect(errors[0]).toMatch(/^Exterior boundary point 2 y "gone": \S/);
    expect(errors[1]).toMatch(/^Boundary 1 point 1 x "nope": \S/);
    expect(errors[2]).toMatch(/^Piezometric line "Water" point 2 y "W\+": \S/);
    expect(errors[3]).toMatch(/^Material "Clay" cohesion "c0": \S/);
    expect(errors[4]).toMatch(/^UDL 1 x2 "L": \S/);
    expect(errors[5]).toMatch(/^Line load 1 magnitude "P\*2": \S/);
  });

  it("tolerates holes in coordinate expression arrays", () => {
    const m = model({ coordinateExpressions: [undefined, { x: "Z" }] });
    expect(findExpressionErrors(m)).toEqual([
      expect.stringMatching(/^Exterior boundary point 2 x "Z": /),
    ]);
  });
});
