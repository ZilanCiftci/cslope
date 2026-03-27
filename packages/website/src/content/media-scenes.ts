/**
 * Scene definitions for automated media capture.
 *
 * Each scene references a benchmark model by name and describes
 * the app state needed to produce a deterministic screenshot.
 */

import type { Scene } from "./media-scene-types";

export const scenes: Scene[] = [
  // ── Edit-mode scenes ──────────────────────────────────────────

  {
    id: "edit-geometry",
    title: "Slope Geometry",
    description: "Edit canvas showing slope geometry with coordinate points",
    benchmark: "Arai & Tagyo (1985)",
    setup: { mode: "edit" },
    output: { type: "png", filename: "edit-geometry.png", crop: "canvas" },
  },

  {
    id: "edit-materials",
    title: "Material Regions",
    description:
      "Non-homogeneous slope with coloured soil regions and boundaries",
    benchmark: "T-ACADS Non-Homogeneous",
    setup: { mode: "edit" },
    output: { type: "png", filename: "edit-materials.png", crop: "canvas" },
  },

  {
    id: "edit-water-table",
    title: "Piezometric Line",
    description: "Slope with water table / piezometric line visible",
    benchmark: "Arai & Tagyo (1985)",
    setup: { mode: "edit" },
    output: { type: "png", filename: "edit-water-table.png", crop: "canvas" },
  },

  {
    id: "edit-dam",
    title: "Dam Cross-Section",
    description: "Complex dam geometry with multiple material zones",
    benchmark: "Talbingo Dam",
    setup: { mode: "edit" },
    output: { type: "png", filename: "edit-dam.png", crop: "canvas" },
  },

  // ── Result-mode scenes ────────────────────────────────────────

  {
    id: "result-critical-surface",
    title: "Critical Slip Surface",
    description: "Result view showing critical failure surface with slices",
    benchmark: "T-ACADS Simple",
    setup: {
      mode: "result",
      runAnalysis: true,
      resultView: {
        showSlices: true,
        showSoilColor: true,
        showFosLabel: true,
        showCentreMarker: true,
        surfaceDisplay: "critical",
      },
    },
    output: {
      type: "png",
      filename: "result-critical-surface.png",
      crop: "canvas",
    },
  },

  {
    id: "result-all-surfaces",
    title: "All Failure Surfaces",
    description:
      "Result view with all analysed failure surfaces colour-coded by FOS",
    benchmark: "T-ACADS Simple",
    setup: {
      mode: "result",
      runAnalysis: true,
      resultView: {
        showSlices: false,
        showSoilColor: true,
        showFosLabel: false,
        showCentreMarker: false,
        surfaceDisplay: "all",
      },
    },
    output: {
      type: "png",
      filename: "result-all-surfaces.png",
      crop: "canvas",
    },
  },

  {
    id: "result-annotations",
    title: "Annotated Results",
    description:
      "Result canvas with material table, plot, and text annotations",
    benchmark: "Arai & Tagyo (1985)",
    setup: {
      mode: "result",
      runAnalysis: true,
      resultView: {
        showSlices: true,
        showSoilColor: true,
        showFosLabel: true,
      },
    },
    output: {
      type: "png",
      filename: "result-annotations.png",
      crop: "canvas",
    },
  },

  {
    id: "result-dam",
    title: "Dam Analysis",
    description: "Talbingo Dam result with critical surface through zones",
    benchmark: "Talbingo Dam",
    setup: {
      mode: "result",
      runAnalysis: true,
      resultView: {
        showSlices: true,
        showSoilColor: true,
        showFosLabel: true,
        surfaceDisplay: "critical",
      },
    },
    output: { type: "png", filename: "result-dam.png", crop: "canvas" },
  },
];
