import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingContext } from "../../test/recording-context";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";
import { ResultSidebar } from "./ResultSidebar";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";
import { getPlotAspectRatio } from "../view/paper";
import type { Annotation } from "../../store/types";

const surface = (fos: number) => ({ cx: 10, cy: 12, radius: 10, fos, entryPoint: [2, 8], exitPoint: [18, 2] });

function result(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    minFOS: 1.234,
    maxFOS: 2,
    criticalSurface: surface(1.234),
    allSurfaces: [surface(1.234), surface(0.9), surface(2)],
    criticalSlices: [],
    method: "Spencer",
    elapsedMs: 42.4,
    ...over,
  } as AnalysisResult;
}

const ANNOS: Annotation[] = [
  { id: "t1", type: "text", x: 0.1, y: 0.1, text: "Title", fontSize: 24 },
  { id: "t2", type: "text", x: 0.1, y: 0.2, text: "Sub", fontSize: 14, bold: true },
  { id: "m", type: "material-table", x: 0.9, y: 0.05, anchor: "top-right" },
  { id: "p", type: "plot", x: 0.5, y: 0.6 },
  { id: "c", type: "color-bar", x: 0.8, y: 0.3 },
];

const annotations = () => useAppStore.getState().resultViewSettings.annotations;
const anno = (id: string) => annotations().find((a) => a.id === id)!;
const rvs = () => useAppStore.getState().resultViewSettings;

/** The form control placed under a (non-associated) label text. */
function field(label: string): HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement {
  const el = screen.getByText(label, { selector: "label" }).parentElement!.querySelector("input, select, textarea");
  return el as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
}

function select(ids: string[]) {
  act(() => useAppStore.getState().setSelectedAnnotations(ids));
}

beforeEach(() => {
  useAppStore.getState().newProject();
  useAppStore.setState({
    result: result(),
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: ANNOS },
    selectedAnnotationIds: [],
    selectedResultObject: null,
  });
});

afterEach(cleanup);

describe("ResultSidebar summary", () => {
  it("summarises the result: FOS, method, surfaces below 1.0 and time", () => {
    render(<ResultSidebar />);
    expect(screen.getByText("Min FOS").nextSibling!.textContent).toBe("1.234");
    expect(screen.getByText("Spencer")).toBeInTheDocument();
    expect(screen.getByText("Surfaces").nextSibling!.textContent).toBe("3 (1 below 1.0)");
    expect(screen.getByText("42 ms")).toBeInTheDocument();
  });

  it("shows both sliding directions, design values and warnings", () => {
    act(() =>
      useAppStore.setState((s) => ({
        options: { ...s.options, partialFactors: {} as never },
        result: result({
          slidingDirection: "rtl",
          otherDirectionMinFOS: undefined,
          nonConvergedSurfaces: 3,
          splitFailureCount: 1,
        } as Partial<AnalysisResult>),
      })),
    );
    render(<ResultSidebar />);
    expect(screen.getByText("Min FOS (design values)")).toBeInTheDocument();
    expect(screen.getByText("← left")).toBeInTheDocument();
    expect(screen.getByText("Other direction").nextSibling!.textContent).toBe("no surface");
    expect(
      screen.getByText("3 surfaces were discarded because they did not reach equilibrium"),
    ).toHaveAttribute("title", expect.stringMatching(/equilibrium/));
    expect(screen.getByText(/1 material boundary split\(s\) failed/)).toBeInTheDocument();
  });

  it("reports a failed run, or that there is no result yet", () => {
    act(() => useAppStore.setState({ result: null, runState: "error", errorMessage: "Bad geometry" }));
    render(<ResultSidebar />);
    expect(screen.getByRole("alert")).toHaveTextContent("Analysis failed: Bad geometry");
    act(() => useAppStore.setState({ runState: "idle" }));
    expect(screen.getByText("No results yet.")).toBeInTheDocument();
  });

  it("collapses a section from its header", () => {
    render(<ResultSidebar />);
    fireEvent.click(screen.getByText("Summary"));
    expect(screen.queryByText("Spencer")).toBeNull();
    fireEvent.click(screen.getByText("Summary"));
    expect(screen.getByText("Spencer")).toBeInTheDocument();
  });
});

