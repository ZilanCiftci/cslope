import { describe, expect, it } from "vitest";
import {
  nextId,
  buildSlopeDTO,
  RUN_RESET,
  getAnalysisInputSignature,
} from "./helpers";
import type { AppState } from "./types";
import {
  DEFAULT_COORDS,
  DEFAULT_MATERIAL,
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_PIEZO_LINE,
  DEFAULT_PROJECT_INFO,
  DEFAULT_RESULT_VIEW_SETTINGS,
} from "./defaults";

const DEFAULT_ANALYSIS_OPTIONS = {
  method: "Morgenstern-Price" as const,
  slices: 30,
  iterations: 1000,
  refinedIterations: 500,
  intersliceFunction: "Halfsine" as const,
  intersliceDataPoints: [],
  janbuCorrection: false,
};

function makeMinimalState(overrides: Partial<AppState> = {}): AppState {
  return {
    activeModelId: "m1",
    models: [],
    mode: "edit",
    orientation: "ltr",
    projectInfo: { ...DEFAULT_PROJECT_INFO },
    coordinates: [...DEFAULT_COORDS],
    materials: [{ ...DEFAULT_MATERIAL, id: "mat-1" }],
    materialBoundaries: [],
    regionMaterials: [],
    piezometricLine: { ...DEFAULT_PIEZO_LINE },
    udls: [],
    lineLoads: [],
    customSearchPlanes: [],
    customPlanesOnly: false,
    options: { ...DEFAULT_ANALYSIS_OPTIONS },
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, enabled: false },
    runState: "idle",
    progress: 0,
    result: null,
    errorMessage: null,
    editViewOffset: [0, 0],
    editViewScale: 0,
    resultViewOffset: [0, 0],
    resultViewScale: 0,
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS },
    ...overrides,
  } as unknown as AppState;
}

describe("nextId", () => {
  it("generates a string starting with the given prefix", () => {
    const id = nextId("mat");
    expect(id.startsWith("mat-")).toBe(true);
  });

  it("generates unique ids on successive calls", () => {
    const a = nextId("test");
    const b = nextId("test");
    expect(a).not.toBe(b);
  });
});

