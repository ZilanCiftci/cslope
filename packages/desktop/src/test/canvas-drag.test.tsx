import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { useAppStore } from "../store/app-store";

const W = 800;
const H = 600;
const SCALE = 10;

function toScreen([x, y]: [number, number]): [number, number] {
  const { editViewOffset } = useAppStore.getState();
  return [W / 2 + (x + editViewOffset[0]) * SCALE, H / 2 - (y + editViewOffset[1]) * SCALE];
}

// Fake timers: a drag runs a requestAnimationFrame loop, and waiting for it
// on real timers inside act() hung under load.
const frames = async (n: number) =>
  act(() => {
    vi.advanceTimersByTime(20 * n);
  });

describe("dragging points on the edit canvas", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] });
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
    // Full 2D context stand-in: every method is a no-op.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        new Proxy(
          { canvas: { width: W, height: H } },
          {
            get: (t, k) =>
              k in t
                ? (t as Record<string | symbol, unknown>)[k]
                : k === "measureText"
                  ? () => ({ width: 0 })
                  : () => {},
            set: () => true,
          },
        ) as unknown as CanvasRenderingContext2D,
    );
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    useAppStore.getState().newProject();
    render(<App />);
    await frames(2);
    act(() => {
      useAppStore.setState({
        mode: "edit",
        editViewScale: SCALE,
        editViewOffset: [0, 0],
        snapToGrid: true,
        gridSnapSize: 1,
      });
      const coords = [...useAppStore.getState().coordinates];
      coords[1] = [coords[1][0] + 0.37, coords[1][1] + 0.12];
      useAppStore.getState().setCoordinate(1, coords[1]);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("selects the exterior by a click and its point by a second one, moving and snapping nothing", async () => {
    const before = useAppStore.getState().coordinates[1];
    const [sx, sy] = toScreen(before);
    const canvas = screen.getByTestId("slope-canvas");
    fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    await frames(4);
    fireEvent.pointerUp(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    expect(useAppStore.getState().canvasSelection).toEqual({ object: { type: "exterior" }, point: null });
    fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    await frames(4);
    fireEvent.pointerUp(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    expect(useAppStore.getState().selectedPointIndex).toBe(1);
    expect(useAppStore.getState().coordinates[1]).toEqual(before);
    expect(useAppStore.temporal.getState().pastStates.length).toBe(1);
  });

  it("does not drag a point of an object that is not selected", async () => {
    const before = useAppStore.getState().coordinates[1];
    const [sx, sy] = toScreen(before);
    const canvas = screen.getByTestId("slope-canvas");
    fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: sx + 30, clientY: sy, pointerId: 1 });
    await frames(2);
    fireEvent.pointerUp(canvas, { button: 0, clientX: sx + 30, clientY: sy, pointerId: 1 });
    expect(useAppStore.getState().coordinates[1]).toEqual(before);
    expect(useAppStore.getState().canvasSelection).toBeNull();
  });

  it("still drags a point of the selected object once the pointer moves", async () => {
    const before = useAppStore.getState().coordinates[1];
    const [sx, sy] = toScreen(before);
    const canvas = screen.getByTestId("slope-canvas");
    act(() => useAppStore.getState().selectCanvasObject({ type: "exterior" }));
    fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: sx + 30, clientY: sy, pointerId: 1 });
    await frames(2);
    fireEvent.pointerUp(canvas, { button: 0, clientX: sx + 30, clientY: sy, pointerId: 1 });
    const after = useAppStore.getState().coordinates[1];
    expect(after[0]).toBeCloseTo(Math.round(before[0] + 3), 6);
  });

  it("drags the start vertex of a closed boundary", async () => {
    act(() => {
      useAppStore.setState({
        snapToGrid: false,
        materialBoundaries: [
          {
            id: "lens",
            coordinates: [
              [2, -4],
              [6, -4],
              [6, -2],
              [2, -2],
              [2, -4],
            ],
            coordinateExpressions: [],
          },
        ],
      });
    });
    const [sx, sy] = toScreen([2, -4]);
    const canvas = screen.getByTestId("slope-canvas");
    act(() => useAppStore.getState().selectCanvasObject({ type: "boundary", id: "lens" }));
    fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    for (let i = 1; i <= 5; i++) {
      fireEvent.pointerMove(canvas, { clientX: sx - 4 * i, clientY: sy, pointerId: 1 });
      await frames(1);
    }
    fireEvent.pointerUp(canvas, { button: 0, clientX: sx - 20, clientY: sy, pointerId: 1 });
    const c = useAppStore.getState().materialBoundaries[0].coordinates;
    expect(c[0][0]).toBeCloseTo(0, 6);
    expect(c[c.length - 1]).toEqual(c[0]);
  });

  it("drags an exterior vertex together with a boundary point on it", async () => {
    const vertex = useAppStore.getState().coordinates[2];
    act(() => {
      useAppStore.setState({
        snapToGrid: false,
        materialBoundaries: [
          {
            id: "layer",
            coordinates: [vertex, [vertex[0] + 5, vertex[1] - 5]],
            coordinateExpressions: [],
          },
        ],
      });
    });
    const [sx, sy] = toScreen(vertex);
    const canvas = screen.getByTestId("slope-canvas");
    act(() => useAppStore.getState().selectCanvasObject({ type: "exterior" }));
    fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    for (let i = 1; i <= 5; i++) {
      fireEvent.pointerMove(canvas, { clientX: sx, clientY: sy - 4 * i, pointerId: 1 });
      await frames(1);
    }
    fireEvent.pointerUp(canvas, { button: 0, clientX: sx, clientY: sy - 20, pointerId: 1 });
    const s = useAppStore.getState();
    expect(s.coordinates[2][1]).toBeCloseTo(vertex[1] + 2, 6);
    expect(s.materialBoundaries[0].coordinates[0]).toEqual(s.coordinates[2]);
  });

  it("zooms on Ctrl+wheel and suppresses the browser default", async () => {
    const canvas = screen.getByTestId("slope-canvas");
    const before = useAppStore.getState().editViewScale;
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
      clientX: W / 2,
      clientY: H / 2,
    });
    act(() => {
      canvas.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(useAppStore.getState().editViewScale).toBeGreaterThan(before);
  });

  describe("custom search planes", () => {
    const CIRCLE = { id: "c1", cx: 12, cy: 18, radius: 12 };
    const LINE = { id: "p1", cx: 0, cy: 0, radius: 0, points: [[2, 6], [12, 2], [22, 5]] as [number, number][] };
    const planes = () => useAppStore.getState().customSearchPlanes;

    beforeEach(() => {
      act(() => {
        useAppStore.setState({ snapToGrid: false, customSearchPlanes: [CIRCLE, LINE] });
        useAppStore.temporal.getState().clear();
      });
    });

    /** A click: selects what is under the pointer. */
    const clickAt = (canvas: HTMLElement, x: number, y: number) => {
      fireEvent.pointerDown(canvas, { button: 0, clientX: x, clientY: y, pointerId: 1 });
      fireEvent.pointerUp(canvas, { button: 0, clientX: x, clientY: y, pointerId: 1 });
    };

    it("drags a circle's centre once it is selected by a click, with a tip, and undoes it in one step", async () => {
      const [sx, sy] = toScreen([12, 18]);
      const canvas = screen.getByTestId("slope-canvas");
      clickAt(canvas, sx, sy);
      expect(useAppStore.getState().selectedCustomPlaneId).toBe("c1");
      fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: sx + 30, clientY: sy - 20, pointerId: 1 });
      await frames(2);
      expect(planes()[0]).toMatchObject({ cx: 15, cy: 20, radius: 12 });
      expect(screen.getByTestId("drag-tip")).toHaveTextContent(/cx 15\.00\s+cy 20\.00\s+R 12\.00 m/);
      fireEvent.pointerUp(canvas, { button: 0, clientX: sx + 30, clientY: sy - 20, pointerId: 1 });
      expect(screen.queryByTestId("drag-tip")).toBeNull();
      expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
      act(() => useAppStore.temporal.getState().undo());
      expect(planes()[0]).toEqual(CIRCLE);
    });

    it("drags the rim to set the radius from the pointer's distance", async () => {
      // On the rim right of the centre, dragged 25 px further out.
      const [sx, sy] = toScreen([24, 18]);
      const canvas = screen.getByTestId("slope-canvas");
      clickAt(canvas, sx, sy);
      fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: sx + 25, clientY: sy, pointerId: 1 });
      await frames(2);
      fireEvent.pointerUp(canvas, { button: 0, clientX: sx + 25, clientY: sy, pointerId: 1 });
      expect(planes()[0].radius).toBeCloseTo(14.5, 6);
      expect(planes()[0]).toMatchObject({ cx: 12, cy: 18 });
    });

    it("drags a vertex of a non-circular surface", async () => {
      const [sx, sy] = toScreen([12, 2]);
      const canvas = screen.getByTestId("slope-canvas");
      clickAt(canvas, sx, sy);
      fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: sx + 10, clientY: sy + 10, pointerId: 1 });
      await frames(2);
      fireEvent.pointerUp(canvas, { button: 0, clientX: sx + 10, clientY: sy + 10, pointerId: 1 });
      expect(planes()[1].points![1][0]).toBeCloseTo(13, 6);
      expect(planes()[1].points![1][1]).toBeCloseTo(1, 6);
    });

    it("adds a point on a segment and deletes a vertex from the context menu", async () => {
      const canvas = screen.getByTestId("slope-canvas");
      // On the segment (12, 2)–(22, 5), at x = 17 (y = 3.5).
      const [ex, ey] = toScreen([17, 3.5]);
      fireEvent.contextMenu(canvas, { clientX: ex, clientY: ey });
      fireEvent.click(screen.getByRole("menuitem", { name: "Add point" }));
      const pts = planes()[1].points!;
      expect(pts).toHaveLength(4);
      expect(pts[2][0]).toBeCloseTo(17, 6);
      expect(pts[2][1]).toBeCloseTo(3.5, 6);
      expect(screen.queryByRole("menuitem", { name: "Add point" })).toBeNull();
      const [vx, vy] = toScreen([2, 6]);
      fireEvent.contextMenu(canvas, { clientX: vx, clientY: vy });
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete point" }));
      expect(planes()[1].points).toHaveLength(3);
      expect(planes()[1].points![0]).toEqual([12, 2]);
      // A circle: its centre offers to delete it.
      const [cx, cy] = toScreen([12, 18]);
      fireEvent.contextMenu(canvas, { clientX: cx, clientY: cy });
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete circle" }));
      expect(planes().map((p) => p.id)).toEqual(["p1"]);
    });
  });
});
