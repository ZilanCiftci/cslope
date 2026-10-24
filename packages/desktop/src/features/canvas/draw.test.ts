import { describe, expect, it } from "vitest";
import type { AnalysisResult, SliceData, SlipSurfaceResult } from "@cslope/engine";
import { drawCanvas, POINT_LABEL_PLATE_ALPHA, type DrawCanvasParams } from "./draw";
import { createRecordingContext, pathPoints, type PaintedPath } from "../../test/recording-context";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  DEFAULT_PROJECT_INFO,
  DEFAULT_RESULT_VIEW_SETTINGS,
} from "../../store/defaults";
import { surfaceYAtXFromCoordinates } from "./helpers";
import { POINT_COLOR, POINT_COLOR_HOVER, POINT_COLOR_SELECTED, POINT_RADIUS, RULER_SIZE_PX } from "./constants";
import {
  ENTRY_DOT_COLOR,
  EXIT_DOT_COLOR,
  LINE_LOAD_COLOR,
  PIEZO_COLOR,
  POND_COLOR,
  POND_OPACITY,
  SLIP_SURFACE_OPACITY,
  UDL_LOAD_COLOR,
} from "../rendering/style-spec";
import { REINFORCEMENT_COLOR, PILE_COLOR } from "./reinforcement-draw";
import { newPile, newReinforcement } from "../../utils/reinforcement";
import { fosColor } from "../../utils/fos-color";
import type { Annotation, ResultViewSettings } from "../../store/types";
import { computeRegions } from "../../utils/regions";

const W = 800;
const H = 600;
const SCALE = 20;
const CX = 15; // world x at the canvas centre
const CY = 5; // world y at the canvas centre

const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];

const worldToCanvas = (wx: number, wy: number, w: number, h: number): [number, number] => [
  w / 2 + (wx - CX) * SCALE,
  h / 2 - (wy - CY) * SCALE,
];
const canvasToWorld = (cx: number, cy: number, w: number, h: number): [number, number] => [
  (cx - w / 2) / SCALE + CX,
  -(cy - h / 2) / SCALE + CY,
];
const toC = (x: number, y: number) => worldToCanvas(x, y, W, H);

function baseParams(over: Partial<DrawCanvasParams> = {}): DrawCanvasParams {
  const coordinates = over.coordinates ?? COORDS;
  return {
    w: W,
    h: H,
    mode: "edit",
    result: null,
    resultViewSettings: { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [] },
    orientation: "ltr",
    coordinates,
    materials: [{ ...DEFAULT_MATERIAL }],
    materialBoundaries: [],
    regionMaterials: [],
    selectedRegionKey: null,
    editingAssignment: false,
    selectedAnnotationIds: [],
    selectedResultObject: null,
    projectInfo: DEFAULT_PROJECT_INFO,
    parameters: [],
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, enabled: false },
    udls: [],
    lineLoads: [],
    reinforcements: [],
    piles: [],
    piezometricLine: DEFAULT_PIEZO_LINE,
    viewScale: SCALE,
    mouseWorld: null,
    hoverHit: null,
    selectedPointIndex: null,
    selectedMaterialBoundaryId: null,
    interiorBoundariesDialogOpen: false,
    worldToCanvas,
    canvasToWorld,
    surfaceYAtX: (x) => surfaceYAtXFromCoordinates(coordinates, x),
    editingExterior: false,
    editingBoundaries: false,
    editingPiezo: false,
    ...over,
  };
}

function draw(over: Partial<DrawCanvasParams> = {}) {
  const rec = createRecordingContext(W, H);
  drawCanvas(rec.ctx, baseParams(over));
  return rec;
}

const close = (a: [number, number], b: [number, number], eps = 1e-6) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

const hasPoints = (p: PaintedPath, pts: [number, number][]) => {
  const got = pathPoints(p);
  return got.length === pts.length && pts.every((q, i) => close(got[i], q));
};

// ── Result fixture: a circle through (entryX, 10) on the crest and (22, 5) ──
const CIRCLE = { cx: 15, cy: 14 };
const R = Math.hypot(22 - CIRCLE.cx, 5 - CIRCLE.cy);
const ENTRY_X = CIRCLE.cx - Math.sqrt(R * R - (10 - CIRCLE.cy) ** 2);

function surface(over: Partial<SlipSurfaceResult> = {}): SlipSurfaceResult {
  return {
    cx: CIRCLE.cx,
    cy: CIRCLE.cy,
    radius: R,
    fos: 1.234,
    entryPoint: [ENTRY_X, 10],
    exitPoint: [22, 5],
    converged: true,
    ...over,
  };
}

function slice(xLeft: number, xRight: number, extra: Partial<SliceData> = {}): SliceData {
  return {
    x: (xLeft + xRight) / 2,
    xLeft,
    xRight,
    width: xRight - xLeft,
    yTop: 10,
    yBottom: 5,
    height: 5,
    area: 5,
    alpha: 0.2,
    baseLength: xRight - xLeft,
    weight: 90,
    cohesion: 12,
    frictionAngle: 0,
    normalForce: 80,
    porePressure: 0,
    baseMaterial: {} as unknown as SliceData["baseMaterial"],
    ...extra,
  };
}

function result(over: Partial<AnalysisResult> = {}): AnalysisResult {
  const critical = surface();
  return {
    minFOS: 1.234,
    maxFOS: 1.8,
    criticalSurface: critical,
    allSurfaces: [critical],
    criticalSlices: [],
    method: "Bishop",
    elapsedMs: 1,
    ...over,
  } as AnalysisResult;
}

function rvs(over: Partial<ResultViewSettings> = {}): ResultViewSettings {
  return {
    ...DEFAULT_RESULT_VIEW_SETTINGS,
    annotations: [],
    showSlices: false,
    showFosLabel: false,
    showCentreMarker: false,
    ...over,
  };
}

