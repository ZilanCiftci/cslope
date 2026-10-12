import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditCanvas } from "./EditCanvas";
import { useAppStore } from "../store/app-store";
import { DEFAULT_MATERIAL } from "../store/defaults";
import { createRecordingContext } from "../test/recording-context";

const W = 800;
const H = 600;
const SCALE = 20;

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];

function view() {
  const s = useAppStore.getState();
  return { scale: s.editViewScale, offset: s.editViewOffset };
}

function toScreen([x, y]: [number, number]): [number, number] {
  const { scale, offset } = view();
  return [W / 2 + (x + offset[0]) * scale, H / 2 - (y + offset[1]) * scale];
}

function toWorld(cx: number, cy: number): [number, number] {
  const { scale, offset } = view();
  return [(cx - W / 2) / scale - offset[0], -(cy - H / 2) / scale - offset[1]];
}

const toolbar = () => useAppStore.getState().canvasToolbar!;
const canvas = () => screen.getByTestId("slope-canvas");

function renderCanvas() {
  render(<EditCanvas />);
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: W,
    bottom: H,
    width: W,
    height: H,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => createRecordingContext(W, H).ctx as never,
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  useAppStore.getState().newProject();
  useAppStore.setState({
    mode: "edit",
    activeSection: "Exterior Boundary",
    coordinates: COORDS,
    coordinateExpressions: [],
    materials: [{ ...DEFAULT_MATERIAL }, { ...DEFAULT_MATERIAL, id: "sand", name: "Sand", color: "#eedd88" }],
    materialBoundaries: [],
    regionMaterials: [],
    udls: [],
    lineLoads: [],
    editViewScale: SCALE,
    editViewOffset: [-15, -5],
    snapToGrid: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("EditCanvas keyboard", () => {
  it("deletes the selected vertex with Delete, but not while typing or for a triangle", () => {
    renderCanvas();
    act(() => useAppStore.getState().setSelectedPoint(2));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(useAppStore.getState().coordinates).toHaveLength(6);
    input.remove();

    fireEvent.keyDown(document, { key: "Delete" });
    expect(useAppStore.getState().coordinates).toHaveLength(5);
    expect(useAppStore.getState().coordinates).not.toContainEqual([10, 10]);
    expect(useAppStore.getState().selectedPointIndex).toBeNull();

    act(() => {
      useAppStore.setState({ coordinates: COORDS.slice(0, 3) });
      useAppStore.getState().setSelectedPoint(0);
    });
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(useAppStore.getState().coordinates).toHaveLength(3);
  });

  it("does not delete a vertex that is not shown as selected (another section is edited)", () => {
    renderCanvas();
    act(() => useAppStore.getState().setSelectedPoint(2));
    act(() => useAppStore.setState({ activeSection: "Loads" }));
    fireEvent.keyDown(document, { key: "Delete" });
    expect(useAppStore.getState().coordinates).toHaveLength(6);
  });

  it("cancels material assignment with Escape or the banner button", () => {
    renderCanvas();
    act(() => useAppStore.getState().setAssigningMaterial("sand"));
    expect(screen.getByText("Sand", { selector: "strong" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useAppStore.getState().assigningMaterialId).toBeNull();
    act(() => useAppStore.getState().setAssigningMaterial("sand"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useAppStore.getState().assigningMaterialId).toBeNull();
  });
});

describe("EditCanvas toolbar", () => {
  it("zooms in and out about the canvas centre", () => {
    renderCanvas();
    const centre = toWorld(W / 2, H / 2);
    act(() => toolbar().onZoomIn());
    expect(view().scale).toBeCloseTo(SCALE * 1.1, 9);
    expect(toWorld(W / 2, H / 2)[0]).toBeCloseTo(centre[0], 9);
    act(() => toolbar().onZoomOut());
    expect(view().scale).toBeCloseTo(SCALE * 1.1 * 0.9, 9);
  });

  it("fits the model into the view", () => {
    useAppStore.setState({ editViewScale: 3, editViewOffset: [50, 50] });
    renderCanvas();
    act(() => toolbar().onFitToScreen());
    // The whole model lies inside the canvas, centred horizontally.
    for (const c of COORDS) {
      const [sx, sy] = toScreen(c);
      expect(sx).toBeGreaterThan(0);
      expect(sx).toBeLessThan(W);
      expect(sy).toBeGreaterThan(0);
      expect(sy).toBeLessThan(H);
    }
    expect((toScreen([0, 0])[0] + toScreen([30, 0])[0]) / 2).toBeCloseTo(W / 2, 6);
  });

  it("shows the zoom relative to fit-width and sets a zoom percentage", () => {
    renderCanvas();
    act(() => toolbar().onSetZoomPercent(100));
    const fitWidth = view().scale;
    expect(toolbar().zoomPercent).toBe(100);
    act(() => toolbar().onSetZoomPercent(250));
    expect(view().scale).toBeCloseTo(fitWidth * 2.5, 9);
    expect(toolbar().zoomPercent).toBe(250);
  });

  it("zooms to a dragged box", () => {
    // jsdom has no layout: give the container its size.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(W);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(H);
    renderCanvas();
    act(() => toolbar().onToggleZoomBox());
    expect(toolbar().zoomBoxActive).toBe(true);
    const [x0, y0] = toScreen([10, 10]);
    const [x1, y1] = toScreen([20, 5]);
    fireEvent.pointerDown(canvas(), { button: 0, clientX: x0, clientY: y0, pointerId: 1 });
    fireEvent.pointerMove(canvas(), { clientX: x1, clientY: y1, pointerId: 1 });
    fireEvent.pointerUp(canvas(), { button: 0, clientX: x1, clientY: y1, pointerId: 1 });
    // A 10 × 5 m box in an 800 × 600 view: 80 px/m (width-limited), centred on (15, 7.5).
    expect(view().scale).toBeCloseTo(80, 6);
    expect(view().offset[0]).toBeCloseTo(-15, 6);
    expect(view().offset[1]).toBeCloseTo(-7.5, 6);
    expect(toolbar().zoomBoxActive).toBe(false);
  });

  it("ignores a tiny zoom box", () => {
    renderCanvas();
    act(() => toolbar().onToggleZoomBox());
    fireEvent.pointerDown(canvas(), { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(canvas(), { button: 0, clientX: 104, clientY: 103, pointerId: 1 });
    expect(view().scale).toBe(SCALE);
    expect(toolbar().zoomBoxActive).toBe(false);
  });

  it("toggles pan mode, which pans on drag", () => {
    renderCanvas();
    act(() => toolbar().onTogglePan());
    expect(toolbar().panActive).toBe(true);
    fireEvent.pointerDown(canvas(), { button: 0, clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(canvas(), { clientX: 240, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(canvas(), { button: 0, clientX: 240, clientY: 200, pointerId: 1 });
    expect(view().offset[0]).toBeCloseTo(-15 + 2, 9);
  });

  it("fits once after a project is loaded", () => {
    useAppStore.setState({ editViewScale: 3, editViewOffset: [50, 50] });
    renderCanvas();
    act(() => {
      useAppStore.setState({ _pendingFitToScreen: true });
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(useAppStore.getState()._pendingFitToScreen).toBe(false);
    expect(view().scale).toBeGreaterThan(10);
  });
});

describe("EditCanvas pointer interaction", () => {
  it("shows the pointer position in world coordinates", () => {
    renderCanvas();
    const [sx, sy] = toScreen([12.5, 3.25]);
    fireEvent.pointerMove(canvas(), { clientX: sx, clientY: sy, pointerId: 1 });
    expect(screen.getByText(/x: 12\.5/)).toHaveTextContent("y: 3.3");
  });

  it("deletes a vertex from its context menu", () => {
    renderCanvas();
    const [sx, sy] = toScreen([20, 5]);
    fireEvent.contextMenu(canvas(), { clientX: sx, clientY: sy });
    fireEvent.click(screen.getByRole("button", { name: "Delete Point" }));
    expect(useAppStore.getState().coordinates).not.toContainEqual([20, 5]);
    expect(screen.queryByRole("button", { name: "Delete Point" })).toBeNull();
  });

  it("adds a vertex on an edge from its context menu", () => {
    renderCanvas();
    const [sx, sy] = toScreen([15, 0]);
    fireEvent.contextMenu(canvas(), { clientX: sx, clientY: sy });
    fireEvent.click(screen.getByRole("button", { name: "Add Point" }));
    const coords = useAppStore.getState().coordinates;
    expect(coords).toHaveLength(7);
    expect(coords[6][0]).toBeCloseTo(15, 6);
    expect(coords[6][1]).toBeCloseTo(0, 6);
  });

  it("assigns a material from the picker while editing assignments", () => {
    act(() => useAppStore.setState({ activeSection: "Material Assignment" }));
    renderCanvas();
    const [sx, sy] = toScreen([5, 5]);
    fireEvent.pointerDown(canvas(), { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    expect(screen.getByText("Assign Material")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sand" }));
    const assigned = useAppStore.getState().regionMaterials;
    expect(assigned).toHaveLength(1);
    expect(assigned[0].materialId).toBe("sand");
    expect(assigned[0].point[0]).toBeCloseTo(5, 6);
    expect(screen.queryByText("Assign Material")).toBeNull();
  });
});
