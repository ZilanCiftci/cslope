import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";
import { ResultSidebar } from "./ResultSidebar";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";
import type { Annotation } from "../../store/types";

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
const ANNOS: Annotation[] = [{ id: "t1", type: "text", x: 0.1, y: 0.1, text: "Title" }];

const rvs = () => useAppStore.getState().resultViewSettings;
const history = () => useAppStore.temporal.getState();
const row = (key: string) => screen.getAllByTestId("layer-row").find((r) => r.getAttribute("data-layer") === key)!;

beforeEach(() => {
  useAppStore.getState().newProject();
  useAppStore.setState({
    result: RESULT,
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: ANNOS, showSlices: true, showFosLabel: true, showCentreMarker: true },
    selectedAnnotationIds: ["t1"],
    selectedResultObject: null,
    selectedResultLayer: null,
  });
  history().clear();
});

afterEach(cleanup);

describe("display layer properties", () => {
  it("selects a display layer row with a click: its properties under its name, the annotation selection cleared", () => {
    render(<ResultSidebar />);
    fireEvent.click(row("slices"));
    expect(useAppStore.getState().selectedResultLayer).toBe("slices");
    expect(useAppStore.getState().selectedAnnotationIds).toEqual([]);
    expect(row("slices")).toHaveAttribute("aria-current", "true");
    expect(row("t1")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Slices" })).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: "Slices properties" });
    expect(within(group).getByRole("group", { name: "Color" })).toBeInTheDocument();
    expect(within(group).getByLabelText("Line width (px)")).toBeInTheDocument();
    // Selection is no edit.
    expect(history().pastStates).toHaveLength(0);
  });

  it("selects with Enter; selecting an annotation or clicking empty canvas clears it", () => {
    render(<ResultSidebar />);
    fireEvent.keyDown(row("fosLabel"), { key: "Enter" });
    expect(screen.getByRole("group", { name: "F label properties" })).toBeInTheDocument();
    fireEvent.click(row("t1"));
    expect(useAppStore.getState().selectedResultLayer).toBeNull();
    expect(screen.queryByRole("group", { name: "F label properties" })).toBeNull();
    fireEvent.keyDown(row("center"), { key: " " });
    expect(useAppStore.getState().selectedResultLayer).toBe("center");
    // (an empty canvas click clears the selected sheet object)
    act(() => useAppStore.getState().setSelectedResultObject(null));
    expect(useAppStore.getState().selectedResultLayer).toBeNull();
    expect(screen.getByRole("button", { name: "Selection" })).toBeInTheDocument();
  });

  it("changes the FOS label's color, size, decimals, font and bold, each one undo step", () => {
    render(<ResultSidebar />);
    fireEvent.click(row("fosLabel"));
    const group = screen.getByRole("group", { name: "F label properties" });
    fireEvent.click(within(group).getByRole("button", { name: "Color #cc0000" }));
    expect(rvs().layerStyles).toEqual({ fosLabel: { color: "#cc0000" } });
    expect(history().pastStates).toHaveLength(1);
    fireEvent.change(within(group).getByLabelText("Size (px)"), { target: { value: "18" } });
    fireEvent.change(within(group).getByLabelText("Decimals"), { target: { value: "2" } });
    fireEvent.change(within(group).getByLabelText("Font"), { target: { value: "serif" } });
    fireEvent.click(within(group).getByRole("button", { name: "Bold" }));
    expect(rvs().layerStyles?.fosLabel).toEqual({ color: "#cc0000", fontSize: 18, decimals: 2, fontFamily: "serif", bold: false });
    expect(history().pastStates).toHaveLength(5);
    // "Default" goes back to the theme's ink.
    fireEvent.click(within(group).getByRole("button", { name: "Default" }));
    expect(rvs().layerStyles?.fosLabel?.color).toBeUndefined();
    act(() => history().undo());
    expect(rvs().layerStyles?.fosLabel?.color).toBe("#cc0000");
    fireEvent.click(within(group).getByRole("button", { name: "Reset to default" }));
    expect(rvs().layerStyles).toBeUndefined();
  });

  it("sets a line width and an opacity; out-of-range numbers are not taken, an emptied field is the default", () => {
    act(() => useAppStore.getState().setResultViewSettings({ surfaceDisplay: "all" }));
    history().clear();
    render(<ResultSidebar />);
    fireEvent.click(row("surfaces"));
    const group = screen.getByRole("group", { name: "Surfaces properties" });
    const width = within(group).getByLabelText("Line width (px)");
    expect(width).toHaveAttribute("placeholder", "1");
    fireEvent.change(width, { target: { value: "2.5" } });
    fireEvent.change(within(group).getByLabelText("Opacity (%)"), { target: { value: "30" } });
    expect(rvs().layerStyles).toEqual({ surfaces: { width: 2.5, opacity: 0.3 } });
    expect(history().pastStates).toHaveLength(2);
    fireEvent.change(width, { target: { value: "50" } });
    expect(rvs().layerStyles?.surfaces?.width).toBe(2.5);
    fireEvent.change(width, { target: { value: "" } });
    expect(rvs().layerStyles).toEqual({ surfaces: { opacity: 0.3 } });
  });

  it("turns the radius lines off and keeps the row's own off button", () => {
    render(<ResultSidebar />);
    fireEvent.click(row("center"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Radius lines to the entry and exit" }));
    expect(rvs().layerStyles).toEqual({ center: { radiusLines: false } });
    fireEvent.click(screen.getByRole("button", { name: /^Turn off \(as the Center button in the ribbon\)/ }));
    expect(rvs().showCentreMarker).toBe(false);
    expect(useAppStore.getState().selectedResultLayer).toBeNull();
    expect(screen.queryByRole("group", { name: "Center properties" })).toBeNull();
  });
});