describe("drawCanvas — edit mode", () => {
  it("keeps save/restore balanced", () => {
    const rec = draw({ editingExterior: true });
    expect(rec.depth()).toBe(0);
  });

  it("strokes the exterior boundary through the transformed vertices", () => {
    const rec = draw();
    const outline = rec.strokes().find((p) => hasPoints(p, COORDS.map(([x, y]) => toC(x, y))));
    expect(outline).toBeDefined();
    expect(outline!.segments.at(-1)).toEqual({ op: "closePath" });
  });

  it("fills the material region with the material colour, clipped to the model", () => {
    const rec = draw();
    const fills = rec.fills(DEFAULT_MATERIAL.color);
    expect(fills).toHaveLength(1);
    const xs = pathPoints(fills[0]).map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(toC(0, 0)[0], 6);
    expect(Math.max(...xs)).toBeCloseTo(toC(30, 0)[0], 6);
    expect(rec.callsOf("clip").length).toBeGreaterThan(0);
  });

  it("does not fill the soil when soil colours are hidden", () => {
    const rec = draw({ resultViewSettings: rvs({ showSoilColor: false }) });
    expect(rec.fills(DEFAULT_MATERIAL.color)).toHaveLength(0);
  });

  it("fills a ring around a closed lens even-odd and the lens in its own material", () => {
    const sand = { ...DEFAULT_MATERIAL, id: "sand", color: "#eedd88" };
    const lens = {
      id: "lens",
      coordinates: [
        [5, 2],
        [10, 2],
        [10, 4],
        [5, 4],
        [5, 2],
      ] as [number, number][],
    };
    const rec = draw({
      materials: [{ ...DEFAULT_MATERIAL }, sand],
      materialBoundaries: [lens],
      regionMaterials: [{ point: [7, 3], materialId: "sand" }],
    });
    const outer = rec.fills(DEFAULT_MATERIAL.color);
    expect(outer).toHaveLength(1);
    expect(outer[0].fillRule).toBe("evenodd");
    // The hole's vertices are part of the outer path.
    expect(pathPoints(outer[0]).some((p) => close(p, toC(5, 2)))).toBe(true);
    const inner = rec.fills("#eedd88");
    expect(inner).toHaveLength(1);
    expect(inner[0].fillRule).toBe("nonzero");
  });

  it("outlines the selected region only while assigning materials", () => {
    const lens = {
      id: "lens",
      coordinates: [
        [5, 2],
        [10, 2],
        [10, 4],
        [5, 4],
        [5, 2],
      ] as [number, number][],
    };
    const regions = computeRegions(COORDS, [lens], [], DEFAULT_MATERIAL.id);
    const ring = regions.find((r) => r.holes?.length)!;
    const selected = draw({ materialBoundaries: [lens], selectedRegionKey: ring.regionKey, editingAssignment: true });
    const outline = selected.strokes().filter((p) => p.state.lineWidth === 6);
    expect(outline).toHaveLength(1);
    // Clipped to the region (even-odd so the hole stays clear).
    expect(selected.paths.some((p) => p.kind === "clip" && p.fillRule === "evenodd")).toBe(true);
    const idle = draw({ materialBoundaries: [lens], selectedRegionKey: ring.regionKey, editingAssignment: false });
    expect(idle.strokes().filter((p) => p.state.lineWidth === 6)).toHaveLength(0);
  });

  it("hatches and labels high-strength materials", () => {
    const hs = {
      ...DEFAULT_MATERIAL,
      model: { kind: "high-strength", unitWeight: 20 },
    } as DrawCanvasParams["materials"][number];
    const rec = draw({ materials: [hs] });
    expect(rec.textStrings()).toContain("HS");
    // Two crossing line families, each a single path of many segments.
    const hatch = rec.strokes("#555555");
    expect(hatch).toHaveLength(2);
    for (const p of hatch) expect(pathPoints(p).length).toBeGreaterThan(10);
    const dir = ([a, b]: [number, number][]) => Math.atan2(b[1] - a[1], b[0] - a[0]) * (180 / Math.PI);
    expect(dir(pathPoints(hatch[0]))).toBeCloseTo(45, 6);
    expect(dir(pathPoints(hatch[1]))).toBeCloseTo(-45, 6);
  });

  it("draws vertices large with coordinate labels only while editing the exterior", () => {
    const editing = draw({ editingExterior: true });
    const dots = editing.callsOf("arc");
    expect(dots).toHaveLength(COORDS.length);
    expect(dots.every((c) => c.args[2] === POINT_RADIUS)).toBe(true);
    expect(editing.textStrings()).toContain("(20.0, 5.0)");
    // Upper points are labelled above, centred on the point.
    const [px, py] = toC(20, 5);
    const label = editing.findText("(20.0, 5.0)")!;
    expect(label.y).toBeLessThan(py);
    expect(label.x).toBeLessThan(px);
    expect(label.x).toBeGreaterThan(px - 60);
    // Points at the bottom of the boundary are labelled below, outside the fill.
    expect(editing.findText("(30.0, 0.0)")!.y).toBeGreaterThan(toC(30, 0)[1]);

    const idle = draw();
    expect(idle.callsOf("arc").every((c) => c.args[2] === 3)).toBe(true);
    expect(idle.textStrings().some((t) => t.startsWith("("))).toBe(false);
  });

  it("keeps coordinate labels clear of the rulers and the canvas edge", () => {
    // Points pushed to the left and bottom edges of the canvas.
    const coordinates: [number, number][] = [
      canvasToWorld(4, H - 4, W, H),
      canvasToWorld(4, 300, W, H),
      canvasToWorld(W - 4, 300, W, H),
      canvasToWorld(W - 4, H - 4, W, H),
    ];
    const rec = draw({ editingExterior: true, coordinates });
    const labels = rec.callsOf("fillText").filter((c) => String(c.args[0]).startsWith("("));
    expect(labels).toHaveLength(4);
    for (const c of labels) {
      const [, x, y] = c.args as [string, number, number];
      expect(x).toBeGreaterThanOrEqual(RULER_SIZE_PX);
      expect(x).toBeLessThan(W - 20);
      expect(y).toBeLessThan(H - RULER_SIZE_PX);
    }
  });

  /** Boxes of the drawn coordinate labels (6 px per character, 3 px padding). */
  const labelBoxes = (rec: ReturnType<typeof draw>) =>
    rec.texts
      .filter((t) => t.text.startsWith("("))
      .map((t) => ({ text: t.text, left: t.x - 3, right: t.x + t.text.length * 6 + 3, top: t.y - 7, bottom: t.y + 6 }));
  const overlap = (a: { left: number; right: number; top: number; bottom: number }, b: typeof a) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  it("places labels of close points so they don't overlap, leaving out those with no room", () => {
    // Steps 0.4 m (8 px) apart along the crest: the labels can't all sit above.
    const coordinates: [number, number][] = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10.4, 10],
      [10.8, 10],
      [11.2, 10],
      [11.6, 10],
      [20, 5],
      [30, 5],
      [30, 0],
    ];
    const rec = draw({ editingExterior: true, coordinates });
    const boxes = labelBoxes(rec);
    expect(boxes.length).toBeGreaterThan(5);
    expect(boxes.length).toBeLessThan(coordinates.length);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    }
    // Labels don't cover a vertex.
    for (const b of boxes) {
      for (const [x, y] of coordinates) {
        const [px, py] = toC(x, y);
        expect(overlap(b, { left: px - 5, right: px + 5, top: py - 5, bottom: py + 5 })).toBe(false);
      }
    }
    // A hovered point always shows its label.
    for (let i = 2; i <= 6; i++) {
      const hovered = draw({ editingExterior: true, coordinates, hoverHit: { kind: "external", index: i } });
      expect(hovered.textStrings()).toContain(`(${coordinates[i][0].toFixed(1)}, ${coordinates[i][1].toFixed(1)})`);
      const selected = draw({ editingExterior: true, coordinates, selectedPointIndex: i });
      expect(selected.textStrings()).toContain(`(${coordinates[i][0].toFixed(1)}, ${coordinates[i][1].toFixed(1)})`);
    }
  });

  it("keeps coordinate labels off search-limit markers, loads and water-table symbols", () => {
    const rec = draw({
      editingExterior: true,
      analysisLimits: { enabled: true, entryLeftX: 10, entryRightX: 8, exitLeftX: 20, exitRightX: 28 },
      lineLoads: [{ id: "l1", x: 30, magnitude: 50 }],
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        lines: [{ id: "w1", name: "W1", color: "#1a3a8a", coordinates: [[0, 8], [20, 5]] }],
        activeLineId: "w1",
      },
    });
    const [mx, my] = toC(10, 10);
    const [lx, ly] = toC(30, 5);
    const [wx, wy] = toC(10, 6.5);
    const keepOut = [
      { left: mx - 1, right: mx + 1, top: my - 10, bottom: my + 10 }, // marker bar at the crest vertex
      { left: lx - 1, right: lx + 1, top: ly - 38, bottom: ly }, // line-load shaft at the toe vertex
      { left: wx - 6, right: wx + 6, top: wy - 10, bottom: wy }, // water-table symbol
    ];
    const boxes = labelBoxes(rec);
    expect(boxes.map((b) => b.text)).toContain("(10.0, 10.0)");
    for (const b of boxes) for (const k of keepOut) expect(overlap(b, k)).toBe(false);
  });

  it("puts each coordinate label on a near-opaque plate of the background colour", () => {
    const rec = draw({ editingExterior: true });
    const plates = rec.callsOf("fillRect").filter((c) => c.state.globalAlpha === POINT_LABEL_PLATE_ALPHA);
    expect(plates).toHaveLength(COORDS.length);
    expect(POINT_LABEL_PLATE_ALPHA).toBeGreaterThanOrEqual(0.9);
  });

  it("clips interior boundaries to the model; outside parts only while editing them", () => {
    // Runs from x = -5 to 35, past the model on both sides.
    const boundary = { id: "b1", coordinates: [[-5, 4], [35, 4]] as [number, number][] };
    const strokesOf = (rec: ReturnType<typeof draw>) =>
      rec.strokes().filter((p) => hasPoints(p, [toC(-5, 4), toC(35, 4)]));
    const idle = draw({ materialBoundaries: [boundary] });
    const inside = strokesOf(idle);
    expect(inside).toHaveLength(1);
    // Drawn inside a clip to the exterior boundary.
    const clipIndex = idle.paths.findIndex((p) => p.kind === "clip" && hasPoints(p, COORDS.map(([x, y]) => toC(x, y))));
    expect(clipIndex).toBeGreaterThanOrEqual(0);
    expect(idle.paths.indexOf(inside[0])).toBeGreaterThan(clipIndex);
    // Its end points off the model are hidden when not editing boundaries.
    expect(idle.callsOf("arc").filter((c) => c.args[0] === toC(-5, 4)[0])).toHaveLength(0);

    const editing = draw({ materialBoundaries: [boundary], editingBoundaries: true });
    const both = strokesOf(editing);
    expect(both).toHaveLength(2);
    expect(both[1].state.lineDash.length).toBeGreaterThan(0);
    expect(both[1].state.globalAlpha).toBeLessThan(1);
    expect(editing.paths.some((p) => p.kind === "clip" && p.fillRule === "evenodd")).toBe(true);
    expect(editing.callsOf("arc").filter((c) => c.args[2] === POINT_RADIUS - 1)).toHaveLength(2);
  });

  it("draws prescribed slip surfaces faint and dashed in the edit view only", () => {
    const customSearchPlanes = [
      { id: "c1", cx: 15, cy: 14, radius: 10 },
      { id: "p1", cx: 0, cy: 0, radius: 0, points: [[5, 10], [15, 3], [25, 5]] as [number, number][] },
    ];
    const rec = draw({ customSearchPlanes });
    const dashed = rec.strokes().filter((p) => p.state.lineDash.length > 0 && p.state.globalAlpha < 1);
    const circle = dashed.find((p) => p.segments.some((s) => s.op === "arc"));
    expect(circle?.segments.find((s) => s.op === "arc")).toMatchObject({ x: toC(15, 14)[0], y: toC(15, 14)[1], r: 200 });
    expect(dashed.some((p) => hasPoints(p, [toC(5, 10), toC(15, 3), toC(25, 5)]))).toBe(true);
    const result = draw({ customSearchPlanes, mode: "result" });
    expect(result.strokes().some((p) => p.segments.some((s) => s.op === "arc" && s.r === 200))).toBe(false);
  });

  it("colours the selected and hovered vertices", () => {
    const rec = draw({
      editingExterior: true,
      selectedPointIndex: 2,
      hoverHit: { kind: "external", index: 3 },
    });
    const dotAt = (i: number) =>
      rec.fills().find((p) => p.segments[0].op === "arc" && close(pathPoints(p)[0], toC(...COORDS[i])))!;
    expect(dotAt(2).state.fillStyle).toBe(POINT_COLOR_SELECTED);
    expect(dotAt(3).state.fillStyle).toBe(POINT_COLOR_HOVER);
    expect(dotAt(0).state.fillStyle).toBe(POINT_COLOR);
  });

  it("draws grid lines at round world steps and the axes through the origin", () => {
    const rec = draw();
    const vertical = rec
      .strokes("rgba(0, 0, 0, 0.1)")
      .map(pathPoints)
      .filter(([a, b]) => a[0] === b[0])
      .map(([a]) => canvasToWorld(a[0], 0, W, H)[0]);
    expect(vertical.length).toBeGreaterThan(3);
    const step = vertical[1] - vertical[0];
    expect(step).toBeGreaterThan(0);
    for (const x of vertical) expect(Math.abs(x / step - Math.round(x / step))).toBeLessThan(1e-6);
    // Axis line at world x = 0 spans the full height.
    const axis = rec.strokes().find((p) => hasPoints(p, [[toC(0, 0)[0], 0], [toC(0, 0)[0], H]]));
    expect(axis).toBeDefined();
  });

  it("highlights the selected interior boundary while its dialog is open", () => {
    const boundary = {
      id: "b1",
      coordinates: [
        [0, 4],
        [30, 3],
      ] as [number, number][],
    };
    const rec = draw({
      materialBoundaries: [boundary],
      interiorBoundariesDialogOpen: true,
      selectedMaterialBoundaryId: "b1",
      editingBoundaries: true,
    });
    const line = rec.strokes("#f59e0b").find((p) => hasPoints(p, [toC(0, 4), toC(30, 3)]));
    expect(line?.state.lineWidth).toBe(2);
    // Boundary vertices are drawn (selected colour, slightly smaller than exterior ones).
    const dots = rec.callsOf("arc").filter((c) => c.args[2] === POINT_RADIUS - 1);
    expect(dots).toHaveLength(2);

    const unselected = draw({ materialBoundaries: [boundary] });
    expect(unselected.strokes("#f59e0b")).toHaveLength(0);
  });

  it("draws a UDL with arrows ending on the ground and a label above", () => {
    const rec = draw({ udls: [{ id: "u1", magnitude: 15, x1: 2, x2: 8 }] });
    const label = rec.findText("q = 15 kPa")!;
    expect(label.x).toBeCloseTo((toC(2, 10)[0] + toC(8, 10)[0]) / 2, 6);
    expect(label.y).toBeCloseTo(toC(2, 10)[1] - 38 - 8, 6);
    const shafts = rec
      .strokes(UDL_LOAD_COLOR.hex)
      .filter((p) => p.state.lineWidth === 2)
      .map(pathPoints);
    expect(shafts).toEqual([
      [[toC(2, 10)[0], toC(2, 10)[1] - 38], toC(2, 10)],
      [[toC(8, 10)[0], toC(8, 10)[1] - 38], toC(8, 10)],
    ]);
    // Arrowheads have their tip on the ground.
    const heads = rec.fills(UDL_LOAD_COLOR.hex);
    expect(pathPoints(heads[0])[0]).toEqual(toC(2, 10));
  });

  it("follows the ground across a slope break and highlights a hovered UDL handle", () => {
    const rec = draw({
      udls: [{ id: "u1", magnitude: 5, x1: 8, x2: 14 }],
      hoverHit: { kind: "udl", udlId: "u1", handle: "x2" },
    });
    // Outline passes through the crest vertex (10, 10).
    const outline = rec.strokes(UDL_LOAD_COLOR.hex).find((p) => p.state.lineWidth === 1.5)!;
    expect(pathPoints(outline).some((p) => close(p, toC(10, 10)))).toBe(true);
    const hovered = rec.strokes("#ff0000");
    expect(hovered).toHaveLength(1);
    expect(hovered[0].state.lineWidth).toBe(3);
    expect(pathPoints(hovered[0])[1]).toEqual(toC(14, 8));
  });

  it("skips UDLs off the model", () => {
    const rec = draw({ udls: [{ id: "u1", magnitude: 5, x1: -5, x2: 2 }] });
    expect(rec.texts.some((t) => t.text.startsWith("q ="))).toBe(false);
  });

  it("draws a line load arrow at its x with the label above", () => {
    const rec = draw({ lineLoads: [{ id: "l1", magnitude: 50, x: 25 }] });
    const shaft = rec.strokes(LINE_LOAD_COLOR.hex)[0];
    expect(pathPoints(shaft)).toEqual([[toC(25, 5)[0], toC(25, 5)[1] - 38], toC(25, 5)]);
    expect(rec.findText("P = 50 kN/m")).toMatchObject({ x: toC(25, 5)[0], y: toC(25, 5)[1] - 42 });

    const hover = draw({
      lineLoads: [{ id: "l1", magnitude: 50, x: 25 }],
      hoverHit: { kind: "lineLoad", loadId: "l1" },
    });
    expect(hover.strokes("#3b82f6")).toHaveLength(1);
  });

  it("draws reinforcement and piles", () => {
    const rec = draw({
      reinforcements: [newReinforcement("r1", "anchor", COORDS, "ltr")],
      piles: [newPile("p1", "pile", COORDS)],
    });
    expect(rec.strokes(REINFORCEMENT_COLOR).length).toBeGreaterThan(0);
    expect(rec.strokes(PILE_COLOR)).toHaveLength(1);
    expect(rec.textStrings()).toEqual(expect.arrayContaining(["1", "P1"]));
  });

  it("draws piezometric lines with symbols, numbering only when there are several", () => {
    const line = (id: string, y: number) => ({
      id,
      name: id,
      color: "#000",
      coordinates: [
        [0, y],
        [30, y],
      ] as [number, number][],
    });
    const single = draw({
      piezometricLine: { ...DEFAULT_PIEZO_LINE, lines: [line("a", 4)], activeLineId: "a" },
    });
    const stroke = single.strokes(PIEZO_COLOR.hex).find((p) => p.state.lineWidth === 1.5)!;
    expect(pathPoints(stroke)).toEqual([toC(0, 4), toC(30, 4)]);
    // Inverted triangle with its tip on the line at the segment midpoint.
    const tri = single.fills(PIEZO_COLOR.hex).find((p) => p.segments.length === 4)!;
    expect(pathPoints(tri)[2]).toEqual(toC(15, 4));
    expect(single.texts.some((t) => t.text === "1")).toBe(false);

    const multi = draw({
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        lines: [line("a", 4), line("b", 2)],
        activeLineId: "a",
      },
    });
    expect(multi.textStrings()).toEqual(expect.arrayContaining(["1", "2"]));
  });

  it("highlights the active piezometric line and labels its vertices while editing", () => {
    const rec = draw({
      editingPiezo: true,
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        lines: [
          {
            id: "a",
            name: "a",
            color: "#000",
            coordinates: [
              [0, 4],
              [30, 4],
            ],
          },
        ],
        activeLineId: "a",
      },
    });
    const active = rec.strokes("#f59e0b").find((p) => p.state.lineWidth === 3);
    expect(active).toBeDefined();
    expect(rec.textStrings()).toEqual(expect.arrayContaining(["(0.0, 4.0)", "(30.0, 4.0)"]));
  });

  it("colours water-line vertices by hover, active line and editing state", () => {
    const line = (id: string, y: number) => ({
      id,
      name: id,
      color: "#000",
      coordinates: [
        [0, y],
        [30, y],
      ] as [number, number][],
    });
    const piezometricLine = {
      ...DEFAULT_PIEZO_LINE,
      freeWater: false,
      lines: [line("a", 4), line("b", 2), { ...line("c", 1), coordinates: [[3, 1]] as [number, number][] }],
      activeLineId: "a",
    };
    const dotColour = (rec: ReturnType<typeof draw>, x: number, y: number) =>
      rec.fills().find((p) => p.segments[0].op === "arc" && close(pathPoints(p)[0], toC(x, y)))?.state.fillStyle;
    const editing = draw({ editingPiezo: true, piezometricLine, hoverHit: { kind: "piezo", lineId: "b", index: 1 } });
    expect(dotColour(editing, 0, 4)).toBe("#f59e0b"); // active line
    expect(dotColour(editing, 0, 2)).toBe(PIEZO_COLOR.hex); // other line
    expect(dotColour(editing, 30, 2)).toBe(POINT_COLOR_HOVER);
    // A line with a single point is not drawn.
    expect(dotColour(editing, 3, 1)).toBeUndefined();
    const idle = draw({ piezometricLine });
    expect(dotColour(idle, 0, 4)).toBe(PIEZO_COLOR.hex + "99");
    expect(idle.callsOf("arc").filter((c) => c.args[2] === 3).length).toBeGreaterThanOrEqual(4);
  });

  it("skips line loads off the model", () => {
    const rec = draw({ lineLoads: [{ id: "l", magnitude: 5, x: 45 }] });
    expect(rec.texts.some((t) => t.text.startsWith("P ="))).toBe(false);
  });

  it("fills free water standing above the ground", () => {
    const rec = draw({
      piezometricLine: {
        ...DEFAULT_PIEZO_LINE,
        lines: [
          {
            id: "a",
            name: "a",
            color: "#000",
            coordinates: [
              [0, 7],
              [30, 7],
            ],
          },
        ],
        activeLineId: "a",
      },
    });
    const water = rec.fills(POND_COLOR.hex).filter((p) => p.state.globalAlpha === POND_OPACITY);
    expect(water).toHaveLength(1);
    // The pond lies over the toe (x ≥ 16 where the ground is below y = 7).
    const xs = pathPoints(water[0]).map(([x]) => canvasToWorld(x, 0, W, H)[0]);
    expect(Math.min(...xs)).toBeCloseTo(16, 6);
    expect(Math.max(...xs)).toBeCloseTo(30, 6);
  });

  it("draws entry/exit markers pointing inwards, mirrored for right-to-left models", () => {
    const limits = { enabled: true, entryLeftX: 2, entryRightX: 8, exitLeftX: 21, exitRightX: 28 };
    const tipOffset = (rec: ReturnType<typeof draw>, x: number, y: number) => {
      const [cx, cy] = toC(x, y);
      const head = rec
        .fills()
        .find((p) => p.segments.length === 4 && close(pathPoints(p)[0], [cx, cy]))!;
      return pathPoints(head)[1][0] - cx;
    };
    const ltr = draw({ analysisLimits: limits });
    expect(tipOffset(ltr, 2, 10)).toBeLessThan(0); // ">|" on the left handle
    expect(tipOffset(ltr, 8, 10)).toBeGreaterThan(0); // "|<" on the right handle
    const rtl = draw({ analysisLimits: limits, orientation: "rtl" });
    expect(tipOffset(rtl, 2, 10)).toBeGreaterThan(0);
    expect(tipOffset(rtl, 8, 10)).toBeLessThan(0);

    // Dotted ranges: green between the entry handles, red between the exit handles.
    const entryDots = ltr.fills(ENTRY_DOT_COLOR.hex).filter((p) => p.segments[0].op === "arc");
    const exitDots = ltr.fills(EXIT_DOT_COLOR.hex).filter((p) => p.segments[0].op === "arc");
    expect(entryDots.length).toBeGreaterThan(3);
    expect(exitDots.length).toBeGreaterThan(3);
    for (const d of entryDots) {
      const [wx, wy] = canvasToWorld(...pathPoints(d)[0], W, H);
      expect(wx).toBeGreaterThan(2);
      expect(wx).toBeLessThan(8);
      expect(wy).toBeCloseTo(10, 6);
    }
  });

  it("highlights a hovered limit handle", () => {
    const rec = draw({
      analysisLimits: { enabled: true, entryLeftX: 2, entryRightX: 8, exitLeftX: 21, exitRightX: 28 },
      hoverHit: { kind: "limit", handle: "exitRightX" },
    });
    const bar = rec
      .strokes(EXIT_DOT_COLOR.hex)
      .find((p) => close(pathPoints(p)[0], [toC(28, 5)[0], toC(28, 5)[1] - 10]));
    expect(bar?.state.lineWidth).toBe(2.5);
  });

  it("draws a dashed crosshair through the mouse position", () => {
    const rec = draw({ mouseWorld: [12, 6] });
    const [mx, my] = toC(12, 6);
    const dashed = rec.strokes().filter((p) => p.state.lineDash.length === 2);
    expect(dashed.map(pathPoints)).toEqual(
      expect.arrayContaining([
        [
          [mx, 0],
          [mx, H],
        ],
        [
          [0, my],
          [W, my],
        ],
      ]),
    );
  });
});

