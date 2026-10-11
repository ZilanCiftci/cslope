import { describe, expect, it } from "vitest";
import { dxfToGeometry, parseDxf } from "./dxf";

/** Build DXF text from [code, value] pairs. */
const dxf = (pairs: (string | number)[][]) => pairs.map(([c, v]) => `${c}\n${v}`).join("\n") + "\n";

const lw = (layer: string, closed: boolean, pts: number[][]) => [
  [0, "LWPOLYLINE"], [8, layer], [90, pts.length], [70, closed ? 1 : 0],
  ...pts.flatMap(([x, y]) => [[10, x], [20, y]]),
];
const line = (layer: string, a: number[], b: number[]) => [
  [0, "LINE"], [8, layer], [10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0],
];

const DRAWING = dxf([
  [0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, 6], [0, "ENDSEC"],
  [0, "SECTION"], [2, "ENTITIES"],
  ...lw("Profile", true, [[0, -10], [0, 0], [20, 0], [40, -10], [60, -10], [60, -20], [0, -20]]),
  ...lw("Grundvatten", false, [[60, -12], [30, -8], [0, -3]]),
  // A layer boundary drawn as two LINEs
  ...line("Lager", [0, -14], [30, -15]),
  ...line("Lager", [30, -15], [60, -16]),
  [0, "ARC"], [8, "x"], [10, 1], [20, 1], [40, 2], [50, 0], [51, 90],
  // A lens, closed by repeating its first point
  ...lw("Lins", false, [[20, -12], [25, -12], [25, -13], [20, -12]]),
  [0, "ENDSEC"], [0, "EOF"],
]);

describe("DXF import", () => {
  it("reads polylines, chains lines and counts skipped entities", () => {
    const d = parseDxf(DRAWING);
    expect(d.unitScale).toBe(1);
    expect(d.skipped).toEqual({ ARC: 1 });
    const layers = d.polylines.map((p) => p.layer).sort();
    expect(layers).toEqual(["Grundvatten", "Lager", "Lins", "Profile"]);
    const chained = d.polylines.find((p) => p.layer === "Lager")!;
    expect(chained.points).toEqual([[0, -14], [30, -15], [60, -16]]);
    expect(d.polylines.find((p) => p.layer === "Lins")!.closed).toBe(true);
  });

  it("maps boundary, water line and material boundaries", () => {
    const g = dxfToGeometry(parseDxf(DRAWING));
    expect(g.coordinates).toHaveLength(7);
    expect(g.waterLines).toEqual([[[0, -3], [30, -8], [60, -12]]]);
    expect(g.materialBoundaries).toHaveLength(2);
    const lens = g.materialBoundaries.find((b) => b.length === 4)!;
    expect(lens[0]).toEqual(lens[lens.length - 1]);
  });

  it("scales millimetre drawings to metres", () => {
    const mm = dxf([
      [0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, 4], [0, "ENDSEC"],
      [0, "SECTION"], [2, "ENTITIES"],
      ...lw("p", true, [[0, -10000], [0, 0], [20000, 0], [40000, -10000], [60000, -10000], [60000, -20000]]),
      [0, "ENDSEC"], [0, "EOF"],
    ]);
    const d = parseDxf(mm);
    expect(dxfToGeometry(d).coordinates[2]).toEqual([20, 0]);
    expect(d.unitNote).toMatch(/millimetres/);
  });

  it("takes a metre drawing with a millimetre template setting as metres", () => {
    const wrongUnits = DRAWING.replace("$INSUNITS\n70\n6", "$INSUNITS\n70\n4");
    const d = parseDxf(wrongUnits);
    expect(dxfToGeometry(d).coordinates[2]).toEqual([20, 0]);
    expect(d.unitNote).toMatch(/imported as drawn in metres/);
  });

  it("does not take the next vertex's y for a vertex without one", () => {
    const text = dxf([
      [0, "SECTION"], [2, "ENTITIES"],
      [0, "LWPOLYLINE"], [8, "a"], [70, 0], [10, 0], [10, 5], [20, 1], [10, 9], [20, 2],
      [0, "ENDSEC"], [0, "EOF"],
    ]);
    expect(parseDxf(text).polylines[0].points).toEqual([[5, 1], [9, 2]]);
  });

  it("explains a drawing without a closed outline", () => {
    const open = dxf([[0, "SECTION"], [2, "ENTITIES"], ...lw("a", false, [[0, 0], [1, 1]]), [0, "ENDSEC"], [0, "EOF"]]);
    expect(() => dxfToGeometry(parseDxf(open))).toThrow(/closed polyline/);
  });

  it("rejects binary DXF", () => {
    expect(() => parseDxf("AutoCAD Binary DXF\r\n\u001a\u0000")).toThrow(/ASCII/);
  });
});
