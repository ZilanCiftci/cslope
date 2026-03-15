/**
 * Lovö — Development / test model.
 *
 * Lovö - Sektion 1/870, Odränerad analys
 *   Schaktdjup 2.3 m, Släntlutning 1:1
 *   Last 2 m från krön, q_d = 19.1 kPa
 *   Byggväg avsänkt 0.2 m
 *   F2d: 0.808, F3d: 0.908
 */

import type { ModelEntry } from "./app-store";
import type { AnalysisOptions } from "@cslope/engine";

export const LOVO_MODELS: ModelEntry[] = [
  {
    id: "lovo-1870-nedsänkt",
    name: "Lovö 1/870 Nedsänkt",
    projectInfo: {
      title: "Lovö - Sektion 1/870",
      subtitle: "Odränerad analys — Förväntad: 0.808",
      client: "",
      projectNumber: "",
      revision: "0",
      author: "Zilan Ciftci",
      checker: "",
      date: "",
      description:
        "Schaktdjup 2.3 m, Släntlutning 1:1, Last 2 m från krön, Byggväg avsänkt 0.2 m",
      canvasWidth: 1000,
      canvasHeight: 1000,
    },
    orientation: "ltr",

    // ── Exterior boundary ──────────────────────────────────────
    coordinates: [
      [0, -10],
      [0, 0],
      [12, 0],
      [14.3, -2.3],
      [16.3, -2.3],
      [18.6, 0],
      [30, 0],
      [30, -10],
    ],

    // ── Materials ──────────────────────────────────────────────
    materials: [
      {
        id: "mat-lovo-f",
        name: "F",
        color: "#808080",
        model: {
          kind: "mohr-coulomb",
          unitWeight: 18.0,
          frictionAngle: 32.3,
          cohesion: 0,
        },
      },
      {
        id: "mat-lovo-let",
        name: "Let",
        color: "#8B6914",
        model: {
          kind: "undrained",
          unitWeight: 17.0,
          undrainedShearStrength: 20.0,
        },
      },
      {
        id: "mat-lovo-le1",
        name: "Le 1",
        color: "#DAA520",
        model: {
          kind: "s-f-datum",
          unitWeight: 17.0,
          suRef: 19.0,
          yRef: -1.7,
          rate: -12.7,
        },
      },
      {
        id: "mat-lovo-le2",
        name: "Le 2",
        color: "#FFD700",
        model: {
          kind: "undrained",
          unitWeight: 17.0,
          undrainedShearStrength: 6.3,
        },
      },
      {
        id: "mat-lovo-fr",
        name: "Fr",
        color: "#4682B4",
        model: {
          kind: "mohr-coulomb",
          unitWeight: 20.0,
          frictionAngle: 28.3,
          cohesion: 0,
        },
      },
    ],

    // ── Interior boundaries (horizontal layer interfaces) ──────
    materialBoundaries: [
      {
        id: "bnd-lovo-1",
        coordinates: [
          [3.5, 0],
          [4.0, -0.5],
          [9.5, -0.5],
          [10, 0],
        ],
      },
      {
        id: "bnd-lovo-2",
        coordinates: [
          [0, -1.7],
          [30, -1.7],
        ],
      },
      {
        id: "bnd-lovo-3",
        coordinates: [
          [0, -2.7],
          [30, -2.7],
        ],
      },
      {
        id: "bnd-lovo-4",
        coordinates: [
          [0, -4.1],
          [30, -4.1],
        ],
      },
    ],

    // ── Region material assignments ────────────────────────────
    regionMaterials: [
      { point: [6, 0], materialId: "mat-lovo-f" },
      { point: [6, -1], materialId: "mat-lovo-let" },
      { point: [6, -2], materialId: "mat-lovo-le1" },
      { point: [6, -3], materialId: "mat-lovo-le2" },
      { point: [6, -7], materialId: "mat-lovo-fr" },
      // Right side (road surface at y=-0.2)
      { point: [25, -1], materialId: "mat-lovo-let" },
      { point: [25, -2], materialId: "mat-lovo-le1" },
      { point: [25, -3], materialId: "mat-lovo-le2" },
      { point: [25, -7], materialId: "mat-lovo-fr" },
    ],

    // ── Piezometric line ───────────────────────────────────────
    piezometricLine: {
      enabled: true,
      lines: [
        {
          id: "piezo-lovo-1",
          name: "Water Table",
          color: "#3b82f6",
          coordinates: [
            [0, -1.3],
            [13.3, -1.3],
            [14.3, -2.3],
            [16.3, -2.3],
            [17.3, -1.3],
            [30, -1.3],
          ],
        },
      ],
      activeLineId: "piezo-lovo-1",
      materialAssignment: {},
    },

    // ── Loads ──────────────────────────────────────────────────
    // q_d = 19.1 kPa, 2 m from crest (crest at x=10)
    udls: [{ id: "udl-lovo-1", magnitude: 19.1, x1: 3.5, x2: 10.0 }],
    lineLoads: [],

    // ── Analysis settings ──────────────────────────────────────
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
      entryLeftX: 3,
      entryRightX: 12.3,
      exitLeftX: 14.3,
      exitRightX: 16.3,
    },
  },
  {
    id: "lovo-1870",
    name: "Lovö 1/870",
    projectInfo: {
      title: "Lovö - Sektion 1/870",
      subtitle: "Odränerad analys — Förväntad: 0.808",
      client: "",
      projectNumber: "",
      revision: "0",
      author: "Zilan Ciftci",
      checker: "",
      date: "",
      description:
        "Schaktdjup 2.3 m, Släntlutning 1:1, Last 2 m från krön, Byggväg avsänkt 0.2 m",
      canvasWidth: 1000,
      canvasHeight: 1000,
    },
    orientation: "ltr",

    // ── Exterior boundary ──────────────────────────────────────
    coordinates: [
      [0, -10],
      [0, 0],
      [2.8, 0],
      [3.1, 0.3],
      [9.7, 0.3],
      [10, 0],
      [12, 0],
      [14.3, -2.3],
      [16.3, -2.3],
      [18.6, 0],
      [30, 0],
      [30, -10],
    ],

    // ── Materials ──────────────────────────────────────────────
    materials: [
      {
        id: "mat-lovo-f",
        name: "F",
        color: "#808080",
        model: {
          kind: "mohr-coulomb",
          unitWeight: 18.0,
          frictionAngle: 32.3,
          cohesion: 0,
        },
      },
      {
        id: "mat-lovo-let",
        name: "Let",
        color: "#8B6914",
        model: {
          kind: "undrained",
          unitWeight: 17.0,
          undrainedShearStrength: 20.0,
        },
      },
      {
        id: "mat-lovo-le1",
        name: "Le 1",
        color: "#DAA520",
        model: {
          kind: "s-f-datum",
          unitWeight: 17.0,
          suRef: 19.0,
          yRef: -1.7,
          rate: -12.7,
        },
      },
      {
        id: "mat-lovo-le2",
        name: "Le 2",
        color: "#FFD700",
        model: {
          kind: "undrained",
          unitWeight: 17.0,
          undrainedShearStrength: 6.3,
        },
      },
      {
        id: "mat-lovo-fr",
        name: "Fr",
        color: "#4682B4",
        model: {
          kind: "mohr-coulomb",
          unitWeight: 20.0,
          frictionAngle: 28.3,
          cohesion: 0,
        },
      },
    ],

    // ── Interior boundaries (horizontal layer interfaces) ──────
    materialBoundaries: [
      {
        id: "bnd-lovo-1",
        coordinates: [
          [2.8, 0],
          [3.0, -0.2],
          [9.8, -0.2],
          [10, 0],
        ],
      },
      {
        id: "bnd-lovo-2",
        coordinates: [
          [0, -1.7],
          [30, -1.7],
        ],
      },
      {
        id: "bnd-lovo-3",
        coordinates: [
          [0, -2.7],
          [30, -2.7],
        ],
      },
      {
        id: "bnd-lovo-4",
        coordinates: [
          [0, -4.1],
          [30, -4.1],
        ],
      },
    ],

    // ── Region material assignments ────────────────────────────
    regionMaterials: [
      { point: [6, 0], materialId: "mat-lovo-f" },
      { point: [6, -1], materialId: "mat-lovo-let" },
      { point: [6, -2], materialId: "mat-lovo-le1" },
      { point: [6, -3], materialId: "mat-lovo-le2" },
      { point: [6, -7], materialId: "mat-lovo-fr" },
      // Right side (road surface at y=-0.2)
      { point: [25, -1], materialId: "mat-lovo-let" },
      { point: [25, -2], materialId: "mat-lovo-le1" },
      { point: [25, -3], materialId: "mat-lovo-le2" },
      { point: [25, -7], materialId: "mat-lovo-fr" },
    ],

    // ── Piezometric line ───────────────────────────────────────
    piezometricLine: {
      enabled: true,
      lines: [
        {
          id: "piezo-lovo-1",
          name: "Water Table",
          color: "#3b82f6",
          coordinates: [
            [0, -1.3],
            [13.3, -1.3],
            [14.3, -2.3],
            [16.3, -2.3],
            [17.3, -1.3],
            [30, -1.3],
          ],
        },
      ],
      activeLineId: "piezo-lovo-1",
      materialAssignment: {},
    },

    // ── Loads ──────────────────────────────────────────────────
    // q_d = 19.1 kPa, 2 m from crest (crest at x=10)
    udls: [{ id: "udl-lovo-1", magnitude: 19.1, x1: 3.1, x2: 9.7 }],
    lineLoads: [],

    // ── Analysis settings ──────────────────────────────────────
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
      entryLeftX: 3,
      entryRightX: 12.3,
      exitLeftX: 14.3,
      exitRightX: 16,
    },
  },
];
