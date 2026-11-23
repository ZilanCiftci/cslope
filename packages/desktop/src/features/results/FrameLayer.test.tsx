/**
 * The sheet's frame (the plot frame, its ticks and their labels) as a
 * built-in layer of Properties › Layers: listed, turned off and on by its
 * eye, never deleted, with its properties (color, line width, tick
 * spacing, minor ticks, label size, tick labels) in the sidebar, each
 * change one undo step. The tick spacing and minor ticks left Sheet
 * settings for it, with the same stored fields.
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
const keys = () => screen.getAllByTestId("layer-row").map((r) => r.getAttribute("data-layer"));

beforeEach(() => {
  useAppStore.getState().newProject();
  useAppStore.setState({
    result: RESULT,
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [{ id: "t", type: "text", x: 0.1, y: 0.1, text: "Note" }] },
    selectedAnnotationIds: [],
    selectedResultObject: null,
    selectedResultLayer: null,
  });
  temporal().clear();
});

afterEach(cleanup);

describe("the frame layer", () => {
  it("is a built-in layer: listed over the F label and under the paper annotations, turned off and on by its eye (greyed when off), never deleted", () => {
    render(<ResultSidebar />);
    const list = within(screen.getByRole("list", { name: "Layers, topmost first" }));
    expect(list.getByRole("listitem", { name: "Frame" })).toBeInTheDocument();
    // Topmost first: the paper annotations (the text; the table and bar listed off), then the frame, then the F label.
    expect(keys().slice(0, 5)).toEqual(["color-bar", "material-table", "t", "frame", "fosLabel"]);
    fireEvent.click(screen.getByRole("button", { name: "Turn off: Frame" }));
    expect(rvs().paperFrame.showFrame).toBe(false);
    expect(list.getByRole("listitem", { name: "Frame (off)" })).toBeInTheDocument();
    expect(temporal().pastStates).toHaveLength(1);
    // No remove button, and Delete removes nothing.
    expect(within(row("frame")).queryByRole("button", { name: /remove/i })).toBeNull();
    fireEvent.keyDown(row("frame"), { key: "Delete" });
    expect(rvs().paperFrame.showFrame).toBe(false);
    expect(row("frame")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn on: Frame" }));
    expect(rvs().paperFrame.showFrame).toBe(true);
    expect(list.getByRole("listitem", { name: "Frame" })).toBeInTheDocument();
    // The paper's other settings are kept.
    expect(rvs().paperFrame.paperSize).toBe(DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.paperSize);
  });

  it("opens on from a project saved without the switch, and off from one saved with the frame off", () => {
    const { showFrame: _drop, ...paperFrame } = DEFAULT_RESULT_VIEW_SETTINGS.paperFrame;
    void _drop;
    act(() => useAppStore.setState({ resultViewSettings: normalizeResultView({ ...DEFAULT_RESULT_VIEW_SETTINGS, paperFrame, annotations: [] }) }));
    render(<ResultSidebar />);
    expect(screen.getByRole("listitem", { name: "Frame" })).toBeInTheDocument();
    act(() =>
      useAppStore.setState({
        resultViewSettings: normalizeResultView({ ...DEFAULT_RESULT_VIEW_SETTINGS, paperFrame: { ...paperFrame, showFrame: false }, annotations: [] }),
      }),
    );
    expect(screen.getByRole("listitem", { name: "Frame (off)" })).toBeInTheDocument();
  });

  it("keeps an old project's tick spacing and minor ticks, shown in its properties", () => {
    act(() =>
      useAppStore.setState({ resultViewSettings: normalizeResultView({ ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [], gridSpacing: 2.5, minorTicks: 3 }) }),
    );
    render(<ResultSidebar />);
    fireEvent.click(row("frame"));
    const group = screen.getByRole("group", { name: "Frame properties" });
    expect(within(group).getByLabelText("Tick spacing (m)")).toHaveValue("2.5");
    expect(within(group).getByLabelText("Minor ticks")).toHaveValue("3");
    expect(within(group).getByRole("button", { name: "Reset to default" })).toBeEnabled();
  });

  it("shows its properties also while off: color, line width, tick spacing, minor ticks, label size and labels, each one undo step", () => {
    act(() => useAppStore.getState().setResultViewSettings({ paperFrame: { ...rvs().paperFrame, showFrame: false } }));
    temporal().clear();
    render(<ResultSidebar />);
    fireEvent.click(row("frame"));
    const group = screen.getByRole("group", { name: "Frame properties" });
    expect(within(group).getByRole("button", { name: "Reset to default" })).toBeDisabled();

    fireEvent.click(within(group).getByRole("button", { name: "Color #cc0000" }));
    expect(rvs().layerStyles).toEqual({ frame: { color: "#cc0000" } });
    expect(temporal().pastStates).toHaveLength(1);

    // The plot frame's width in px (1 px = 0.1 mm): 4 px is the 0.4 mm line.
    const width = within(group).getByLabelText("Line width (px)");
    expect(width).toHaveAttribute("placeholder", "4");
    fireEvent.change(width, { target: { value: "6" } });
    fireEvent.blur(width);
    expect(rvs().layerStyles?.frame?.width).toBe(6);

    // The tick spacing (the stored gridSpacing), Auto by default; a decimal comma is read.
    const spacing = within(group).getByLabelText("Tick spacing (m)");
    expect(spacing).toHaveAttribute("placeholder", "Auto");
    fireEvent.change(spacing, { target: { value: "2,5" } });
    fireEvent.blur(spacing);
    expect(rvs().gridSpacing).toBe(2.5);

    // Minor ticks: 0 to 20, 0 stored as none.
    const minor = within(group).getByLabelText("Minor ticks");
    fireEvent.change(minor, { target: { value: "50" } });
    expect(rvs().minorTicks).toBe(20);
    fireEvent.change(minor, { target: { value: "4" } });
    expect(rvs().minorTicks).toBe(4);

    // The labels' size (px of the F label's unit), 11 by default; off, the size is kept and not offered.
    const size = within(group).getByLabelText("Label size (px)");
    expect(size).toHaveValue("11");
    fireEvent.change(size, { target: { value: "14" } });
    expect(rvs().layerStyles?.frame?.fontSize).toBe(14);
    fireEvent.click(within(group).getByRole("checkbox", { name: "Tick labels" }));
    expect(rvs().layerStyles?.frame).toEqual({ color: "#cc0000", width: 6, fontSize: 14, labels: false });
    expect(within(group).getByLabelText("Label size (px)")).toBeDisabled();
    expect(temporal().pastStates).toHaveLength(7);

    // Reset clears the style, the tick spacing and the minor ticks in one undo step; the frame stays off.
    fireEvent.click(within(group).getByRole("button", { name: "Reset to default" }));
    expect(rvs().layerStyles).toBeUndefined();
    expect(rvs().gridSpacing).toBeUndefined();
    expect(rvs().minorTicks).toBeUndefined();
    expect(rvs().paperFrame.showFrame).toBe(false);
    act(() => temporal().undo());
    expect(rvs().gridSpacing).toBe(2.5);
    expect(rvs().minorTicks).toBe(4);
    expect(rvs().layerStyles?.frame).toEqual({ color: "#cc0000", width: 6, fontSize: 14, labels: false });
  });

  it("the grid's properties say that the tick spacing is set under Frame", () => {
    render(<ResultSidebar />);
    fireEvent.click(row("grid"));
    const group = screen.getByRole("group", { name: "Grid properties" });
    expect(within(group).getByLabelText("Spacing (m)")).toHaveAttribute("title", expect.stringContaining("(Frame)"));
    expect(within(group).queryByLabelText("Tick spacing (m)")).toBeNull();
  });
});
