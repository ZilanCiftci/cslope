import { describe, expect, it } from "vitest";
import {
  cloneAnnotation,
  defaultReferenceCircle,
  defaultReferencePolyline,
  isPaperAnnotation,
  isReferenceAnnotation,
  normalizeReferenceAnnotation,
  paperAnnotations,
  referenceDashPattern,
  referenceFromCustomPlane,
  referenceLabelAnchor,
  referenceListName,
  referenceWidth,
  referenceWorldPoints,
  translateReference,
} from "./reference";
import { surfaceYAtX } from "../view/surface";
import type { Annotation, ReferenceCircle, ReferencePolyline } from "../../store/types";

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];
const ground = (x: number) => surfaceYAtX(COORDS, x);

const LINE: ReferencePolyline = { id: "l", type: "reference", shape: "polyline", points: [[2, 10], [12, 4], [22, 5]] };
const CIRCLE: ReferenceCircle = { id: "c", type: "reference", shape: "circle", cx: 15, cy: 14, radius: 10 };

describe("reference annotations: geometry", () => {
  it("tells reference annotations from paper annotations", () => {
    const text: Annotation = { id: "t", type: "text", x: 0.1, y: 0.1 };
    expect(isReferenceAnnotation(LINE)).toBe(true);
    expect(isPaperAnnotation(LINE)).toBe(false);
    expect(isPaperAnnotation(text)).toBe(true);
    expect(paperAnnotations([text, LINE, CIRCLE])).toEqual([text]);
  });

  it("draws a polyline through its own points, copied", () => {
    const pts = referenceWorldPoints(LINE, ground);
    expect(pts).toEqual(LINE.points);
    expect(pts[0]).not.toBe(LINE.points[0]);
    expect(referenceWorldPoints({ ...LINE, points: [[1, 1]] }, ground)).toEqual([]);
  });

  it("clips a circle to the arc below the ground, its ends on the ground", () => {
    const pts = referenceWorldPoints(CIRCLE, ground);
    expect(pts.length).toBeGreaterThan(8);
    for (const [x, y] of pts) {
      expect(Math.hypot(x - 15, y - 14)).toBeCloseTo(10, 9);
      expect(y).toBeLessThanOrEqual(ground(x)! + 1e-6);
    }
    // The ends lie on the ground (the crest at y = 10 on the left, the slope on the right).
    const [x0, y0] = pts[0];
    const [x1, y1] = pts[pts.length - 1];
    expect(x0).toBeLessThan(15);
    expect(y0).toBeCloseTo(ground(x0)!, 3);
    expect(x1).toBeGreaterThan(15);
    expect(y1).toBeCloseTo(ground(x1)!, 3);
    // The lowest point (the bottom of the circle) is drawn.
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(4, 6);
  });

  it("draws nothing for a clipped circle above the ground or outside the model", () => {
    expect(referenceWorldPoints({ ...CIRCLE, cy: 30 }, ground)).toEqual([]);
    expect(referenceWorldPoints({ ...CIRCLE, cx: 100 }, ground)).toEqual([]);
    expect(referenceWorldPoints({ ...CIRCLE, radius: 0 }, ground)).toEqual([]);
  });

  it("draws a whole circle, closed, when not clipped", () => {
    const pts = referenceWorldPoints({ ...CIRCLE, clip: "none" }, () => null);
    expect(pts.length).toBeGreaterThan(100);
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    for (const [x, y] of pts) expect(Math.hypot(x - 15, y - 14)).toBeCloseTo(10, 9);
  });

  it("anchors the label at the polyline's midpoint by length and the circle's lowest point", () => {
    // Lengths: 11.66 + 10.05 = 21.71; the midpoint lies on the first segment.
    const [mx, my] = referenceLabelAnchor(LINE, LINE.points)!;
    const l1 = Math.hypot(10, 6);
    const t = (Math.hypot(10, 6) + Math.hypot(10, 1)) / 2 / l1;
    expect(mx).toBeCloseTo(2 + 10 * t, 9);
    expect(my).toBeCloseTo(10 - 6 * t, 9);
    expect(referenceLabelAnchor(CIRCLE, [[0, 0]])).toEqual([15, 4]);
    expect(referenceLabelAnchor(CIRCLE, [])).toBeNull();
  });

  it("gives the width, dash patterns and list name", () => {
    expect(referenceWidth(LINE)).toBe(1.5);
    expect(referenceWidth({ ...LINE, width: 3 })).toBe(3);
    expect(referenceWidth({ ...LINE, width: -1 })).toBe(1.5);
    expect(referenceDashPattern(undefined, 1.5)).toEqual([]);
    expect(referenceDashPattern("dashed", 1.5)).toEqual([8, 5]);
    expect(referenceDashPattern("dotted", 2)).toEqual([2, 5]);
    expect(referenceListName(LINE)).toBe("Reference line");
    expect(referenceListName(CIRCLE)).toBe("Reference circle");
    expect(referenceListName({ ...LINE, label: " F = 0.66 (other program) " })).toBe("F = 0.66 (other program)");
  });

  it("moves and copies annotations without sharing points", () => {
    const moved = translateReference(LINE, 1, -2);
    expect(moved).toMatchObject({ points: [[3, 8], [13, 2], [23, 3]] });
    expect(translateReference(CIRCLE, 1, -2)).toMatchObject({ cx: 16, cy: 12, radius: 10 });
    const copy = cloneAnnotation(LINE);
    expect(copy).toEqual(LINE);
    expect(copy.points).not.toBe(LINE.points);
    expect(copy.points[0]).not.toBe(LINE.points[0]);
    const table: Annotation = { id: "m", type: "material-table", x: 0.9, y: 0.1, tableColumns: ["model"] };
    const tableCopy = cloneAnnotation(table);
    expect(tableCopy).toEqual(table);
    expect(tableCopy.tableColumns).not.toBe(table.tableColumns);
  });
});

