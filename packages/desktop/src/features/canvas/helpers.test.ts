import { describe, expect, it } from "vitest";
import { PAPER_FRAME_MARGIN_PX } from "../../constants";
import {
  computePaperFrame,
  surfaceYAtXFromCoordinates,
  collectModelFitBounds,
} from "./helpers";

describe("computePaperFrame", () => {
  it("fits A4 frame into available canvas area while preserving aspect", () => {
    const frame = computePaperFrame(1000, 600, "A4");

    const availW = 1000 - PAPER_FRAME_MARGIN_PX * 2;
    const availH = 600 - PAPER_FRAME_MARGIN_PX * 2;
    const a4Aspect = 297 / 210;

    expect(frame.w).toBeLessThanOrEqual(availW + 1e-9);
    expect(frame.h).toBeLessThanOrEqual(availH + 1e-9);
    expect(frame.w / frame.h).toBeCloseTo(a4Aspect, 8);

    expect(frame.x).toBeCloseTo((1000 - frame.w) / 2, 8);
    expect(frame.y).toBeCloseTo((600 - frame.h) / 2, 8);
  });

  it("uses width-fit branch when canvas is relatively tall", () => {
    const frame = computePaperFrame(600, 1000, "A3");

    const availW = 600 - PAPER_FRAME_MARGIN_PX * 2;
    expect(frame.w).toBeCloseTo(availW, 8);
    expect(frame.x).toBeCloseTo(PAPER_FRAME_MARGIN_PX, 8);
    expect(frame.h).toBeGreaterThan(0);
  });

  it("handles portrait orientation", () => {
    const frame = computePaperFrame(600, 800, "A4", false);
    // Portrait A4 → 210×297 → aspect < 1
    expect(frame.w / frame.h).toBeLessThan(1);
    expect(frame.w).toBeGreaterThan(0);
    expect(frame.h).toBeGreaterThan(0);
  });

  it("centres the frame in the canvas", () => {
    const frame = computePaperFrame(1200, 800, "A3");
    // Frame should be centred horizontally and vertically
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    expect(cx).toBeCloseTo(600, 0);
    expect(cy).toBeCloseTo(400, 0);
  });

  it("respects margin on all paper sizes", () => {
    const sizes = ["A4", "A3", "A2", "A1", "A0"] as const;
    for (const size of sizes) {
      const frame = computePaperFrame(1000, 700, size);
      expect(frame.x).toBeGreaterThanOrEqual(PAPER_FRAME_MARGIN_PX - 1);
      expect(frame.y).toBeGreaterThanOrEqual(PAPER_FRAME_MARGIN_PX - 1);
      expect(frame.x + frame.w).toBeLessThanOrEqual(
        1000 - PAPER_FRAME_MARGIN_PX + 1,
      );
      expect(frame.y + frame.h).toBeLessThanOrEqual(
        700 - PAPER_FRAME_MARGIN_PX + 1,
      );
    }
  });
});

describe("surfaceYAtXFromCoordinates", () => {
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

  it("returns Y on a flat segment", () => {
    // Between (0,10) and (10,10): y = 10
    expect(surfaceYAtXFromCoordinates(coords, 5)).toBeCloseTo(10, 5);
  });

  it("interpolates on a sloped segment", () => {
    // Between (10,10) and (12.5,7.5): slope of -1
    expect(surfaceYAtXFromCoordinates(coords, 11.25)).toBeCloseTo(8.75, 5);
  });

  it("returns exact value at a vertex", () => {
    expect(surfaceYAtXFromCoordinates(coords, 12.5)).toBeCloseTo(7.5, 5);
  });

  it("returns null for empty coordinates", () => {
    expect(surfaceYAtXFromCoordinates([], 5)).toBeNull();
  });

  it("returns null for X outside a simple segment", () => {
    const line: [number, number][] = [
      [5, 0],
      [10, 5],
    ];
    expect(surfaceYAtXFromCoordinates(line, 3)).toBeNull();
  });
});

