import { describe, expect, it } from "vitest";
import type { ReinforcementForce } from "@cslope/engine";
import {
  PILE_COLOR,
  REINFORCEMENT_COLOR,
  bondedSpan,
  drawPiles,
  drawReinforcementForces,
  drawReinforcements,
  forceLabelContext,
  forceRoundsToZero,
  formatReinforcementForce,
  layoutReinforcementForces,
  loadObstacleBoxes,
} from "./reinforcement-draw";
import { segmentDistance } from "../rendering/overlay-layout";
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
    expect(formatReinforcementForce({ force: 20, passive: true })).toBe("20.0 kN/m ÷ FOS");
  });

  it("tells forces that show as 0.0 kN/m", () => {
    expect(forceRoundsToZero({ force: 0.049 })).toBe(true);
    expect(forceRoundsToZero({ force: -0.04 })).toBe(true);
    expect(forceRoundsToZero({ force: 0.05 })).toBe(false);
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
  const plates = (rec: ReturnType<typeof createRecordingContext>) =>
    rec.callsOf("fillRect").map((c) => c.args as [number, number, number, number]);
  const leaders = (rec: ReturnType<typeof createRecordingContext>) =>
    rec.strokes(REINFORCEMENT_COLOR).filter((s) => s.state.lineWidth === 0.75);

  it("draws a short arrow along the force, clear of the line it acts along", () => {
    const rec = createRecordingContext();
    drawReinforcementForces(rec.ctx, [force({ fx: 50, fy: 0, force: 50 })], toCanvas);
    expect(rec.depth()).toBe(0);
    const [shaft] = rec.strokes(REINFORCEMENT_COLOR);
    const [[px, py], [nx, ny]] = pathPoints(shaft);
    // Crossing at (200, 450); moved 5.5 px up off the element; 28 px long,
    // the shaft ending where the head begins.
    expect([px, py]).toEqual([200, 444.5]);
    expect(nx).toBeCloseTo(222.5, 9);
    expect(ny).toBeCloseTo(444.5, 9);
    const head = rec.fills(REINFORCEMENT_COLOR)[0];
    expect(pathPoints(head)[0][0]).toBeCloseTo(228, 9);
    // The head stays clear of the element line (y = 450).
    for (const [, y] of pathPoints(head)) expect(450 - y).toBeGreaterThan(2);
  });

  it("labels a force without an element beyond the arrow tip, on a plate of the background colour", () => {
    const rec = createRecordingContext();
    drawReinforcementForces(rec.ctx, [force({ fx: 50, fy: 0, force: 50 })], toCanvas, 1, { plate: "#abcdef" });
    const label = rec.findText("50.0 kN/m")!;
    expect(label.state.textAlign).toBe("left");
    const [[x, y, w, h]] = plates(rec);
    expect(rec.callsOf("fillRect")[0].state.fillStyle).toBe("#abcdef");
    expect(x).toBeCloseTo(231, 9); // tip + gap
    expect(y + h / 2).toBeCloseTo(444.5, 9);
    expect(label.x).toBeCloseTo(x + 1, 9);
    expect(w).toBeCloseTo(9 * 6 + 2, 9);
  });

  it("puts the value at the element's head, outside, on the line through the head", () => {
    const rec = createRecordingContext();
    const rows = [row({ x1: 5, y1: 5, x2: 15, y2: 5 })];
    const context = forceLabelContext(toCanvas, { reinforcements: rows, numberSize: 11 });
    drawReinforcementForces(rec.ctx, [force({ index: 0, y: 5 })], toCanvas, 1, { context });
    const [[x, y, w, h]] = plates(rec);
    // Head at (150, 450), out to the left; beyond its number (centred 9.9 px
    // out, 5.5 px half width) and a gap: right edge at 131.3.
    expect(x + w).toBeCloseTo(131.3, 9);
    expect(y + h / 2).toBeCloseTo(450, 9);
    expect(leaders(rec)).toHaveLength(0);
    expect(rec.findText("50.0 kN/m")).toBeDefined();
  });

  it("never leaves a value out: a crowd becomes a numbered column with a leader to each head", () => {
    const rec = createRecordingContext();
    // Five parallel elements 5 px apart, closer than the label height.
    const rows = [0, 1, 2, 3, 4].map((i) => row({ x1: 5, y1: 5 + i * 0.5, x2: 15, y2: 5 + i * 0.5 }));
    const forces = rows.map((_, i) => force({ index: i, y: 5 + i * 0.5 }));
    const context = forceLabelContext(toCanvas, { reinforcements: rows, numberSize: 11 });
    drawReinforcementForces(rec.ctx, forces, toCanvas, 1, { context });
    expect(rec.strokes(REINFORCEMENT_COLOR).filter((s) => s.state.lineWidth === 1.75)).toHaveLength(5);
    // Every value, each carrying its element number.
    for (let i = 1; i <= 5; i++) expect(rec.findText(`${i}: 50.0 kN/m`)).toBeDefined();
    const boxes = plates(rec);
    expect(boxes).toHaveLength(5);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [ax, ay, aw, ah] = boxes[i];
        const [bx, by, bw, bh] = boxes[j];
        expect(ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah).toBe(false);
      }
    }
    // One column, a leader from each label to its own head's anchor, in order (no crossings).
    expect(new Set(boxes.map(([x, , w]) => (x + w).toFixed(6))).size).toBe(1);
    const ls = leaders(rec).map((s) => pathPoints(s));
    expect(ls).toHaveLength(5);
    const ends = ls.map(([, end]) => end);
    for (const [ex, ey] of ends) {
      expect(ex).toBeCloseTo(131.3, 9);
      expect(rows.some((r) => Math.abs(toCanvas(0, r.y1)[1] - ey) < 1e-9)).toBe(true);
    }
    const byStart = [...ls].sort((a, b) => a[0][1] - b[0][1]);
    for (let i = 1; i < byStart.length; i++) expect(byStart[i][1][1]).toBeGreaterThan(byStart[i - 1][1][1]);
  });

  it("moves a label off a line through its spot, with a leader", () => {
    const rec = createRecordingContext();
    const rows = [row({ x1: 5, y1: 5, x2: 15, y2: 5 })];
    const context = forceLabelContext(toCanvas, {
      reinforcements: rows,
      numberSize: 11,
      water: [
        [
          [-5, 5],
          [4, 5],
        ],
      ],
    });
    drawReinforcementForces(rec.ctx, [force({ index: 0, y: 5 })], toCanvas, 1, { context });
    const [[, y, , h]] = plates(rec);
    expect(450 > y && 450 < y + h).toBe(false);
    const [leader] = leaders(rec);
    expect(pathPoints(leader)[1][0]).toBeCloseTo(131.3, 9);
    expect(pathPoints(leader)[1][1]).toBeCloseTo(450, 9);
  });

  it("keeps labels inside the frame", () => {
    const rec = createRecordingContext();
    const rows = [row({ x1: 5, y1: 5, x2: 15, y2: 5 })];
    const bounds = { left: 120, top: 0, right: 1000, bottom: 1000 };
    const context = forceLabelContext(toCanvas, { reinforcements: rows, numberSize: 11, bounds });
    drawReinforcementForces(rec.ctx, [force({ index: 0, y: 5 })], toCanvas, 1, { context });
    const [[x, y, , h]] = plates(rec);
    expect(x).toBeGreaterThanOrEqual(120);
    // Moved off the element line it would now cover, with a leader.
    expect(450 > y && 450 < y + h).toBe(false);
    expect(leaders(rec)).toHaveLength(1);
  });

  it("never draws an arrow longer than its element or past its ends", () => {
    const rec = createRecordingContext();
    const rows = [row({ x1: 5, y1: 5, x2: 6, y2: 5 })];
    const context = forceLabelContext(toCanvas, { reinforcements: rows, numberSize: 11 });
    drawReinforcementForces(rec.ctx, [force({ index: 0, x: 5.5, y: 5 })], toCanvas, 1, { context });
    const [shaft] = rec.strokes(REINFORCEMENT_COLOR);
    const head = rec.fills(REINFORCEMENT_COLOR)[0];
    const xs = [...pathPoints(shaft), pathPoints(head)[0]].map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(150 - 1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(160 + 1e-9);
  });

  it("marks passive forces with a drawn ÷ sign and scales with the zoom", () => {
    const rec = createRecordingContext();
    drawReinforcementForces(rec.ctx, [force({ fx: -120, fy: 0, force: 120, passive: true })], toCanvas, 2);
    const value = rec.findText("120 kN/m")!;
    expect(value.state.font).toBe("bold 20px sans-serif");
    const fos = rec.findText("FOS")!;
    expect(fos.x).toBeGreaterThan(value.x);
    // ÷: a bar between two dots, between the value and "FOS".
    const dots = rec.fills(REINFORCEMENT_COLOR).filter((p) => p.segments.some((s) => s.op === "arc"));
    expect(dots).toHaveLength(2);
    const [[d1x, d1y]] = pathPoints(dots[0]);
    const [[d2x, d2y]] = pathPoints(dots[1]);
    expect(d1x).toBeCloseTo(d2x, 9);
    expect(Math.abs(d1y - d2y)).toBeCloseTo(0.58 * 20, 9);
    expect(d1x).toBeGreaterThan(value.x);
    expect(d1x).toBeLessThan(fos.x);
    // Arrow 56 px long (28 × zoom) to the left, moved 11 px (5.5 × zoom) up.
    const [[px, py]] = pathPoints(rec.strokes(REINFORCEMENT_COLOR)[0]);
    expect(py).toBeCloseTo(439, 9);
    expect(px).toBe(200);
    expect(pathPoints(rec.fills(REINFORCEMENT_COLOR)[0])[0][0]).toBeCloseTo(144, 9);
  });

  it("skips zero forces and forces that show as 0.0 kN/m", () => {
    const rec = createRecordingContext();
    drawReinforcementForces(
      rec.ctx,
      [force({ fx: 0, fy: 0, force: 0 }), force({ fx: 0.04, fy: 0, force: 0.04, passive: true })],
      toCanvas,
    );
    expect(rec.strokes()).toHaveLength(0);
    expect(rec.texts).toHaveLength(0);
  });
});

