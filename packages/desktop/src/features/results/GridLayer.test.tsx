/**
 * The sheet's grid as a built-in layer of Properties › Layers: listed,
 * turned off and on by its eye, never deleted, with its properties (color,
 * widths, spacing, minor lines) in the sidebar, each change one undo step.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";
import { ResultSidebar } from "./ResultSidebar";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";
import { normalizeResultView } from "../../store/persistence";

const surface = (fos: number) => ({ cx: 10, cy: 12, radius: 10, fos, entryPoint: [2, 8], exitPoint: [18, 2] });
const RESULT = {
  minFOS: 1.234,
  maxFOS: 2,
  criticalSurface: surface(1.234),
  allSurfaces: [surface(1.234)],
  criticalSlices: [],
  method: "Spencer",
  elapsedMs: 1,
} as unknown as AnalysisResult;

const rvs = () => useAppStore.getState().resultViewSettings;
const temporal = () => useAppStore.temporal.getState();
const row = (key: string) => screen.getAllByTestId("layer-row").find((r) => r.getAttribute("data-layer") === key)!;

beforeEach(() => {
  useAppStore.getState().newProject();
  useAppStore.setState({
    result: RESULT,
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [] },
    selectedAnnotationIds: [],
    selectedResultObject: null,
    selectedResultLayer: null,
  });
  temporal().clear();
});

afterEach(cleanup);

describe("the grid layer", () => {
  it("is a built-in layer: listed over the soil colors, turned off and on by its eye (greyed when off), never deleted", () => {
    render(<ResultSidebar />);
    const list = within(screen.getByRole("list", { name: "Layers, topmost first" }));
    expect(list.getByRole("listitem", { name: "Grid" })).toBeInTheDocument();
    const keys = screen.getAllByTestId("layer-row").map((r) => r.getAttribute("data-layer"));
    expect(keys.slice(-2)).toEqual(["grid", "soilColor"]);
    fireEvent.click(screen.getByRole("button", { name: "Turn off: Grid" }));
    expect(rvs().showGrid).toBe(false);
    expect(list.getByRole("listitem", { name: "Grid (off)" })).toBeInTheDocument();
    expect(temporal().pastStates).toHaveLength(1);
    // No remove button, and Delete removes nothing.
    expect(within(row("grid")).queryByRole("button", { name: /remove/i })).toBeNull();
    fireEvent.keyDown(row("grid"), { key: "Delete" });
    expect(rvs().showGrid).toBe(false);
    expect(row("grid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn on: Grid" }));
    expect(rvs().showGrid).toBe(true);
    expect(list.getByRole("listitem", { name: "Grid" })).toBeInTheDocument();
  });

  it("opens off from a project saved with the grid off", () => {
    const view = normalizeResultView({ ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [], showGrid: false });
    act(() => useAppStore.setState({ resultViewSettings: view }));
    render(<ResultSidebar />);
    expect(screen.getByRole("listitem", { name: "Grid (off)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on: Grid" })).toBeInTheDocument();
  });

  it("shows its properties also while off: color, line width, spacing and minor lines, each one undo step", () => {
    act(() => useAppStore.getState().setResultViewSettings({ showGrid: false }));
    temporal().clear();
    render(<ResultSidebar />);
    fireEvent.click(row("grid"));
    const group = screen.getByRole("group", { name: "Grid properties" });
    expect(within(group).getByRole("button", { name: "Reset to default" })).toBeDisabled();

    fireEvent.click(within(group).getByRole("button", { name: "Color #cc0000" }));
    expect(rvs().layerStyles).toEqual({ grid: { color: "#cc0000" } });
    expect(temporal().pastStates).toHaveLength(1);

    const width = within(group).getByLabelText("Line width (px)");
    expect(width).toHaveAttribute("placeholder", "1");
    fireEvent.change(width, { target: { value: "2,5" } });
    fireEvent.blur(width);
    expect(rvs().layerStyles?.grid?.width).toBe(2.5);

    // The spacing: Auto (at the labelled ticks) or a fixed one; a decimal comma is read.
    const spacing = within(group).getByLabelText("Spacing (m)");
    expect(spacing).toHaveAttribute("placeholder", "Auto");
    fireEvent.change(spacing, { target: { value: "2,5" } });
    fireEvent.blur(spacing);
    expect(rvs().gridLineSpacing).toBe(2.5);

    // Minor lines: off by default; on with 5 subdivisions and a thinner line.
    expect(within(group).queryByLabelText("Subdivisions")).toBeNull();
    fireEvent.click(within(group).getByRole("checkbox", { name: "Minor lines" }));
    expect(rvs().layerStyles?.grid?.subdivisions).toBe(5);
    fireEvent.change(within(group).getByLabelText("Subdivisions"), { target: { value: "10" } });
    expect(rvs().layerStyles?.grid?.subdivisions).toBe(10);
    const minorWidth = within(group).getByLabelText("Minor width (px)");
    expect(minorWidth).toHaveAttribute("placeholder", "0.5");
    fireEvent.change(minorWidth, { target: { value: "0.3" } });
    fireEvent.blur(minorWidth);
    expect(rvs().layerStyles?.grid).toEqual({ color: "#cc0000", width: 2.5, subdivisions: 10, minorWidth: 0.3 });
    expect(temporal().pastStates).toHaveLength(6);
    // Turned off, the minor settings go.
    fireEvent.click(within(group).getByRole("checkbox", { name: "Minor lines" }));
    expect(rvs().layerStyles?.grid).toEqual({ color: "#cc0000", width: 2.5 });

    // Reset clears the style and the spacing in one undo step; the grid stays off.
    fireEvent.click(within(group).getByRole("button", { name: "Reset to default" }));
    expect(rvs().layerStyles).toBeUndefined();
    expect(rvs().gridLineSpacing).toBeUndefined();
    expect(rvs().showGrid).toBe(false);
    act(() => temporal().undo());
    expect(rvs().gridLineSpacing).toBe(2.5);
    expect(rvs().layerStyles?.grid).toEqual({ color: "#cc0000", width: 2.5 });
  });
});
