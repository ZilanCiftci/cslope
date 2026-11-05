/**
 * SHANSEP and shear-normal materials, and the excess pore pressure from
 * fills (B̄, bBarLoad): project-file round trip, load clean-up and what
 * reaches the engine.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { MaterialModel } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";
import { buildSlopeDTOFromModel } from "./helpers";
import { createDefaultModel } from "../features/properties/sections/material-forms/model-defaults";
import { buildMaterialTableData } from "../features/canvas/helpers";
import { strengthText } from "../features/export/analysisSummary";
import type { MaterialRow } from "./types";

const row = (id: string, model: MaterialModel): MaterialRow => ({
  id,
  name: id,
  color: "#888888",
  model,
  modelExpressions: {},
});

function roundTrip(models: MaterialModel[]) {
  useAppStore.setState({ materials: models.map((m, i) => row(`mat-${i + 1}`, m)) });
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

const shansep: MaterialModel = {
  kind: "shansep",
  unitWeight: 16,
  unitWeightSat: 17,
  ratio: 0.22,
  exponent: 0.75,
  ocr: 1.5,
  ocrByElevation: [
    [-10, 1.2],
    [0, 2],
  ],
  suByStress: [
    [0, 5],
    [100, 30],
  ],
  suMin: 4,
  anisotropy: [
    [-45, 0.8],
    [0, 1],
    [60, 1.3],
  ],
  bBar: 0.9,
};
const fill: MaterialModel = { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 35, bBarLoad: true };
const shearNormal: MaterialModel = {
  kind: "shear-normal",
  unitWeight: 19,
  points: [
    [0, 0],
    [100, 60],
    [300, 150],
  ],
  bBar: 0.5,
};

describe("defaults for new materials", () => {
  it("SHANSEP and shear-normal defaults", () => {
    expect(createDefaultModel("shansep")).toEqual({ kind: "shansep", unitWeight: 18, ratio: 0.25, exponent: 0.8, ocr: 1 });
    expect(createDefaultModel("shear-normal")).toMatchObject({ kind: "shear-normal", points: [[0, 0], [100, 60], [300, 150]] });
  });
});

describe("project file round trip", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("keeps a SHANSEP material with B̄, a fill and a shear-normal function, and passes them to the engine", () => {
    const loaded = roundTrip([shansep, fill, shearNormal]);
    expect(loaded.materials.map((m) => m.model)).toEqual([shansep, fill, shearNormal]);
    const dto = buildSlopeDTOFromModel(loaded);
    expect(dto.materials.map((m) => m.model)).toEqual([shansep, fill, shearNormal]);
  });

  it("drops a bad B̄, a fill flag that is not true, empty SHANSEP tables and a negative minimum Su", () => {
    const loaded = loadWithRawMaterials([
      { kind: "shansep", unitWeight: 16, ratio: 0.25, bBar: 3, ocrByElevation: [], suByStress: "x", suMin: -1, anisotropy: [] },
      { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 35, bBar: "0.5", bBarLoad: "yes" },
      { kind: "shear-normal", unitWeight: 19 },
    ]);
    expect(loaded.materials[0].model).toEqual({ kind: "shansep", unitWeight: 16, ratio: 0.25 });
    expect(loaded.materials[1].model).toEqual({ kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 35 });
    expect(loaded.materials[2].model).toEqual({ kind: "shear-normal", unitWeight: 19, points: [] });
  });
});

describe("display", () => {
  it("material table shows S and m of a SHANSEP material, and the points of a shear-normal function", () => {
    const plain: MaterialModel = { kind: "shansep", unitWeight: 16, ratio: 0.25, exponent: 0.8 };
    const table = buildMaterialTableData(
      { id: "t", type: "material-table", x: 0, y: 0 } as never,
      [row("a", plain), row("b", shearNormal)],
    );
    const cohesion = table.columnKeys.indexOf("cohesion");
    const phi = table.columnKeys.indexOf("frictionAngle");
    expect(table.rows[0][cohesion]).toBe("S 0.25, m 0.8");
    expect(table.rows[0][phi]).toBe("0°");
    expect(table.rows[1][cohesion]).toBe("τ(σn), 3 pts");
  });

  it("summary text", () => {
    expect(strengthText({ kind: "shansep", unitWeight: 16, ratio: 0.25 })).toBe("Su = σ'v · S · OCR^m (SHANSEP), S = 0.25, m = 0.8, OCR = 1");
    expect(strengthText(shansep)).toMatch(/^Su against σ'v \(SHANSEP\), 5 kPa at 0 kPa, 30 kPa at 100 kPa, at least 4 kPa; anisotropic/);
    expect(strengthText(shansep)).toMatch(/B̄ = 0\.9/);
    expect(strengthText(fill)).toMatch(/fill \(its weight raises the pore pressure below, B̄\)$/);
    expect(strengthText(shearNormal)).toMatch(/^τ against σ'n, 0 kPa at 0 kPa, 60 kPa at 100 kPa, 150 kPa at 300 kPa/);
  });
});