describe("ResultSidebar annotations list", () => {
  it("lists annotations by type, selects, multi-selects and removes them", () => {
    render(<ResultSidebar />);
    // Text annotations by their text.
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Sub")).toBeInTheDocument();
    expect(screen.getByText("Material Table")).toBeInTheDocument();
    expect(screen.getByText("Plot")).toBeInTheDocument();
    expect(screen.getByText("Color Bar")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Plot"));
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["p"]);
    fireEvent.click(screen.getByText("Color Bar"), { ctrlKey: true });
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["p", "c"]);

    fireEvent.click(screen.getAllByTitle("Remove annotation")[4]);
    expect(annotations().map((a) => a.id)).toEqual(["t1", "t2", "m", "p"]);
  });

  it("lists a text annotation by its text as the sheet shows it", () => {
    act(() => {
      useAppStore.setState({
        projectInfo: { ...useAppStore.getState().projectInfo, title: "T-ACADS Non-Homogeneous" },
        resultViewSettings: {
          ...DEFAULT_RESULT_VIEW_SETTINGS,
          annotations: [
            { id: "a", type: "text", x: 0, y: 0, text: "#Title\\nFOS {{1+1}}" },
            { id: "b", type: "text", x: 0, y: 0, text: "   " },
          ],
        },
        selectedAnnotationIds: ["a"],
      });
    });
    render(<ResultSidebar />);
    expect(screen.getByText("T-ACADS Non-Homogeneous FOS 2", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Text (empty)")).toBeInTheDocument();
    // The properties keep the template and preview the result.
    expect(field("Text").value).toBe("#Title\\nFOS {{1+1}}");
    expect(screen.getByLabelText("Text on the sheet")).toHaveTextContent("T-ACADS Non-Homogeneous FOS 2");
  });

  it("says when there are no annotations", () => {
    act(() => useAppStore.setState({ resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [] } }));
    render(<ResultSidebar />);
    expect(screen.getByText("No annotations yet.")).toBeInTheDocument();
    expect(screen.getByText("Select an object on the canvas to edit its properties.")).toBeInTheDocument();
  });
});

