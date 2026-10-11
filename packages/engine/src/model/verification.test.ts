/**
 * Verification problems from the Rocscience Slide2 verification manual
 * ("VP<n>") and the GEO-SLOPE SLOPE/W examples, with the factors of safety
 * they publish (and the original references where given).
 *
 * The input data were transcribed via the open-source xslope project
 * (github.com/njones61/xslope, docs/verification) and the USGS Scoops3D
 * test inputs, because the manuals themselves could not be downloaded.
 * Check each problem against the manual before relying on it.
 *
 * Imperial problems without water are entered in their own units (FOS is
 * dimensionless); problems with water are converted to SI because the
 * engine uses γw = 9.81 kN/m³ (62.4 pcf = 9.80 kN/m³, < 0.1 % difference).
 */
import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { analyseSlope } from "./solvers";
import { toCanonicalSlopeDefinition } from "./canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import type { MaterialModel } from "../types/material-models";
import type { AnalysisMethod, AnalysisOptions } from "../types/analysis";

type Pt = [number, number];
interface Layer {
  name: string;
  /** Elevation of the top of the layer (null for the top layer). */
  topY: number | null;
  model: MaterialModel;
}

const mc = (c: number, phi: number, gamma: number): MaterialModel => ({
  kind: "mohr-coulomb",
  unitWeight: gamma,
  cohesion: c,
  frictionAngle: phi,
});
const su = (s: number, gamma: number, refY = 0, rate = 0): MaterialModel => ({
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
function layered(
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

const circle = (cx: number, cy: number, radius: number) => ({
  customSearchPlanes: [{ cx, cy, radius }],
  customPlanesOnly: true,
});

function fos(
  def: SlopeDefinition,
  method: AnalysisMethod,
  opts: Partial<AnalysisOptions> = {},
): number {
  const slope = buildSlope(toCanonicalSlopeDefinition(def));
  slope.updateAnalysisOptions({
    method,
    slices: 50,
    iterations: 4000,
    refinedIterations: 2000,
    ...opts,
  });
  const f = analyseSlope(slope);
  expect(f).not.toBeNull();
  return f!;
}

/** |computed − published| ≤ tol · published */
function expectNear(value: number, published: number, tol: number) {
  expect(Math.abs(value - published) / published).toBeLessThanOrEqual(tol);
}

const FT = 0.3048;
const PSF = 0.04788026; // kPa
const PCF = 0.15708746; // kN/m³
const ft = (p: Pt[]): Pt[] => p.map(([x, y]) => [x * FT, y * FT]);

describe("Verification problems — fixed circles", () => {
  const vp21Ground: Pt[] = [
    [0, 60],
    [60, 60],
    [140, 20],
    [180, 20],
  ];

  it("VP21 Fredlund & Krahn (1977), dry: Bishop 2.080, M-P 2.076", () => {
    const def = layered(vp21Ground, 0, [{ name: "S", topY: null, model: mc(600, 20, 120) }], circle(120, 90, 80));
    expectNear(fos(def, "Bishop"), 2.08, 0.005);
    expectNear(fos(def, "Morgenstern-Price"), 2.076, 0.005);
  });

  it("VP21 Fredlund & Krahn (1977), water table: Bishop 1.834, M-P 1.832", () => {
    const def = layered(
      ft(vp21Ground),
      0,
      [{ name: "S", topY: null, model: mc(600 * PSF, 20, 120 * PCF) }],
      {
        ...circle(120 * FT, 90 * FT, 80 * FT),
        waterTable: { mode: "custom", value: ft([[0, 40], [140, 20], [180, 20]]) },
      },
    );
    expectNear(fos(def, "Bishop"), 1.834, 0.005);
    expectNear(fos(def, "Morgenstern-Price"), 1.832, 0.005);
  });

  it("VP67 USACE EM 1110-2-1902 example F-5: Bishop 1.332", () => {
    const def = layered(
      [[-100, 100], [0, 100], [174, 158], [257, 191], [301, 191], [400, 150]],
      0,
      [
        { name: "Embankment", topY: null, model: mc(1780, 5, 135) },
        { name: "Foundation", topY: 100, model: mc(1600, 2, 127) },
      ],
      circle(101, 359, 278),
    );
    expectNear(fos(def, "Bishop"), 1.332, 0.015);
  });

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

  it("VP80 Duncan & Wright fig. 14.5, R = 87: Bishop 2.549", () => {
    expectNear(fos(layered(vp80Ground, 0, vp80Layers, circle(142, 147, 87)), "Bishop"), 2.549, 0.01);
  });

  it("VP80 Duncan & Wright fig. 14.5, R = 102: Bishop 1.398", () => {
    expectNear(fos(layered(vp80Ground, 0, vp80Layers, circle(142, 147, 102)), "Bishop"), 1.398, 0.01);
  });

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

  it("VP28 Chowdhury & Xu (1995) ex. 5, circle 1: Bishop 1.160", () => {
    // The published surfaces slide down the left face of the ridge.
    const def = layered(vp28Ground, 0, vp28Layers, { ...circle(37.369, 42.429, 27.429), orientation: "rtl" });
    expectNear(fos(def, "Bishop"), 1.16, 0.01);
  });

  it("VP28 Chowdhury & Xu (1995) ex. 5, circle 2: Bishop 1.185", () => {
    const def = layered(vp28Ground, 0, vp28Layers, { ...circle(40.256, 29.437, 24.437), orientation: "rtl" });
    expectNear(fos(def, "Bishop"), 1.185, 0.01);
  });

  it("Eurocode 7 cutting (SLOPE/W): Bishop 1.173 with vertical head", () => {
    // SLOPE/W uses the vertical distance to the piezometric line; the engine
    // applies the cos²θ correction for an inclined line, which gives 1.188
    // for this problem (independent check), hence the wider tolerance.
    const def = layered([[0, 5], [30, 5], [50, 15], [80, 15]], 0, [{ name: "Clay", topY: null, model: mc(8, 23.04, 20) }], {
      ...circle(35.4, 25.467, 22.099),
      waterTable: { mode: "custom", value: [[0, 5], [30, 5], [45.5, 9], [70, 12], [80, 12]] },
      udls: [{ magnitude: 35, x1: 52, x2: 62 }],
    });
    expectNear(fos(def, "Bishop"), 1.173, 0.02);
  });
});

describe("Verification problems — critical circle search", () => {
  it("VP15 Arai & Tagyo (1985) ex. 2, three layers: Bishop 0.420", () => {
    const def: SlopeDefinition = {
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
    };
    expectNear(fos(def, "Bishop"), 0.42, 0.01);
  });

  it("VP17 Yamagami & Ueta (1988): Bishop 1.344", () => {
    const def = layered([[0, 5], [5, 5], [15, 10], [25, 10]], 0, [{ name: "S", topY: null, model: mc(9.8, 10, 17.64) }]);
    expectNear(fos(def, "Bishop"), 1.344, 0.01);
  });

  for (const [cz, published] of [
    [0, 0.761],
    [5, 0.909],
    [10, 1.045],
    [15, 1.154],
  ] as const) {
    it(`VP84 Duncan & Wright fig. 15.9, Su increasing ${cz} psf/ft: Bishop ${published}`, () => {
      const def = layered([[0, 20], [40, 20], [90, 40], [140, 40]], 0, [
        { name: "Fill", topY: null, model: mc(0, 35, 125) },
        { name: "Clay", topY: 20, model: su(300, 100, 20, cz) },
      ]);
      expectNear(fos(def, "Bishop"), published, 0.01);
    });
  }

  it("VP83 Duncan & Wright fig. 14.20b, Su = 200 + 15·depth: Bishop 1.313", () => {
    const def = layered([[0, 40], [55, 40], [75, 30], [140, 30]], 0, [
      { name: "Fill", topY: null, model: mc(0, 36, 123) },
      { name: "Clay", topY: 30, model: su(200, 97, 30, 15) },
    ]);
    expectNear(fos(def, "Bishop"), 1.313, 0.01);
  });

  it("VP83 Duncan & Wright fig. 14.20b, Su = 300: Bishop 1.335", () => {
    const def = layered([[0, 40], [55, 40], [75, 30], [140, 30]], 0, [
      { name: "Fill", topY: null, model: mc(0, 36, 123) },
      { name: "Clay", topY: 30, model: su(300, 97) },
    ]);
    expectNear(fos(def, "Bishop"), 1.335, 0.01);
  });

  it("VP82 Duncan & Wright fig. 14.20a, water table: Bishop 1.533", () => {
    const def = layered(
      ft([[0, 60], [60, 60], [140, 20], [200, 20]]),
      0,
      [
        { name: "Fill", topY: null, model: mc(600 * PSF, 25, 125 * PCF) },
        { name: "Sand", topY: 20 * FT, model: mc(0, 30, 132 * PCF) },
      ],
      { waterTable: { mode: "custom", value: ft([[0, 40], [100, 30], [140, 20], [200, 20]]) } },
    );
    expectNear(fos(def, "Bishop"), 1.533, 0.01);
  });

  it("VP78 Duncan & Wright fig. 14.3, undrained clay: Bishop 1.126", () => {
    const def = layered([[0, 30], [90, 30], [130, 80], [240, 80]], 0, [{ name: "Clay", topY: null, model: mc(1000, 0, 100) }]);
    expectNear(fos(def, "Bishop"), 1.126, 0.01);
  });

  it("VP79 Duncan & Wright fig. 14.4: Bishop 1.412", () => {
    const def = layered([[0, 20], [40, 20], [78, 35], [130, 35]], 0, [
      { name: "Fill", topY: null, model: mc(0, 30, 120) },
      { name: "Clay", topY: 20, model: mc(450, 0, 120) },
    ]);
    expectNear(fos(def, "Bishop"), 1.412, 0.01);
  });

  it("VP74 Duncan & Wright fig. 7.12, embankment on clay: Bishop 1.228", () => {
    const def = layered(
      [[0, 50], [100, 50], [300, 150], [400, 150], [600, 50], [700, 50]],
      0,
      [
        { name: "Sand", topY: null, model: mc(0, 40, 140) },
        { name: "Clay", topY: 50, model: mc(2500, 0, 140) },
      ],
    );
    expectNear(fos(def, "Bishop"), 1.228, 0.01);
  });

  it("VP24 Low (1989), layered undrained clay: Bishop 1.439", () => {
    const def = layered([[0, 13.5], [20, 13.5], [33.5, 9], [38, 7.5], [60, 7.5]], 0, [
      { name: "A", topY: null, model: su(30, 18) },
      { name: "B", topY: 9, model: su(20, 18) },
      { name: "C", topY: 4.5, model: su(150, 18) },
    ]);
    expectNear(fos(def, "Bishop"), 1.439, 0.015);
  });
});

const SPENCER = { intersliceFunction: "constant" as const };

describe("Verification problems — round 4, fixed circles", () => {
  // Clarence Cannon Dam: Hassan & Wolff (1999); SLOPE/W verification §2.22 (nine saved M-P
  // analyses) and Slide VP35 Table 35.2 (Bishop). Geometry and circles as in the SLOPE/W
  // model (transcribed via xslope gs2_22.xlsx). Circle = centre + tangent elevation.
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
  for (const [lab, xc, yc, yt, mp, bishop] of [
    ["7A", 320.175, 313.336, 145.347, 2.56, 2.551],
    ["7B", 295.235, 277.589, 156.298, 2.806, 2.82],
    ["7C", 303.683, 310.206, 155.928, 2.771, 2.777],
    ["7D", 322.152, 310.206, 145.36, 2.589, 2.583],
    ["7E", 327.693, 324.018, 147.163, 2.703, 2.692],
    ["8B", 304.239, 307.858, 155.311, 2.673, 2.672],
    ["8F", 313.114, 304.784, 160.368, 3.586, 3.598],
    ["8G", 314.856, 305.604, 165.756, 6.069, 6.074],
    // Slide's Bishop 11.23 for 8H disagrees with SLOPE/W (11.583) and two other codes.
    ["8H", 316.198, 305.604, 170.537, 11.583, null],
  ] as const) {
    it(`Cannon Dam (Hassan & Wolff 1999) surface ${lab}: M-P ${mp}${bishop ? `, Bishop ${bishop}` : ""}`, () => {
      const def = cannon(xc, yc, yc - yt);
      expectNear(fos(def, "Morgenstern-Price"), mp, 0.005);
      if (bishop) expectNear(fos(def, "Bishop"), bishop, 0.005);
    });
  }

  it("VP37 XSTABL reinforcement example, unreinforced, 40 kPa surcharge: Bishop 0.764, Spencer 0.764", () => {
    const def = layered([[0, 5], [5, 5], [17, 17], [40, 17]], 0, [{ name: "Sand", topY: null, model: mc(0, 36, 20) }], {
      ...circle(-11.41, 35.264, 34.426),
      udls: [{ magnitude: 40, x1: 17, x2: 30 }],
    });
    expectNear(fos(def, "Bishop"), 0.764, 0.01);
    // M-P used to return no result here (λ secant misled by Fm noise).
    expectNear(fos(def, "Morgenstern-Price", SPENCER), 0.764, 0.01);
  });

  it("VP54 Yamagami micro-pile slope, no pile: Bishop 1.102", () => {
    const def = layered([[-6, 0], [0, 0], [8, 4], [12, 4]], -5, [{ name: "S", topY: null, model: mc(4.9, 10, 15.68) }], circle(2.674, 7.573, 8.031));
    expectNear(fos(def, "Bishop"), 1.102, 0.01);
  });
});

describe("Verification problems — round 4, critical circle search", () => {
  it("VP14 / SLOPE/W 2.11 Arai & Tagyo (1985) ex. 1: Bishop 1.417, M-P 1.414", () => {
    const def = layered([[-30, 15], [18, 15], [48, 35], [100, 35]], 0, [{ name: "S", topY: null, model: mc(41.65, 15, 18.82) }]);
    expectNear(fos(def, "Bishop"), 1.417, 0.01);
    expectNear(fos(def, "Morgenstern-Price"), 1.414, 0.01);
  });

  it("VP44 Baker (2003) ex. 1, Mohr-Coulomb fit: Spencer 1.536", () => {
    const def = layered([[-6, 0], [0, 0], [6.43, 6], [20, 6]], -4, [{ name: "S", topY: null, model: mc(11.64, 24.7, 18) }]);
    expectNear(fos(def, "Morgenstern-Price", SPENCER), 1.536, 0.015);
  });

  it("VP45 4:1 slope, Mohr-Coulomb: Spencer 2.794, Janbu simplified (uncorrected) 2.662", () => {
    const def = layered([[0, 0], [48, 12], [100, 12]], 0, [{ name: "S", topY: null, model: mc(11.64, 24.7, 18) }]);
    expectNear(fos(def, "Morgenstern-Price", SPENCER), 2.794, 0.015);
    expectNear(fos(def, "Janbu"), 2.662, 0.015);
  });

  it("VP71 Duncan & Wright fig. 6.38, piezometric line: Bishop 1.142, Spencer 1.142", () => {
    const def = layered(ft([[0, 40], [120, 40], [200, 80], [440, 80]]), 0, [{ name: "S", topY: null, model: mc(200 * PSF, 20, 125 * PCF) }], {
      waterTable: {
        mode: "custom",
        value: ft([[0, 40], [120, 40], [127.4, 43.2], [147.4, 46.2], [181.7, 50.7], [232.3, 56.7], [326.8, 65.7], [440, 75]]),
      },
    });
    expectNear(fos(def, "Bishop"), 1.142, 0.01);
    expectNear(fos(def, "Morgenstern-Price", SPENCER), 1.142, 0.01);
  });

  it("VP81 Duncan & Wright fig. 14.7, deep circle: Bishop 1.230, Spencer 1.209", () => {
    // An unrestricted search finds the infinite-slope sliver in the c = 0 fill
    // (tan 30° / tan 26.6° = 1.155); the published values are for the deep
    // circle, so entry is held to the crest and exit to the toe flat.
    const def = layered([[0, 15], [35, 15], [73, 34], [128, 34]], 0, [
      { name: "Embankment", topY: null, model: mc(0, 30, 124) },
      { name: "Foundation", topY: 15, model: mc(500, 0, 98) },
    ], { analysisLimits: { entryLeftX: 128, entryRightX: 74, exitLeftX: 34, exitRightX: 0 } });
    expectNear(fos(def, "Bishop"), 1.23, 0.01);
    expectNear(fos(def, "Morgenstern-Price", SPENCER), 1.209, 0.01);
  });

  it("VP106 Cai & Ugai (2000) slope, no pile: Bishop 1.14", () => {
    const def = layered([[0, 0], [10, 0], [25, 10], [35, 10]], -10, [{ name: "S", topY: null, model: mc(10, 20, 20) }]);
    expectNear(fos(def, "Bishop"), 1.14, 0.015);
  });
});

describe("Slice-count convergence", () => {
  it("VP23 geometry: a nearly vertical entry slice in a stiff crust does not inflate FOS", () => {
    // Low (1989) / Slide VP23 layering with the lower clay simplified to a
    // constant Su. With the arc length as base length, 50 slices gave 1.469
    // against 1.40 at 500 slices (independent 2000-slice check: 1.389).
    const def = layered(
      [[0, 8], [10, 8], [26, 16], [40, 16]],
      0,
      [
        { name: "Upper", topY: null, model: mc(95, 15, 20) },
        { name: "Middle", topY: 8, model: mc(15, 0, 20) },
        { name: "Lower", topY: 4, model: mc(22.5, 0, 20) },
      ],
      circle(18, 16, 12),
    );
    const f50 = fos(def, "Bishop", { slices: 50 });
    const f500 = fos(def, "Bishop", { slices: 500 });
    expectNear(f50, f500, 0.01);
    expectNear(f500, 1.389, 0.01);
  });
});
