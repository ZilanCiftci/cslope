/**
 * Scene definitions for automated media capture.
 *
 * Each scene references a benchmark model by name and describes
 * the app state needed to produce a deterministic screenshot.
 */

import type { Scene, SceneOutput, SceneSetup } from "./media-scene-types";

interface TutorialScene {
  id: string;
  title: string;
  setup: SceneSetup;
  crop: SceneOutput["crop"];
  window?: string;
  fitHeight?: boolean;
}

/** The scenes of one tutorial: images in media/tutorials/<name>/<id>.png. */
function tutorial(name: string, benchmark: string, common: SceneSetup, list: TutorialScene[]): Scene[] {
  return list.map((t) => ({
    id: `tut-${name}-${t.id}`,
    title: t.title,
    description: t.title,
    benchmark,
    setup: { ...common, ...t.setup },
    output: {
      type: "png",
      filename: `${t.id}.png`,
      crop: t.crop,
      window: t.window,
      fitHeight: t.fitHeight,
      dir: `tutorials/${name}`,
    },
  }));
}

/**
 * The benchmark models put the material table at the top right, where the
 * centre of a slope's critical circle often lies; this moves it under the
 * title instead.
 */
const MATERIAL_TABLE_LEFT: [string, ...unknown[]] = [
  "updateAnnotation",
  "anno-benchmark-material-table",
  { x: 0.11, y: 0.25, anchor: "top-left" },
];

/**
 * The verification examples on the home page, opened in the app and run
 * with the check the page shows: images in media/home/<id>.png, exported
 * as "Export PNG" saves them.
 */
export const HOME_EXAMPLE_SCENES: { id: string; check: number }[] = [
  { id: "V044", check: 0 },
  { id: "V027", check: 1 },
  { id: "V055", check: 0 },
];

function homeExample({ id, check }: { id: string; check: number }): Scene {
  return {
    id: `home-${id}`,
    title: `Verification example ${id}`,
    description: `Critical surface of verification problem ${id}`,
    verification: { id, check },
    setup: {
      mode: "result",
      runAnalysis: true,
      resultView: {
        showSlices: true,
        showSoilColor: true,
        showFosLabel: true,
        showCentreMarker: true,
        showGrid: false,
        surfaceDisplay: "critical",
      },
    },
    output: { type: "png", filename: `${id}.png`, crop: "export", dir: "home" },
  };
}

