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

const frames = (n: number) =>
  act(() => new Promise<void>((r) => setTimeout(r, 20 * n)));

describe("dragging points on the edit canvas", () => {
  beforeEach(async () => {
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
        activeSection: "Exterior Boundary",
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
  });

  it("does not move or snap a point that is only clicked", async () => {
    const before = useAppStore.getState().coordinates[1];
    const [sx, sy] = toScreen(before);
    const canvas = screen.getByTestId("slope-canvas");
    fireEvent.pointerDown(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    await frames(4);
    fireEvent.pointerUp(canvas, { button: 0, clientX: sx, clientY: sy, pointerId: 1 });
    expect(useAppStore.getState().selectedPointIndex).toBe(1);
    expect(useAppStore.getState().coordinates[1]).toEqual(before);
  });

  it("still drags a point once the pointer moves", async () => {
    const before = useAppStore.getState().coordinates[1];
    const [sx, sy] = toScreen(before);
    const canvas = screen.getByTestId("slope-canvas");
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
        activeSection: "Interior Boundaries",
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
});