describe("layoutReinforcementForces", () => {
  const size = {
    arrow: 28,
    head: 5.5,
    headHalf: 2.5,
    offset: 5.5,
    clear: 1.5,
    gap: 3,
    pad: 1,
    textH: 10,
    measure: (t: string) => t.length * 6,
  };

  it("keeps an arrow along the slip line off it, on one side", () => {
    // A tangent force: the arrow would lie on the slip line from (0, 0) to (20, 10).
    const surface: [number, number][] = [
      [0, 0],
      [20, 10],
    ];
    const context = forceLabelContext(toCanvas, { surface, numberSize: 11 });
    const n = Math.hypot(2, 1);
    const [l] = layoutReinforcementForces([force({ x: 10, y: 5, fx: 2 / n, fy: 1 / n, force: 1 })], toCanvas, size, context);
    const slip: [number, number, number, number] = [...toCanvas(0, 0), ...toCanvas(20, 10)];
    expect(segmentDistance([...l.from, ...l.to], slip)).toBeGreaterThan(size.headHalf + size.clear - 1e-9);
  });

  it("keeps an arrow clear of other arrows", () => {
    // Two forces at the same spot: the second goes to the other side or is moved.
    const forces = [force({ index: 0 }), force({ index: 1 })];
    const [a, b] = layoutReinforcementForces(forces, toCanvas, size);
    expect(segmentDistance([...a.from, ...a.to], [...b.from, ...b.to])).toBeGreaterThan(2 * size.headHalf);
  });
});

