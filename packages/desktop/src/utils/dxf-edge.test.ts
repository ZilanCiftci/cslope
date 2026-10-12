import { describe, expect, it } from "vitest";
import { dxfToGeometry, parseDxf } from "./dxf";

/** Build DXF text from [code, value] pairs. */
const dxf = (pairs: (string | number)[][]) =>
  pairs.map(([c, v]) => `${c}\n${v}`).join("\n") + "\n";

const entities = (...body: (string | number)[][]) =>
  dxf([[0, "SECTION"], [2, "ENTITIES"], ...body, [0, "ENDSEC"], [0, "EOF"]]);

const withUnits = (units: number, ...body: (string | number)[][]) =>
  dxf([
    [0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, units], [0, "ENDSEC"],
    [0, "SECTION"], [2, "ENTITIES"], ...body, [0, "ENDSEC"], [0, "EOF"],
  ]);

const line = (layer: string, a: number[], b: number[]) => [
  [0, "LINE"], [8, layer], [10, a[0]], [20, a[1]], [11, b[0]], [21, b[1]],
];

const lw = (layer: string, closed: boolean, pts: number[][]) => [
  [0, "LWPOLYLINE"], [8, layer], [70, closed ? 1 : 0],
  ...pts.flatMap(([x, y]) => [[10, x], [20, y]]),
];

const polyline = (layer: string, flags: number, pts: (number | null)[][]) => [
  [0, "POLYLINE"], [8, layer], [66, 1], [70, flags],
  ...pts.flatMap(([x, y]) => [
    [0, "VERTEX"], [8, layer],
    ...(x === null ? [] : [[10, x]]),
    ...(y === null ? [] : [[20, y]]),
  ]),
  [0, "SEQEND"], [8, layer],
];

describe("parseDxf: old-style POLYLINE entities", () => {
  it("reads VERTEX entities up to SEQEND, closed by flag", () => {
    const d = parseDxf(
      entities(
        ...polyline("Outline", 1, [[0, 0], [10, 0], [10, 5]]),
        ...polyline("Layer", 0, [[0, 2], [10, 3]]),
      ),
    );
    expect(d.polylines).toEqual([
      { layer: "Outline", points: [[0, 0], [10, 0], [10, 5]], closed: true },
      { layer: "Layer", points: [[0, 2], [10, 3]], closed: false },
    ]);
    expect(d.skipped).toEqual({});
  });

  it("drops vertices without both coordinates", () => {
    const d = parseDxf(
      entities(...polyline("a", 0, [[0, 0], [5, null], [null, 7], [10, 1]])),
    );
    expect(d.polylines[0].points).toEqual([[0, 0], [10, 1]]);
  });

  it("closes a polyline drawn back to its start and drops repeated points", () => {
    const d = parseDxf(
      entities(...polyline("a", 0, [[0, 0], [0, 0], [4, 0], [4, 3], [0, 0]])),
    );
    expect(d.polylines[0]).toEqual({
      layer: "a",
      points: [[0, 0], [4, 0], [4, 3]],
      closed: true,
    });
  });

  it("ignores a polyline that ends up with fewer than two points", () => {
    const d = parseDxf(entities(...polyline("a", 0, [[1, 1], [1, 1]])));
    expect(d.polylines).toEqual([]);
  });
});

