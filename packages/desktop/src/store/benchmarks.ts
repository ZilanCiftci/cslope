/**
 * Pre-loaded example models for validation.
 */

import type { ModelEntry } from "./app-store";
import type { AnalysisOptions } from "@cslope/engine";
import {
  getDomainX,
  mirrorLimits,
  mirrorPoints,
  mirrorX,
} from "@cslope/engine";
import { DEFAULT_RESULT_VIEW_SETTINGS, PAPER_DIMENSIONS } from "./defaults";

type ExamplePaperOptions = {
  paperSize?: keyof typeof PAPER_DIMENSIONS;
  landscape?: boolean;
};

function createExampleResultViewSettings(
  coordinates: [number, number][],
  paperOptions: ExamplePaperOptions = {},
): ModelEntry["resultViewSettings"] {
  const xs = coordinates.map((c) => c[0]);
  const ys = coordinates.map((c) => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const paperSize =
    paperOptions.paperSize ?? DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.paperSize;
  const landscape = paperOptions.landscape ?? true;
  const { w, h } = PAPER_DIMENSIONS[paperSize];
  const paperWidth = landscape ? Math.max(w, h) : Math.min(w, h);
  const paperHeight = landscape ? Math.min(w, h) : Math.max(w, h);
  const margin = Math.floor((xMax - xMin) / 25); // Add 1x margin on each side
  const bottomLeftX = xMin - margin;
  const topRightX = xMax + margin;
  const bottomLeftY = yMin - margin;
  const xSpan = topRightX - bottomLeftX;
  const topRightY = bottomLeftY + (xSpan * paperHeight) / paperWidth;

  return {
    ...DEFAULT_RESULT_VIEW_SETTINGS,
    paperFrame: {
      ...DEFAULT_RESULT_VIEW_SETTINGS.paperFrame,
      paperSize,
      landscape,
    },
    viewLock: {
      bottomLeft: [bottomLeftX, bottomLeftY],
      topRight: [topRightX, topRightY],
    },
    showFosLabel: false,
    showCentreMarker: false,
    showGrid: false,
    showSoilColor: true,
    annotations: [
      {
        id: "anno-8d2aabaf-31cb-43b5-b9a5-980aa7354464",
        type: "text",
        x: 0.11,
        y: 0.08,
        text: "#Title",
        fontSize: 24,
      },
      {
        id: "anno-89ddb1d9-0f29-4483-849a-bf5c09ea5076",
        type: "text",
        x: 0.11,
        y: 0.14,
        text: "#Subtitle",
        fontSize: 14,
      },
      {
        id: "anno-c4e72f10-8a61-4d2b-9c3e-5f1a0b7d8e92",
        type: "text",
        x: 0.11,
        y: 0.18,
        text: "Calculate FOS: #FOS",
        fontSize: 14,
      },
      {
        id: "anno-benchmark-material-table",
        type: "material-table",
        x: 0.95,
        y: 0.05,
        anchor: "top-right",
        fontSize: 6,
        tableColumns: ["model", "unitWeight", "cohesion", "frictionAngle"],
      },
    ],
  };
}

// ────────────────────────────────────────────────────────────────
// 1. T-ACADS Simple — homogeneous slope, single material
//    Source: examples/validation/t_acads_simple.py
// ────────────────────────────────────────────────────────────────

const TACADS_SIMPLE: ModelEntry = {
  id: "example-tacads-simple",
  name: "T-ACADS Simple",
  projectInfo: {
    title: "T-ACADS Simple",
    subtitle: "Published FOS result: 1.00",
    client: "",
    projectNumber: "",
    revision: "1",
    author: "Zilan Ciftci",
    checker: "",
    date: "",
    description: "",
    canvasWidth: 1000,
    canvasHeight: 1000,
  },
  orientation: "ltr",
  coordinates: [
    [0, -15],
    [0, 0],
    [20, 0],
    [40, -10],
    [50, -10],
    [50, -15],
  ],
  materials: [
    {
      id: "mat-ex1",
      name: "M1",
      color: "#6d5f2a",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 20,
        frictionAngle: 19.6,
        cohesion: 3,
      },
    },
  ],
  materialBoundaries: [],
  regionMaterials: [],
  piezometricLine: {
    enabled: false,
    lines: [],
    activeLineId: null,
    materialAssignment: {},
  },
  udls: [],
  lineLoads: [],
  customSearchPlanes: [],
  customPlanesOnly: false,
  options: {
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
    minFailureDist: 0,
    tolerance: 0.005,
    maxIterations: 15,
    method: "Morgenstern-Price",
  } satisfies AnalysisOptions,
  analysisLimits: {
    enabled: true,
    entryLeftX: 17,
    entryRightX: 22,
    exitLeftX: 37,
    exitRightX: 43,
  },
  resultViewSettings: createExampleResultViewSettings([
    [0, -15],
    [0, 0],
    [20, 0],
    [40, -10],
    [50, -10],
    [50, -15],
  ]),
};

