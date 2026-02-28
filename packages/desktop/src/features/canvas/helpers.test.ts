import { describe, expect, it } from "vitest";
import { PAPER_FRAME_MARGIN_PX } from "../../constants";
import { computePaperFrame } from "./helpers";

describe("computePaperFrame", () => {
  it("fits A4 frame into available canvas area while preserving aspect", () => {
    const frame = computePaperFrame(1000, 600, "A4");

    const availW = 1000 - PAPER_FRAME_MARGIN_PX * 2;
    const availH = 600 - PAPER_FRAME_MARGIN_PX * 2;
    const a4Aspect = 297 / 210;

    expect(frame.w).toBeLessThanOrEqual(availW + 1e-9);
    expect(frame.h).toBeLessThanOrEqual(availH + 1e-9);
    expect(frame.w / frame.h).toBeCloseTo(a4Aspect, 8);

    expect(frame.x).toBeCloseTo((1000 - frame.w) / 2, 8);
    expect(frame.y).toBeCloseTo((600 - frame.h) / 2, 8);
  });

  it("uses width-fit branch when canvas is relatively tall", () => {
    const frame = computePaperFrame(600, 1000, "A3");

    const availW = 600 - PAPER_FRAME_MARGIN_PX * 2;
    expect(frame.w).toBeCloseTo(availW, 8);
    expect(frame.x).toBeCloseTo(PAPER_FRAME_MARGIN_PX, 8);
    expect(frame.h).toBeGreaterThan(0);
  });
});
