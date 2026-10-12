import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { InteriorBoundariesDialogApp } from "./InteriorBoundariesDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { MaterialBoundaryRow } from "../../store/types";

let bridge: FakeBridge;
const store = () => useAppStore.getState();
const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [20, 10],
  [20, 0],
];

function boundary(id: string, coordinates: [number, number][]): MaterialBoundaryRow {
  return { id, coordinates, coordinateExpressions: coordinates.map(() => ({})) };
}

function hydrate(
  materialBoundaries: MaterialBoundaryRow[],
  selectedMaterialBoundaryId: string | null = null,
) {
  bridge.emit("onInteriorBoundariesState", {
    coordinates: COORDS,
    materialBoundaries,
    selectedMaterialBoundaryId,
    parameters: [{ id: "p", name: "d", expression: "3" }],
  });
}

const sentBoundaries = () =>
  bridge.sentOf<{ materialBoundaries: MaterialBoundaryRow[] }>(
    "sendInteriorBoundariesChanged",
  );

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  store().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("InteriorBoundariesDialogApp", () => {
  it("shows a hint and a disabled Delete without boundaries", () => {
    render(<InteriorBoundariesDialogApp />);
    expect(bridge.callNames()).toContain("requestInteriorBoundariesState");
    hydrate([]);
    expect(
      screen.getByText("Add a boundary to start editing boundary coordinates."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("selects the first boundary locally without sending state back", () => {
    render(<InteriorBoundariesDialogApp />);
    hydrate([boundary("b1", [[0, 5], [20, 5]]), boundary("b2", [[0, 2], [20, 2]])]);
    expect(store().selectedMaterialBoundaryId).toBe("b1");
    expect(screen.getByText("Boundary 1 Coordinates")).toBeInTheDocument();
    expect(sentBoundaries()).toEqual([]);
  });

  it("adds a horizontal boundary at mid height and selects it", async () => {
    render(<InteriorBoundariesDialogApp />);
    hydrate([boundary("b1", [[0, 5], [20, 5]])], "b1");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    const bs = store().materialBoundaries;
    expect(bs).toHaveLength(2);
    expect(bs[1].coordinates).toEqual([
      [0, 5],
      [20, 5],
    ]);
    expect(store().selectedMaterialBoundaryId).toBe(bs[1].id);
    expect(screen.getByText("Boundary 2 Coordinates")).toBeInTheDocument();
    expect(sentBoundaries().at(-1)!.materialBoundaries).toHaveLength(2);
  });

  it("switches boundary on row click and deletes the selected one", async () => {
    render(<InteriorBoundariesDialogApp />);
    hydrate(
      [boundary("b1", [[0, 5], [20, 5]]), boundary("b2", [[0, 2], [10, 1], [20, 2]])],
      "b1",
    );
    await userEvent.click(screen.getByRole("cell", { name: "Boundary 2" }));
    expect(store().selectedMaterialBoundaryId).toBe("b2");
    expect(screen.getAllByLabelText(/^Boundary 2 point \d X$/)).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(store().materialBoundaries.map((b) => b.id)).toEqual(["b1"]);
    expect(store().selectedMaterialBoundaryId).toBe("b1");
  });

  it("edits points with numbers and expressions", async () => {
    render(<InteriorBoundariesDialogApp />);
    hydrate([boundary("b1", [[0, 5], [20, 5]])], "b1");
    const y1 = screen.getByLabelText("Boundary 1 point 1 Y");
    await userEvent.clear(y1);
    await userEvent.type(y1, "d*2");
    await userEvent.tab();
    const b = store().materialBoundaries[0];
    expect(b.coordinates[0]).toEqual([0, 6]);
    expect(b.coordinateExpressions?.[0]).toEqual({ y: "d*2" });

    const x2 = screen.getByLabelText("Boundary 1 point 2 X");
    await userEvent.clear(x2);
    await userEvent.type(x2, "18.5");
    await userEvent.tab();
    expect(store().materialBoundaries[0].coordinates[1]).toEqual([18.5, 5]);
    expect(sentBoundaries().at(-1)!.materialBoundaries[0].coordinates[1]).toEqual([
      18.5, 5,
    ]);
  });

  it("adds points 2 m to the right of the last one and removes them", async () => {
    render(<InteriorBoundariesDialogApp />);
    hydrate([boundary("b1", [[0, 5], [10, 4]])], "b1");
    expect(screen.queryByRole("button", { name: "Remove point 1" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "+ Add Point" }));
    expect(store().materialBoundaries[0].coordinates).toEqual([
      [0, 5],
      [10, 4],
      [12, 4],
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    expect(store().materialBoundaries[0].coordinates).toEqual([
      [10, 4],
      [12, 4],
    ]);
  });

  it("clears its selection when the main window removes every boundary", () => {
    render(<InteriorBoundariesDialogApp />);
    hydrate([boundary("b1", [[0, 5], [20, 5]])], "b1");
    bridge.emit("onInteriorBoundariesChanged", {
      coordinates: COORDS,
      materialBoundaries: [],
      selectedMaterialBoundaryId: "b1",
    });
    expect(store().selectedMaterialBoundaryId).toBeNull();
    expect(
      screen.getByText("Add a boundary to start editing boundary coordinates."),
    ).toBeInTheDocument();
    expect(sentBoundaries()).toEqual([]);
  });
});