// ────────────────────────────────────────────────────────────────
// 2. T-ACADS Non-Homogeneous — 3 materials, 2 interior boundaries
//    Source: examples/validation/t_acads_non_homogenous.py
// ────────────────────────────────────────────────────────────────

const TACADS_NONHOMOGENEOUS: ModelEntry = {
  id: "example-tacads-nonhomo",
  name: "T-ACADS Non-Homogeneous",
  projectInfo: {
    title: "T-ACADS Non-Homogeneous",
    subtitle: "Published FOS result: 1.39",
    client: "",
    projectNumber: "",
    revision: "0",
    author: "",
    checker: "",
    date: "",
    description: "",
    canvasWidth: 1000,
    canvasHeight: 1000,
  },
  orientation: "ltr",
  coordinates: [
    [0, -15],
    [0, 0],
    [20, 0],
    [40, -10],
    [50, -10],
    [50, -15],
  ],
  materials: [
    {
      id: "mat-ex2a",
      name: "Soil #1",
      color: "#6d5f2a",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 19.5,
        frictionAngle: 38,
        cohesion: 0,
      },
    },
    {
      id: "mat-ex2b",
      name: "Soil #2",
      color: "#8c731a",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 19.5,
        frictionAngle: 23,
        cohesion: 5.3,
      },
    },
    {
      id: "mat-ex2c",
      name: "Soil #3",
      color: "#636d2a",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 19.5,
        frictionAngle: 20,
        cohesion: 7.2,
      },
    },
  ],
  materialBoundaries: [
    {
      id: "bnd-ex2a",
      coordinates: [
        [0, -11],
        [18, -11],
        [30, -8],
        [20, -6],
        [16, -4],
        [0, -4],
        [0, -11],
      ],
    },
    {
      id: "bnd-ex2b",
      coordinates: [
        [0, -11],
        [18, -11],
        [30, -8],
        [40, -10],
      ],
    },
  ],
  regionMaterials: [
    { point: [25, -5], materialId: "mat-ex2a" },
    { point: [9, -7], materialId: "mat-ex2b" },
    { point: [25, -13], materialId: "mat-ex2c" },
  ],
  piezometricLine: {
    enabled: false,
    lines: [],
    activeLineId: null,
    materialAssignment: {},
  },
  udls: [],
  lineLoads: [],
  customSearchPlanes: [],
  customPlanesOnly: false,
  options: {
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
    minFailureDist: 0,
    tolerance: 0.005,
    maxIterations: 15,
    method: "Morgenstern-Price",
  } satisfies AnalysisOptions,
  analysisLimits: {
    enabled: true,
    entryLeftX: 16,
    entryRightX: 21.5,
    exitLeftX: 38.5,
    exitRightX: 42.5,
  },
  resultViewSettings: createExampleResultViewSettings([
    [0, -15],
    [0, 0],
    [20, 0],
    [40, -10],
    [50, -10],
    [50, -15],
  ]),
};

// ────────────────────────────────────────────────────────────────
// 3. Arai & Tagyo — water table (piezometric line)
//    Source: examples/validation/arai_tagyo.py
// ────────────────────────────────────────────────────────────────

