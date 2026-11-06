import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS } from "@cslope/engine";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  DEFAULT_PROJECT_INFO,
  DEFAULT_RESULT_VIEW_SETTINGS,
} from "./defaults";
import type { AppState, ModelEntry } from "./types";
import {
  normalizeColorBarScale,
  normalizeResultView,
  parseProjectFile,
  serializeProject,
} from "./persistence";

function makeBaseProject(models: unknown[]) {
  return JSON.stringify({
    version: 1,
    activeModelId: "m1",
    models,
  });
}

describe("persistence orientation migration", () => {
  it("defaults to LTR when orientation is missing and crest is on left", () => {
    const json = makeBaseProject([
      {
        id: "m1",
        name: "Legacy LTR",
        coordinates: [
          [0, 0],
          [0, 10],
          [10, 5],
          [10, 0],
        ],
        materials: [
          {
            id: "mat-1",
            name: "M1",
            unitWeight: 20,
            frictionAngle: 30,
            cohesion: 5,
            color: "#6d5f2a",
          },
        ],
      },
    ]);

    const parsed = parseProjectFile(json);
    expect(parsed.models[0].orientation).toBe("ltr");
  });

  it("infers RTL when orientation is missing and crest is on right", () => {
    const json = makeBaseProject([
      {
        id: "m1",
        name: "Legacy RTL",
        coordinates: [
          [0, 0],
          [0, 5],
          [10, 10],
          [10, 0],
        ],
        materials: [
          {
            id: "mat-1",
            name: "M1",
            unitWeight: 20,
            frictionAngle: 30,
            cohesion: 5,
            color: "#6d5f2a",
          },
        ],
      },
    ]);

    const parsed = parseProjectFile(json);
    expect(parsed.models[0].orientation).toBe("rtl");
  });

  it("keeps explicit orientation from file", () => {
    const json = makeBaseProject([
      {
        id: "m1",
        name: "Explicit RTL",
        orientation: "rtl",
        coordinates: [
          [0, 0],
          [0, 10],
          [10, 5],
          [10, 0],
        ],
        materials: [
          {
            id: "mat-1",
            name: "M1",
            unitWeight: 20,
            frictionAngle: 30,
            cohesion: 5,
            color: "#6d5f2a",
          },
        ],
      },
    ]);

    const parsed = parseProjectFile(json);
    expect(parsed.models[0].orientation).toBe("rtl");
  });
});

describe("persistence round-trip", () => {
  it("preserves project data through serialize/parse", () => {
    const model: ModelEntry = {
      id: "m1",
      name: "Round Trip",
      orientation: "ltr",
      projectInfo: { ...DEFAULT_PROJECT_INFO, title: "RT" },
      coordinates: [
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 0],
      ],
      materials: [
        {
          ...DEFAULT_MATERIAL,
          id: "mat-1",
          color: "#c084fc",
          model: {
            kind: "mohr-coulomb",
            unitWeight: 18.5,
            frictionAngle: 32,
            cohesion: 4,
          },
        },
      ],
      materialBoundaries: [
        {
          id: "b1",
          coordinates: [
            [0, 5],
            [10, 5],
          ],
        },
      ],
      regionMaterials: [{ point: [5, 5], materialId: "mat-1" }],
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        enabled: true,
        lines: [
          {
            id: "p1",
            name: "P1",
            color: "#3b82f6",
            coordinates: [
              [0, 6],
              [10, 6],
            ],
          },
        ],
        activeLineId: "p1",
      },
      udls: [{ id: "u1", magnitude: 10, x1: 1, x2: 4 }],
      lineLoads: [
        { id: "l1", magnitude: 25, x: 2 },
        { id: "l2", magnitude: 15, x: 10, angle: -30, y: 7 },
      ],
      options: { ...DEFAULT_ANALYSIS_OPTIONS, compositeSurfaces: true },
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, enabled: true },
      editViewOffset: [1, 2],
      editViewScale: 3,
      resultViewOffset: [-1, -2],
      resultViewScale: 4,
      viewOffset: [0, 0],
      viewScale: 0,
      resultViewSettings: {
        ...DEFAULT_RESULT_VIEW_SETTINGS,
        annotations: [],
      },
      runState: "idle",
      progress: 0,
      result: null,
      customSearchPlanes: [],
      customPlanesOnly: false,
      errorMessage: null,
    };

    const state = {
      activeModelId: model.id,
      models: [model],
    } as AppState;

    const serialized = serializeProject(state);
    const parsed = parseProjectFile(JSON.stringify(serialized));
    const roundTrip = serializeProject({
      activeModelId: parsed.activeModelId,
      models: parsed.models,
    } as AppState);

    expect(roundTrip).toEqual(serialized);
    // an inclined line load keeps its angle and load point
    expect(parsed.models[0].lineLoads[1]).toMatchObject({ angle: -30, y: 7 });
    expect(parsed.models[0].lineLoads[0]).not.toHaveProperty("angle");
  });
});

