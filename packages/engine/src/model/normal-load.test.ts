/**
 * Distributed loads acting normal to the ground (`direction: "normal"`):
 * the vertical part is that of a vertical load, the horizontal part
 * p·dy pushes into the ground.
 */

import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import { sgi3dFactorOfSafety } from "./sgi3d";
import { DEFAULT_ANALYSIS_OPTIONS } from "../types/analysis";
import { WATER_UNIT_WEIGHT } from "../types/constants";

type Pt = [number, number];
// undrained clay, a 1:2 slope from y = 10 (x ≤ 10) down to y = 5 (x ≥ 20)
const ground: Pt[] = [[0, 10], [10, 10], [20, 5], [30, 5]];
const base = (extra: Partial<SlopeDefinition> = {}): SlopeDefinition =>
  ({
    orientation: "ltr",
    coordinates: [[0, 0], ...ground, [30, 0]],
    materials: [{ name: "clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 20 } }],
    regionAssignments: [{ point: [15, 2], materialName: "clay" }],
    customSearchPlanes: [{ cx: 14, cy: 16, radius: 12 }],
    customPlanesOnly: true,
    ...extra,
  }) as SlopeDefinition;
const groundAt = (x: number) => (x <= 10 ? 10 : x >= 20 ? 5 : 10 - (x - 10) / 2);
const fos = (def: SlopeDefinition, method: "Bishop" | "Morgenstern-Price" = "Morgenstern-Price") => {
  const s = buildSlope(toCanonicalSlopeDefinition(def));
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method, slices: 60 });
  return analyseSlope(s) as number;
};

/** Water to level h as distributed loads γw·(h − ground) in strips of width dx. */
const pond = (h: number, from: number, to: number, dx: number, direction: "vertical" | "normal") => {
  const out: { magnitude: number; x1: number; x2: number; direction: "vertical" | "normal" }[] = [];
  for (let x = from; x < to - 1e-9; x += dx) {
    const d = h - groundAt(x + dx / 2);
    if (d > 0) out.push({ magnitude: WATER_UNIT_WEIGHT * d, x1: x, x2: Math.min(to, x + dx), direction });
  }
  return out;
};

describe("distributed load normal to the ground", () => {
  it("is a vertical load on level ground", () => {
    const udl = { magnitude: 30, x1: 2, x2: 8 };
    expect(fos(base({ udls: [{ ...udl, direction: "normal" }] }))).toBeCloseTo(fos(base({ udls: [udl] })), 10);
  });

  it("carries the thrust of water against the slope: as free water on undrained clay", () => {
    // water to y = 8 over the lower slope and the toe
    const free = fos(base({ waterTable: { mode: "custom", value: [[0, 8], [30, 8]], followBoundary: false } }));
    const normal = fos(base({ udls: pond(8, 14, 30, 0.05, "normal") }));
    const vertical = fos(base({ udls: pond(8, 14, 30, 0.05, "vertical") }));
    // within 0.1 % (the strips, and the vertical part at the slice centre)
    expect(Math.abs(normal / free - 1)).toBeLessThan(1e-3);
    // the thrust into the slope resists: without it the factor is lower
    expect(vertical).toBeLessThan(normal - 0.01);
    // the same with Bishop
    const nb = fos(base({ udls: pond(8, 14, 30, 0.05, "normal") }), "Bishop");
    const fb = fos(base({ waterTable: { mode: "custom", value: [[0, 8], [30, 8]], followBoundary: false } }), "Bishop");
    expect(Math.abs(nb / fb - 1)).toBeLessThan(1e-3);
  });

  it("acts into the ground on a slope facing the other way (right to left)", () => {
    const m = ([x, y]: Pt): Pt => [30 - x, y];
    const d = base({ udls: pond(8, 14, 30, 0.05, "normal") });
    const rtl = {
      ...d,
      orientation: "rtl",
      coordinates: d.coordinates.map(m),
      regionAssignments: d.regionAssignments!.map((r) => ({ ...r, point: m(r.point) })),
      customSearchPlanes: [{ cx: 16, cy: 16, radius: 12 }],
      udls: d.udls!.map((u) => ({ ...u, x1: 30 - u.x2, x2: 30 - u.x1 })),
    } as SlopeDefinition;
    expect(fos(rtl)).toBeCloseTo(fos(d), 8);
  });

  it("enters the SGI 3D driving moment", () => {
    const run = (def: SlopeDefinition) => {
      const s = buildSlope(toCanonicalSlopeDefinition(def));
      s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", slices: 30 });
      analyseSlope(s);
      return sgi3dFactorOfSafety(s, { length: 10 })!;
    };
    const flat = { magnitude: 30, x1: 2, x2: 8 };
    expect(run(base({ udls: [{ ...flat, direction: "normal" }] })).factorOfSafety).toBeCloseTo(run(base({ udls: [flat] })).factorOfSafety, 8);
    const n = run(base({ udls: pond(8, 14, 30, 0.1, "normal") }));
    const v = run(base({ udls: pond(8, 14, 30, 0.1, "vertical") }));
    // the thrust into the slope lowers the driving moment: a higher F3D
    expect(n.factorOfSafety).toBeGreaterThan(v.factorOfSafety + 0.005);
  });
});
