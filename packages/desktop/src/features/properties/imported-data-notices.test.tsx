/**
 * Head and reference lines and an earlier construction stage imported from
 * .stix files have no editor: the piezometric lines dialog and the
 * materials dialog say they are there and can remove them (undoably).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MaterialModel } from "@cslope/engine";

import { PiezoDialogApp } from "./PiezoDialogApp";
import { DefineMaterialsDialog } from "./DefineMaterialsDialog";
import { useAppStore } from "../../store/app-store";
import { performUndo } from "../../store/selectors";
import type { ModelEarlierStage, ModelWaternet } from "../../store/types";

const store = () => useAppStore.getState();

const waternet: ModelWaternet = {
  headLines: [
    { id: "PL1", points: [[0, 8], [20, 4]] },
    { id: "PL2", points: [[0, 9], [20, 6]] },
  ],
  referenceLines: [{ points: [[0, 4], [20, 4]], topHeadLineId: "PL1", bottomHeadLineId: "PL2" }],
  phreaticLineId: "PL1",
};

const earlierStage: ModelEarlierStage = {
  coordinates: [[0, 0], [0, 8], [20, 5], [20, 0]],
  materials: [{ name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 17, cohesion: 5, frictionAngle: 25 } }],
};

const clay: MaterialModel = {
  kind: "shansep",
  unitWeight: 17,
  ratio: 0.25,
  exponent: 0.8,
  pop: 10,
  yieldFromEarlierStage: true,
};

/** The active model with both, as an import leaves it. */
function importBoth() {
  store().setMaterials([{ id: "clay", name: "Clay", color: "#123456", model: clay, modelExpressions: {} }]);
  useAppStore.setState((s) => ({
    waternet,
    earlierStage,
    models: s.models.map((m) => (m.id === s.activeModelId ? { ...m, waternet, earlierStage } : m)),
  }));
}

beforeEach(() => {
  store().newProject();
});

afterEach(() => {
  cleanup();
});

describe("imported head and reference lines in the piezometric lines dialog", () => {
  it("are not mentioned without them", () => {
    render(<PiezoDialogApp />);
    expect(screen.queryByTestId("waternet-notice")).toBeNull();
  });

  it("are named, removed with Remove, and back on undo", async () => {
    importBoth();
    render(<PiezoDialogApp />);
    expect(screen.getByTestId("waternet-notice")).toHaveTextContent(
      "Pore pressure comes from 2 imported head lines and 1 reference line. The piezometric lines below still set the phreatic level (saturated unit weight, free water, strength above the water) but not the pore pressure. Remove the head lines to use the piezometric lines for pore pressure.",
    );
    const remove = screen.getByRole("button", { name: "Remove the imported head and reference lines" });
    expect(remove).toHaveTextContent("Remove head lines");
    await userEvent.click(remove);
    expect(store().waternet).toBeUndefined();
    expect(store().models.find((m) => m.id === store().activeModelId)).not.toHaveProperty("waternet");
    expect(store().earlierStage).toEqual(earlierStage);
    expect(screen.queryByTestId("waternet-notice")).toBeNull();
    act(() => performUndo());
    expect(store().waternet).toEqual(waternet);
    expect(screen.getByTestId("waternet-notice")).toBeInTheDocument();
  });
});

describe("an imported earlier stage in the materials dialog", () => {
  it("is not mentioned without it", () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.queryByTestId("earlier-stage-notice")).toBeNull();
  });

  it("is named, removed with the yield stress from it, and back on undo", async () => {
    importBoth();
    render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.getByTestId("earlier-stage-notice")).toHaveTextContent(
      'An earlier stage was imported. Its effective stresses set the yield stress of Material "Clay" (marked "stage" in the list). Removing it makes this material use its POP or OCR instead.',
    );
    expect(screen.getByTestId("stage-tag")).toHaveTextContent("stage");
    expect(screen.getByTestId("ocr-override")).toHaveTextContent("Overridden by the yield stress from the earlier stage + POP 10 kPa");
    await userEvent.click(screen.getByRole("button", { name: "Remove the imported earlier stage" }));
    expect(store().earlierStage).toBeUndefined();
    expect(store().materials[0].model).not.toHaveProperty("yieldFromEarlierStage");
    expect(store().waternet).toEqual(waternet);
    expect(screen.queryByTestId("earlier-stage-notice")).toBeNull();
    expect(screen.queryByTestId("stage-tag")).toBeNull();
    expect(screen.getByTestId("ocr-override")).toHaveTextContent("Overridden by POP 10 kPa");
    expect(screen.getByTestId("ocr-override")).not.toHaveTextContent("earlier stage");
    act(() => performUndo());
    expect(store().earlierStage).toEqual(earlierStage);
    expect(store().materials[0].model).toMatchObject({ yieldFromEarlierStage: true });
    expect(screen.getByTestId("earlier-stage-notice")).toBeInTheDocument();
  });
});
