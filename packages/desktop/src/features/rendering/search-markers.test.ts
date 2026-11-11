import { describe, expect, it } from "vitest";
import { exitFaceFootY, layoutLimitMarkers } from "./search-markers";
import type { AnalysisLimitsState } from "../../store/types";

type Pt = [number, number];

// World = drawing with y flipped (1 unit per metre).
const toD = (x: number, y: number): Pt => [x, -y];
// A crest at y = 15, a 10 m vertical face at x = 20, a floor at y = 5.
const wall: Pt[] = [[0, 0], [0, 15], [20, 15], [20, 5], [40, 5], [40, 0]];
const mirrored: Pt[] = wall.map(([x, y]): Pt => [40 - x, y]).reverse();
const limits = (l: Partial<AnalysisLimitsState>): AnalysisLimitsState => ({
  enabled: true,
  entryLeftX: 11,
  entryRightX: 16,
  exitLeftX: 20,
  exitRightX: 20,
  ...l,
});
const exitMarker = (lim: AnalysisLimitsState, coords: Pt[]) =>
  layoutLimitMarkers(lim, coords, toD, 1, { lifted: false }).find((m) => m.exit)!;
const groundOf = (m: { barTop: number; barBottom: number }) => -(m.barTop + m.barBottom) / 2;

describe("the exit marker at a single x on a vertical face", () => {
  it("stands at the foot of a face that descends towards the exit", () => {
    expect(exitFaceFootY(limits({}), wall)).toBe(5);
    expect(groundOf(exitMarker(limits({}), wall))).toBeCloseTo(5, 9);
    // The same model sliding to the left.
    const rtl = limits({ entryLeftX: 24, entryRightX: 29 });
    expect(exitFaceFootY(rtl, mirrored)).toBe(5);
    expect(groundOf(exitMarker(rtl, mirrored))).toBeCloseTo(5, 9);
  });

  it("stays on the ground otherwise", () => {
    // A face that rises towards the exit (entry beyond the face).
    const rising = limits({ entryLeftX: 30, entryRightX: 35 });
    expect(exitFaceFootY(rising, wall)).toBeNull();
    expect(groundOf(exitMarker(rising, wall))).toBeCloseTo(15, 9);
    // An exit range: its ends on the ground as before.
    expect(exitFaceFootY(limits({ exitLeftX: 18, exitRightX: 30 }), wall)).toBeNull();
    // Not on a vertical face, and not the model's own end.
    expect(exitFaceFootY(limits({ exitLeftX: 30, exitRightX: 30 }), wall)).toBeNull();
    expect(exitFaceFootY(limits({ exitLeftX: 40, exitRightX: 40 }), wall)).toBeNull();
  });
});
