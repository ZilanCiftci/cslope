import { describe, expect, it } from "vitest";
import { piezoExtensions } from "./piezo";

describe("piezoExtensions", () => {
  const model: [number, number][] = [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]];
  it("extends a short line horizontally to both model edges", () => {
    expect(piezoExtensions([[12, 6], [18, 4]], model)).toEqual([
      [[0, 6], [12, 6]],
      [[18, 4], [30, 4]],
    ]);
  });
  it("handles lines given right to left and lines spanning the model", () => {
    expect(piezoExtensions([[18, 4], [12, 6]], model)).toHaveLength(2);
    expect(piezoExtensions([[0, 6], [30, 4]], model)).toEqual([]);
  });
});
