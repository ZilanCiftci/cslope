// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fitWindowToWorkArea, maxContentHeight, withTaskbar, WORK_AREA_MARGIN } from "./window-size";

// 1920 × 1080 at 150 %: 1280 × 720 DIP, less a 48 DIP taskbar.
const LAPTOP_150 = { x: 0, y: 0, width: 1280, height: 672 };
const LARGE = { x: 0, y: 0, width: 2560, height: 1400 };

describe("fitWindowToWorkArea", () => {
  it("caps a 760 px dialog to a 672 px work area, less the margin", () => {
    const placed = fitWindowToWorkArea({ width: 520, height: 760, minWidth: 460, minHeight: 560 }, LAPTOP_150);
    expect(placed.height).toBeLessThanOrEqual(672);
    expect(placed.height).toBe(672 - WORK_AREA_MARGIN);
    expect(placed.width).toBe(520);
    expect(placed.minHeight).toBe(560);
    expect(placed.minWidth).toBe(460);
  });

  it("keeps the size on a large screen", () => {
    const placed = fitWindowToWorkArea({ width: 520, height: 760, minHeight: 560 }, LARGE);
    expect(placed).toMatchObject({ width: 520, height: 760, minHeight: 560 });
  });

  it("keeps the minimum size within the capped size (the drawing window)", () => {
    const placed = fitWindowToWorkArea({ width: 1280, height: 860, minWidth: 900, minHeight: 600 }, { x: 0, y: 0, width: 800, height: 560 });
    expect(placed.width).toBe(800 - WORK_AREA_MARGIN);
    expect(placed.height).toBe(560 - WORK_AREA_MARGIN);
    expect(placed.minWidth).toBe(placed.width);
    expect(placed.minHeight).toBe(placed.height);
  });

  it("centers the window in the work area of its display", () => {
    const second = { x: 1920, y: 40, width: 1280, height: 672 };
    const placed = fitWindowToWorkArea({ width: 520, height: 760 }, second);
    expect(placed.x).toBe(1920 + (1280 - 520) / 2);
    expect(placed.y).toBe(40 + WORK_AREA_MARGIN / 2);
    expect(placed.y + placed.height).toBeLessThanOrEqual(second.y + second.height);
  });

  it("leaves out a minimum size that was not asked for", () => {
    const placed = fitWindowToWorkArea({ width: 520, height: 760 }, LAPTOP_150);
    expect(placed).not.toHaveProperty("minWidth");
    expect(placed).not.toHaveProperty("minHeight");
  });
});

describe("maxContentHeight", () => {
  it("is the capped height less the window frame", () => {
    expect(maxContentHeight(LAPTOP_150, 32)).toBe(672 - WORK_AREA_MARGIN - 32);
  });
});

describe("withTaskbar", () => {
  it("takes a simulated taskbar off the bottom of the work area", () => {
    expect(withTaskbar({ x: 0, y: 0, width: 1280, height: 720 }, 48)).toEqual(LAPTOP_150);
  });

  it("ignores no, negative or invalid taskbars", () => {
    for (const t of [0, -10, Number.NaN]) expect(withTaskbar(LAPTOP_150, t)).toEqual(LAPTOP_150);
  });
});
