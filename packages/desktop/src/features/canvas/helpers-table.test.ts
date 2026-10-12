import { describe, expect, it } from "vitest";
import type { AnalysisResult, MaterialModel } from "@cslope/engine";
import {
  buildMaterialTableData,
  drawTable,
  extendBoundsWithFosLabelFitPadding,
  getAnnotationBoundsPx,
  measureTable,
} from "./helpers";
import { drawCanvas, type DrawCanvasParams } from "./draw";
import { createRecordingContext, type TextCall } from "../../test/recording-context";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  DEFAULT_PROJECT_INFO,
  DEFAULT_RESULT_VIEW_SETTINGS,
} from "../../store/defaults";
import { computePaperFrame } from "../view/paper";
import type { AnchorPosition, Annotation, MaterialRow } from "../../store/types";

const row = (id: string, model: MaterialModel, extra: Partial<MaterialRow> = {}): MaterialRow => ({
  id,
  name: id,
  color: "#123456",
  modelExpressions: {},
  model,
  ...extra,
});

const ALL_COLUMNS: Annotation = {
  id: "t",
  type: "material-table",
  x: 0,
  y: 0,
  tableColumns: ["model", "unitWeight", "cohesion", "frictionAngle", "piezometricLine", "depthRef", "cDatum", "cRate"],
};

function cells(materials: MaterialRow[], piezo = DEFAULT_PIEZO_LINE) {
  const t = buildMaterialTableData(ALL_COLUMNS, materials, piezo);
  return t.rows.map((r) => Object.fromEntries(t.columnKeys.map((k, i) => [k, r[i]])));
}

describe("material table cells", () => {
  it("formats each material model's strength columns", () => {
    const [mc, undr, aniso, lcc, lccDrained, datum, hs] = cells([
      row("mc", { kind: "mohr-coulomb", unitWeight: 19, unitWeightSat: 21, cohesion: 5, frictionAngle: 30 }),
      row("undr", { kind: "undrained", unitWeight: 18, undrainedShearStrength: 25, suMax: 60 }),
      row("aniso", { kind: "anisotropic-function", unitWeight: 18, cohesion: 3, frictionAngle: 28, modifierFunction: [] }),
      row("lcc", { kind: "lime-cement-columns", unitWeight: 17, soilSu: 12, columnSu: 100, areaRatio: 0.2 }),
      row("lccD", {
        kind: "lime-cement-columns",
        unitWeight: 17,
        soilSu: 12,
        columnSu: 100,
        areaRatio: 0.2,
        columnFrictionAngle: 30,
      }),
      row("datum", { kind: "s-f-datum", unitWeight: 18, suRef: 20, yRef: 5, rate: 1.5 }),
      row("hs", { kind: "high-strength", unitWeight: 22 }),
    ]);
    expect(mc).toMatchObject({ name: "mc", model: "M-C", unitWeight: "19 / 21", cohesion: "5", frictionAngle: "30°", depthRef: "-" });
    expect(undr).toMatchObject({ unitWeight: "18", cohesion: "25 (cutoff 60)", frictionAngle: "0°", cRate: "-" });
    expect(aniso).toMatchObject({ cohesion: "3", frictionAngle: "28°" });
    expect(lcc.frictionAngle).toBe("0°");
    expect(lccDrained.frictionAngle).toBe("30° (col.)");
    expect(datum).toMatchObject({ depthRef: "5", cDatum: "20", cRate: "1.5", cohesion: "-", frictionAngle: "0°" });
    expect(hs).toMatchObject({ model: "High-S", cohesion: "-", frictionAngle: "-" });
  });

  it("names the water line of each material, defaulting to the main line", () => {
    const piezo = {
      ...DEFAULT_PIEZO_LINE,
      lines: [
        { id: "w1", name: "Main", color: "#00f", coordinates: [] as [number, number][] },
        { id: "w2", name: "Perched", color: "#0f0", coordinates: [] as [number, number][] },
      ],
      activeLineId: "w1",
      materialAssignment: { b: "w2" },
    };
    const [a, b] = cells([row("a", DEFAULT_MATERIAL.model), row("b", DEFAULT_MATERIAL.model)], piezo);
    expect(a.piezometricLine).toBe("Main");
    expect(b.piezometricLine).toBe("Perched");
    expect(cells([row("a", DEFAULT_MATERIAL.model)])[0].piezometricLine).toBe("-");
  });

  it("uses the default columns when none are chosen", () => {
    const t = buildMaterialTableData({ id: "t", type: "material-table", x: 0, y: 0 }, [row("a", DEFAULT_MATERIAL.model)]);
    expect(t.columnKeys.slice(0, 2)).toEqual(["color", "name"]);
    expect(t.header).toContain("Unit Weight (kN/m3)");
    expect(t.columnKeys).toHaveLength(10);
  });
});

