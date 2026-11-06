/**
 * The drawing rows of the models tree: the drawing order (drag by the grip,
 * Alt+Up and Alt+Down) and removal ("×" on the row, Delete), and a DWG
 * drawing's layers (an eye per layer, Show all and Hide all).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useAppStore } from "../../store/app-store";
import type { BackgroundImage } from "../../store/types";
import { ModelDrawings } from "./DrawingsPanel";
import { adoptProjectAssets } from "./asset-registry";
import { performUndo } from "../../store/selectors";

// A line drawing with three layers (the cache would read it from the file).
vi.mock("./drawing-cache", () => ({
  onDrawingsChanged: () => () => {},
  peekSource: () => ({ kind: "vector" }),
  vectorsFor: () => ({ layers: ["0", "outline", "piezo"] }),
}));

const s = () => useAppStore.getState();

const placement = (id: string): BackgroundImage => ({
  id,
  assetId: "plan",
  name: `Section ${id}`,
  page: 1,
  crop: { x0: 0, y0: 0, x1: 100, y1: 50 },
  calibration: { mode: "points", points: [] },
  transform: { a: 0.1, b: 0, c: 0, d: -0.1, e: 0, f: 5 },
  opacity: 0.5,
  visible: true,
  order: 0,
});

/** The drawing ids, topmost first (as the tree lists them). */
const topmostFirst = () => [...s().backgrounds].sort((a, b) => b.order - a.order).map((b) => b.id);
const row = (name: string) => screen.getByRole("treeitem", { name });

beforeEach(() => {
  s().newProject();
  useAppStore.temporal.getState().clear();
  adoptProjectAssets([{ id: "plan", mime: "image/vnd.dxf", originalName: "plan.dxf", addedAt: "", data: () => new Uint8Array([1]) }]);
  act(() => {
    for (const id of ["A", "B", "C"]) s().addBackground(placement(id));
  });
});

describe("the drawing order in the models tree", () => {
  it("moves a drawing with Alt+Up and Alt+Down, each an undo step, and keeps it focused", () => {
    render(<ModelDrawings modelId={s().activeModelId} />);
    expect(topmostFirst()).toEqual(["C", "B", "A"]);
    const steps = useAppStore.temporal.getState().pastStates.length;
    fireEvent.keyDown(row("Section A"), { key: "ArrowUp", altKey: true });
    expect(topmostFirst()).toEqual(["C", "A", "B"]);
    expect(useAppStore.temporal.getState().pastStates.length).toBe(steps + 1);
    expect(row("Section A")).toHaveFocus();
    fireEvent.keyDown(row("Section A"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(row("Section A"), { key: "ArrowUp", altKey: true });
    expect(topmostFirst()).toEqual(["A", "C", "B"]);
    fireEvent.keyDown(row("Section C"), { key: "ArrowDown", altKey: true });
    expect(topmostFirst()).toEqual(["A", "B", "C"]);
    // Without Alt the arrows change nothing.
    fireEvent.keyDown(row("Section A"), { key: "ArrowDown" });
    expect(topmostFirst()).toEqual(["A", "B", "C"]);
  });

  it("moves a drawing dropped on another row of its model, in one step, with a line at the target", () => {
    render(<ModelDrawings modelId={s().activeModelId} />);
    const steps = useAppStore.temporal.getState().pastStates.length;
    fireEvent.dragStart(row("Section A"), { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    // The upper half of the top row: before it.
    vi.spyOn(row("Section C"), "getBoundingClientRect").mockReturnValue({ top: 0, height: 24, bottom: 24, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.dragOver(row("Section C"), { clientY: 4, dataTransfer: { dropEffect: "" } });
    expect(screen.getByTestId("drawing-drop-indicator")).toBeInTheDocument();
    fireEvent.drop(row("Section C"), { clientY: 4 });
    expect(topmostFirst()).toEqual(["A", "C", "B"]);
    expect(useAppStore.temporal.getState().pastStates.length).toBe(steps + 1);
    expect(screen.queryByTestId("drawing-drop-indicator")).toBeNull();
    act(() => performUndo());
    expect(topmostFirst()).toEqual(["C", "B", "A"]);
  });

  it("removes a drawing with the × on its row or with Delete, as an undo step", () => {
    render(<ModelDrawings modelId={s().activeModelId} />);
    fireEvent.click(within(row("Section B")).getByRole("button", { name: "Remove Section B from the model" }));
    expect(topmostFirst()).toEqual(["C", "A"]);
    fireEvent.keyDown(row("Section C"), { key: "Delete" });
    expect(topmostFirst()).toEqual(["A"]);
    expect(row("Section A")).toHaveFocus();
    act(() => performUndo());
    expect(topmostFirst()).toEqual(["C", "A"]);
  });
});

describe("a DWG or DXF drawing's layers", () => {
  it("shows and hides each layer with its eye, or all of them with the links", () => {
    act(() => s().selectCanvasObject({ type: "background", id: "A" }));
    render(<ModelDrawings modelId={s().activeModelId} />);
    fireEvent.click(screen.getByRole("button", { name: "Layers of Section A" }));
    const list = screen.getByRole("list", { name: "Layers of Section A" });
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["0", "outline", "piezo"]);
    // No checkboxes: an eye per layer, as the drawings' rows.
    expect(within(list).queryByRole("checkbox")).toBeNull();
    const hidden = () => s().backgrounds.find((b) => b.id === "A")?.hiddenLayers;

    fireEvent.click(screen.getByRole("button", { name: "Hide layer outline" }));
    expect(hidden()).toEqual(["outline"]);
    expect(screen.getByRole("button", { name: "Show layer outline" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Layers of Section A" })).toHaveTextContent("(2 of 3 shown)");

    fireEvent.click(screen.getByRole("button", { name: "Hide all" }));
    expect(hidden()).toEqual(["0", "outline", "piezo"]);
    expect(screen.getByRole("button", { name: "Hide all" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Show layer piezo" }));
    expect(hidden()).toEqual(["0", "outline"]);

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(hidden()).toBeUndefined();
    expect(screen.getByRole("button", { name: "Show all" })).toBeDisabled();
  });
});
