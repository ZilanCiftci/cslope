import { describe, expect, it } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { runVerification } from "../verification/cases";

// A 4:5 slope, c′ = 15 kPa, φ′ = 30°, with the exit range given as the toe
// point (as the format of another program gives it); that program's
// example gives 1.2535 (Morgenstern-Price, half-sine).
const slope = (limits?: SlopeDefinition["analysisLimits"]): SlopeDefinition => ({
  orientation: "ltr",
  coordinates: [[8.5, 20], [22.5, 20], [30.5, 10], [40, 10], [40, 5], [8.5, 5]],
  materials: [{ name: "S", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 15, frictionAngle: 30 } }],
  ...(limits ? { analysisLimits: limits } : {}),
});
const mp = { intersliceFunction: "half-sine" } as const;

describe("a search range given as a point", () => {
  it("finds the circles exiting at the toe corner", () => {
    const free = runVerification(slope(), "Morgenstern-Price", mp).fos!;
    const { fos, slope: s } = runVerification(
      slope({ entryLeftX: 17, entryRightX: 21.5, exitLeftX: 30.5, exitRightX: 30.5 }),
      "Morgenstern-Price",
      mp,
    );
    // A circle exactly through the corner runs on in the soil beyond it;
    // with the range widened by 1e-5 of the width the circles just beside
    // it exit there (1.331 before, from the few that rounding let through).
    expect(fos!).toBeCloseTo(1.2535, 2);
    expect(Math.abs(fos! / free - 1)).toBeLessThan(0.002);
    // As given; only the search widens it.
    expect(s.limits).toEqual([17, 21.5, 30.5, 30.5]);
    const crit = s.search.find((p) => p.fos != null)!;
    expect(Math.abs(crit.rc[0] - 30.5)).toBeLessThan(1e-3);
  });

  it("reaches the corner from a range that starts at it", () => {
    // Exit range 30.5–35 starting at the toe: the circles exiting just
    // above it are searched too (an end on a corner of the ground is moved
    // out by 1e-5 of the width), and the toe mechanism is found as with
    // the toe alone. The ends not on a corner stay as given.
    const { fos, slope: s } = runVerification(
      slope({ entryLeftX: 17, entryRightX: 21.5, exitLeftX: 30.5, exitRightX: 35 }),
      "Morgenstern-Price",
      mp,
    );
    expect(fos!).toBeCloseTo(1.2535, 2);
    expect(s.limits).toEqual([17, 21.5, 30.5, 35]);
    const w = 1e-5 * 31.5;
    expect(s.searchLimits).toEqual([17, 21.5, 30.5 - w, 35]);
  });
});

// A crest at y = 15, a 10 m vertical face at x = 20 and a floor at y = 5,
// sliding towards the face (or, mirrored about x = 20, the same model
// sliding to the left), c′ = 5 kPa, φ′ = 30°.
const wall = (rtl: boolean, limits: NonNullable<SlopeDefinition["analysisLimits"]>): SlopeDefinition => {
  const m = (x: number) => (rtl ? 40 - x : x);
  const pts: [number, number][] = [[0, 0], [0, 15], [20, 15], [20, 5], [40, 5], [40, 0]];
  const coordinates = pts.map(([x, y]): [number, number] => [m(x), y]);
  return {
    orientation: rtl ? "rtl" : "ltr",
    coordinates: rtl ? coordinates.reverse() : coordinates,
    materials: [{ name: "S", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 } }],
    analysisLimits: rtl
      ? {
          entryLeftX: m(limits.entryRightX),
          entryRightX: m(limits.entryLeftX),
          exitLeftX: m(limits.exitRightX),
          exitRightX: m(limits.exitLeftX),
        }
      : limits,
  };
};
const constant = { intersliceFunction: "constant" } as const;

describe("a single exit x on a vertical face of the ground", () => {
  const limits = { entryLeftX: 11, entryRightX: 16, exitLeftX: 20, exitRightX: 20 };
  const foot: [number, number] = [20, 5 + 1e-5 * 40];

  it("ends every trial circle at the foot of the face", () => {
    for (const rtl of [false, true]) {
      const { fos, slope: s } = runVerification(wall(rtl, limits), "Morgenstern-Price", constant);
      expect(fos).not.toBeNull();
      // canonical space: the face at x = 20 descends towards the exit either way
      expect(s.searchLimits).toEqual([11, 16, 20, 20]);
      expect(s.search.length).toBeGreaterThan(0);
      for (const p of s.search) {
        expect(Math.abs(p.rc[0] - foot[0])).toBeLessThan(1e-9);
        expect(Math.abs(p.rc[1] - foot[1])).toBeLessThan(1e-9);
      }
    }
  });

  it("gives the F of the same surface, ended at the foot, as a polyline", () => {
    const { fos, slope: s } = runVerification(wall(false, limits), "Morgenstern-Price", constant);
    const crit = s.search.filter((p) => p.fos != null).sort((a, b) => a.fos! - b.fos!)[0];
    expect(crit.fos).toBe(fos);
    const a0 = Math.atan2(crit.lc[1] - crit.cy, crit.lc[0] - crit.cx);
    const a1 = Math.atan2(crit.rc[1] - crit.cy, crit.rc[0] - crit.cx);
    const points = Array.from({ length: 401 }, (_, i): [number, number] => {
      const a = a0 + ((a1 - a0) * i) / 400;
      return [crit.cx + crit.radius * Math.cos(a), crit.cy + crit.radius * Math.sin(a)];
    });
    const { fos: poly } = runVerification(
      { ...wall(false, limits), customSurfaces: [{ points, axis: [crit.cx, crit.cy] }], customPlanesOnly: true },
      "Morgenstern-Price",
      constant,
    );
    expect(Math.abs(poly! / fos! - 1)).toBeLessThan(1e-4);
  });

  it("leaves a face that rises towards the exit and an exit range as they were", () => {
    const w = 1e-5 * 40;
    const rising: SlopeDefinition = {
      ...wall(false, { entryLeftX: 11, entryRightX: 16, exitLeftX: 30, exitRightX: 30 }),
      coordinates: [[0, 0], [0, 15], [20, 15], [20, 5], [30, 5], [30, 8], [40, 8], [40, 0]],
    };
    const r = runVerification(rising, "Morgenstern-Price", constant);
    expect(r.slope.searchLimits).toEqual([11, 16, 30 - w, 30]);
    // (the factors of safety before the rule, as in the Rust tests)
    expect(r.fos!).toBeCloseTo(1.150043595810847, 9);
    const range = runVerification(
      wall(false, { entryLeftX: 11, entryRightX: 16, exitLeftX: 18, exitRightX: 30 }),
      "Morgenstern-Price",
      constant,
    );
    expect(range.slope.searchLimits).toEqual([11, 16, 18, 30]);
    expect(range.fos!).toBeCloseTo(0.392698221225512, 9);
  });
});
