import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";
import { ResultSidebar } from "./ResultSidebar";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";
import type { Annotation, PaperAnnotation } from "../../store/types";

const RESULT = {
  minFOS: 1.2,
  maxFOS: 2,
  criticalSurface: { cx: 10, cy: 12, radius: 10, fos: 1.2, entryPoint: [2, 8], exitPoint: [18, 2] },
  allSurfaces: [],
  criticalSlices: [],
  method: "Spencer",
  elapsedMs: 1,
} as unknown as AnalysisResult;
const PLOT: Annotation = { id: "p1", type: "plot", x: 0.3, y: 0.3, width: 0.24, height: 0.18, fontSize: 12, plotAxisX: "slice", plotAxisY: "shearStrength" };

const plotOf = (id = "p1") => useAppStore.getState().resultViewSettings.annotations.find((a) => a.id === id) as PaperAnnotation;
const history = () => useAppStore.temporal.getState();
const panel = () => screen.getByRole("group", { name: "Plot style" });

beforeEach(() => {
  useAppStore.getState().newProject();
  useAppStore.setState({
    result: RESULT,
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [PLOT, { ...PLOT, id: "p2", x: 0.6 }] },
    selectedAnnotationIds: ["p1"],
    selectedResultObject: null,
    selectedResultLayer: null,
  });
  history().clear();
});

afterEach(cleanup);

