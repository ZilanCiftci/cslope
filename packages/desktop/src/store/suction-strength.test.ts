/**
 * Strength from suction (φb, maximum suction): project-file round trip,
 * what reaches the engine, the material table and the analysis summary.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS, type AnalysisResult, type MaterialModel } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";
import { buildSlopeDTOFromModel, getAnalysisInputSignature } from "./helpers";
import { buildMaterialTableData } from "../features/canvas/helpers";
import { buildAnalysisSummary, strengthText } from "../features/export/analysisSummary";
import { DEFAULT_ANALYSIS_LIMITS } from "./defaults";
import type { MaterialRow } from "./types";

const row = (id: string, model: MaterialModel): MaterialRow => ({ id, name: id, color: "#888888", model, modelExpressions: {} });

function withMaterials(models: MaterialModel[]) {
  useAppStore.setState({ materials: models.map((m, i) => row(`mat-${i + 1}`, m)) });
}

function roundTrip() {
  useAppStore.getState().saveCurrentModel();
  return parseProjectFile(JSON.stringify(serializeProject(useAppStore.getState()))).models[0];
}

function loadWithRawMaterials(models: unknown[]) {
  useAppStore.getState().saveCurrentModel();
  const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
  raw.models[0].materials = models.map((model, i) => ({ id: `mat-${i + 1}`, name: `M${i + 1}`, color: "#888888", model }));
  return parseProjectFile(JSON.stringify(raw)).models[0];
}

const mc = { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 } as const;
const combinedDepth: MaterialModel = { kind: "s-f-depth", unitWeight: 16, suRef: 10, depthRef: 0, rate: 1.5, drainedCohesion: 1, drainedFrictionAngle: 30, phiB: 12 };

describe("φb in the project file", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("keeps φb and the maximum suction and passes them to the engine", () => {
    const models: MaterialModel[] = [
      { ...mc, phiB: 15, maxSuction: 60 },
      { ...mc, phiB: 10 },
      { kind: "anisotropic-function", unitWeight: 18, cohesion: 5, frictionAngle: 30, modifierFunction: [[0, 1], [90, 1]], phiB: 20 },
      combinedDepth,
    ];
    withMaterials(models);
    const loaded = roundTrip();
    expect(loaded.materials.map((m) => m.model)).toEqual(models);
    const dto = buildSlopeDTOFromModel(loaded);
    expect(dto.materials[0].model).toMatchObject({ phiB: 15, maxSuction: 60 });
    expect(dto.materials[3].model).toMatchObject({ phiB: 12 });
  });

  it("a material without φb is saved without it", () => {
    withMaterials([{ ...mc, phiB: undefined, maxSuction: undefined }]);
    const m = roundTrip().materials[0].model;
    expect("phiB" in m).toBe(false);
    expect("maxSuction" in m).toBe(false);
  });

  it("drops an invalid φb or maximum, and φb on a model that does not take it", () => {
    const loaded = loadWithRawMaterials([
      { ...mc, phiB: 95, maxSuction: -1 },
      { ...mc, phiB: "x", maxSuction: 40 },
      { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30, phiB: 10, maxSuction: 20 },
    ]);
    const [a, b, c] = loaded.materials.map((m) => m.model);
    expect(a).toEqual(mc);
    expect(b).toEqual({ ...mc, maxSuction: 40 });
    expect(c).toEqual({ kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 });
  });

  it("φb and the maximum change the analysis input", () => {
    withMaterials([{ ...mc }]);
    const plain = getAnalysisInputSignature(useAppStore.getState());
    withMaterials([{ ...mc, phiB: 15 }]);
    const withPhiB = getAnalysisInputSignature(useAppStore.getState());
    withMaterials([{ ...mc, phiB: 15, maxSuction: 50 }]);
    const capped = getAnalysisInputSignature(useAppStore.getState());
    expect(new Set([plain, withPhiB, capped]).size).toBe(3);
  });
});

describe("φb in the material table and the summary", () => {
  it("shows φb with the friction angle", () => {
    const table = buildMaterialTableData({ id: "t", type: "material-table", x: 0, y: 0 } as never, [
      row("a", { ...mc, phiB: 15 }),
      row("b", { ...mc }),
      row("c", combinedDepth),
    ]);
    const phi = table.columnKeys.indexOf("frictionAngle");
    expect(table.rows[0][phi]).toBe("30° (φb 15°)");
    expect(table.rows[1][phi]).toBe("30°");
    expect(table.rows[2][phi]).toBe("30° (comb.) (φb 12°)");
  });

  it("describes the suction strength", () => {
    expect(strengthText({ ...mc, phiB: 15, maxSuction: 60 })).toBe("c' = 5 kPa, φ' = 30°; suction above the water line, φb = 15°, at most 60 kPa");
    expect(strengthText({ ...mc, phiB: 15 })).toMatch(/φb = 15°$/);
    expect(strengthText({ ...mc })).not.toMatch(/suction/);
    expect(strengthText({ ...combinedDepth, drainedCohesion: undefined, drainedFrictionAngle: undefined })).not.toMatch(/suction/);
    const s = buildAnalysisSummary({
      result: { minFOS: 1.2, criticalSurface: null, allSurfaces: [], criticalSlices: [], elapsedMs: 1 } as unknown as AnalysisResult,
      options: { ...DEFAULT_ANALYSIS_OPTIONS },
      analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, enabled: false },
      orientation: "ltr",
      piezometricLine: { enabled: true, lines: [{ id: "l", name: "Line 1", coordinates: [[0, 0], [10, 0]] } as never], activeLineId: "l", materialAssignment: {} },
      materials: [row("Fill", { ...mc, phiB: 15 }), row("Clay", { ...mc })],
      udls: [],
      lineLoads: [],
    });
    const water = s.find((x) => x.title === "Water and tension crack")!.rows!;
    expect(water.find((r) => r.label === "Suction")?.value).toMatch(/tan φb adds to c' in Fill$/);
  });
});
