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
import { parseProjectFile, serializeProject } from "./persistence";

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
          unitWeight: 18.5,
          frictionAngle: 32,
          cohesion: 4,
          color: "#c084fc",
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
      regionMaterials: { top: "mat-1" },
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
      lineLoads: [{ id: "l1", magnitude: 25, x: 2 }],
      options: { ...DEFAULT_ANALYSIS_OPTIONS },
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
  });
});
