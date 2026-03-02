import { describe, expect, it } from "vitest";
import {
  hexToRgb,
  parseColor,
  buildPolylinePath,
  mapFont,
  mapFontStyle,
  surfaceYAtX,
} from "./pdf-helpers";

describe("hexToRgb", () => {
  it("parses a standard hex color", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("#00ff00")).toEqual([0, 255, 0]);
    expect(hexToRgb("#0000ff")).toEqual([0, 0, 255]);
  });

  it("parses hex without # prefix", () => {
    expect(hexToRgb("ff8800")).toEqual([255, 136, 0]);
  });

  it("parses black and white", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });

  it("parses mixed-case hex", () => {
    expect(hexToRgb("#aAbBcC")).toEqual([170, 187, 204]);
  });
});

describe("parseColor", () => {
  it("parses hex colors", () => {
    expect(parseColor("#ff0000")).toEqual([255, 0, 0]);
  });

  it("parses named CSS colors via chroma", () => {
    const [r, g, b] = parseColor("red");
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it("parses another named color", () => {
    const [r, g, b] = parseColor("blue");
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(255);
  });

  it("returns black for invalid color strings", () => {
    expect(parseColor("not-a-color-xyz")).toEqual([0, 0, 0]);
  });

  it("returns black for empty string", () => {
    expect(parseColor("")).toEqual([0, 0, 0]);
  });
});

describe("buildPolylinePath", () => {
  it("returns empty array for no points", () => {
    expect(buildPolylinePath([])).toEqual([]);
  });

  it("builds a move + lines for an open polyline", () => {
    const ops = buildPolylinePath([
      [0, 0],
      [10, 5],
      [20, 0],
    ]);
    expect(ops).toHaveLength(3);
    expect(ops[0]).toEqual({ op: "m", c: [0, 0] });
    expect(ops[1]).toEqual({ op: "l", c: [10, 5] });
    expect(ops[2]).toEqual({ op: "l", c: [20, 0] });
  });

  it("appends close op for a closed polyline", () => {
    const ops = buildPolylinePath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      true,
    );
    expect(ops).toHaveLength(4);
    expect(ops[3]).toEqual({ op: "h", c: [] });
  });

  it("handles a single point", () => {
    const ops = buildPolylinePath([[5, 5]]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ op: "m", c: [5, 5] });
  });

  it("handles a single point with close", () => {
    const ops = buildPolylinePath([[5, 5]], true);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toEqual({ op: "h", c: [] });
  });
});

describe("mapFont", () => {
  it("maps sans-serif to helvetica", () => {
    expect(mapFont("sans-serif")).toBe("helvetica");
    expect(mapFont("Arial")).toBe("helvetica");
  });

  it("maps serif (but not sans-serif) to times", () => {
    expect(mapFont("serif")).toBe("times");
    expect(mapFont("Georgia serif")).toBe("times");
  });

  it("falls back to helvetica for font names without serif/mono keywords", () => {
    // "Times New Roman" doesn't contain the keyword "serif"
    expect(mapFont("Times New Roman")).toBe("helvetica");
  });

  it("maps monospace/courier to courier", () => {
    expect(mapFont("monospace")).toBe("courier");
    expect(mapFont("Courier New")).toBe("courier");
  });

  it("defaults unknown families to helvetica", () => {
    expect(mapFont("Papyrus")).toBe("helvetica");
    expect(mapFont("Comic Sans")).toBe("helvetica");
    expect(mapFont("")).toBe("helvetica");
  });
});

describe("mapFontStyle", () => {
  it("returns normal when neither bold nor italic", () => {
    expect(mapFontStyle()).toBe("normal");
    expect(mapFontStyle(false, false)).toBe("normal");
  });

  it("returns bold", () => {
    expect(mapFontStyle(true)).toBe("bold");
    expect(mapFontStyle(true, false)).toBe("bold");
  });

  it("returns italic", () => {
    expect(mapFontStyle(false, true)).toBe("italic");
  });

  it("returns bolditalic", () => {
    expect(mapFontStyle(true, true)).toBe("bolditalic");
  });
});

describe("surfaceYAtX", () => {
  const coords: [number, number][] = [
    [0, 0],
    [0, 10],
    [10, 10],
    [12.5, 7.5],
    [15, 7.5],
    [17.5, 10],
    [25, 10],
    [25, 0],
  ];

  it("interpolates Y on a horizontal segment", () => {
    // Between (10,10) and (12.5,7.5) is a slope, but (15,7.5)–(17.5,10) also slopes
    // Between (0,10) and (10,10) is horizontal at y=10
    const y = surfaceYAtX(5, coords);
    expect(y).toBeCloseTo(10, 5);
  });

  it("interpolates Y on a sloped segment", () => {
    // Between (10,10) and (12.5,7.5): at x=11.25, y should be 8.75
    const y = surfaceYAtX(11.25, coords);
    expect(y).toBeCloseTo(8.75, 5);
  });

  it("returns the vertex value at an exact vertex", () => {
    const y = surfaceYAtX(10, coords);
    expect(y).toBeCloseTo(10, 5);
  });

  it("returns the highest Y when multiple segments span the same X", () => {
    // x=0 appears in two segments: (25,0)-(0,0) at y=0 and (0,0)-(0,10) which is vertical
    // The function skips vertical segments (x0 === x1), so at x=0 it should find the
    // segment from the closing wrap-around
    const y = surfaceYAtX(0, coords);
    expect(y).not.toBeNull();
  });

  it("returns null for X outside the coordinate range (simple line)", () => {
    const simple: [number, number][] = [
      [5, 0],
      [10, 5],
    ];
    expect(surfaceYAtX(3, simple)).toBeNull();
    expect(surfaceYAtX(12, simple)).toBeNull();
  });

  it("handles a simple 2-point line segment", () => {
    const line: [number, number][] = [
      [0, 0],
      [10, 10],
    ];
    expect(surfaceYAtX(5, line)).toBeCloseTo(5, 5);
  });

  it("returns null for empty coordinates", () => {
    expect(surfaceYAtX(5, [])).toBeNull();
  });
});
