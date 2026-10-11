/**
 * Depth reference of S = f(depth) and the strength cutoff (suMax): defaults
 * for new materials, project-file round trip and what reaches the engine.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { MaterialModel } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";
import { buildSlopeDTOFromModel, getAnalysisInputSignature } from "./helpers";
import { createDefaultModel } from "../features/properties/sections/material-forms/model-defaults";
import { buildMaterialTableData } from "../features/canvas/helpers";
import type { MaterialRow } from "./types";

const row = (id: string, model: MaterialModel): MaterialRow => ({
  id,
  name: id,
  color: "#888888",
  model,
  modelExpressions: {},
});

function withMaterials(models: MaterialModel[]) {
  useAppStore.setState({
    materials: models.map((m, i) => row(`mat-${i + 1}`, m)),
  });
}

function roundTrip() {
  useAppStore.getState().saveCurrentModel();
  const json = JSON.stringify(serializeProject(useAppStore.getState()));
  return parseProjectFile(json).models[0];
}

/** Load a project file whose first model's materials are `models`. */
function loadWithRawMaterials(models: unknown[]) {
  useAppStore.getState().saveCurrentModel();
  const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
  raw.models[0].materials = models.map((model, i) => ({
    id: `mat-${i + 1}`,
    name: `M${i + 1}`,
    color: "#888888",
    model,
  }));
  return parseProjectFile(JSON.stringify(raw)).models[0];
}

const sfDepth = { kind: "s-f-depth", unitWeight: 16, suRef: 10, depthRef: 0, rate: 1.5 } as const;

describe("defaults for new materials", () => {
  it("a new S = f(depth) measures depth from the top of the layer", () => {
    const m = createDefaultModel("s-f-depth");
    expect(m).toMatchObject({ kind: "s-f-depth", depthReference: "layer-top" });
  });

  it("new models have no cutoff", () => {
    for (const kind of ["s-f-depth", "s-f-datum", "undrained", "lime-cement-columns"] as const) {
      expect("suMax" in createDefaultModel(kind)).toBe(false);
    }
  });
});

describe("project file round trip", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("a saved S = f(depth) without a depth reference stays without (ground)", () => {
    const loaded = loadWithRawMaterials([sfDepth]);
    expect(loaded.materials[0].model).toEqual(sfDepth);
    expect("depthReference" in loaded.materials[0].model).toBe(false);
    // And it is saved again without one.
    withMaterials([loaded.materials[0].model]);
    const again = roundTrip();
    expect("depthReference" in again.materials[0].model).toBe(false);
  });

  it("keeps the depth reference and the cutoffs", () => {
    const models: MaterialModel[] = [
      { ...sfDepth, depthReference: "layer-top", suMax: 40 },
      { ...sfDepth, depthReference: "ground" },
      { kind: "s-f-datum", unitWeight: 16, suRef: 10, yRef: 0, rate: 1.5, suMax: 35 },
      { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30, suMax: 25 },
      { kind: "lime-cement-columns", unitWeight: 16, soilSu: 10, columnSu: 100, areaRatio: 0.2, suMax: 20 },
    ];
    withMaterials(models);
    const loaded = roundTrip();
    expect(loaded.materials.map((m) => m.model)).toEqual(models);
  });

  it("drops an invalid cutoff or depth reference", () => {
    const loaded = loadWithRawMaterials([
      { ...sfDepth, depthReference: "surface", suMax: -5 },
      { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30, suMax: "x" },
      { kind: "s-f-datum", unitWeight: 16, suRef: 10, yRef: 0, rate: 1.5, suMax: 0 },
    ]);
    const [a, b, c] = loaded.materials.map((m) => m.model);
    expect(a).toEqual(sfDepth);
    expect("suMax" in b).toBe(false);
    expect("suMax" in c).toBe(false);
  });

  it("a cleared cutoff (undefined) is not saved", () => {
    withMaterials([{ ...sfDepth, suMax: undefined }]);
    const loaded = roundTrip();
    expect("suMax" in loaded.materials[0].model).toBe(false);
  });
});

describe("analysis input", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("the depth reference and the cutoff reach the engine and the signature", () => {
    withMaterials([{ ...sfDepth }]);
    const plain = getAnalysisInputSignature(useAppStore.getState());
    withMaterials([{ ...sfDepth, depthReference: "layer-top" }]);
    const layerTop = getAnalysisInputSignature(useAppStore.getState());
    withMaterials([{ ...sfDepth, depthReference: "layer-top", suMax: 30 }]);
    const capped = getAnalysisInputSignature(useAppStore.getState());
    expect(new Set([plain, layerTop, capped]).size).toBe(3);

    const dto = buildSlopeDTOFromModel(roundTrip());
    expect(dto.materials[0].model).toMatchObject({ depthReference: "layer-top", suMax: 30 });
  });
});

describe("material table", () => {
  it("shows the depth reference and the cutoff", () => {
    const table = buildMaterialTableData(
      { id: "t", type: "material-table", x: 0, y: 0 } as never,
      [
        row("a", { ...sfDepth, depthReference: "layer-top", suMax: 40 }),
        row("b", { ...sfDepth }),
        row("c", { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30, suMax: 25 }),
      ],
    );
    const depthCol = table.columnKeys.indexOf("depthRef");
    const rateCol = table.columnKeys.indexOf("cRate");
    const cohesionCol = table.columnKeys.indexOf("cohesion");
    expect(table.rows[0][depthCol]).toBe("0 (below layer top)");
    expect(table.rows[0][rateCol]).toBe("1.5 (cutoff 40)");
    expect(table.rows[1][depthCol]).toBe("0");
    expect(table.rows[1][rateCol]).toBe("1.5");
    expect(table.rows[2][cohesionCol]).toBe("30 (cutoff 25)");
  });
});