describe("drawCanvas — result mode", () => {
  const drawResult = (over: Partial<DrawCanvasParams> = {}) =>
    draw({ mode: "result", result: result(), resultViewSettings: rvs(), ...over });

  it("keeps save/restore balanced with every option on", () => {
    const rec = drawResult({
      result: result({ criticalSlices: [slice(6, 8), slice(8, 10)] }),
      resultViewSettings: rvs({
        showSlices: true,
        showFosLabel: true,
        showCentreMarker: true,
        surfaceDisplay: "all",
        minorTicks: 1,
        annotations: [
          { id: "t", type: "text", x: 0.1, y: 0.1, text: "Hello" },
          { id: "c", type: "color-bar", x: 0.8, y: 0.2 },
          { id: "p", type: "plot", x: 0.5, y: 0.5 },
          { id: "m", type: "material-table", x: 0.9, y: 0.05, anchor: "top-right" },
        ],
      }),
      selectedAnnotationIds: ["t", "c", "p", "m"],
      selectedResultObject: "paper-frame",
    });
    expect(rec.depth()).toBe(0);
  });

  it("strokes the critical surface along the circle from entry to exit", () => {
    const rec = drawResult();
    const arc = rec.strokes().find((p) => p.state.lineWidth === 2 && pathPoints(p).length > 20)!;
    const pts = pathPoints(arc).map(([x, y]) => canvasToWorld(x, y, W, H));
    expect(pts[0][0]).toBeCloseTo(ENTRY_X, 6);
    expect(pts[0][1]).toBeCloseTo(10, 6);
    expect(pts.at(-1)![0]).toBeCloseTo(22, 6);
    for (const [x, y] of pts) {
      expect(Math.hypot(x - CIRCLE.cx, y - CIRCLE.cy)).toBeCloseTo(R, 6);
      expect(y).toBeLessThan(CIRCLE.cy);
    }
  });

  it("fills the sliding mass between the ground and the surface", () => {
    const rec = drawResult();
    const mass = rec.fills().find((p) => p.state.globalAlpha === 0.12)!;
    const pts = pathPoints(mass).map(([x, y]) => canvasToWorld(x, y, W, H));
    // Top edge walks the ground entry → crest (10, 10) → exit.
    expect(pts[0][0]).toBeCloseTo(ENTRY_X, 6);
    expect(pts.some((p) => close(p, [10, 10]))).toBe(true);
  });

  it("fills the same sliding mass for a mirrored (right-to-left) model", () => {
    const massArea = (coords: [number, number][], cs: SlipSurfaceResult) => {
      const rec = drawResult({
        coordinates: coords,
        surfaceYAtX: (x) => surfaceYAtXFromCoordinates(coords, x),
        result: result({ criticalSurface: cs, allSurfaces: [cs] }),
      });
      const pts = pathPoints(rec.fills().find((p) => p.state.globalAlpha === 0.12)!);
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        a += x1 * y2 - x2 * y1;
      }
      return Math.abs(a) / 2;
    };
    const mirror = ([x, y]: [number, number]): [number, number] => [30 - x, y];
    const cs = surface();
    const ltr = massArea(COORDS, cs);
    const rtl = massArea(COORDS.map(mirror).reverse(), {
      ...cs,
      cx: 30 - cs.cx,
      entryPoint: mirror(cs.entryPoint),
      exitPoint: mirror(cs.exitPoint),
    });
    expect(ltr).toBeGreaterThan(1000);
    expect(rtl).toBeCloseTo(ltr, 3);
  });

  it("marks the centre and draws radius lines when asked", () => {
    const rec = drawResult({ resultViewSettings: rvs({ showCentreMarker: true }) });
    const c = toC(CIRCLE.cx, CIRCLE.cy);
    const dot = rec.fills().find((p) => p.segments[0].op === "arc" && close(pathPoints(p)[0], c));
    expect(dot).toBeDefined();
    const radii = rec.strokes().filter((p) => pathPoints(p).length === 2 && close(pathPoints(p)[0], c));
    expect(radii.map((p) => pathPoints(p)[1])).toEqual([toC(ENTRY_X, 10), toC(22, 5)]);

    const off = drawResult();
    expect(off.fills().some((p) => p.segments[0].op === "arc" && close(pathPoints(p)[0], c))).toBe(false);
  });

  it("labels the FOS right of the centre with three decimals and underlines it", () => {
    const rec = drawResult({ resultViewSettings: rvs({ showFosLabel: true }) });
    const label = rec.findText("1.234")!;
    const [ccx, ccy] = toC(CIRCLE.cx, CIRCLE.cy);
    expect(label.x).toBe(ccx + 10);
    expect(label.y).toBe(ccy - 4);
    expect(label.state.textAlign).toBe("left");
    const underline = rec.strokes().find((p) => p.state.lineWidth === 1.5 && close(pathPoints(p)[0], [ccx + 9, ccy + 2]));
    expect(underline).toBeDefined();
  });

  it("places the FOS label of a non-circular surface above the middle of the mass and omits the centre", () => {
    const poly = surface({
      cx: 14,
      cy: 20,
      radius: 0,
      points: [
        [ENTRY_X, 10],
        [12, 6],
        [22, 5],
      ],
    });
    const rec = drawResult({
      result: result({ criticalSurface: poly, allSurfaces: [poly] }),
      resultViewSettings: rvs({ showFosLabel: true, showCentreMarker: true }),
    });
    const label = rec.findText("1.234")!;
    const [ax, ay] = toC((ENTRY_X + 22) / 2, 10);
    expect(label.x).toBe(ax + 10);
    expect(label.y).toBe(ay - 4);
    expect(rec.fills().some((p) => p.segments[0].op === "arc" && close(pathPoints(p)[0], toC(14, 20)))).toBe(false);
  });

  it("draws slice boundaries from the ground down to the surface", () => {
    const rec = drawResult({
      result: result({ criticalSlices: [slice(8, 12), slice(12, 16)] }),
      resultViewSettings: rvs({ showSlices: true }),
    });
    const lines = rec
      .strokes()
      .filter((p) => p.state.globalAlpha < 1 && pathPoints(p).length === 2)
      .map((p) => pathPoints(p).map(([x, y]) => canvasToWorld(x, y, W, H)));
    expect(lines).toHaveLength(3);
    const at12 = lines.find(([a]) => Math.abs(a[0] - 12) < 1e-9)!;
    expect(at12[0][1]).toBeCloseTo(9, 6); // ground on the slope
    expect(at12[1][1]).toBeCloseTo(CIRCLE.cy - Math.sqrt(R * R - 9), 6);
  });

  it("draws other surfaces by FOS colour, filters them, and never redraws the critical one", () => {
    const s2 = surface({ cx: 15, cy: 16, fos: 1.5 });
    const s3 = surface({ cx: 15, cy: 18, fos: 9 });
    const res = result({ allSurfaces: [surface(), s2, s3], maxFOS: 9 });
    const all = drawResult({ result: res, resultViewSettings: rvs({ surfaceDisplay: "all" }) });
    const faint = all.strokes().filter((p) => p.state.globalAlpha === SLIP_SURFACE_OPACITY);
    expect(faint).toHaveLength(2);
    // Highest FOS first so the lowest ends on top; the FOS 9 surface is past
    // the capped scale (max = 2 × 1.234) and gets its top colour.
    expect(faint[0].state.strokeStyle).toBe(fosColor(9, 1.234, 2.468));
    expect(faint[0].state.strokeStyle).toBe(fosColor(2.468, 1.234, 2.468));
    expect(faint[1].state.strokeStyle).toBe(fosColor(1.5, 1.234, 2.468));

    const filtered = drawResult({
      result: res,
      resultViewSettings: rvs({ surfaceDisplay: "filter", fosFilterMax: 2 }),
    });
    expect(filtered.strokes().filter((p) => p.state.globalAlpha === SLIP_SURFACE_OPACITY)).toHaveLength(1);

    const criticalOnly = drawResult({ result: res });
    expect(criticalOnly.strokes().filter((p) => p.state.globalAlpha === SLIP_SURFACE_OPACITY)).toHaveLength(0);
  });

  it("draws reinforcement forces on the critical surface", () => {
    const cs = surface({
      reinforcementForces: [{ index: 0, x: 12, y: 6, fx: -40, fy: 10, force: 41.2, passive: true }],
    });
    const rec = drawResult({ result: result({ criticalSurface: cs, allSurfaces: [cs] }) });
    const label = rec.findText("41.2 kN/m /F")!;
    expect(label.state.textAlign).toBe("right");
    expect(label.x).toBeLessThan(toC(12, 6)[0]);
  });

  it("puts axis tick labels at round values inside the plot frame, with minor ticks", () => {
    const rec = drawResult({ resultViewSettings: rvs({ gridSpacing: 5, minorTicks: 4 }) });
    const xLabels = rec.texts.filter((t) => t.state.textBaseline === "top" && /^-?\d+$/.test(t.text));
    expect(xLabels.length).toBeGreaterThan(2);
    for (const t of xLabels) {
      const wx = canvasToWorld(t.x, 0, W, H)[0];
      expect(wx).toBeCloseTo(Number(t.text), 6);
      expect(Number(t.text) % 5).toBe(0);
    }
    const yLabels = rec.texts.filter((t) => t.state.textAlign === "right" && /^-?\d+$/.test(t.text));
    for (const t of yLabels) {
      expect(canvasToWorld(0, t.y, W, H)[1]).toBeCloseTo(Number(t.text), 6);
    }
    // Minor ticks are 3 px long, majors 6 px.
    const tickLens = rec
      .strokes()
      .map(pathPoints)
      .filter((p) => p.length === 2 && p[0][0] === p[1][0])
      .map(([a, b]) => Math.abs(b[1] - a[1]));
    expect(tickLens.filter((l) => l === 3).length).toBeGreaterThanOrEqual(xLabels.length * 3);
  });

  it("draws a grid line at every labelled tick (one spacing for grid and ticks)", () => {
    for (const scale of [6, 10, 14, 20, 35]) {
      const w2c = (wx: number, wy: number, w: number, h: number): [number, number] => [
        w / 2 + (wx - CX) * scale,
        h / 2 - (wy - CY) * scale,
      ];
      const c2w = (cx: number, cy: number, w: number, h: number): [number, number] => [
        (cx - w / 2) / scale + CX,
        -(cy - h / 2) / scale + CY,
      ];
      const rec = drawResult({ worldToCanvas: w2c, canvasToWorld: c2w, viewScale: scale, resultViewSettings: rvs({ showGrid: true }) });
      const gridX = rec
        .strokes("rgba(0, 0, 0, 0.1)")
        .map(pathPoints)
        .filter(([a, b]) => a[0] === b[0])
        .map(([a]) => a[0]);
      const tickX = rec.texts.filter((t) => t.state.textBaseline === "top" && /^-?\d+(\.\d+)?$/.test(t.text)).map((t) => t.x);
      expect(tickX.length, `scale ${scale}`).toBeGreaterThan(1);
      for (const x of tickX) {
        expect(gridX.some((g) => Math.abs(g - x) < 1e-6), `tick at ${x}px, scale ${scale}`).toBe(true);
      }
    }
  });

  it("hides the grid when switched off", () => {
    const on = drawResult({ resultViewSettings: rvs({ showGrid: true }) });
    const off = drawResult({ resultViewSettings: rvs({ showGrid: false }) });
    expect(on.strokes("rgba(0, 0, 0, 0.1)").length).toBeGreaterThan(0);
    expect(off.strokes("rgba(0, 0, 0, 0.1)")).toHaveLength(0);
  });

  it("renders text annotations with resolved placeholders, one line per row", () => {
    const anno: Annotation = { id: "t", type: "text", x: 0.2, y: 0.2, text: "FOS #FOS\nsecond", bold: true };
    const rec = drawResult({ resultViewSettings: rvs({ annotations: [anno] }) });
    const first = rec.texts.find((t) => t.text.startsWith("FOS "))!;
    expect(first.text).toContain("1.23");
    expect(first.state.font).toMatch(/^normal bold /);
    const second = rec.findText("second")!;
    expect(second.x).toBe(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("draws a colour bar with FOS title and a capped top tick", () => {
    const anno: Annotation = { id: "c", type: "color-bar", x: 0.8, y: 0.3 };
    const capped = drawResult({
      result: result({ maxFOS: 10 }),
      resultViewSettings: rvs({ annotations: [anno] }),
    });
    expect(capped.textStrings()).toContain("FOS");
    expect(capped.textStrings()).toContain("≥ 2.47");
    expect(capped.textStrings()).toContain("1.23");
    // Top of the gradient is the high-FOS colour, bottom the critical colour.
    const bars = capped.callsOf("fillRect").filter((c) => c.args[3] === 2);
    expect(bars[0].state.fillStyle).toBe(fosColor(2.468, 1.234, 2.468));
    expect(bars.at(-1)!.state.fillStyle).toBe(fosColor(1.234, 1.234, 2.468));

    const uncapped = drawResult({ resultViewSettings: rvs({ annotations: [anno] }) });
    expect(uncapped.textStrings()).toContain("1.80");
    expect(uncapped.textStrings().some((t) => t.startsWith("≥"))).toBe(false);
  });

  it("draws a slice plot with axis end labels, or a placeholder without slices", () => {
    const anno: Annotation = { id: "p", type: "plot", x: 0.5, y: 0.5, plotAxisX: "slice", plotAxisY: "cohesion" };
    const empty = drawResult({ resultViewSettings: rvs({ annotations: [anno] }) });
    expect(empty.textStrings()).toContain("No slice data");

    const rec = drawResult({
      result: result({
        criticalSlices: [slice(6, 8, { cohesion: 10 }), slice(8, 10, { cohesion: 20 }), slice(10, 12, { cohesion: 30 })],
      }),
      resultViewSettings: rvs({ annotations: [anno] }),
    });
    expect(rec.textStrings()).not.toContain("No slice data");
    const line = rec.strokes("#26a69a")[0];
    const pts = pathPoints(line);
    expect(pts).toHaveLength(3);
    // Rising cohesion → rising curve (screen y decreasing).
    expect(pts[0][1]).toBeGreaterThan(pts[1][1]);
    expect(pts[1][1]).toBeGreaterThan(pts[2][1]);
    expect(rec.fills("#26a69a")).toHaveLength(3);
  });

  it("outlines selected annotations and the paper frame with a dashed rectangle", () => {
    const anno: Annotation = { id: "t", type: "text", x: 0.2, y: 0.2, text: "Hi" };
    const none = drawResult({ resultViewSettings: rvs({ annotations: [anno] }) });
    expect(none.strokes("#0078d4")).toHaveLength(0);
    const selected = drawResult({
      resultViewSettings: rvs({ annotations: [anno] }),
      selectedAnnotationIds: ["t"],
      selectedResultObject: "paper-frame",
    });
    const outlines = selected.strokes("#0078d4");
    expect(outlines).toHaveLength(2);
    expect(outlines.every((p) => p.state.lineDash.join() === "4,3")).toBe(true);
  });

  it("does not draw edit affordances (vertices, crosshair) in result mode", () => {
    const rec = drawResult({ mouseWorld: [5, 5], editingExterior: true });
    expect(rec.texts.some((t) => t.text.startsWith("("))).toBe(false);
    expect(rec.strokes().some((p) => p.state.lineDash.join() === "4,4")).toBe(false);
  });
});
