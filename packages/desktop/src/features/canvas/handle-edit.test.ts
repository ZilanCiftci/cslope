import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_PIEZO_LINE } from "../../store/defaults";
import { surfaceYAtX } from "../view/surface";
import { handleAxes, handlePosition, moveHandleTo, nudgeHandle } from "./handle-edit";

const s = () => useAppStore.getState();
const ground = (x: number) => surfaceYAtX(s().coordinates, x);

beforeEach(() => {
  s().newProject();
  useAppStore.setState({
    coordinates: [
      [0, 0],
      [0, 10],
      [10, 10],
      [20, 5],
      [30, 5],
      [30, 0],
    ],
    coordinateExpressions: [{}, {}, { x: "L" }],
    piezometricLine: {
      ...DEFAULT_PIEZO_LINE,
      lines: [
        { id: "w", name: "w", color: "#000", coordinates: [[0, 8], [30, 6]], coordinateExpressions: [{ y: "H" }] },
        { id: "v", name: "v", color: "#000", coordinates: [[0, 1], [30, 1]] },
      ],
      activeLineId: "v",
    },
    udls: [{ id: "u", magnitude: 10, x1: 2, x2: 8, expressions: { x1: "A" } }],
    lineLoads: [{ id: "l", magnitude: 5, x: 25 }],
    customSearchPlanes: [{ id: "c", cx: 15, cy: 14, radius: 10 }],
  });
});

describe("moveHandleTo", () => {
  it("moves a vertex, keeping an axis an expression drives", () => {
    expect(moveHandleTo(s(), s(), { type: "exterior" }, 2, [12, 11])).toBe(true);
    expect(s().coordinates[2]).toEqual([10, 11]);
    moveHandleTo(s(), s(), { type: "exterior" }, 3, [21, 6]);
    expect(s().coordinates[3]).toEqual([21, 6]);
  });

  it("moves a water line's point, making the line the active one", () => {
    moveHandleTo(s(), s(), { type: "waterLine", id: "w" }, 0, [1, 9]);
    expect(s().piezometricLine.activeLineId).toBe("w");
    expect(s().piezometricLine.lines[0].coordinates[0]).toEqual([1, 8]);
  });

  it("moves loads and limits along x only, not an end an expression fixes", () => {
    expect(moveHandleTo(s(), s(), { type: "udl", id: "u" }, "x1", [4, 99])).toBe(false);
    moveHandleTo(s(), s(), { type: "udl", id: "u" }, "x2", [9, 99]);
    expect(s().udls[0]).toMatchObject({ x1: 2, x2: 9 });
    moveHandleTo(s(), s(), { type: "lineLoad", id: "l" }, "x", [22, 0]);
    expect(s().lineLoads[0].x).toBe(22);
    moveHandleTo(s(), s(), { type: "searchLimits" }, "exitLeftX", [18, 0]);
    expect(s().analysisLimits.exitLeftX).toBe(18);
  });

  it("moves a circle's centre, or sets its radius from the rim", () => {
    moveHandleTo(s(), s(), { type: "customPlane", id: "c" }, "centre", [16, 15]);
    expect(s().customSearchPlanes[0]).toMatchObject({ cx: 16, cy: 15, radius: 10 });
    moveHandleTo(s(), s(), { type: "customPlane", id: "c" }, "rim", [16, 3]);
    expect(s().customSearchPlanes[0].radius).toBe(12);
    moveHandleTo(s(), s(), { type: "customPlane", id: "c" }, "rim", [16, 15]);
    expect(s().customSearchPlanes[0].radius).toBe(0.1);
  });

  it("moves an end of a reinforcement element and of a pile", () => {
    s().addReinforcement("nail");
    s().addPile("pile");
    const r = s().reinforcements[0];
    const p = s().piles[0];
    moveHandleTo(s(), s(), { type: "reinforcement", id: r.id }, "end1", [3, 4]);
    moveHandleTo(s(), s(), { type: "pile", id: p.id }, "end2", [5, -6]);
    expect(s().reinforcements[0]).toMatchObject({ x1: 3, y1: 4, x2: r.x2, y2: r.y2 });
    expect(s().piles[0]).toMatchObject({ x1: p.x1, y1: p.y1, x2: 5, y2: -6 });
  });
});

describe("nudgeHandle and handlePosition", () => {
  it("nudges a vertex both ways, a load only along x, a rim's radius", () => {
    nudgeHandle(s(), s(), { type: "exterior" }, 3, 0.5, -0.5, ground);
    expect(s().coordinates[3]).toEqual([20.5, 4.5]);
    expect(nudgeHandle(s(), s(), { type: "lineLoad", id: "l" }, "x", 0, 1, ground)).toBe(false);
    nudgeHandle(s(), s(), { type: "lineLoad", id: "l" }, "x", -1, 0, ground);
    expect(s().lineLoads[0].x).toBe(24);
    nudgeHandle(s(), s(), { type: "customPlane", id: "c" }, "rim", 0, -1, ground);
    expect(s().customSearchPlanes[0].radius).toBe(9);
  });

  it("knows each handle's position and axes", () => {
    expect(handlePosition(s(), { type: "udl", id: "u" }, "x2", ground)).toEqual([8, 10]);
    expect(handlePosition(s(), { type: "customPlane", id: "c" }, "rim", ground)).toEqual([25, 14]);
    expect(handleAxes({ type: "udl", id: "u" }, "x1")).toBe("x");
    expect(handleAxes({ type: "customPlane", id: "c" }, "rim")).toBe("radius");
    expect(handleAxes({ type: "boundary", id: "b" }, 0)).toBe("xy");
  });
});
