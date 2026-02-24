import { describe, expect, it } from "vitest";
import {
  getYAtX,
  getYAtXMany,
  getYAtXStrict,
  getLineBetweenPoints,
} from "./interpolation";

const polyX = [0, 5, 10];
const polyY = [0, 10, 5];

describe("getYAtX", () => {
  it("interpolates midpoint of first segment (golden: 5.0)", () => {
    expect(getYAtX(polyX, polyY, 2.5)).toBeCloseTo(5.0, 10);
  });

  it("interpolates midpoint of second segment (golden: 7.5)", () => {
    expect(getYAtX(polyX, polyY, 7.5)).toBeCloseTo(7.5, 10);
  });

  it("returns NaN for out-of-range x", () => {
    expect(getYAtX(polyX, polyY, -1)).toBeNaN();
    expect(getYAtX(polyX, polyY, 11)).toBeNaN();
  });

  it("returns exact vertex values", () => {
    expect(getYAtX(polyX, polyY, 0)).toBeCloseTo(0, 10);
    expect(getYAtX(polyX, polyY, 5)).toBeCloseTo(10, 10);
    expect(getYAtX(polyX, polyY, 10)).toBeCloseTo(5, 10);
  });
});

describe("getYAtXMany", () => {
  it("returns correct values for multiple x", () => {
    const result = getYAtXMany(polyX, polyY, [0, 2.5, 5, 7.5, 10]);
    expect(result[0]).toBeCloseTo(0, 10);
    expect(result[1]).toBeCloseTo(5, 10);
    expect(result[2]).toBeCloseTo(10, 10);
    expect(result[3]).toBeCloseTo(7.5, 10);
    expect(result[4]).toBeCloseTo(5, 10);
  });
});

describe("getYAtXStrict", () => {
  const line: [number[], number[]] = [
    [0, 5, 10],
    [0, 10, 5],
  ];

  it("interpolates correctly", () => {
    expect(getYAtXStrict(line, 2.5)).toBeCloseTo(5.0, 10);
  });

  it("throws for out-of-range x", () => {
    expect(() => getYAtXStrict(line, -5)).toThrow(RangeError);
    expect(() => getYAtXStrict(line, 15)).toThrow(RangeError);
  });
});

describe("getLineBetweenPoints", () => {
  const line: [number[], number[]] = [
    [0, 2, 5, 8, 10],
    [0, 4, 10, 6, 5],
  ];

  it("extracts segment between x=1 and x=6", () => {
    const [xOut] = getLineBetweenPoints(line, 1, 6);
    expect(xOut[0]).toBe(1);
    expect(xOut[xOut.length - 1]).toBe(6);
    // Inner points (2, 5) should be included
    expect(xOut).toContain(2);
    expect(xOut).toContain(5);
  });

  it("throws for out-of-range x", () => {
    expect(() => getLineBetweenPoints(line, -1, 5)).toThrow(RangeError);
  });
});