describe("the plot's style properties", () => {
  it("shows the series, axes and plot groups at the defaults, with Reset disabled", () => {
    render(<ResultSidebar />);
    const p = panel();
    for (const name of ["Series", "Axes", "Plot"]) expect(within(p).getByRole("group", { name })).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: "Default" })).toHaveAttribute("aria-pressed", "true");
    expect(within(p).getByRole("button", { name: "Solid" })).toHaveAttribute("aria-pressed", "true");
    expect(within(p).getByLabelText("Markers")).toHaveValue("circle");
    // In px, 1 px = 0.1 mm: the default 0.25 mm line and 1.26 mm markers.
    expect(within(p).getByLabelText("Line width (px)")).toHaveAttribute("placeholder", "2.5");
    expect(within(p).getByLabelText("Marker size (px)")).toHaveAttribute("placeholder", "12.6");
    expect(within(p).getByLabelText("Y max")).toHaveAttribute("placeholder", "Auto");
    expect(within(p).getByRole("checkbox", { name: "Gridlines" })).toBeChecked();
    expect(within(p).getByRole("checkbox", { name: "Title" })).toBeChecked();
    expect(within(p).getByLabelText("Text size (px)")).toHaveValue("9");
    expect(within(p).getByRole("button", { name: "Reset to default" })).toBeDisabled();
  });

  it("stores each control's change on the plot, each one undo step, and leaves the other plot alone", () => {
    render(<ResultSidebar />);
    const p = panel();
    const steps: [string, () => void, Partial<PaperAnnotation["plotStyle"]>][] = [
      ["color", () => fireEvent.click(within(p).getByRole("button", { name: "Color #cc0000" })), { color: "#cc0000" }],
      ["line", () => fireEvent.click(within(p).getByRole("button", { name: "Dashed" })), { line: "dashed" }],
      ["width", () => fireEvent.change(within(p).getByLabelText("Line width (px)"), { target: { value: "5,5" } }), { lineWidthPx: 5.5 }],
      ["marker", () => fireEvent.change(within(p).getByLabelText("Markers"), { target: { value: "square" } }), { marker: "square" }],
      ["size", () => fireEvent.change(within(p).getByLabelText("Marker size (px)"), { target: { value: "25" } }), { markerSizePx: 25 }],
      ["open", () => fireEvent.click(within(p).getByRole("checkbox", { name: "Open markers" })), { markerOpen: true }],
      ["x min", () => fireEvent.change(within(p).getByLabelText("X min"), { target: { value: "2" } }), { xMin: 2 }],
      ["x max", () => fireEvent.change(within(p).getByLabelText("X max"), { target: { value: "9" } }), { xMax: 9 }],
      ["y min", () => fireEvent.change(within(p).getByLabelText("Y min"), { target: { value: "-1,5" } }), { yMin: -1.5 }],
      ["y max", () => fireEvent.change(within(p).getByLabelText("Y max"), { target: { value: "120" } }), { yMax: 120 }],
      ["grid", () => fireEvent.click(within(p).getByRole("checkbox", { name: "Gridlines" })), { showGrid: false }],
      ["axis title", () => fireEvent.click(within(p).getByRole("checkbox", { name: "Axis title" })), { showAxisTitle: false }],
      ["title", () => fireEvent.click(within(p).getByRole("checkbox", { name: "Title" })), { showTitle: false }],
      ["border", () => fireEvent.click(within(p).getByRole("checkbox", { name: "Border" })), { showBorder: false }],
      ["text", () => fireEvent.change(within(p).getByLabelText("Text size (px)"), { target: { value: "12" } }), { fontSize: 12 }],
    ];
    let expected = {};
    steps.forEach(([name, act], i) => {
      act();
      expected = { ...expected, ...steps[i][2] };
      expect(plotOf().plotStyle, name).toEqual(expected);
      expect(history().pastStates, name).toHaveLength(i + 1);
    });
    expect(plotOf("p2").plotStyle).toBeUndefined();
    // The plot's other fields are kept.
    expect(plotOf()).toMatchObject({ width: 0.24, plotAxisY: "shearStrength", fontSize: 12 });
  });

  it("hides the line width with no line, the marker size with no markers and Open markers for plus", () => {
    render(<ResultSidebar />);
    const p = panel();
    fireEvent.click(within(p).getByRole("button", { name: "None" }));
    expect(within(p).queryByLabelText("Line width (mm)")).toBeNull();
    fireEvent.change(within(p).getByLabelText("Markers"), { target: { value: "plus" } });
    expect(within(p).queryByRole("checkbox", { name: "Open markers" })).toBeNull();
    fireEvent.change(within(p).getByLabelText("Markers"), { target: { value: "none" } });
    expect(within(p).queryByLabelText("Marker size (mm)")).toBeNull();
    // Back to the defaults: no style left.
    fireEvent.click(within(p).getByRole("button", { name: "Solid" }));
    fireEvent.change(within(p).getByLabelText("Markers"), { target: { value: "circle" } });
    expect(plotOf().plotStyle).toBeUndefined();
  });

  it("clears a number with an empty field and resets the whole style in one undo step", () => {
    render(<ResultSidebar />);
    const p = panel();
    fireEvent.change(within(p).getByLabelText("Y max"), { target: { value: "50" } });
    fireEvent.change(within(p).getByLabelText("Y max"), { target: { value: "" } });
    expect(plotOf().plotStyle).toBeUndefined();
    fireEvent.click(within(p).getByRole("button", { name: "Color #0066cc" }));
    fireEvent.click(within(p).getByRole("checkbox", { name: "Gridlines" }));
    const before = history().pastStates.length;
    fireEvent.click(within(p).getByRole("button", { name: "Reset to default" }));
    expect(plotOf().plotStyle).toBeUndefined();
    expect("plotStyle" in plotOf()).toBe(false);
    expect(history().pastStates).toHaveLength(before + 1);
    expect(within(p).getByRole("button", { name: "Reset to default" })).toBeDisabled();
    act(() => history().undo());
    expect(plotOf().plotStyle).toEqual({ color: "#0066cc", showGrid: false });
  });

  it("styles every selected plot at once and shows mixed values", () => {
    useAppStore.setState((s) => ({
      selectedAnnotationIds: ["p1", "p2"],
      resultViewSettings: {
        ...s.resultViewSettings,
        annotations: s.resultViewSettings.annotations.map((a): Annotation => (a.id === "p2" && a.type === "plot" ? { ...a, plotStyle: { lineWidthPx: 10 } } : a)),
      },
    }));
    render(<ResultSidebar />);
    const p = panel();
    history().clear();
    expect(within(p).getByLabelText("Line width (px)")).toHaveAttribute("placeholder", "Mixed");
    fireEvent.click(within(p).getByRole("button", { name: "Dashed" }));
    expect(plotOf("p1").plotStyle).toEqual({ line: "dashed" });
    expect(plotOf("p2").plotStyle).toEqual({ line: "dashed", lineWidthPx: 10 });
    expect(history().pastStates).toHaveLength(1);
  });
});
