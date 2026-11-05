/**
 * Rapid drawdown (three-stage): the drawdown (R) envelope of a material and
 * the water before drawdown on the model. Project-file round trip, load
 * clean-up, what reaches the engine, mirroring and the summary.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { MaterialModel, SlopeDefinition } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";
import { buildSlopeDTOFromModel, getAnalysisInputSignature } from "./helpers";
import { modelFromDefinition } from "./definition-model";
import { mirrorModelEntry } from "./benchmarks";
import { strengthText } from "../features/export/analysisSummary";
import type { MaterialRow } from "./types";

const clay: MaterialModel = {
  kind: "mohr-coulomb",
  unitWeight: 19,
  cohesion: 5,
  frictionAngle: 28,
  drawdownStrength: { cohesion: 10, frictionAngle: 15 },
};
const sand: MaterialModel = { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 35 };
const waterBefore: [number, number][] = [
  [0, 9],
  [40, 9],
];

const row = (id: string, model: MaterialModel): MaterialRow => ({ id, name: id, color: "#888888", model, modelExpressions: {} });

/** The active model saved to a project file and read back. */
function roundTrip() {
  useAppStore.getState().saveCurrentModel();
  return parseProjectFile(JSON.stringify(serializeProject(useAppStore.getState()))).models[0];
}

/** A project file whose first model is changed by `edit` before it is read. */
function loadEdited(edit: (model: Record<string, unknown>) => void) {
  useAppStore.getState().saveCurrentModel();
  const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
  edit(raw.models[0]);
  return parseProjectFile(JSON.stringify(raw)).models[0];
}

describe("rapid drawdown", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.setState({ materials: [row("mat-1", clay), row("mat-2", sand)] });
    useAppStore.getState().addPiezoLine([
      [0, 4],
      [40, 4],
    ]);
    useAppStore.getState().setPiezoRapidDrawdown({ waterBefore });
  });

  it("keeps the drawdown envelope and the water before drawdown in the project file, and passes them to the engine", () => {
    const loaded = roundTrip();
    expect(loaded.materials.map((m) => m.model)).toEqual([clay, sand]);
    expect(loaded.piezometricLine.rapidDrawdown).toEqual({ waterBefore });
    const dto = buildSlopeDTOFromModel(loaded);
    expect(dto.materials.map((m) => m.model)).toEqual([clay, sand]);
    expect(dto.rapidDrawdown).toEqual({ waterBefore });
    expect(dto.waterTable).toMatchObject({ value: [[0, 4], [40, 4]] });
  });

  it("turning it off removes it, from the model and the engine's definition", () => {
    const before = getAnalysisInputSignature(useAppStore.getState());
    useAppStore.getState().setPiezoRapidDrawdown(undefined);
    expect("rapidDrawdown" in useAppStore.getState().piezometricLine).toBe(false);
    expect(getAnalysisInputSignature(useAppStore.getState())).not.toBe(before);
    expect(buildSlopeDTOFromModel(roundTrip()).rapidDrawdown).toBeUndefined();
  });

  it("drops a bad envelope and a bad line on load", () => {
    const bad = (rawModel: unknown, line: unknown) =>
      loadEdited((m) => {
        (m.materials as { model: unknown }[])[0].model = rawModel;
        (m.piezometricLine as Record<string, unknown>).rapidDrawdown = { waterBefore: line };
      });
    const mc = { kind: "mohr-coulomb", unitWeight: 19, cohesion: 5, frictionAngle: 28 };
    for (const [r, line] of [
      [{ cohesion: -1, frictionAngle: 15 }, [[0, 9]]],
      [{ cohesion: 10, frictionAngle: 90 }, [[0, 9], [0, 9]]],
      [{ cohesion: "10", frictionAngle: 15 }, [[0, 9], [40, Number.NaN]]],
      [null, "x"],
    ] as const) {
      const loaded = bad({ ...mc, drawdownStrength: r }, line);
      expect(loaded.materials[0].model).toEqual(mc);
      expect(loaded.piezometricLine.rapidDrawdown).toBeUndefined();
    }
    // only on a Mohr-Coulomb material
    const undrained = bad({ kind: "undrained", unitWeight: 17, undrainedShearStrength: 20, drawdownStrength: { cohesion: 1, frictionAngle: 1 } }, waterBefore);
    expect(undrained.materials[0].model).toEqual({ kind: "undrained", unitWeight: 17, undrainedShearStrength: 20 });
    expect(undrained.piezometricLine.rapidDrawdown).toEqual({ waterBefore });
  });

  it("is kept by a model made from a definition, and mirrored with x still increasing", () => {
    const def: SlopeDefinition = {
      orientation: "ltr",
      coordinates: [[0, 0], [0, 10], [10, 10], [30, 3], [40, 3], [40, 0]],
      materials: [{ name: "Clay", model: clay }],
      waterTable: { mode: "custom", value: [[0, 4], [40, 4]] },
      rapidDrawdown: { waterBefore: [[0, 9], [20, 8], [40, 8]] },
    };
    const model = modelFromDefinition(def, { id: "m", name: "Dam" });
    expect(model.piezometricLine.rapidDrawdown).toEqual(def.rapidDrawdown);
    expect(buildSlopeDTOFromModel(model).rapidDrawdown).toEqual(def.rapidDrawdown);
    expect(mirrorModelEntry(model).piezometricLine.rapidDrawdown).toEqual({ waterBefore: [[0, 8], [20, 8], [40, 9]] });
  });

  it("the summary names the drawdown envelope", () => {
    expect(strengthText(clay)).toMatch(/drawdown strength \(R envelope\) cR = 10 kPa, φR = 15°/);
    expect(strengthText(sand)).not.toMatch(/drawdown/);
  });
});
