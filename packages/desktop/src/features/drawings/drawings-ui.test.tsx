/**
 * The drawings in the app around the canvas: the Drawings panel's actions,
 * the commands of the Place drawing window carried out in the main window,
 * and the canvas hit test (a locked drawing lets clicks through).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "../../store/app-store";
import type { BackgroundImage } from "../../store/types";
import { DrawingsPanel } from "./DrawingsPanel";
import { drawingWindowState, handleDrawingCommand, openPlaceDrawing } from "./window-sync";
import { adoptProjectAssets, openedProjectAssets } from "./asset-registry";
import { findBackgroundsAt, findCanvasObjectsAt } from "../canvas/object-hits";
import { performUndo } from "../../store/selectors";

const s = () => useAppStore.getState();

const placement = (id: string, over: Partial<BackgroundImage> = {}): BackgroundImage => ({
  id,
  assetId: "sheet",
  name: `Section ${id}`,
  page: 1,
  crop: { x0: 0, y0: 0, x1: 100, y1: 50 },
  calibration: { mode: "points", points: [] },
  // 0.1 m per unit: the crop covers x 0..10, y 0..5 (y flipped)
  transform: { a: 0.1, b: 0, c: 0, d: -0.1, e: 0, f: 5 },
  opacity: 0.5,
  visible: true,
  order: 0,
  ...over,
});

beforeEach(() => {
  s().newProject();
  useAppStore.temporal.getState().clear();
  adoptProjectAssets([{ id: "sheet", mime: "application/pdf", originalName: "sheet.pdf", addedAt: "", data: () => new Uint8Array([37]) }]);
});

describe("Drawings panel", () => {
  it("lists the model's drawings and acts on them, each an undo step", () => {
    act(() => {
      s().addBackground(placement("A"));
      s().addBackground(placement("B"));
    });
    render(<DrawingsPanel />);
    // topmost first
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Section B", "Section A"]);

    fireEvent.click(screen.getByRole("button", { name: "Hide Section A" }));
    expect(s().backgrounds.find((b) => b.id === "A")?.visible).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show Section A" }));
    expect(s().backgrounds.find((b) => b.id === "A")?.visible).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Unlock Section A" }));
    expect(s().locks.backgrounds).toEqual(["B"]);

    fireEvent.change(screen.getByLabelText("Opacity of Section A"), { target: { value: "80" } });
    expect(s().backgrounds.find((b) => b.id === "A")?.opacity).toBe(0.8);

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(s().backgrounds.find((b) => b.id === "A")?.showInResults).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Move Section A up" }));
    expect([...s().backgrounds].sort((a, b) => a.order - b.order).map((b) => b.id)).toEqual(["B", "A"]);

    fireEvent.doubleClick(screen.getByTitle("Section A (double-click to rename)"));
    const input = screen.getByLabelText("Drawing name");
    fireEvent.change(input, { target: { value: "Section A-A" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(s().backgrounds.find((b) => b.id === "A")?.name).toBe("Section A-A");

    const steps = useAppStore.temporal.getState().pastStates.length;
    fireEvent.click(screen.getByRole("button", { name: "Remove Section A-A from the model" }));
    expect(s().backgrounds.map((b) => b.id)).toEqual(["B"]);
    expect(useAppStore.temporal.getState().pastStates.length).toBe(steps + 1);
    act(() => performUndo());
    expect(s().backgrounds.map((b) => b.id).sort()).toEqual(["A", "B"]);
  });

  it("one opacity drag is one undo step", () => {
    act(() => s().addBackground(placement("A")));
    render(<DrawingsPanel />);
    const slider = screen.getByLabelText("Opacity of Section A");
    const before = useAppStore.temporal.getState().pastStates.length;
    fireEvent.pointerDown(slider);
    for (const v of ["55", "60", "65", "70"]) fireEvent.change(slider, { target: { value: v } });
    fireEvent.pointerUp(slider);
    expect(s().backgrounds[0].opacity).toBe(0.7);
    expect(useAppStore.temporal.getState().pastStates.length).toBe(before + 1);
    act(() => performUndo());
    expect(s().backgrounds[0].opacity).toBe(0.5);
  });

  it("is not shown while the model has no drawings", () => {
    render(<DrawingsPanel />);
    expect(screen.queryByTestId("drawings-panel")).toBeNull();
  });
});

describe("the Place drawing window's commands", () => {
  it("places, then replaces (recalibrates) a placement in the active model", async () => {
    await handleDrawingCommand({ type: "place", placement: placement("A") }, () => {});
    expect(s().backgrounds.map((b) => b.id)).toEqual(["A"]);
    expect(s().locks.backgrounds).toEqual(["A"]);
    await handleDrawingCommand({ type: "place", placement: placement("A", { transform: { a: 0.2, b: 0, c: 0, d: -0.2, e: 1, f: 2 }, opacity: 0.9 }) }, () => {});
    expect(s().backgrounds).toHaveLength(1);
    expect(s().backgrounds[0].transform.a).toBe(0.2);
  });

  it("adds a file once (by its hash) and sends a file's bytes when asked", async () => {
    const data = new Uint8Array([1, 2, 3]);
    await handleDrawingCommand({ type: "addAsset", id: "new", name: "b.png", mime: "image/png", sha256: "f".repeat(64), data }, () => {});
    await handleDrawingCommand({ type: "addAsset", id: "again", name: "b copy.png", mime: "image/png", sha256: "f".repeat(64), data }, () => {});
    await handleDrawingCommand({ type: "addAsset", id: "text", name: "a.txt", mime: "text/plain", sha256: "e".repeat(64), data }, () => {});
    // an id that is no file name, or one taken, is refused
    await handleDrawingCommand({ type: "addAsset", id: "../x", name: "c.png", mime: "image/png", sha256: "d".repeat(64), data: new Uint8Array([4]) }, () => {});
    await handleDrawingCommand({ type: "addAsset", id: "new", name: "c.png", mime: "image/png", sha256: "d".repeat(64), data: new Uint8Array([5]) }, () => {});
    expect(openedProjectAssets().map((a) => a.id)).toEqual(["sheet", "new"]);
    // the hash is the main window's own, not the one sent
    expect(openedProjectAssets()[1].sha256).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    const send = vi.fn();
    await handleDrawingCommand({ type: "requestAsset", id: "new" }, send);
    expect(send).toHaveBeenCalledWith({ id: "new", mime: "image/png", data });
    await handleDrawingCommand({ type: "requestAsset", id: "none" }, send);
    expect(send).toHaveBeenLastCalledWith({ id: "none", error: expect.any(String) });
  });

  it("tells the window the model, the files and where they are placed, and what to recalibrate", () => {
    act(() => s().addBackground(placement("A")));
    openPlaceDrawing("A");
    const state = drawingWindowState();
    expect(state.modelId).toBe(s().activeModelId);
    expect(state.outline.exterior).toEqual(s().coordinates);
    expect(state.assets).toEqual([expect.objectContaining({ id: "sheet", usedBy: [state.modelName] })]);
    expect(state.placements.map((p) => p.placement.id)).toEqual(["A"]);
    expect(state.edit).toMatchObject({ placementId: "A" });
    openPlaceDrawing();
    expect(drawingWindowState().edit).toBeNull();
  });
});

describe("drawings on the canvas", () => {
  // 10 px per m, y up from the canvas origin
  const toPx = (x: number, y: number): [number, number] => [100 + 10 * x, 500 - 10 * y];

  it("a locked drawing lets clicks through; an unlocked one is found last, where nothing else is", () => {
    act(() => s().addBackground(placement("A", { transform: { a: 0.1, b: 0, c: 0, d: -0.1, e: 60, f: 5 } })));
    // inside the drawing (x 60..70, y 0..5), away from the model
    const [mx, my] = toPx(65, 2);
    expect(findCanvasObjectsAt(s(), mx, my, toPx, () => null)).toEqual([]);
    expect(findBackgroundsAt(s(), mx, my, toPx, true)).toEqual(["A"]);
    act(() => s().setObjectLocked({ type: "background", id: "A" }, false));
    expect(findCanvasObjectsAt(s(), mx, my, toPx, () => null)).toEqual([{ object: { type: "background", id: "A" }, point: null }]);
    const [ox, oy] = toPx(75, 2);
    expect(findBackgroundsAt(s(), ox, oy, toPx, true)).toEqual([]);
    act(() => s().updateBackground("A", { visible: false }));
    expect(findBackgroundsAt(s(), mx, my, toPx, true)).toEqual([]);
  });

  it("the model's objects come before a drawing under them", () => {
    act(() => {
      s().addBackground(placement("A", { transform: { a: 1, b: 0, c: 0, d: -1, e: -10, f: 30 }, crop: { x0: 0, y0: 0, x1: 80, y1: 60 } }));
      s().setObjectLocked({ type: "background", id: "A" }, false);
    });
    const [x, y] = s().coordinates[1];
    const [mx, my] = toPx(x, y);
    const hits = findCanvasObjectsAt(s(), mx, my, toPx, () => null);
    expect(hits[0].object.type).toBe("exterior");
    expect(hits[hits.length - 1].object).toEqual({ type: "background", id: "A" });
  });
});
