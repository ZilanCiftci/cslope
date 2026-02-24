/**
 * Pre-loaded example models for validation.
 */

import type { ModelEntry } from "./app-store";
import type { AnalysisOptions } from "../engine/types/analysis";
import {
  getDomainX,
  mirrorLimits,
  mirrorPoints,
  mirrorX,
} from "../engine/model/canonical";

// ────────────────────────────────────────────────────────────────
// 1. T-ACADS Simple — homogeneous slope, single material
//    Source: examples/validation/t_acads_simple.py
// ────────────────────────────────────────────────────────────────

const TACADS_SIMPLE: ModelEntry = {
  id: "example-tacads-simple",
  name: "T-ACADS Simple",
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
      unitWeight: 20,
      frictionAngle: 19.6,
      cohesion: 3,
      color: "#6d5f2a",
    },
  ],
  materialBoundaries: [],
  regionMaterials: { top: "mat-ex1" },
  piezometricLine: {
    enabled: false,
    lines: [],
    activeLineId: null,
    materialAssignment: {},
  },
  udls: [],
  lineLoads: [],
  options: {
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
    minFailureDist: 0,
    tolerance: 0.005,
    maxIterations: 15,
    method: "Morgenstern-Price",
    limitBishop: 5,
    limitJanbu: 5,
    limitMorgensternPrice: 5,
  } satisfies AnalysisOptions,
  analysisLimits: {
    enabled: true,
    entryLeftX: 17,
    entryRightX: 22,
    exitLeftX: 37,
    exitRightX: 43,
  },
};

// ────────────────────────────────────────────────────────────────
// 2. T-ACADS Non-Homogeneous — 3 materials, 2 interior boundaries
//    Source: examples/validation/t_acads_non_homogenous.py
// ────────────────────────────────────────────────────────────────

const TACADS_NONHOMOGENEOUS: ModelEntry = {
  id: "example-tacads-nonhomo",
  name: "T-ACADS Non-Homogeneous",
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
      unitWeight: 19.5,
      frictionAngle: 38,
      cohesion: 0,
      color: "#6d5f2a",
    },
    {
      id: "mat-ex2b",
      name: "Soil #2",
      unitWeight: 19.5,
      frictionAngle: 23,
      cohesion: 5.3,
      color: "#8c731a",
    },
    {
      id: "mat-ex2c",
      name: "Soil #3",
      unitWeight: 19.5,
      frictionAngle: 20,
      cohesion: 7.2,
      color: "#636d2a",
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
  regionMaterials: {
    top: "mat-ex2a",
    "below-bnd-ex2a": "mat-ex2b",
    "below-bnd-ex2b": "mat-ex2c",
  },
  piezometricLine: {
    enabled: false,
    lines: [],
    activeLineId: null,
    materialAssignment: {},
  },
  udls: [],
  lineLoads: [],
  options: {
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
    minFailureDist: 0,
    tolerance: 0.005,
    maxIterations: 15,
    method: "Morgenstern-Price",
    limitBishop: 5,
    limitJanbu: 5,
    limitMorgensternPrice: 5,
  } satisfies AnalysisOptions,
  analysisLimits: {
    enabled: true,
    entryLeftX: 16,
    entryRightX: 21.5,
    exitLeftX: 38.5,
    exitRightX: 42.5,
  },
};

// ────────────────────────────────────────────────────────────────
// 3. Arai & Tagyo — water table (piezometric line)
//    Source: examples/validation/arai_tagyo.py
// ────────────────────────────────────────────────────────────────

const ARAI_TAGYO: ModelEntry = {
  id: "example-arai-tagyo",
  name: "Arai & Tagyo (1985)",
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
      unitWeight: 18.82,
      frictionAngle: 15,
      cohesion: 41.65,
      color: "#6d5f2a",
    },
  ],
  materialBoundaries: [],
  regionMaterials: { top: "mat-ex3" },
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
  options: {
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
    minFailureDist: 0,
    tolerance: 0.001,
    maxIterations: 15,
    method: "Morgenstern-Price",
    limitBishop: 5,
    limitJanbu: 5,
    limitMorgensternPrice: 5,
  } satisfies AnalysisOptions,
  analysisLimits: {
    enabled: true,
    entryLeftX: 0,
    entryRightX: 18,
    exitLeftX: 48,
    exitRightX: 66,
  },
};

// ────────────────────────────────────────────────────────────────
// 4. Talbingo Dam — RTL validation model
// ────────────────────────────────────────────────────────────────

const TALBINGO_DAM_RTL: ModelEntry = {
  id: "example-talbingo-dam",
  name: "Talbingo Dam",
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
      unitWeight: 20.4,
      frictionAngle: 45,
      cohesion: 0,
      color: "#ffd51a",
    },
    {
      id: "mat-tal-transition",
      name: "Transition",
      unitWeight: 20.4,
      frictionAngle: 45,
      cohesion: 0,
      color: "#1a8c4a",
    },
    {
      id: "mat-tal-filter",
      name: "Filter",
      unitWeight: 20.4,
      frictionAngle: 45,
      cohesion: 0,
      color: "#6d2a2a",
    },
    {
      id: "mat-tal-core",
      name: "Core",
      unitWeight: 18.1,
      frictionAngle: 23,
      cohesion: 85.0,
      color: "#5739a8",
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
  regionMaterials: {
    top: "mat-tal-rockfill",
    "below-bnd-tal-1": "mat-tal-transition",
    "below-bnd-tal-2": "mat-tal-core",
    "below-bnd-tal-3": "mat-tal-filter",
    "below-bnd-tal-4": "mat-tal-filter",
    "below-bnd-tal-5": "mat-tal-transition",
    "below-bnd-tal-1+bnd-tal-2": "mat-tal-core",
  },
  piezometricLine: {
    enabled: false,
    lines: [],
    activeLineId: null,
    materialAssignment: {},
  },
  udls: [],
  lineLoads: [],
  options: {
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
    minFailureDist: 0,
    tolerance: 0.001,
    maxIterations: 15,
    method: "Morgenstern-Price",
    limitBishop: 5,
    limitJanbu: 5,
    limitMorgensternPrice: 5,
  } satisfies AnalysisOptions,
  analysisLimits: {
    enabled: true,
    entryLeftX: 327.6,
    entryRightX: 290.0,
    exitLeftX: 150.0,
    exitRightX: 0,
  },
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
    analysisLimits: model.analysisLimits.enabled
      ? {
          ...model.analysisLimits,
          ...mirrorLimits(model.analysisLimits, xMin, xMax),
        }
      : { ...model.analysisLimits },
  };
}

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
];

export const EXAMPLE_MODELS = BENCHMARK_MODELS;