describe("forceLabelContext", () => {
  it("collects element and pile lines, the slip surface, boxes for numbers and pile names, and head anchors", () => {
    const ctx = forceLabelContext(toCanvas, {
      reinforcements: [row({})],
      piles: [{ ...newPile("p", "pile", COORDS), x1: 2, y1: 10, x2: 2, y2: 0 }],
      surface: [
        [0, 10],
        [5, 5],
        [10, 0],
      ],
      numberSize: 10,
    });
    expect(ctx.obstacles).toHaveLength(4);
    expect(ctx.obstacles[0]).toEqual([150, 450, 250, 450]);
    expect(ctx.slip).toHaveLength(2);
    // Head plate and number of the element, name of the pile.
    expect(ctx.placed).toHaveLength(3);
    expect(ctx.placed[1]).toEqual({ left: 136, top: 445, right: 146, bottom: 455 });
    // Element label anchor beyond its number; pile label anchor above its name.
    expect(ctx.heads!.reinforcements[0]!.anchor).toEqual([133, 450]);
    expect(ctx.heads!.piles[0]!.anchor).toEqual([120, 383]);
  });

  it("adds the model boundary and water lines as lines to keep clear of, loads as boxes", () => {
    const load = { left: 0, top: 0, right: 10, bottom: 10 };
    const ctx = forceLabelContext(toCanvas, {
      numberSize: 10,
      model: COORDS,
      water: [
        [
          [0, 5],
          [10, 5],
        ],
      ],
      loads: [load],
    });
    expect(ctx.extra).toHaveLength(COORDS.length + 1);
    expect(ctx.placed).toEqual([load]);
    expect(ctx.area).toHaveLength(COORDS.length);
  });
});

describe("loadObstacleBoxes", () => {
  it("covers each ground segment under a UDL and a line load arrow", () => {
    const boxes = loadObstacleBoxes(toCanvas, COORDS, [{ x1: 5, x2: 15 }], [{ x: 2 }], 38);
    // UDL over the crest (10, 10) and down the slope: two segments.
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toEqual({ left: 150, top: 400 - 38, right: 200, bottom: 400 });
    expect(boxes[2].bottom).toBe(400);
    expect(boxes[2].top).toBe(400 - 38);
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
