/**
 * Material settings from imported files that the dialog has no fields for
 * (a separate strength above the water line, the SHANSEP stress history)
 * are shown read-only, kept when other fields are edited, and can be
 * removed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MaterialModel } from "@cslope/engine";

import { DefineMaterialsDialog } from "./DefineMaterialsDialog";
import { useAppStore } from "../../store/app-store";
import { performUndo } from "../../store/selectors";

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
    const above = screen.getByTestId("above-water-strength");
    expect(above).toHaveTextContent("Strength above the water line (imported): Mohr-Coulomb");
    expect(above).toHaveTextContent("c′ = 2 kPa, φ′ = 30°");
    expect(screen.getByTestId("ocr-override")).toHaveTextContent("Overridden by the yield stress from the earlier stage + POP 12 kPa");
    // OCR does not apply: POP takes its place, the OCR table is disabled.
    expect(screen.queryByLabelText("OCR")).toBeNull();
    expect(screen.getByLabelText("POP (kPa)")).toHaveValue("12");
    expect(screen.getByLabelText("OCR against elevation")).toBeDisabled();
  });

  it("edits the POP added to the earlier stage, and empties it", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const pop = screen.getByLabelText("POP (kPa)");
    await userEvent.clear(pop);
    await userEvent.type(pop, "20");
    await userEvent.tab();
    expect(store().materials[0].model).toEqual({ ...imported, pop: 20 });
    expect(screen.getByTestId("ocr-override")).toHaveTextContent("+ POP 20 kPa");
    // One undo step for the whole edit.
    act(() => performUndo());
    expect(store().materials[0].model).toEqual(imported);
    await userEvent.clear(screen.getByLabelText("POP (kPa)"));
    await userEvent.tab();
    expect(store().materials[0].model).toEqual({ ...imported, pop: undefined });
    // The earlier stage still applies: the field stays, empty.
    expect(screen.getByLabelText("POP (kPa)")).toHaveValue("");
  });

  it("edits a POP or a yield stress alone, which emptying does not remove", async () => {
    store().setMaterials([
      { id: "a", name: "A", color: "#123456", model: { kind: "shansep", unitWeight: 17, ratio: 0.25, pop: 20 }, modelExpressions: {} },
    ]);
    const { unmount } = render(<DefineMaterialsDialog onClose={() => {}} />);
    const pop = screen.getByLabelText("POP (kPa)");
    await userEvent.clear(pop);
    await userEvent.tab();
    expect(store().materials[0].model).toMatchObject({ pop: 20 });
    await userEvent.type(pop, "{Control>}a{/Control}35");
    expect(store().materials[0].model).toMatchObject({ pop: 35 });
    unmount();
    store().setMaterials([
      { id: "b", name: "B", color: "#123456", model: { kind: "shansep", unitWeight: 17, ratio: 0.25, yieldStress: 90 }, modelExpressions: {} },
    ]);
    render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.queryByLabelText("POP (kPa)")).toBeNull();
    const sy = screen.getByLabelText("σ′y (yield stress) (kPa)");
    await userEvent.clear(sy);
    await userEvent.type(sy, "120");
    expect(store().materials[0].model).toMatchObject({ yieldStress: 120 });
  });

  it("removes the strength above the water line in one undoable step", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove the strength above the water line" }));
    expect(store().materials[0].model.aboveWater).toBeUndefined();
    expect(screen.queryByTestId("above-water-strength")).toBeNull();
    // Another kind does not bring it back.
    await userEvent.selectOptions(screen.getByDisplayValue("SHANSEP"), "undrained");
    expect(store().materials[0].model.aboveWater).toBeUndefined();
    act(() => performUndo());
    act(() => performUndo());
    expect(store().materials[0].model.aboveWater).toEqual(imported.aboveWater);
  });

  it("uses OCR instead of the stress history in one undoable step", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Use OCR instead" }));
    const model = store().materials[0].model as Extract<MaterialModel, { kind: "shansep" }>;
    expect(model.pop).toBeUndefined();
    expect(model.yieldStress).toBeUndefined();
    expect(model.yieldFromEarlierStage).toBeUndefined();
    expect(screen.queryByTestId("ocr-override")).toBeNull();
    expect(screen.getByLabelText("OCR")).toBeEnabled();
    act(() => performUndo());
    expect(store().materials[0].model).toEqual(imported);
  });

  it("names a POP or a yield stress alone", () => {
    store().setMaterials([
      { id: "a", name: "A", color: "#123456", model: { kind: "shansep", unitWeight: 17, ratio: 0.25, pop: 20 }, modelExpressions: {} },
    ]);
    const { unmount } = render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.getByTestId("ocr-override")).toHaveTextContent("Overridden by POP 20 kPa");
    unmount();
    store().setMaterials([
      { id: "b", name: "B", color: "#123456", model: { kind: "shansep", unitWeight: 17, ratio: 0.25, yieldStress: 90 }, modelExpressions: {} },
    ]);
    render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.getByTestId("ocr-override")).toHaveTextContent("Overridden by the yield stress σ′y 90 kPa");
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
    expect(screen.queryByTestId("above-water-strength")).toBeNull();
    expect(screen.queryByTestId("ocr-override")).toBeNull();
  });
});
