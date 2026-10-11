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
    id: "VP35-RI",
    title: "Cannon Dam end of construction (Hassan & Wolff), reliability on the minimum-β circle",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4). Slide2 Verification Problem #35.",
    description: "The VP35 dam on the circle of minimum reliability index: Phase I fill φ = 8.5° ± 8.5°, c = 117.8 ± 58.9 kPa; Phase II fill c = 143.6 ± 79 kPa, φ = 15° ± 9°, treated as independent normal variables (xslope's Taylor series has no correlation term); Bishop.",
    definition: { orientation: "ltr", materials: [{ name: "Phase II clay fill", unitWeight: 22, frictionAngle: 15, cohesion: 143.64, model: { kind: "mohr-coulomb", unitWeight: 22, cohesion: 143.64, frictionAngle: 15 } }, { name: "Sand filter", unitWeight: 22, frictionAngle: 35, cohesion: 0, model: { kind: "mohr-coulomb", unitWeight: 22, cohesion: 0, frictionAngle: 35 } }, { name: "Spoil fill", unitWeight: 25, frictionAngle: 35, cohesion: 5, model: { kind: "mohr-coulomb", unitWeight: 25, cohesion: 5, frictionAngle: 35 } }, { name: "Phase I clay fill", unitWeight: 22, frictionAngle: 8.5, cohesion: 117.79, model: { kind: "mohr-coulomb", unitWeight: 22, cohesion: 117.79, frictionAngle: 8.5 } }, { name: "Foundation sand", unitWeight: 20, frictionAngle: 18, cohesion: 5, model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 5, frictionAngle: 18 } }, { name: "Limestone", unitWeight: 23, frictionAngle: 45, cohesion: 1000, model: { kind: "mohr-coulomb", unitWeight: 23, cohesion: 1000, frictionAngle: 45 } }], coordinates: [[40, 121.92], [477.5, 121.92], [477.5, 140.21], [477.5, 156.97], [477.5, 167.4], [402.4, 169.16], [364.3, 176.17], [308.7, 186.23], [269.4, 199.34], [261.4, 199.34], [208, 184.1], [146.02, 178.31], [109.45, 166.12], [82, 156.97], [40, 156.97], [40, 140.21]], materialBoundaries: [{ coordinates: [[402.4, 169.16], [410, 166.12]], materialName: "" }, { coordinates: [[410, 166.12], [269.1, 166.12]], materialName: "" }, { coordinates: [[410, 166.12], [432.88, 156.97]], materialName: "" }, { coordinates: [[269.1, 166.12], [268.6, 199], [264.4, 199], [263.9, 166.12]], materialName: "" }, { coordinates: [[269.1, 166.12], [263.9, 166.12]], materialName: "" }, { coordinates: [[263.9, 166.12], [109.45, 166.12]], materialName: "" }, { coordinates: [[432.88, 156.97], [477.5, 156.97]], materialName: "" }, { coordinates: [[432.88, 156.97], [307.7, 156.97], [282, 140.21]], materialName: "" }, { coordinates: [[282, 140.21], [254, 140.21]], materialName: "" }, { coordinates: [[282, 140.21], [477.5, 140.21]], materialName: "" }, { coordinates: [[254, 140.21], [220.5, 156.97], [82, 156.97]], materialName: "" }, { coordinates: [[254, 140.21], [40, 140.21]], materialName: "" }], regionAssignments: [{ point: [196.54226, 172.665], materialName: "Phase II clay fill" }, { point: [266.5, 182.56], materialName: "Sand filter" }, { point: [449.47, 161.545], materialName: "Spoil fill" }, { point: [266.05, 148.59], materialName: "Phase I clay fill" }, { point: [138.625, 148.59], materialName: "Foundation sand" }, { point: [386.175, 148.59], materialName: "Foundation sand" }, { point: [258.75, 131.065], materialName: "Limestone" }], customSearchPlanes: [{ cx: 340.248, cy: 283.967, radius: 125.967 }], customPlanesOnly: true },
    method: "Bishop",
    options: { slices: 60 },
    variables: [{ material: 0, field: "cohesion", sd: 79 }, { material: 0, field: "frictionAngle", sd: 9 }, { material: 3, field: "cohesion", sd: 58.89 }, { material: 3, field: "frictionAngle", sd: 8.5 }],
    samples: 10000,
    seed: 1,
    checks: [["fos", 2.973, "xslope (same input)", 0.01], ["beta-taylor", 3.353, "xslope (same input)", 0.05]],
    notes: ["Slide2 RI (lognormal) 4.351 and Hassan & Wolff 3.987 with their own surfaces and ρ(c, φ) = −0.55 in the Phase II fill; the critical factor of safety at the means is VP35."],
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