const ARAI_TAGYO: ModelEntry = {
  id: "example-arai-tagyo",
  name: "Arai & Tagyo (1985)",
  projectInfo: {
    title: "Arai & Tagyo (1985)",
    subtitle: "Published FOS result: 1.138",
    client: "",
    projectNumber: "",
    revision: "0",
    author: "",
    checker: "",
    date: "",
    description: "",
    canvasWidth: 1000,
    canvasHeight: 1000,
  },
  orientation: "ltr",
  coordinates: [
    [0, 0],
    [0, 35],
    [18, 35],
    [48, 15],
    [66, 15],
    [66, 0],
  ],
  materials: [
    {
      id: "mat-ex3",
      name: "Soil",
      color: "#6d5f2a",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 18.82,
        frictionAngle: 15,
        cohesion: 41.65,
      },
    },
  ],
  materialBoundaries: [],
  regionMaterials: [],
  piezometricLine: {
    enabled: true,
    lines: [
      {
        id: "piezo-ex3",
        name: "Water Table",
        color: "#3b82f6",
        coordinates: [
          [0, 32],
          [18, 29],
          [36, 23],
          [48, 15],
          [66, 15],
        ],
      },
    ],
    activeLineId: "piezo-ex3",
    materialAssignment: {},
  },
  udls: [],
  lineLoads: [],
  customSearchPlanes: [],
  customPlanesOnly: false,
  options: {
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
    minFailureDist: 0,
    tolerance: 0.001,
    maxIterations: 15,
    method: "Morgenstern-Price",
  } satisfies AnalysisOptions,
  analysisLimits: {
    enabled: true,
    entryLeftX: 0,
    entryRightX: 18,
    exitLeftX: 48,
    exitRightX: 66,
  },
  resultViewSettings: createExampleResultViewSettings([
    [0, 0],
    [0, 35],
    [18, 35],
    [48, 15],
    [66, 15],
    [66, 0],
  ]),
};

// ────────────────────────────────────────────────────────────────
// 4. Talbingo Dam — RTL validation model
// ────────────────────────────────────────────────────────────────

const TALBINGO_DAM_RTL: ModelEntry = {
  id: "example-talbingo-dam",
  name: "Talbingo Dam",
  projectInfo: {
    title: "Talbingo Dam",
    subtitle: "Published FOS result: 1.95",
    client: "",
    projectNumber: "",
    revision: "0",
    author: "",
    checker: "",
    date: "",
    description: "",
    canvasWidth: 1000,
    canvasHeight: 1000,
  },
  orientation: "rtl",
  coordinates: [
    [0, 0],
    [315.5, 162],
    [319.5, 162],
    [321.6, 162],
    [327.6, 162],
    [386.9, 130.6],
    [394.1, 130.6],
    [453.4, 97.9],
    [460.6, 97.9],
    [515, 65.3],
    [521.1, 65.3],
    [577.9, 31.4],
    [585.1, 31.4],
    [648, 0],
    [0, 0],
  ],
  materials: [
    {
      id: "mat-tal-rockfill",
      name: "Rockfill",
      color: "#ffd51a",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 20.4,
        frictionAngle: 45,
        cohesion: 0,
      },
    },
    {
      id: "mat-tal-transition",
      name: "Transition",
      color: "#1a8c4a",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 20.4,
        frictionAngle: 45,
        cohesion: 0,
      },
    },
    {
      id: "mat-tal-filter",
      name: "Filter",
      color: "#6d2a2a",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 20.4,
        frictionAngle: 45,
        cohesion: 0,
      },
    },
    {
      id: "mat-tal-core",
      name: "Core",
      color: "#5739a8",
      model: {
        kind: "mohr-coulomb",
        unitWeight: 18.1,
        frictionAngle: 23,
        cohesion: 85.0,
      },
    },
  ],
  materialBoundaries: [
    {
      id: "bnd-tal-1",
      coordinates: [
        [168.1, 0],
        [302.2, 130.6],
        [315.5, 162],
      ],
    },
    {
      id: "bnd-tal-2",
      coordinates: [
        [200.7, 0],
        [311.9, 130.6],
        [319.5, 162],
      ],
    },
    {
      id: "bnd-tal-3",
      coordinates: [
        [307.1, 0],
        [331.3, 130.6],
        [328.8, 146.1],
        [327.6, 162],
      ],
    },
    {
      id: "bnd-tal-4",
      coordinates: [
        [310.7, 0],
        [333.7, 130.6],
        [331.3, 146.1],
        [328.8, 146.1],
      ],
    },
    {
      id: "bnd-tal-5",
      coordinates: [
        [372.4, 0],
        [347, 130.6],
        [327.6, 162],
      ],
    },
  ],
  regionMaterials: [
    { point: [80, 10], materialId: "mat-tal-rockfill" },
    { point: [185, 10], materialId: "mat-tal-transition" },
    { point: [250, 10], materialId: "mat-tal-core" },
    { point: [309, 10], materialId: "mat-tal-filter" },
    { point: [340, 10], materialId: "mat-tal-filter" },
    { point: [500, 10], materialId: "mat-tal-rockfill" },
  ],
  piezometricLine: {
    enabled: false,
    lines: [],
    activeLineId: null,
    materialAssignment: {},
  },
  udls: [],
  lineLoads: [],
  customSearchPlanes: [],
  customPlanesOnly: false,
  options: {
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
    minFailureDist: 0,
    tolerance: 0.001,
    maxIterations: 15,
    method: "Morgenstern-Price",
  } satisfies AnalysisOptions,
  analysisLimits: {
    enabled: true,
    entryLeftX: 327.6,
    entryRightX: 290.0,
    exitLeftX: 150.0,
    exitRightX: 0,
  },
  resultViewSettings: createExampleResultViewSettings([
    [0, 0],
    [315.5, 162],
    [319.5, 162],
    [321.6, 162],
    [327.6, 162],
    [386.9, 130.6],
    [394.1, 130.6],
    [453.4, 97.9],
    [460.6, 97.9],
    [515, 65.3],
    [521.1, 65.3],
    [577.9, 31.4],
    [585.1, 31.4],
    [648, 0],
    [0, 0],
  ]),
};

