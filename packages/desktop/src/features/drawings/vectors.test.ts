/// <reference types="node" />
/**
 * Line work of DWG and DXF drawings (readers, units, block expansion), its
 * grid, snapping to it, and picking lines of it ("Use as boundaries").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as glue from "../../dwg-wasm/cslope_dwg.js";
import { readDxfVectors } from "../../utils/dxf";
import { drawingCoordinatesTransform, extentOf, fromDrawingCoordinates, type NeutralVectors, type VectorDrawing, type VectorPath } from "./vectors";
import { SegmentIndex } from "./vector-index";
import { segmentIntersection, snapToDrawings, type SnapSource } from "./snap";
import { chainTolerance, chainsInWindow, clipToCrop, connectedChain, exteriorFrom, joinChains, pathAt, pickedToModel } from "./line-pick";
import { apply, type Affine, type Pt } from "./transform";
import { DWG_MIME, DXF_MIME, sniffDrawingMime } from "./sources";

const file = (path: string) => new Uint8Array(readFileSync(join(process.cwd(), path)));
const dxf = (pairs: (string | number)[][]) => pairs.map(([c, v]) => `${c}\n${v}`).join("\n") + "\n";

/** A drawing of paths given in source coordinates. */
function drawing(paths: { pts: Pt[]; closed?: boolean; layer?: number }[], layers = ["0"]): VectorDrawing {
  const vp: VectorPath[] = paths.map((p) => ({ layer: p.layer ?? 0, pts: Float64Array.from(p.pts.flat()), closed: !!p.closed }));
  return { layers, layersOff: [], paths: vp, texts: [], extent: extentOf(vp, []), metersPerUnit: 1, unitName: "meter", segmentCount: 0, notes: [] };
}

const ID: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const source = (d: VectorDrawing, transform: Affine = ID, extra: Partial<SnapSource["placement"]> = {}): SnapSource => ({
  placement: { id: "p", transform, ...extra },
  drawing: d,
  index: new SegmentIndex(d),
});

describe("DWG line work (the committed reader)", () => {
  beforeAll(() => {
    glue.initSync({ module: file("src/dwg-wasm/cslope_dwg_bg.wasm") });
  });

  it("reads the fixture's model space: units, layers, every curve, y turned down", () => {
    const n = JSON.parse(glue.readDwgVectors(file("src/features/project/fixtures/slope-section.dwg"))) as NeutralVectors;
    expect(n.insunits).toBe(6);
    const d = fromDrawingCoordinates(n, "DWG");
    expect(d.metersPerUnit).toBe(1);
    expect(d.unitName).toBe("meter");
    // The outline, two LINEs, the water line, and the ARC (as a polyline this time).
    expect(d.paths.length).toBe(5);
    expect(d.layers).toEqual(expect.arrayContaining(["outline", "layer", "piezo"]));
    const outline = d.paths.find((p) => d.layers[p.layer] === "outline")!;
    expect(outline.closed).toBe(true);
    // (40, 0) in the drawing is (40, −0) in source coordinates; (0, −20) is (0, 20).
    expect([...outline.pts]).toEqual(expect.arrayContaining([0, 20]));
    // "Use the drawing's coordinates": back to the drawing's own (metres).
    const m = drawingCoordinatesTransform(d.metersPerUnit!);
    expect(apply(m, [0, 20])).toEqual([0, -20]);
    const arc = d.paths.find((p) => p.pts.length > 10 && !p.closed)!;
    expect(arc).toBeDefined();
  });

  it("is told apart from other files by its bytes", () => {
    expect(sniffDrawingMime(file("src/features/project/fixtures/slope-section.dwg"))).toBe(DWG_MIME);
    expect(sniffDrawingMime(new TextEncoder().encode("  0\nSECTION\n  2\nHEADER\n"))).toBe(DXF_MIME);
    expect(sniffDrawingMime(new TextEncoder().encode("999\nmade by hand\n0\r\nSECTION\r\n"))).toBe(DXF_MIME);
    expect(sniffDrawingMime(new TextEncoder().encode("hello"))).toBeNull();
  });
});

