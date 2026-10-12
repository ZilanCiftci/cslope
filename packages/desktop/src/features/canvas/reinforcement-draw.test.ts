import { describe, expect, it } from "vitest";
import type { ReinforcementForce } from "@cslope/engine";
import {
  PILE_COLOR,
  REINFORCEMENT_COLOR,
  bondedSpan,
  drawPiles,
  drawReinforcementForces,
  drawReinforcements,
  formatReinforcementForce,
} from "./reinforcement-draw";
import { createRecordingContext, pathPoints } from "../../test/recording-context";
import { newPile, newReinforcement } from "../../utils/reinforcement";
import type { ReinforcementRow } from "../../store/types";

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 0],
];

/** Screen = 10 px per metre, origin at (100, 500), y up. */
const toCanvas = (x: number, y: number): [number, number] => [100 + x * 10, 500 - y * 10];

function row(over: Partial<ReinforcementRow>): ReinforcementRow {
  return { ...newReinforcement("r", "anchor", COORDS, "ltr"), x1: 5, y1: 5, x2: 15, y2: 5, ...over };
}

function force(over: Partial<ReinforcementForce>): ReinforcementForce {
  return { index: 0, x: 10, y: 5, fx: 50, fy: 0, force: 50, passive: false, ...over };
}

describe("formatReinforcementForce", () => {
  it("uses one decimal below 100 kN/m and none above", () => {
    expect(formatReinforcementForce({ force: 12.345, passive: false })).toBe("12.3 kN/m");
    expect(formatReinforcementForce({ force: 99.94, passive: false })).toBe("99.9 kN/m");
    expect(formatReinforcementForce({ force: 100, passive: false })).toBe("100 kN/m");
    expect(formatReinforcementForce({ force: 1234.6, passive: false })).toBe("1235 kN/m");
  });

  it("chooses the decimals after rounding, so 99.96 reads like 100", () => {
    expect(formatReinforcementForce({ force: 99.96, passive: false })).toBe("100 kN/m");
  });

  it("marks passive forces as divided by the factor of safety", () => {
    expect(formatReinforcementForce({ force: 20, passive: true })).toBe("20.0 kN/m /F");
  });
});

describe("bondedSpan", () => {
  it("is null without pullout or for a zero-length element", () => {
    expect(bondedSpan(row({ pullout: "none" }))).toBeNull();
    expect(bondedSpan(row({ pullout: "bond", x2: 5, y2: 5 }))).toBeNull();
  });

  it("covers the last bonded length at end 2 of a tieback", () => {
    // Length 10, bonded 4 → from 0.6 to 1.
    const span = bondedSpan(row({ pullout: "bond", bondedLength: 4 }));
    expect(span![0]).toBeCloseTo(0.6, 12);
    expect(span![1]).toBe(1);
  });

  it("covers the whole element when the bonded length is zero or too long", () => {
    expect(bondedSpan(row({ pullout: "bond", bondedLength: 0 }))).toEqual([0, 1]);
    expect(bondedSpan(row({ pullout: "bond", bondedLength: 12 }))).toEqual([0, 1]);
    expect(bondedSpan(row({ pullout: "interface" }))).toEqual([0, 1]);
  });
});

describe("drawReinforcements", () => {
  it("draws the bar between the transformed end points and balances save/restore", () => {
    const rec = createRecordingContext();
    drawReinforcements(rec.ctx, [row({ pullout: "none" })], toCanvas);
    expect(rec.depth()).toBe(0);
    const bars = rec.strokes(REINFORCEMENT_COLOR).filter((p) => p.state.lineWidth === 2);
    expect(bars).toHaveLength(1);
    expect(pathPoints(bars[0])).toEqual([
      [150, 450],
      [250, 450],
    ]);
    expect(bars[0].state.lineDash).toEqual([]);
  });

  it("draws a head plate perpendicular to the bar at end 1", () => {
    const rec = createRecordingContext();
    drawReinforcements(rec.ctx, [row({ pullout: "none" })], toCanvas);
    const plate = rec.strokes(REINFORCEMENT_COLOR).find((p) => p.state.lineWidth === 2.5)!;
    const [[x1, y1], [x2, y2]] = pathPoints(plate);
    // Horizontal bar → vertical plate through the head (150, 450), ±5 px.
    expect(x1).toBeCloseTo(150, 9);
    expect(x2).toBeCloseTo(150, 9);
    expect(Math.abs(y2 - y1)).toBeCloseTo(10, 9);
    expect((y1 + y2) / 2).toBeCloseTo(450, 9);
  });

  it("draws an anchor block at end 2 only without pullout", () => {
    const anchored = createRecordingContext();
    drawReinforcements(anchored.ctx, [row({ pullout: "none" })], toCanvas);
    const blocks = anchored.callsOf("fillRect");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].args).toEqual([250 - 3.5, 450 - 3.5, 7, 7]);

    const bonded = createRecordingContext();
    drawReinforcements(bonded.ctx, [row({ pullout: "bond", bondedLength: 4 })], toCanvas);
    expect(bonded.callsOf("fillRect")).toHaveLength(0);
  });

  it("draws the bonded part as a translucent wide band over the bonded span", () => {
    const rec = createRecordingContext();
    drawReinforcements(rec.ctx, [row({ pullout: "bond", bondedLength: 4 })], toCanvas);
    const band = rec.strokes(REINFORCEMENT_COLOR).find((p) => p.state.lineWidth === 7)!;
    expect(band.state.globalAlpha).toBeCloseTo(0.3);
    const [[ax, ay], [bx, by]] = pathPoints(band);
    expect(ax).toBeCloseTo(210, 9); // 60 % along 150 → 250
    expect(bx).toBeCloseTo(250, 9);
    expect(ay).toBeCloseTo(450, 9);
    expect(by).toBeCloseTo(450, 9);
  });

  it("dashes geosynthetics and numbers each element behind its head", () => {
    const rec = createRecordingContext();
    drawReinforcements(
      rec.ctx,
      [row({ pullout: "none" }), row({ type: "geosynthetic", pullout: "interface", x1: 15, x2: 5 })],
      toCanvas,
      2,
    );
    const geo = rec.strokes(REINFORCEMENT_COLOR).find((p) => p.state.lineWidth === 3)!;
    expect(geo.state.lineDash).toEqual([12, 6]);
    expect(rec.textStrings()).toEqual(["1", "2"]);
    // Element 1 points to +x, so its label sits 20 px (10 × zoom) left of the head.
    expect(rec.findText("1")).toMatchObject({ x: 130, y: 450 });
    // Element 2 points to -x: label to the right of its head at x = 250.
    expect(rec.findText("2")).toMatchObject({ x: 270, y: 450 });
    expect(rec.findText("1")!.state.font).toBe("bold 22px sans-serif");
  });

  it("skips elements whose ends coincide on screen", () => {
    const rec = createRecordingContext();
    drawReinforcements(rec.ctx, [row({ x2: 5, y2: 5 })], toCanvas);
    expect(rec.strokes()).toHaveLength(0);
    expect(rec.texts).toHaveLength(0);
    expect(rec.depth()).toBe(0);
  });
});