export function mirrorModelEntry(model: ModelEntry): ModelEntry {
  const [xMin, xMax] = getDomainX(model.coordinates);

  return {
    ...model,
    id: `${model.id}-rtl`,
    name: `${model.name} (RTL Mirrored)`,
    orientation: "rtl",
    coordinates: mirrorPoints(model.coordinates, xMin, xMax),
    materialBoundaries: model.materialBoundaries.map((boundary) => ({
      ...boundary,
      coordinates: mirrorPoints(boundary.coordinates, xMin, xMax),
    })),
    regionMaterials: model.regionMaterials.map((a) => ({
      ...a,
      point: [mirrorX(a.point[0], xMin, xMax), a.point[1]] as [number, number],
    })),
    piezometricLine: {
      ...model.piezometricLine,
      lines: model.piezometricLine.lines.map((line) => ({
        ...line,
        coordinates: mirrorPoints(line.coordinates, xMin, xMax),
      })),
      activeLineId: model.piezometricLine.activeLineId,
    },
    udls: model.udls.map((udl) => {
      const x1 = mirrorX(udl.x2, xMin, xMax);
      const x2 = mirrorX(udl.x1, xMin, xMax);
      return {
        ...udl,
        x1: Math.min(x1, x2),
        x2: Math.max(x1, x2),
      };
    }),
    lineLoads: model.lineLoads.map((lineLoad) => ({
      ...lineLoad,
      x: mirrorX(lineLoad.x, xMin, xMax),
    })),
    customSearchPlanes: (model.customSearchPlanes ?? []).map((p) => ({
      ...p,
      cx: mirrorX(p.cx, xMin, xMax),
    })),
    analysisLimits: model.analysisLimits.enabled
      ? {
          ...model.analysisLimits,
          ...mirrorLimits(model.analysisLimits, xMin, xMax),
        }
      : { ...model.analysisLimits },
  };
}

// ────────────────────────────────────────────────────────────────
// 5. Talbingo Dam (Single Circle) — RTL, prescribed slip surface
//    Circle: cx=100.3, cy=291.0, R=278.8  (model-space RTL)
//    Published FOS: 2.29 (Morgenstern-Price)
// ────────────────────────────────────────────────────────────────