describe("DXF line work", () => {
  const text = dxf([
    [0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, 4], [0, "ENDSEC"],
    [0, "SECTION"], [2, "TABLES"], [0, "TABLE"], [2, "LAYER"],
    [0, "LAYER"], [2, "marks"], [70, 0], [62, 7],
    [0, "LAYER"], [2, "hidden"], [70, 0], [62, -7],
    [0, "ENDTAB"], [0, "ENDSEC"],
    [0, "SECTION"], [2, "BLOCKS"],
    // Mark: a unit square from its base point (10, 10).
    [0, "BLOCK"], [2, "Mark"], [10, 10], [20, 10],
    [0, "LWPOLYLINE"], [8, "0"], [90, 4], [70, 1], [10, 10], [20, 10], [10, 11], [20, 10], [10, 11], [20, 11], [10, 10], [20, 11],
    [0, "ENDBLK"],
    // Pair: two marks, the second 5 to the right.
    [0, "BLOCK"], [2, "Pair"], [10, 0], [20, 0],
    [0, "INSERT"], [8, "0"], [2, "Mark"], [10, 0], [20, 0],
    [0, "INSERT"], [8, "0"], [2, "Mark"], [10, 5], [20, 0],
    [0, "ENDBLK"],
    [0, "ENDSEC"],
    [0, "SECTION"], [2, "ENTITIES"],
    [0, "INSERT"], [8, "marks"], [2, "Pair"], [10, 100], [20, 0], [41, 2], [42, 2],
    [0, "INSERT"], [8, "0"], [2, "Pair"], [10, 0], [20, 100], [50, 90],
    [0, "ARC"], [8, "0"], [10, 0], [20, 0], [40, 5], [50, 0], [51, 180],
    [0, "CIRCLE"], [8, "0"], [10, 50], [20, 50], [40, 2],
    [0, "LWPOLYLINE"], [8, "0"], [90, 2], [70, 0], [10, 0], [20, -10], [42, 1], [10, 4], [20, -10],
    [0, "TEXT"], [8, "hidden"], [10, 20], [20, 30], [40, 2.5], [1, "Section A-A"],
    [0, "MTEXT"], [8, "0"], [10, 1], [20, 2], [40, 1], [1, "{\\fArial|b1;Profile}\\P3"],
    [0, "ENDSEC"], [0, "EOF"],
  ]);

  it("expands block references (nested, scaled, rotated) and keeps their layer", () => {
    const n = readDxfVectors(text);
    expect(n.insunits).toBe(4);
    expect(n.expandedInserts).toBe(6);
    const squares = n.paths.filter((p) => p.closed && p.points.length === 4);
    expect(squares).toHaveLength(4);
    const has = (x: number, y: number) => squares.some((s) => s.points.some(([px, py]) => Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9));
    // Scaled 2 at (100, 0): marks at (100, 0)–(102, 2) and (110, 0)–(112, 2).
    expect(has(100, 0) && has(102, 2) && has(110, 0) && has(112, 2)).toBe(true);
    // Rotated 90° at (0, 100): the second mark at (0, 105)–(−1, 106).
    expect(has(0, 105) && has(-1, 106)).toBe(true);
    expect(squares.filter((s) => s.layer === "marks")).toHaveLength(2);
  });

  it("reads arcs, circles and bulges as polylines, texts, units and layers that are off", () => {
    const n = readDxfVectors(text);
    const arc = n.paths.find((p) => !p.closed && Math.abs(p.points[0][0] - 5) < 1e-9 && p.points[0][1] === 0)!;
    const end = arc.points[arc.points.length - 1];
    expect(end[0]).toBeCloseTo(-5, 9);
    expect(end[1]).toBeCloseTo(0, 9);
    const circle = n.paths.find((p) => p.closed && p.points.length > 20)!;
    for (const [x, y] of circle.points) expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(2, 9);
    const bulged = n.paths.find((p) => p.points[0][0] === 0 && p.points[0][1] === -10)!;
    expect(bulged.points.some(([x, y]) => Math.abs(x - 2) < 1e-6 && Math.abs(y + 12) < 1e-6)).toBe(true);
    expect(n.texts.map((t) => t.text)).toEqual(["Section A-A", "Profile 3"]);
    expect(n.layers).toEqual([{ name: "marks", off: false }, { name: "hidden", off: true }]);
    const d = fromDrawingCoordinates({ ...n, paperSpaceEntities: 3 }, "DXF");
    expect(d.metersPerUnit).toBe(0.001);
    expect(d.layersOff).toEqual(["hidden"]);
    expect(d.notes.join(" ")).toMatch(/paper space, 3 entities/);
    expect(d.texts[0].v).toBe(-30);
  });
});

