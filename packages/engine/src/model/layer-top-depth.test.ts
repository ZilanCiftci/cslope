/**
 * S = f(depth) with the depth measured from the top of the material layer
 * (as commercial programs offer it) and the strength cutoff.
 */

import { describe, it, expect } from "vitest";
import type { MaterialModel } from "../types/material-models";
import type { SlopeDefinition } from "../types/slope-definition";
import type { Pile } from "../types/reinforcement";
import { layered, mc, runVerification } from "../verification/cases";
import { buildSlope } from "./build-slope";
import { pileForce } from "./reinforcement";

type Pt = [number, number];

// A fill (φ 32°) on soft clay whose top is at y = 0: 1 m of fill at the
// toe, 7 m at the crest (6 m embankment). Su = 10 + 1.5·z below the clay top.
const ground: Pt[] = [[0, 1], [20, 1], [32, 7], [60, 7]];
const FILL = mc(0, 32, 19);

const sfDepth = (extra: Partial<MaterialModel> = {}): MaterialModel =>
  ({ kind: "s-f-depth", unitWeight: 16, suRef: 10, depthRef: 0, rate: 1.5, ...extra }) as MaterialModel;
const sfDatum = (extra: Partial<MaterialModel> = {}): MaterialModel =>
  ({ kind: "s-f-datum", unitWeight: 16, suRef: 10, yRef: 0, rate: 1.5, ...extra }) as MaterialModel;

const embankment = (clay: MaterialModel, extra: Partial<SlopeDefinition> = {}) =>
  layered(ground, -15, [
    { name: "Fill", topY: null, model: FILL },
    { name: "Clay", topY: 0, model: clay },
  ], extra);

// The tolerance the pinned value below was computed with.
const SEARCH = { slices: 30, iterations: 400, refinedIterations: 200, tolerance: 0.005 };
const fos = (def: SlopeDefinition) => runVerification(def, "Bishop", SEARCH).fos!;

/** Mirror a definition about x = 30 (a right-to-left model). */
function mirrored(def: SlopeDefinition): SlopeDefinition {
  const m = ([x, y]: Pt): Pt => [60 - x, y];
  return {
    ...def,
    coordinates: def.coordinates.map(m),
    materialBoundaries: def.materialBoundaries?.map((b) => ({ ...b, coordinates: b.coordinates.map(m) })),
    regionAssignments: def.regionAssignments?.map((r) => ({ ...r, point: m(r.point) })),
  };
}

describe("S = f(depth) from the top of the layer", () => {
  const layerTop = fos(embankment(sfDepth({ depthReference: "layer-top" })));
  const datum = fos(embankment(sfDatum()));
  const fromGround = fos(embankment(sfDepth()));

  it("equals S = f(datum) with the datum at the top of the clay", () => {
    expect(Number.isFinite(layerTop)).toBe(true);
    expect(layerTop).toBeCloseTo(datum, 6);
  });

  it("is lower than measuring from the ground under the fill", () => {
    // From the ground, the 1–7 m of fill count as depth in the clay.
    expect(fromGround).toBeGreaterThan(layerTop * 1.1);
  });

  it("leaves the ground reference unchanged (and the default)", () => {
    expect(fos(embankment(sfDepth({ depthReference: "ground" })))).toBe(fromGround);
    // Value before the layer-top option was added (1.0887393585 with the
    // relaxed fixed-point inner loop; the secant inner loop converges to
    // a slightly different point within the 0.005 tolerance).
    expect(fromGround).toBeCloseTo(1.0890157398, 8);
  });

  it("works on a right-to-left model", () => {
    const rtl = fos(mirrored(embankment(sfDepth({ depthReference: "layer-top" }))));
    expect(rtl).toBeCloseTo(layerTop, 6);
  });

  it("the cutoff limits Su like S = f(datum) with the same cutoff", () => {
    const capped = fos(embankment(sfDepth({ depthReference: "layer-top", suMax: 14 })));
    expect(capped).toBeCloseTo(fos(embankment(sfDatum({ suMax: 14 }))), 6);
    expect(capped).toBeLessThan(layerTop);
    // A cutoff above any strength reached changes nothing.
    expect(fos(embankment(sfDepth({ depthReference: "layer-top", suMax: 1000 })))).toBe(layerTop);
  });
});

describe("Layer-top depth outside the slices", () => {
  it("pile pressure in the clay uses the depth below the clay top", () => {
    // Pile through the 7 m of fill at the crest into the clay.
    const pile: Pile = { x1: 45, y1: 7, x2: 45, y2: -12, diameter: 0.6, spacing: 2 };
    const force = (clay: MaterialModel) =>
      pileForce(buildSlope(embankment(clay)), pile, 45, -6).perPile;
    const layerTop = force(sfDepth({ depthReference: "layer-top" }));
    expect(layerTop).toBeCloseTo(force(sfDatum()), 9);
    expect(force(sfDepth())).toBeGreaterThan(layerTop);
  });
});