describe("drawReinforcementForces", () => {
  it("draws an arrow from the crossing along the force with a label at its tip", () => {
    const rec = createRecordingContext();
    drawReinforcementForces(rec.ctx, [force({ fx: 30, fy: 40, force: 50 })], toCanvas);
    expect(rec.depth()).toBe(0);
    const [shaft] = rec.strokes(REINFORCEMENT_COLOR);
    const [[px, py], [ex, ey]] = pathPoints(shaft);
    expect([px, py]).toEqual([200, 450]);
    // 28 px along (0.6, 0.8) in world → (0.6, -0.8) on screen (y down).
    expect(ex).toBeCloseTo(200 + 0.6 * 28, 9);
    expect(ey).toBeCloseTo(450 - 0.8 * 28, 9);
    const head = rec.fills(REINFORCEMENT_COLOR)[0];
    expect(pathPoints(head)[0][0]).toBeCloseTo(ex, 9);
    expect(pathPoints(head)[0][1]).toBeCloseTo(ey, 9);
    const label = rec.findText("50.0 kN/m")!;
    expect(label.state.textAlign).toBe("left");
    expect(label.x).toBeCloseTo(ex + 4, 9);
    expect(label.y).toBeCloseTo(ey, 9);
  });

  it("puts the label on the left of an arrow pointing to -x and marks passive forces", () => {
    const rec = createRecordingContext();
    drawReinforcementForces(rec.ctx, [force({ fx: -120, fy: 0, force: 120, passive: true })], toCanvas, 2);
    const label = rec.findText("120 kN/m /F")!;
    expect(label.state.textAlign).toBe("right");
    // Arrow 56 px long (28 × zoom) to the left; label 8 px further.
    expect(label.x).toBeCloseTo(200 - 56 - 8, 9);
    expect(label.state.font).toBe("bold 20px sans-serif");
  });

  it("skips zero forces", () => {
    const rec = createRecordingContext();
    drawReinforcementForces(rec.ctx, [force({ fx: 0, fy: 0, force: 0 })], toCanvas);
    expect(rec.strokes()).toHaveLength(0);
    expect(rec.texts).toHaveLength(0);
  });
});

describe("drawPiles", () => {
  it("draws piles solid and sheet piles dashed, labelled P1… above the head", () => {
    const rec = createRecordingContext();
    const pile = { ...newPile("p1", "pile", COORDS), x1: 5, y1: 10, x2: 5, y2: 0 };
    const wall = { ...newPile("p2", "sheet-pile", COORDS), x1: 8, y1: 10, x2: 8, y2: 2 };
    drawPiles(rec.ctx, [pile, wall], toCanvas);
    expect(rec.depth()).toBe(0);
    const bars = rec.strokes(PILE_COLOR);
    expect(bars).toHaveLength(2);
    expect(pathPoints(bars[0])).toEqual([
      [150, 400],
      [150, 500],
    ]);
    expect(bars[0].state.lineWidth).toBe(3);
    expect(bars[0].state.lineDash).toEqual([]);
    expect(bars[1].state.lineWidth).toBe(4);
    expect(bars[1].state.lineDash).toEqual([8, 2]);
    expect(rec.findText("P1")).toMatchObject({ x: 150, y: 396 });
    expect(rec.findText("P2")).toMatchObject({ x: 180, y: 396 });
  });
});
