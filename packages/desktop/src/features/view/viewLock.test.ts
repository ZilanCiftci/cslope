import { describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { PAPER_MARGIN_FRACTION, paperViewLock, viewLockContains, viewLockForModel } from "./viewLock";
import { waterLineFitPoints } from "./extents";
import type { ViewLock } from "../../store/types";

describe("view lock follows a growing model", () => {
  it("refits a lock that showed the whole model, keeps a deliberate zoom", () => {
    useAppStore.getState().newProject();
    const s = useAppStore.getState();
    const lock = viewLockForModel(s.coordinates, 1.4);
    s.setResultViewSettings({ viewLock: lock });
    const bigger = s.coordinates.map(([x, y]) => [x * 2, y * 2] as [number, number]);
    useAppStore.getState().setCoordinates(bigger);
    const after = useAppStore.getState().resultViewSettings.viewLock!;
    expect(viewLockContains(after, bigger)).toBe(true);

    // A lock on part of the model stays as the user set it.
    const zoom = { bottomLeft: [0, 0] as [number, number], topRight: [1, 1] as [number, number] };
    useAppStore.getState().setResultViewSettings({ viewLock: zoom });
    useAppStore.getState().setCoordinates(bigger.map(([x, y]) => [x + 1, y] as [number, number]));
    expect(useAppStore.getState().resultViewSettings.viewLock).toEqual(zoom);
  });
});

describe("viewLockForModel", () => {
  it("keeps a 1 m margin with the base on the bottom", () => {
    const lock = viewLockForModel([[0, 0], [20, 0], [20, 5], [0, 5]], 2);
    expect(lock).toEqual({ bottomLeft: [-1, -1], topRight: [21, 10] });
  });

  it("widens for a tall model", () => {
    const lock = viewLockForModel([[0, 0], [2, 0], [2, 20]], 2);
    expect(lock.topRight[1]).toBe(21);
    expect(lock.topRight[0] - lock.bottomLeft[0]).toBeCloseTo(44, 9);
  });
});

describe("waterLineFitPoints", () => {
  const model: [number, number][] = [[0, 0], [10, 0], [10, 5], [0, 5]];

  it("clips a long line to the model's x range", () => {
    expect(waterLineFitPoints([[-100, 4], [100, 6]], model)).toEqual([[0, 5], [10, 5.1]]);
  });

  it("drops a line wholly below the model", () => {
    expect(waterLineFitPoints([[0, -100], [10, -100]], model)).toEqual([]);
  });
});

describe("paperViewLock", () => {
  const aspect = 1.4;
  const flat: [number, number][] = [[0, 0], [10, 0], [10, 3], [0, 3]];
  const height = (l: ViewLock) => l.topRight[1] - l.bottomLeft[1];
  const width = (l: ViewLock) => l.topRight[0] - l.bottomLeft[0];

  it("keeps a margin around a small model, at the plot's aspect", () => {
    const lock = paperViewLock({ coordinates: flat }, aspect)!;
    expect(lock.bottomLeft[0]).toBeCloseTo(-10 * PAPER_MARGIN_FRACTION, 9);
    expect(lock.topRight[0]).toBeCloseTo(10 + 10 * PAPER_MARGIN_FRACTION, 9);
    expect(width(lock) / height(lock)).toBeCloseTo(aspect, 9);
  });

  it("centres a flat model vertically", () => {
    const lock = paperViewLock({ coordinates: flat }, aspect)!;
    expect((lock.bottomLeft[1] + lock.topRight[1]) / 2).toBeCloseTo(1.5, 9);
  });

  it("keeps a top band free and centres the model below it", () => {
    const lock = paperViewLock({ coordinates: flat }, aspect, { topBand: 0.2 })!;
    const free = height(lock) * 0.8;
    expect(lock.bottomLeft[1] + free / 2).toBeCloseTo(1.5, 9);
  });

  it("takes in a water line above the model, clipped to its x range", () => {
    const lock = paperViewLock({ coordinates: flat, waterLines: [[[-100, 32], [100, 32]]] }, aspect)!;
    expect(lock.topRight[1]).toBeGreaterThan(32);
    // Widened for the height, centred on the model, not on the line.
    expect((lock.bottomLeft[0] + lock.topRight[0]) / 2).toBeCloseTo(5, 9);
  });

  it("leaves out a dry water line below the model", () => {
    const plain = paperViewLock({ coordinates: flat }, aspect)!;
    const dry = paperViewLock({ coordinates: flat, waterLines: [[[0, -100], [10, -100]]] }, aspect)!;
    expect(dry).toEqual(plain);
  });

  it("takes in the load arrows and labels above the ground", () => {
    const plain = paperViewLock({ coordinates: flat }, aspect)!;
    const loaded = paperViewLock(
      { coordinates: flat, udls: [{ x1: 6, x2: 10, magnitude: 20 }], lineLoads: [{ x: 0, magnitude: 50 }] },
      aspect,
    )!;
    expect(loaded.topRight[1]).toBeGreaterThan(plain.topRight[1]);
    // The line load's label at the left edge stays on the paper.
    expect(loaded.bottomLeft[0]).toBeLessThan(plain.bottomLeft[0]);
  });

  it("takes in reinforcement past the model", () => {
    const lock = paperViewLock({ coordinates: flat, reinforcements: [{ x1: 0, y1: 2, x2: 14, y2: 1 }] }, aspect)!;
    expect(lock.topRight[0]).toBeGreaterThan(14);
  });
});
