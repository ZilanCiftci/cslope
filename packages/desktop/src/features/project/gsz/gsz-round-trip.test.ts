import { describe, expect, it } from "vitest";
import { analyseSlope, buildSlope, DEFAULT_ANALYSIS_OPTIONS, toCanonicalSlopeDefinition, type SlopeDefinition } from "@cslope/engine";
import { modelToGsz, modelToGszXml } from "./gsz-write";
import { gszImports } from "../importGsz";
import { modelFromDefinition } from "../../../store/definition-model";

type Pt = [number, number];

const fos = (def: SlopeDefinition) => {
  const s = buildSlope(toCanonicalSlopeDefinition(def));
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Bishop", slices: 30, iterations: 300, refinedIterations: 150, compositeSurfaces: false });
  return analyseSlope(s) as number;
};

/**
 * A synthetic slope, crest 10 m and toe 5 m high, facing right (ltr) or its
 * mirror image facing left (rtl). The water line is given in the model's
 * own x, so it stands where the caller puts it.
 */
function slope(orientation: "ltr" | "rtl", water: Pt[], freeWater?: boolean): SlopeDefinition {
  const rtl = orientation === "rtl";
  const ground: Pt[] = [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]];
  return {
    orientation,
    coordinates: rtl ? ground.map(([x, y]) => [30 - x, y] as Pt) : ground,
    materials: [
      { name: "Fill", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 2, frictionAngle: 32 } },
      { name: "Clay", model: { kind: "anisotropic-function", unitWeight: 17, cohesion: 6, frictionAngle: 24, modifierFunction: [[-45, 0.8], [0, 1], [60, 1.4]] } },
    ],
    materialBoundaries: [{ coordinates: [[0, 3], [30, 3]], materialName: "" }],
    regionAssignments: [{ point: [rtl ? 25 : 5, 6], materialName: "Fill" }, { point: [15, 1], materialName: "Clay" }],
    waterTable: { mode: "custom", value: water, ...(freeWater !== undefined ? { freeWater } : {}) },
    udls: [],
    lineLoads: [],
    analysisLimits: rtl ? { entryLeftX: 21, entryRightX: 29, exitLeftX: 1, exitRightX: 9 } : { entryLeftX: 1, entryRightX: 9, exitLeftX: 21, exitRightX: 29 },
  };
}

/** The same circle through the toe, mirrored with the slope, so that the search plays no part. */
const onCircle = (d: SlopeDefinition): SlopeDefinition => ({
  ...d,
  customSearchPlanes: [{ cx: d.orientation === "rtl" ? 16 : 14, cy: 17, radius: 13.5 }],
  customPlanesOnly: true,
});

async function roundTrip(d: SlopeDefinition) {
  const m = modelFromDefinition(d, { id: "w", name: "Water", options: { method: "Bishop" } });
  const { notes } = modelToGszXml(m);
  const [imp] = await gszImports(modelToGsz(m).bytes, "Water.gsz");
  return { notes, back: imp.definition };
}

/** Free water in a definition, as the app reads it (D-24: freeWater first, then followBoundary; neither: clipped). */
const isFree = (d: SlopeDefinition) => d.waterTable?.freeWater ?? d.waterTable?.followBoundary === false;

// Issue #149: water above the ground at the toe, in both orientations.
// Above the toe: x 0–10 facing left, x 20–30 facing right (the ground there is at 5).
const aboveToe = { rtl: [[0, 6], [30, 4]] as Pt[], ltr: [[0, 4], [30, 6]] as Pt[] };
const belowToe = { rtl: [[0, 4], [30, 6]] as Pt[], ltr: [[0, 6], [30, 4]] as Pt[] };

describe(".gsz round trip with water above the ground at the toe", () => {
  for (const orientation of ["rtl", "ltr"] as const) {
    it(`keeps the water line, the free water and the factor of safety of a slope facing ${orientation === "rtl" ? "left" : "right"}`, async () => {
      const d = slope(orientation, aboveToe[orientation], true);
      const { notes, back } = await roundTrip(d);
      expect(notes.join(" ")).not.toMatch(/water/i);
      expect(back.orientation ?? "ltr").toBe(orientation);
      expect(back.waterTable?.value).toEqual(aboveToe[orientation]);
      expect(isFree(back)).toBe(true);
      expect(back.analysisLimits).toEqual(d.analysisLimits);
      const f0 = fos(onCircle(d));
      expect(Math.abs(fos(onCircle(back)) - f0)).toBeLessThan(1e-6);
      expect(Math.abs(fos(back) - fos(d))).toBeLessThan(1e-6);
    });
  }

  it("reads a line given from right to left back as the same line, from left to right", async () => {
    const d = slope("rtl", [...aboveToe.rtl].reverse(), true);
    const { back } = await roundTrip(d);
    expect(back.waterTable?.value).toEqual(aboveToe.rtl);
    expect(Math.abs(fos(onCircle(back)) - fos(onCircle(d)))).toBeLessThan(1e-6);
  });

  it("gives the same factor of safety facing left and facing right, before and after the round trip", async () => {
    const left = (await roundTrip(slope("rtl", aboveToe.rtl, true))).back;
    const right = (await roundTrip(slope("ltr", aboveToe.ltr, true))).back;
    expect(Math.abs(fos(onCircle(left)) - fos(onCircle(right)))).toBeLessThan(1e-6);
  });

  it("writes a line clipped to the ground as it is, with a note, and reads it back as free water (the format has no clipped lines)", async () => {
    for (const orientation of ["rtl", "ltr"] as const) {
      // above the toe: the clipped line becomes free water standing on the toe
      const clipped = slope(orientation, aboveToe[orientation]);
      const { notes, back } = await roundTrip(clipped);
      expect(notes.join(" ")).toMatch(/The water lines are clipped to the ground in cSlope; the format carries free water above the ground/);
      expect(back.waterTable?.value).toEqual(aboveToe[orientation]);
      expect(isFree(back)).toBe(true);
      expect(Math.abs(fos(onCircle(back)) - fos(onCircle(slope(orientation, aboveToe[orientation], true))))).toBeLessThan(1e-6);
      expect(fos(onCircle(back))).toBeGreaterThan(fos(onCircle(clipped)) + 1e-3);
      // below the toe: nothing to clip, the same factor of safety
      const below = slope(orientation, belowToe[orientation]);
      const { back: backBelow } = await roundTrip(below);
      expect(Math.abs(fos(onCircle(backBelow)) - fos(onCircle(below)))).toBeLessThan(1e-6);
    }
  });
});
