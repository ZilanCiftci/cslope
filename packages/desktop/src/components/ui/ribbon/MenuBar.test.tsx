import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../utils/is-electron", () => ({ isElectron: true }));

import { MenuBar } from "./MenuBar";
import { markProjectClean, useAppStore } from "../../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../../test/fake-bridge";

let bridge: FakeBridge;
const store = () => useAppStore.getState();

beforeEach(() => {
  store().newProject();
  useAppStore.temporal.getState().clear();
  markProjectClean(store());
  bridge = installFakeBridge({
    saveFile: vi.fn(() => Promise.resolve(true)),
    saveFileAs: vi.fn(() => Promise.resolve(true)),
  });
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
  vi.restoreAllMocks();
});

const tab = (name: string) => screen.getByRole("button", { name });

describe("MenuBar", () => {
  it("opens the File ribbon first and switches between menus", async () => {
    render(<MenuBar activeModelName="Slope A" />);
    expect(tab("File")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTitle("New (Ctrl+N)")).toBeInTheDocument();
    await userEvent.click(tab("Model"));
    expect(tab("Model")).toHaveAttribute("aria-expanded", "true");
    expect(tab("File")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTitle("New (Ctrl+N)")).toBeNull();
    expect(screen.getByTitle("Exterior")).toBeInTheDocument();
    await userEvent.click(tab("Results"));
    expect(screen.getByTitle("Results Plot")).toBeInTheDocument();
    await userEvent.click(tab("Help"));
    expect(screen.getByTitle("About")).toBeInTheDocument();
  });
});

describe("Model ribbon", () => {
  it.each([
    ["Exterior", "openGeometryDialog", "Exterior Boundary"],
    ["Interior", "openInteriorBoundariesDialog", "Interior Boundaries"],
    ["Assign", "openMaterialAssignmentDialog", "Material Assignment"],
    ["UDL", "openUdlDialog", "Loads"],
    ["Line loads", "openLineLoadsDialog", "Loads"],
    ["Reinforcement", "openReinforcementDialog", "Loads"],
    ["Piezometric Lines", "openPiezoDialog", "Piezometric Lines"],
    ["Search limits", "openSearchLimitsDialog", "Search Limits"],
    ["Custom planes", "openCustomSearchPlanesDialog", "Custom Search Planes"],
    ["Options", "openOptionsDialog", "Options"],
  ])("%s opens its window and the matching side panel section", async (label, call, section) => {
    render(<MenuBar />);
    await userEvent.click(tab("Model"));
    await userEvent.click(screen.getByTitle(label));
    expect(bridge.callNames()).toContain(call);
    expect(store().activeSection).toBe(section);
  });

  it("opens the materials and parameters windows", async () => {
    render(<MenuBar />);
    await userEvent.click(tab("Model"));
    const defines = screen.getAllByTitle("Define");
    await userEvent.click(defines[0]);
    await userEvent.click(defines[1]);
    expect(bridge.callNames()).toEqual(
      expect.arrayContaining(["openMaterialsDialog", "openParametersDialog"]),
    );
    expect(store().activeSection).toBe("Parameters");
  });

  it("undoes and redoes model edits with Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y", () => {
    render(<MenuBar />);
    const before = store().coordinates;
    const [x, y] = before[1];
    act(() => store().setCoordinate(1, [x, y + 3]));
    const edited = store().coordinates;
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(store().coordinates).toEqual(before);
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(store().coordinates).toEqual(edited);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(store().coordinates).toEqual(before);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(store().coordinates).toEqual(edited);
    // Without history the shortcuts do nothing.
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(store().coordinates).toEqual(edited);
  });

  it("leaves Ctrl+Z to text fields", () => {
    render(
      <>
        <MenuBar />
        <input aria-label="field" />
      </>,
    );
    const before = store().coordinates;
    const [x, y] = before[1];
    act(() => store().setCoordinate(1, [x, y + 3]));
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "z", ctrlKey: true });
    expect(store().coordinates[1]).toEqual([x, y + 3]);
    // Plain z without Ctrl is ignored too.
    fireEvent.keyDown(window, { key: "z" });
    expect(store().coordinates[1]).toEqual([x, y + 3]);
  });
});

describe("File ribbon", () => {
  it("saves with Ctrl+S and Save As with Ctrl+Shift+S", async () => {
    render(<MenuBar />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(window.cslope.saveFile).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(window.cslope.saveFileAs).toHaveBeenCalledTimes(1));
    const json = JSON.parse(vi.mocked(window.cslope.saveFile).mock.calls[0][0]);
    expect(json).toHaveProperty("models");
  });

  it("starts a new project with Ctrl+N and the New button", async () => {
    render(<MenuBar />);
    act(() => store().addMaterial());
    markProjectClean(store());
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    await waitFor(() => expect(store().materials).toHaveLength(1));
    expect(bridge.callNames()).toContain("menuNew");
    await userEvent.click(screen.getByTitle("New (Ctrl+N)"));
    expect(bridge.callNames().filter((n) => n === "menuNew")).toHaveLength(2);
  });

  it("opens a project file through the desktop dialog", async () => {
    render(<MenuBar />);
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => expect(bridge.callNames()).toContain("openFile"));
  });

  it("closes the window from Exit", async () => {
    render(<MenuBar />);
    await userEvent.click(screen.getByTitle("Exit"));
    expect(bridge.callNames()).toContain("close");
  });
});

describe("Help ribbon", () => {
  it("shows About through the desktop app", async () => {
    render(<MenuBar />);
    await userEvent.click(tab("Help"));
    await userEvent.click(screen.getByTitle("About"));
    expect(bridge.callNames()).toContain("menuAbout");
  });

  it("loads the benchmarks only after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MenuBar />);
    await userEvent.click(tab("Help"));
    const modelsBefore = store().models.length;
    await userEvent.click(screen.getAllByTitle("Benchmarks")[0]);
    expect(confirm).toHaveBeenCalled();
    expect(store().models).toHaveLength(modelsBefore);

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getAllByTitle("Benchmarks")[0]);
    await waitFor(() => expect(store().models.length).toBeGreaterThan(modelsBefore));
    expect(bridge.callNames()).toContain("menuNew");
  });
});

describe("Dev ribbon (development builds)", () => {
  it.runIf(import.meta.env.DEV)("toggles DevTools and logs the store", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<MenuBar />);
    await userEvent.click(tab("Dev"));
    await userEvent.click(screen.getByTitle("DevTools (F12)"));
    expect(bridge.callNames()).toContain("toggleDevTools");
    await userEvent.click(screen.getByTitle("Log"));
    expect(log).toHaveBeenCalledWith("App store state:", expect.any(Object));
  });

  it.runIf(import.meta.env.DEV)("resets the store and loads the Lovö models after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MenuBar />);
    await userEvent.click(tab("Dev"));
    await userEvent.click(screen.getByTitle("Lovö"));
    await waitFor(() =>
      expect(store().models.some((m) => /Lov/.test(m.name))).toBe(true),
    );
    await userEvent.click(screen.getByTitle("Reset"));
    await waitFor(() => expect(store().models).toHaveLength(1));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(bridge.callNames().filter((n) => n === "menuNew")).toHaveLength(2);
  });
});