export const scenes: Scene[] = [
  // ── Edit-mode scenes ──────────────────────────────────────────

  {
    id: "edit-geometry",
    title: "Slope Geometry",
    description: "Edit canvas showing slope geometry with coordinate points",
    benchmark: "T-ACADS Simple",
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
    id: "edit-showcase",
    title: "Slope with a Weak Layer",
    description: "Arai & Tagyo's slope with a weak middle layer between a stronger upper layer and a strong base",
    benchmark: "Arai & Tagyo (1985), weak layer",
    setup: { mode: "edit", onlyModel: true },
    output: { type: "png", filename: "edit-showcase.png", crop: "canvas" },
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
      actions: [MATERIAL_TABLE_LEFT],
    },
    output: {
      type: "png",
      filename: "result-critical-surface.png",
      crop: "canvas",
    },
  },

  {
    id: "result-app",
    title: "The Program",
    description: "The whole program window with the critical slip surface, its centre and the summary",
    benchmark: "T-ACADS Simple",
    setup: {
      mode: "result",
      runAnalysis: true,
      ribbonTab: "Results",
      resultView: {
        showSlices: true,
        showSoilColor: true,
        showFosLabel: true,
        showCentreMarker: true,
        surfaceDisplay: "critical",
      },
      actions: [MATERIAL_TABLE_LEFT],
    },
    output: { type: "png", filename: "result-app.png", crop: "full" },
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
    // Used by the dam tutorial (docs/tutorials/dam.mdx).
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

  {
    id: "result-showcase",
    title: "Non-Circular Surface along a Weak Layer",
    description: "The optimised non-circular surface of Arai & Tagyo's slope, following the weak layer",
    benchmark: "Arai & Tagyo (1985), weak layer",
    setup: {
      mode: "result",
      onlyModel: true,
      runAnalysis: true,
      resultView: {
        showSlices: true,
        showSoilColor: true,
        showFosLabel: true,
        showCentreMarker: false,
        surfaceDisplay: "critical",
      },
    },
    output: { type: "png", filename: "result-showcase.png", crop: "canvas" },
  },

  // ── Tutorial: Your first analysis ─────────────────────────────

  ...tutorial("first-analysis", "T-ACADS Simple", { onlyModel: true }, [
    {
      id: "01-window",
      title: "The cSlope window in edit mode",
      setup: { mode: "edit", ribbonTab: "Model" },
      crop: "full",
    },
    {
      id: "02-exterior",
      title: "Exterior Boundary window",
      setup: { mode: "edit", click: ["Model", "Exterior"] },
      crop: "window",
      window: "Exterior Boundary",
    },
    {
      id: "03-materials",
      title: "Define Materials window",
      setup: { mode: "edit", click: ["Model", "Define"] },
      crop: "window",
      window: "Define Materials",
    },
    {
      id: "04-search-limits",
      title: "Search limits window",
      setup: { mode: "edit", click: ["Model", "Search limits"] },
      crop: "window",
      window: "Search limits",
    },
    {
      id: "05-search-limits-canvas",
      title: "Search limit markers on the canvas",
      setup: { mode: "edit", actions: [["setActiveSection", "Search Limits"]] },
      crop: "canvas",
    },
    {
      id: "06-options",
      title: "Options window",
      setup: { mode: "edit", click: ["Model", "Options"] },
      crop: "window",
      window: "Options",
    },
    {
      id: "07-result",
      title: "Result mode after running the analysis",
      setup: { runAnalysis: true, ribbonTab: "Results" },
      crop: "full",
    },
  ]),

  // ── Tutorial: Slope with a water table ────────────────────────

  ...tutorial("water-table", "Arai & Tagyo (1985)", { onlyModel: true }, [
    { id: "01-model", title: "Slope with a water table", setup: { mode: "edit" }, crop: "canvas" },
    {
      id: "02-piezo",
      title: "Piezometric Lines window",
      setup: { mode: "edit", click: ["Model", "Piezometric Lines"] },
      crop: "window",
      window: "Piezometric Lines",
    },
    { id: "03-result", title: "Result", setup: { runAnalysis: true }, crop: "full" },
    {
      id: "04-pore-pressure",
      title: "Pore pressure along the critical surface",
      setup: { runAnalysis: true, click: ["Results", "Results Plot"], windowSelect: [["Y axis", "Pore pressure"]] },
      crop: "window",
      window: "Results Plot",
      fitHeight: false,
    },
  ]),

  // ── Tutorial: Layered slope ───────────────────────────────────

  ...tutorial("layered", "T-ACADS Non-Homogeneous", { onlyModel: true }, [
    { id: "01-model", title: "Layered slope", setup: { mode: "edit" }, crop: "canvas" },
    {
      id: "02-interior",
      title: "Interior Boundaries window",
      setup: { mode: "edit", click: ["Model", "Interior"] },
      crop: "window",
      window: "Interior Boundaries",
    },
    {
      id: "03-materials",
      title: "Define Materials window",
      setup: { mode: "edit", click: ["Model", "Define"] },
      crop: "window",
      window: "Define Materials",
    },
    {
      id: "04-assign",
      title: "Assign Materials window",
      setup: { mode: "edit", click: ["Model", "Assign"] },
      crop: "window",
      window: "Assign Materials",
    },
    { id: "05-result", title: "Result", setup: { runAnalysis: true }, crop: "canvas" },
  ]),

  // ── Tutorial: Embankment dam ──────────────────────────────────

  ...tutorial("dam", "Talbingo Dam", { onlyModel: true }, [
    { id: "01-model", title: "Zoned embankment dam", setup: { mode: "edit" }, crop: "canvas" },
    {
      id: "02-materials",
      title: "Dam materials",
      setup: { mode: "edit", click: ["Model", "Define"] },
      crop: "window",
      window: "Define Materials",
    },
    {
      id: "04-lambda",
      title: "Fm and Ff against lambda",
      setup: { runAnalysis: true, click: ["Results", "Results Plot"], windowSelect: [["Plot", "Lambda vs Fm/Ff"]] },
      crop: "window",
      window: "Results Plot",
      fitHeight: false,
    },
  ]),

  // ── Tutorial: Soil nails ──────────────────────────────────────

  ...tutorial("soil-nails", "T-ACADS Simple", { onlyModel: true, actions: [
        ["addReinforcement", "nail"],
        ["updateReinforcement", "$last:reinforcements", { x1: 24, y1: -2, x2: 14.341, y2: -4.588 }],
        ["addReinforcement", "nail"],
        ["updateReinforcement", "$last:reinforcements", { x1: 29, y1: -4.5, x2: 19.341, y2: -7.088 }],
        ["addReinforcement", "nail"],
        ["updateReinforcement", "$last:reinforcements", { x1: 34, y1: -7, x2: 24.341, y2: -9.588 }],
      ] }, [
    {
      id: "01-reinforcement",
      title: "Reinforcement window with three soil nails",
      setup: { mode: "edit", click: ["Model", "Reinforcement"] },
      crop: "window",
      window: "Reinforcement",
    },
    { id: "02-model", title: "Nails on the edit canvas", setup: { mode: "edit" }, crop: "canvas" },
    { id: "03-result", title: "Result with the nail forces", setup: { runAnalysis: true }, crop: "full" },
  ]),

  // ── Tutorial: Reporting ───────────────────────────────────────

  ...tutorial("reporting", "T-ACADS Simple", { onlyModel: true, runAnalysis: true }, [
    {
      id: "01-paper",
      title: "The paper selected, with its properties",
      setup: { afterAnalysis: [["setSelectedResultObject", "paper-frame"]], ribbonTab: "Results" },
      crop: "full",
    },
    {
      id: "02-color-bar",
      title: "All surfaces with a colour bar",
      setup: { resultView: { surfaceDisplay: "all", showSlices: false }, afterAnalysis: [["addAnnotation", "color-bar"]] },
      crop: "canvas",
    },
    {
      id: "03-view-settings",
      title: "View Settings window",
      setup: { click: ["Results", "Settings"] },
      crop: "window",
      window: "View Settings",
    },
    {
      id: "04-export",
      title: "The export menu",
      setup: { click: ["Results", "More export options"] },
      crop: "full",
    },
  ]),

  // ── Tutorial: Partial factors ─────────────────────────────────

  ...tutorial(
    "partial-factors",
    "T-ACADS Simple",
    { onlyModel: true, actions: [["setOptions", { partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 } }]] },
    [
      {
        id: "01-options",
        title: "Options with partial factors",
        setup: { mode: "edit", click: ["Model", "Options"] },
        crop: "window",
        window: "Options",
      },
      { id: "02-result", title: "Over-design factor on design values", setup: { runAnalysis: true }, crop: "full" },
    ],
  ),

  // ── Tutorial: Sensitivity and probability ─────────────────────

  ...tutorial("probabilistic", "T-ACADS Simple", { onlyModel: true, runAnalysis: true }, [
    {
      id: "01-sensitivity",
      title: "Sensitivity analysis",
      setup: { click: ["Results", "Sensitivity", "last:Run"], waitForText: "values gave a FOS" },
      crop: "full",
    },
    {
      id: "02-probabilistic",
      title: "Probabilistic analysis",
      setup: {
        click: ["Results", "Probabilistic", "+ Add variable", "last:Run"],
        waitForText: "Probability of failure (lognormal)",
      },
      crop: "full",
    },
  ]),

  // ── Home page: the verification examples ──────────────────────

  ...HOME_EXAMPLE_SCENES.map(homeExample),
];