describe("ResultSidebar paper frame properties", () => {
  beforeEach(() => {
    act(() => useAppStore.setState({ selectedResultObject: "paper-frame" }));
  });

  it("edits the locked view, keeping the paper's aspect ratio", () => {
    render(<ResultSidebar />);
    const left = field("Left X");
    expect(left.value).toBe("-1.00");
    fireEvent.focus(left);
    fireEvent.change(left, { target: { value: "4" } });
    fireEvent.blur(left);
    const ar = getPlotAspectRatio("A4", true);
    const lock = rvs().viewLock!;
    expect(lock.bottomLeft[0]).toBe(4);
    expect(lock.topRight[1] - lock.bottomLeft[1]).toBeCloseTo((lock.topRight[0] - 4) / ar, 9);

    // Top Y moves the bottom instead.
    const top = field("Top Y");
    fireEvent.focus(top);
    fireEvent.change(top, { target: { value: "30" } });
    fireEvent.keyDown(top, { key: "Enter" });
    const lock2 = rvs().viewLock!;
    expect(lock2.topRight[1]).toBe(30);
    expect(lock2.bottomLeft[1]).toBeCloseTo(30 - (lock2.topRight[0] - lock2.bottomLeft[0]) / ar, 9);
  });

  it("ignores an empty or invalid extent and restores the shown value", () => {
    render(<ResultSidebar />);
    const right = field("Right X");
    const before = rvs().viewLock;
    fireEvent.focus(right);
    fireEvent.change(right, { target: { value: "" } });
    fireEvent.blur(right);
    expect(rvs().viewLock).toEqual(before);
    expect(right.value).toBe("26.00");
  });

  it("edits the bottom and right extents, keeping the aspect ratio from the bottom", () => {
    render(<ResultSidebar />);
    const ar = getPlotAspectRatio("A4", true);
    const bottom = field("Bottom Y");
    fireEvent.focus(bottom);
    fireEvent.change(bottom, { target: { value: "-5" } });
    fireEvent.keyDown(bottom, { key: "Enter" });
    let lock = rvs().viewLock!;
    expect(lock.bottomLeft[1]).toBe(-5);
    expect(lock.topRight[1]).toBeCloseTo(-5 + (lock.topRight[0] - lock.bottomLeft[0]) / ar, 9);
    const right = field("Right X");
    fireEvent.focus(right);
    fireEvent.change(right, { target: { value: "50" } });
    fireEvent.blur(right);
    lock = rvs().viewLock!;
    expect(lock.topRight[0]).toBe(50);
    expect(lock.topRight[1]).toBeCloseTo(-5 + (50 - lock.bottomLeft[0]) / ar, 9);
    // A lone sign is not a number: nothing changes.
    fireEvent.focus(right);
    fireEvent.change(right, { target: { value: "-" } });
    fireEvent.blur(right);
    expect(rvs().viewLock!.topRight[0]).toBe(50);
  });

  it("fits the locked view to the model bounds", () => {
    act(() =>
      useAppStore.setState({
        coordinates: [
          [0, 0],
          [0, 10],
          [40, 5],
          [40, 0],
        ],
      }),
    );
    render(<ResultSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Use model bounds" }));
    const lock = rvs().viewLock!;
    expect(lock.bottomLeft).toEqual([-1, -1]);
    expect(lock.topRight[0]).toBe(41);
    expect(lock.topRight[1]).toBeCloseTo(-1 + 42 / getPlotAspectRatio("A4", true), 9);
  });

  it("fits a tall, narrow model without cutting off its top", () => {
    act(() =>
      useAppStore.setState({
        coordinates: [
          [0, 0],
          [0, 30],
          [10, 30],
          [10, 0],
        ],
      }),
    );
    render(<ResultSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Use model bounds" }));
    const lock = rvs().viewLock!;
    const ar = getPlotAspectRatio("A4", true);
    // The whole model (with the 1 m margin) is inside the lock…
    expect(lock.topRight[1]).toBeGreaterThanOrEqual(31 - 1e-9);
    expect(lock.bottomLeft[1]).toBe(-1);
    expect(lock.bottomLeft[0]).toBeLessThanOrEqual(-1);
    expect(lock.topRight[0]).toBeGreaterThanOrEqual(11);
    // …centred horizontally, with the plot's aspect ratio.
    expect((lock.bottomLeft[0] + lock.topRight[0]) / 2).toBeCloseTo(5, 9);
    expect((lock.topRight[0] - lock.bottomLeft[0]) / (lock.topRight[1] - lock.bottomLeft[1])).toBeCloseTo(ar, 9);
  });

  it("sets tick spacing, minor ticks, paper size and orientation", () => {
    render(<ResultSidebar />);
    const minor = field("Minor ticks");
    fireEvent.change(minor, { target: { value: "50" } });
    expect(rvs().minorTicks).toBe(20);
    fireEvent.change(minor, { target: { value: "0" } });
    expect(rvs().minorTicks).toBeUndefined();

    const spacing = field("Ticks spacing");
    fireEvent.change(spacing, { target: { value: "5" } });
    fireEvent.blur(spacing);
    expect(rvs().gridSpacing).toBe(5);

    fireEvent.change(field("Paper size"), { target: { value: "A3" } });
    expect(rvs().paperFrame.paperSize).toBe("A3");

    const lock = rvs().viewLock!;
    fireEvent.change(field("Paper orientation"), { target: { value: "portrait" } });
    expect(rvs().paperFrame.landscape).toBe(false);
    const width = lock.topRight[0] - lock.bottomLeft[0];
    expect(rvs().viewLock!.topRight[1]).toBeCloseTo(lock.bottomLeft[1] + width / getPlotAspectRatio("A3", false), 9);
  });
});

describe("ResultSidebar annotation properties", () => {
  it("edits the position of all selected annotations and shows mixed values", () => {
    select(["t1", "m"]);
    render(<ResultSidebar />);
    expect(field("X (%)").placeholder).toBe("Mixed");
    expect(field("Y (%)").placeholder).toBe("Mixed");
    expect(screen.getByText(/2 object\(s\) selected/)).toBeInTheDocument();
    fireEvent.change(field("X (%)"), { target: { value: "40" } });
    expect(anno("t1").x).toBeCloseTo(0.4, 9);
    expect(anno("m").x).toBeCloseTo(0.4, 9);
  });

  it("changes the anchor without moving the annotation when there is no measured result", () => {
    act(() => useAppStore.setState({ result: null }));
    select(["p"]);
    render(<ResultSidebar />);
    expect(screen.getByText("Top Left", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Bottom Right"));
    expect(anno("p")).toMatchObject({ anchor: "bottom-right", x: 0.5, y: 0.6 });
  });

  it("moves the anchor point so the annotation box stays in place", () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => createRecordingContext(1200, 800).ctx as never);
    select(["p"]);
    render(<ResultSidebar />);
    fireEvent.click(screen.getByTitle("Bottom Right"));
    const p = anno("p");
    expect(p.anchor).toBe("bottom-right");
    // Bottom-right of a box whose top-left stays at (0.5, 0.6), plot ≈ 24 % × 18 %.
    expect(p.x).toBeGreaterThan(0.7);
    expect(p.x).toBeLessThan(0.76);
    expect(p.y).toBeGreaterThan(0.75);
    expect(p.y).toBeLessThan(0.8);
    // Same anchor again: position unchanged.
    fireEvent.click(screen.getByTitle("Bottom Right"));
    expect(anno("p")).toEqual(p);
    spy.mockRestore();
  });

  it("edits the text, font, size, style and colour of text annotations", () => {
    select(["t1", "t2"]);
    render(<ResultSidebar />);
    expect(field("Text").placeholder).toBe("Mixed values");
    expect(field("Size").value).toBe("__mixed__");
    fireEvent.change(field("Text"), { target: { value: "Same" } });
    expect([anno("t1").text, anno("t2").text]).toEqual(["Same", "Same"]);
    fireEvent.change(field("Size"), { target: { value: "16" } });
    expect([anno("t1").fontSize, anno("t2").fontSize]).toEqual([16, 16]);
    // Mixed bold → bold for all; then toggled off.
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect([anno("t1").bold, anno("t2").bold]).toEqual([true, true]);
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(anno("t1").bold).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "I" }));
    expect(anno("t2").italic).toBe(true);
    const font = field("Font");
    fireEvent.change(font, { target: { value: font.options[1].value } });
    expect(anno("t1").fontFamily).toBe(font.options[1].value);
  });

  it("sets the text size of material tables", () => {
    select(["m"]);
    render(<ResultSidebar />);
    expect(field("Text size").value).toBe("6");
    fireEvent.change(field("Text size"), { target: { value: "10" } });
    expect(anno("m").fontSize).toBe(10);
  });

  it("removes and adds material table columns for the selected tables", () => {
    // jsdom has no scrolling.
    Element.prototype.scrollIntoView = vi.fn();
    select(["m"]);
    render(<ResultSidebar />);
    fireEvent.click(screen.getByLabelText("Remove Su"));
    expect(anno("m").tableColumns).not.toContain("cohesion");
    expect(anno("m").tableColumns).toContain("unitWeight");
    fireEvent.click(screen.getByLabelText("Toggle options"));
    fireEvent.click(screen.getByRole("option", { name: "Su" }));
    expect(anno("m").tableColumns).toContain("cohesion");
  });

  it("sizes plots within 5–95 % and chooses their axes", () => {
    select(["p"]);
    render(<ResultSidebar />);
    expect(field("Width (%)").value).toBe("24");
    fireEvent.change(field("Width (%)"), { target: { value: "120" } });
    expect(anno("p").width).toBeCloseTo(0.95, 9);
    fireEvent.change(field("Height (%)"), { target: { value: "2" } });
    expect(anno("p").height).toBeCloseTo(0.05, 9);
    const xAxis = field("X axis");
    fireEvent.change(xAxis, { target: { value: xAxis.options[1].value } });
    expect(anno("p").plotAxisX).toBe(xAxis.options[1].value);
    const yAxis = field("Y axis");
    fireEvent.change(yAxis, { target: { value: "cohesion" } });
    expect(anno("p").plotAxisY).toBe("cohesion");
  });
});
