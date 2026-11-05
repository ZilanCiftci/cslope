import { describe, expect, it } from "vitest";
import {
  MIN_CUSTOM_CIRCLE_RADIUS,
  circleRadiusFromPointer,
  customPlaneEdgeHit,
  findCustomPlaneHandle,
  findCustomPlaneSegment,
  isSameCustomPlaneHit,
  projectOnSegment,
} from "./custom-plane-geometry";
import type { CustomSearchPlane } from "../../store/types";

// 10 px per metre, y up, origin at the canvas origin.
const toPx = (x: number, y: number): [number, number] => [x * 10, -y * 10];
const toWorld = (px: number, py: number): [number, number] => [px / 10, -py / 10];

const CIRCLE: CustomSearchPlane = { id: "c1", cx: 20, cy: 30, radius: 10 };
const LINE: CustomSearchPlane = {
  id: "p1",
  cx: 0,
  cy: 0,
  radius: 0,
  points: [
    [5, 8],
    [15, 2],
    [25, 4],
  ],
};
const PLANES = [CIRCLE, LINE];

describe("findCustomPlaneHandle", () => {
  it("hits a vertex within the handle radius", () => {
    const [px, py] = toPx(15, 2);
    expect(findCustomPlaneHandle(PLANES, px + 8, py - 8, toPx, 12, 10)).toEqual({
      kind: "customVertex",
      planeId: "p1",
      pointIndex: 1,
    });
    expect(findCustomPlaneHandle(PLANES, px + 12, py, toPx, 12, 10)).toBeNull();
  });

  it("hits a circle's centre, then its rim", () => {
    const [cx, cy] = toPx(20, 30);
    expect(findCustomPlaneHandle(PLANES, cx + 5, cy, toPx, 12, 10)).toEqual({
      kind: "customCircle",
      planeId: "c1",
      handle: "centre",
    });
    // The rim is 100 px from the centre: within 10 px of it, in any direction.
    expect(findCustomPlaneHandle(PLANES, cx, cy + 95, toPx, 12, 10)).toEqual({
      kind: "customCircle",
      planeId: "c1",
      handle: "rim",
    });
    expect(findCustomPlaneHandle(PLANES, cx - 104, cy, toPx, 12, 10)).toMatchObject({ handle: "rim" });
    expect(findCustomPlaneHandle(PLANES, cx, cy - 80, toPx, 12, 10)).toBeNull();
  });

  it("lets a vertex or centre beat a rim passing over it", () => {
    const over: CustomSearchPlane = { id: "c2", cx: 30, cy: 30, radius: 10 };
    // c2's rim passes through c1's centre (20, 30).
    const [cx, cy] = toPx(20, 30);
    expect(findCustomPlaneHandle([over, CIRCLE], cx, cy, toPx, 12, 10)).toMatchObject({
      planeId: "c1",
      handle: "centre",
    });
  });

  it("ignores a circle without a radius for the rim", () => {
    const flat: CustomSearchPlane = { id: "c0", cx: 20, cy: 30, radius: 0 };
    const [cx, cy] = toPx(20, 30);
    expect(findCustomPlaneHandle([flat], cx, cy + 5, toPx, 12, 10)).toMatchObject({ handle: "centre" });
    expect(findCustomPlaneHandle([flat], cx, cy + 30, toPx, 12, 10)).toBeNull();
  });
});

describe("findCustomPlaneSegment", () => {
  it("finds the nearest segment with the insert index and the foot on it", () => {
    // Over the second segment (15, 2)–(25, 4), 1 m above its midpoint.
    const [mx, my] = toPx(20, 4);
    const seg = findCustomPlaneSegment(PLANES, mx, my, toPx, 10)!;
    expect(seg.planeId).toBe("p1");
    expect(seg.insertIndex).toBe(2);
    expect(seg.dist).toBeCloseTo(10 / Math.sqrt(1.04), 6);
    const [wx, wy] = toWorld(seg.proj[0], seg.proj[1]);
    expect(wy).toBeCloseTo(2 + (wx - 15) * 0.2, 6);
  });

  it("returns nothing beyond the threshold, and skips circles", () => {
    const [mx, my] = toPx(20, 6);
    expect(findCustomPlaneSegment(PLANES, mx, my, toPx, 10)).toBeNull();
    expect(findCustomPlaneSegment([CIRCLE], ...toPx(20, 40), toPx, 50)).toBeNull();
  });

  it("becomes an edge hit with the insertion point snapped", () => {
    const seg = { planeId: "p1", insertIndex: 2, proj: toPx(19.6, 2.92) };
    expect(customPlaneEdgeHit(seg, toWorld, Math.round)).toEqual({
      kind: "customPlane",
      planeId: "p1",
      insertIndex: 2,
      snapPoint: [20, 3],
    });
  });
});

describe("projectOnSegment", () => {
  it("clamps the foot to the segment's ends", () => {
    expect(projectOnSegment(5, 5, [0, 0], [10, 0])).toEqual([5, 0]);
    expect(projectOnSegment(-3, 5, [0, 0], [10, 0])).toEqual([0, 0]);
    expect(projectOnSegment(13, 5, [0, 0], [10, 0])).toEqual([10, 0]);
    expect(projectOnSegment(3, 4, [1, 1], [1, 1])).toEqual([1, 1]);
  });
});

describe("circleRadiusFromPointer", () => {
  it("is the pointer's distance from the centre, never below the minimum", () => {
    expect(circleRadiusFromPointer(20, 30, 26, 38)).toBe(10);
    expect(circleRadiusFromPointer(20, 30, 20.01, 30)).toBe(MIN_CUSTOM_CIRCLE_RADIUS);
    expect(circleRadiusFromPointer(20, 30, 20, 30)).toBe(MIN_CUSTOM_CIRCLE_RADIUS);
  });

  it("snaps the radius as the grid snap does, after the minimum", () => {
    const snap = (v: number) => Math.round(v / 0.5) * 0.5;
    expect(circleRadiusFromPointer(20, 30, 29.8, 30, snap)).toBe(10);
    expect(circleRadiusFromPointer(20, 30, 20.2, 30, snap)).toBe(MIN_CUSTOM_CIRCLE_RADIUS);
  });
});

describe("isSameCustomPlaneHit", () => {
  it("compares plane, handle and vertex index", () => {
    const centre = { kind: "customCircle", planeId: "c1", handle: "centre" } as const;
    const rim = { kind: "customCircle", planeId: "c1", handle: "rim" } as const;
    const v1 = { kind: "customVertex", planeId: "p1", pointIndex: 1 } as const;
    expect(isSameCustomPlaneHit(centre, { ...centre })).toBe(true);
    expect(isSameCustomPlaneHit(centre, rim)).toBe(false);
    expect(isSameCustomPlaneHit(v1, { ...v1 })).toBe(true);
    expect(isSameCustomPlaneHit(v1, { ...v1, pointIndex: 2 })).toBe(false);
    expect(isSameCustomPlaneHit(v1, centre)).toBe(false);
    expect(isSameCustomPlaneHit({ kind: "external", index: 1 }, { kind: "external", index: 1 })).toBe(false);
  });
});
