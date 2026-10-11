/**
 * Probabilistic verification problems (Slide2 VP28 and VP29), transcribed
 * via the xslope corpus (github.com/njones61/xslope, docs/verification,
 * Apache-2.0); imperial inputs converted to SI. Generated data: the
 * deterministic factors of safety join the verification cases in
 * cases.ts, the reliability checks are run by runReliabilityCase.
 */
import type { AnalysisMethod, AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import type { RandomVariable } from "../model/reliability";

/** fos: deterministic FOS (relative tolerance); β and Pf: absolute tolerance. */
export type ReliabilityQuantity = "fos" | "beta-taylor" | "pf-taylor" | "beta-mc" | "pf-mc";

export interface ReliabilityCaseData {
  id: string;
  title: string;
  reference: string;
  description: string;
  /** Model space, analysed on the given surface. */
  definition: SlopeDefinition;
  method: AnalysisMethod | "Spencer";
  options: Partial<AnalysisOptions>;
  variables: RandomVariable[];
  /** Monte Carlo samples and seed. */
  samples: number;
  seed: number;
  checks: [ReliabilityQuantity, number, string, number][];
  notes?: string[];
}

export const RELIABILITY_CASES: ReliabilityCaseData[] = [
  {
    id: "VP28a",
    title: "Congress Street cut, probabilistic (tangent to clay 2)",
    reference: "Chowdhury & Xu (1995), Reliability Engineering & System Safety 47. Slide2 Verification Problem #28.",
    description: "Ireland's (1954) Congress Street cut: three undrained clays (Su = 55, 43, 56 kPa; σ = 20.4, 8.2, 13.2 kPa) under a sand cap without strength. Slide's critical circle, Bishop; the clay strengths are independent normal variables.",
    definition: { materials: [{ name: "Sand", unitWeight: 22, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 22, undrainedShearStrength: 0 } }, { name: "Clay 1", unitWeight: 21, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 21, undrainedShearStrength: 55 } }, { name: "Clay 2", unitWeight: 22, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 22, undrainedShearStrength: 43 } }, { name: "Clay 3", unitWeight: 22, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 22, undrainedShearStrength: 56 } }, { name: "Material 5", unitWeight: 22, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 22, undrainedShearStrength: 56 } }], coordinates: [[-57, -15], [-57, 5], [-36, 5], [-31, 1], [-28, -1], [-22, -3], [-8, -9], [-7, -10], [5, -10], [5, -15]], materialBoundaries: [{ coordinates: [[-57, 1], [-31, 1], [-28, -1], [-22, -3], [-8, -9], [-7, -10], [5, -10]], materialName: "" }, { coordinates: [[-57, -3], [-22, -3], [-8, -9], [-7, -10], [5, -10]], materialName: "" }, { coordinates: [[-57, -9], [-8, -9], [-7, -10], [5, -10]], materialName: "" }, { coordinates: [[-57, -12], [5, -12]], materialName: "" }], regionAssignments: [{ point: [-46.5, 4.5], materialName: "Sand" }, { point: [-44, 0.5], materialName: "Clay 1" }, { point: [-39.5, -3.5], materialName: "Clay 2" }, { point: [-32.5, -9.5], materialName: "Clay 3" }, { point: [-26, -12.5], materialName: "Material 5" }], customSearchPlanes: [{ cx: -22.151, cy: 20.872, radius: 30.012 }], customPlanesOnly: true },
    method: "Bishop",
    options: { slices: 60 },
    variables: [{ material: 1, field: "undrainedShearStrength", sd: 20.4 }, { material: 2, field: "undrainedShearStrength", sd: 8.2 }, { material: 3, field: "undrainedShearStrength", sd: 13.2 }],
    samples: 10000,
    seed: 1,
    checks: [["fos", 1.128, "Slide2", 0.01], ["beta-taylor", 0.768, "xslope (same input)", 0.03], ["beta-mc", 0.774, "xslope (same input)", 0.03], ["pf-mc", 0.215, "xslope (same input)", 0.02]],
    notes: ["Slide2 RI (lognormal) 0.650 and C&X Pf 26.6 % use other estimators (cross-estimator)."],
  },
  {
    id: "VP28b",
    title: "Embankment on soft clay, probabilistic (tangent to the interface)",
    reference: "Chowdhury & Xu (1995), Reliability Engineering & System Safety 47. Slide2 Verification Problem #28.",
    description: "Embankment fill (c′ = 10 kPa, φ′ = 12°; σ = 2 kPa, 3°) on soft clay (Su = 40 kPa, σ = 8 kPa) over a hard layer; the circle tangent to the fill–clay interface, Bishop.",
    definition: { orientation: "rtl", materials: [{ name: "Layer 1", unitWeight: 20, frictionAngle: 12, cohesion: 10, model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 12 } }, { name: "Layer 2", unitWeight: 18, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 40 } }, { name: "Hard layer", unitWeight: 20, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 20, undrainedShearStrength: 1000 } }], coordinates: [[0, 0], [0, 15], [30, 15], [55, 25], [60, 25], [80, 15], [90, 15], [90, 0]], materialBoundaries: [{ coordinates: [[0, 15], [90, 15]], materialName: "" }, { coordinates: [[0, 5], [90, 5]], materialName: "" }], regionAssignments: [{ point: [57.5, 24.5], materialName: "Layer 1" }, { point: [45, 14.5], materialName: "Layer 2" }, { point: [45, 4.5], materialName: "Hard layer" }], customSearchPlanes: [{ cx: 37.369, cy: 42.429, radius: 27.429 }], customPlanesOnly: true },
    method: "Bishop",
    options: { slices: 60 },
    variables: [{ material: 0, field: "cohesion", sd: 2 }, { material: 0, field: "frictionAngle", sd: 3 }, { material: 1, field: "undrainedShearStrength", sd: 8 }],
    samples: 10000,
    seed: 1,
    checks: [["fos", 1.16, "Slide2", 0.01], ["beta-taylor", 0.787, "xslope (same input)", 0.03], ["beta-taylor", 0.799, "Slide2 (RI lognormal)", 0.03], ["beta-mc", 0.8, "xslope (same input)", 0.03], ["pf-mc", 0.206, "xslope (same input)", 0.02]],
    notes: ["C&X Pf 20.2 %."],
  },
  {
    id: "VP28c",
    title: "Embankment on soft clay, probabilistic (tangent to the clay base)",
    reference: "Chowdhury & Xu (1995), Reliability Engineering & System Safety 47. Slide2 Verification Problem #28.",
    description: "As VP28b with the deep circle tangent to the base of the soft clay.",
    definition: { orientation: "rtl", materials: [{ name: "Layer 1", unitWeight: 20, frictionAngle: 12, cohesion: 10, model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 12 } }, { name: "Layer 2", unitWeight: 18, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 40 } }, { name: "Hard layer", unitWeight: 20, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 20, undrainedShearStrength: 1000 } }], coordinates: [[0, 0], [0, 15], [30, 15], [55, 25], [60, 25], [80, 15], [90, 15], [90, 0]], materialBoundaries: [{ coordinates: [[0, 15], [90, 15]], materialName: "" }, { coordinates: [[0, 5], [90, 5]], materialName: "" }], regionAssignments: [{ point: [57.5, 24.5], materialName: "Layer 1" }, { point: [45, 14.5], materialName: "Layer 2" }, { point: [45, 4.5], materialName: "Hard layer" }], customSearchPlanes: [{ cx: 40.256, cy: 29.437, radius: 24.437 }], customPlanesOnly: true },
    method: "Bishop",
    options: { slices: 60 },
    variables: [{ material: 0, field: "cohesion", sd: 2 }, { material: 0, field: "frictionAngle", sd: 3 }, { material: 1, field: "undrainedShearStrength", sd: 8 }],
    samples: 10000,
    seed: 1,
    checks: [["fos", 1.185, "Slide2", 0.01], ["beta-taylor", 0.798, "xslope (same input)", 0.03], ["beta-taylor", 0.82, "Slide2 (RI lognormal)", 0.03], ["beta-mc", 0.789, "xslope (same input)", 0.03], ["pf-mc", 0.209, "xslope (same input)", 0.02]],
    notes: ["C&X Pf 19.7 %; C&X FOS 1.148."],
  },
  {
    id: "VP29",
    title: "LASH terminal trench, Duncan's Taylor series example",
    reference: "Duncan (2000), J. Geotech. Geoenviron. Eng. 126(4). Slide2 Verification Problem #29.",
    description: "Underwater trench in San Francisco Bay Mud: Su = 100 psf at el. −20 ft increasing 9.8 psf/ft, γ = 100 pcf, water at el. 0. Duncan's surface as a circle, Spencer; σγ = 3.3 pcf and σ of the Su gradient 1.2 psf/ft (Slide's Table 29.2). Converted to SI.",
    definition: { materials: [{ name: "San Francisco Bay Mud", unitWeight: 15.70875, frictionAngle: 0, cohesion: 0, model: { kind: "undrained", unitWeight: 15.70875, undrainedShearStrength: 4.78803, suRefDepth: -6.096, suRateOfChange: 1.53946 } }], coordinates: [[-8.5344, -43.5864], [-8.5344, -12.192], [0, -12.192], [21.6408, -36.576], [42.0624, -36.576], [69.4944, -5.4864], [86.2584, -5.1816], [106.68, -2.4384], [118.5672, 6.7056], [140.5128, 6.7056], [140.5128, -43.5864]], materialBoundaries: [], regionAssignments: [{ point: [129.54, 6.2056], materialName: "San Francisco Bay Mud" }], waterTable: { mode: "custom", value: [[-8.5344, 0], [140.5128, 0]], followBoundary: false }, customSearchPlanes: [{ cx: -2.00833, cy: 125.03841, radius: 167.5129 }], customPlanesOnly: true },
    method: "Spencer",
    options: { slices: 60, porePressureHead: "vertical" },
    variables: [{ material: 0, field: "unitWeight", sd: 0.51839 }, { material: 0, field: "suRateOfChange", sd: 0.1885 }],
    samples: 10000,
    seed: 1,
    checks: [["fos", 1.145, "xslope (same input)", 0.01], ["beta-taylor", 0.9, "Duncan (2000)", 0.03], ["pf-taylor", 0.18, "Duncan (2000)", 0.01]],
    notes: ["Above el. −20 ft cSlope extrapolates Su linearly (below 100 psf); xslope keeps 100 psf there (F = 1.146, β = 0.947 when cSlope does the same). Duncan's F is 1.17; Slide2's Latin hypercube Monte Carlo gives Pf = 14 % with a rate-only σ."],
  },
];