describe("persistence error handling", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseProjectFile("not json")).toThrow("not valid JSON");
  });

  it("throws on null data", () => {
    expect(() => parseProjectFile("null")).toThrow("missing project data");
  });

  it("throws on empty models array", () => {
    expect(() => parseProjectFile(JSON.stringify({ models: [] }))).toThrow(
      "at least one model",
    );
  });

  it("throws on missing models field", () => {
    expect(() => parseProjectFile(JSON.stringify({ version: 1 }))).toThrow(
      "at least one model",
    );
  });

  it("throws on model without id", () => {
    expect(() =>
      parseProjectFile(
        makeBaseProject([
          {
            coordinates: [
              [0, 0],
              [0, 10],
              [10, 0],
            ],
            materials: [
              {
                id: "m",
                name: "M",
                unitWeight: 20,
                frictionAngle: 30,
                cohesion: 5,
                color: "#000",
              },
            ],
          },
        ]),
      ),
    ).toThrow("missing an id");
  });

  it("throws on model with too few coordinates", () => {
    expect(() =>
      parseProjectFile(
        makeBaseProject([
          {
            id: "m1",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
            materials: [
              {
                id: "m",
                name: "M",
                unitWeight: 20,
                frictionAngle: 30,
                cohesion: 5,
                color: "#000",
              },
            ],
          },
        ]),
      ),
    ).toThrow("must include coordinates");
  });

  it("throws on model with no materials", () => {
    expect(() =>
      parseProjectFile(
        makeBaseProject([
          {
            id: "m1",
            coordinates: [
              [0, 0],
              [0, 10],
              [10, 0],
            ],
            materials: [],
          },
        ]),
      ),
    ).toThrow("at least one material");
  });
});

