import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingContext } from "../../test/recording-context";
import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";
import { ResultSidebar } from "./ResultSidebar";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";
import { getPlotAspectRatio } from "../view/paper";
import { modelViewLock, viewLockContains } from "../view/viewLock";
import { paperContentOf } from "../view/extents";
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

/** Set result view settings now (the store's setter). */
function setRvsNow(patch: Partial<ReturnType<typeof rvs>>) {
  useAppStore.getState().setResultViewSettings(patch);
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
    expect(screen.getAllByText("Surfaces")[0].nextSibling!.textContent).toBe("3 (1 below 1.0)");
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
          warnings: [
            {
              code: "negative-effective-normal",
              message: "2 slices of the critical surface have negative effective normal force (N′ < 0) at the base.",
              count: 2,
            },
          ],
        } as Partial<AnalysisResult>),
      })),
    );
    render(<ResultSidebar />);
    expect(screen.getByText("Min FOS (design values)")).toBeInTheDocument();
    expect(screen.getByText("← left")).toBeInTheDocument();
    expect(screen.getByText("Other direction").nextSibling!.textContent).toBe("no surface");
    // The notes are folded into one line; unfolded, each is a line, and the
    // explanation is in the documentation, behind a help button.
    expect(screen.queryByText(/discarded because they did not reach equilibrium/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /3 notes/ }));
    const note = screen.getByText("3 surfaces were discarded because they did not reach equilibrium");
    expect(note).not.toHaveAttribute("title");
    expect(screen.queryByText(/within the iteration limits/)).toBeNull();
    expect(screen.getByRole("button", { name: "Help: Surfaces without equilibrium" })).toBeInTheDocument();
    expect(screen.getByText(/1 material boundary split\(s\) failed/)).toBeInTheDocument();
    expect(screen.getByText(/2 slices of the critical surface have negative effective normal force/)).toBeInTheDocument();
  });

  it("lists each custom surface with its factor of safety or why it has none", () => {
    act(() =>
      useAppStore.setState({
        result: result({
          customSurfaces: [
            { kind: "circle", index: 0, surface: { ...surface(0.664), customPlane: { kind: "circle", index: 0 } } },
            { kind: "circle", index: 1, reason: "the circle does not cut the ground twice" },
            {
              kind: "polyline",
              index: 0,
              surface: { ...surface(1.5), radius: 0, points: [[2, 8], [10, 3], [18, 2]], customPlane: { kind: "polyline", index: 0 } },
            },
          ] as unknown as AnalysisResult["customSurfaces"],
        }),
      }),
    );
    render(<ResultSidebar />);
    const rows = screen.getAllByTestId("custom-surface-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Custom surface 10.664",
      "Custom surface 2no solution: the circle does not cut the ground twice",
      "Custom surface 31.500",
    ]);
    expect(screen.getByText("Custom surface 1")).toHaveAttribute("title", "circle, center (10.00, 12.00) m, radius 10.00 m");
    expect(screen.getByText("Custom surface 2")).toHaveAttribute("title", "circle");
    expect(screen.getByText("Custom surface 3")).toHaveAttribute("title", "non-circular, 3 points");
    cleanup();
    act(() => useAppStore.setState({ result: result() }));
    render(<ResultSidebar />);
    expect(screen.queryByTestId("custom-surface-row")).toBeNull();
  });

  it("marks the finite element results as experimental", () => {
    act(() =>
      useAppStore.setState({
        result: result({
          fem: {
            factorOfSafety: 1.4,
            failedF: 1.45,
            flowRule: "associated",
            levels: [{ elements: 500, fos: 1.4 }],
            warnings: [],
            elapsedMs: 3000,
            x: [],
            y: [],
            triangles: [],
            plasticShear: [],
            displacement: [],
            bounds: { lower: 1.35, upper: 1.45, elements: 800, elapsedMs: 2000, warnings: [] },
          },
        }),
      }),
    );
    render(<ResultSidebar />);
    expect(screen.getByRole("heading", { name: /Finite elements/ })).toHaveTextContent("Experimental");
    expect(screen.getByText("Experimental")).toHaveAttribute(
      "title",
      expect.stringMatching(/experimental: fewer verification problems than limit equilibrium/),
    );
    expect(screen.getByText("FOS, limit analysis (FE)").nextSibling!.textContent).toBe("1.350 – 1.450");
    expect(screen.getByText("Strength reduction (comparison)").nextSibling!.textContent).toBe("1.400");
  });

  it("reports a failed run, or that there is no result yet", () => {
    act(() => useAppStore.setState({ result: null, runState: "error", errorMessage: "Bad geometry" }));
    render(<ResultSidebar />);
    // The reason is only in the banner over the canvas.
    expect(screen.getByText("Analysis failed.")).toBeInTheDocument();
    expect(screen.queryByText(/Bad geometry/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Search limits" })).toBeNull();
    act(() => useAppStore.setState({ runState: "idle" }));
    expect(screen.getByText("No results yet.")).toBeInTheDocument();
  });

  it("leads to the search limits when the failed run found no surface", () => {
    act(() =>
      useAppStore.setState((s) => ({
        result: null,
        runState: "error",
        errorMessage: "No valid slip surface was found. Check the search limits, the geometry and the material strengths.",
        analysisLimits: { ...s.analysisLimits, enabled: true },
        canvasSelection: null,
      })),
    );
    render(<ResultSidebar />);
    expect(screen.getByText("Analysis failed.")).toBeInTheDocument();
    expect(screen.queryByText(/No valid slip surface/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search limits" }));
    expect(useAppStore.getState().canvasSelection).toEqual({ object: { type: "searchLimits" }, point: null });
  });

  it("collapses a section from its header", () => {
    render(<ResultSidebar />);
    fireEvent.click(screen.getByText("Summary"));
    expect(screen.queryByText("Spencer")).toBeNull();
    fireEvent.click(screen.getByText("Summary"));
    expect(screen.getByText("Spencer")).toBeInTheDocument();
  });
});

describe("ResultSidebar layers list", () => {
  it("lists annotations by type, selects, multi-selects and removes them", () => {
    render(<ResultSidebar />);
    // Text annotations by their text.
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Sub")).toBeInTheDocument();
    expect(screen.getByText("Material table")).toBeInTheDocument();
    expect(screen.getByText("Plot")).toBeInTheDocument();
    expect(screen.getByText("Color bar")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Plot"));
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["p"]);
    fireEvent.click(screen.getByText("Color bar"), { ctrlKey: true });
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["p", "c"]);

    // Topmost first: the last annotation (the color bar) is the first row.
    fireEvent.click(screen.getAllByTitle("Remove annotation")[0]);
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

  it("says when nothing is drawn", () => {
    act(() =>
      useAppStore.setState({
        result: null,
        resultViewSettings: {
          ...DEFAULT_RESULT_VIEW_SETTINGS,
          annotations: [],
          showSlices: false,
          showFosLabel: false,
          showCentreMarker: false,
          showSoilColor: false,
        },
      }),
    );
    render(<ResultSidebar />);
    expect(screen.getByText("Nothing is drawn yet.")).toBeInTheDocument();
    expect(screen.getByText("Select an object on the canvas to edit its properties.")).toBeInTheDocument();
  });

  const rowKeys = () => screen.getAllByTestId("layer-row").map((r) => r.getAttribute("data-layer"));

  it("lists the display layers turned on with the annotations, topmost first, in the default order", () => {
    act(() => setRvsNow({ surfaceDisplay: "all", showCustomSurfaces: true }));
    render(<ResultSidebar />);
    expect(screen.getByRole("button", { name: "Layers" })).toBeInTheDocument();
    expect(rowKeys()).toEqual(["c", "p", "m", "t2", "t1", "fosLabel", "center", "slices", "criticalSurface", "surfaces", "soilColor"]);
    expect(screen.getByText("Soil colors")).toBeInTheDocument();
    expect(screen.getByText("Critical surface")).toBeInTheDocument();
    // Turned off in the ribbon: not listed.
    act(() => setRvsNow({ showSlices: false, surfaceDisplay: "critical" }));
    expect(rowKeys()).toEqual(["c", "p", "m", "t2", "t1", "fosLabel", "center", "criticalSurface", "soilColor"]);
  });

  it("turns a display layer off with its button, as the ribbon does; the critical surface has none", () => {
    render(<ResultSidebar />);
    fireEvent.click(screen.getByRole("button", { name: /^Turn off \(as the Slices button in the ribbon\)/ }));
    expect(rvs().showSlices).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Turn off \(as the Soil colors button/ }));
    expect(rvs().showSoilColor).toBe(false);
    const critical = screen.getAllByTestId("layer-row").find((r) => r.getAttribute("data-layer") === "criticalSurface")!;
    expect(critical.querySelector("button")).toBeNull();
    // A display layer selects nothing.
    fireEvent.click(critical);
    expect(useAppStore.getState().selectedAnnotationIds).toEqual([]);
  });

  it("moves a row with Alt+Up and Alt+Down, stored bottom first in the model's layer order (one undo step)", () => {
    render(<ResultSidebar />);
    const row = (key: string) => screen.getAllByTestId("layer-row").find((r) => r.getAttribute("data-layer") === key)!;
    fireEvent.keyDown(row("soilColor"), { key: "ArrowUp", altKey: true });
    expect(rowKeys().slice(-3)).toEqual(["slices", "soilColor", "criticalSurface"]);
    expect(rvs().layerOrder).toEqual(["criticalSurface", "soilColor", "slices", "center", "fosLabel", "t1", "t2", "m", "p", "c"]);
    expect(document.activeElement).toBe(row("soilColor"));
    fireEvent.keyDown(row("t1"), { key: "ArrowDown", altKey: true });
    expect(rowKeys().slice(4, 6)).toEqual(["fosLabel", "t1"]);
    // Without Alt the arrows move the focus, and do not nudge the selection.
    select(["t2"]);
    const before = anno("t2");
    fireEvent.keyDown(row("t2"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("fosLabel"));
    expect(anno("t2")).toEqual(before);
    // The top row stays on top.
    fireEvent.keyDown(row("c"), { key: "ArrowUp", altKey: true });
    expect(rowKeys()[0]).toBe("c");
    act(() => useAppStore.temporal.getState().undo());
    expect(rowKeys().slice(4, 6)).toEqual(["t1", "fosLabel"]);
  });

  it("drops a dragged row above or below the row under the pointer, with a drop line", () => {
    render(<ResultSidebar />);
    const row = (key: string) => screen.getAllByTestId("layer-row").find((r) => r.getAttribute("data-layer") === key)!;
    const target = row("slices");
    target.getBoundingClientRect = () => ({ top: 100, height: 24, bottom: 124, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) });
    const dataTransfer = { setData: () => {}, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(row("t1"), { dataTransfer });
    // (jsdom's drag events carry no pointer position)
    const over = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(over, "clientY", { value: 120 });
    fireEvent(target, over);
    expect(screen.getByTestId("layer-drop-indicator")).toBeInTheDocument();
    fireEvent.drop(target, { clientY: 120, dataTransfer });
    expect(screen.queryByTestId("layer-drop-indicator")).toBeNull();
    // Below the slices: drawn under them, over the critical surface.
    expect(rowKeys().slice(-4)).toEqual(["slices", "t1", "criticalSurface", "soilColor"]);
    expect(rvs().layerOrder).toEqual(["soilColor", "criticalSurface", "t1", "slices", "center", "fosLabel", "t2", "m", "p", "c"]);
  });

  it("keeps the place of a layer turned off and on again; a new annotation goes on top", () => {
    act(() => setRvsNow({ layerOrder: ["soilColor", "slices", "criticalSurface", "center", "fosLabel", "t1", "t2", "m", "p", "c"] }));
    render(<ResultSidebar />);
    expect(rowKeys().slice(-3)).toEqual(["criticalSurface", "slices", "soilColor"]);
    act(() => setRvsNow({ showSlices: false }));
    expect(rowKeys()).not.toContain("slices");
    act(() => setRvsNow({ showSlices: true }));
    expect(rowKeys().slice(-3)).toEqual(["criticalSurface", "slices", "soilColor"]);
    act(() => useAppStore.getState().addAnnotation("text"));
    const added = annotations().at(-1)!.id;
    expect(rowKeys()[0]).toBe(added);
    // Removing an annotation drops it from the order.
    fireEvent.click(screen.getAllByTitle("Remove annotation")[1]);
    expect(rvs().layerOrder).not.toContain("c");
  });

  it("lists a drawing shown in results and takes it out of the results with its button", () => {
    act(() =>
      useAppStore.setState({
        backgrounds: [
          {
            id: "d1",
            assetId: "x",
            name: "Survey",
            calibration: { mode: "drawing", points: [] },
            transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
            opacity: 1,
            visible: true,
            order: 0,
            showInResults: true,
          },
        ],
      }),
    );
    render(<ResultSidebar />);
    expect(rowKeys().slice(-2)).toEqual(["drawing:d1", "soilColor"]);
    fireEvent.click(screen.getByRole("button", { name: /^Hide from the results.*: Survey$/ }));
    expect(useAppStore.getState().backgrounds[0].showInResults).toBe(false);
    expect(rowKeys()).not.toContain("drawing:d1");
  });
});

describe("ResultSidebar paper frame properties", () => {
  beforeEach(() => {
    act(() => useAppStore.setState({ selectedResultObject: "paper-frame" }));
  });

  it("is the Results panel; its last section is named after the selection", () => {
    act(() => useAppStore.setState({ selectedResultObject: null }));
    render(<ResultSidebar />);
    expect(screen.getByLabelText("Collapse results")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Properties" })).toBeNull();
    expect(screen.getByRole("button", { name: "Selection" })).toBeInTheDocument();
    select(["t1", "t2"]);
    expect(screen.getByRole("button", { name: "Text" })).toBeInTheDocument();
    select(["m"]);
    expect(screen.getByRole("button", { name: "Material table" })).toBeInTheDocument();
    select(["c"]);
    expect(screen.getByRole("button", { name: "Color bar" })).toBeInTheDocument();
    select(["p"]);
    expect(screen.getByRole("button", { name: "Plot" })).toBeInTheDocument();
    select(["t1", "m"]);
    expect(screen.getByRole("button", { name: "Selection" })).toBeInTheDocument();
    act(() => useAppStore.setState({ selectedAnnotationIds: [], selectedResultObject: "paper-frame" }));
    expect(screen.getByRole("button", { name: "Sheet" })).toBeInTheDocument();
  });

  it("brings the selection's section into view when something is selected", () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      act(() => useAppStore.setState({ selectedResultObject: null }));
      render(<ResultSidebar />);
      expect(scroll).not.toHaveBeenCalled();
      select(["m"]);
      const section = screen.getByTestId("selection-section");
      expect(scroll.mock.contexts).toContain(section);
      expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
      scroll.mockClear();
      select([]);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      // jsdom has none: take ours away again rather than leave undefined.
      if (original) HTMLElement.prototype.scrollIntoView = original;
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });

  it("Sheet settings opens the sheet's section and puts the cursor in its first field", () => {
    act(() => useAppStore.setState({ selectedResultObject: null, mode: "edit", sidebarOpen: false }));
    render(<ResultSidebar />);
    // The selection's section closed by the user.
    fireEvent.click(screen.getByRole("button", { name: "Selection" }));
    expect(screen.queryByText("Select an object on the canvas to edit its properties.")).toBeNull();
    act(() => useAppStore.getState().showPaperProperties());
    const s = useAppStore.getState();
    expect(s).toMatchObject({ mode: "result", sidebarOpen: true, selectedResultObject: "paper-frame", selectedAnnotationIds: [] });
    expect(screen.getByRole("group", { name: "Paper" })).toBeInTheDocument();
    expect(document.activeElement).toBe(field("Left x (m)"));
    // The section says whose properties these are.
    expect(screen.getByRole("button", { name: "Sheet" })).toBeInTheDocument();
    // Done once: the request is consumed.
    expect(s.paperPropertiesFocusPending).toBe(false);
  });

  it("has every paper setting: extents, model bounds, ticks, grid, size and orientation", () => {
    render(<ResultSidebar />);
    for (const label of ["Left x (m)", "Right x (m)", "Bottom y (m)", "Top y (m)", "Tick spacing (m)", "Minor ticks", "Paper size", "Paper orientation"]) {
      expect(field(label), label).toBeInTheDocument();
      // The label names its field.
      expect(screen.getByLabelText(label), label).toBe(field(label));
    }
    expect(screen.getByRole("button", { name: "Use model bounds" })).toBeInTheDocument();
    expect(screen.getByLabelText("Grid lines")).toBeInTheDocument();
  });

  it("reads a decimal comma in an extent", () => {
    render(<ResultSidebar />);
    const left = field("Left x (m)");
    fireEvent.focus(left);
    fireEvent.change(left, { target: { value: "2,5" } });
    fireEvent.blur(left);
    expect(rvs().viewLock!.bottomLeft[0]).toBe(2.5);
  });

  it("edits the locked view, keeping the paper's aspect ratio", () => {
    render(<ResultSidebar />);
    const left = field("Left x (m)");
    expect(left.value).toBe("-1.00");
    fireEvent.focus(left);
    fireEvent.change(left, { target: { value: "4" } });
    fireEvent.blur(left);
    const ar = getPlotAspectRatio("A4", true);
    const lock = rvs().viewLock!;
    expect(lock.bottomLeft[0]).toBe(4);
    expect(lock.topRight[1] - lock.bottomLeft[1]).toBeCloseTo((lock.topRight[0] - 4) / ar, 9);

    // Top Y moves the bottom instead.
    const top = field("Top y (m)");
    fireEvent.focus(top);
    fireEvent.change(top, { target: { value: "30" } });
    fireEvent.keyDown(top, { key: "Enter" });
    const lock2 = rvs().viewLock!;
    expect(lock2.topRight[1]).toBe(30);
    expect(lock2.bottomLeft[1]).toBeCloseTo(30 - (lock2.topRight[0] - lock2.bottomLeft[0]) / ar, 9);
  });

  it("ignores an empty or invalid extent and restores the shown value", () => {
    render(<ResultSidebar />);
    const right = field("Right x (m)");
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
    const bottom = field("Bottom y (m)");
    fireEvent.focus(bottom);
    fireEvent.change(bottom, { target: { value: "-5" } });
    fireEvent.keyDown(bottom, { key: "Enter" });
    let lock = rvs().viewLock!;
    expect(lock.bottomLeft[1]).toBe(-5);
    expect(lock.topRight[1]).toBeCloseTo(-5 + (lock.topRight[0] - lock.bottomLeft[0]) / ar, 9);
    const right = field("Right x (m)");
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

  it("fits the locked view to the model as it starts, loads and title block included", () => {
    act(() =>
      useAppStore.setState({
        coordinates: [
          [0, 0],
          [0, 10],
          [40, 5],
          [40, 0],
        ],
        lineLoads: [{ id: "l1", x: 20, magnitude: 50 }],
      }),
    );
    render(<ResultSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Use model bounds" }));
    const state = useAppStore.getState();
    const lock = rvs().viewLock!;
    expect(lock).toEqual(modelViewLock(paperContentOf(state), state.resultViewSettings));
    const plain = modelViewLock({ coordinates: state.coordinates }, state.resultViewSettings);
    expect(lock.topRight[1]).toBeGreaterThan(plain.topRight[1]);
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
        // The result's centre and FOS label are not shown here.
        resultViewSettings: { ...useAppStore.getState().resultViewSettings, showFosLabel: false, showCentreMarker: false },
      }),
    );
    render(<ResultSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Use model bounds" }));
    const lock = rvs().viewLock!;
    const ar = getPlotAspectRatio("A4", true);
    expect(viewLockContains(lock, [[0, 0], [0, 30], [10, 30], [10, 0]])).toBe(true);
    // Centred horizontally, with the plot's aspect ratio.
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

    const spacing = field("Tick spacing (m)");
    fireEvent.change(spacing, { target: { value: "5" } });
    fireEvent.blur(spacing);
    expect(rvs().gridSpacing).toBe(5);

    // The grid: on/off, and a spacing of its own while on.
    const grid = screen.getByRole("checkbox", { name: "Grid lines" }) as HTMLInputElement;
    if (!grid.checked) fireEvent.click(grid);
    const gridSpacing = field("Grid spacing (m)");
    fireEvent.change(gridSpacing, { target: { value: "2" } });
    fireEvent.blur(gridSpacing);
    expect(rvs().gridLineSpacing).toBe(2);
    fireEvent.click(grid);
    expect(rvs().showGrid).toBe(false);
    expect(screen.queryByText("Grid spacing")).toBeNull();

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
    expect(screen.getByText("Top left", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Anchor" })).getByRole("button", { name: "Bottom right" }));
    expect(anno("p")).toMatchObject({ anchor: "bottom-right", x: 0.5, y: 0.6 });
    expect(screen.getByRole("button", { name: "Bottom right" })).toHaveAttribute("aria-pressed", "true");
  });

  it("moves the anchor point so the annotation box stays in place", () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => createRecordingContext(1200, 800).ctx as never);
    select(["p"]);
    render(<ResultSidebar />);
    fireEvent.click(screen.getByTitle("Bottom right"));
    const p = anno("p");
    expect(p.anchor).toBe("bottom-right");
    // Bottom-right of a box whose top-left stays at (0.5, 0.6), plot ≈ 24 % × 18 %.
    expect(p.x).toBeGreaterThan(0.7);
    expect(p.x).toBeLessThan(0.76);
    expect(p.y).toBeGreaterThan(0.75);
    expect(p.y).toBeLessThan(0.8);
    // Same anchor again: position unchanged.
    fireEvent.click(screen.getByTitle("Bottom right"));
    expect(anno("p")).toEqual(p);
    spy.mockRestore();
  });

  it("edits the text, font, size, style and colour of text annotations", () => {
    select(["t1", "t2"]);
    render(<ResultSidebar />);
    expect(field("Text").placeholder).toBe("Mixed values");
    expect(field("Size (px)").value).toBe("__mixed__");
    fireEvent.change(field("Text"), { target: { value: "Same" } });
    expect([anno("t1").text, anno("t2").text]).toEqual(["Same", "Same"]);
    fireEvent.change(field("Size (px)"), { target: { value: "16" } });
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
    expect(field("Text size (px)").value).toBe("6");
    fireEvent.change(field("Text size (px)"), { target: { value: "10" } });
    expect(anno("m").fontSize).toBe(10);
  });

  it("sets the range of the colour bar: fixed bounds start from the shown range, and must be in order", () => {
    select(["c"]);
    render(<ResultSidebar />);
    expect(field("Range").value).toBe("auto");
    // The automatic range of the result (min FOS 1.234, max FOS 2).
    expect(screen.getByText("F 1.23 to 2.00")).toBeInTheDocument();

    fireEvent.change(field("Range"), { target: { value: "fixed" } });
    expect(anno("c")).toMatchObject({ scaleMode: "fixed", scaleMin: 1.23, scaleMax: 2 });
    expect(field("Min F").value).toBe("1.23");
    expect(field("Max F").value).toBe("2");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(field("Max F"), { target: { value: "1,1" } });
    expect(anno("c").scaleMax).toBe(1.1);
    expect(screen.getByRole("alert").textContent).toMatch(/Min F must be below max F/);
    fireEvent.change(field("Min F"), { target: { value: "0.5" } });
    expect(anno("c").scaleMin).toBe(0.5);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(field("Range"), { target: { value: "filter" } });
    expect(anno("c").scaleMode).toBe("filter");
    // The bounds stay for a return to "Fixed".
    expect(anno("c")).toMatchObject({ scaleMin: 0.5, scaleMax: 1.1 });
    expect(screen.getByText(/F 1.23 to 1.50, the span of Surfaces/)).toBeInTheDocument();
    act(() => useAppStore.getState().setResultViewSettings({ fosFilterMax: 1 }));
    expect(screen.getByText(/is not above the minimum F; the automatic range is used/)).toBeInTheDocument();
  });

  it("sets the colour scheme of the colour bar, with custom colours and an optional middle one", () => {
    select(["c"]);
    render(<ResultSidebar />);
    expect(field("Color scheme").value).toBe("classic");
    // jsdom stores the gradient's colours as rgb().
    const preview = () => screen.getByRole("img", { name: /Scheme preview/ }).style.background;
    expect(preview()).toMatch(/^linear-gradient\(to right, rgb\(255, 0, 0\), /);

    fireEvent.change(field("Color scheme"), { target: { value: "greyscale" } });
    expect(anno("c").scheme).toBe("greyscale");
    expect(preview()).toMatch(/rgb\(200, 200, 200\)\)$/);

    fireEvent.change(field("Color scheme"), { target: { value: "custom" } });
    expect(anno("c")).toMatchObject({ scheme: "custom", schemeFrom: "#cc0000", schemeTo: "#0066cc" });
    fireEvent.change(screen.getByLabelText("From (low F) color"), { target: { value: "#112233" } });
    fireEvent.change(screen.getByLabelText("To (high F) color"), { target: { value: "#445566" } });
    expect(anno("c")).toMatchObject({ schemeFrom: "#112233", schemeTo: "#445566" });
    expect(preview()).toMatch(/^linear-gradient\(to right, rgb\(17, 34, 51\), .*rgb\(68, 85, 102\)\)$/);

    fireEvent.click(screen.getByLabelText("Add a middle color"));
    expect(anno("c").schemeMid).toMatch(/^#[0-9a-f]{6}$/);
    fireEvent.change(screen.getByLabelText("Middle color"), { target: { value: "#ffffff" } });
    expect(anno("c").schemeMid).toBe("#ffffff");
    expect(preview()).toContain("rgb(255, 255, 255)");
    fireEvent.click(screen.getByLabelText("Add a middle color"));
    expect(anno("c").schemeMid).toBeUndefined();
  });

  it("removes and adds material table columns for the selected tables", () => {
    // jsdom has no scrolling.
    Element.prototype.scrollIntoView = vi.fn();
    select(["m"]);
    render(<ResultSidebar />);
    fireEvent.click(screen.getByLabelText("Remove Cohesion / Su"));
    expect(anno("m").tableColumns).not.toContain("cohesion");
    expect(anno("m").tableColumns).toContain("unitWeight");
    fireEvent.click(screen.getByLabelText("Toggle options"));
    fireEvent.click(screen.getByRole("option", { name: "Cohesion / Su" }));
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

describe("ResultSidebar Insert variable", () => {
  it("inserts a tag into the selected text annotation at the caret", () => {
    act(() => useAppStore.setState({ result: result({
      sgi3d: {
        factorOfSafety: 1.5,
        f2dCritical: 1.234,
        critical: { ...surface(1.234), f2d: 1.234, fp: 2, f3d: 1.5, drivingMoment: 1, endFaceArea: 1, endFaceMoment: 1 },
        equation: "2-3",
        options: { length: 10, overstrongF2D: null, excludeMaterials: [] },
        warnings: [],
      },
    } as never) }));
    select(["t1"]);
    render(<ResultSidebar />);
    const ta = field("Text");
    act(() => {
      ta.focus();
      ta.setSelectionRange(5, 5);
    });
    fireEvent.click(screen.getByRole("button", { name: /Insert variable/ }));
    const item = screen.getAllByRole("menuitem").find((el) => el.textContent?.startsWith("#FOS3D"))!;
    expect(item).toHaveTextContent("(1.500)");
    fireEvent.click(item);
    expect(anno("t1").text).toBe("Title#FOS3D");
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(11);
    expect(screen.getByLabelText("Text on the sheet")).toHaveTextContent("Title1.500");
  });

  it("is disabled while the selected texts differ", () => {
    select(["t1", "t2"]);
    render(<ResultSidebar />);
    expect(screen.getByRole("button", { name: /Insert variable/ })).toBeDisabled();
  });
});

describe("ResultSidebar reference lines", () => {
  // Ids apart from the paper annotations' ("c" is the colour bar).
  const LINE: Annotation = {
    id: "rl",
    type: "reference",
    shape: "polyline",
    points: [
      [2, 10],
      [12, 4],
    ],
    label: "other program",
  };
  const CIRCLE: Annotation = { id: "rc", type: "reference", shape: "circle", cx: 15, cy: 14, radius: 10 };
  const ref = (id: string) =>
    anno(id) as unknown as {
      label?: string;
      color?: string;
      dash?: string;
      width?: number;
      showInEdit?: boolean;
      points: [number, number][];
      cx: number;
      cy: number;
      radius: number;
      clip?: string;
    };

  beforeEach(() => {
    useAppStore.setState({ resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [...ANNOS, LINE, CIRCLE] } });
  });

  it("lists reference lines by their label or shape", () => {
    render(<ResultSidebar />);
    expect(screen.getByText("Reference: other program")).toBeInTheDocument();
    expect(screen.getByText("Reference circle")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Reference: other program"));
    expect(useAppStore.getState().selectedAnnotationIds).toEqual(["rl"]);
  });

  it("edits a polyline's label, points, colour, dash, width and edit-view visibility", () => {
    select(["rl"]);
    render(<ResultSidebar />);
    // No paper position for a reference line.
    expect(screen.queryByText("X (%)")).toBeNull();
    fireEvent.change(field("Label"), { target: { value: "F = 0.664 (other program)" } });
    expect(ref("rl").label).toBe("F = 0.664 (other program)");
    const points = screen.getByLabelText("Reference polyline points") as HTMLTextAreaElement;
    expect(points.value).toBe("2, 10; 12, 4");
    fireEvent.change(points, { target: { value: "1, 9; 11, 3; 21, 4" } });
    expect(ref("rl").points).toEqual([
      [1, 9],
      [11, 3],
      [21, 4],
    ]);
    // A single pair is still being typed: the points stay, the field is flagged.
    fireEvent.change(points, { target: { value: "1, 9" } });
    expect(ref("rl").points).toHaveLength(3);
    expect(points.getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Color #cc0000" }));
    expect(ref("rl").color).toBe("#cc0000");
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(ref("rl").color).toBeUndefined();
    fireEvent.change(field("Line"), { target: { value: "dotted" } });
    expect(ref("rl").dash).toBe("dotted");
    fireEvent.change(field("Width (px)"), { target: { value: "2.5" } });
    expect(ref("rl").width).toBe(2.5);
    fireEvent.click(screen.getByLabelText("Show in edit view"));
    expect(ref("rl").showInEdit).toBe(true);
  });

  it("edits a circle's centre, radius and clip; several lines share the common fields", () => {
    select(["rc"]);
    render(<ResultSidebar />);
    fireEvent.change(screen.getByLabelText("Reference circle center X"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Reference circle center Y"), { target: { value: "13" } });
    fireEvent.change(screen.getByLabelText("Reference circle radius"), { target: { value: "12" } });
    expect(ref("rc")).toMatchObject({ cx: 16, cy: 13, radius: 12 });
    // Below the smallest radius: kept.
    fireEvent.change(screen.getByLabelText("Reference circle radius"), { target: { value: "0" } });
    expect(ref("rc").radius).toBe(12);
    fireEvent.change(field("Drawn"), { target: { value: "none" } });
    expect(ref("rc").clip).toBe("none");

    cleanup();
    select(["rl", "rc"]);
    render(<ResultSidebar />);
    expect(screen.queryByLabelText("Reference polyline points")).toBeNull();
    expect(screen.getByText("Select one reference line to edit its points.")).toBeInTheDocument();
    expect(field("Label").placeholder).toBe("Mixed values");
    fireEvent.change(field("Line"), { target: { value: "dashed" } });
    expect([ref("rl").dash, ref("rc").dash]).toEqual(["dashed", "dashed"]);
  });
});
