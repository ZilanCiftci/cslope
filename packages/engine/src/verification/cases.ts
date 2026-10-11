/**
 * Verification problems with published factors of safety.
 *
 * Problems from the Rocscience Slide2 verification manual ("VP<n>"), the
 * GEO-SLOPE SLOPE/W examples and the original references they cite. The
 * input data were transcribed via the open-source xslope project
 * (github.com/njones61/xslope, docs/verification) and the USGS Scoops3D
 * test inputs, because the manuals themselves could not be downloaded.
 * Check each problem against the manual before relying on it.
 *
 * Imperial problems without water are entered in their own units (FOS is
 * dimensionless); problems with water are converted to SI because the
 * engine uses γw = 9.81 kN/m³ (62.4 pcf = 9.80 kN/m³, < 0.1 % difference).
 *
 * Used by the verification tests and by the verification report.
 */
import { buildSlope } from "../model/build-slope";
import { analyseSlope } from "../model/solvers";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { Slope } from "../model/slope";
import type { SlopeDefinition } from "../types/slope-definition";
import type { MaterialModel } from "../types/material-models";
import type { AnalysisMethod, AnalysisOptions } from "../types/analysis";

export type Pt = [number, number];

export interface VerificationCheck {
  method: AnalysisMethod;
  /** Method as named by the source, e.g. "Spencer" (M-P, constant f(x)). */
  label: string;
  published: number;
  /** Who published the value, e.g. "Slide2", "SLOPE/W", "Duncan & Wright". */
  publishedBy: string;
  /** Accepted relative deviation, e.g. 0.01 = 1 %. */
  tolerance: number;
  options?: Partial<AnalysisOptions>;
  note?: string;
}

export interface VerificationCase {
  id: string;
  title: string;
  reference: string;
  /** Fixed (given) circle or critical-circle search. */
  surface: "fixed" | "search";
  units: "SI" | "imperial";
  description: string;
  definition: SlopeDefinition;
  checks: VerificationCheck[];
  notes?: string[];
}

export interface Layer {
  name: string;
  /** Elevation of the top of the layer (null for the top layer). */
  topY: number | null;
  model: MaterialModel;
}

// ── Helpers ──────────────────────────────────────────────────────────

export const mc = (c: number, phi: number, gamma: number): MaterialModel => ({
  kind: "mohr-coulomb",
  unitWeight: gamma,
  cohesion: c,
  frictionAngle: phi,
});

export const su = (
  s: number,
  gamma: number,
  refY = 0,
  rate = 0,
): MaterialModel => ({
  kind: "undrained",
  unitWeight: gamma,
  undrainedShearStrength: s,
  suRefDepth: refY,
  suRateOfChange: rate,
});

function groundY(g: Pt[], x: number): number {
  for (let i = 0; i < g.length - 1; i++) {
    const [a, ay] = g[i];
    const [b, by] = g[i + 1];
    if (x >= a && x <= b && b > a) return ay + ((x - a) / (b - a)) * (by - ay);
  }
  return -Infinity;
}

/** Slope from a ground line, a base elevation and horizontal layers. */
export function layered(
  ground: Pt[],
  baseY: number,
  layers: Layer[],
  extra: Partial<SlopeDefinition> = {},
): SlopeDefinition {
  const xs = ground.map((p) => p[0]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const regionAssignments = layers.map((layer, i) => {
    const bottom = i + 1 < layers.length ? layers[i + 1].topY! : baseY;
    const y = layer.topY === null ? bottom + 0.05 : (layer.topY + bottom) / 2;
    let x = x0;
    for (let k = 2; k <= 200; k++) {
      const xx = x0 + ((x1 - x0) * k) / 200;
      if (groundY(ground, xx) > y + 0.01) {
        x = xx;
        break;
      }
    }
    return { point: [x, y] as Pt, materialName: layer.name };
  });
  return {
    coordinates: [[x0, baseY], ...ground, [x1, baseY]],
    materials: layers.map((l) => ({
      name: l.name,
      unitWeight: l.model.unitWeight,
      frictionAngle: 0,
      cohesion: 0,
      model: l.model,
    })),
    materialBoundaries: layers.slice(1).map((l) => ({
      coordinates: [
        [x0 - 1, l.topY!],
        [x1 + 1, l.topY!],
      ] as Pt[],
      materialName: "",
    })),
    regionAssignments,
    ...extra,
  };
}

export const circle = (cx: number, cy: number, radius: number) => ({
  customSearchPlanes: [{ cx, cy, radius }],
  customPlanesOnly: true,
});

/** S = f(datum): Su = s at yRef, increasing by `rate` per unit depth. */
export const sfd = (s: number, yRef: number, rate: number, gamma: number): MaterialModel => ({
  kind: "s-f-datum",
  unitWeight: gamma,
  suRef: s,
  yRef,
  rate,
});

export const FT = 0.3048;
export const PSF = 0.04788026; // kPa
export const PCF = 0.15708746; // kN/m³
export const ft = (p: Pt[]): Pt[] => p.map(([x, y]) => [x * FT, y * FT]);

/** Search settings used for all verification runs. */
export const VERIFICATION_OPTIONS: Partial<AnalysisOptions> = {
  slices: 50,
  iterations: 4000,
  refinedIterations: 2000,
};

/** Run one check; returns the minimum FOS and the analysed slope. */
export function runVerification(
  definition: SlopeDefinition,
  method: AnalysisMethod,
  options: Partial<AnalysisOptions> = {},
): { fos: number | null; slope: Slope } {
  const slope = buildSlope(toCanonicalSlopeDefinition(definition));
  slope.updateAnalysisOptions({
    method,
    ...VERIFICATION_OPTIONS,
    ...options,
  });
  return { fos: analyseSlope(slope), slope };
}

const SPENCER = { intersliceFunction: "constant" as const };
const VERTICAL = { porePressureHead: "vertical" as const };
const PHREATIC = { porePressureHead: "phreatic-correction" as const };
/** ACADS 1(b): water-filled crack of depth 2c/(γ√Ka) = 3.814 m. */
const ACADS_CRACK = { tensionCrackDepth: 3.814, tensionCrackWater: 1 };

const bishop = (
  published: number,
  publishedBy: string,
  tolerance: number,
  extra: Partial<VerificationCheck> = {},
): VerificationCheck => ({
  method: "Bishop",
  label: "Bishop simplified",
  published,
  publishedBy,
  tolerance,
  ...extra,
});
const mp = (
  published: number,
  publishedBy: string,
  tolerance: number,
  extra: Partial<VerificationCheck> = {},
): VerificationCheck => ({
  method: "Morgenstern-Price",
  label: "Morgenstern-Price (half-sine)",
  published,
  publishedBy,
  tolerance,
  ...extra,
});
const spencer = (
  published: number,
  publishedBy: string,
  tolerance: number,
  extra: Partial<VerificationCheck> = {},
): VerificationCheck => ({
  method: "Morgenstern-Price",
  label: "Spencer (M-P, constant f(x))",
  published,
  publishedBy,
  tolerance,
  ...extra,
  options: { ...SPENCER, ...extra.options },
});

// ── Geometry shared by several problems ──────────────────────────────

/** Slope from an outline, material boundaries and one point per region. */
function regions(
  coordinates: Pt[],
  boundaries: Pt[][],
  mats: { name: string; model: MaterialModel; at: Pt[] }[],
  extra: Partial<SlopeDefinition> = {},
): SlopeDefinition {
  return {
    coordinates,
    materials: mats.map((m) => ({ name: m.name, unitWeight: m.model.unitWeight, frictionAngle: 0, cohesion: 0, model: m.model })),
    materialBoundaries: boundaries.map((b) => ({ coordinates: b, materialName: "" })),
    regionAssignments: mats.flatMap((m) => m.at.map((point) => ({ point, materialName: m.name }))),
    ...extra,
  };
}

/** With a saturated unit weight below the water line. */
const sat = (m: MaterialModel, gammaSat: number): MaterialModel => ({ ...m, unitWeightSat: gammaSat });

/**
 * Circle (cx, cy, r) cut off by a horizontal floor at yFloor: the arc
 * down to the floor, along it and back up, from x0 to x1.
 */
function compositeCircle(cx: number, cy: number, r: number, yFloor: number, x0: number, x1: number, n = 60): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = cy - Math.sqrt(Math.max(r * r - (x - cx) ** 2, 0));
    pts.push([x, Math.max(y, yFloor)]);
  }
  return pts;
}

// USACE EM 1110-2-1902 dam (Slide2 VP64–66), imperial coordinates.
const usaceTrench: Pt[] = [[-225, 0], [-17, 0], [-8, -10], [8, -10], [17, 0], [225, 0]];
const usaceLayers = (models: [MaterialModel, MaterialModel, MaterialModel, MaterialModel]) => [
  { name: "Embankment", model: models[0], at: ft([[0, 45]]) },
  { name: "Sand", model: models[1], at: ft([[-121, -5], [121, -5]]) },
  { name: "Foundation clay", model: models[2], at: ft([[0, -23.5]]) },
  { name: "Rock", model: models[3], at: ft([[0, -38.5]]) },
];

const vp21Ground: Pt[] = [
  [0, 60],
  [60, 60],
  [140, 20],
  [180, 20],
];

const vp80Layers: Layer[] = [
  { name: "Embankment", topY: null, model: mc(1, 35, 120) },
  { name: "L60", topY: 60, model: mc(950, 0, 110) },
  { name: "L45", topY: 45, model: mc(1, 32, 122) },
  { name: "L35", topY: 35, model: mc(500, 0, 98) },
  { name: "L25", topY: 25, model: mc(1, 37, 131) },
  { name: "L20", topY: 20, model: mc(600, 0, 103) },
];
const vp80Ground: Pt[] = [
  [0, 60],
  [80, 60],
  [205, 110],
  [330, 110],
];

