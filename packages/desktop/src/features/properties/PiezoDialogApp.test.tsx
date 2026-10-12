import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { PiezoDialogApp } from "./PiezoDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { PiezometricLineState } from "../../store/types";

let bridge: FakeBridge;
const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [20, 10],
  [20, 0],
];
const store = () => useAppStore.getState();
const pl = () => store().piezometricLine;

function hydrate(piezometricLine: Partial<PiezometricLineState> = {}) {
  bridge.emit("onPiezoState", {
    piezometricLine: {
      enabled: false,
      lines: [],
      activeLineId: null,
      materialAssignment: {},
      ...piezometricLine,
    },
    coordinates: COORDS,
    materials: store().materials,
    parameters: [{ id: "p", name: "W", expression: "6" }],
  });
}

function line(id: string, name: string, coordinates: [number, number][]) {
  return {
    id,
    name,
    color: "#00f",
    coordinates,
    coordinateExpressions: coordinates.map(() => ({})),
  };
}

beforeEach(() => {
  store().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("PiezoDialogApp", () => {
  it("shows a hint and a disabled Delete button without lines", () => {
    render(<PiezoDialogApp />);
    hydrate();
    expect(
      screen.getByText("Add a piezometric line to start editing coordinates."),
    ).toBeInTheDocument();
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByLabelText("Free water above ground")).toBeNull();
  });

  it("adds a horizontal line across the model at mid height", async () => {
    render(<PiezoDialogApp />);
    hydrate();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(pl().lines).toHaveLength(1);
    expect(pl().lines[0].coordinates).toEqual([
      [0, 5],
      [20, 5],
    ]);
    expect(pl().activeLineId).toBe(pl().lines[0].id);
    expect(screen.getByText("Line 1 Coordinates")).toBeInTheDocument();
    const sent = bridge.sentOf<{ piezometricLine: PiezometricLineState }>(
      "sendPiezoChanged",
    );
    expect(sent.at(-1)!.piezometricLine.lines).toHaveLength(1);
    // Two points: they cannot be removed.
    expect(screen.queryByLabelText("Remove piezometric point 1")).toBeNull();
  });

  it("adds points 5 m to the right of the last one and removes them", async () => {
    render(<PiezoDialogApp />);
    hydrate({
      lines: [line("a", "Line 1", [[0, 4], [10, 4]])],
      activeLineId: "a",
    });
    await userEvent.click(screen.getByRole("button", { name: "+ Add Point" }));
    expect(pl().lines[0].coordinates).toEqual([
      [0, 4],
      [10, 4],
      [15, 4],
    ]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove piezometric point 2" }),
    );
    expect(pl().lines[0].coordinates).toEqual([
      [0, 4],
      [15, 4],
    ]);
  });

  it("starts an empty line at the left edge", async () => {
    render(<PiezoDialogApp />);
    hydrate({ lines: [line("a", "Line 1", [])], activeLineId: "a" });
    await userEvent.click(screen.getByRole("button", { name: "+ Add Point" }));
    expect(pl().lines[0].coordinates).toEqual([[0, 5]]);
  });

  it("edits coordinates with numbers and parameter expressions", async () => {
    render(<PiezoDialogApp />);
    hydrate({
      lines: [line("a", "Line 1", [[0, 4], [10, 4]])],
      activeLineId: "a",
    });
    const y2 = screen.getByLabelText("Piezometric point 2 Y");
    await userEvent.clear(y2);
    await userEvent.type(y2, "W+1");
    await userEvent.tab();
    expect(pl().lines[0].coordinates[1]).toEqual([10, 7]);
    expect(pl().lines[0].coordinateExpressions?.[1]).toEqual({ y: "W+1" });

    const x1 = screen.getByLabelText("Piezometric point 1 X");
    await userEvent.clear(x1);
    await userEvent.type(x1, "-2");
    await userEvent.tab();
    expect(pl().lines[0].coordinates[0]).toEqual([-2, 4]);
  });

  it("switches the edited line, deletes it and selects the remaining one", async () => {
    render(<PiezoDialogApp />);
    hydrate({
      lines: [
        line("a", "Line 1", [[0, 4], [10, 4]]),
        line("b", "Line 2", [[0, 6], [10, 6], [20, 6]]),
      ],
      activeLineId: "a",
    });
    await userEvent.click(screen.getByRole("cell", { name: "Line 2" }));
    expect(pl().activeLineId).toBe("b");
    expect(screen.getByText("Line 2 Coordinates")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Piezometric point \d X/)).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(pl().lines.map((l) => l.id)).toEqual(["a"]);
    expect(pl().activeLineId).toBe("a");
    expect(screen.getByText("Line 1 Coordinates")).toBeInTheDocument();
  });

  it("toggles free water and chooses the main line", async () => {
    render(<PiezoDialogApp />);
    hydrate({
      lines: [
        line("a", "Line 1", [[0, 4], [10, 4]]),
        line("b", "Line 2", [[0, 6], [10, 6]]),
      ],
      activeLineId: "a",
    });
    const freeWater = screen.getByLabelText("Free water above ground");
    expect(freeWater).toBeChecked();
    await userEvent.click(freeWater);
    expect(pl().freeWater).toBe(false);
    expect(freeWater).not.toBeChecked();

    const main = screen.getByLabelText("Main piezometric line") as HTMLSelectElement;
    expect(main.value).toBe("a");
    await userEvent.selectOptions(main, "b");
    expect(pl().mainLineId).toBe("b");
  });

  it("assigns a line per material when there are several lines", async () => {
    render(<PiezoDialogApp />);
    hydrate({
      lines: [
        line("a", "Line 1", [[0, 4], [10, 4]]),
        line("b", "Line 2", [[0, 6], [10, 6]]),
      ],
      activeLineId: "a",
    });
    expect(screen.getByText("Material Assignment")).toBeInTheDocument();
    const m = store().materials[0];
    expect(screen.getByText(m.name)).toBeInTheDocument();
    // Unassigned materials follow the main line.
    const selects = screen.getAllByRole("combobox");
    const matSelect = selects[selects.length - 1] as HTMLSelectElement;
    expect(matSelect.value).toBe("a");
    await userEvent.selectOptions(matSelect, "b");
    expect(pl().materialAssignment[m.id]).toBe("b");
  });

  it("ignores incomplete payloads and does not echo incoming state", () => {
    render(<PiezoDialogApp />);
    hydrate({ lines: [line("a", "Line 1", [[0, 4], [10, 4]])], activeLineId: "a" });
    bridge.emit("onPiezoChanged", { piezometricLine: null, coordinates: [] });
    bridge.emit("onPiezoChanged", undefined);
    expect(pl().lines).toHaveLength(1);
    expect(store().coordinates).toEqual(COORDS);
    expect(bridge.sentOf("sendPiezoChanged")).toEqual([]);
  });
});