describe("drawTable", () => {
  const materials = [
    row("a", DEFAULT_MATERIAL.model, { color: "#ff0000", name: "A very long material name that cannot fit" }),
    row("b", DEFAULT_MATERIAL.model, { color: "#00ff00", name: "B" }),
  ];

  it("draws an outline the size measureTable reports, with a swatch per material", () => {
    const { columnKeys, header, rows } = buildMaterialTableData(ALL_COLUMNS, materials);
    const rec = createRecordingContext();
    const size = measureTable(rec.ctx, columnKeys, header, rows, 1.5, 8);
    rec.reset();
    drawTable(rec.ctx, 10, 20, columnKeys, header, rows, materials, 1.5, 8);
    expect(rec.callsOf("strokeRect")[0].args).toEqual([10, 20, size.w, size.h]);
    const swatches = rec.fills().filter((p) => ["#ff0000", "#00ff00"].includes(p.state.fillStyle));
    expect(swatches.map((p) => p.state.fillStyle)).toEqual(["#ff0000", "#00ff00"]);
    // Rows are drawn inside the table.
    for (const t of rec.texts) {
      expect(t.x).toBeGreaterThanOrEqual(10);
      expect(t.x).toBeLessThan(10 + size.w);
      expect(t.y).toBeLessThan(20 + size.h);
    }
  });

  it("truncates long cells with an ellipsis and wraps long headers", () => {
    const { columnKeys, header, rows } = buildMaterialTableData(ALL_COLUMNS, materials);
    const rec = createRecordingContext(800, 600, { measureCharWidth: 6 });
    drawTable(rec.ctx, 0, 0, columnKeys, header, rows, materials);
    const name = rec.texts.find((t) => t.text.startsWith("A very"))!;
    expect(name.text.endsWith("…")).toBe(true);
    expect(name.text.length).toBeLessThan(materials[0].name.length);
    expect(rec.textStrings()).toContain("B");
    // "Datum Elevation / Ref. Depth (m)" is split over several lines.
    const headerWords = rec.texts.filter((t) => t.state.font.startsWith("bold")).map((t) => t.text);
    expect(headerWords).not.toContain("Datum Elevation / Ref. Depth (m)");
    expect(headerWords.join(" ")).toContain("Datum");
  });
});

describe("extendBoundsWithFosLabelFitPadding", () => {
  const canvas = { getContext: () => createRecordingContext().ctx } as unknown as HTMLCanvasElement;
  const bounds = { xMin: 0, xMax: 30, yMin: 0, yMax: 10 };

  it("pads around the circle centre, where the label of a circle is drawn", () => {
    const cs = { cx: 15, cy: 12, radius: 8, fos: 1.2, entryPoint: [8, 10], exitPoint: [22, 5] };
    const out = extendBoundsWithFosLabelFitPadding({
      result: { criticalSurface: cs } as unknown as AnalysisResult,
      showFosLabel: true,
      canvas,
      scale: 10,
      bounds,
    })!;
    expect(out.yMax).toBeCloseTo(12 + 1.6, 9);
    expect(out.xMax).toBe(30);
  });

  it("pads around the drawn label of a non-circular surface, not its far moment axis", () => {
    const cs = {
      cx: 200,
      cy: 150,
      radius: 0,
      fos: 1.2,
      entryPoint: [8, 10],
      exitPoint: [22, 5],
      points: [
        [8, 10],
        [15, 3],
        [22, 5],
      ],
    };
    const out = extendBoundsWithFosLabelFitPadding({
      result: { criticalSurface: cs } as unknown as AnalysisResult,
      showFosLabel: true,
      canvas,
      scale: 10,
      bounds,
    })!;
    // The label sits above the middle of the mass at (15, 10).
    expect(out.xMax).toBe(30);
    expect(out.yMax).toBeCloseTo(10 + 1.6, 9);
  });

  it("does nothing without a label to show", () => {
    expect(
      extendBoundsWithFosLabelFitPadding({ result: null, showFosLabel: true, canvas, scale: 10, bounds }),
    ).toBeNull();
  });
});

