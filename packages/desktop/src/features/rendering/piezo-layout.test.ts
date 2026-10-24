import { describe, expect, it } from "vitest";
import { piezoObstacles, piezoSymbolLayout } from "./piezo-layout";

// World = screen with y flipped (1 px per metre), ground at y = 0 from x = 0 to 1000.
const toScreen = (x: number, y: number): [number, number] => [x, -y];
const model: [number, number][] = [
  [0, -50],
  [0, 0],
  [1000, 0],
  [1000, -50],
];

describe("piezoSymbolLayout", () => {
  it("puts one or two symbols on a line", () => {
    const long = piezoSymbolLayout([[0, -20], [1000, -20]], toScreen, { unit: 1, model });
    expect(long).toHaveLength(2);
    long.forEach((s, i) => expect(Math.abs(s.x - (250 + 500 * i))).toBeLessThan(3));
    expect(piezoSymbolLayout([[0, -20], [50, -20]], toScreen, { unit: 1, model })).toHaveLength(1);
  });

  it("skips steep segments and prefers open water above the ground", () => {
    const syms = piezoSymbolLayout(
      [
        [100, -20],
        [100, 80],
        [300, 80],
      ],
      toScreen,
      { unit: 1, model },
    );
    // 300 px of line → two symbols, both on the flat part over the ground.
    expect(syms).toHaveLength(2);
    for (const s of syms) {
      expect(s.y).toBe(-80);
      expect(s.bars).toBe(true);
    }
  });

  it("leaves out the bars where the line runs on the ground", () => {
    const [s] = piezoSymbolLayout([[100, 0], [200, 0]], toScreen, { unit: 1, model });
    expect(s.bars).toBe(false);
  });

  it("prefers the line in the soil to the line on the ground surface", () => {
    // On the ground from 0 to 400, then 20 m down in the soil.
    const syms = piezoSymbolLayout([[0, 0], [400, 0], [400.001, -20], [800, -20]], toScreen, { unit: 1, model });
    expect(syms.length).toBeGreaterThan(0);
    for (const s of syms) expect(s.x).toBeGreaterThan(400);
  });

  it("leaves out the ≡ in shallow water at a shoreline and prefers deep water", () => {
    // Ground rising from y = 0 at x = 0 to y = 30 at x = 300; water at y = 20.
    const shore: [number, number][] = [
      [0, -50],
      [0, 0],
      [300, 30],
      [300, -50],
    ];
    const syms = piezoSymbolLayout([[0, 20], [199, 20]], toScreen, { unit: 1, model: shore });
    expect(syms).toHaveLength(1);
    // Deep enough for the ≡ (6 px below the line, 2 px clear of the ground).
    expect(syms[0].bars).toBe(true);
    expect(syms[0].x).toBeLessThan(120);
    // Only a strip of shallow water: the ≡ is left out.
    const [s] = piezoSymbolLayout([[195, 20], [199, 20]], toScreen, { unit: 1, model: shore });
    expect(s.bars).toBe(false);
  });

  it("stays out of the sliding mass while there is room elsewhere", () => {
    const slipMass: [number, number][] = [
      [0, 0],
      [600, 0],
      [600, 60],
      [0, 60],
    ];
    const syms = piezoSymbolLayout([[0, -20], [1000, -20]], toScreen, { unit: 1, model, slipMass });
    expect(syms.length).toBeGreaterThan(0);
    for (const s of syms) expect(s.x).toBeGreaterThan(600);
    // Inside it when there is nowhere else (at least one symbol per line).
    const all: [number, number][] = [
      [-10, 0],
      [1010, 0],
      [1010, 60],
      [-10, 60],
    ];
    expect(piezoSymbolLayout([[0, -20], [1000, -20]], toScreen, { unit: 1, model, slipMass: all })).toHaveLength(1);
  });

  it("keeps clear of symbols already placed, of the critical surface and of obstacles", () => {
    const taken: [number, number][] = [[100, 20]];
    const [s] = piezoSymbolLayout([[0, -20], [200, -20]], toScreen, { unit: 1, model, taken });
    expect(Math.abs(s.x - 100)).toBeGreaterThanOrEqual(24);
    expect(taken).toHaveLength(2);
    const critical = { cx: 100, cy: 30, radius: 50, entryPoint: [50, 30] as [number, number], exitPoint: [150, 30] as [number, number] };
    const [c] = piezoSymbolLayout([[0, -20], [200, -20]], toScreen, { unit: 1, model, critical });
    expect(Math.abs(c.x - 100)).toBeGreaterThan(8);
    const avoid = [{ left: 50, top: 0, right: 150, bottom: 40 }];
    const [a] = piezoSymbolLayout([[0, -20], [200, -20]], toScreen, { unit: 1, model, avoid });
    expect(a.x < 50 - 6 || a.x > 150 + 6).toBe(true);
  });
});

