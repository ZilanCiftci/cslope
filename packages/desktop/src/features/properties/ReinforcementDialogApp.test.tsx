import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { ReinforcementDialogApp } from "./ReinforcementDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { PileRow, ReinforcementRow } from "../../store/types";
import { newPile, newReinforcement } from "../../utils/reinforcement";

let bridge: FakeBridge;
const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [20, 10],
  [20, 0],
];

function hydrate(reinforcements: ReinforcementRow[] = [], piles: PileRow[] = []) {
  bridge.emit("onLoadsState", {
    udls: [],
    lineLoads: [],
    reinforcements,
    piles,
    coordinates: COORDS,
    orientation: "ltr",
  });
}

const store = () => useAppStore.getState();

async function setCell(label: string, text: string, index = 0) {
  const input = screen.getAllByLabelText(label)[index];
  await userEvent.clear(input);
  if (text) await userEvent.type(input, text);
  return input as HTMLInputElement;
}

/** Pastes a whole value at once (no per-keystroke intermediate values). */
function pasteCell(label: string, text: string, index = 0) {
  fireEvent.change(screen.getAllByLabelText(label)[index], {
    target: { value: text },
  });
}

beforeEach(() => {
  store().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("ReinforcementDialogApp — elements", () => {
  it("adds an element of the chosen type below the ground and broadcasts it", async () => {
    render(<ReinforcementDialogApp />);
    hydrate();
    expect(store().coordinates).toEqual(COORDS);
    await userEvent.selectOptions(
      screen.getByLabelText("Type of the new reinforcement"),
      "nail",
    );
    const addButtons = screen.getAllByRole("button", { name: "+ Add" });
    await userEvent.click(addButtons[0]);
    const [row] = store().reinforcements;
    expect(row.type).toBe("nail");
    expect(row.x1).toBe(10);
    expect(row.y1).toBe(9);
    expect(row.tensileCapacity).toBe(100);
    const last = bridge
      .sentOf<{ reinforcements: ReinforcementRow[] }>("sendLoadsChanged")
      .at(-1)!;
    expect(last.reinforcements).toHaveLength(1);
  });

  it("does not send back the state that arrived from the main window", () => {
    render(<ReinforcementDialogApp />);
    hydrate([newReinforcement("r1", "anchor", COORDS, "ltr")]);
    expect(bridge.sentOf("sendLoadsChanged")).toEqual([]);
    expect(screen.getAllByLabelText("Reinforcement type")).toHaveLength(1);
  });

  it("keeps the existing reinforcement when a UDL window sends loads only", () => {
    render(<ReinforcementDialogApp />);
    hydrate([newReinforcement("r1", "anchor", COORDS, "ltr")]);
    bridge.emit("onLoadsChanged", { udls: [], lineLoads: [] });
    expect(store().reinforcements.map((r) => r.id)).toEqual(["r1"]);
  });

  it("accepts only valid numbers in capacity and spacing cells", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([newReinforcement("r1", "anchor", COORDS, "ltr")]);
    await setCell("Tensile capacity", "250");
    expect(store().reinforcements[0].tensileCapacity).toBe(250);
    // Negative capacity is rejected; the stored value stays.
    await setCell("Tensile capacity", "-5");
    expect(store().reinforcements[0].tensileCapacity).toBe(250);
    // Zero spacing is rejected (min > 0).
    await setCell("Spacing", "0");
    expect(store().reinforcements[0].spacing).toBe(2);
    await setCell("Reinforcement y2", "-3.5");
    expect(store().reinforcements[0].y2).toBe(-3.5);
  });

  it("changing the type applies the new defaults but keeps the geometry", async () => {
    render(<ReinforcementDialogApp />);
    const r = newReinforcement("r1", "anchor", COORDS, "ltr");
    hydrate([r]);
    await userEvent.selectOptions(
      screen.getByLabelText("Reinforcement type"),
      "geosynthetic",
    );
    const next = store().reinforcements[0];
    expect(next).toMatchObject({
      type: "geosynthetic",
      pullout: "interface",
      direction: "tangent",
      x1: r.x1,
      y1: r.y1,
      x2: r.x2,
      y2: r.y2,
    });
  });

  it("shows the details of the selected element and edits pullout settings", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([
      { ...newReinforcement("r1", "anchor", COORDS, "ltr"), x1: 10, y1: 9, x2: 4, y2: 1 },
    ]);
    expect(screen.queryByLabelText("Pullout")).toBeNull();
    await userEvent.click(screen.getAllByRole("row")[1]);
    expect(
      screen.getByText("Element 1: Anchor (end-anchored)"),
    ).toBeInTheDocument();
    // 6-8-10 triangle: length 10 m, atan(8/6) = 53.1°.
    expect(
      screen.getByText("Length 10.00 m, inclination 53.1° below horizontal."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Bond strength")).toBeNull();
    expect(screen.queryByLabelText("End 1 capacity")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Pullout"), "bond");
    expect(store().reinforcements[0].pullout).toBe("bond");
    await setCell("Bond strength", "40");
    await setCell("Bonded length", "6");
    await setCell("End 2 capacity", "120");
    expect(store().reinforcements[0]).toMatchObject({
      bondStrength: 40,
      bondedLength: 6,
      end2Capacity: 120,
    });

    await userEvent.selectOptions(screen.getByLabelText("Pullout"), "interface");
    await setCell("Adhesion", "5");
    pasteCell("Interface friction angle", "95");
    expect(store().reinforcements[0].interfaceFriction).toBe(0);
    await setCell("Interface friction angle", "25");
    expect(store().reinforcements[0]).toMatchObject({
      adhesion: 5,
      interfaceFriction: 25,
    });

    await userEvent.selectOptions(screen.getByLabelText("Force direction"), "bisector");
    await userEvent.selectOptions(screen.getByLabelText("Force application"), "passive");
    expect(store().reinforcements[0]).toMatchObject({
      direction: "bisector",
      application: "passive",
    });
  });

  it("removing the selected element clears the details panel", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([newReinforcement("r1", "anchor", COORDS, "ltr")]);
    await userEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByLabelText("Pullout")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove reinforcement 1" }),
    );
    expect(store().reinforcements).toEqual([]);
    expect(screen.queryByLabelText("Pullout")).toBeNull();
  });
});

describe("ReinforcementDialogApp — piles", () => {
  it("adds a pile row and a sheet pile wall", async () => {
    render(<ReinforcementDialogApp />);
    hydrate();
    const addButtons = screen.getAllByRole("button", { name: "+ Add" });
    await userEvent.click(addButtons[1]);
    await userEvent.selectOptions(screen.getByLabelText("Type of the new pile"), "sheet-pile");
    await userEvent.click(addButtons[1]);
    expect(store().piles.map((p) => [p.type, p.mode])).toEqual([
      ["pile", "ito-matsui"],
      ["sheet-pile", "force"],
    ]);
    // Ito & Matsui piles take the force from the soil; given-force rows show an input.
    expect(screen.getAllByText("from soil")).toHaveLength(1);
    expect(screen.getAllByLabelText("Shear force per pile")).toHaveLength(1);
  });

  it("warns when Ito & Matsui cannot be applied", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([], [newPile("p1", "pile", COORDS)]);
    expect(screen.queryByText(/P1:/)).toBeNull();
    await setCell("Pile x2", "12");
    expect(screen.getByText(/P1: Ito & Matsui needs a vertical pile/)).toBeInTheDocument();
    await setCell("Pile x2", "10");
    await setCell("Pile spacing", "0.5");
    expect(
      screen.getByText(/P1: Ito & Matsui needs a spacing larger than the diameter/),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Pile force"), "force");
    expect(screen.queryByText(/P1:/)).toBeNull();
    await setCell("Shear force per pile", "80");
    expect(store().piles[0]).toMatchObject({ mode: "force", force: 80 });
  });

  it("switching to a sheet pile wall uses a given force per metre", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([], [newPile("p1", "pile", COORDS)]);
    await userEvent.selectOptions(screen.getByLabelText("Pile type"), "sheet-pile");
    expect(store().piles[0]).toMatchObject({
      type: "sheet-pile",
      mode: "force",
      spacing: 1,
      // A wall is active, with the force at angle θ.
      application: "active",
    });
    expect(store().piles[0].direction).toBeUndefined();
    await userEvent.selectOptions(screen.getByLabelText("Pile type"), "pile");
    expect(store().piles[0]).toMatchObject({
      type: "pile",
      application: "passive",
      direction: "tangent",
    });
  });

  it("edits the force direction, angle and capacities", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([], [newPile("p1", "pile", COORDS)]);
    expect(screen.queryByLabelText("Tilt of the pile force above horizontal")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Pile force direction"), "angle");
    pasteCell("Tilt of the pile force above horizontal", "95");
    expect(store().piles[0].angle).toBe(0);
    await setCell("Tilt of the pile force above horizontal", "-20");
    expect(store().piles[0].angle).toBe(-20);
    await setCell("Pile diameter", "0.8");
    await setCell("Shear capacity per pile (0 = no limit)", "300");
    await setCell("Bending capacity per pile (0 = no limit)", "150");
    await userEvent.selectOptions(screen.getByLabelText("Pile force application"), "active");
    expect(store().piles[0]).toMatchObject({
      direction: "angle",
      diameter: 0.8,
      shearCapacity: 300,
      momentCapacity: 150,
      application: "active",
    });
    const table = screen.getAllByRole("table")[1];
    await userEvent.click(within(table).getByRole("button", { name: "Remove pile 1" }));
    expect(store().piles).toEqual([]);
  });
});