describe("segment grid", () => {
  it("finds every segment near a point, as a scan of all of them does", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 1000;
    const paths = Array.from({ length: 3000 }, () => {
      const x = rnd();
      const y = rnd();
      return { pts: [[x, y], [x + (rnd() - 500) / 5, y + (rnd() - 500) / 5]] as Pt[] };
    });
    // A long diagonal crossing everything.
    paths.push({ pts: [[0, 0], [1000, 1000]] });
    const d = drawing(paths);
    const index = new SegmentIndex(d);
    expect(index.count).toBe(3001);
    for (let k = 0; k < 50; k++) {
      const r = { x0: rnd(), y0: rnd(), x1: 0, y1: 0 };
      r.x1 = r.x0 + 20;
      r.y1 = r.y0 + 20;
      const found = new Set<number>();
      index.query(r, (s) => found.add(s));
      for (let s = 0; s < index.count; s++) {
        // Every segment that really crosses the box is found (sampled along it).
        let crosses = false;
        for (let t = 0; t <= 1 && !crosses; t += 0.001) {
          const x = index.x0[s] + (index.x1[s] - index.x0[s]) * t;
          const y = index.y0[s] + (index.y1[s] - index.y0[s]) * t;
          crosses = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
        }
        if (crosses) expect(found.has(s)).toBe(true);
      }
    }
  });
});