describe("persistence normalization fallbacks", () => {
  const minimalModel = {
    id: "m1",
    coordinates: [
      [0, 0],
      [0, 10],
      [10, 0],
    ],
    materials: [
      {
        id: "mat-1",
        name: "M1",
        unitWeight: 20,
        frictionAngle: 30,
        cohesion: 5,
        color: "#000",
      },
    ],
  };

  it("keeps composite surfaces as saved, and off in a project saved before the option existed", () => {
    for (const [saved, loaded] of [[true, true], [false, false], [undefined, false]] as const) {
      const options = { ...DEFAULT_ANALYSIS_OPTIONS, ...(saved === undefined ? {} : { compositeSurfaces: saved }) };
      const parsed = parseProjectFile(makeBaseProject([{ ...minimalModel, options }]));
      expect(parsed.models[0].options.compositeSurfaces).toBe(loaded);
    }
  });

  it("defaults model name when missing", () => {
    const parsed = parseProjectFile(
      makeBaseProject([{ ...minimalModel, name: undefined }]),
    );
    expect(typeof parsed.models[0].name).toBe("string");
    expect(parsed.models[0].name.length).toBeGreaterThan(0);
  });

  it("defaults projectInfo when missing", () => {
    const parsed = parseProjectFile(makeBaseProject([minimalModel]));
    expect(parsed.models[0].projectInfo).toBeDefined();
    expect(typeof parsed.models[0].projectInfo!.title).toBe("string");
  });

  it("defaults piezometricLine when missing", () => {
    const parsed = parseProjectFile(makeBaseProject([minimalModel]));
    expect(parsed.models[0].piezometricLine).toBeDefined();
    expect(parsed.models[0].piezometricLine.enabled).toBe(false);
  });

  it("defaults analysisLimits when missing", () => {
    const parsed = parseProjectFile(makeBaseProject([minimalModel]));
    expect(parsed.models[0].analysisLimits).toBeDefined();
  });

  it("defaults options when missing", () => {
    const parsed = parseProjectFile(makeBaseProject([minimalModel]));
    expect(parsed.models[0].options).toBeDefined();
    expect(parsed.models[0].options.method).toBeDefined();
  });

  it("normalizes material with missing fields to defaults", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          id: "m1",
          coordinates: [
            [0, 0],
            [0, 10],
            [10, 0],
          ],
          materials: [{ id: "mat-x" }],
        },
      ]),
    );
    const mat = parsed.models[0].materials[0];
    // Legacy file without model — normalizeMaterial should synthesise a MC model
    expect(mat.model).toBeDefined();
    expect(mat.model.kind).toBe("mohr-coulomb");
    expect(mat.model.unitWeight).toBeGreaterThanOrEqual(0.1);
  });

  it("normalizes material without id uses index-based fallback", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          id: "m1",
          coordinates: [
            [0, 0],
            [0, 10],
            [10, 0],
          ],
          materials: [
            { name: "No Id", unitWeight: 20, frictionAngle: 30, cohesion: 5 },
          ],
        },
      ]),
    );
    expect(parsed.models[0].materials[0].id).toBe("mat-1");
  });

  it("filters invalid UDLs (x1 === x2)", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          udls: [
            { id: "u1", magnitude: 10, x1: 5, x2: 5 },
            { id: "u2", magnitude: 10, x1: 3, x2: 8 },
          ],
        },
      ]),
    );
    expect(parsed.models[0].udls).toHaveLength(1);
    expect(parsed.models[0].udls[0].id).toBe("u2");
  });

  it("filters UDLs missing id", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          udls: [{ magnitude: 10, x1: 0, x2: 5 }],
        },
      ]),
    );
    expect(parsed.models[0].udls).toHaveLength(0);
  });

  it("filters line loads missing id", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          lineLoads: [{ magnitude: 50, x: 10 }],
        },
      ]),
    );
    expect(parsed.models[0].lineLoads).toHaveLength(0);
  });

  it("normalizes analysisOptions with custom values", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          options: {
            method: "Bishop",
            slices: 50,
            iterations: 2000,
            refinedIterations: 800,
            tolerance: 0.001,
            maxIterations: 100,
            intersliceFunction: "half-sine",
          },
        },
      ]),
    );
    expect(parsed.models[0].options.method).toBe("Bishop");
    expect(parsed.models[0].options.slices).toBe(50);
    expect(parsed.models[0].options.intersliceFunction).toBe("half-sine");
  });

  it("clamps analysisOptions slices within bounds", () => {
    const parsed = parseProjectFile(
      makeBaseProject([{ ...minimalModel, options: { slices: 5 } }]),
    );
    expect(parsed.models[0].options.slices).toBeGreaterThanOrEqual(10);
  });

  it("falls back to first model when activeModelId is not in models", () => {
    const json = JSON.stringify({
      version: 1,
      activeModelId: "nonexistent",
      models: [minimalModel],
    });
    const parsed = parseProjectFile(json);
    expect(parsed.activeModelId).toBe("m1");
  });

  it("defaults version when missing", () => {
    const json = JSON.stringify({ models: [minimalModel] });
    const parsed = parseProjectFile(json);
    expect(typeof parsed.version).toBe("number");
  });

  it("normalizes resultViewSettings with annotations", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          resultViewSettings: {
            surfaceDisplay: "all",
            annotations: [
              { id: "a1", type: "text", x: 0.1, y: 0.2, text: "hello" },
              { invalid: true },
              null,
            ],
            paperFrame: { paperSize: "A3", landscape: false, showFrame: true },
          },
        },
      ]),
    );
    const rvs = parsed.models[0].resultViewSettings;
    expect(rvs).toBeDefined();
    if (rvs) {
      expect(rvs.surfaceDisplay).toBe("all");
      // Only valid annotations should survive
      expect(rvs.annotations).toHaveLength(1);
      expect(rvs.paperFrame.paperSize).toBe("A3");
      expect(rvs.paperFrame.landscape).toBe(false);
    }
  });

  it("defaults regionMaterials when missing", () => {
    const parsed = parseProjectFile(makeBaseProject([minimalModel]));
    expect(parsed.models[0].regionMaterials).toEqual([]);
  });

  it("normalizes materialBoundaries when missing", () => {
    const parsed = parseProjectFile(makeBaseProject([minimalModel]));
    expect(parsed.models[0].materialBoundaries).toEqual([]);
  });

  it("normalizes material with depthRange", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          id: "m1",
          coordinates: [
            [0, 0],
            [0, 10],
            [10, 0],
          ],
          materials: [
            {
              id: "mat-1",
              name: "M1",
              unitWeight: 20,
              frictionAngle: 30,
              cohesion: 5,
              color: "#000",
              depthRange: [0, 5],
            },
          ],
        },
      ]),
    );
    expect(parsed.models[0].materials[0].depthRange).toEqual([0, 5]);
  });

  it("ignores invalid depthRange", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          id: "m1",
          coordinates: [
            [0, 0],
            [0, 10],
            [10, 0],
          ],
          materials: [
            {
              id: "mat-1",
              name: "M1",
              unitWeight: 20,
              frictionAngle: 30,
              cohesion: 5,
              color: "#000",
              depthRange: "bad",
            },
          ],
        },
      ]),
    );
    expect(parsed.models[0].materials[0].depthRange).toBeUndefined();
  });

  it("normalizes piezometric line with lines array", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          piezometricLine: {
            enabled: true,
            lines: [
              {
                id: "p1",
                name: "P1",
                color: "#00f",
                coordinates: [
                  [0, 3],
                  [10, 3],
                ],
              },
            ],
            activeLineId: "p1",
            materialAssignment: { "mat-1": "p1" },
          },
        },
      ]),
    );
    expect(parsed.models[0].piezometricLine.enabled).toBe(true);
    expect(parsed.models[0].piezometricLine.lines).toHaveLength(1);
    expect(parsed.models[0].piezometricLine.activeLineId).toBe("p1");
  });

  it("normalizes customSearchPlanes and customPlanesOnly", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          customSearchPlanes: [{ id: "csp1", cx: 5, cy: 12, radius: 9 }],
          customPlanesOnly: true,
        },
      ]),
    );
    expect(parsed.models[0].customSearchPlanes).toHaveLength(1);
    expect(parsed.models[0].customPlanesOnly).toBe(true);
  });

  it("defaults customSearchPlanes when not an array", () => {
    const parsed = parseProjectFile(
      makeBaseProject([{ ...minimalModel, customSearchPlanes: "bad" }]),
    );
    expect(parsed.models[0].customSearchPlanes).toEqual([]);
    expect(parsed.models[0].customPlanesOnly).toBe(false);
  });

  it("normalizes analysisOptions with data-point-specified interslice", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          options: {
            intersliceFunction: "data-point-specified",
            intersliceDataPoints: [[0, 0.5], [1, 0.8], "invalid"],
          },
        },
      ]),
    );
    expect(parsed.models[0].options.intersliceFunction).toBe(
      "data-point-specified",
    );
    expect(parsed.models[0].options.intersliceDataPoints).toHaveLength(2);
  });

  it("normalizes resultViewSettings with viewLock", () => {
    const parsed = parseProjectFile(
      makeBaseProject([
        {
          ...minimalModel,
          resultViewSettings: {
            viewLock: { bottomLeft: [0, 0], topRight: [10, 10] },
            annotations: [],
          },
        },
      ]),
    );
    const rvs = parsed.models[0].resultViewSettings;
    expect(rvs?.viewLock).toBeDefined();
    expect(rvs?.viewLock?.bottomLeft).toEqual([0, 0]);
    expect(rvs?.viewLock?.topRight).toEqual([10, 10]);
  });
});

