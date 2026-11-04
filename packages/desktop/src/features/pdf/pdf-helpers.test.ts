import { describe, expect, it } from "vitest";
import { PDF_SANS } from "./pdf-fonts";
import {
  hexToRgb,
  parseColor,
  buildPolylinePath,
  mapFont,
  mapFontStyle,
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

  it("parses short and alpha hex colours (valid on the canvas) without NaN", () => {
    expect(parseColor("#0a8")).toEqual([0, 170, 136]);
    expect(parseColor("#ff000080")).toEqual([255, 0, 0]);
    expect(parseColor("#zzz")).toEqual([0, 0, 0]);
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
  it("maps sans-serif to the embedded sans font", () => {
    expect(mapFont("sans-serif")).toBe(PDF_SANS);
    expect(mapFont("Arial")).toBe(PDF_SANS);
  });

  it("maps serif (but not sans-serif) to times", () => {
    expect(mapFont("serif")).toBe("times");
    expect(mapFont("Georgia serif")).toBe("times");
  });

  it("falls back to the embedded sans font for font names without serif/mono keywords", () => {
    // "Times New Roman" doesn't contain the keyword "serif"
    expect(mapFont("Times New Roman")).toBe(PDF_SANS);
  });

  it("maps monospace/courier to courier", () => {
    expect(mapFont("monospace")).toBe("courier");
    expect(mapFont("Courier New")).toBe("courier");
  });

  it("defaults unknown families to the embedded sans font", () => {
    expect(mapFont("Papyrus")).toBe(PDF_SANS);
    expect(mapFont("Comic Sans")).toBe(PDF_SANS);
    expect(mapFont("")).toBe(PDF_SANS);
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

