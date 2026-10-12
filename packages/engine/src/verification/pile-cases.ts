/**
 * Pile-reinforced verification problems (Slide2, SLOPE/W), transcribed
 * via the xslope corpus (github.com/njones61/xslope, docs/verification,
 * Apache-2.0) and checked against the Slide2 verification manual;
 * imperial inputs converted to SI. Generated data (gen_reinf.py): the
 * definitions are plain SlopeDefinitions, the checks are turned into
 * VerificationChecks in cases.ts.
 */
import type { ReinforcedCaseData } from "./reinforcement-cases";

export const PILE_CASES: ReinforcedCaseData[] = [
  {
    id: "VP49",
    title: "Soldier-pile tieback wall (SNAILZ)",
    reference: "Caltrans SNAILZ reference manual. Slide2 Verification Problem #49.",
    surface: "fixed",
    description: "Two-layer slope cut by a soldier-pile wall with two grouted tieback rows (8 ft spacing); the soldier pile is a shear force of 5900 lb/ft where the surface passes, as Slide models it; the manual's bilinear wedge from the wall toe. Converted to SI.",
    definition: { materials: [{ name: "Layer 1", unitWeight: 18.8505, frictionAngle: 24, cohesion: 28.72816, model: { kind: "mohr-coulomb", unitWeight: 18.8505, cohesion: 28.72816, frictionAngle: 24 } }, { name: "Layer 2", unitWeight: 20.42137, frictionAngle: 34, cohesion: 14.36408, model: { kind: "mohr-coulomb", unitWeight: 20.42137, cohesion: 14.36408, frictionAngle: 34 } }], coordinates: [[-6.096, -6.096], [-6.096, 0], [0, 0], [0, 9.144], [8.8392, 15.5448], [10.0584, 16.1544], [18.288, 20.1168], [24.0792, 21.6408], [54.2544, 24.384], [59.436, 24.384], [59.436, -6.096]], materialBoundaries: [{ coordinates: [[-6.096, 0], [0, 0], [0, 9.144], [8.8392, 15.5448], [59.436, 7.9248]], materialName: "" }], regionAssignments: [{ point: [58.91784, 23.884], materialName: "Layer 1" }, { point: [9.144, 3.048], materialName: "Layer 2" }], reinforcements: [{ x1: 0, y1: 6.096, x2: 9.66849, y2: 1.58751, tensileCapacity: 66.91507, spacing: 0.3048, end1Capacity: 0, end2Capacity: 0, direction: "axial", application: "active", pullout: { kind: "development", length1: 0, length2: 2.70277 } }, { x1: 0, y1: 2.4384, x2: 9.11601, y2: -1.81246, tensileCapacity: 91.30933, spacing: 0.3048, end1Capacity: 0, end2Capacity: 0, direction: "axial", application: "active", pullout: { kind: "development", length1: 0, length2: 3.68808 } }], piles: [{ x1: 0.1524, y1: 9.144, x2: 0.1524, y2: -2.1336, spacing: 0.3048, force: 26.2445, diameter: 0.1524, application: "active" }], customSurfaces: [{ points: [[0, 0], [11.2776, 10.24128], [18.5928, 20.44263]] }], customPlanesOnly: true },
    options: { porePressureHead: "vertical", slices: 60 },
    checks: [["Janbu", 1.479, "Slide2", 0.015], ["JanbuSimplified", 1.446, "Slide2", 0.015]],
    notes: ["Layer boundary from (29, 51) ft and ground vertex (79, 71) ft as labelled in Fig. 49.1 (the earlier transcription had (33, 53) and (70, 71)). SNAILZ 1.52.", "xslope 1.469 (Janbu corrected) and 1.439 (Spencer) on the earlier outline, where cSlope agreed to 0.1 %."],
  },
  {
    id: "VP54a",
    title: "Homogeneous slope, no micro piles",
    reference: "Yamagami et al. (2000). Slide2 Verification Problem #54.",
    surface: "fixed",
    description: "Homogeneous slope on the printed critical circle, unreinforced.",
    definition: { materials: [{ name: "Material 1", unitWeight: 15.68, frictionAngle: 10, cohesion: 4.9, model: { kind: "mohr-coulomb", unitWeight: 15.68, cohesion: 4.9, frictionAngle: 10 } }], coordinates: [[-6, -5], [-6, 0], [0, 0], [8, 4], [12, 4], [12, -5]], materialBoundaries: [], regionAssignments: [{ point: [10, 3.5], materialName: "Material 1" }], reinforcements: [], customSearchPlanes: [{ cx: 2.674, cy: 7.573, radius: 8.031 }], customPlanesOnly: true },
    options: { porePressureHead: "vertical", slices: 50 },
    checks: [["Bishop", 1.102, "Slide2", 0.01]],
    notes: ["Yamagami 1.10, SLOPE/W 1.102."],
  },
  {
    id: "VP54b",
    title: "Homogeneous slope with a micro-pile row",
    reference: "Yamagami et al. (2000). Slide2 Verification Problem #54.",
    surface: "fixed",
    description: "As VP54a with a micro-pile row (1 m spacing) whose shear strength of 10.7 kN acts as a passive force tangent to the slip surface, on Slide's with-pile circle (2.674, 7.376, R = 8.102).",
    definition: { materials: [{ name: "Material 1", unitWeight: 15.68, frictionAngle: 10, cohesion: 4.9, model: { kind: "mohr-coulomb", unitWeight: 15.68, cohesion: 4.9, frictionAngle: 10 } }], coordinates: [[-6, -5], [-6, 0], [0, 0], [8, 4], [12, 4], [12, -5]], materialBoundaries: [], regionAssignments: [{ point: [10, 3.5], materialName: "Material 1" }], piles: [{ x1: 9, y1: 4, x2: 9, y2: -2, spacing: 1, force: 10.7, direction: "tangent", application: "passive" }], reinforcements: [], customSearchPlanes: [{ cx: 2.674, cy: 7.376, radius: 8.102 }], customPlanesOnly: true },
    options: { porePressureHead: "vertical", slices: 50 },
    checks: [["Bishop", 1.193, "Slide2", 0.01]],
    notes: ["Yamagami 1.20, SLOPE/W 1.223; xslope 1.185 (Ito & Matsui force, active, on the no-pile circle).", "On this circle the 10.7 kN passive force gives 1.172 horizontal and 1.195 tilted 51.3° (the base inclination where the circle crosses the pile)."],
  },
  {
    id: "VP106b",
    title: "Cai & Ugai slope, pile row D1/D = 2",
    reference: "Cai & Ugai (2000), Géotechnique 50(2). Slide2 Verification Problem #106.",
    surface: "search",
    description: "A row of 0.8 m piles at mid-slope, centre-to-centre 1.6 m, with the Ito & Matsui force (passive); Bishop search.",
    definition: { materials: [{ name: "Soil", unitWeight: 20, frictionAngle: 20, cohesion: 10, model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 20 } }], coordinates: [[0, -10], [0, 0], [10, 0], [25, 10], [35, 10], [35, -10]], materialBoundaries: [], regionAssignments: [{ point: [30, 9.5], materialName: "Soil" }], piles: [{ x1: 17.5, y1: 5, x2: 17.5, y2: -10, spacing: 1.6, diameter: 0.8, application: "passive" }], reinforcements: [] },
    options: { porePressureHead: "vertical", slices: 40 },
    checks: [["Bishop", 1.54, "Slide2", 0.01]],
    notes: ["The critical circle passes through the pile head and carries no pile force; Cai & Ugai 1.54 on a surface through the pile."],
  },
  {
    id: "VP106c",
    title: "Cai & Ugai slope, pile row D1/D = 3",
    reference: "Cai & Ugai (2000), Géotechnique 50(2). Slide2 Verification Problem #106.",
    surface: "search",
    description: "As VP106b at 2.4 m spacing.",
    definition: { materials: [{ name: "Soil", unitWeight: 20, frictionAngle: 20, cohesion: 10, model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 20 } }], coordinates: [[0, -10], [0, 0], [10, 0], [25, 10], [35, 10], [35, -10]], materialBoundaries: [], regionAssignments: [{ point: [30, 9.5], materialName: "Soil" }], piles: [{ x1: 17.5, y1: 5, x2: 17.5, y2: -10, spacing: 2.4, diameter: 0.8, application: "passive" }], reinforcements: [] },
    options: { porePressureHead: "vertical", slices: 40 },
    checks: [["Bishop", 1.43, "Slide2", 0.015]],
    notes: ["xslope 1.451; Cai & Ugai 1.37."],
  },
  {
    id: "VP106d",
    title: "Cai & Ugai slope, pile row D1/D = 4",
    reference: "Cai & Ugai (2000), Géotechnique 50(2). Slide2 Verification Problem #106.",
    surface: "search",
    description: "As VP106b at 3.2 m spacing.",
    definition: { materials: [{ name: "Soil", unitWeight: 20, frictionAngle: 20, cohesion: 10, model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 20 } }], coordinates: [[0, -10], [0, 0], [10, 0], [25, 10], [35, 10], [35, -10]], materialBoundaries: [], regionAssignments: [{ point: [30, 9.5], materialName: "Soil" }], piles: [{ x1: 17.5, y1: 5, x2: 17.5, y2: -10, spacing: 3.2, diameter: 0.8, application: "passive" }], reinforcements: [] },
    options: { porePressureHead: "vertical", slices: 40 },
    checks: [["Bishop", 1.33, "Slide2", 0.01]],
    notes: ["Cai & Ugai 1.31."],
  },
  {
    id: "VP106e",
    title: "Cai & Ugai slope, pile row D1/D = 6",
    reference: "Cai & Ugai (2000), Géotechnique 50(2). Slide2 Verification Problem #106.",
    surface: "search",
    description: "As VP106b at 4.8 m spacing.",
    definition: { materials: [{ name: "Soil", unitWeight: 20, frictionAngle: 20, cohesion: 10, model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 20 } }], coordinates: [[0, -10], [0, 0], [10, 0], [25, 10], [35, 10], [35, -10]], materialBoundaries: [], regionAssignments: [{ point: [30, 9.5], materialName: "Soil" }], piles: [{ x1: 17.5, y1: 5, x2: 17.5, y2: -10, spacing: 4.8, diameter: 0.8, application: "passive" }], reinforcements: [] },
    options: { porePressureHead: "vertical", slices: 40 },
    checks: [["Bishop", 1.25, "Slide2", 0.01]],
    notes: ["Cai & Ugai 1.25."],
  },
];