const TALBINGO_SINGLE_CIRCLE: ModelEntry = {
  ...TALBINGO_DAM_RTL,
  id: "example-talbingo-dam-single",
  name: "Talbingo Dam (Single Circle)",
  projectInfo: {
    ...TALBINGO_DAM_RTL.projectInfo!,
    title: "Talbingo Dam (Single Circle)",
    subtitle: "Published FOS result: 2.29",
  },
  customSearchPlanes: [
    { id: "csp-talbingo-1", cx: 100.3, cy: 291.0, radius: 278.8 },
  ],
  customPlanesOnly: true,
};

//const TACADS_SIMPLE_RTL = mirrorModelEntry(TACADS_SIMPLE);
//const TACADS_NONHOMOGENEOUS_RTL = mirrorModelEntry(TACADS_NONHOMOGENEOUS);
//const ARAI_TAGYO_RTL = mirrorModelEntry(ARAI_TAGYO);

// ── Export all examples ────────────────────────────────────────

export const BENCHMARK_MODELS: ModelEntry[] = [
  TACADS_SIMPLE,
  //TACADS_SIMPLE_RTL,
  TACADS_NONHOMOGENEOUS,
  //TACADS_NONHOMOGENEOUS_RTL,
  ARAI_TAGYO,
  //ARAI_TAGYO_RTL,
  TALBINGO_DAM_RTL,
  TALBINGO_SINGLE_CIRCLE,
];

export const EXAMPLE_MODELS = BENCHMARK_MODELS;

/**
 * Published / reference FOS values for each benchmark model and method.
 *
 * Sources:
 *   - T-ACADS: "Slope Stability Programs — Verification Manual", ACADS (1985)
 *   - Arai & Tagyo: Arai, K. & Tagyo, K. (1985) "Determination of non-circular
 *     slip surfaces in slope stability analysis", Soils and Foundations, 25(1).
 *   - Talbingo Dam: Published dam safety analysis results.
 */
export type PublishedBenchmark = {
  modelId: string;
  name: string;
  method: string;
  publishedFos: number;
  /** Acceptable ± tolerance (absolute). Wider for search-dependent results. */
  tolerance: number;
};

export const PUBLISHED_BENCHMARKS: PublishedBenchmark[] = [
  // T-ACADS Simple Slope — single homogeneous material
  {
    modelId: "example-tacads-simple",
    name: "T-ACADS Simple",
    method: "Morgenstern-Price",
    publishedFos: 0.984,
    tolerance: 0.05,
  },
  {
    modelId: "example-tacads-simple",
    name: "T-ACADS Simple",
    method: "Bishop",
    publishedFos: 0.985,
    tolerance: 0.05,
  },
  {
    modelId: "example-tacads-simple",
    name: "T-ACADS Simple",
    method: "Janbu",
    publishedFos: 0.938,
    tolerance: 0.05,
  },

  // T-ACADS Non-Homogeneous — 3 materials, 2 interior boundaries
  {
    modelId: "example-tacads-nonhomo",
    name: "T-ACADS Non-Homogeneous",
    method: "Morgenstern-Price",
    publishedFos: 1.373,
    tolerance: 0.05,
  },

  // Arai & Tagyo (1985) — with water table
  {
    modelId: "example-arai-tagyo",
    name: "Arai & Tagyo (1985)",
    method: "Bishop",
    publishedFos: 1.138,
    tolerance: 0.05,
  },

  // Talbingo Dam — RTL multi-material dam
  {
    modelId: "example-talbingo-dam",
    name: "Talbingo Dam",
    method: "Morgenstern-Price",
    publishedFos: 1.95,
    tolerance: 0.05,
  },

  // Talbingo Dam (Single Circle) — prescribed slip surface
  {
    modelId: "example-talbingo-dam-single",
    name: "Talbingo Dam (Single Circle)",
    method: "Morgenstern-Price",
    publishedFos: 2.29,
    tolerance: 0.05,
  },
];
