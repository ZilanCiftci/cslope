/**
 * The acceptance criterion of the Morgenstern-Price solution: a converged
 * solution has positive Fm and Ff that agree within the tolerance, capped
 * at 0.01 and at 1 % of F (MP_GAP_CAP in solvers.ts).
 */

import { describe, it, expect } from "vitest";
import { Material } from "../types/material";
import type { Slice } from "../types/index";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { getSlices } from "./slices";
import { Slope } from "./slope";
import { analyseMorgensternPrice } from "./solvers";

/**
 * A synthetic model exercising most features (fill over clay, spatial
 * strengths, two water tables, a waternet, loads, reinforcement, piles)
 * and one circular surface on which Fm(λ) passes through zero: Fm is
 * about −0.0003 at λ from −0.18 to −0.1 and 0.15–0.57 at λ 0 and 0.1,
 * while Ff is 0.3–0.63. There is no complete-equilibrium solution. (On
 * a circle 0.1 m higher and to the left, with the arc as slice base, the
 * test |Fm − Ff| < tolerance accepted F = 0.092 with Fm = −0.003 and Ff
 * = 0.186 at tolerance 0.2, and a 1-ulp change of one slice weight or
 * base angle moved the accepted result anywhere between −4.2 and 13.9;
 * the circle was moved when the slice base became the chord, 2026-11-10.)
 */
const DEFINITION = JSON.parse(String.raw`{"orientation": "rtl", "coordinates": [[40, -10], [40, 0], [25, 0], [15, 10], [0, 10], [0, -10]], "materials": [{"name": "Fill", "color": "#aaa", "depthRange": [0, 3], "waterTableId": "p2", "model": {"kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 2, "frictionAngle": 32, "cohesionRefDepth": 1}}, {"name": "Clay", "model": {"kind": "mohr-coulomb", "unitWeight": 17, "cohesion": 5, "frictionAngle": 25, "aboveWater": {"kind": "spatial-mohr-coulomb", "unitWeight": 18, "dataPoints": [[38, 5, 10, 30, 18], [2, 5, 12, 28, 18]], "interpolation": "nearest"}}}, {"name": "Spatial", "model": {"kind": "spatial-mohr-coulomb", "unitWeight": 18, "unitWeightSat": 20, "ru": 0.1, "dataPoints": [[35, -5, 10, 30, 18], [5, -5, 12, 28, 19]]}}, {"name": "Rock", "model": {"kind": "impenetrable", "unitWeight": 22}}], "waterTable": {"mode": "custom", "value": [[40, -1], [20, 2], [0, 8]], "followBoundary": false}, "waterTables": [{"id": "p2", "coordinates": [[40, -3], [0, 5]], "followBoundary": true}], "udls": [{"magnitude": 10, "x1": 4, "x2": 10, "direction": "normal", "excessPorePressure": [{"material": "Clay", "ratio": 0.4}, {"material": "Fill", "ratio": 0.5}]}, {"magnitude": 5, "x1": 2, "x2": 8}, {"magnitude": 0, "x1": 38, "x2": 39}], "lineLoads": [{"magnitude": 50, "x": 4.630000000000003, "angle": -20, "y": 11}, {"magnitude": 20, "x": 6.710000000000001, "angle": 0}, {"magnitude": 7, "x": 9.59}, {"magnitude": 0, "x": 8.870000000000001}], "rapidDrawdown": {"waterBefore": [[40, 5], [0, 9]]}, "waternet": {"headLines": [{"id": "h1", "points": [[0, 8], [40, 2]]}, {"id": "h2", "points": [[40, 0], [20, 1], [0, 3]]}], "referenceLines": [{"points": [[40, -4], [0, -2]], "topHeadLineId": "h1", "bottomHeadLineId": "h2"}, {"points": [[0, -8], [40, -8]], "bottomHeadLineId": "h2"}], "phreaticLineId": "h1"}, "reinforcements": [{"x1": 16, "y1": 9, "x2": 6, "y2": 4, "tensileCapacity": 100, "spacing": 2, "pullout": {"kind": "bond", "strength": 20, "bondedLength": 4}, "direction": "tangent", "application": "passive", "prestress": 10}, {"x1": 18, "y1": 8, "x2": 4, "y2": 2, "tensileCapacity": 80, "pullout": {"kind": "interface", "adhesion": 3, "frictionAngle": 20, "coverage": 0.8}, "end1Capacity": 5}, {"x1": 20, "y1": 6, "x2": 8, "y2": 0, "tensileCapacity": 60, "pullout": {"kind": "development", "length1": 2, "length2": 3}}, {"x1": 22, "y1": 4, "x2": 10, "y2": -2, "tensileCapacity": 40}, {"x1": 25.689999999999998, "y1": 2, "x2": 13.829999999999998, "y2": -1, "tensileCapacity": 50, "pullout": {"kind": "bond", "strength": 15}}], "piles": [{"x1": 9.629999999999999, "y1": 10, "x2": 9.629999999999999, "y2": -6, "diameter": 0.6, "spacing": 1.5, "angle": 10, "direction": "angle", "location": "slip-surface", "wall": false}, {"x1": 5.710000000000001, "y1": 10, "x2": 5.710000000000001, "y2": -4, "diameter": 0.5, "spacing": 1.2, "shearCapacity": 40, "momentCapacity": 30}, {"x1": 12.79, "y1": 11, "x2": 11.79, "y2": -3, "force": 25, "spacing": 2, "direction": "perpendicular"}, {"x1": 2.8699999999999974, "y1": 10, "x2": 2.8699999999999974, "y2": 0, "force": 15, "direction": "tangent", "application": "passive"}], "materialBoundaries": [{"coordinates": [[40, -3], [0, 3]], "materialName": ""}, {"coordinates": [[40, -6], [0, -6]], "materialName": "Spatial"}, {"coordinates": [[40, -8], [0, -8]], "materialName": "Rock"}], "topRegionMaterialName": "Fill", "regionAssignments": [{"point": [2, 9], "materialName": "Fill"}, {"point": [20, -1], "materialName": "Clay"}, {"point": [20, -7], "materialName": "Spatial"}, {"point": [20, -9], "materialName": "Rock"}], "analysisLimits": {"entryLeftX": 2.0900000000000034, "entryRightX": 13.870000000000001, "exitLeftX": 26.17, "exitRightX": 37.93}, "customSearchPlanes": [{"cx": 22, "cy": 22, "radius": 20}, {"cx": 22, "cy": 22, "radius": 25}, {"cx": -60, "cy": 100, "radius": 1}], "customSurfaces": [{"points": [[10, 10], [20, -2], [30, 0]], "axis": [19, 23]}, {"points": [[12, 10], [28, 0]]}, {"points": [[10, 12], [11, 11]]}], "customPlanesOnly": false}`) as SlopeDefinition;
const PLANE = {
  x0: 9.986683704666925,
  x1: 31.53878106241597,
  cx: 27.71083599878623,
  cy: 19.974620556748373,
  radius: 20.338107822416568,
};

