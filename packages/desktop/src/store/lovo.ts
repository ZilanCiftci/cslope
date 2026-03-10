/**
 * Lovö — Development / test model.
 *
 * Lovö - Sektion 1/870, Odränerad analys
 *   Schaktdjup 2.3 m, Släntlutning 1:1
 *   Last 2 m från krön, q_d = 19.1 kPa
 *   Byggväg avsänkt 0.5 m
 *   F2d: 0.808, F3d: 0.908
 */

import type { ModelEntry } from "./app-store";
import type { AnalysisOptions } from "@cslope/engine";

export const LOVO_MODELS: ModelEntry[] = [
  {
    id: "lovo-1870",
    name: "Lovö 1/870",
    projectInfo: {
      title: "Lovö - Sektion 1/870",
      subtitle: "Odränerad analys — F2d: 0.808",
      client: "",
      projectNumber: "",
      revision: "0",
      author: "Zilan Ciftci",
      checker: "",
      date: "",
      description:
        "Schaktdjup 2.3 m, Släntlutning 1:1, Last 2 m från krön, Byggväg avsänkt 0.5 m",
      canvasWidth: 1000,
      canvasHeight: 1000,
    },
    orientation: "ltr",

    // ── Exterior boundary ──────────────────────────────────────
    // Left side flat at y=0, crest at x=10, 1:1 slope down 2.3 m,
    // flat excavation bottom, right side back to y=-0.5 (lowered road),
    // then flat to x=30.
    coordinates: [
      [0, -10],
      [0, 0],
      [10, 0],
      [12.3, -2.3],
      [18, -2.3],
      [18, -0.5],
      [30, -0.5],
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
          [0, -0.5],
          [30, -0.5],
        ],
      },
      {
        id: "bnd-lovo-2",
        coordinates: [
          [0, -1.0],
          [30, -1.0],
        ],
      },
      {
        id: "bnd-lovo-3",
        coordinates: [
          [0, -2.0],
          [30, -2.0],
        ],
      },
      {
        id: "bnd-lovo-4",
        coordinates: [
          [0, -4.0],
          [30, -4.0],
        ],
      },
    ],

    // ── Region material assignments ────────────────────────────
    // Representative points inside each region.
    regionMaterials: [
      { point: [5, -0.2], materialId: "mat-lovo-f" },
      { point: [5, -0.7], materialId: "mat-lovo-let" },
      { point: [5, -1.5], materialId: "mat-lovo-le1" },
      { point: [5, -3.0], materialId: "mat-lovo-le2" },
      { point: [5, -7.0], materialId: "mat-lovo-fr" },
      // Excavation bottom regions
      { point: [15, -2.8], materialId: "mat-lovo-le2" },
      { point: [15, -7.0], materialId: "mat-lovo-fr" },
      // Right side (road surface at y=-0.5)
      { point: [25, -0.7], materialId: "mat-lovo-let" },
      { point: [25, -1.5], materialId: "mat-lovo-le1" },
      { point: [25, -3.0], materialId: "mat-lovo-le2" },
      { point: [25, -7.0], materialId: "mat-lovo-fr" },
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
            [0, -1.0],
            [10, -1.0],
            [12.3, -2.3],
            [18, -2.3],
            [18, -1.5],
            [30, -1.5],
          ],
        },
      ],
      activeLineId: "piezo-lovo-1",
      materialAssignment: {},
    },

    // ── Loads ──────────────────────────────────────────────────
    // q_d = 19.1 kPa, 2 m from crest (crest at x=10)
    udls: [{ id: "udl-lovo-1", magnitude: 19.1, x1: 5, x2: 8 }],
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
      limitBishop: 5,
      limitJanbu: 5,
      limitMorgensternPrice: 5,
    } satisfies AnalysisOptions,
    analysisLimits: {
      enabled: true,
      entryLeftX: 5,
      entryRightX: 12,
      exitLeftX: 14,
      exitRightX: 20,
    },
  },
];