describe("normalizeResultView (also used for view templates)", () => {
  it("replaces an unknown paper size and a malformed view lock", () => {
    const view = normalizeResultView({
      paperFrame: { paperSize: "Letter", landscape: true },
      viewLock: { bottomLeft: [0, "x"], topRight: [10, 5] },
      annotations: "nope",
    });
    expect(view.paperFrame.paperSize).toBe("A4");
    expect(view.viewLock).toBeUndefined();
    expect(view.annotations).toEqual([]);
  });

  it("keeps a valid view lock", () => {
    const view = normalizeResultView({
      viewLock: { bottomLeft: [0, -2], topRight: [10, 5] },
    });
    expect(view.viewLock).toEqual({ bottomLeft: [0, -2], topRight: [10, 5] });
  });

  it("keeps the PDF page choices when they are booleans, else leaves them unset", () => {
    expect(normalizeResultView({ pdfSummaryPages: false, pdfTitleLine: true })).toMatchObject({
      pdfSummaryPages: false,
      pdfTitleLine: true,
    });
    const unset = normalizeResultView({ pdfSummaryPages: "no", pdfTitleLine: 1 });
    expect("pdfSummaryPages" in unset).toBe(false);
    expect("pdfTitleLine" in unset).toBe(false);
  });

  it("keeps the custom surfaces display only when it is on (off is the default)", () => {
    expect(normalizeResultView({ showCustomSurfaces: true }).showCustomSurfaces).toBe(true);
    expect("showCustomSurfaces" in normalizeResultView({})).toBe(false);
    expect("showCustomSurfaces" in normalizeResultView({ showCustomSurfaces: false })).toBe(false);
    expect("showCustomSurfaces" in normalizeResultView({ showCustomSurfaces: "yes" })).toBe(false);
  });

  it("keeps the colour scale of a colour bar when it is valid", () => {
    const view = normalizeResultView({
      annotations: [
        {
          id: "c",
          type: "color-bar",
          x: 0.8,
          y: 0.3,
          scaleMode: "fixed",
          scaleMin: 1,
          scaleMax: 2.5,
          scheme: "custom",
          schemeFrom: "#ff0000",
          schemeMid: "#FFFFFF",
          schemeTo: "#0000ff",
        },
      ],
    });
    expect(view.annotations[0]).toEqual({
      id: "c",
      type: "color-bar",
      x: 0.8,
      y: 0.3,
      scaleMode: "fixed",
      scaleMin: 1,
      scaleMax: 2.5,
      scheme: "custom",
      schemeFrom: "#ff0000",
      schemeMid: "#FFFFFF",
      schemeTo: "#0000ff",
    });
    expect(normalizeResultView({ annotations: [{ id: "c", type: "color-bar", x: 0, y: 0, scaleMode: "filter", scheme: "viridis" }] }).annotations[0]).toMatchObject({
      scaleMode: "filter",
      scheme: "viridis",
    });
  });

  it("drops colour scale fields that are not valid, and all of them from other annotations", () => {
    const view = normalizeResultView({
      annotations: [
        {
          id: "c",
          type: "color-bar",
          x: 0.8,
          y: 0.3,
          scaleMode: "manual",
          scaleMin: "1",
          scaleMax: Number.NaN,
          scheme: "rainbow",
          schemeFrom: "red",
          schemeMid: "#fff",
          schemeTo: 42,
        },
        { id: "t", type: "text", x: 0.1, y: 0.1, text: "x", scaleMode: "fixed", scheme: "viridis", schemeFrom: "#ff0000" },
      ],
    });
    expect(view.annotations[0]).toEqual({ id: "c", type: "color-bar", x: 0.8, y: 0.3 });
    expect(view.annotations[1]).toEqual({ id: "t", type: "text", x: 0.1, y: 0.1, text: "x" });
    // Direct use, as for a colour bar of a template.
    expect(normalizeColorBarScale({ id: "c", type: "color-bar", x: 0, y: 0, scaleMode: "auto", scheme: "classic" })).toEqual({
      id: "c",
      type: "color-bar",
      x: 0,
      y: 0,
      scaleMode: "auto",
      scheme: "classic",
    });
  });
});