const vp28Layers: Layer[] = [
  { name: "Fill", topY: null, model: mc(10, 12, 20) },
  { name: "Clay", topY: 15, model: mc(40, 0, 18) },
  { name: "Rock", topY: 5, model: { kind: "impenetrable", unitWeight: 22 } },
];
const vp28Ground: Pt[] = [
  [0, 15],
  [30, 15],
  [55, 25],
  [60, 25],
  [80, 15],
  [90, 15],
];

/** Clarence Cannon Dam (Hassan & Wolff 1999), circle = centre + radius. */
const cannon = (cx: number, cy: number, r: number): SlopeDefinition => ({
  orientation: "ltr",
  coordinates: [
    [0.937, 121.205], [0.937, 156.598], [40.517, 156.598], [66.125, 165.456], [101.028, 177.529],
    [158.875, 182.857], [210.633, 198.842], [219.767, 198.842], [258.205, 185.141], [306.537, 175.627],
    [320.999, 174.865], [349.162, 166.112], [423.373, 166.112], [423.373, 120.824],
  ],
  materials: [
    { name: "Phase II fill", unitWeight: 22, frictionAngle: 0, cohesion: 0, model: mc(143.64, 15, 22) },
    { name: "Phase I fill", unitWeight: 22, frictionAngle: 0, cohesion: 0, model: mc(117.79, 8.5, 22) },
    { name: "Sand filter", unitWeight: 22, frictionAngle: 0, cohesion: 0, model: mc(0, 35, 22) },
    { name: "Spoil fill", unitWeight: 25, frictionAngle: 0, cohesion: 0, model: mc(5, 35, 25) },
    { name: "Foundation sand", unitWeight: 20, frictionAngle: 0, cohesion: 0, model: mc(5, 18, 20) },
    { name: "Limestone", unitWeight: 20, frictionAngle: 0, cohesion: 0, model: mc(100, 35, 20) },
  ],
  materialBoundaries: [
    { coordinates: [[0, 139.853], [425, 139.853]], materialName: "" },
    { coordinates: [[40.517, 156.598], [174.098, 156.598], [204.163, 139.853]], materialName: "" },
    { coordinates: [[225.856, 139.853], [255.921, 155.837], [379.607, 155.837], [425, 155.837]], materialName: "" },
    { coordinates: [[349.162, 166.112], [357.596, 163.266], [379.607, 155.837]], materialName: "" },
    { coordinates: [[66.125, 165.456], [218.625, 165.456], [357.596, 163.266]], materialName: "" },
    { coordinates: [[215.2, 165.456], [215.2, 193.894], [218.244, 193.894], [218.625, 165.456]], materialName: "" },
  ],
  regionAssignments: [
    { point: [150, 175], materialName: "Phase II fill" },
    { point: [200, 160], materialName: "Phase I fill" },
    { point: [216.7, 180], materialName: "Sand filter" },
    { point: [400, 162], materialName: "Spoil fill" },
    { point: [100, 150], materialName: "Foundation sand" },
    { point: [320, 150], materialName: "Foundation sand" },
    { point: [200, 130], materialName: "Limestone" },
  ],
  ...circle(cx, cy, r),
});

// [surface, xc, yc, tangent elevation, SLOPE/W M-P, Slide Bishop (null = not used)]
const CANNON_SURFACES = [
  ["7A", 320.175, 313.336, 145.347, 2.56, 2.551],
  ["7B", 295.235, 277.589, 156.298, 2.806, 2.82],
  ["7C", 303.683, 310.206, 155.928, 2.771, 2.777],
  ["7D", 322.152, 310.206, 145.36, 2.589, 2.583],
  ["7E", 327.693, 324.018, 147.163, 2.703, 2.692],
  ["8B", 304.239, 307.858, 155.311, 2.673, 2.672],
  ["8F", 313.114, 304.784, 160.368, 3.586, 3.598],
  ["8G", 314.856, 305.604, 165.756, 6.069, 6.074],
  ["8H", 316.198, 305.604, 170.537, 11.583, null],
] as const;

// ── The problems ─────────────────────────────────────────────────────

/** Baker & Leshchinsky (2001) clay-core dam (VP42). */
function vp42(extra: Partial<SlopeDefinition>): SlopeDefinition {
  const material = (name: string, model: MaterialModel) => ({
    name,
    unitWeight: model.unitWeight,
    frictionAngle: 0,
    cohesion: 0,
    model,
  });
  return {
    coordinates: [[0, -10], [0, 0], [110, 54], [130, 54], [265, 0], [265, -10]],
    materials: [
      material("Granular fill", mc(0, 40, 21.5)),
      material("Clay core", mc(20, 20, 20)),
      material("Granular fill below core", mc(0, 40, 21.5)),
      material("Hard base", mc(200, 45, 24)),
    ],
    materialBoundaries: [
      { coordinates: [[0, 0], [265, 0]], materialName: "" },
      { coordinates: [[88, 16], [110, 49], [130, 49], [152, 18], [88, 16]], materialName: "" },
      { coordinates: [[88, 16], [110, 0]], materialName: "" },
      { coordinates: [[152, 18], [130, 0]], materialName: "" },
    ],
    regionAssignments: [
      { point: [100, -5], materialName: "Hard base" },
      { point: [120, 30], materialName: "Clay core" },
      { point: [120, 8], materialName: "Granular fill below core" },
      { point: [50, 10], materialName: "Granular fill" },
    ],
    // The reservoir on the right face stands above the ground: free water.
    waterTable: {
      mode: "custom",
      value: [[0, 0], [15.82035, 2.035683], [86.71558, 6.05312], [88, 16], [110, 22.3], [130, 25.8], [145, 30], [265, 30]],
      followBoundary: false,
    },
    orientation: "ltr",
    ...extra,
  };
}