// ── Hit boxes match what the canvas draws ──────────────────────

const W = 1200;
const H = 800;
const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [20, 5],
  [30, 5],
  [30, 0],
];
const surface = { cx: 15, cy: 14, radius: Math.hypot(7, 9), fos: 1.234, entryPoint: [4.3, 10] as [number, number], exitPoint: [22, 5] as [number, number] };
const RESULT = {
  minFOS: 1.234,
  maxFOS: 8,
  criticalSurface: surface,
  allSurfaces: [surface],
  criticalSlices: [],
  method: "Bishop",
  elapsedMs: 1,
} as unknown as AnalysisResult;

function drawTexts(annotations: Annotation[]): TextCall[] {
  const rec = createRecordingContext(W, H);
  const params: DrawCanvasParams = {
    w: W,
    h: H,
    mode: "result",
    result: RESULT,
    resultViewSettings: {
      ...DEFAULT_RESULT_VIEW_SETTINGS,
      annotations,
      showFosLabel: false,
      showGrid: false,
    },
    orientation: "ltr",
    coordinates: COORDS,
    materials: [{ ...DEFAULT_MATERIAL }],
    materialBoundaries: [],
    regionMaterials: [],
    selectedRegionKey: null,
    editingAssignment: false,
    selectedAnnotationIds: [],
    selectedResultObject: null,
    projectInfo: { ...DEFAULT_PROJECT_INFO, title: "A fairly long project title" },
    parameters: [],
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS, enabled: false },
    udls: [],
    lineLoads: [],
    piezometricLine: DEFAULT_PIEZO_LINE,
    viewScale: 20,
    mouseWorld: null,
    hoverHit: null,
    selectedPointIndex: null,
    selectedMaterialBoundaryId: null,
    interiorBoundariesDialogOpen: false,
    worldToCanvas: (x, y, w, h) => [w / 2 + (x - 15) * 20, h / 2 - (y - 5) * 20],
    canvasToWorld: (x, y, w, h) => [(x - w / 2) / 20 + 15, -(y - h / 2) / 20 + 5],
    surfaceYAtX: () => null,
    editingExterior: false,
    editingBoundaries: false,
    editingPiezo: false,
  };
  drawCanvas(rec.ctx, params);
  return rec.texts;
}

describe("annotation hit boxes enclose what is drawn", () => {
  const pf = computePaperFrame(W, H, "A4", true, 1, 0, 0);
  const anchors: (AnchorPosition | undefined)[] = [undefined, "top-right", "bottom-left", "bottom-right"];
  const kinds: Annotation[] = [
    { id: "x", type: "text", x: 0.5, y: 0.5, text: "#Title\nsecond line", fontSize: 18, bold: true },
    { id: "x", type: "color-bar", x: 0.5, y: 0.5 },
    { id: "x", type: "material-table", x: 0.5, y: 0.5, fontSize: 8 },
    { id: "x", type: "plot", x: 0.5, y: 0.5 },
  ];

  for (const kind of kinds) {
    for (const anchor of anchors) {
      it(`${kind.type} anchored ${anchor ?? "top-left"}`, () => {
        const anno = { ...kind, anchor };
        const before = new Set(drawTexts([]).map((t) => `${t.text}@${t.x},${t.y}`));
        const own = drawTexts([anno]).filter((t) => !before.has(`${t.text}@${t.x},${t.y}`));
        expect(own.length).toBeGreaterThan(0);
        const rec = createRecordingContext(W, H);
        const b = getAnnotationBoundsPx(rec.ctx, {
          annotation: anno,
          paperFrame: pf,
          result: RESULT,
          materials: [{ ...DEFAULT_MATERIAL }],
          projectInfo: { ...DEFAULT_PROJECT_INFO, title: "A fairly long project title" },
          parameters: [],
        });
        for (const t of own) {
          expect(t.x, t.text).toBeGreaterThanOrEqual(b.x - 1e-6);
          expect(t.x, t.text).toBeLessThanOrEqual(b.x + b.w + 1e-6);
          expect(t.y, t.text).toBeGreaterThanOrEqual(b.y - 1e-6);
          expect(t.y, t.text).toBeLessThanOrEqual(b.y + b.h + 1e-6);
        }
      });
    }
  }
});