describe("piezoObstacles", () => {
  it("collects loads, vertex markers, search markers and the inside part of prescribed surfaces", () => {
    const o = piezoObstacles(
      {
        coordinates: model,
        udls: [{ x1: 100, x2: 200, magnitude: 10 }],
        lineLoads: [{ x: 500, magnitude: 5 }],
        vertices: [[0, 0]],
        prescribed: [{ id: "c", cx: 700, cy: 0, radius: 30 }],
        analysisLimits: { enabled: true, entryLeftX: 300, entryRightX: 400, exitLeftX: 800, exitRightX: 900 },
      },
      toScreen,
      1,
    );
    // The UDL band reaches up past its arrows and label.
    expect(o.avoid.some((b) => b.left < 100 && b.right > 200 && b.top < -40 && b.bottom >= 0)).toBe(true);
    expect(o.avoid.some((b) => b.left < 500 && b.right > 500)).toBe(true);
    expect(o.vertexObstacles.some(({ box: b }) => b.left < 0 && b.right > 0 && b.top < 0 && b.bottom > 0)).toBe(true);
    // Dots between 300 and 400.
    expect(o.avoid.some((b) => b.left > 300 && b.right < 400)).toBe(true);
    // Only the lower half of the circle is inside the model.
    expect(o.avoidLines.length).toBeGreaterThan(0);
    for (const [, y1, , y2] of o.avoidLines) expect((y1 + y2) / 2).toBeGreaterThan(0);
    expect(o.slipMass).toBeNull();
  });
});

describe("piezoSymbolLayout clearances", () => {
  it("keeps a symbol its own width from the model's side", () => {
    // A short line in the soil ending at the right side: its middle is 10 px from it.
    const [s] = piezoSymbolLayout([[960, -20], [1000, -20]], toScreen, { unit: 1, model });
    expect(1000 - s.x).toBeGreaterThanOrEqual(3 * 7);
  });

  it("keeps clear of a material boundary a few px away", () => {
    // A boundary 2 px above the line from x = 0 to 150: the symbol goes beyond it.
    const { softLines } = piezoObstacles(
      { coordinates: model, materialBoundaries: [{ coordinates: [[0, -18], [150, -18]] }] },
      toScreen,
      1,
    );
    const [s] = piezoSymbolLayout([[0, -20], [250, -20]], toScreen, { unit: 1, model, softLines });
    expect(s.x).toBeGreaterThan(150 + 7);
  });

  it("keeps away from a vertex dot", () => {
    const obstacles = piezoObstacles({ coordinates: model, vertices: [[50, -20]] }, toScreen, 1);
    const [s] = piezoSymbolLayout([[0, -20], [100, -20]], toScreen, { unit: 1, model, ...obstacles });
    expect(Math.abs(s.x - 50)).toBeGreaterThan(14 + 7);
  });

  it("is not blocked by the dense vertices of its own line", () => {
    // A line with a vertex every 10 px: its own dots leave a symbol room.
    const line = Array.from({ length: 31 }, (_, i): [number, number] => [100 + 10 * i, -20]);
    const obstacles = piezoObstacles({ coordinates: model, vertices: line }, toScreen, 1);
    const syms = piezoSymbolLayout(line, toScreen, { unit: 1, model, ...obstacles });
    expect(syms).toHaveLength(2);
    syms.forEach((s, i) => expect(Math.abs(s.x - (175 + 150 * i))).toBeLessThan(10));
    // Another line's vertices there still keep it away.
    const [other] = piezoSymbolLayout([[0, -20], [200, -20]], toScreen, { unit: 1, model, ...obstacles });
    expect(other.x).toBeLessThan(100 - 14);
  });
});
