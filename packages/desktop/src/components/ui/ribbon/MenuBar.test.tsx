import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../utils/is-electron", () => ({ isElectron: true }));

import { MenuBar } from "./MenuBar";
import { markProjectClean, useAppStore } from "../../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../../test/fake-bridge";
import { readProjectBytes } from "../../../features/project/cslp";
import { HAS_LOCAL_LOVO_MODELS } from "../../../store/local-models";
import { adoptProjectAssets } from "../../../features/drawings/asset-registry";
import { PICK_LINES_HIDDEN, PICK_LINES_NO_DRAWING } from "../../../features/drawings/pick-lines-target";
import { DWG_MIME } from "../../../features/drawings/sources";
import { useLinePick } from "../../../features/drawings/line-pick-store";

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
    expect(screen.getByRole("menuitem", { name: "Results plot" })).toBeInTheDocument();
    await userEvent.click(tab("Help"));
    expect(screen.getByTitle("About")).toBeInTheDocument();
  });

  it("follows the mode: Results in result mode, Model again back in edit mode", async () => {
    act(() => store().setMode("edit"));
    render(<MenuBar />);
    await userEvent.click(tab("Model"));
    act(() => store().setMode("result"));
    expect(tab("Results")).toHaveAttribute("aria-expanded", "true");
    act(() => store().setMode("edit"));
    expect(tab("Model")).toHaveAttribute("aria-expanded", "true");
    // A tab other than Results stays when going back to edit mode.
    act(() => store().setMode("result"));
    await userEvent.click(tab("Help"));
    act(() => store().setMode("edit"));
    expect(tab("Help")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Model ribbon", () => {
  /** One object of each kind, so every window has something to select. */
  const withEveryObject = () =>
    act(() => {
      const s = store();
      s.addMaterialBoundary([
        [0, -5],
        [50, -5],
      ]);
      s.addPiezoLine([
        [0, -2],
        [50, -2],
      ]);
      s.addUdl();
      s.addLineLoad();
      s.addReinforcement();
      s.addCustomSearchPlane("circle");
      s.setAnalysisLimits({ enabled: true });
      s.clearCanvasSelection();
    });

  it.each([
    ["Exterior", "openGeometryDialog", "exterior"],
    ["Interior", "openInteriorBoundariesDialog", "boundary"],
    ["Assign", "openMaterialAssignmentDialog", null],
    ["Distributed loads", "openUdlDialog", "udl"],
    ["Line loads", "openLineLoadsDialog", "lineLoad"],
    ["Reinforcement", "openReinforcementDialog", "reinforcement"],
    ["Piezometric lines", "openPiezoDialog", "waterLine"],
    ["Search limits", "openSearchLimitsDialog", "searchLimits"],
    ["Custom surfaces", "openCustomSearchPlanesDialog", "customPlane"],
    ["Options", "openOptionsDialog", null],
  ])("%s opens its window and selects its kind of object on the canvas", async (label, call, type) => {
    withEveryObject();
    const section = store().activeSection;
    render(<MenuBar />);
    await userEvent.click(tab("Model"));
    await userEvent.click(screen.getByTitle(label));
    expect(bridge.callNames()).toContain(call);
    expect(store().canvasSelection?.object.type ?? null).toBe(type);
    // Opening a window is no editing mode.
    expect(store().activeSection).toBe(section);
  });

  it("keeps a selection of the window's kind, and selects nothing when there is none", async () => {
    withEveryObject();
    act(() => store().selectCanvasObject({ type: "exterior" }, 2));
    render(<MenuBar />);
    await userEvent.click(tab("Model"));
    await userEvent.click(screen.getByTitle("Exterior"));
    expect(store().canvasSelection).toEqual({ object: { type: "exterior" }, point: 2 });
    act(() => {
      for (const u of store().udls) store().removeUdl(u.id);
    });
    await userEvent.click(screen.getByTitle("Distributed loads"));
    expect(store().canvasSelection).toEqual({ object: { type: "exterior" }, point: 2 });
  });

  it("opens the materials and parameters windows", async () => {
    render(<MenuBar />);
    await userEvent.click(tab("Model"));
    await userEvent.click(screen.getByTitle("Materials"));
    await userEvent.click(screen.getByTitle("Parameters"));
    expect(bridge.callNames()).toEqual(
      expect.arrayContaining(["openMaterialsDialog", "openParametersDialog"]),
    );
    expect(store().canvasSelection).toBeNull();
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

  it("places a drawing from the Drawing split button; its menu makes new models and picks lines", async () => {
    adoptProjectAssets([]);
    render(<MenuBar />);
    await userEvent.click(tab("Model"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Drawing" }));
    expect(bridge.callNames()).toContain("openPlaceDrawingDialog");

    const more = screen.getByRole("button", { name: "More drawing commands" });
    await userEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Place drawing…" })).toBeInTheDocument();
    // Without a DWG, DXF or PDF drawing in the model, Pick lines… says why it is off.
    const pick = screen.getByRole("menuitem", { name: "Pick lines…" });
    expect(pick).toHaveAttribute("aria-disabled", "true");
    expect(pick).toHaveAttribute("title", PICK_LINES_NO_DRAWING);
    await userEvent.click(pick);
    expect(useLinePick.getState().placementId).toBeNull();
    // Escape closes the menu; a command closes it too.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: "Place drawing…" })).toBeNull();
    await userEvent.click(more);
    await userEvent.click(screen.getByRole("menuitem", { name: "New models from drawing…" }));
    expect(screen.queryByRole("menuitem", { name: "Place drawing…" })).toBeNull();
    expect(bridge.callNames().filter((c) => c === "openPlaceDrawingDialog")).toHaveLength(2);

    // A DWG drawing in the model: picking starts on it (in edit mode), unless it is hidden.
    act(() => {
      adoptProjectAssets([{ id: "dwg", mime: DWG_MIME, originalName: "sections.dwg", addedAt: "", data: () => new Uint8Array() }]);
      store().addBackground({
        id: "d1",
        assetId: "dwg",
        name: "sections.dwg",
        calibration: { mode: "drawing", points: [] },
        transform: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 },
        opacity: 0.8,
        visible: false,
        order: 0,
      });
    });
    await userEvent.click(more);
    expect(screen.getByRole("menuitem", { name: "Pick lines…" })).toHaveAttribute("title", PICK_LINES_HIDDEN);
    await userEvent.keyboard("{Escape}");
    act(() => store().updateBackground("d1", { visible: true }));
    act(() => store().setMode("result"));
    await userEvent.click(tab("Model"));
    await userEvent.click(screen.getByRole("button", { name: "More drawing commands" }));
    const enabled = screen.getByRole("menuitem", { name: "Pick lines…" });
    expect(enabled).not.toHaveAttribute("aria-disabled");
    await userEvent.click(enabled);
    expect(useLinePick.getState().placementId).toBe("d1");
    expect(store().mode).toBe("edit");
    act(() => useLinePick.getState().stop());
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
    const [data, name] = vi.mocked(window.cslope.saveFile).mock.calls[0];
    expect((await readProjectBytes(data)).models.length).toBeGreaterThan(0);
    expect(name).toMatch(/\.cslp$/);
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

  it("opens the documentation and lists the keyboard shortcuts", async () => {
    render(<MenuBar />);
    await userEvent.click(tab("Help"));
    await userEvent.click(screen.getByTitle("Documentation"));
    expect(bridge.callNames()).toContain("openDocumentation");
    await userEvent.click(screen.getByTitle("Keyboard shortcuts"));
    const list = screen.getByRole("table", { name: "Keyboard shortcuts" });
    expect(list).toHaveTextContent("Ctrl+Shift+S");
    expect(list).toHaveTextContent("Run the analysis");
    // As the edit canvas works now (Keyboard and mouse in the documentation).
    expect(list).toHaveTextContent("move the selected point one snap step");
    expect(list).toHaveTextContent("Shift+arrow keys");
    expect(list).toHaveTextContent("stop picking lines");
    await userEvent.click(screen.getByTitle("Close"));
    expect(screen.queryByRole("table", { name: "Keyboard shortcuts" })).toBeNull();
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

  it.runIf(import.meta.env.DEV)("resets the store after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MenuBar />);
    await userEvent.click(tab("Dev"));
    // The local project models are not in the repository: no button for them.
    if (!HAS_LOCAL_LOVO_MODELS) expect(screen.queryByTitle("Lovö")).toBeNull();
    await userEvent.click(screen.getByTitle("Reset"));
    await waitFor(() => expect(store().models).toHaveLength(1));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it.runIf(import.meta.env.DEV && HAS_LOCAL_LOVO_MODELS)("resets the store and loads the local Lovö models after confirmation", async () => {
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

describe("Compact ribbon", () => {
  it("shows the primary commands large and the others small", async () => {
    render(<MenuBar />);
    expect(screen.getByTitle("New (Ctrl+N)")).toHaveAttribute("data-size", "large");
    expect(screen.getByTitle("Save (Ctrl+S)")).toHaveAttribute("data-size", "large");
    expect(screen.getByTitle("Import")).toHaveAttribute("data-size", "small");
    expect(screen.getByTitle("Save as (Ctrl+Shift+S)")).toHaveAttribute("data-size", "small");
    expect(screen.getByTitle("Exit")).toHaveAttribute("data-size", "small");
    await userEvent.click(tab("Model"));
    expect(screen.getByTitle("Materials")).toHaveAttribute("data-size", "large");
    expect(screen.getByTitle("Assign")).toHaveAttribute("data-size", "small");
    await userEvent.click(tab("Results"));
    expect(screen.getByRole("menuitem", { name: "Results plot" })).toHaveAttribute("data-size", "large");
    expect(screen.getByRole("menuitem", { name: "Export PDF" })).toHaveAttribute("data-size", "large");
    expect(screen.getByTitle("Sheet settings")).toHaveAttribute("data-size", "small");
  });

  it("marks a pressed toggle with aria-pressed", async () => {
    render(<MenuBar />);
    await userEvent.click(tab("Results"));
    const slices = screen.getByTitle("Show slices");
    const before = store().resultViewSettings.showSlices;
    expect(slices).toHaveAttribute("aria-pressed", String(before));
    await userEvent.click(slices);
    expect(slices).toHaveAttribute("aria-pressed", String(!before));
    // A plain command is not a toggle.
    expect(screen.getByTitle("Add text")).not.toHaveAttribute("aria-pressed");
  });
});