describe("reference annotations: from custom planes and defaults", () => {
  it("copies a circle (clipped to the ground) and a polyline, labelled by their number", () => {
    expect(referenceFromCustomPlane({ id: "p", cx: 15, cy: 14, radius: 10 }, 0)).toEqual({
      shape: "circle",
      cx: 15,
      cy: 14,
      radius: 10,
      clip: "ground",
      label: "Custom surface 1",
    });
    const points: [number, number][] = [[5, 8], [15, 2]];
    const poly = referenceFromCustomPlane({ id: "p", cx: 0, cy: 0, radius: 0, points }, 2);
    expect(poly).toEqual({ shape: "polyline", points, label: "Custom surface 3" });
    expect((poly as { points: [number, number][] }).points).not.toBe(points);
    expect(referenceFromCustomPlane({ id: "p", cx: 0, cy: 0, radius: 0 }, 0)).toBeNull();
    expect(referenceFromCustomPlane({ id: "p", cx: 0, cy: 0, radius: 0, points: [[1, 1]] }, 0)).toBeNull();
  });

  it("starts a polyline on the ground across the middle of the view and a circle above it", () => {
    const bounds = { xMin: 0, xMax: 30, yMin: 0, yMax: 15 };
    const line = defaultReferencePolyline(bounds, ground);
    expect(line).toEqual({
      shape: "polyline",
      // x = 9 on the crest (10), x = 21 on the bench (5); the middle sags 0.2 × 15 below the lower end.
      points: [[9, 10], [15, 2], [21, 5]],
    });
    // Without ground: the middle of the view.
    expect(defaultReferencePolyline(bounds, () => null)).toMatchObject({ points: [[9, 7.5], [15, 4.5], [21, 7.5]] });
    expect(defaultReferenceCircle(bounds)).toEqual({ shape: "circle", cx: 15, cy: 12, radius: 6.75, clip: "ground" });
  });
});

describe("reference annotations: normalization", () => {
  it("keeps the named fields of a valid polyline and circle only", () => {
    expect(
      normalizeReferenceAnnotation({
        id: "l",
        type: "reference",
        shape: "polyline",
        points: [[2, 10], [12, 4]],
        label: "other program",
        color: "#ff00ff",
        dash: "dashed",
        width: 2,
        showInEdit: true,
        x: 0.5,
        unknown: 1,
      }),
    ).toEqual({
      id: "l",
      type: "reference",
      shape: "polyline",
      points: [[2, 10], [12, 4]],
      label: "other program",
      color: "#ff00ff",
      dash: "dashed",
      width: 2,
      showInEdit: true,
    });
    expect(normalizeReferenceAnnotation({ id: "c", type: "reference", shape: "circle", cx: 1, cy: 2, radius: 3, clip: "none" })).toEqual({
      id: "c",
      type: "reference",
      shape: "circle",
      cx: 1,
      cy: 2,
      radius: 3,
      clip: "none",
    });
  });

  it("drops invalid optional fields and rejects unusable geometry", () => {
    const base = { id: "l", type: "reference", shape: "polyline", points: [[2, 10], [12, 4]] };
    expect(normalizeReferenceAnnotation({ ...base, dash: "wavy", width: 0, clip: "x", showInEdit: "yes", label: 3 })).toEqual({
      id: "l",
      type: "reference",
      shape: "polyline",
      points: [[2, 10], [12, 4]],
    });
    expect(normalizeReferenceAnnotation({ ...base, points: [[2, 10]] })).toBeNull();
    expect(normalizeReferenceAnnotation({ ...base, points: [[2, 10], [1, "a"]] })).toBeNull();
    expect(normalizeReferenceAnnotation({ ...base, points: [[2, 10], [1, Infinity]] })).toBeNull();
    expect(normalizeReferenceAnnotation({ id: "c", type: "reference", shape: "circle", cx: 1, cy: 2, radius: 0 })).toBeNull();
    expect(normalizeReferenceAnnotation({ id: "c", type: "reference", shape: "circle", cx: 1, cy: NaN, radius: 2 })).toBeNull();
    expect(normalizeReferenceAnnotation({ id: "d", type: "reference", shape: "dimension", points: [[0, 0], [1, 1]] })).toBeNull();
    expect(normalizeReferenceAnnotation({ type: "reference", shape: "circle", cx: 1, cy: 2, radius: 2 })).toBeNull();
  });
});