describe("snapping to drawings", () => {
  // An L of two lines meeting at (10, 0), and a line crossing the first at (5, 0).
  const d = drawing([
    { pts: [[0, 0], [10, 0]] },
    { pts: [[10, 0], [10, 10]] },
    { pts: [[5, -5], [5, 5]] },
  ]);

  it("prefers an end point or an intersection to a point on a line", () => {
    const s = [source(d)];
    expect(snapToDrawings(s, 9.6, 0.3, 1)).toMatchObject({ kind: "endpoint", point: [10, 0] });
    expect(snapToDrawings(s, 5.4, 0.4, 1)).toMatchObject({ kind: "intersection", point: [5, 0] });
    const on = snapToDrawings(s, 7.5, 0.4, 1)!;
    expect(on.kind).toBe("line");
    expect(on.point[0]).toBeCloseTo(7.5, 12);
    expect(on.point[1]).toBeCloseTo(0, 12);
    expect(on.direction).toEqual([1, 0]);
    expect(snapToDrawings(s, 7.5, 3, 1)).toBeNull();
  });

  it("works in model coordinates through the placement, inside its crop, on its shown layers", () => {
    // Source y down, 2 m per unit, moved by (100, 50).
    const m: Affine = { a: 2, b: 0, c: 0, d: -2, e: 100, f: 50 };
    expect(snapToDrawings([source(d, m)], 119.5, 50.5, 1)).toMatchObject({ kind: "endpoint", point: [120, 50] });
    // Cropped to x < 8: the corner at 10 is outside.
    const cropped = source(d, m, { crop: { x0: -1, y0: -6, x1: 8, y1: 11 } });
    expect(snapToDrawings([cropped], 119.5, 50.5, 1)).toBeNull();
    const layered = drawing([{ pts: [[0, 0], [10, 0]], layer: 1 }], ["a", "b"]);
    expect(snapToDrawings([source(layered, ID, { hiddenLayers: ["b"] })], 10, 0.1, 1)).toBeNull();
    expect(snapToDrawings([source(layered, ID, { hiddenLayers: ["a"] })], 10, 0.1, 1)).toMatchObject({ kind: "endpoint" });
  });

  it("intersects segments, ends included", () => {
    expect(segmentIntersection([0, 0], [2, 2], [0, 2], [2, 0])).toEqual([1, 1]);
    expect(segmentIntersection([0, 0], [1, 0], [2, -1], [2, 1])).toBeNull();
    expect(segmentIntersection([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull();
  });

  it("stays fast with 50 000 segments", () => {
    const paths = Array.from({ length: 50_000 }, (_, i) => ({ pts: [[(i % 250) * 4, Math.floor(i / 250) * 4], [(i % 250) * 4 + 3, Math.floor(i / 250) * 4 + 1]] as Pt[] }));
    const s = [source(drawing(paths))];
    const t0 = performance.now();
    for (let k = 0; k < 200; k++) snapToDrawings(s, (k * 7) % 1000, (k * 13) % 800, 2);
    expect((performance.now() - t0) / 200).toBeLessThan(5);
  });
});

describe("picking lines", () => {
  // An outline drawn as four separate lines, a line branching off it, and an open polyline.
  const d = drawing([
    { pts: [[0, 0], [10, 0]] },
    { pts: [[10, 0], [10, 10]] },
    { pts: [[10, 10], [0, 10]] },
    { pts: [[0, 10], [0, 0]] },
    { pts: [[20, 0], [30, 0], [30, 5]] },
    { pts: [[30, 5], [40, 5]] },
    { pts: [[40, 5], [50, 5]] },
    { pts: [[40, 5], [40, 20]] },
  ]);

  it("chains lines end to end into a closed loop", () => {
    const c = connectedChain(d, 0, undefined);
    expect(c.closed).toBe(true);
    expect(c.paths.sort()).toEqual([0, 1, 2, 3]);
    expect(c.points).toHaveLength(4);
  });

  it("stops at a junction where three lines meet", () => {
    const c = connectedChain(d, 4, undefined);
    expect(c.closed).toBe(false);
    expect(c.paths.sort()).toEqual([4, 5]);
    expect(c.points).toEqual([[20, 0], [30, 0], [30, 5], [40, 5]]);
  });

  it("joins ends within the tolerance only", () => {
    const near = drawing([{ pts: [[0, 0], [1, 0]] }, { pts: [[1 + 1e-9, 0], [2, 0]] }, { pts: [[2.5, 0], [3, 0]] }]);
    const c = connectedChain(near, 0, undefined, chainTolerance(near));
    expect(c.paths.sort()).toEqual([0, 1]);
    expect(joinChains([c, connectedChain(near, 2, undefined)], chainTolerance(near))).toHaveLength(2);
    expect(joinChains([c, connectedChain(near, 2, undefined)], 0.6)).toHaveLength(1);
  });

  it("picks the line under the pointer and the lines inside a window", () => {
    const s = source(d);
    expect(pathAt(s, 5, 0.2, 0.5)).toBe(0);
    expect(pathAt(s, 5, 2, 0.5)).toBeNull();
    const inside = chainsInWindow(s, { x0: 19, y0: -1, x1: 41, y1: 6 });
    expect(inside.map((c) => c.paths[0]).sort()).toEqual([4, 5]);
  });

  it("clips to the crop and takes the lines into the model", () => {
    const pieces = clipToCrop([[0, 0], [10, 0], [10, 10]], false, { x0: 2, y0: -1, x1: 8, y1: 11 });
    expect(pieces).toEqual([{ points: [[2, 0], [8, 0]], closed: false }]);
    const whole = clipToCrop([[1, 1], [2, 1], [2, 2]], true, { x0: 0, y0: 0, x1: 5, y1: 5 });
    expect(whole[0].closed).toBe(true);
    const m: Affine = { a: 2, b: 0, c: 0, d: -2, e: 0, f: 100 };
    const lines = pickedToModel([connectedChain(d, 0, undefined)], { transform: m }, 1e-9);
    expect(lines).toEqual([{ points: [[0, 100], [20, 100], [20, 80], [0, 80]], closed: true }]);
  });

  it("makes an exterior of one closed loop, offers to close a small gap, explains otherwise", () => {
    expect(exteriorFrom([{ points: [[0, 0], [1, 0], [1, 1]], closed: true }], 0.1)).toEqual({ ok: true, coordinates: [[0, 0], [1, 0], [1, 1]] });
    const gap = exteriorFrom([{ points: [[0, 0], [1, 0], [1, 1], [0.05, 0]], closed: false }], 0.1);
    expect(gap).toMatchObject({ ok: false, gap: 0.05 });
    const far = exteriorFrom([{ points: [[0, 0], [1, 0], [1, 1]], closed: false }], 0.1);
    expect(far).toMatchObject({ ok: false });
    expect((far as { error: string }).error).toMatch(/1\.41 m apart/);
    expect((exteriorFrom([{ points: [[0, 0], [1, 0]], closed: false }, { points: [[5, 5], [6, 6]], closed: false }], 0.1) as { error: string }).error).toMatch(/2 separate pieces/);
  });
});
