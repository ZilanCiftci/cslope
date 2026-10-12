/**
 * Probabilistic verification problems: reliability index β and probability
 * of failure from the Taylor series and Monte Carlo methods, on the surface
 * of the deterministic problem with the same id (problems.ts). A problem can
 * have more than one probabilistic analysis. Imperial inputs converted to SI.
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
  /** Correlation coefficients between variables (indices into `variables`). */
  correlations?: { a: number; b: number; rho: number }[];
  /** Monte Carlo samples and seed. */
  samples: number;
  seed: number;
  checks: [ReliabilityQuantity, number, string, number][];
  notes?: string[];
}

export const RELIABILITY_CASES: ReliabilityCaseData[] = [
  {
    id: "V021a",
    title: "Congress Street cut, probabilistic (tangent to clay 2)",
    reference: "Chowdhury & Xu (1995), Reliability Engineering & System Safety 47.",
    description: "Ireland's (1954) Congress Street cut: three undrained clays (Su = 55, 43, 56 kPa; σ = 20.4, 8.2, 13.2 kPa) under a sand cap without strength, with the ground top at 4.579 m and the clay boundaries at −9.144 / −12.192 m (commercial program A's printed slip-surface endpoints). commercial program A's critical circle, Bishop; the clay strengths are independent normal variables.",
    definition: {"materials":[{"name":"Sand","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":0}},{"name":"Clay 1","unitWeight":21,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":21,"undrainedShearStrength":55}},{"name":"Clay 2","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":43}},{"name":"Clay 3","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":56}},{"name":"Material 5","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":56}}],"coordinates":[[-57,-15],[-57,4.579],[-36,4.579],[-31,1],[-28,-1],[-22,-3],[-8,-9.144],[-7,-10],[5,-10],[5,-15]],"materialBoundaries":[{"coordinates":[[-57,1],[-31,1],[-28,-1],[-22,-3],[-8,-9.144],[-7,-10],[5,-10]],"materialName":""},{"coordinates":[[-57,-3],[-22,-3],[-8,-9.144],[-7,-10],[5,-10]],"materialName":""},{"coordinates":[[-57,-9.144],[-8,-9.144],[-7,-10],[5,-10]],"materialName":""},{"coordinates":[[-57,-12.192],[5,-12.192]],"materialName":""}],"regionAssignments":[{"point":[-46.5,4.5],"materialName":"Sand"},{"point":[-44,0.5],"materialName":"Clay 1"},{"point":[-39.5,-3.5],"materialName":"Clay 2"},{"point":[-32.5,-9.5],"materialName":"Clay 3"},{"point":[-26,-12.5],"materialName":"Material 5"}],"customSearchPlanes":[{"cx":-22.151,"cy":20.872,"radius":30.012}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":1,"field":"undrainedShearStrength","sd":20.4},{"material":2,"field":"undrainedShearStrength","sd":8.2},{"material":3,"field":"undrainedShearStrength","sd":13.2}],
    samples: 10000,
    seed: 1,
    checks: [
      ["pf-mc",0.2461,"Commercial program A",0.02],
      ["beta-mc",0.65,"Commercial program A (lognormal)",0.04],
    ],
    notes: [
      "commercial program A's Pf and reliability index come from its Monte Carlo analysis (at least 5000 samples) and are compared with cSlope's Monte Carlo (10 000 samples).",
      "program D on the earlier geometry read from the figure labels (top 5, boundaries −9 / −12): β 0.768 (Taylor), 0.774 (Monte Carlo), Pf 0.215; cSlope gives F = 1.129 there. Chowdhury & Xu Pf 26.6 % (normal distribution of F).",
    ],
  },
  {
    id: "V021b",
    title: "Congress Street cut, probabilistic (tangent to clay 3)",
    reference: "Chowdhury & Xu (1995), Reliability Engineering & System Safety 47.",
    description: "The V021a cut (example 1) on the reference critical circle tangent to the base of clay 3 (−12.192 m), Bishop; the clay strengths are independent normal variables.",
    definition: {"materials":[{"name":"Sand","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":0}},{"name":"Clay 1","unitWeight":21,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":21,"undrainedShearStrength":55}},{"name":"Clay 2","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":43}},{"name":"Clay 3","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":56}},{"name":"Material 5","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":56}}],"coordinates":[[-57,-15],[-57,4.579],[-36,4.579],[-31,1],[-28,-1],[-22,-3],[-8,-9.144],[-7,-10],[5,-10],[5,-15]],"materialBoundaries":[{"coordinates":[[-57,1],[-31,1],[-28,-1],[-22,-3],[-8,-9.144],[-7,-10],[5,-10]],"materialName":""},{"coordinates":[[-57,-3],[-22,-3],[-8,-9.144],[-7,-10],[5,-10]],"materialName":""},{"coordinates":[[-57,-9.144],[-8,-9.144],[-7,-10],[5,-10]],"materialName":""},{"coordinates":[[-57,-12.192],[5,-12.192]],"materialName":""}],"regionAssignments":[{"point":[-46.5,4.5],"materialName":"Sand"},{"point":[-44,0.5],"materialName":"Clay 1"},{"point":[-39.5,-3.5],"materialName":"Clay 2"},{"point":[-32.5,-9.5],"materialName":"Clay 3"},{"point":[-26,-12.5],"materialName":"Material 5"}],"customSearchPlanes":[{"cx":-19.814,"cy":20.872,"radius":33.062}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":1,"field":"undrainedShearStrength","sd":20.4},{"material":2,"field":"undrainedShearStrength","sd":8.2},{"material":3,"field":"undrainedShearStrength","sd":13.2}],
    samples: 10000,
    seed: 1,
    checks: [
      ["pf-mc",0.2789,"Commercial program A",0.02],
      ["beta-mc",0.537,"Commercial program A (lognormal)",0.04],
    ],
    notes: [
      "commercial program A's Pf and reliability index come from its Monte Carlo analysis (at least 5000 samples) and are compared with cSlope's Monte Carlo (10 000 samples).",
      "Chowdhury & Xu: F = 1.109, Pf 27.4 % (normal distribution of F).",
    ],
  },
  {
    id: "V022a",
    title: "Embankment on soft clay, probabilistic (tangent to the interface)",
    reference: "Chowdhury & Xu (1995), Reliability Engineering & System Safety 47.",
    description: "Embankment fill (c′ = 10 kPa, φ′ = 12°; σ = 2 kPa, 3°) on soft clay (Su = 40 kPa, σ = 8 kPa) over a hard layer; the circle tangent to the fill–clay interface, Bishop.",
    definition: {"orientation":"rtl","materials":[{"name":"Layer 1","unitWeight":20,"frictionAngle":12,"cohesion":10,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":10,"frictionAngle":12}},{"name":"Layer 2","unitWeight":18,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":18,"undrainedShearStrength":40}},{"name":"Hard layer","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":20,"undrainedShearStrength":1000}}],"coordinates":[[0,0],[0,15],[30,15],[55,25],[60,25],[80,15],[90,15],[90,0]],"materialBoundaries":[{"coordinates":[[0,15],[90,15]],"materialName":""},{"coordinates":[[0,5],[90,5]],"materialName":""}],"regionAssignments":[{"point":[57.5,24.5],"materialName":"Layer 1"},{"point":[45,14.5],"materialName":"Layer 2"},{"point":[45,4.5],"materialName":"Hard layer"}],"customSearchPlanes":[{"cx":37.369,"cy":42.429,"radius":27.429}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":2},{"material":0,"field":"frictionAngle","sd":3},{"material":1,"field":"undrainedShearStrength","sd":8}],
    samples: 10000,
    seed: 1,
    checks: [
      ["pf-mc",0.2117,"Commercial program A",0.02],
      ["beta-mc",0.799,"Commercial program A (lognormal)",0.04],
      ["beta-taylor",0.787,"Program D",0.03],
      ["beta-mc",0.8,"Program D",0.03],
      ["pf-mc",0.206,"Program D",0.02],
    ],
    notes: [
      "commercial program A's Pf and reliability index come from its Monte Carlo analysis (at least 5000 samples) and are compared with cSlope's Monte Carlo (10 000 samples).",
      "Chowdhury & Xu Pf 20.2 %.",
    ],
  },
  {
    id: "V022b",
    title: "Embankment on soft clay, probabilistic (tangent to the clay base)",
    reference: "Chowdhury & Xu (1995), Reliability Engineering & System Safety 47.",
    description: "As V022a with the deep circle tangent to the base of the soft clay.",
    definition: {"orientation":"rtl","materials":[{"name":"Layer 1","unitWeight":20,"frictionAngle":12,"cohesion":10,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":10,"frictionAngle":12}},{"name":"Layer 2","unitWeight":18,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":18,"undrainedShearStrength":40}},{"name":"Hard layer","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":20,"undrainedShearStrength":1000}}],"coordinates":[[0,0],[0,15],[30,15],[55,25],[60,25],[80,15],[90,15],[90,0]],"materialBoundaries":[{"coordinates":[[0,15],[90,15]],"materialName":""},{"coordinates":[[0,5],[90,5]],"materialName":""}],"regionAssignments":[{"point":[57.5,24.5],"materialName":"Layer 1"},{"point":[45,14.5],"materialName":"Layer 2"},{"point":[45,4.5],"materialName":"Hard layer"}],"customSearchPlanes":[{"cx":40.256,"cy":29.437,"radius":24.437}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":2},{"material":0,"field":"frictionAngle","sd":3},{"material":1,"field":"undrainedShearStrength","sd":8}],
    samples: 10000,
    seed: 1,
    checks: [
      ["pf-mc",0.1992,"Commercial program A",0.02],
      ["beta-mc",0.82,"Commercial program A (lognormal)",0.04],
      ["beta-taylor",0.798,"Program D",0.03],
      ["beta-mc",0.789,"Program D",0.03],
      ["pf-mc",0.209,"Program D",0.02],
    ],
    notes: [
      "commercial program A's Pf and reliability index come from its Monte Carlo analysis (at least 5000 samples) and are compared with cSlope's Monte Carlo (10 000 samples).",
      "Chowdhury & Xu Pf 19.7 %; C&X FOS 1.148.",
    ],
  },
  {
    id: "V060b",
    title: "Cannon Dam end of construction (Hassan & Wolff), reliability on the minimum-β circle",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "The V060a dam on the circle of minimum reliability index: Phase I fill φ = 8.5° ± 8.5°, c = 117.8 ± 58.9 kPa; Phase II fill c = 143.6 ± 79 kPa, φ = 15° ± 9°, treated as independent normal variables (program D's Taylor series has no correlation term); Bishop.",
    definition: {"orientation":"ltr","materials":[{"name":"Phase II clay fill","unitWeight":22,"frictionAngle":15,"cohesion":143.64,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Sand filter","unitWeight":22,"frictionAngle":35,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":35,"cohesion":5,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Phase I clay fill","unitWeight":22,"frictionAngle":8.5,"cohesion":117.79,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":18,"cohesion":5,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":23,"frictionAngle":45,"cohesion":1000,"model":{"kind":"mohr-coulomb","unitWeight":23,"cohesion":1000,"frictionAngle":45}}],"coordinates":[[40,121.92],[477.5,121.92],[477.5,140.21],[477.5,156.97],[477.5,167.4],[402.4,169.16],[364.3,176.17],[308.7,186.23],[269.4,199.34],[261.4,199.34],[208,184.1],[146.02,178.31],[109.45,166.12],[82,156.97],[40,156.97],[40,140.21]],"materialBoundaries":[{"coordinates":[[402.4,169.16],[410,166.12]],"materialName":""},{"coordinates":[[410,166.12],[269.1,166.12]],"materialName":""},{"coordinates":[[410,166.12],[432.88,156.97]],"materialName":""},{"coordinates":[[269.1,166.12],[268.6,199],[264.4,199],[263.9,166.12]],"materialName":""},{"coordinates":[[269.1,166.12],[263.9,166.12]],"materialName":""},{"coordinates":[[263.9,166.12],[109.45,166.12]],"materialName":""},{"coordinates":[[432.88,156.97],[477.5,156.97]],"materialName":""},{"coordinates":[[432.88,156.97],[307.7,156.97],[282,140.21]],"materialName":""},{"coordinates":[[282,140.21],[254,140.21]],"materialName":""},{"coordinates":[[282,140.21],[477.5,140.21]],"materialName":""},{"coordinates":[[254,140.21],[220.5,156.97],[82,156.97]],"materialName":""},{"coordinates":[[254,140.21],[40,140.21]],"materialName":""}],"regionAssignments":[{"point":[196.54226,172.665],"materialName":"Phase II clay fill"},{"point":[266.5,182.56],"materialName":"Sand filter"},{"point":[449.47,161.545],"materialName":"Spoil fill"},{"point":[266.05,148.59],"materialName":"Phase I clay fill"},{"point":[138.625,148.59],"materialName":"Foundation sand"},{"point":[386.175,148.59],"materialName":"Foundation sand"},{"point":[258.75,131.065],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":340.248,"cy":283.967,"radius":125.967}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":3,"field":"cohesion","sd":58.89},{"material":3,"field":"frictionAngle","sd":8.5}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-taylor",3.353,"Program D",0.05],
    ],
    notes: [
      "commercial program A's reliability indices on Hassan & Wolff's nine circles, with the correlations of Table 35.1, are checked in V062a … V062i; the critical factor of safety at the means is V060a.",
    ],
  },
  {
    id: "V023",
    title: "LASH terminal trench, Duncan's Taylor series example",
    reference: "Duncan (2000), J. Geotech. Geoenviron. Eng. 126(4).",
    description: "Underwater trench in San Francisco Bay Mud: Su = 100 psf at el. −20 ft increasing 9.8 psf/ft, γ = 100 pcf, water at el. 0. Duncan's surface as a circle, Spencer; σγ = 3.3 pcf and σ of the Su gradient 1.2 psf/ft (commercial program A's Table 29.2). Converted to SI.",
    definition: {"materials":[{"name":"San Francisco Bay Mud","unitWeight":15.70875,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":15.70875,"undrainedShearStrength":4.78803,"suRefDepth":-6.096,"suRateOfChange":1.53946}}],"coordinates":[[-8.5344,-43.5864],[-8.5344,-12.192],[0,-12.192],[21.6408,-36.576],[42.0624,-36.576],[69.4944,-5.4864],[86.2584,-5.1816],[106.68,-2.4384],[118.5672,6.7056],[140.5128,6.7056],[140.5128,-43.5864]],"materialBoundaries":[],"regionAssignments":[{"point":[129.54,6.2056],"materialName":"San Francisco Bay Mud"}],"waterTable":{"mode":"custom","value":[[-8.5344,0],[140.5128,0]],"followBoundary":false},"customSearchPlanes":[{"cx":-2.00833,"cy":125.03841,"radius":167.5129}],"customPlanesOnly":true},
    method: "Spencer",
    options: {"slices":60,"porePressureHead":"vertical"},
    variables: [{"material":0,"field":"unitWeight","sd":0.51839},{"material":0,"field":"suRateOfChange","sd":0.1885}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-taylor",0.9,"Duncan (2000)",0.03],
      ["pf-taylor",0.18,"Duncan (2000)",0.01],
    ],
    notes: [
      "Above el. −20 ft cSlope extrapolates Su linearly (below 100 psf); program D keeps 100 psf there (F = 1.146, β = 0.947 when cSlope does the same). Duncan's F is 1.17; commercial program A's Latin hypercube Monte Carlo gives Pf = 14 % with a rate-only σ.",
    ],
  },
  {
    id: "V062a",
    title: "Clarence Cannon Dam, surface 7A",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 7A: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":320.175,"cy":313.336,"radius":167.989}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",10.953,"Commercial program A (lognormal)",0.219],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 10.356; commercial program B 11.428 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V062b",
    title: "Clarence Cannon Dam, surface 7B",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 7B: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":295.235,"cy":277.589,"radius":121.291}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",4.351,"Commercial program A (lognormal)",0.087],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 3.987; commercial program B 3.353 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V062c",
    title: "Clarence Cannon Dam, surface 7C",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 7C: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":303.683,"cy":310.206,"radius":154.278}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",4.263,"Commercial program A (lognormal)",0.085],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 4.606; commercial program B 3.246 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V062d",
    title: "Clarence Cannon Dam, surface 7D",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 7D: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":322.152,"cy":310.206,"radius":164.846}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",11.092,"Commercial program A (lognormal)",0.222],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 8.468; commercial program B 11.632 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V062e",
    title: "Clarence Cannon Dam, surface 7E",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 7E: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":327.693,"cy":324.018,"radius":176.855}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",10.281,"Commercial program A (lognormal)",0.206],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 10.037; commercial program B 10.719 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V062f",
    title: "Clarence Cannon Dam, surface 8B",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 8B: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":304.239,"cy":307.858,"radius":152.547}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",4.858,"Commercial program A (lognormal)",0.097],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 3.987; commercial program B 3.936 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V062g",
    title: "Clarence Cannon Dam, surface 8F",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 8F: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":313.114,"cy":304.784,"radius":144.416}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",5.485,"Commercial program A (lognormal)",0.11],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 4.95; commercial program B 4.469 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V062h",
    title: "Clarence Cannon Dam, surface 8G",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 8G: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":314.856,"cy":305.604,"radius":139.848}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",5.563,"Commercial program A (lognormal)",0.111],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 5.544; commercial program B 5.128 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V062i",
    title: "Clarence Cannon Dam, surface 8H",
    reference: "Hassan & Wolff (1999), J. Geotech. Geoenviron. Eng. 125(4).",
    description: "Reliability index on Hassan & Wolff's circle 8H: Phase II fill c = 143.64 ± 79 kPa, φ = 15° ± 9° (ρ = −0.55); Phase I fill c = 117.79 ± 58.89 kPa, φ = 8.5° ± 8.5° (ρ = 0.1); normal variables, Monte Carlo, lognormal reliability index from the mean and standard deviation of F; Bishop.",
    definition: {"orientation":"ltr","coordinates":[[0.937,121.205],[0.937,156.598],[40.517,156.598],[66.125,165.456],[101.028,177.529],[158.875,182.857],[210.633,198.842],[219.767,198.842],[258.205,185.141],[306.537,175.627],[320.999,174.865],[349.162,166.112],[423.373,166.112],[423.373,120.824]],"materials":[{"name":"Phase II fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":143.64,"frictionAngle":15}},{"name":"Phase I fill","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":117.79,"frictionAngle":8.5}},{"name":"Sand filter","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":0,"frictionAngle":35}},{"name":"Spoil fill","unitWeight":25,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":25,"cohesion":5,"frictionAngle":35}},{"name":"Foundation sand","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":5,"frictionAngle":18}},{"name":"Limestone","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":100,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[0,139.853],[425,139.853]],"materialName":""},{"coordinates":[[40.517,156.598],[174.098,156.598],[204.163,139.853]],"materialName":""},{"coordinates":[[225.856,139.853],[255.921,155.837],[379.607,155.837],[425,155.837]],"materialName":""},{"coordinates":[[349.162,166.112],[357.596,163.266],[379.607,155.837]],"materialName":""},{"coordinates":[[66.125,165.456],[218.625,165.456],[357.596,163.266]],"materialName":""},{"coordinates":[[215.2,165.456],[215.2,193.894],[218.244,193.894],[218.625,165.456]],"materialName":""}],"regionAssignments":[{"point":[150,175],"materialName":"Phase II fill"},{"point":[200,160],"materialName":"Phase I fill"},{"point":[216.7,180],"materialName":"Sand filter"},{"point":[400,162],"materialName":"Spoil fill"},{"point":[100,150],"materialName":"Foundation sand"},{"point":[320,150],"materialName":"Foundation sand"},{"point":[200,130],"materialName":"Limestone"}],"customSearchPlanes":[{"cx":316.198,"cy":305.604,"radius":135.067}],"customPlanesOnly":true},
    method: "Bishop",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":79},{"material":0,"field":"frictionAngle","sd":9},{"material":1,"field":"cohesion","sd":58.89},{"material":1,"field":"frictionAngle","sd":8.5}],
    correlations: [{"a":0,"b":1,"rho":-0.55},{"a":2,"b":3,"rho":0.1}],
    samples: 10000,
    seed: 1,
    checks: [
      ["beta-mc",6.394,"Commercial program A (lognormal)",0.128],
    ],
    notes: [
      "Monte Carlo with 10 000 samples, compared with commercial program A's Monte Carlo. Hassan & Wolff 4.838; commercial program B 4.309 (commercial program B 2022 manual §2.22, which prints commercial program A's values under the heading Hassan and Wolff).",
    ],
  },
  {
    id: "V021a",
    title: "Chowdhury & Xu (1995) example 1, probability of failure",
    reference: "Chowdhury & Xu (1995).",
    description: "The deterministic case of the same name with the strengths as independent normal variables; Monte Carlo on its circle, M-P.",
    definition: {"coordinates":[[-56.525,-14.993],[-56.525,4.579],[-35.51,4.58],[-30.96,1.23],[-28.19,-0.81],[-26.3,-0.81],[-21.533,-3.04],[-8.329,-9.14],[-7.13,-9.68],[5,-9.68],[5,-14.993]],"materials":[{"name":"Sand","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":0,"suRefDepth":0,"suRateOfChange":0}},{"name":"Clay 1","unitWeight":21,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":21,"undrainedShearStrength":55,"suRefDepth":0,"suRateOfChange":0}},{"name":"Clay 2","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":43,"suRefDepth":0,"suRateOfChange":0}},{"name":"Clay 3","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":22,"undrainedShearStrength":56,"suRefDepth":0,"suRateOfChange":0}},{"name":"Bed","unitWeight":22,"frictionAngle":0,"cohesion":0,"model":{"kind":"mohr-coulomb","unitWeight":22,"cohesion":200,"frictionAngle":35}}],"materialBoundaries":[{"coordinates":[[-57.525,1.229],[6,1.229]],"materialName":""},{"coordinates":[[-57.525,-3.041],[6,-3.041]],"materialName":""},{"coordinates":[[-57.525,-9.141],[6,-9.141]],"materialName":""},{"coordinates":[[-57.525,-12.19],[6,-12.19]],"materialName":""}],"regionAssignments":[{"point":[-55.90975,1.279],"materialName":"Sand"},{"point":[-55.90975,-0.906],"materialName":"Clay 1"},{"point":[-55.90975,-6.091],"materialName":"Clay 2"},{"point":[-55.90975,-10.6655],"materialName":"Clay 3"},{"point":[-55.90975,-13.5915],"materialName":"Bed"}],"orientation":"ltr","waterTable":{"mode":"custom","value":[[-56.525,2.43],[-32.59,2.43],[-30.96,1.23],[-28.19,-0.81],[-26.3,-0.81],[-21.533,-3.04],[-8.329,-9.14],[-7.13,-9.68],[5,-9.68]],"followBoundary":false},"customSearchPlanes":[{"cx":-22.188,"cy":20.908,"radius":30.049}],"customPlanesOnly":true},
    method: "Morgenstern-Price",
    options: {"slices":60},
    variables: [{"material":1,"field":"undrainedShearStrength","sd":20.4},{"material":2,"field":"undrainedShearStrength","sd":8.2},{"material":3,"field":"undrainedShearStrength","sd":13.2}],
    samples: 10000,
    seed: 1,
    checks: [
      ["pf-mc",0.2531,"Commercial program B",0.02],
    ],
    notes: [
      "commercial program B's Monte Carlo probability of failure (sample count not printed) against cSlope's 10 000 samples. Chowdhury & Xu 26.592 % (normal distribution of F).",
    ],
  },
  {
    id: "V022a",
    title: "Chowdhury & Xu (1995) example 5, probability of failure",
    reference: "Chowdhury & Xu (1995).",
    description: "The deterministic case of the same name with the strengths as independent normal variables; Monte Carlo on its circle, M-P.",
    definition: {"orientation":"rtl","materials":[{"name":"Layer 1","unitWeight":20,"frictionAngle":12,"cohesion":10,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":10,"frictionAngle":12}},{"name":"Layer 2","unitWeight":18,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":18,"undrainedShearStrength":40}},{"name":"Hard layer","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":20,"undrainedShearStrength":1000}}],"coordinates":[[0,0],[0,15],[30,15],[55,25],[60,25],[80,15],[90,15],[90,0]],"materialBoundaries":[{"coordinates":[[0,15],[90,15]],"materialName":""},{"coordinates":[[0,5],[90,5]],"materialName":""}],"regionAssignments":[{"point":[57.5,24.5],"materialName":"Layer 1"},{"point":[45,14.5],"materialName":"Layer 2"},{"point":[45,4.5],"materialName":"Hard layer"}],"customSearchPlanes":[{"cx":37.396,"cy":41.99,"radius":26.99}],"customPlanesOnly":true},
    method: "Morgenstern-Price",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":2},{"material":0,"field":"frictionAngle","sd":3},{"material":1,"field":"undrainedShearStrength","sd":8}],
    samples: 10000,
    seed: 1,
    checks: [
      ["pf-mc",0.2098,"Commercial program B",0.02],
    ],
    notes: [
      "commercial program B's Monte Carlo probability of failure (sample count not printed) against cSlope's 10 000 samples. Chowdhury & Xu 20.225 % (normal distribution of F).",
    ],
  },
  {
    id: "V022b",
    title: "Chowdhury & Xu (1995) example 5, probability of failure",
    reference: "Chowdhury & Xu (1995).",
    description: "The deterministic case of the same name with the strengths as independent normal variables; Monte Carlo on its circle, M-P.",
    definition: {"orientation":"rtl","materials":[{"name":"Layer 1","unitWeight":20,"frictionAngle":12,"cohesion":10,"model":{"kind":"mohr-coulomb","unitWeight":20,"cohesion":10,"frictionAngle":12}},{"name":"Layer 2","unitWeight":18,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":18,"undrainedShearStrength":40}},{"name":"Hard layer","unitWeight":20,"frictionAngle":0,"cohesion":0,"model":{"kind":"undrained","unitWeight":20,"undrainedShearStrength":1000}}],"coordinates":[[0,0],[0,15],[30,15],[55,25],[60,25],[80,15],[90,15],[90,0]],"materialBoundaries":[{"coordinates":[[0,15],[90,15]],"materialName":""},{"coordinates":[[0,5],[90,5]],"materialName":""}],"regionAssignments":[{"point":[57.5,24.5],"materialName":"Layer 1"},{"point":[45,14.5],"materialName":"Layer 2"},{"point":[45,4.5],"materialName":"Hard layer"}],"customSearchPlanes":[{"cx":40.313,"cy":28.685,"radius":23.685}],"customPlanesOnly":true},
    method: "Morgenstern-Price",
    options: {"slices":60},
    variables: [{"material":0,"field":"cohesion","sd":2},{"material":0,"field":"frictionAngle","sd":3},{"material":1,"field":"undrainedShearStrength","sd":8}],
    samples: 10000,
    seed: 1,
    checks: [
      ["pf-mc",0.2139,"Commercial program B",0.02],
    ],
    notes: [
      "commercial program B's Monte Carlo probability of failure (sample count not printed) against cSlope's 10 000 samples. Chowdhury & Xu 19.733 % (normal distribution of F).",
    ],
  },
];
