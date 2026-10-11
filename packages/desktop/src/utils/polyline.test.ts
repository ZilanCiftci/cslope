import { describe, expect, it } from "vitest";
import { formatPolyline, parsePolyline } from "./polyline";

describe("polyline text", () => {
  it("parses and formats points", () => {
    expect(parsePolyline("10, 5; 18,1 ;30, 2;")).toEqual([[10, 5], [18, 1], [30, 2]]);
    expect(formatPolyline([[10, 5], [18, 1]])).toBe("10, 5; 18, 1");
  });
  it("rejects incomplete pairs", () => {
    expect(parsePolyline("10, 5; 18")).toBeNull();
    expect(parsePolyline("10, 5; 18,")).toBeNull();
    expect(parsePolyline("a, 1")).toBeNull();
    expect(parsePolyline("")).toEqual([]);
  });
});
