import { describe, expect, it } from "vitest";
import { bodyDraggable, dragHitOf, edgeInsertAt, findCanvasObjectsAt, type ObjectHitState } from "./object-hits";
import { surfaceYAtX } from "../view/surface";
import { DEFAULT_PIEZO_LINE } from "../../store/defaults";
import { newReinforcement } from "../../utils/reinforcement";

// 10 px per metre, y up, the world origin at (100, 300).
const toPx = (x: number, y: number): [number, number] => [100 + x * 10, 300 - y * 10];
const toWorld = (px: number, py: number): [number, number] => [(px - 100) / 10, (300 - py) / 10];

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];

function state(over: Partial<ObjectHitState> = {}): ObjectHitState {
  return {
    coordinates: COORDS,
    materialBoundaries: [{ id: "b1", coordinates: [[0, 4], [30, 3]] }],
    piezometricLine: {
      ...DEFAULT_PIEZO_LINE,
      lines: [{ id: "w1", name: "w", color: "#000", coordinates: [[0, 8], [10, 8], [30, 7]] }],
    },
    udls: [],
    lineLoads: [],
    reinforcements: [],
    piles: [],
    customSearchPlanes: [],
    analysisLimits: { enabled: false, entryLeftX: 1, entryRightX: 9, exitLeftX: 21, exitRightX: 29 },
    ...over,
  };
}

const ground = (x: number) => surfaceYAtX(COORDS, x);
const at = (st: ObjectHitState, x: number, y: number, dx = 0, dy = 0) => {
  const [px, py] = toPx(x, y);
  return findCanvasObjectsAt(st, px + dx, py + dy, toPx, ground);
};