describe("parseDxf: LINE chaining", () => {
  it("chains lines drawn in any order and direction", () => {
    const d = parseDxf(
      entities(
        ...line("L", [10, 0], [20, 0]),
        // Reversed, attaches to the tail.
        ...line("L", [30, 0], [20, 0]),
        // Attaches to the head.
        ...line("L", [0, 0], [10, 0]),
        // Reversed, attaches to the new head.
        ...line("L", [0, 0], [-10, 0]),
      ),
    );
    expect(d.polylines).toEqual([
      { layer: "L", points: [[-10, 0], [0, 0], [10, 0], [20, 0], [30, 0]], closed: false },
    ]);
  });

  it("does not chain lines of different layers or that do not touch", () => {
    const d = parseDxf(
      entities(
        ...line("A", [0, 0], [1, 0]),
        ...line("B", [1, 0], [2, 0]),
        ...line("A", [5, 0], [6, 0]),
      ),
    );
    expect(d.polylines.map((p) => [p.layer, p.points])).toEqual([
      ["A", [[0, 0], [1, 0]]],
      ["B", [[1, 0], [2, 0]]],
      ["A", [[5, 0], [6, 0]]],
    ]);
  });

  it("a ring of lines becomes a closed polyline usable as the boundary", () => {
    const d = parseDxf(
      entities(
        ...line("P", [0, 0], [10, 0]),
        ...line("P", [10, 0], [10, 5]),
        ...line("P", [10, 5], [0, 5]),
        ...line("P", [0, 5], [0, 0]),
      ),
    );
    expect(d.polylines).toHaveLength(1);
    expect(d.polylines[0].closed).toBe(true);
    expect(dxfToGeometry(d).coordinates).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it("drops lines with missing coordinates and uses layer 0 by default", () => {
    const d = parseDxf(
      entities(
        [0, "LINE"], [10, 0], [20, 0], [11, 1],
        [0, "LINE"], [10, 0], [20, 0], [11, 3], [21, 4],
      ),
    );
    expect(d.polylines).toEqual([
      { layer: "0", points: [[0, 0], [3, 4]], closed: false },
    ]);
  });
});

describe("parseDxf: units and sections", () => {
  it.each([
    [1, 0.0254, "inches"],
    [2, 0.3048, "feet"],
    [5, 0.01, "centimetres"],
    [7, 1000, "kilometres"],
  ])("$INSUNITS %i scales by %f (%s)", (units, scale, name) => {
    // 1000 drawing units across: large enough to be taken at face value.
    const d = parseDxf(withUnits(units, ...lw("a", false, [[0, 0], [1000, 0]])));
    expect(d.unitScale).toBe(scale);
    expect(d.unitNote).toBe(`Drawing units: ${name}, converted to metres.`);
    expect(d.polylines[0].points[1][0]).toBeCloseTo(1000 * scale, 9);
  });

  it("treats unknown or unitless $INSUNITS as metres without a note", () => {
    for (const units of [0, 3, 99]) {
      const d = parseDxf(withUnits(units, ...lw("a", false, [[0, 0], [2, 0]])));
      expect(d.unitScale).toBe(1);
      expect(d.unitNote).toBeUndefined();
    }
  });

  it("keeps the declared units for an empty drawing", () => {
    const d = parseDxf(withUnits(4));
    expect(d.polylines).toEqual([]);
    expect(d.unitScale).toBe(0.001);
    expect(d.unitNote).toMatch(/millimetres/);
  });

  it("a tiny drawing (under one unit) keeps its declared units", () => {
    const d = parseDxf(withUnits(2, ...lw("a", false, [[0, 0], [0.5, 0]])));
    expect(d.unitScale).toBe(0.3048);
  });

  it("reads entities only inside the ENTITIES section", () => {
    const text = dxf([
      [0, "SECTION"], [2, "BLOCKS"],
      ...lw("inblock", false, [[0, 0], [1, 1]]),
      [0, "ENDSEC"],
      [0, "SECTION"], [2, "ENTITIES"],
      ...lw("real", false, [[0, 0], [2, 2]]),
      [0, "SPLINE"], [8, "s"],
      [0, "INSERT"], [8, "i"],
      [0, "SPLINE"], [8, "s"],
      [0, "ENDSEC"], [0, "EOF"],
    ]);
    const d = parseDxf(text);
    expect(d.polylines.map((p) => p.layer)).toEqual(["real"]);
    expect(d.skipped).toEqual({ SPLINE: 2, INSERT: 1 });
  });

  it("accepts CR and CRLF line endings and padded codes", () => {
    const text = entities(...lw("a", false, [[0, 0], [3, 4]]))
      .split("\n")
      .map((l, i) => (i % 2 === 0 ? `  ${l}` : l))
      .join("\r");
    expect(parseDxf(text).polylines[0].points).toEqual([[0, 0], [3, 4]]);
    const crlf = entities(...lw("a", false, [[0, 0], [3, 4]])).replace(/\n/g, "\r\n");
    expect(parseDxf(crlf).polylines[0].points).toEqual([[0, 0], [3, 4]]);
  });
});

describe("dxfToGeometry", () => {
  const outline = lw("Outline", true, [[0, 0], [100, 0], [100, 50], [0, 50]]);

  it("picks the largest closed polyline as the boundary; smaller loops are lenses", () => {
    const g = dxfToGeometry(
      parseDxf(
        entities(
          ...lw("Lens", true, [[10, 10], [20, 10], [20, 20]]),
          ...outline,
        ),
      ),
    );
    expect(g.coordinates).toEqual([[0, 0], [100, 0], [100, 50], [0, 50]]);
    expect(g.materialBoundaries).toEqual([[[10, 10], [20, 10], [20, 20], [10, 10]]]);
  });

  it("ignores a closed polyline with fewer than three points for the boundary", () => {
    const d = parseDxf(entities(...lw("x", true, [[0, 0], [1, 1]])));
    expect(() => dxfToGeometry(d)).toThrow(/no closed polyline/);
  });

  it.each(["Water", "PIEZO_1", "gw", "GW-2", "Grundvatten", "vatten", "wt", "my wt"])(
    "layer %s is a water line",
    (layer) => {
      const g = dxfToGeometry(
        parseDxf(entities(...outline, ...lw(layer, false, [[50, 30], [0, 25], [100, 35]]))),
      );
      expect(g.waterLines).toEqual([[[0, 25], [50, 30], [100, 35]]]);
      expect(g.materialBoundaries).toEqual([]);
    },
  );

  it.each(["gwt", "growth", "Clay", "wtx"])("layer %s is a material boundary", (layer) => {
    const g = dxfToGeometry(
      parseDxf(entities(...outline, ...lw(layer, false, [[0, 25], [100, 35]]))),
    );
    expect(g.waterLines).toEqual([]);
    expect(g.materialBoundaries).toEqual([[[0, 25], [100, 35]]]);
  });

  it("a closed loop on a water layer is a lens, not a water line", () => {
    const g = dxfToGeometry(
      parseDxf(entities(...outline, ...lw("water", true, [[10, 10], [20, 10], [20, 20]]))),
    );
    expect(g.waterLines).toEqual([]);
    expect(g.materialBoundaries).toHaveLength(1);
  });
});
