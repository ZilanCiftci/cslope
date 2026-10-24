import { describe, expect, it } from "vitest";
import { pondArrowLayout } from "./pond-arrows";
import { POND_ARROW_MAX_PX, POND_ARROW_SPACING_PX } from "./style-spec";

type Pt = [number, number];
// 10 px per metre, y down.
const toD = (x: number, y: number): Pt => [x * 10, -y * 10];

describe("pondArrowLayout", () => {
  it("points down at flat ground, tips on it, spaced and capped", () => {
    const pond = { water: [[0, 5], [30, 5]] as Pt[], ground: [[0, 0], [30, 0]] as Pt[] };
    const arrows = pondArrowLayout([pond], toD, 1);
    expect(arrows).toHaveLength(Math.round(300 / POND_ARROW_SPACING_PX));
    for (const a of arrows) {
      expect(a.tip[1]).toBeCloseTo(0, 9);
      expect(a.tail[0]).toBeCloseTo(a.tip[0], 9);
      expect(a.tip[1] - a.tail[1]).toBeCloseTo(POND_ARROW_MAX_PX, 9); // 50 px deep: capped
      expect(a.base[1]).toBeLessThan(a.tip[1]);
      expect(a.b1[1]).toBeCloseTo(a.base[1], 9);
    }
    const gaps = arrows.slice(1).map((a, i) => a.tip[0] - arrows[i].tip[0]);
    for (const g of gaps) expect(g).toBeCloseTo(50, 9);
  });

  it("scales with the depth and skips shallow water", () => {
    const deep = { water: [[0, 1.5], [10, 1.5]] as Pt[], ground: [[0, 0], [10, 0]] as Pt[] };
    const [a] = pondArrowLayout([deep], toD, 1);
    expect(a.tip[1] - a.tail[1]).toBeCloseTo(0.7 * 15, 9);
    const shallow = { water: [[0, 0.5], [10, 0.5]] as Pt[], ground: [[0, 0], [10, 0]] as Pt[] };
    expect(pondArrowLayout([shallow], toD, 1)).toEqual([]);
  });

  it("is normal to sloping ground and keeps clear of boxes", () => {
    // Ground rising 1 in 2 to the right under level water.
    const pond = { water: [[0, 10], [20, 10]] as Pt[], ground: [[0, 0], [20, 10]] as Pt[] };
    const arrows = pondArrowLayout([pond], toD, 1);
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      const dx = a.tip[0] - a.tail[0];
      const dy = a.tip[1] - a.tail[1];
      // Along the normal (1, 2) in drawing units (y down), towards the ground.
      expect(dx * 2 - dy * 1).toBeCloseTo(0, 6);
      expect(dy).toBeGreaterThan(0);
    }
    const first = arrows[0];
    const box = { left: first.tip[0] - 1, right: first.tip[0] + 1, top: first.tip[1] - 1, bottom: first.tip[1] + 1 };
    const kept = pondArrowLayout([pond], toD, 1, [box]);
    expect(kept).toHaveLength(arrows.length - 1);
    expect(kept.some((a) => a.tip[0] === first.tip[0])).toBe(false);
  });

  it("scales with the unit", () => {
    const pond = { water: [[0, 5], [30, 5]] as Pt[], ground: [[0, 0], [30, 0]] as Pt[] };
    const mm = pondArrowLayout([pond], toD, 0.25);
    expect(mm[0].tip[1] - mm[0].tail[1]).toBeCloseTo(POND_ARROW_MAX_PX * 0.25, 9);
  });
});