describe("findCanvasObjectsAt", () => {
  it("finds an exterior vertex as a handle and an edge as the body, nothing in empty space", () => {
    expect(at(state(), 10, 10)).toEqual([{ object: { type: "exterior" }, point: 2 }]);
    expect(at(state(), 5, 10)).toEqual([{ object: { type: "exterior" }, point: null }]);
    // the closing edge (30, 0)–(0, 0)
    expect(at(state(), 15, 0)).toEqual([{ object: { type: "exterior" }, point: null }]);
    expect(at(state(), 15, 1.5)).toEqual([]);
    expect(at(state(), 5, 10, 0, -9)).toEqual([{ object: { type: "exterior" }, point: null }]);
    expect(at(state(), 5, 10, 0, -11)).toEqual([]);
  });

  it("lists every object at a shared point, those with a handle there first", () => {
    const st = state({ materialBoundaries: [{ id: "b1", coordinates: [[0, 10], [30, 3]] }] });
    const hits = at(st, 0, 10);
    expect(hits).toEqual([
      { object: { type: "boundary", id: "b1" }, point: 0 },
      { object: { type: "exterior" }, point: 1 },
    ]);
    // On the water line and the exterior's edge at once: both, each once.
    const st2 = state({ piezometricLine: { ...DEFAULT_PIEZO_LINE, lines: [{ id: "w1", name: "w", color: "#000", coordinates: [[0, 10.5], [10, 10.5]] }] } });
    expect(at(st2, 5, 10.2).map((c) => c.object.type)).toEqual(["waterLine", "exterior"]);
  });

  it("finds water lines and boundaries by their points and segments", () => {
    expect(at(state(), 10, 8)).toEqual([{ object: { type: "waterLine", id: "w1" }, point: 1 }]);
    expect(at(state(), 20, 7.5)).toEqual([{ object: { type: "waterLine", id: "w1" }, point: null }]);
    expect(at(state(), 15, 3.5)).toEqual([{ object: { type: "boundary", id: "b1" }, point: null }]);
  });

  it("finds the search limits by their markers on the ground, only when enabled", () => {
    const st = state({ analysisLimits: { enabled: true, entryLeftX: 1, entryRightX: 9, exitLeftX: 21, exitRightX: 26 } });
    // On the ground line: the limits' handle first, then the exterior's edge under it.
    expect(at(st, 26, 5)).toEqual([
      { object: { type: "searchLimits" }, point: "exitRightX" },
      { object: { type: "exterior" }, point: null },
    ]);
    expect(at(st, 1, 10)[0]).toEqual({ object: { type: "searchLimits" }, point: "entryLeftX" });
    expect(at(state(), 26, 5)).toEqual([{ object: { type: "exterior" }, point: null }]);
  });

  it("finds an exit at a single x on a vertical face at the foot of the face", () => {
    const wall: [number, number][] = [[0, 0], [0, 15], [20, 15], [20, 5], [40, 5], [40, 0]];
    const st = state({
      coordinates: wall,
      analysisLimits: { enabled: true, entryLeftX: 11, entryRightX: 16, exitLeftX: 20, exitRightX: 20 },
    });
    const [px, py] = toPx(20, 5);
    const hits = findCanvasObjectsAt(st, px, py, toPx, (x) => surfaceYAtX(wall, x));
    expect(hits[0]).toEqual({ object: { type: "searchLimits" }, point: "exitLeftX" });
    const [cx, cy] = toPx(20, 15);
    const atCrest = findCanvasObjectsAt(st, cx, cy, toPx, (x) => surfaceYAtX(wall, x));
    expect(atCrest.some((c) => c.object.type === "searchLimits")).toBe(false);
  });

  it("finds a distributed load by its end arrows (handles) and its strip (body)", () => {
    const st = state({ udls: [{ id: "u", magnitude: 10, x1: 2, x2: 8 }] });
    expect(at(st, 2, 10, 0, -20)[0]).toEqual({ object: { type: "udl", id: "u" }, point: "x1" });
    expect(at(st, 8, 10, 0, -5)[0]).toEqual({ object: { type: "udl", id: "u" }, point: "x2" });
    expect(at(st, 5, 10, 0, -20)).toEqual([{ object: { type: "udl", id: "u" }, point: null }]);
    // Above the arrows: nothing.
    expect(at(st, 5, 10, 0, -60)).toEqual([]);
  });

  it("finds a line load anywhere on its arrow, as its point", () => {
    const st = state({ lineLoads: [{ id: "l", magnitude: 5, x: 25 }] });
    expect(at(st, 25, 5, 0, -12)[0]).toEqual({ object: { type: "lineLoad", id: "l" }, point: "x" });
    expect(at(st, 25, 5, 0, -12).map((c) => c.object.type)).not.toContain("udl");
  });

  it("finds reinforcement and piles by their ends and lines", () => {
    const r = { ...newReinforcement("r", "nail", COORDS, "ltr"), x1: 22, y1: 4, x2: 12, y2: 1 };
    const st = state({ materialBoundaries: [], reinforcements: [r], piles: [{ ...r, id: "p", x1: 25, y1: 5, x2: 25, y2: -2 } as never] });
    expect(at(st, 12, 1)).toEqual([{ object: { type: "reinforcement", id: "r" }, point: "end2" }]);
    expect(at(st, 17, 2.5)).toEqual([{ object: { type: "reinforcement", id: "r" }, point: null }]);
    expect(at(st, 25, 1)).toEqual([{ object: { type: "pile", id: "p" }, point: null }]);
    expect(at(st, 25, -2)[0]).toEqual({ object: { type: "pile", id: "p" }, point: "end2" });
  });

  it("finds a custom circle by its centre and its rim, a custom polyline by its points and segments", () => {
    const st = state({
      customSearchPlanes: [
        { id: "c", cx: 15, cy: 20, radius: 8 },
        { id: "p", cx: 0, cy: 0, radius: 0, points: [[5, 2], [15, 1], [25, 2]] },
      ],
    });
    expect(at(st, 15, 20)).toEqual([{ object: { type: "customPlane", id: "c" }, point: "centre" }]);
    expect(at(st, 23, 20)).toEqual([{ object: { type: "customPlane", id: "c" }, point: "rim" }]);
    expect(at(st, 15, 1)).toEqual([{ object: { type: "customPlane", id: "p" }, point: 1 }]);
    expect(at(st, 20, 1.5)).toEqual([{ object: { type: "customPlane", id: "p" }, point: null }]);
  });
});

