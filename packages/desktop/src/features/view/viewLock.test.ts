import { describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import {
  modelViewLock,
  PAPER_MARGIN_FRACTION,
  paperTopBand,
  paperViewLock,
  REFERENCE_PAPER_WIDTH_PX,
  viewLockContains,
} from "./viewLock";
import { paperContentBounds, paperContentOf, waterLineFitPoints, type PaperContent } from "./extents";
import { getPlotAspectRatio } from "./paper";
import { DEFAULT_RESULT_VIEW_SETTINGS, PLOT_MARGINS } from "../../store/defaults";
import { createExampleResultViewSettings } from "../../store/benchmarks";
import type { ViewLock } from "../../store/types";

describe("view lock follows a growing model", () => {
  it("refits a lock that showed the whole model, keeps a deliberate zoom", () => {
    useAppStore.getState().newProject();
    const s = useAppStore.getState();
    s.setResultViewSettings({ viewLock: modelViewLock(paperContentOf(s), s.resultViewSettings) });
    const bigger = s.coordinates.map(([x, y]) => [x * 2, y * 2] as [number, number]);
    useAppStore.getState().setCoordinates(bigger);
    const state = useAppStore.getState();
    const after = state.resultViewSettings.viewLock!;
    expect(viewLockContains(after, bigger)).toBe(true);
    // The same frame as the model started with and "Use model bounds" gives.
    expect(after).toEqual(modelViewLock(paperContentOf(state), state.resultViewSettings));

    // A lock on part of the model stays as the user set it.
    const zoom = { bottomLeft: [0, 0] as [number, number], topRight: [1, 1] as [number, number] };
    useAppStore.getState().setResultViewSettings({ viewLock: zoom });
    useAppStore.getState().setCoordinates(bigger.map(([x, y]) => [x + 1, y] as [number, number]));
    expect(useAppStore.getState().resultViewSettings.viewLock).toEqual(zoom);
  });
});

describe("modelViewLock", () => {
  const paper = DEFAULT_RESULT_VIEW_SETTINGS;
  const aspect = getPlotAspectRatio(paper.paperFrame.paperSize, paper.paperFrame.landscape);
  const plotWidthPx = REFERENCE_PAPER_WIDTH_PX * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R);
  const width = (l: ViewLock) => l.topRight[0] - l.bottomLeft[0];
  const height = (l: ViewLock) => l.topRight[1] - l.bottomLeft[1];
  /** What the paper shows of the content, at the lock's scale. */
  const drawn = (content: PaperContent, lock: ViewLock) => paperContentBounds(content, width(lock) / plotWidthPx)!;

  it("frames an example as it starts", () => {
    const coordinates: [number, number][] = [[0, -15], [0, 0], [20, 0], [40, -10], [50, -10], [50, -15]];
    const initial = createExampleResultViewSettings(coordinates)!;
    expect(modelViewLock({ coordinates }, initial)).toEqual(initial.viewLock);
    const bare = createExampleResultViewSettings(coordinates, { annotations: false })!;
    expect(modelViewLock({ coordinates }, bare)).toEqual(bare.viewLock);
  });

  it("keeps the load on a tall wall on the paper, below the title block", () => {
    // A 2 m wide, 20 m tall wall with a line load on its crest.
    const content: PaperContent = {
      coordinates: [[0, 0], [0, 20], [2, 20], [2, 0]],
      lineLoads: [{ x: 1, magnitude: 100 }],
    };
    const lock = modelViewLock(content, paper);
    const b = drawn(content, lock);
    expect(b.yMax).toBeGreaterThan(20);
    const band = paperTopBand(paper.annotations);
    expect(band).toBeGreaterThan(0);
    expect(b.yMax).toBeLessThanOrEqual(lock.topRight[1] - band * height(lock) + 1e-9);
    expect(b.yMin).toBeGreaterThanOrEqual(lock.bottomLeft[1]);
    expect(b.xMin).toBeGreaterThanOrEqual(lock.bottomLeft[0]);
    expect(b.xMax).toBeLessThanOrEqual(lock.topRight[0]);
    expect(width(lock) / height(lock)).toBeCloseTo(aspect, 9);
  });

  it("frames a tiny model by its own size", () => {
    const content: PaperContent = { coordinates: [[0, 0], [0.3, 0], [0.3, 0.1], [0, 0.1]] };
    const lock = modelViewLock(content, { ...paper, annotations: [] });
    // A share of its span on each side, not a fixed metre.
    expect(lock.bottomLeft[0]).toBeCloseTo(-0.3 * PAPER_MARGIN_FRACTION, 9);
    expect(lock.topRight[0]).toBeCloseTo(0.3 * (1 + PAPER_MARGIN_FRACTION), 9);
  });

  it("gives a placeholder view without geometry", () => {
    const lock = modelViewLock({ coordinates: [] }, paper);
    expect(lock.bottomLeft).toEqual([-1, -1]);
    expect(width(lock) / height(lock)).toBeCloseTo(aspect, 9);
  });
});

describe("paperTopBand", () => {
  it("keeps the title block free when annotations sit at the top of the paper", () => {
    expect(paperTopBand(DEFAULT_RESULT_VIEW_SETTINGS.annotations)).toBeGreaterThan(0);
    expect(paperTopBand([])).toBe(0);
    expect(paperTopBand([{ y: 0.9 }])).toBe(0);
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

  it("raises the part of a line below the model's base to the base", () => {
    expect(waterLineFitPoints([[0, -100], [10, 4]], model)).toEqual([[0, 0], [10, 4]]);
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

  it("does not reach below the base for a line partly below it", () => {
    const plain = paperViewLock({ coordinates: flat }, aspect)!;
    const lock = paperViewLock({ coordinates: flat, waterLines: [[[0, -100], [10, 2]]] }, aspect)!;
    expect(lock).toEqual(plain);
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

describe("critical centre and FOS label on the paper", () => {
  const coordinates: [number, number][] = [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]];
  const surface = { cx: 12, cy: 40, radius: 36, fos: 1.2, entryPoint: [5, 10], exitPoint: [28, 5] } as never;

  it("takes them into the content only when they are shown", () => {
    const shown = paperContentOf({ coordinates, result: { criticalSurface: surface }, resultViewSettings: { showFosLabel: true } });
    expect(shown.marks?.[0].at).toEqual([12, 40]);
    const hidden = paperContentOf({ coordinates, result: { criticalSurface: surface }, resultViewSettings: {} });
    expect(hidden.marks).toEqual([]);
    expect(paperContentBounds(shown, 0.1)!.yMax).toBeGreaterThan(40);
  });

  it("widens a locked view after a run whose centre falls outside it", () => {
    const rvs = { ...DEFAULT_RESULT_VIEW_SETTINGS, showFosLabel: true, showCentreMarker: true };
    useAppStore.setState({
      coordinates,
      result: null,
      resultViewSettings: { ...rvs, viewLock: modelViewLock({ coordinates }, rvs) },
    });
    expect(useAppStore.getState().resultViewSettings.viewLock!.topRight[1]).toBeLessThan(40);
    useAppStore.setState({ result: { criticalSurface: surface } as never });
    const lock = useAppStore.getState().resultViewSettings.viewLock!;
    expect(lock.topRight[1]).toBeGreaterThan(40);
    expect(viewLockContains(lock, coordinates)).toBe(true);
  });
});