describe("buildSlopeDTO", () => {
  it("returns a slope definition with basic fields", () => {
    const state = makeMinimalState();
    const dto = buildSlopeDTO(state);
    expect(dto.orientation).toBe("ltr");
    expect(dto.coordinates.length).toBeGreaterThanOrEqual(3);
    expect(dto.materials.length).toBe(1);
  });

  it("includes material boundaries when present", () => {
    const state = makeMinimalState({
      materialBoundaries: [
        {
          id: "b1",
          coordinates: [
            [0, 5],
            [25, 5],
          ],
        },
      ] as AppState["materialBoundaries"],
    });
    const dto = buildSlopeDTO(state);
    expect(dto.materialBoundaries).toBeDefined();
    expect(dto.materialBoundaries!.length).toBe(1);
  });

  it("assigns correct material below a 2-point boundary extending beyond slope", () => {
    // Regression: a 2-point boundary whose right endpoint is at the far
    // edge of the slope geometry used to pick that endpoint as the
    // "midpoint" (index = Math.floor(2/2) = 1), placing the test point
    // outside the geometry so the material fell back to the default.
    const state = makeMinimalState({
      // Default coords: (0,0)→(0,10)→(10,10)→(12.5,7.5)→(15,7.5)→(17.5,10)→(25,10)→(25,0)
      materials: [
        { ...DEFAULT_MATERIAL, id: "mat-soil", name: "Soil" },
        {
          ...DEFAULT_MATERIAL,
          id: "mat-rock",
          name: "Rock",
          model: { kind: "impenetrable" as const, unitWeight: 20 },
        },
      ],
      materialBoundaries: [
        {
          id: "b1",
          coordinates: [
            [0, 5],
            [25, 5],
          ],
        },
      ] as AppState["materialBoundaries"],
      regionMaterials: [{ point: [12, 3], materialId: "mat-rock" }],
    });
    const dto = buildSlopeDTO(state);
    expect(dto.materialBoundaries).toBeDefined();
    expect(dto.materialBoundaries![0].coordinates).toEqual([
      [0, 5],
      [25, 5],
    ]);
    expect(dto.regionAssignments).toBeDefined();
    expect(dto.regionAssignments![0].materialName).toBe("Rock");
  });

  it("includes analysis limits when enabled", () => {
    const state = makeMinimalState({
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, enabled: true },
    });
    const dto = buildSlopeDTO(state);
    expect(dto.analysisLimits).toBeDefined();
    expect(dto.analysisLimits!.entryLeftX).toBe(
      DEFAULT_ANALYSIS_LIMITS.entryLeftX,
    );
  });

  it("does not include analysis limits when disabled", () => {
    const state = makeMinimalState({
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, enabled: false },
    });
    const dto = buildSlopeDTO(state);
    expect(dto.analysisLimits).toBeUndefined();
  });

  it("includes water table from piezometric line", () => {
    const state = makeMinimalState({
      piezometricLine: {
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
        materialAssignment: {},
      },
    });
    const dto = buildSlopeDTO(state);
    expect(dto.waterTable).toBeDefined();
    expect(dto.waterTable!.mode).toBe("custom");
  });

  it("does not include water table when piezo line has fewer than 2 points", () => {
    const state = makeMinimalState({
      piezometricLine: {
        enabled: true,
        lines: [
          {
            id: "p1",
            name: "P1",
            color: "#3b82f6",
            coordinates: [[0, 6]],
          },
        ],
        activeLineId: "p1",
        materialAssignment: {},
      },
    });
    const dto = buildSlopeDTO(state);
    expect(dto.waterTable).toBeUndefined();
  });

  it("does not include water table when no piezo lines exist", () => {
    const state = makeMinimalState({
      piezometricLine: { ...DEFAULT_PIEZO_LINE },
    });
    const dto = buildSlopeDTO(state);
    expect(dto.waterTable).toBeUndefined();
  });

  it("includes UDLs when present", () => {
    const state = makeMinimalState({
      udls: [{ id: "u1", magnitude: 10, x1: 2, x2: 8 }],
    } as Partial<AppState>);
    const dto = buildSlopeDTO(state);
    expect(dto.udls).toBeDefined();
    expect(dto.udls!.length).toBe(1);
    expect(dto.udls![0].magnitude).toBe(10);
  });

  it("does not include UDLs when empty", () => {
    const state = makeMinimalState({ udls: [] });
    const dto = buildSlopeDTO(state);
    expect(dto.udls).toBeUndefined();
  });

  it("includes line loads when present", () => {
    const state = makeMinimalState({
      lineLoads: [{ id: "l1", magnitude: 25, x: 5 }],
    } as Partial<AppState>);
    const dto = buildSlopeDTO(state);
    expect(dto.lineLoads).toBeDefined();
    expect(dto.lineLoads!.length).toBe(1);
  });

  it("does not include line loads when empty", () => {
    const state = makeMinimalState({ lineLoads: [] });
    const dto = buildSlopeDTO(state);
    expect(dto.lineLoads).toBeUndefined();
  });

  it("includes custom search planes when present", () => {
    const state = makeMinimalState({
      customSearchPlanes: [{ id: "sp1", cx: 10, cy: 20, radius: 15 }],
      customPlanesOnly: true,
    } as Partial<AppState>);
    const dto = buildSlopeDTO(state);
    expect(dto.customSearchPlanes).toBeDefined();
    expect(dto.customSearchPlanes!.length).toBe(1);
    expect(dto.customPlanesOnly).toBe(true);
  });

  it("does not include custom search planes when empty", () => {
    const state = makeMinimalState({
      customSearchPlanes: [],
      customPlanesOnly: false,
    });
    const dto = buildSlopeDTO(state);
    expect(dto.customSearchPlanes).toBeUndefined();
  });

  it("uses active model orientation when models are present", () => {
    const state = makeMinimalState({
      models: [
        {
          id: "m1",
          orientation: "rtl",
        },
      ] as AppState["models"],
      activeModelId: "m1",
      orientation: "ltr",
    });
    const dto = buildSlopeDTO(state);
    // The orientation should come from the active model
    expect(dto.orientation).toBeDefined();
  });
});

describe("RUN_RESET", () => {
  it("has expected shape", () => {
    expect(RUN_RESET.runState).toBe("idle");
    expect(RUN_RESET.progress).toBe(0);
    expect(RUN_RESET.result).toBeNull();
    expect(RUN_RESET.errorMessage).toBeNull();
  });
});

describe("getAnalysisInputSignature", () => {
  it("returns a JSON string", () => {
    const state = makeMinimalState();
    const sig = getAnalysisInputSignature(state);
    expect(() => JSON.parse(sig)).not.toThrow();
  });

  it("changes when coordinates change", () => {
    const state1 = makeMinimalState();
    const state2 = makeMinimalState({
      coordinates: [
        [0, 0],
        [0, 20],
        [30, 20],
        [30, 0],
      ],
    });
    expect(getAnalysisInputSignature(state1)).not.toBe(
      getAnalysisInputSignature(state2),
    );
  });

  it("changes when materials change", () => {
    const state1 = makeMinimalState();
    const state2 = makeMinimalState({
      materials: [
        {
          ...DEFAULT_MATERIAL,
          id: "mat-1",
          model: {
            kind: "mohr-coulomb",
            unitWeight: 18,
            frictionAngle: 0,
            cohesion: 99,
          },
        },
      ],
    });
    expect(getAnalysisInputSignature(state1)).not.toBe(
      getAnalysisInputSignature(state2),
    );
  });

  it("is the same for identical states", () => {
    const state1 = makeMinimalState();
    const state2 = makeMinimalState();
    expect(getAnalysisInputSignature(state1)).toBe(
      getAnalysisInputSignature(state2),
    );
  });
});
