import { describe, expect, it } from "vitest";
import {
  findReferenceEdgeAt,
  findReferenceHandle,
  findReferenceHitAt,
  findReferenceLine,
  findReferenceSegment,
  isSameReferenceHit,
  referenceEdgeHit,
  referenceHitId,
  resultToPx,
} from "./reference-geometry";
import type { Annotation, ReferenceAnnotation } from "../../store/types";
import type { PointHit } from "./types";

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];
const LINE: ReferenceAnnotation = { id: "l", type: "reference", shape: "polyline", points: [[2, 10], [12, 4], [22, 5]] };
const CIRCLE: ReferenceAnnotation = { id: "c", type: "reference", shape: "circle", cx: 15, cy: 14, radius: 10 };
const ground = (x: number) => (x < 0 || x > 30 ? null : x <= 10 ? 10 : x <= 20 ? 10 - (x - 10) / 2 : 5);

/** 10 px per metre, world origin at (100, 500). */
const toPx = (x: number, y: number): [number, number] => [100 + x * 10, 500 - y * 10];

describe("reference hit testing", () => {
  it("hits a polyline's vertex and a circle's centre within the handle radius", () => {
    expect(findReferenceHandle([LINE, CIRCLE], 100 + 12 * 10 + 3, 500 - 4 * 10 - 2, toPx, 6)).toEqual({
      kind: "referenceVertex",
      annoId: "l",
      pointIndex: 1,
    });
    expect(findReferenceHandle([LINE, CIRCLE], 100 + 150 + 4, 500 - 140, toPx, 6)).toEqual({
      kind: "referenceCircle",
      annoId: "c",
      handle: "centre",
    });
    expect(findReferenceHandle([LINE, CIRCLE], 100 + 150 + 8, 500 - 140, toPx, 6)).toBeNull();
  });

  it("hits a polyline on its line and a circle on its drawn arc (its rim)", () => {
    // The middle of the first segment (7, 7).
    expect(findReferenceLine([LINE], ...toPx(7, 7.3), toPx, 5, ground)).toEqual({ kind: "referenceLine", annoId: "l" });
    expect(findReferenceLine([LINE], ...toPx(7, 8.5), toPx, 5, ground)).toBeNull();
    // The bottom of the circle, (15, 4), lies in the soil and is drawn.
    expect(findReferenceLine([CIRCLE], ...toPx(15, 4.2), toPx, 5, ground)).toEqual({ kind: "referenceCircle", annoId: "c", handle: "rim" });
    // The top of the circle (15, 24) is above the ground: not drawn, not hit.
    expect(findReferenceLine([CIRCLE], ...toPx(15, 24), toPx, 5, ground)).toBeNull();
    // Drawn whole, it is.
    expect(findReferenceLine([{ ...CIRCLE, clip: "none" }], ...toPx(15, 24), toPx, 5, ground)).toMatchObject({ handle: "rim" });
  });

  it("finds the nearest segment with its insertion index and foot, and makes an edge hit of it", () => {
    const seg = findReferenceSegment([LINE, CIRCLE], ...toPx(17, 4.4), toPx, 5)!;
    expect(seg).toMatchObject({ annoId: "l", insertIndex: 2 });
    expect(seg.dist).toBeLessThan(5);
    const hit = referenceEdgeHit(seg, (px, py) => [(px - 100) / 10, (500 - py) / 10], (v) => Math.round(v * 2) / 2);
    expect(hit).toMatchObject({ kind: "reference", annoId: "l", insertIndex: 2 });
    expect(hit.snapPoint[0]).toBeCloseTo(17, 0);
    expect(findReferenceSegment([LINE], ...toPx(17, 9), toPx, 5)).toBeNull();
  });

  it("compares hits and names the annotation of one", () => {
    const v: PointHit = { kind: "referenceVertex", annoId: "l", pointIndex: 1 };
    expect(isSameReferenceHit(v, { kind: "referenceVertex", annoId: "l", pointIndex: 1 })).toBe(true);
    expect(isSameReferenceHit(v, { kind: "referenceVertex", annoId: "l", pointIndex: 2 })).toBe(false);
    expect(isSameReferenceHit({ kind: "referenceLine", annoId: "l" }, { kind: "referenceLine", annoId: "l" })).toBe(true);
    expect(isSameReferenceHit({ kind: "referenceCircle", annoId: "c", handle: "rim" }, { kind: "referenceCircle", annoId: "c", handle: "centre" })).toBe(false);
    expect(isSameReferenceHit({ kind: "external", index: 1 }, { kind: "external", index: 1 })).toBe(false);
    expect(referenceHitId(v)).toBe("l");
    expect(referenceHitId({ kind: "annotation", annoId: "a" })).toBeNull();
    expect(referenceHitId(null)).toBeNull();
  });

  it("hits through the store's result viewport and the canvas rectangle", () => {
    const state = {
      resultViewScale: 10,
      resultViewOffset: [-5, -2] as [number, number],
      resultViewSettings: { annotations: [{ id: "t", type: "text", x: 0, y: 0 } as Annotation, LINE, CIRCLE] },
      coordinates: COORDS,
    };
    const rect = { left: 20, top: 30, width: 800, height: 600 };
    const px = resultToPx(state, rect.width, rect.height);
    expect(px(5, 2)).toEqual([400, 300]);
    const at = (x: number, y: number) => {
      const [cx, cy] = px(x, y);
      return [rect.left + cx, rect.top + cy] as const;
    };
    expect(findReferenceHitAt(state, rect, ...at(12, 4))).toEqual({ kind: "referenceVertex", annoId: "l", pointIndex: 1 });
    expect(findReferenceHitAt(state, rect, ...at(7, 7))).toEqual({ kind: "referenceLine", annoId: "l" });
    expect(findReferenceHitAt(state, rect, ...at(15, 4))).toEqual({ kind: "referenceCircle", annoId: "c", handle: "rim" });
    expect(findReferenceHitAt(state, rect, ...at(25, 9))).toBeNull();
    const edge = findReferenceEdgeAt(state, rect, ...at(17, 4.5), (v) => Math.round(v));
    expect(edge).toEqual({ kind: "reference", annoId: "l", insertIndex: 2, snapPoint: [17, 5] });
    expect(findReferenceEdgeAt({ ...state, resultViewSettings: { annotations: [] } }, rect, ...at(17, 4.5), (v) => v)).toBeNull();
  });
});