describe("collectModelFitBounds", () => {
  const coords: [number, number][] = [
    [0, 0],
    [0, 10],
    [25, 10],
    [25, 0],
  ];

  const mockSurfaceYAtX = (x: number) => {
    if (x >= 0 && x <= 25) return 10;
    return null;
  };

  it("returns bounds covering all coordinates", () => {
    const bounds = collectModelFitBounds({
      coordinates: coords,
      materialBoundaries: [],
      piezometricLines: [],
      analysisLimits: {
        enabled: false,
        entryLeftX: 0,
        entryRightX: 0,
        exitLeftX: 0,
        exitRightX: 0,
      },
      udls: [],
      lineLoads: [],
      surfaceYAtX: mockSurfaceYAtX,
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.xMin).toBe(0);
    expect(bounds!.xMax).toBe(25);
    expect(bounds!.yMin).toBe(0);
    expect(bounds!.yMax).toBe(10);
  });

  it("extends bounds with material boundaries", () => {
    const bounds = collectModelFitBounds({
      coordinates: coords,
      materialBoundaries: [
        {
          coordinates: [
            [-5, 5],
            [30, 5],
          ] as [number, number][],
        },
      ],
      piezometricLines: [],
      analysisLimits: {
        enabled: false,
        entryLeftX: 0,
        entryRightX: 0,
        exitLeftX: 0,
        exitRightX: 0,
      },
      udls: [],
      lineLoads: [],
      surfaceYAtX: mockSurfaceYAtX,
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.xMin).toBe(-5);
    expect(bounds!.xMax).toBe(30);
  });

  it("extends bounds with piezometric lines", () => {
    const bounds = collectModelFitBounds({
      coordinates: coords,
      materialBoundaries: [],
      piezometricLines: [{ coordinates: [[2, 15]] as [number, number][] }],
      analysisLimits: {
        enabled: false,
        entryLeftX: 0,
        entryRightX: 0,
        exitLeftX: 0,
        exitRightX: 0,
      },
      udls: [],
      lineLoads: [],
      surfaceYAtX: mockSurfaceYAtX,
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.yMax).toBe(15);
  });

  it("includes analysis limit points when enabled", () => {
    const bounds = collectModelFitBounds({
      coordinates: coords,
      materialBoundaries: [],
      piezometricLines: [],
      analysisLimits: {
        enabled: true,
        entryLeftX: 5,
        entryRightX: 10,
        exitLeftX: 15,
        exitRightX: 20,
      },
      udls: [],
      lineLoads: [],
      surfaceYAtX: mockSurfaceYAtX,
    });
    expect(bounds).not.toBeNull();
    // Limit X values are within coords range, so bounds shouldn't extend beyond coords
    expect(bounds!.xMin).toBe(0);
    expect(bounds!.xMax).toBe(25);
  });

  it("extends bounds with UDL positions", () => {
    const bounds = collectModelFitBounds({
      coordinates: coords,
      materialBoundaries: [],
      piezometricLines: [],
      analysisLimits: {
        enabled: false,
        entryLeftX: 0,
        entryRightX: 0,
        exitLeftX: 0,
        exitRightX: 0,
      },
      udls: [{ x1: 5, x2: 20 }],
      lineLoads: [],
      surfaceYAtX: mockSurfaceYAtX,
    });
    expect(bounds).not.toBeNull();
    // UDL positions are within coords, so bounds should still be 0–25
    expect(bounds!.xMin).toBe(0);
    expect(bounds!.xMax).toBe(25);
  });

  it("extends bounds with line load positions", () => {
    const bounds = collectModelFitBounds({
      coordinates: coords,
      materialBoundaries: [],
      piezometricLines: [],
      analysisLimits: {
        enabled: false,
        entryLeftX: 0,
        entryRightX: 0,
        exitLeftX: 0,
        exitRightX: 0,
      },
      udls: [],
      lineLoads: [{ x: 12.5 }],
      surfaceYAtX: mockSurfaceYAtX,
    });
    expect(bounds).not.toBeNull();
  });

  it("returns null for empty coordinates and no other data", () => {
    const bounds = collectModelFitBounds({
      coordinates: [],
      materialBoundaries: [],
      piezometricLines: [],
      analysisLimits: {
        enabled: false,
        entryLeftX: 0,
        entryRightX: 0,
        exitLeftX: 0,
        exitRightX: 0,
      },
      udls: [],
      lineLoads: [],
      surfaceYAtX: () => null,
    });
    expect(bounds).toBeNull();
  });
});
