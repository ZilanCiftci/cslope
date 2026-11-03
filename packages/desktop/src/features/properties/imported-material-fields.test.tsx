/**
 * Material settings from imported .stix files that the dialog has no fields
 * for (a separate strength above the water line, the SHANSEP stress
 * history) are shown read-only and kept when other fields are edited.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MaterialModel } from "@cslope/engine";

import { DefineMaterialsDialog } from "./DefineMaterialsDialog";
import { useAppStore } from "../../store/app-store";

const store = () => useAppStore.getState();

const imported: MaterialModel = {
  kind: "shansep",
  unitWeight: 17,
  ratio: 0.25,
  exponent: 0.8,
  pop: 12,
  yieldStress: 80,
  yieldFromEarlierStage: true,
  aboveWater: { kind: "mohr-coulomb", unitWeight: 17, cohesion: 2, frictionAngle: 30 },
};

beforeEach(() => {
  store().newProject();
  store().setMaterials([{ id: "clay", name: "Clay", color: "#123456", model: imported, modelExpressions: {} }]);
});

afterEach(() => {
  cleanup();
});

describe("DefineMaterialsDialog — imported material settings", () => {
  it("shows them read-only", () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const notes = screen.getByTestId("imported-model-notes");
    expect(notes).toHaveTextContent("Separate strength above the water line: Mohr-Coulomb");
    expect(notes).toHaveTextContent("yield stress from the earlier stage + POP 12 kPa");
  });

  it("keeps them when another field is edited", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const ratio = screen.getByLabelText("S (Su/σ′v)");
    await userEvent.clear(ratio);
    await userEvent.type(ratio, "0.3");
    await userEvent.tab();
    expect(store().materials[0].model).toEqual({ ...imported, ratio: 0.3 });
  });

  it("keeps the strength above the water line when the model kind changes", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(screen.getByDisplayValue("SHANSEP"), "undrained");
    const model = store().materials[0].model;
    expect(model.kind).toBe("undrained");
    expect(model.aboveWater).toEqual(imported.aboveWater);
    expect(model).not.toHaveProperty("pop");
  });

  it("shows nothing for a material without them", () => {
    store().setMaterials([
      { id: "sand", name: "Sand", color: "#123456", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 0, frictionAngle: 34 } },
    ]);
    render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.queryByTestId("imported-model-notes")).toBeNull();
  });
});
