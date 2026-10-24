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

const region = (name: string) => within(screen.getByRole("region", { name }));
const elements = () => region("Reinforcement elements");
const pilesRegion = () => region("Piles and sheet piles");

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
    await userEvent.click(elements().getByRole("button", { name: "Add" }));
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
    // A decimal comma is accepted.
    await setCell("Spacing", "2,5");
    expect(store().reinforcements[0].spacing).toBe(2.5);
  });

  it("marks a value that is not accepted and keeps the stored one", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([newReinforcement("r1", "anchor", COORDS, "ltr")]);
    const input = await setCell("Tensile capacity", "-5");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(store().reinforcements[0].tensileCapacity).toBe(200);
    await userEvent.tab();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input.value).toBe("200");
  });

  it("shows computed end points with 2 decimals without changing them", async () => {
    render(<ReinforcementDialogApp />);
    const r = newReinforcement("r1", "anchor", COORDS, "ltr");
    hydrate([r]);
    // 10 m at 15°: x2 = 10 - 10·cos 15° = 0.3407…, y2 = 9 - 10·sin 15° = 6.4118…
    const x2 = screen.getByLabelText("Reinforcement x2") as HTMLInputElement;
    expect(x2.value).toBe("0.34");
    expect((screen.getByLabelText("Reinforcement y2") as HTMLInputElement).value).toBe("6.41");
    expect(elements().getByText("0.34, 6.41")).toBeInTheDocument();
    // Focusing and leaving the field keeps the full stored value.
    await userEvent.click(x2);
    await userEvent.tab();
    expect(store().reinforcements[0].x2).toBe(r.x2);
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
      newReinforcement("r0", "nail", COORDS, "ltr"),
      { ...newReinforcement("r1", "anchor", COORDS, "ltr"), x1: 10, y1: 9, x2: 4, y2: 1 },
    ]);
    // The first element is selected at first.
    expect(screen.getByText("Element 1: Soil nail")).toBeInTheDocument();
    await userEvent.click(elements().getAllByRole("row")[2]);
    expect(
      screen.getByText("Element 2: Anchor (end-anchored)"),
    ).toBeInTheDocument();
    // 6-8-10 triangle: length 10 m, atan(8/6) = 53.1°.
    expect(
      screen.getByText("Length 10.00 m, inclination 53.1° below horizontal."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Bond strength")).toBeNull();
    expect(screen.queryByLabelText("End 1 capacity")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Pullout"), "bond");
    expect(store().reinforcements[1].pullout).toBe("bond");
    await setCell("Bond strength", "40");
    await setCell("Bonded length", "6");
    await setCell("End 2 capacity", "120");
    expect(store().reinforcements[1]).toMatchObject({
      bondStrength: 40,
      bondedLength: 6,
      end2Capacity: 120,
    });

    await userEvent.selectOptions(screen.getByLabelText("Pullout"), "interface");
    await setCell("Adhesion", "5");
    pasteCell("Interface friction angle", "95");
    expect(store().reinforcements[1].interfaceFriction).toBe(0);
    await setCell("Interface friction angle", "25");
    expect(store().reinforcements[1]).toMatchObject({
      adhesion: 5,
      interfaceFriction: 25,
    });

    await userEvent.selectOptions(screen.getByLabelText("Force direction"), "bisector");
    await userEvent.selectOptions(screen.getByLabelText("Force application"), "passive");
    expect(store().reinforcements[1]).toMatchObject({
      direction: "bisector",
      application: "passive",
    });
  });

  it("deletes the selected element and selects the next one", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([
      newReinforcement("r1", "anchor", COORDS, "ltr"),
      newReinforcement("r2", "nail", COORDS, "ltr"),
    ]);
    await userEvent.click(elements().getAllByRole("row")[1]);
    expect(screen.getByLabelText("Pullout")).toBeInTheDocument();
    await userEvent.click(elements().getByRole("button", { name: "Delete" }));
    expect(store().reinforcements.map((r) => r.id)).toEqual(["r2"]);
    expect(screen.getByText("Element 1: Soil nail")).toBeInTheDocument();
    await userEvent.click(elements().getByRole("button", { name: "Delete" }));
    expect(store().reinforcements).toEqual([]);
    expect(screen.queryByLabelText("Pullout")).toBeNull();
    expect(elements().getByText(/No reinforcement/)).toBeInTheDocument();
  });
});

describe("ReinforcementDialogApp — piles", () => {
  it("adds a pile row and a sheet pile wall", async () => {
    render(<ReinforcementDialogApp />);
    hydrate();
    const add = pilesRegion().getByRole("button", { name: "Add" });
    await userEvent.click(add);
    await userEvent.selectOptions(screen.getByLabelText("Type of the new pile"), "sheet-pile");
    await userEvent.click(add);
    expect(store().piles.map((p) => [p.type, p.mode])).toEqual([
      ["pile", "ito-matsui"],
      ["sheet-pile", "force"],
    ]);
    // The list summarises the force; the new wall is selected and shows an input.
    expect(pilesRegion().getByText("Ito & Matsui")).toBeInTheDocument();
    expect(pilesRegion().getByText("100 kN")).toBeInTheDocument();
    expect(screen.getByText("P2: Sheet pile wall")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Shear force per pile")).toHaveLength(1);
    // Ito & Matsui piles take the force from the soil.
    await userEvent.click(pilesRegion().getAllByRole("row")[1]);
    expect(screen.getByText("From the soil (Ito & Matsui)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Shear force per pile")).toBeNull();
  });

  it("warns when Ito & Matsui cannot be applied", async () => {
    render(<ReinforcementDialogApp />);
    hydrate([], [newPile("p1", "pile", COORDS)]);
    expect(screen.queryByRole("alert")).toBeNull();
    await setCell("Pile x2", "12");
    expect(screen.getByText(/P1: Ito & Matsui needs a vertical pile/)).toBeInTheDocument();
    await setCell("Pile x2", "10");
    await setCell("Pile spacing", "0.5");
    expect(
      screen.getByText(/P1: Ito & Matsui needs a spacing larger than the diameter/),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Pile force"), "force");
    expect(screen.queryByRole("alert")).toBeNull();
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
    await userEvent.click(pilesRegion().getByRole("button", { name: "Delete" }));
    expect(store().piles).toEqual([]);
  });
});
