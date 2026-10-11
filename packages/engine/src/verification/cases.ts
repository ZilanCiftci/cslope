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
];
