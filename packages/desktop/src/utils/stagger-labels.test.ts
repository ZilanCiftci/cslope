import { describe, expect, it } from "vitest";
import { staggerLabelTops } from "./stagger-labels";

describe("staggerLabelTops", () => {
  it("moves overlapping labels below one another, in their order", () => {
    const box = (top: number, right = 100) => ({ right, top, width: 40, height: 10 });
    expect(staggerLabelTops([box(52), box(50), box(55)], 1)).toEqual([61, 50, 72]);
  });

  it("leaves labels apart, or side by side, where they are", () => {
    expect(
      staggerLabelTops([
        { right: 100, top: 0, width: 40, height: 10 },
        { right: 100, top: 30, width: 40, height: 10 },
        { right: 50, top: 2, width: 40, height: 10 },
      ]),
    ).toEqual([0, 30, 2]);
  });
});