describe("persistence of the layers' order", () => {
  const annotations = [
    { id: "t", type: "text", x: 0.1, y: 0.1, text: "Hello" },
    { id: "r", type: "reference", shape: "polyline", points: [[0, 0], [1, 1]] },
  ];

  it("keeps the known keys of a stored order once each, and leaves it unset when none is left", () => {
    const view = normalizeResultView({
      annotations,
      layerOrder: ["soilColor", "t", "t", 4, "gone", "drawing:d1", "slices", "r"],
    });
    expect(view.layerOrder).toEqual(["soilColor", "t", "drawing:d1", "slices", "r"]);
    expect("layerOrder" in normalizeResultView({ annotations, layerOrder: ["gone"] })).toBe(false);
    expect("layerOrder" in normalizeResultView({ annotations, layerOrder: "soilColor" })).toBe(false);
    expect("layerOrder" in normalizeResultView({ annotations })).toBe(false);
  });

  it("reads the order back from a project file", () => {
    const json = makeBaseProject([
      {
        id: "m1",
        name: "Layers",
        coordinates: [
          [0, 0],
          [0, 10],
          [10, 5],
          [10, 0],
        ],
        materials: [{ id: "mat-1", name: "M1", unitWeight: 20, frictionAngle: 30, cohesion: 5, color: "#6d5f2a" }],
        resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations, layerOrder: ["t", "slices", "soilColor", "r"] },
      },
    ]);
    expect(parseProjectFile(json).models[0].resultViewSettings?.layerOrder).toEqual(["t", "slices", "soilColor", "r"]);
  });
});