describe("dragHitOf and bodyDraggable", () => {
  it("drags handles of every object, and the body only of loads and custom surfaces", () => {
    const st = state({ customSearchPlanes: [{ id: "c", cx: 1, cy: 1, radius: 1 }, { id: "p", cx: 0, cy: 0, radius: 0, points: [[0, 0], [1, 1]] }] });
    expect(dragHitOf(st, { type: "exterior" }, 2)).toEqual({ kind: "external", index: 2 });
    expect(dragHitOf(st, { type: "exterior" }, null)).toBeNull();
    expect(dragHitOf(st, { type: "boundary", id: "b1" }, null)).toBeNull();
    expect(dragHitOf(st, { type: "waterLine", id: "w1" }, 0)).toEqual({ kind: "piezo", lineId: "w1", index: 0 });
    expect(dragHitOf(st, { type: "searchLimits" }, "exitLeftX")).toEqual({ kind: "limit", handle: "exitLeftX" });
    expect(dragHitOf(st, { type: "udl", id: "u" }, null)).toEqual({ kind: "udlBody", udlId: "u" });
    expect(dragHitOf(st, { type: "udl", id: "u" }, "x1")).toEqual({ kind: "udl", udlId: "u", handle: "x1" });
    expect(dragHitOf(st, { type: "lineLoad", id: "l" }, "x")).toEqual({ kind: "lineLoad", loadId: "l" });
    expect(dragHitOf(st, { type: "pile", id: "q" }, "end1")).toEqual({ kind: "elementEnd", element: "pile", id: "q", end: "end1" });
    expect(dragHitOf(st, { type: "reinforcement", id: "r" }, null)).toBeNull();
    expect(dragHitOf(st, { type: "customPlane", id: "c" }, "rim")).toEqual({ kind: "customCircle", planeId: "c", handle: "rim" });
    expect(dragHitOf(st, { type: "customPlane", id: "p" }, null)).toEqual({ kind: "customPlaneBody", planeId: "p" });
    expect(dragHitOf(st, { type: "customPlane", id: "p" }, 1)).toEqual({ kind: "customVertex", planeId: "p", pointIndex: 1 });
    expect(bodyDraggable({ type: "udl", id: "u" })).toBe(true);
    expect(bodyDraggable({ type: "customPlane", id: "p" })).toBe(true);
    expect(bodyDraggable({ type: "exterior" })).toBe(false);
    expect(bodyDraggable({ type: "boundary", id: "b" })).toBe(false);
    expect(bodyDraggable({ type: "reinforcement", id: "r" })).toBe(false);
  });
});

describe("edgeInsertAt", () => {
  const snap = (v: number) => Math.round(v * 2) / 2;
  const edge = (st: ObjectHitState, object: Parameters<typeof edgeInsertAt>[1], x: number, y: number) => {
    const [px, py] = toPx(x, y);
    return edgeInsertAt(st, object, px, py, toPx, toWorld, snap);
  };

  it("gives the insertion index and the snapped point on the object's line", () => {
    expect(edge(state(), { type: "exterior" }, 5.2, 10)).toEqual({ kind: "external", insertIndex: 2, snapPoint: [5, 10] });
    // the closing edge appends
    expect(edge(state(), { type: "exterior" }, 15, 0)).toEqual({ kind: "external", insertIndex: 6, snapPoint: [15, 0] });
    expect(edge(state(), { type: "waterLine", id: "w1" }, 20, 7.5)).toEqual({ kind: "piezo", lineId: "w1", insertIndex: 2, snapPoint: [20, 7.5] });
    expect(edge(state(), { type: "boundary", id: "b1" }, 15, 3.5)).toEqual({ kind: "boundary", boundaryId: "b1", insertIndex: 1, snapPoint: [15, 3.5] });
    expect(edge(state(), { type: "boundary", id: "b1" }, 15, 9)).toBeNull();
    expect(edge(state(), { type: "udl", id: "u" }, 5, 10)).toBeNull();
  });
});
