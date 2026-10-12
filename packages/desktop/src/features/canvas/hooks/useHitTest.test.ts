import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHitTest } from "./useHitTest";
import { DEFAULT_MATERIAL, DEFAULT_PIEZO_LINE } from "../../../store/defaults";
import { surfaceYAtXFromCoordinates } from "../helpers";

const W = 800;
const H = 600;

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];

type Params = Parameters<typeof useHitTest>[0];

function setup(over: Partial<Params> = {}, scale = 10) {
  const worldToCanvas = (wx: number, wy: number, w: number, h: number): [number, number] => [
    w / 2 + (wx - 15) * scale,
    h / 2 - (wy - 5) * scale,
  ];
  const canvasToWorld = (cx: number, cy: number, w: number, h: number): [number, number] => [
    (cx - w / 2) / scale + 15,
    -(cy - h / 2) / scale + 5,
  ];
  const coordinates = over.coordinates ?? COORDS;
  const canvas = { getBoundingClientRect: () => ({ width: W, height: H }) } as HTMLCanvasElement;
  const params: Params = {
    canvasRef: { current: canvas },
    worldToCanvas,
    canvasToWorld,
    coordinates,
    materials: [{ ...DEFAULT_MATERIAL }, { ...DEFAULT_MATERIAL, id: "sand" }],
    materialBoundaries: [],
    regionMaterials: [],
    piezometricLine: DEFAULT_PIEZO_LINE,
    analysisLimits: { enabled: true, entryLeftX: 2, entryRightX: 8, exitLeftX: 21, exitRightX: 28 },
    udls: [],
    lineLoads: [],
    surfaceYAtX: (x) => surfaceYAtXFromCoordinates(coordinates, x),
    snapValue: (v) => Math.round(v),
    viewScale: scale,
    snapToGrid: false,
    gridSnapSize: 1,
    editingExterior: false,
    editingBoundaries: false,
    editingPiezo: false,
    editingLimits: false,
    editingLoads: false,
    ...over,
  };
  return renderHook(() => useHitTest(params)).result.current;
}

const LENS = {
  id: "lens",
  coordinates: [
    [5, 2],
    [10, 2],
    [10, 4],
    [5, 4],
    [5, 2],
  ] as [number, number][],
};

describe("findNearPointUnified", () => {
  it("hits an exterior vertex within the snap radius only while editing the exterior", () => {
    const hit = setup({ editingExterior: true });
    expect(hit.findNearPointUnified(10.5, 10.5)).toEqual({ kind: "external", index: 2 });
    expect(setup().findNearPointUnified(10, 10)).toBeNull();
  });

  it("uses a pixel radius, so the same world distance misses when zoomed in", () => {
    // 1 m away: 10 px at 10 px/m (inside 12 px), 20 px at 20 px/m (outside).
    expect(setup({ editingExterior: true }, 10).findNearPointUnified(11, 10)).toEqual({
      kind: "external",
      index: 2,
    });
    expect(setup({ editingExterior: true }, 20).findNearPointUnified(11, 10)).toBeNull();
  });

  it("hits interior boundary vertices while editing boundaries", () => {
    const hit = setup({ editingBoundaries: true, materialBoundaries: [LENS] });
    expect(hit.findNearPointUnified(10, 4.2)).toEqual({ kind: "boundary", boundaryId: "lens", pointIndex: 2 });
    expect(hit.findNearPointUnified(7.5, 3)).toBeNull();
  });

  it("prefers exterior vertices when an interior vertex coincides", () => {
    const hit = setup({
      editingExterior: true,
      editingBoundaries: true,
      materialBoundaries: [{ id: "b", coordinates: [[0, 10], [10, 5]] }],
    });
    expect(hit.findNearPointUnified(0, 10)).toEqual({ kind: "external", index: 1 });
  });

  it("checks the active piezometric line first", () => {
    const shared: [number, number][] = [
      [0, 6],
      [30, 6],
    ];
    const hit = setup({
      editingPiezo: true,
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        lines: [
          { id: "a", name: "a", color: "#000", coordinates: shared },
          { id: "b", name: "b", color: "#000", coordinates: shared },
        ],
        activeLineId: "b",
      },
    });
    expect(hit.findNearPointUnified(30, 6)).toEqual({ kind: "piezo", lineId: "b", index: 1 });
  });

  it("hits search-limit handles with a wider radius when the limits are edited and enabled", () => {
    const hit = setup({ editingLimits: true });
    // 1.5 m = 15 px from the handle at x = 21 (ground y = 4.5): inside 12 + 4 px.
    expect(hit.findNearPointUnified(21, 6)).toEqual({ kind: "limit", handle: "exitLeftX" });
    expect(hit.findNearPointUnified(21, 7)).toBeNull();
    const disabled = setup({
      editingLimits: true,
      analysisLimits: { enabled: false, entryLeftX: 2, entryRightX: 8, exitLeftX: 21, exitRightX: 28 },
    });
    expect(disabled.findNearPointUnified(21, 4.5)).toBeNull();
  });

  it("hits the whole shaft of a UDL arrow and of a line load arrow", () => {
    const hit = setup({
      editingLoads: true,
      udls: [{ id: "u", magnitude: 10, x1: 2, x2: 8 }],
      lineLoads: [{ id: "l", magnitude: 10, x: 25 }],
    });
    // Shaft is 38 px = 3.8 m tall above the ground.
    expect(hit.findNearPointUnified(8, 13.5)).toEqual({ kind: "udl", udlId: "u", handle: "x2" });
    expect(hit.findNearPointUnified(2.5, 10.1)).toEqual({ kind: "udl", udlId: "u", handle: "x1" });
    expect(hit.findNearPointUnified(8, 14.5)).toBeNull();
    expect(hit.findNearPointUnified(25, 7)).toEqual({ kind: "lineLoad", loadId: "l" });
    expect(hit.findNearPointUnified(27, 7)).toBeNull();
    expect(setup({ udls: [{ id: "u", magnitude: 10, x1: 2, x2: 8 }] }).findNearPointUnified(8, 12)).toBeNull();
  });
});