/** The slices with one slice's weight, or base angle, moved by about 1 ulp. */
function perturbations(slices: Slice[]): Slice[][] {
  const out: Slice[][] = [];
  for (let i = 0; i < slices.length; i++) {
    const w = slices.map((s) => ({ ...s }));
    w[i].weight *= 1 + Number.EPSILON;
    const a = slices.map((s) => ({ ...s }));
    a[i].alpha += Math.abs(a[i].alpha) * Number.EPSILON;
    out.push(w, a);
  }
  return out;
}

describe("Morgenstern-Price convergence criterion", () => {
  it("accepts no pair with Fm <= 0 or a gap above the capped tolerance, also after 1-ulp changes", () => {
    for (const tolerance of [0.2, 0.1, 0.001]) {
      const slope = buildSlope(DEFINITION);
      slope.updateAnalysisOptions({ slices: 25, iterations: 300, refinedIterations: 0, tolerance, intersliceFunction: "constant" });
      const slices = getSlices(slope, PLANE.x0, PLANE.x1, PLANE.cx, PLANE.cy, PLANE.radius);
      expect(slices).toHaveLength(26);
      for (const s of [slices, ...perturbations(slices)]) {
        const [, lff, , , converged, , closestPair] = analyseMorgensternPrice(slope, s);
        expect(converged).toBe(false);
        expect(closestPair).toBeFalsy();
        // The walk passed the pair with Fm <= 0 that used to be accepted.
        expect(lff!.some((e) => e[1] <= 0)).toBe(true);
      }
    }
  });

  it("at a loose tolerance, a solution still agrees with the tight one within 1 % of F", () => {
    const slope = new Slope();
    slope.setExternalBoundary([[0, -15], [0, 0], [20, 0], [40, -10], [50, -10], [50, -15]]);
    slope.assignMaterial([1, -1], new Material({ name: "M1", unitWeight: 20, frictionAngle: 19.6, cohesion: 3 }));
    const ints = slope.getCircleExternalIntersection(28, 25, 35);
    const run = (tolerance: number) => {
      slope.updateAnalysisOptions({ slices: 30, iterations: 200, tolerance });
      const slices = getSlices(slope, ints[0][0], ints[ints.length - 1][0], 28, 25, 35);
      return analyseMorgensternPrice(slope, slices);
    };
    const [exact] = run(1e-9);
    for (const tolerance of [0.1, 0.05, 0.01, 0.001]) {
      const [fos, lff, , , converged] = run(tolerance);
      expect(converged).toBe(true);
      expect(Math.abs(fos! - exact!)).toBeLessThan(0.01 * exact!);
      // The accepted pair: both factors positive, the gap within the cap.
      const met = lff!.filter((e) => e[1] > 0 && e[2] > 0 && e[3] < Math.min(tolerance, 0.01 * Math.max(e[1], e[2])));
      expect(met.length).toBeGreaterThan(0);
    }
  });
});