describe("persistence of the display layers' styles", () => {
  const STYLES = {
    soilColor: { opacity: 0.5 },
    fosLabel: { fontSize: 16, fontFamily: "serif", color: "#cc0000", bold: false, decimals: 2 },
    center: { color: "#00cc00", size: 4, radiusLines: false },
  };

  it("reads the styles back from a project file", () => {
    const json = makeBaseProject([
      {
        id: "m1",
        name: "Styles",
        coordinates: [
          [0, 0],
          [0, 10],
          [10, 5],
          [10, 0],
        ],
        materials: [{ id: "mat-1", name: "M1", unitWeight: 20, frictionAngle: 30, cohesion: 5, color: "#6d5f2a" }],
        resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [], layerStyles: STYLES },
      },
    ]);
    expect(parseProjectFile(json).models[0].resultViewSettings?.layerStyles).toEqual(STYLES);
    // and a template (the same reading)
    expect(normalizeResultView(JSON.parse(JSON.stringify({ annotations: [], layerStyles: STYLES }))).layerStyles).toEqual(STYLES);
  });

  it("drops bad values and unknown layers and fields without an error; absent when nothing is left", () => {
    const view = normalizeResultView({
      annotations: [],
      layerStyles: {
        soilColor: { opacity: 2 },
        slices: { color: "red", width: -1 },
        criticalSurface: { color: "#CC0000", width: 3, dash: "dotted" },
        fosLabel: { fontSize: "big", fontFamily: "Comic", decimals: 2.5, bold: "yes" },
        center: [],
        nonsense: { color: "#000000" },
      },
    });
    expect(view.layerStyles).toEqual({ criticalSurface: { color: "#cc0000", width: 3 } });
    expect("layerStyles" in normalizeResultView({ annotations: [], layerStyles: { slices: { width: 99 } } })).toBe(false);
    expect("layerStyles" in normalizeResultView({ annotations: [], layerStyles: "bold" })).toBe(false);
    expect("layerStyles" in normalizeResultView({ annotations: [] })).toBe(false);
  });
});
