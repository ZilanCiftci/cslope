import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { GeometryDialogApp } from "./GeometryDialogApp";
import { MaterialAssignmentDialogApp } from "./MaterialAssignmentDialogApp";
import { MaterialsDialogApp } from "./MaterialsDialogApp";
import { GeometrySection } from "./sections/GeometrySection";
import { MaterialAssignmentSection } from "./sections/MaterialAssignmentSection";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { MaterialRow } from "../../store/types";

let bridge: FakeBridge;
const store = () => useAppStore.getState();
const SQUARE: [number, number][] = [
  [0, 0],
  [0, 10],
  [20, 10],
  [20, 0],
];

function mat(id: string, name: string, color = "#aa0000"): MaterialRow {
  return {
    id,
    name,
    color,
    modelExpressions: {},
    model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 },
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

describe("GeometryDialogApp", () => {
  function hydrate(coordinates = SQUARE) {
    bridge.emit("onGeometryState", {
      coordinates,
      coordinateExpressions: coordinates.map(() => ({})),
      parameters: [{ id: "p", name: "H", expression: "12" }],
    });
  }

  it("shows the exterior boundary from the main window", () => {
    render(<GeometryDialogApp />);
    expect(bridge.callNames()).toContain("requestGeometryState");
    hydrate();
    expect(screen.getAllByLabelText(/^Point \d X$/)).toHaveLength(4);
    expect((screen.getByLabelText("Point 3 X") as HTMLInputElement).value).toBe("20");
    expect(bridge.sentOf("sendGeometryChanged")).toEqual([]);
  });

  it("edits a vertex with an expression and sends the new geometry", async () => {
    render(<GeometryDialogApp />);
    hydrate();
    const y = screen.getByLabelText("Point 2 Y");
    await userEvent.clear(y);
    await userEvent.type(y, "H");
    await userEvent.tab();
    expect(store().coordinates[1]).toEqual([0, 12]);
    expect(store().coordinateExpressions[1]).toEqual({ y: "H" });
    const last = bridge
      .sentOf<{ coordinates: [number, number][] }>("sendGeometryChanged")
      .at(-1)!;
    expect(last.coordinates[1]).toEqual([0, 12]);
  });

  it("adds a point 5 m right of the last and removes points above three", async () => {
    render(<GeometryDialogApp />);
    hydrate([
      [0, 0],
      [0, 10],
      [20, 0],
    ]);
    // A triangle cannot lose a point.
    expect(screen.queryByRole("button", { name: "Remove point 1" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "+ Add Point" }));
    expect(store().coordinates.at(-1)).toEqual([25, 0]);
    await userEvent.click(screen.getByRole("button", { name: "Remove point 2" }));
    expect(store().coordinates).toEqual([
      [0, 0],
      [20, 0],
      [25, 0],
    ]);
  });

  it("selects a point when its row is clicked", async () => {
    render(<GeometryDialogApp />);
    hydrate();
    await userEvent.click(screen.getAllByRole("row")[3]);
    expect(store().selectedPointIndex).toBe(2);
  });
});

describe("GeometrySection in the side panel", () => {
  it("opens and closes with its header", async () => {
    render(<GeometrySection />);
    const header = screen.getByRole("button", { name: /Exterior Boundary/ });
    if (!screen.queryByRole("button", { name: "+ Add Point" })) {
      await userEvent.click(header);
    }
    expect(screen.getByRole("button", { name: "+ Add Point" })).toBeInTheDocument();
    await userEvent.click(header);
    expect(screen.queryByRole("button", { name: "+ Add Point" })).toBeNull();
    expect(store().activeSection).toBeNull();
  });
});

describe("MaterialAssignmentDialogApp", () => {
  function hydrate() {
    bridge.emit("onMaterialAssignmentState", {
      coordinates: SQUARE,
      materials: [mat("m1", "Sand"), mat("m2", "Clay", "#0000aa")],
      materialBoundaries: [
        { id: "b1", coordinates: [[0, 5], [20, 5]], coordinateExpressions: [{}, {}] },
      ],
      regionMaterials: [],
    });
  }

  it("lists the regions split by the interior boundary", () => {
    render(<MaterialAssignmentDialogApp />);
    expect(bridge.callNames()).toContain("requestMaterialAssignmentState");
    hydrate();
    expect(screen.getByText("Region 1")).toBeInTheDocument();
    expect(screen.getByText("Region 2")).toBeInTheDocument();
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // Unassigned regions use the first material.
    expect(selects.map((s) => s.value)).toEqual(["m1", "m1"]);
    expect(bridge.sentOf("sendMaterialAssignmentChanged")).toEqual([]);
  });

  it("assigns a material to a region and sends it", async () => {
    render(<MaterialAssignmentDialogApp />);
    hydrate();
    await userEvent.selectOptions(screen.getByLabelText("Material for Region 2"), "m2");
    expect(store().regionMaterials).toHaveLength(1);
    expect(store().regionMaterials[0].materialId).toBe("m2");
    expect(
      (screen.getByLabelText("Material for Region 2") as HTMLSelectElement).value,
    ).toBe("m2");
    const sent = bridge.sentOf<{ regionMaterials: unknown[] }>(
      "sendMaterialAssignmentChanged",
    );
    expect(sent.at(-1)!.regionMaterials).toHaveLength(1);
  });

  it("toggles the region selection by clicking its card", async () => {
    render(<MaterialAssignmentDialogApp />);
    hydrate();
    await userEvent.click(screen.getByText("Region 1"));
    const key = store().selectedRegionKey;
    expect(key).not.toBeNull();
    await userEvent.click(screen.getByText("Region 1"));
    expect(store().selectedRegionKey).toBeNull();
  });

  it("asks for the exterior boundary when there is none", () => {
    useAppStore.setState({ coordinates: [] });
    render(<MaterialAssignmentSection plain />);
    expect(screen.getByText("Define exterior boundary points first.")).toBeInTheDocument();
  });
});

describe("MaterialsDialogApp", () => {
  it("accepts the main window's materials and parameters without echoing them", () => {
    render(<MaterialsDialogApp />);
    expect(bridge.callNames()).toContain("requestMaterialsState");
    bridge.emit("onMaterialsState", {
      materials: [mat("m1", "Sand"), mat("m2", "Clay")],
      parameters: [{ id: "p", name: "k", expression: "2" }],
    });
    expect(store().materials.map((m) => m.name)).toEqual(["Sand", "Clay"]);
    expect(store().parameters.map((p) => p.name)).toEqual(["k"]);
    expect(screen.getByDisplayValue("Sand")).toBeInTheDocument();
    expect(bridge.sentOf("sendMaterialsChanged")).toEqual([]);
  });

  it("accepts a bare material array from older main windows", () => {
    render(<MaterialsDialogApp />);
    bridge.emit("onMaterialsChanged", [mat("m9", "Rock")]);
    expect(store().materials.map((m) => m.id)).toEqual(["m9"]);
  });

  it("sends edits back to the main window", async () => {
    render(<MaterialsDialogApp />);
    bridge.emit("onMaterialsState", { materials: [mat("m1", "Sand")] });
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    const sent = bridge.sentOf<{ materials: MaterialRow[] }>("sendMaterialsChanged");
    expect(sent.at(-1)!.materials).toHaveLength(2);
  });

  it("closes the window", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    render(<MaterialsDialogApp />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalled();
    close.mockRestore();
  });
});