describe("findNearEdgeUnified", () => {
  it("finds an exterior edge with the insert index and a snapped point on it", () => {
    const hit = setup({ editingExterior: true });
    expect(hit.findNearEdgeUnified(14.2, 7.4)).toEqual({
      kind: "external",
      insertIndex: 3,
      snapPoint: [14, 8], // projection (14.4, 7.8) rounded
    });
  });

  it("inserts at the end for the closing edge", () => {
    const hit = setup({ editingExterior: true });
    expect(hit.findNearEdgeUnified(0.3, 4)).toMatchObject({ kind: "external", insertIndex: 1 });
    // The closing edge runs from the last vertex (30, 0) back to (0, 0).
    expect(hit.findNearEdgeUnified(15, 0.2)).toMatchObject({ kind: "external", insertIndex: COORDS.length });
  });

  it("returns nothing beyond the edge threshold or when nothing is edited", () => {
    expect(setup({ editingExterior: true }).findNearEdgeUnified(15, 3)).toBeNull();
    expect(setup().findNearEdgeUnified(14.2, 7.4)).toBeNull();
  });

  it("picks the nearest edge across boundaries and piezometric lines", () => {
    const hit = setup({
      editingBoundaries: true,
      editingPiezo: true,
      materialBoundaries: [LENS],
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        lines: [{ id: "w", name: "w", color: "#000", coordinates: [[0, 4.5], [30, 4.5]] }],
        activeLineId: "w",
      },
    });
    // Top lens edge at y = 4 vs water line at y = 4.5.
    expect(hit.findNearEdgeUnified(7, 4.1)).toMatchObject({ kind: "boundary", boundaryId: "lens", insertIndex: 3 });
    expect(hit.findNearEdgeUnified(7, 4.4)).toMatchObject({ kind: "piezo", lineId: "w", insertIndex: 1 });
  });
});

describe("findRegionAtPoint", () => {
  it("returns the innermost region containing the point", () => {
    const hit = setup({ materialBoundaries: [LENS] });
    const inLens = hit.findRegionAtPoint(7, 3);
    const outside = hit.findRegionAtPoint(20, 2);
    expect(inLens).not.toBeNull();
    expect(outside).not.toBeNull();
    expect(inLens!.regionKey).not.toBe(outside!.regionKey);
    expect(hit.findRegionAtPoint(40, 2)).toBeNull();
  });

  it("returns null without a closed exterior", () => {
    expect(setup({ coordinates: COORDS.slice(0, 2) }).findRegionAtPoint(0, 5)).toBeNull();
  });
});

describe("findSnapTarget", () => {
  it("snaps a dragged point to a nearby vertex of another polyline", () => {
    const hit = setup({ materialBoundaries: [LENS] });
    expect(hit.findSnapTarget(10.5, 10.4, { kind: "boundary", boundaryId: "lens", pointIndex: 1 })).toEqual([10, 10]);
    // 1.2 px/m radius: 12 px at 10 px/m = 1.2 m.
    expect(hit.findSnapTarget(11.5, 10, { kind: "boundary", boundaryId: "lens", pointIndex: 1 })).toBeNull();
  });

  it("does not snap a point to itself, or to the twin end of its closed boundary", () => {
    const hit = setup({ materialBoundaries: [LENS] });
    expect(hit.findSnapTarget(5.1, 2.1, { kind: "boundary", boundaryId: "lens", pointIndex: 0 })).toBeNull();
    expect(hit.findSnapTarget(5.1, 2.1, { kind: "boundary", boundaryId: "lens", pointIndex: 4 })).toBeNull();
    expect(hit.findSnapTarget(10.1, 2.1, { kind: "external", index: 0 })).toEqual([10, 2]);
  });

  it("widens the radius to the grid size when snapping to the grid", () => {
    const hit = setup({ snapToGrid: true, gridSnapSize: 2 });
    expect(hit.findSnapTarget(11.8, 10, { kind: "limit", handle: "entryLeftX" })).toEqual([10, 10]);
    expect(setup().findSnapTarget(11.8, 10, { kind: "limit", handle: "entryLeftX" })).toBeNull();
  });

  it("ignores boundary and water points that sit on the dragged exterior vertex", () => {
    const hit = setup({
      materialBoundaries: [{ id: "b", coordinates: [[20, 5], [30, 2]] }],
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        lines: [{ id: "w", name: "w", color: "#000", coordinates: [[5, 8.5], [20, 5]] }],
        activeLineId: "w",
      },
    });
    expect(hit.findSnapTarget(20.3, 5.2, { kind: "external", index: 3 })).toBeNull();
    // A water-line vertex still attracts other points.
    expect(hit.findSnapTarget(5.2, 8.6, { kind: "boundary", boundaryId: "b", pointIndex: 0 })).toEqual([5, 8.5]);
    // …except the dragged water point itself.
    expect(hit.findSnapTarget(5.2, 8.6, { kind: "piezo", lineId: "w", index: 0 })).toBeNull();
  });
});