export const VERIFICATION_CASES: VerificationCase[] = [
  {
    id: "VP21a",
    title: "Fredlund & Krahn (1977), dry",
    reference: "Fredlund, D.G. & Krahn, J. (1977). Comparison of slope stability methods of analysis. Can. Geotech. J. 14(3). Slide2 Verification Problem #21.",
    surface: "fixed",
    units: "imperial",
    description: "Homogeneous 2:1 slope, 40 ft high, on a firm base; the classic comparison problem of Fredlund & Krahn analysed with the published circle and no pore pressure.",
    definition: layered(vp21Ground, 0, [{ name: "Soil", topY: null, model: mc(600, 20, 120) }], circle(120, 90, 80)),
    checks: [bishop(2.08, "Fredlund & Krahn", 0.005), mp(2.076, "Fredlund & Krahn", 0.005)],
  },
  {
    id: "VP21b",
    title: "Fredlund & Krahn (1977), with water table",
    reference: "Fredlund, D.G. & Krahn, J. (1977). Can. Geotech. J. 14(3). Slide2 Verification Problem #21.",
    surface: "fixed",
    units: "SI",
    description: "The Fredlund & Krahn slope with a piezometric line, analysed on the published circle. Converted to SI.",
    definition: layered(ft(vp21Ground), 0, [{ name: "Soil", topY: null, model: mc(600 * PSF, 20, 120 * PCF) }], {
      ...circle(120 * FT, 90 * FT, 80 * FT),
      waterTable: { mode: "custom", value: ft([[0, 40], [140, 20], [180, 20]]) },
    }),
    checks: [bishop(1.834, "Fredlund & Krahn", 0.005), mp(1.832, "Fredlund & Krahn", 0.005)],
  },
  {
    id: "VP67",
    title: "USACE EM 1110-2-1902, example F-5",
    reference: "US Army Corps of Engineers (2003). Slope Stability, EM 1110-2-1902, Appendix F. Slide2 Verification Problem #67.",
    surface: "fixed",
    units: "imperial",
    description: "Embankment (c = 1780 psf, φ = 5°) on a foundation (c = 1600 psf, φ = 2°), analysed with the circle given in the Corps of Engineers example.",
    definition: layered(
      [[-100, 100], [0, 100], [174, 158], [257, 191], [301, 191], [400, 150]],
      0,
      [
        { name: "Embankment", topY: null, model: mc(1780, 5, 135) },
        { name: "Foundation", topY: 100, model: mc(1600, 2, 127) },
      ],
      circle(101, 359, 278),
    ),
    checks: [bishop(1.332, "USACE", 0.015)],
  },
  {
    id: "VP80a",
    title: "Duncan & Wright fig. 14.5, R = 87 ft",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 14.5. Slide2 Verification Problem #80.",
    surface: "fixed",
    units: "imperial",
    description: "Embankment over alternating cohesive and frictional layers; circle of radius 87 ft.",
    definition: layered(vp80Ground, 0, vp80Layers, circle(142, 147, 87)),
    checks: [bishop(2.549, "Duncan & Wright", 0.01)],
  },
  {
    id: "VP80b",
    title: "Duncan & Wright fig. 14.5, R = 102 ft",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 14.5. Slide2 Verification Problem #80.",
    surface: "fixed",
    units: "imperial",
    description: "As VP80a with a deeper circle of radius 102 ft, reaching the weak clay layers.",
    definition: layered(vp80Ground, 0, vp80Layers, circle(142, 147, 102)),
    checks: [bishop(1.398, "Duncan & Wright", 0.01)],
  },
  {
    id: "VP28a",
    title: "Chowdhury & Xu (1995) example 5, circle 1",
    reference: "Chowdhury & Xu (1995), example 5. Slide2 Verification Problem #28.",
    surface: "fixed",
    units: "SI",
    description: "Ridge of fill over clay on impenetrable rock; the published surfaces slide down the left face (right-to-left model).",
    definition: layered(vp28Ground, 0, vp28Layers, { ...circle(37.369, 42.429, 27.429), orientation: "rtl" }),
    checks: [bishop(1.16, "Chowdhury & Xu", 0.01)],
  },
  {
    id: "VP28b",
    title: "Chowdhury & Xu (1995) example 5, circle 2",
    reference: "Chowdhury & Xu (1995), example 5. Slide2 Verification Problem #28.",
    surface: "fixed",
    units: "SI",
    description: "As VP28a with the second published circle.",
    definition: layered(vp28Ground, 0, vp28Layers, { ...circle(40.256, 29.437, 24.437), orientation: "rtl" }),
    checks: [bishop(1.185, "Chowdhury & Xu", 0.01)],
  },
  {
    id: "EC7",
    title: "Eurocode 7 cutting with surcharge",
    reference: "GEO-SLOPE International, SLOPE/W example: Eurocode 7 cutting.",
    surface: "fixed",
    units: "SI",
    description: "Cutting in clay with an inclined piezometric line and a 35 kPa surcharge on the crest, analysed on the published circle.",
    definition: layered([[0, 5], [30, 5], [50, 15], [80, 15]], 0, [{ name: "Clay", topY: null, model: mc(8, 23.04, 20) }], {
      ...circle(35.4, 25.467, 22.099),
      waterTable: { mode: "custom", value: [[0, 5], [30, 5], [45.5, 9], [70, 12], [80, 12]] },
      udls: [{ magnitude: 35, x1: 52, x2: 62 }],
    }),
    checks: [
      bishop(1.173, "SLOPE/W", 0.02, {
        label: "Bishop simplified (phreatic correction)",
        note: "Pore pressure from head × cos²θ; SLOPE/W uses the vertical head.",
        options: PHREATIC,
      }),
      bishop(1.173, "SLOPE/W", 0.005, {
        label: "Bishop simplified (vertical head)",
        options: VERTICAL,
      }),
    ],
  },
  {
    id: "EC7-PF",
    title: "Eurocode 7 cutting, partial factors applied by cSlope",
    reference: "GEO-SLOPE International, SLOPE/W example: Eurocode 7 cutting (Overdesign Factor).",
    surface: "fixed",
    units: "SI",
    description: "As EC7, but with the characteristic strength c' = 10 kPa, φ' = 28° and Design Approach 3 material factors (set M2: γc' = γφ' = 1.25) applied by the analysis; the surcharge is permanent (factor 1.0). The FOS is the over-design factor on design values.",
    definition: layered([[0, 5], [30, 5], [50, 15], [80, 15]], 0, [{ name: "Clay", topY: null, model: mc(10, 28, 20) }], {
      ...circle(35.4, 25.467, 22.099),
      waterTable: { mode: "custom", value: [[0, 5], [30, 5], [45.5, 9], [70, 12], [80, 12]] },
      udls: [{ magnitude: 35, x1: 52, x2: 62 }],
    }),
    checks: [
      bishop(1.173, "SLOPE/W", 0.005, {
        label: "Bishop simplified, design values",
        options: { partialFactors: { cu: 1.4, cohesion: 1.25, tanPhi: 1.25, variableLoad: 1 } },
      }),
      spencer(1.174, "SLOPE/W", 0.005, {
        label: "Spencer, design values",
        options: { partialFactors: { cu: 1.4, cohesion: 1.25, tanPhi: 1.25, variableLoad: 1 } },
      }),
    ],
  },
  {
    id: "VP15",
    title: "Arai & Tagyo (1985) example 2, three layers",
    reference: "Arai & Tagyo (1985), example 2. Slide2 Verification Problem #15.",
    surface: "search",
    units: "SI",
    description: "Slope with a weak middle layer between a stronger upper layer and a very strong base; critical circle search.",
    definition: {
      coordinates: [[0, 0], [0, 15], [18, 15], [48, 35], [96, 35], [96, 0]],
      materials: [
        { name: "Upper", unitWeight: 18.82, frictionAngle: 0, cohesion: 0, model: mc(29.4, 12, 18.82) },
        { name: "Middle", unitWeight: 18.82, frictionAngle: 0, cohesion: 0, model: mc(9.8, 5, 18.82) },
        { name: "Lower", unitWeight: 18.82, frictionAngle: 0, cohesion: 0, model: mc(294, 40, 18.82) },
      ],
      materialBoundaries: [
        { coordinates: [[24, 19], [72, 35]], materialName: "" },
        { coordinates: [[0, 3], [96, 35]], materialName: "" },
      ],
      regionAssignments: [
        { point: [60, 34], materialName: "Upper" },
        { point: [60, 25], materialName: "Middle" },
        { point: [60, 5], materialName: "Lower" },
      ],
    },
    checks: [bishop(0.42, "Slide2", 0.01)],
  },
  {
    id: "VP17",
    title: "Yamagami & Ueta (1988)",
    reference: "Yamagami & Ueta (1988). Slide2 Verification Problem #17.",
    surface: "search",
    units: "SI",
    description: "Homogeneous 2:1 slope, 5 m high; critical circle search.",
    definition: layered([[0, 5], [5, 5], [15, 10], [25, 10]], 0, [{ name: "Soil", topY: null, model: mc(9.8, 10, 17.64) }]),
    checks: [bishop(1.344, "Slide2", 0.01)],
  },
  ...([
    [0, 0.761],
    [5, 0.909],
    [10, 1.045],
    [15, 1.154],
  ] as const).map(([cz, published], i): VerificationCase => ({
    id: `VP84${"abcd"[i]}`,
    title: `Duncan & Wright fig. 15.9, Su increasing ${cz} psf/ft`,
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 15.9. Slide2 Verification Problem #84.",
    surface: "search",
    units: "imperial",
    description:
      cz === 0
        ? "Granular fill on soft clay with a constant undrained strength of 300 psf; critical circle search."
        : `Granular fill on soft clay whose undrained strength is 300 psf at the clay surface and increases by ${cz} psf per foot of depth; critical circle search.`,
    definition: layered([[0, 20], [40, 20], [90, 40], [140, 40]], 0, [
      { name: "Fill", topY: null, model: mc(0, 35, 125) },
      { name: "Clay", topY: 20, model: su(300, 100, 20, cz) },
    ]),
    checks: [bishop(published, "Duncan & Wright", 0.01)],
  })),
  {
    id: "VP83a",
    title: "Duncan & Wright fig. 14.20b, Su = 200 + 15·depth",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 14.20b. Slide2 Verification Problem #83.",
    surface: "search",
    units: "imperial",
    description: "Granular fill over clay with undrained strength increasing linearly with depth; critical circle search.",
    definition: layered([[0, 40], [55, 40], [75, 30], [140, 30]], 0, [
      { name: "Fill", topY: null, model: mc(0, 36, 123) },
      { name: "Clay", topY: 30, model: su(200, 97, 30, 15) },
    ]),
    checks: [bishop(1.313, "Duncan & Wright", 0.01)],
  },
  {
    id: "VP83b",
    title: "Duncan & Wright fig. 14.20b, Su = 300 psf",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 14.20b. Slide2 Verification Problem #83.",
    surface: "search",
    units: "imperial",
    description: "As VP83a with a constant undrained strength of 300 psf.",
    definition: layered([[0, 40], [55, 40], [75, 30], [140, 30]], 0, [
      { name: "Fill", topY: null, model: mc(0, 36, 123) },
      { name: "Clay", topY: 30, model: su(300, 97) },
    ]),
    checks: [bishop(1.335, "Duncan & Wright", 0.01)],
  },
  {
    id: "VP82",
    title: "Duncan & Wright fig. 14.20a, water table",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 14.20a. Slide2 Verification Problem #82.",
    surface: "search",
    units: "SI",
    description: "Cohesive-frictional fill over sand with a piezometric line; critical circle search. Converted to SI.",
    definition: layered(
      ft([[0, 60], [60, 60], [140, 20], [200, 20]]),
      0,
      [
        { name: "Fill", topY: null, model: mc(600 * PSF, 25, 125 * PCF) },
        { name: "Sand", topY: 20 * FT, model: mc(0, 30, 132 * PCF) },
      ],
      { waterTable: { mode: "custom", value: ft([[0, 40], [100, 30], [140, 20], [200, 20]]) } },
    ),
    checks: [bishop(1.533, "Duncan & Wright", 0.01)],
  },
  {
    id: "VP78",
    title: "Duncan & Wright fig. 14.3, undrained clay",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 14.3. Slide2 Verification Problem #78.",
    surface: "search",
    units: "imperial",
    description: "Homogeneous undrained clay slope (φ = 0); critical circle search.",
    definition: layered([[0, 30], [90, 30], [130, 80], [240, 80]], 0, [{ name: "Clay", topY: null, model: mc(1000, 0, 100) }]),
    checks: [bishop(1.126, "Duncan & Wright", 0.01)],
  },
  {
    id: "VP79",
    title: "Duncan & Wright fig. 14.4",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 14.4. Slide2 Verification Problem #79.",
    surface: "search",
    units: "imperial",
    description: "Cohesionless fill on undrained clay; critical circle search.",
    definition: layered([[0, 20], [40, 20], [78, 35], [130, 35]], 0, [
      { name: "Fill", topY: null, model: mc(0, 30, 120) },
      { name: "Clay", topY: 20, model: mc(450, 0, 120) },
    ]),
    checks: [bishop(1.412, "Duncan & Wright", 0.01)],
  },
  {
    id: "VP74",
    title: "Duncan & Wright fig. 7.12, embankment on clay",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 7.12. Slide2 Verification Problem #74.",
    surface: "search",
    units: "imperial",
    description: "Sand embankment on a thick undrained clay foundation; critical circle search.",
    definition: layered(
      [[0, 50], [100, 50], [300, 150], [400, 150], [600, 50], [700, 50]],
      0,
      [
        { name: "Sand", topY: null, model: mc(0, 40, 140) },
        { name: "Clay", topY: 50, model: mc(2500, 0, 140) },
      ],
    ),
    checks: [bishop(1.228, "Duncan & Wright", 0.01)],
  },
  {
    id: "VP24",
    title: "Low (1989), layered undrained clay",
    reference: "Low (1989). Slide2 Verification Problem #24.",
    surface: "search",
    units: "SI",
    description: "Embankment on three undrained clay layers of different strength; critical circle search.",
    definition: layered([[0, 13.5], [20, 13.5], [33.5, 9], [38, 7.5], [60, 7.5]], 0, [
      { name: "A", topY: null, model: su(30, 18) },
      { name: "B", topY: 9, model: su(20, 18) },
      { name: "C", topY: 4.5, model: su(150, 18) },
    ]),
    checks: [bishop(1.439, "Slide2", 0.015)],
  },
  ...CANNON_SURFACES.map(([lab, xc, yc, yt, mpFos, bishopFos]): VerificationCase => ({
    id: `CD-${lab}`,
    title: `Clarence Cannon Dam, surface ${lab}`,
    reference: "Hassan & Wolff (1999). SLOPE/W verification example 2.22; Slide2 Verification Problem #35.",
    surface: "fixed",
    units: "SI",
    description: `Six-zone embankment dam on sand over limestone, analysed on the published circle ${lab} (centre ${xc}, ${yc}; tangent elevation ${yt}).`,
    definition: cannon(xc, yc, yc - yt),
    checks: [
      mp(mpFos, "SLOPE/W", 0.005),
      ...(bishopFos ? [bishop(bishopFos, "Slide2", 0.005)] : []),
    ],
    notes:
      bishopFos === null
        ? ["Slide2's Bishop value for 8H (11.23) disagrees with SLOPE/W (11.583) and two other codes and is not used."]
        : undefined,
  })),
  {
    id: "VP37",
    title: "XSTABL reinforcement example, unreinforced",
    reference: "XSTABL example (Sharma, 1996). Slide2 Verification Problem #37.",
    surface: "fixed",
    units: "SI",
    description: "45° cohesionless sand slope with a 40 kPa surcharge behind the crest, on the published toe circle.",
    definition: layered([[0, 5], [5, 5], [17, 17], [40, 17]], 0, [{ name: "Sand", topY: null, model: mc(0, 36, 20) }], {
      ...circle(-11.41, 35.264, 34.426),
      udls: [{ magnitude: 40, x1: 17, x2: 30 }],
    }),
    checks: [bishop(0.764, "Slide2", 0.01), spencer(0.764, "Slide2", 0.01)],
  },
  {
    id: "VP54",
    title: "Yamagami micro-pile slope, no pile",
    reference: "Yamagami micro-pile slope example. Slide2 Verification Problem #54.",
    surface: "fixed",
    units: "SI",
    description: "Homogeneous 2:1 slope, 4 m high, without piles, on the published circle.",
    definition: layered([[-6, 0], [0, 0], [8, 4], [12, 4]], -5, [{ name: "Soil", topY: null, model: mc(4.9, 10, 15.68) }], circle(2.674, 7.573, 8.031)),
    checks: [bishop(1.102, "Slide2", 0.01)],
  },
  {
    id: "VP14",
    title: "Arai & Tagyo (1985) example 1",
    reference: "Arai & Tagyo (1985), example 1. Slide2 Verification Problem #14; SLOPE/W example 2.11.",
    surface: "search",
    units: "SI",
    description: "Homogeneous 1.5:1 slope, 20 m high; critical circle search.",
    definition: layered([[-30, 15], [18, 15], [48, 35], [100, 35]], 0, [{ name: "Soil", topY: null, model: mc(41.65, 15, 18.82) }]),
    checks: [bishop(1.417, "Slide2", 0.01), mp(1.414, "Slide2", 0.01)],
  },
  {
    id: "VP44",
    title: "Baker (2003) example 1, Mohr-Coulomb fit",
    reference: "Baker (2003), example 1. Slide2 Verification Problem #44.",
    surface: "search",
    units: "SI",
    description: "6 m high slope at about 43° in soil with a linear Mohr-Coulomb fit to a curved envelope; critical circle search.",
    definition: layered([[-6, 0], [0, 0], [6.43, 6], [20, 6]], -4, [{ name: "Soil", topY: null, model: mc(11.64, 24.7, 18) }]),
    checks: [spencer(1.536, "Slide2", 0.015)],
  },
  {
    id: "VP45",
    title: "4:1 slope, Mohr-Coulomb fit",
    reference: "Slide2 Verification Problem #45.",
    surface: "search",
    units: "SI",
    description: "12 m high 4:1 slope with the same soil as VP44; critical circle search.",
    definition: layered([[0, 0], [48, 12], [100, 12]], 0, [{ name: "Soil", topY: null, model: mc(11.64, 24.7, 18) }]),
    checks: [
      spencer(2.794, "Slide2", 0.015),
      {
        method: "Janbu",
        label: "Janbu simplified (uncorrected)",
        published: 2.662,
        publishedBy: "Slide2",
        tolerance: 0.015,
      },
    ],
  },
  {
    id: "VP71",
    title: "Duncan & Wright fig. 6.38, piezometric line",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 6.38. Slide2 Verification Problem #71.",
    surface: "search",
    units: "SI",
    description: "Homogeneous 2:1 slope with a nearly flat piezometric line; critical circle search. Converted to SI; the water line was traced from a figure.",
    definition: layered(ft([[0, 40], [120, 40], [200, 80], [440, 80]]), 0, [{ name: "Soil", topY: null, model: mc(200 * PSF, 20, 125 * PCF) }], {
      waterTable: {
        mode: "custom",
        value: ft([[0, 40], [120, 40], [127.4, 43.2], [147.4, 46.2], [181.7, 50.7], [232.3, 56.7], [326.8, 65.7], [440, 75]]),
      },
    }),
    checks: [bishop(1.142, "Slide2", 0.01), spencer(1.142, "Slide2", 0.01)],
  },
  {
    id: "VP81",
    title: "Duncan & Wright fig. 14.7, deep circle",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 14.7. Slide2 Verification Problem #81.",
    surface: "search",
    units: "imperial",
    description: "Cohesionless embankment on an undrained clay foundation. Entry is limited to the crest and exit to the toe flat to find the published deep circle.",
    definition: layered([[0, 15], [35, 15], [73, 34], [128, 34]], 0, [
      { name: "Embankment", topY: null, model: mc(0, 30, 124) },
      { name: "Foundation", topY: 15, model: mc(500, 0, 98) },
    ], { analysisLimits: { entryLeftX: 128, entryRightX: 74, exitLeftX: 34, exitRightX: 0 } }),
    checks: [bishop(1.23, "Slide2", 0.01), spencer(1.209, "Duncan & Wright", 0.01)],
    notes: ["An unrestricted search finds the infinite-slope sliver in the c = 0 fill (tan 30° / tan 26.6° = 1.155), which is correct mechanics but not the published surface."],
  },
  {
    id: "VP106",
    title: "Cai & Ugai (2000) slope, no pile",
    reference: "Cai & Ugai (2000). Slide2 Verification Problem #106.",
    surface: "search",
    units: "SI",
    description: "Homogeneous 1:1.5 slope, 10 m high, without piles; critical circle search.",
    definition: layered([[0, 0], [10, 0], [25, 10], [35, 10]], -10, [{ name: "Soil", topY: null, model: mc(10, 20, 20) }]),
    checks: [bishop(1.14, "Cai & Ugai", 0.015)],
  },
  {
    id: "VP55",
    title: "Pockoski & Duncan (2000) slope 1",
    reference: "Pockoski & Duncan (2000), slope 1. Slide2 Verification Problem #55.",
    surface: "fixed",
    units: "SI",
    description: "2:1 slope with a water table, on the circle published by Slide2; pore pressure from the vertical head below the piezometric line. Converted to SI.",
    definition: layered(ft([[-75, 100], [0, 100], [100, 150], [170, 150]]), 75 * FT, [{ name: "Sandy clay", topY: null, model: mc(300 * PSF, 30, 120 * PCF) }], {
      ...circle(24.103 * FT, 195.256 * FT, 100.266 * FT),
      waterTable: { mode: "custom", value: ft([[-75, 100], [0, 100], [100, 140], [170, 140]]) },
    }),
    checks: [
      bishop(1.293, "Slide2", 0.01, { options: VERTICAL, label: "Bishop simplified (vertical head)" }),
      spencer(1.3, "Slide2", 0.01, { options: VERTICAL, label: "Spencer (vertical head)" }),
    ],
    notes: ["With the phreatic correction (cos²θ) cSlope gives 1.381 (+6.8 %)."],
  },
  {
    id: "VP100",
    title: "Morgenstern (1963) complete drawdown, 3:1",
    reference: "Morgenstern, N. (1963). Stability charts for earth slopes during rapid drawdown. Géotechnique 13(2). Slide2 Verification Problem #100.",
    surface: "search",
    units: "SI",
    description: "3:1 slope after complete drawdown: piezometric line on the slope face, base at the toe (D = 1). Pore pressure from the vertical head. Converted to SI.",
    definition: (() => {
      const face = ft([[0, 0], [300, 100], [373, 100]]);
      return {
        coordinates: [...face, [373 * FT, 0]],
        materials: [{ name: "Soil", unitWeight: 124.8 * PCF, frictionAngle: 0, cohesion: 0, model: mc(312 * PSF, 30, 124.8 * PCF) }],
        regionAssignments: [{ point: [300 * FT, 50 * FT], materialName: "Soil" }],
        waterTable: { mode: "custom", value: face },
      } satisfies SlopeDefinition;
    })(),
    checks: [
      bishop(1.2, "Morgenstern (chart)", 0.01, { options: VERTICAL, label: "Bishop simplified (vertical head)" }),
      spencer(1.2, "Morgenstern (chart)", 0.01, { options: VERTICAL, label: "Spencer (vertical head)" }),
    ],
    notes: ["Slide2 reports 1.212 (Bishop). With the phreatic correction (cos²θ) cSlope gives 1.303."],
  },
  {
    id: "VP20",
    title: "Greco (1996) example 5 / Chen & Shao (1988)",
    reference: "Greco (1996), example 5; Chen & Shao (1988). Slide2 Verification Problem #20.",
    surface: "search",
    units: "SI",
    description: "Four layers including a weak seam, with a water table; critical circle search, vertical pore-pressure head.",
    definition: {
      coordinates: [[0, 0], [0, 20], [55, 20], [75, 30], [95, 40], [100, 40], [145, 70], [240, 70], [240, 16], [150, 15]],
      materials: [
        { name: "Layer 1", unitWeight: 20, frictionAngle: 0, cohesion: 0, model: mc(9.8, 35, 20) },
        { name: "Layer 2", unitWeight: 19, frictionAngle: 0, cohesion: 0, model: mc(58.8, 25, 19) },
        { name: "Layer 3", unitWeight: 21.5, frictionAngle: 0, cohesion: 0, model: mc(19.8, 30, 21.5) },
        { name: "Seam", unitWeight: 21.5, frictionAngle: 0, cohesion: 0, model: mc(9.8, 16, 21.5) },
      ],
      materialBoundaries: [
        { coordinates: [[100, 40], [190, 55], [241, 55]], materialName: "" },
        { coordinates: [[75, 30], [241, 30]], materialName: "" },
        { coordinates: [[-1, 0.4], [150, 15.5], [241, 16.51]], materialName: "" },
      ],
      regionAssignments: [
        { point: [200, 62], materialName: "Layer 1" },
        { point: [200, 45], materialName: "Layer 2" },
        { point: [100, 20], materialName: "Layer 3" },
        { point: [100, 10.25], materialName: "Seam" },
      ],
      waterTable: { mode: "custom", value: [[0, 20], [55, 20], [75, 30], [95, 40], [100, 40], [190, 55], [240, 55]] },
    },
    checks: [
      bishop(1.087, "Slide2", 0.01, { options: VERTICAL, label: "Bishop simplified (vertical head)" }),
      spencer(1.093, "Slide2", 0.01, { options: VERTICAL, label: "Spencer (vertical head)" }),
    ],
    notes: ["With the phreatic correction (cos²θ) cSlope gives 1.141 (Bishop)."],
  },
  {
    id: "VP2",
    title: "ACADS 1(b), water-filled tension crack",
    reference: "Giam & Donald (1989), ACADS problem 1(b). Slide2 Verification Problem #2; SLOPE/W example 2.2.",
    surface: "search",
    units: "SI",
    description: "The ACADS 1(a) slope (10 m high, 2:1) with c' = 32 kPa, φ' = 10° and a tension crack 3.814 m deep (2c/(γ√Ka)), filled with water; critical circle search.",
    definition: layered([[0, 25], [30, 25], [50, 35], [90, 35]], 20, [{ name: "Soil", topY: null, model: mc(32, 10, 20) }], {
      orientation: "rtl",
    }),
    checks: [
      bishop(1.596, "Slide2", 0.01, { options: ACADS_CRACK }),
      spencer(1.592, "Slide2", 0.01, { options: ACADS_CRACK }),
      {
        method: "Janbu",
        label: "Janbu corrected (f0)",
        published: 1.489,
        publishedBy: "Slide2",
        tolerance: 0.01,
        options: { ...ACADS_CRACK, janbuCorrection: true },
      },
    ],
    notes: ["SLOPE/W reports 1.664 (Bishop) and the ACADS reference band is 1.65–1.70; Slide2 and xslope (1.589) agree with each other."],
  },
  {
    id: "VP8",
    title: "ACADS 3(b), weak layer, specified non-circular surface",
    reference: "Giam & Donald (1989), ACADS problem 3(b). Slide2 Verification Problem #8; SLOPE/W example 2.8.",
    surface: "fixed",
    units: "SI",
    description: "Slope with a 0.5 m weak layer (c' = 0, φ' = 10°) and a water table at its base, analysed on the published four-point non-circular surface that runs along the weak layer.",
    definition: layered(
      [[20, 27.75], [43, 27.75], [67.5, 40], [84, 40]],
      20,
      [
        { name: "Soil 1", topY: null, model: mc(28.5, 20, 18.84) },
        { name: "Weak layer", topY: 27, model: mc(0, 10, 18.84) },
        { name: "Soil 1 below", topY: 26.5, model: mc(28.5, 20, 18.84) },
      ],
      {
        orientation: "rtl",
        waterTable: { mode: "custom", value: [[20, 26.5], [84, 26.5]] },
        customSurfaces: [{ points: [[41.85, 27.75], [44, 26.5], [63.5, 27], [73.31, 40]] }],
        customPlanesOnly: true,
      },
    ),
    checks: [
      {
        method: "Janbu",
        label: "Janbu corrected (f0)",
        published: 1.294,
        publishedBy: "Slide2",
        tolerance: 0.005,
        options: { janbuCorrection: true },
      },
      spencer(1.277, "Slide2", 0.005),
      mp(1.261, "SLOPE/W", 0.005),
    ],
    notes: ["Bishop on a non-circular surface depends on the moment axis; cSlope gives 1.250 about its default axis, SLOPE/W 1.259."],
  },
  {
    id: "VP7",
    title: "ACADS 3(a), weak layer, non-circular search",
    reference: "Giam & Donald (1989), ACADS problem 3(a). Slide2 Verification Problem #7; SLOPE/W example 2.7.",
    surface: "search",
    units: "SI",
    description: "As VP8, with a circular search followed by non-circular optimisation; the critical surface slides along the weak layer with a back scarp to the crest.",
    definition: layered(
      [[20, 27.75], [43, 27.75], [67.5, 40], [84, 40]],
      20,
      [
        { name: "Soil 1", topY: null, model: mc(28.5, 20, 18.84) },
        { name: "Weak layer", topY: 27, model: mc(0, 10, 18.84) },
        { name: "Soil 1 below", topY: 26.5, model: mc(28.5, 20, 18.84) },
      ],
      { orientation: "rtl", waterTable: { mode: "custom", value: [[20, 26.5], [84, 26.5]] } },
    ),
    checks: [
      mp(1.261, "SLOPE/W", 0.015, { options: { nonCircularOptimization: true } }),
      spencer(1.246, "Slide2", 0.02, { options: { nonCircularOptimization: true } }),
    ],
    notes: [
      "The best circle gives 1.51; the optimised surface follows the base of the weak layer. ACADS accepts about 1.24–1.27.",
    ],
  },
  {
    id: "VP68",
    title: "USACE example E-10, ponded water",
    reference: "USACE EM 1110-2-1902, example E-10. Slide2 Verification Problem #68.",
    surface: "fixed",
    units: "SI",
    description: "Undrained three-layer slope with 8 ft of water ponded against its toe (pool el. 0), on the published circle tangent to the base of the lowest layer. Converted to SI.",
    definition: layered(
      ft([[0, -8], [40, -8], [50, 4], [60, 16], [100, 16]]),
      -20 * FT,
      [
        { name: "Soil 1", topY: null, model: su(600 * PSF, 120 * PCF) },
        { name: "Soil 2", topY: 4 * FT, model: su(400 * PSF, 100 * PCF) },
        { name: "Soil 3", topY: -8 * FT, model: su(500 * PSF, 105 * PCF) },
      ],
      {
        ...circle(48.4 * FT, 28 * FT, 48 * FT),
        orientation: "rtl",
        waterTable: { mode: "custom", value: ft([[0, 0], [100, 0]]), followBoundary: false },
      },
    ),
    checks: [bishop(1.241, "Slide2", 0.01), mp(1.244, "Slide2 (GLE)", 0.01)],
    notes: ["The water above the toe acts as a load on the ground surface; the published USACE chart value is 1.33."],
  },
  ...([30, 60] as const).map(
    (pool): VerificationCase => ({
      id: pool === 30 ? "VP70a" : "VP70b",
      title: `Duncan & Wright fig. 6.27, submerged slope, pool +${pool} ft`,
      reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 6.27. Slide2 Verification Problem #70.",
      surface: "search",
      units: "SI",
      description: `Fully submerged homogeneous 2.5:1 slope with the pool ${pool} ft above the crest; the factor of safety does not depend on the depth of submergence. Converted to SI.`,
      definition: layered(
        ft([[0, 15], [30, 15], [105, 45], [140, 45]]),
        0,
        [{ name: "Soil", topY: null, model: mc(100 * PSF, 20, 128 * PCF) }],
        {
          orientation: "rtl",
          waterTable: { mode: "custom", value: ft([[0, 45 + pool], [140, 45 + pool]]), followBoundary: false },
        },
      ),
      checks: [bishop(1.603, "Slide2", 0.01), spencer(1.599, "Slide2", 0.01)],
    }),
  ),
  {
    id: "VP19",
    title: "Yamagami & Ueta (1988) four-layer slope, non-circular",
    reference: "Greco (1996) example 4; Yamagami & Ueta (1988). Slide2 Verification Problem #19.",
    surface: "search",
    units: "SI",
    description: "Four-layer slope without water whose critical surface is non-circular; circular search followed by non-circular optimisation.",
    definition: layered([[0, 40], [60, 40], [180, 100], [200, 100], [260, 70]], 0, [
      { name: "Upper layer", topY: null, model: mc(49, 29, 20.38) },
      { name: "Layer 2", topY: 40, model: mc(0, 30, 17.64) },
      { name: "Layer 3", topY: 35, model: mc(7.84, 20, 20.38) },
      { name: "Bottom layer", topY: 26, model: mc(0, 30, 17.64) },
    ], { orientation: "rtl" }),
    checks: [spencer(1.398, "Slide2 (Monte Carlo)", 0.015, { options: { nonCircularOptimization: true } })],
    notes: ["Greco publishes 1.40–1.42 for the non-circular surface; the best circle gives 1.430."],
  },
  {
    id: "VP23",
    title: "Low (1989), stiff crust over soft clays, published circle",
    reference: "Low (1989). Slide2 Verification Problem #23.",
    surface: "fixed",
    units: "SI",
    description: "Stiff upper slope on two undrained clays, the lowest with Su increasing linearly with depth (S = f(datum)), on the circle that carries Slide's published values.",
    definition: layered([[0, 8], [10, 8], [26, 16], [40, 16]], 0, [
      { name: "Upper", topY: null, model: mc(95, 15, 20) },
      { name: "Middle", topY: 8, model: mc(15, 0, 20) },
      { name: "Lower", topY: 4, model: sfd(15, 4, 3.75, 20) },
    ], { ...circle(19, 18.5, 18), orientation: "rtl" }),
    checks: [bishop(1.192, "Slide2", 0.01)],
  },
  {
    id: "VP25",
    title: "Prandtl bearing mechanism on a 60° slope",
    reference: "Chen & Shao (1988). Slide2 Verification Problem #25.",
    surface: "fixed",
    units: "SI",
    description: "Weightless, frictionless 10 m slope at 60° under the critical strip load (149.31 kPa) on the Prandtl surface (wedge, fan and passive wedge); theoretical FOS 1.0.",
    definition: layered([[-3, 0], [0, 0], [5.7735026919, 10], [20, 10]], -2, [{ name: "Clay", topY: null, model: mc(49, 0, 1e-6) }], {
      orientation: "rtl",
      udls: [{ magnitude: 149.31, x1: 5.7735026919, x2: 15.7735026919 }],
      customSurfaces: [{ points: [[-0.05, 2.05], [0.773, 1.34], [7.6033, 3.1698], [7.8995, 3.2561], [8.1917, 3.3553], [8.4792, 3.4671], [8.7616, 3.5913], [9.0384, 3.7278], [9.3089, 3.8762], [9.5727, 4.0362], [9.8292, 4.2076], [10.078, 4.3901], [10.3186, 4.5832], [10.5506, 4.7866], [10.7735, 5], [15.7735, 10], [16.0735, 10.3]] }],
      customPlanesOnly: true,
    }),
    checks: [spencer(1.051, "Slide2", 0.01)],
    notes: ["Chen & Shao give 1.05 with the method of slices; limit equilibrium on this mechanism is about 5 % above the plasticity solution."],
  },
  {
    id: "VP42",
    title: "Baker & Leshchinsky clay-core dam, reservoir and crest crack",
    reference: "Baker & Leshchinsky (2001). Slide2 Verification Problem #42.",
    surface: "fixed",
    units: "SI",
    description: "Granular dam with a diamond clay core on a hard base, half-full reservoir standing on the face (free water), phreatic surface through the core and a 5 m dry tension crack at the crest; Slide's critical circle.",
    definition: vp42({ ...circle(233.762, 188.495, 187.195) }),
    checks: [spencer(1.925, "Slide2", 0.005, { options: { tensionCrackDepth: 5 } })],
  },
  {
    id: "VP42-B",
    title: "Baker & Leshchinsky dam, Baker's non-circular surface",
    reference: "Baker & Leshchinsky (2001). Slide2 Verification Problem #42.",
    surface: "fixed",
    units: "SI",
    description: "As VP42, on the non-circular surface published by Baker & Leshchinsky.",
    definition: vp42({
      customSurfaces: [{ points: [[112.33, 54.6], [117, 49], [122, 43], [134, 33], [145, 24], [149, 22], [162, 17], [174, 13], [185, 11], [243, 3], [264, 0.79]] }],
      customPlanesOnly: true,
    }),
    checks: [spencer(1.91, "Baker & Leshchinsky", 0.02, { options: { tensionCrackDepth: 5 } })],
    notes: ["xslope gives 1.882 on the same surface."],
  },
  {
    id: "VP43",
    title: "Baker (2001) planar surface",
    reference: "Baker (2001). Slide2 Verification Problem #43; SLOPE/W example 2.26.",
    surface: "fixed",
    units: "SI",
    description: "Homogeneous 10 m slope on the critical plane from the toe to the crest at 49.6°.",
    definition: layered([[-5, 0], [0, 0], [2.5, 10], [20, 10]], -5, [{ name: "Soil", topY: null, model: mc(30, 30, 20) }], {
      orientation: "rtl",
      customSurfaces: [{ points: [[0, 0], [8.5, 10]] }],
      customPlanesOnly: true,
    }),
    checks: [
      spencer(1.351, "RocPlane", 0.005),
      { method: "Janbu", label: "Janbu simplified", published: 1.351, publishedBy: "RocPlane", tolerance: 0.005 },
    ],
  },
  ...([false, true] as const).map(
    (wet): VerificationCase => ({
      id: wet ? "VP52b" : "VP52a",
      title: `Zhu four-layer slope, ${wet ? "with water table" : "dry"}`,
      reference: "Slide2 Verification Problem #52.",
      surface: "search",
      units: "SI",
      description: `Four horizontal layers under a two-bench slope${wet ? " with the published water table" : ""}; circular search (deep surface family).`,
      definition: layered([[-20, 0], [0, 0], [6, 3], [18, 9], [30, 15], [50, 15]], -9, [
        { name: "Layer 1", topY: null, model: mc(20, 18, 18.8) },
        { name: "Layer 2", topY: 9, model: mc(40, 22, 18.5) },
        { name: "Layer 3", topY: 3, model: mc(25, 26, 18.4) },
        { name: "Layer 4", topY: -6, model: mc(10, 12, 18) },
      ], {
        orientation: "rtl",
        ...(wet
          ? { waterTable: { mode: "custom", value: [[-20, 0], [0, 0], [6, 3], [10.568, 5.284], [25.314, 9.002], [39.149, 10.269], [50, 10.269]] } }
          : {}),
      }),
      checks: wet
        ? [bishop(1.176, "Slide2", 0.01), spencer(1.189, "Slide2", 0.01)]
        : [bishop(1.804, "Slide2", 0.01), spencer(1.804, "Slide2", 0.01)],
    }),
  ),
  {
    id: "VP53",
    title: "Priest (1993) rigid block on a plane, water-filled crack",
    reference: "Priest (1993). Slide2 Verification Problem #53.",
    surface: "fixed",
    units: "SI",
    description: "Block on a 30° plane from the toe, a 15 m tension crack holding 3.75 m of water and a water table along the plane up to the crack.",
    definition: layered([[-25, 0], [0, 0], [17, 30], [60, 30]], -15, [{ name: "Block", topY: null, model: mc(20, 30, 25) }], {
      orientation: "rtl",
      waterTable: { mode: "custom", value: [[-25, 0], [0, 0], [25.981, 18.75], [60, 18.75]] },
      customSurfaces: [{ points: [[0, 0], [51.962, 30]] }],
      customPlanesOnly: true,
    }),
    checks: [
      { method: "Janbu", label: "Janbu simplified", published: 1.049, publishedBy: "Slide2, RocPlane, Priest", tolerance: 0.005, options: { tensionCrackDepth: 15, tensionCrackWater: 0.25 } },
      spencer(1.049, "Slide2, RocPlane, Priest", 0.005, { options: { tensionCrackDepth: 15, tensionCrackWater: 0.25 } }),
    ],
  },
  {
    id: "VP56",
    title: "Pockoski & Duncan test slope 2, dry tension crack",
    reference: "Pockoski & Duncan (2000). Slide2 Verification Problem #56.",
    surface: "fixed",
    units: "SI",
    description: "The VP55 slope with a dry 5.5 ft tension crack, on Slide's critical circle. Converted to SI.",
    definition: layered(ft([[-70, 100], [0, 100], [100, 150], [170, 150]]), 75 * FT, [{ name: "Sandy clay", topY: null, model: mc(300 * PSF, 30, 120 * PCF) }], {
      orientation: "rtl",
      waterTable: { mode: "custom", value: ft([[-70, 100], [0, 100], [100, 140], [170, 140]]) },
      ...circle(24.662 * FT, 197.656 * FT, 100.79 * FT),
    }),
    checks: [
      bishop(1.285, "Slide2", 0.01, { options: { tensionCrackDepth: 5.5 * FT } }),
      spencer(1.29, "Slide2", 0.01, { options: { tensionCrackDepth: 5.5 * FT } }),
    ],
  },
  {
    id: "VP57",
    title: "Pockoski & Duncan test slope 3, clay seam and dry crack",
    reference: "Pockoski & Duncan (2000). Slide2 Verification Problem #57.",
    surface: "search",
    units: "SI",
    description: "Sandy clay over a 5 ft highly plastic clay seam on the model base, water table and a dry 6 ft tension crack; circular search. Converted to SI.",
    definition: layered(ft([[-70, 100], [0, 100], [125, 150], [200, 150]]), 85 * FT, [
      { name: "Sandy clay", topY: null, model: mc(300 * PSF, 35, 130 * PCF) },
      { name: "Plastic clay seam", topY: 90 * FT, model: mc(0, 25, 130 * PCF) },
    ], { orientation: "rtl", waterTable: { mode: "custom", value: ft([[-70, 100], [0, 100], [125, 140], [200, 140]]) } }),
    checks: [
      bishop(1.417, "Slide2 (circles)", 0.01, { options: { tensionCrackDepth: 6 * FT } }),
      spencer(1.422, "Slide2 (circles)", 0.01, { options: { tensionCrackDepth: 6 * FT } }),
    ],
    notes: ["Slide's composite surfaces (circles cut off at the base) give 1.392 / 1.400; cSlope's non-circular optimisation, which is not restricted to that shape, finds 1.353 / 1.369 along the seam."],
  },
  {
    id: "VP61",
    title: "Baker (2003) London clay slope, Mohr-Coulomb fit",
    reference: "Baker (2003) example 3. Slide2 Verification Problem #61(b).",
    surface: "search",
    units: "SI",
    description: "43° slope, 6 m high, with the Mohr-Coulomb envelope fitted to London clay data (c' = 6 kPa, φ' = 32°); critical circle search.",
    definition: layered([[-6, 0], [0, 0], [6.43, 6], [20, 6]], -4, [{ name: "London clay", topY: null, model: mc(6, 32, 18) }], { orientation: "rtl" }),
    checks: [spencer(1.366, "Slide2", 0.01)],
  },
  {
    id: "VP69",
    title: "USACE example F-6, steady-seepage dam",
    reference: "USACE EM 1110-2-1902, example F-6. Slide2 Verification Problem #69.",
    surface: "fixed",
    units: "SI",
    description: "112 ft embankment on a granular foundation under steady seepage: piezometric line from the pool through the chimney drain to the tailwater, which stands on the downstream toe (free water). USACE's circle. Converted to SI.",
    definition: layered(ft([[0, 100], [38.4, 100], [60.8, 112], [81, 112], [194.9, 73.7], [400, 0], [450, 0]]), -75 * FT, [
      { name: "Embankment", topY: null, model: mc(0, 34, 130 * PCF) },
      { name: "Foundation", topY: 0, model: mc(0, 35, 125 * PCF) },
    ], {
      waterTable: { mode: "custom", value: ft([[0, 100], [38.4, 100], [121.1, 69], [179.4, 22.5], [450, 22.5]]), followBoundary: false },
      ...circle(269 * FT, 248 * FT, 280 * FT),
    }),
    checks: [bishop(2.011, "Slide2", 0.01), spencer(2.026, "Slide2", 0.01)],
    notes: ["The kink of the piezometric line is located from the figure to about a foot; xslope also reads 0.6 % low."],
  },
  {
    id: "VP73",
    title: "Bradwell excavated slope, stiff-fissured London clay",
    reference: "Skempton & LaRochelle (1965); Duncan & Wright, Soil Strength and Slope Stability. Slide2 Verification Problem #73.",
    surface: "search",
    units: "imperial",
    description: "Excavation in London clay (six sublayers with Su increasing with depth, S = f(datum)) under Marsh clay and a clay fill cracked to its full depth (11.4 ft); search for the deep failure, entering on the crest and leaving at the excavation toe.",
    definition: layered([[0, 17.4], [45, 17.4], [56.4, 6], [68.4, 6], [77.4, -3], [83.4, -3], [97.5, -31.2], [145, -31.2]], -50, [
      { name: "Clay fill", topY: null, model: mc(1, 35, 110) },
      { name: "Marsh clay", topY: 6, model: mc(300, 0, 105) },
      { name: "Brown London clay 1", topY: -3, model: sfd(750, -3, 90, 120) },
      { name: "Brown London clay 2", topY: -9.5, model: sfd(1335, -9.5, 82, 120) },
      { name: "Brown London clay 3", topY: -14, model: sfd(1704, -14, 53, 120) },
      { name: "Brown London clay 4", topY: -24, model: sfd(2234, -24, 47, 120) },
      { name: "Blue London clay 1", topY: -27, model: sfd(2375, -27, 47, 120) },
      { name: "Blue London clay 2", topY: -29, model: sfd(2469, -29, 39, 120) },
    ], { analysisLimits: { entryLeftX: 0, entryRightX: 45, exitLeftX: 83.4, exitRightX: 145 } }),
    checks: [
      bishop(1.762, "Slide2", 0.01, { options: { tensionCrackDepth: 11.4 } }),
      spencer(1.758, "Slide2", 0.01, { options: { tensionCrackDepth: 11.4 } }),
      { method: "Janbu", label: "Janbu corrected (f0)", published: 1.736, publishedBy: "Slide2", tolerance: 0.01, options: { tensionCrackDepth: 11.4, janbuCorrection: true } },
    ],
    notes: ["Without limits the search finds shallower mechanisms: a sliver in the cohesionless 1:1 fill (0.74) and, with the crack, a surface through the fill and Marsh clay (1.15). The published value is the deep failure."],
  },
  {
    id: "VP22a",
    title: "Fredlund & Krahn slope on a weak seam, composite surface",
    reference: "Fredlund, D.G. & Krahn, J. (1977). Can. Geotech. J. 14(3). Slide2 Verification Problem #22.",
    surface: "fixed",
    units: "imperial",
    description: "The VP21 slope with a 1 ft weak seam (c′ = 0, φ′ = 10°) on the impenetrable base at el. 15; the published circle (120, 90, R = 80) reaches below the base, so the surface follows the arc down to the base, runs along the seam and climbs back on the arc. Dry.",
    definition: layered(vp21Ground, 15, [
      { name: "Upper soil", topY: null, model: mc(600, 20, 120) },
      { name: "Weak seam", topY: 16, model: mc(0, 10, 120) },
    ], {
      customSurfaces: [{ points: compositeCircle(120, 90, 80, 15, 45.5, 159) }],
      customPlanesOnly: true,
    }),
    checks: [
      bishop(1.382, "Slide2", 0.01),
      spencer(1.382, "Slide2", 0.01),
      mp(1.37, "Fredlund & Krahn", 0.01),
    ],
  },
  {
    id: "VP27",
    title: "XSTABL slope over undulating bedrock, zero-strength cap",
    reference: "Sharma (1996), XSTABL reference manual; Malkawi et al. (2001). Slide2 Verification Problem #27.",
    surface: "fixed",
    units: "SI",
    description: "Two-material slope over undulating bedrock with a zero-strength cap layer and a water table (phreatic correction); soil 1 has moist/saturated unit weights 116.4/124.2 pcf. Specified circle (59.52, 219.21, R = 157.68). Converted to SI.",
    definition: regions(
      ft([[0, 15], [29, 24], [51, 26], [78, 56], [94, 65], [113, 64], [133, 56], [161, 58], [200, 76], [200, 99], [200, 110], [138, 103], [101, 88], [63, 73], [38, 63], [22, 67], [0, 68]]),
      [ft([[101, 88], [200, 99]])],
      [
        { name: "Soil 1", model: sat(mc(500 * PSF, 14, 116.4 * PCF), 124.2 * PCF), at: ft([[32.25, 41]]) },
        { name: "Soil 2 (zero strength)", model: su(0, 116.4 * PCF), at: ft([[132.5, 93.5]]) },
      ],
      {
        waterTable: { mode: "custom", value: ft([[0, 68], [22, 67], [38, 63], [63, 73], [80, 78.6], [95, 81.8], [110, 84.5], [125, 86.9], [155, 90.2], [185, 93.1], [200, 94.5]]), followBoundary: false },
        ...circle(59.52 * FT, 219.21 * FT, 157.68 * FT),
      },
    ),
    checks: [
      bishop(1.396, "Slide2", 0.025, { options: PHREATIC }),
      spencer(1.402, "Slide2", 0.025, { options: PHREATIC }),
      bishop(1.369, "xslope (same input)", 0.005, { options: PHREATIC }),
      spencer(1.375, "xslope (same input)", 0.005, { options: PHREATIC }),
    ],
    notes: ["The water table is traced from the manual's figure to about ±2 ft; xslope reads 1.9 % below Slide2 for every method on the same input, as cSlope does."],
  },
  {
    id: "VP39a",
    title: "Tandjiria embankment, clay fill, water-filled crack",
    reference: "Tandjiria (2002). Slide2 Verification Problem #39.",
    surface: "search",
    units: "SI",
    description: "Half-embankment (9 m crest, 10 m wide crest, 1V:1.67H face) of clay fill (Su = 20 kPa) on soft clay (Su = 20 kPa), γ = 19.4; 2 m water-filled tension crack, unreinforced; circular search. Also run with the automatic (Rankine) crack depth.",
    definition: layered([[0, 9], [10, 9], [20, 3], [30, 3]], 0, [
      { name: "Fill", topY: null, model: su(20, 19.4) },
      { name: "Soft clay", topY: 3, model: su(20, 19.4) },
    ]),
    checks: [
      spencer(0.975, "Slide2", 0.01, { options: { tensionCrackDepth: 2, tensionCrackWater: 1 } }),
      spencer(0.975, "Slide2", 0.012, {
        options: { tensionCrackAuto: true, tensionCrackWater: 1 },
        note: "Automatic crack depth 2c/γ = 2.06 m instead of the given 2 m.",
      }),
    ],
    notes: ["xslope gives 0.968 on Slide's circle, as cSlope does; Tandjiria 0.981."],
  },
  {
    id: "VP39c",
    title: "Tandjiria embankment, sand fill, dry crack",
    reference: "Tandjiria (2002). Slide2 Verification Problem #39.",
    surface: "search",
    units: "SI",
    description: "The VP39 embankment as a sand fill (φ′ = 37°, γ = 17) on soft clay (Su = 20 kPa, γ = 20) with a dry 2 m tension crack, unreinforced; circular search.",
    definition: layered([[0, 9], [10, 9], [20, 3], [30, 3]], 0, [
      { name: "Fill", topY: null, model: mc(0, 37, 17) },
      { name: "Soft clay", topY: 3, model: su(20, 20) },
    ]),
    checks: [spencer(1.209, "Slide2", 0.01, { options: { tensionCrackDepth: 2 } })],
    notes: ["xslope gives 1.200 on Slide's circle; Tandjiria 1.219."],
  },
  {
    id: "VP46",
    title: "Baker (1993) dam, end of construction, infinite-slope face",
    reference: "Baker (1993). Slide2 Verification Problem #46.",
    surface: "search",
    units: "SI",
    description: "Compacted-clay embankment (c′ = 6.5 kPa, φ′ = 40°) on a deep natural-clay foundation (c′ = 0, φ′ = 32°) whose 4H:1V downstream face governs; dry; circular search. Theoretical (infinite slope) FOS tan 32°/tan 14.04° = 2.50.",
    definition: regions(
      [[0, 0], [0, 95], [80, 95], [100, 101], [128, 95], [148, 90], [220, 90], [220, 0]],
      [[[0, 95], [80, 95], [128, 95], [148, 90], [220, 90]]],
      [
        { name: "Compacted clay", model: mc(6.5, 40, 18), at: [[98, 99.9]] },
        { name: "Natural clay", model: mc(0, 32, 18), at: [[40, 94.5]] },
      ],
    ),
    checks: [bishop(2.5, "theory (infinite slope)", 0.01), spencer(2.5, "theory (infinite slope)", 0.01)],
    notes: [
      "The critical surfaces are shallow slabs on the cohesionless face; a minimum sliding area in proportion to the model area (here 20 000 m²) would skip them and read 3 % high.",
      "Slide2 2.534 (noncircular, minimum depth 5 m); Baker 2.41.",
    ],
  },
  {
    id: "VP64",
    title: "USACE dam, end of construction (EM 1110-2-1902 fig. 4-1)",
    reference: "USACE EM 1110-2-1902 (2003), fig. 4-1. Slide2 Verification Problem #64.",
    surface: "fixed",
    units: "SI",
    description: "Symmetric 50 ft embankment at 4H:1V (c = 1000 psf, φ = 5°) with a core trench through a 10 ft sand blanket over foundation clay (Su = 3000 psf) and rock; groundwater at the sand top, 7 ft dry crest crack; moist/saturated unit weights. Specified circle (102, 163, R = 163). Converted to SI.",
    definition: regions(
      ft([[-225, -40], [225, -40], [225, 0], [217, 0], [17, 50], [-17, 50], [-217, 0], [-225, 0]]),
      [ft([[217, 0], [17, 0], [8, -10]]), ft([[8, -10], [-8, -10]]), ft([[8, -10], [225, -10]]), ft([[-8, -10], [-17, 0], [-217, 0]]), ft([[-8, -10], [-225, -10]]), ft([[-225, -37], [225, -37]])],
      usaceLayers([
        sat(mc(1000 * PSF, 5, 115 * PCF), 120 * PCF),
        sat(mc(0, 35, 125 * PCF), 130 * PCF),
        sat(su(3000 * PSF, 110 * PCF), 115 * PCF),
        sat(mc(0, 45, 160 * PCF), 165 * PCF),
      ]),
      {
        waterTable: { mode: "custom", value: ft([[-225, 0], [-17, 0], [-8, -10], [8, -10], [17, 0], [225, 0]]), followBoundary: false },
        ...circle(102 * FT, 163 * FT, 163 * FT),
      },
    ),
    checks: [
      spencer(2.445, "Slide2", 0.025, { options: { ...VERTICAL, tensionCrackDepth: 7 * FT } }),
      bishop(2.447, "Slide2", 0.025, { options: { ...VERTICAL, tensionCrackDepth: 7 * FT } }),
      spencer(2.488, "xslope (same input)", 0.005, { options: { ...VERTICAL, tensionCrackDepth: 7 * FT } }),
      bishop(2.489, "xslope (same input)", 0.005, { options: { ...VERTICAL, tensionCrackDepth: 7 * FT } }),
    ],
    notes: ["Neither figure labels its vertices; xslope pins the crest and toes from USACE's slice table and reads 1.8 % above Slide2 on the same input, as cSlope does. USACE 2.44."],
  },
  {
    id: "VP65",
    title: "USACE dam, upstream low pool (EM 1110-2-1902 fig. 4-2)",
    reference: "USACE EM 1110-2-1902 (2003), fig. 4-2. Slide2 Verification Problem #65.",
    surface: "fixed",
    units: "SI",
    description: "The VP64 dam with drained strengths (embankment c = 100 psf, φ = 25°; sand 0/35; clay 0/28; rock 0/45; moist/saturated unit weights) and the pool at el. 20 standing on the upstream face. USACE's circle (−102, 163, R = 173), tangent to the clay top. Converted to SI.",
    definition: regions(
      ft([[-225, -40], [-225, 0], [-217, 0], [-17, 50], [17, 50], [217, 0], [225, 0], [225, -40]]),
      [ft(usaceTrench), ft([[-225, -10], [225, -10]]), ft([[-225, -37], [225, -37]])],
      usaceLayers([
        sat(mc(100 * PSF, 25, 115 * PCF), 120 * PCF),
        sat(mc(0, 35, 125 * PCF), 130 * PCF),
        sat(mc(0, 28, 110 * PCF), 115 * PCF),
        sat(mc(0, 45, 160 * PCF), 165 * PCF),
      ]),
      {
        orientation: "rtl",
        waterTable: { mode: "custom", value: ft([[-225, 20], [117.778, 20]]), followBoundary: false },
        ...circle(-102 * FT, 163 * FT, 173 * FT),
      },
    ),
    checks: [bishop(2.716, "Slide2", 0.01, { options: VERTICAL }), spencer(2.736, "Slide2", 0.01, { options: VERTICAL })],
    notes: ["USACE 2.71 (Bishop); xslope 2.725 / 2.748."],
  },
  {
    id: "VP66",
    title: "USACE dam, chart-check properties (EM 1110-2-1902 fig. 4-3)",
    reference: "USACE EM 1110-2-1902 (2003), fig. 4-3. Slide2 Verification Problem #66.",
    surface: "fixed",
    units: "SI",
    description: "The VP64 dam family with single unit weights (embankment c = 200 psf, φ = 25°, γ = 115; sand 0/35/130; clay 0/27/115), slightly flatter faces and ponded water at el. 20 on both faces. Slide's circle (−135, 169, R = 169.1), tangent to the sand top. Converted to SI.",
    definition: regions(
      ft([[-225, -40], [-225, 0], [-222, 0], [-17, 49.517], [-15, 50], [15, 50], [17, 49.517], [222, 0], [225, 0], [225, -40]]),
      [ft(usaceTrench), ft([[-225, -10], [225, -10]]), ft([[-225, -37], [225, -37]])],
      usaceLayers([mc(200 * PSF, 25, 115 * PCF), mc(0, 35, 130 * PCF), mc(0, 27, 115 * PCF), mc(0, 45, 160 * PCF)]),
      {
        orientation: "rtl",
        waterTable: { mode: "custom", value: ft([[-225, 20], [225, 20]]), followBoundary: false },
        ...circle(-135 * FT, 169 * FT, 169.1 * FT),
      },
    ),
    checks: [
      spencer(2.307, "Slide2", 0.025, { options: VERTICAL }),
      bishop(2.307, "Slide2", 0.025, { options: VERTICAL }),
      spencer(2.258, "xslope (same input)", 0.005, { options: VERTICAL }),
      bishop(2.254, "xslope (same input)", 0.005, { options: VERTICAL }),
    ],
    notes: ["The three Slide models #64–66 carry slightly different digitisations of the same dam; xslope reads about 2 % below Slide2 here on the same input, as cSlope does. USACE 2.30."],
  },
  {
    id: "VP75",
    title: "James Bay dyke (Duncan & Wright fig. 7.16)",
    reference: "Duncan & Wright, Soil Strength and Slope Stability, fig. 7.16. Slide2 Verification Problem #75.",
    surface: "search",
    units: "SI",
    description: "Granular fill embankment with a wide berm (c′ = 0, φ′ = 30°) on a 4 m clay crust (Su = 41), 8 m marine clay (34.5) and 7 m lacustrine clay (31.2); circular search. The critical circle is deep and tangent to the base of the lacustrine clay.",
    definition: layered([[-17, 31], [40, 31], [58, 25], [114, 25], [132, 19], [168, 19]], 0, [
      { name: "Fill", topY: null, model: mc(0, 30, 20) },
      { name: "Clay crust", topY: 19, model: su(41, 20) },
      { name: "Marine clay", topY: 15, model: su(34.5, 18.8) },
      { name: "Lacustrine clay", topY: 7, model: su(31.2, 20.3) },
    ]),
    checks: [bishop(1.45, "Duncan & Wright", 0.025), spencer(1.45, "Duncan & Wright", 0.025)],
    notes: ["xslope's search gives 1.424 / 1.420; Slide2 reports 1.468 / 1.464 on its own (not the critical) circle."],
  },
  ...([
    [84, 1.215, "deep"],
    [90, 1.29, "deep"],
    [96, 1.315, "shallow"],
  ] as const).map(([cu2, published, mode], i): VerificationCase => ({
    id: `VP103${"abc"[i]}`,
    title: `Guo & Griffiths two-layer undrained slope, cu2/cu1 = ${(cu2 / 60).toFixed(1)}`,
    reference: "Guo & Griffiths (2020), Can. Geotech. J. 57. Slide2 Verification Problem #103.",
    surface: "search",
    units: "SI",
    description: `18 m embankment at 1V:2H (Su = 60 kPa) on an 18 m undrained foundation (Su = ${cu2} kPa), γ = 20, firm base; optimised non-circular search. The ${mode} mechanism governs.`,
    definition: layered([[0, 36], [36, 36], [72, 18], [90, 18]], 0, [
      { name: "Embankment", topY: null, model: su(60, 20) },
      { name: "Foundation", topY: 18, model: su(cu2, 20) },
    ]),
    checks: [spencer(published, "Slide2 (particle swarm + surface altering)", 0.01, { options: { nonCircularOptimization: true } })],
  })),
];
