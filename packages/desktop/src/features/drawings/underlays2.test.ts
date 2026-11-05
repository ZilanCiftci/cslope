/**
 * Phase 2 of the drawings: a PDF page's vector paths, "Use as boundaries"
 * (one undo step each), "New models from drawing…" (frames, names, a
 * reused scale) and the persistence of the new fields.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import type { BackgroundImage } from "../../store/types";
import { pathsFromOperatorList, pdfVectorDrawing, textsFromContent, type PdfOps } from "./pdf-vectors";
import { emptyForm, evaluateForm, formForVector, type CalibrationForm } from "./calibration-form";
import { evaluateFrame, frameKey, framesToModels, reusableFrames, suggestFrameName, type SheetFrame } from "./sheet";
import { createModelsFromDrawing } from "./window-sync";
import { normalizeBackgrounds } from "./placement";
import { readProject, writeProjectArchive } from "../project/cslp";
import type { ProjectFile } from "../../store/persistence";
import type { ProjectAsset } from "./asset-registry";
import { extentOf, type VectorDrawing } from "./vectors";
import type { VectorText } from "./vectors";
import type { PickedChain } from "./line-pick";

// The picked lines' drawing: an outline (a square) and a line.
const lines: VectorDrawing = (() => {
  const paths = [
    { layer: 0, pts: Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10]), closed: true },
    { layer: 0, pts: Float64Array.from([0, 5, 10, 6]), closed: false },
  ];
  return { layers: ["0"], layersOff: [], paths, texts: [], extent: extentOf(paths, []), metersPerUnit: 1, unitName: "meter", segmentCount: 5, notes: [] };
})();
vi.mock("./drawing-cache", async (orig) => ({ ...(await orig<typeof import("./drawing-cache")>()), vectorsFor: () => lines }));
const { useLinePick, pickedLinesAs } = await import("./line-pick-store");

const OPS: PdfOps = {
  save: 10,
  restore: 11,
  transform: 12,
  constructPath: 91,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
};

describe("a PDF page's vector paths", () => {
  // The viewport of a 100 × 200 pt page: y flipped.
  const base: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 200];

  it("follows the transformation matrix, keeps stroked and filled paths, drops clipping paths", () => {
    const list = {
      fnArray: [OPS.save, OPS.transform, OPS.constructPath, OPS.restore, OPS.constructPath, OPS.constructPath],
      argsArray: [
        null,
        [2, 0, 0, 2, 10, 10],
        // moveTo 0 0, lineTo 5 0, lineTo 5 5, closePath; stroked
        [OPS.stroke, [Float32Array.from([0, 0, 0, 1, 5, 0, 1, 5, 5, 4])], null],
        null,
        // a clip (endPath = 28): left out
        [28, [Float32Array.from([0, 0, 0, 1, 100, 100])], null],
        // a curve from (0, 0) to (10, 0), filled
        [OPS.fill, [Float32Array.from([0, 0, 0, 2, 0, 10, 10, 10, 10, 0])], null],
      ],
    };
    const paths = pathsFromOperatorList(list, OPS, base);
    expect(paths).toHaveLength(2);
    // (0,0) → user (10,10) → page (10, 190); (5,0) → (20, 10) → (20, 190); closed.
    expect([...paths[0].pts]).toEqual([10, 190, 20, 190, 20, 180]);
    expect(paths[0].closed).toBe(true);
    const curve = paths[1];
    expect(curve.pts.length / 2).toBeGreaterThan(3);
    expect(curve.pts[curve.pts.length - 2]).toBeCloseTo(10, 9);
    expect(curve.pts[curve.pts.length - 1]).toBeCloseTo(200, 9);
    const d = pdfVectorDrawing(paths, []);
    expect(d.unitName).toBe("point");
    expect(d.segmentCount).toBeGreaterThan(3);
  });

  it("reads the texts where they stand on the page", () => {
    const texts = textsFromContent([{ str: "Section 2", transform: [12, 0, 0, 12, 50, 150] }, { str: " " }], base);
    expect(texts).toEqual([{ layer: 0, text: "Section 2", u: 50, v: 50, height: 12, rotation: 0 }]);
  });
});

describe("use picked lines as model objects", () => {
  const placement: BackgroundImage = {
    id: "drawing-v",
    assetId: "dwg",
    calibration: { mode: "drawing", points: [] },
    transform: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 },
    opacity: 0.8,
    visible: true,
    order: 0,
  };
  const chain = (path: number): PickedChain => {
    const p = lines.paths[path];
    const pts = Array.from({ length: p.pts.length / 2 }, (_, i): [number, number] => [p.pts[2 * i], p.pts[2 * i + 1]]);
    return { points: pts, closed: p.closed, paths: [path] };
  };

  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.getState().addBackground(placement);
    useAppStore.temporal.getState().clear();
    useLinePick.getState().start(placement.id);
  });

  it("an exterior boundary: one undo step, no lock", () => {
    const before = useAppStore.getState().coordinates;
    useLinePick.getState().setChains([chain(0)]);
    const r = pickedLinesAs("exterior", 0.1);
    expect(r.ok).toBe(true);
    const s = useAppStore.getState();
    expect(s.coordinates).toEqual([[0, 0], [10, 0], [10, -10], [0, -10]]);
    expect(s.locks.exterior).toBeUndefined();
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
    useAppStore.temporal.getState().undo();
    expect(useAppStore.getState().coordinates).toEqual(before);
    expect(useLinePick.getState().chains).toEqual([]);
  });

  it("a locked exterior boundary is replaced only when the user unlocks it (in the same undo step)", () => {
    const before = useAppStore.getState().coordinates;
    useAppStore.getState().setModelLocks({ exterior: true });
    useAppStore.temporal.getState().clear();
    useLinePick.getState().setChains([chain(0)]);
    const refused = pickedLinesAs("exterior", 0.1, () => true, () => false);
    expect(refused).toEqual({ ok: false, message: "The exterior boundary is locked: it was not changed." });
    expect(useAppStore.getState().coordinates).toEqual(before);
    expect(useAppStore.getState().locks.exterior).toBe(true);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);

    let asked = 0;
    const r = pickedLinesAs("exterior", 0.1, () => true, () => ++asked > 0);
    expect(r.ok).toBe(true);
    expect(asked).toBe(1);
    expect(useAppStore.getState().coordinates).toEqual([[0, 0], [10, 0], [10, -10], [0, -10]]);
    expect(useAppStore.getState().locks.exterior).toBeUndefined();
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
    useAppStore.temporal.getState().undo();
    expect(useAppStore.getState().coordinates).toEqual(before);
    expect(useAppStore.getState().locks.exterior).toBe(true);
  });

  it("new material boundaries and water lines are added beside locked ones", () => {
    const id = useAppStore.getState().materialBoundaries[0]?.id;
    useAppStore.getState().setModelLocks({ exterior: true, ...(id ? { boundaries: [id] } : {}) });
    const n = useAppStore.getState().materialBoundaries.length;
    useLinePick.getState().setChains([chain(1)]);
    expect(pickedLinesAs("boundary", 0.1, () => true, () => false).ok).toBe(true);
    expect(useAppStore.getState().materialBoundaries).toHaveLength(n + 1);
  });

  it("material boundaries and water lines: one undo step for all", () => {
    useLinePick.getState().setChains([chain(1)]);
    expect(pickedLinesAs("boundary", 0.1).ok).toBe(true);
    useLinePick.getState().setChains([chain(1)]);
    expect(pickedLinesAs("waterLine", 0.1).ok).toBe(true);
    const s = useAppStore.getState();
    expect(s.materialBoundaries.at(-1)!.coordinates).toEqual([[0, -5], [10, -6]]);
    expect(s.piezometricLine.lines.at(-1)!.coordinates).toEqual([[0, -5], [10, -6]]);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(2);
  });

  it("an open line is no exterior: the reason, nothing changed", () => {
    useLinePick.getState().setChains([chain(1)]);
    const before = useAppStore.getState().coordinates;
    const r = pickedLinesAs("exterior", 0.1, () => true);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/at least three points/);
    expect(useAppStore.getState().coordinates).toBe(before);
  });
});

describe("new models from drawing", () => {
  const text = (t: string, u: number, v: number, height = 10): VectorText => ({ layer: 0, text: t, u, v, height, rotation: 0 });

  it("suggests a frame's name from the texts in it", () => {
    const crop = { x0: 0, y0: 0, x1: 200, y1: 100 };
    expect(suggestFrameName([text("10", 10, 90), text("+20", 0, 10, 30), text("Section 2", 80, 5, 8), text("Clay", 50, 50, 20)], crop)).toBe("Section 2");
    expect(suggestFrameName([text("B–B", 90, 10), text("Clay", 50, 50, 20)], crop)).toBe("B–B");
    expect(suggestFrameName([text("Clay", 50, 50, 20), text("sand", 50, 70, 8)], crop)).toBe("Clay");
    expect(suggestFrameName([text("Section 9", 500, 50)], crop)).toBe("");
  });

  /** A frame calibrated on axes: ticks at u = 0 (x 0) and u = 100 (x 50), v = 100 (y 0) and v = 0 (y 25). */
  const axes = (id: string, page: number, twoTicks: boolean, reuseFrom: string | null = null): SheetFrame => {
    const f: CalibrationForm = emptyForm("pt");
    const x = [
      { source: [0 + 300 * (page - 1), 100] as [number, number], value: "0" },
      { source: [100 + 300 * (page - 1), 100] as [number, number], value: "50" },
    ];
    const y = [
      { source: [0, 100] as [number, number], value: "0" },
      { source: [0, 0] as [number, number], value: "25" },
    ];
    return {
      id,
      page,
      crop: { x0: 300 * (page - 1), y0: 0, x1: 300 * (page - 1) + 200, y1: 120 },
      name: `Section ${id}`,
      form: { ...f, mode: "axes", reuseFrom, axes: { x: twoTicks ? x : [x[0], { source: null, value: "" }], y: twoTicks ? y : [y[0], { source: null, value: "" }] } },
    };
  };

  it("reuses the first calibrated frame's scale: one value per axis", () => {
    const frames = [axes("1", 1, true), axes("2", 2, false, frameKey("1"))];
    expect(reusableFrames(frames, frames[1], "point").map((f) => f.id)).toEqual(["1"]);
    const a = evaluateFrame(frames, frames[0], "point");
    const b = evaluateFrame(frames, frames[1], "point");
    expect(a.fit.ok && b.fit.ok).toBe(true);
    if (!a.fit.ok || !b.fit.ok) return;
    expect(b.fit.transform.a).toBeCloseTo(a.fit.transform.a, 12);
    expect(b.fit.transform.d).toBeCloseTo(a.fit.transform.d, 12);
    // Without the reuse, the second frame lacks its second ticks.
    expect(evaluateFrame([frames[1]], { ...frames[1], form: { ...frames[1].form, reuseFrom: null } }, "point").fit.ok).toBe(false);
  });

  it("makes one model per frame, the drawing shared, the reused scale named by model and placement", () => {
    const frames = [axes("1", 1, true), axes("2", 2, false, frameKey("1")), axes("3", 1, false, frameKey("1")), axes("4", 2, false, frameKey("1"))];
    const made = framesToModels(frames, { id: "pdf-1", originalName: "sections.pdf", multiPage: true, vector: false }, "point");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    useAppStore.getState().newProject();
    const before = useAppStore.getState().models.length;
    createModelsFromDrawing(made.models);
    const s = useAppStore.getState();
    expect(s.models).toHaveLength(before + 4);
    const created = s.models.slice(before);
    expect(created.map((m) => m.name)).toEqual(["Section 1", "Section 2", "Section 3", "Section 4"]);
    expect(s.activeModelId).toBe(created[0].id);
    expect(s.coordinates).toEqual([]);
    const placements = created.map((m) => (m.id === s.activeModelId ? s.backgrounds : m.backgrounds!)[0]);
    expect(new Set(placements.map((p) => p.assetId))).toEqual(new Set(["pdf-1"]));
    expect(placements.map((p) => p.page)).toEqual([1, 2, 1, 2]);
    expect(placements[1].calibration.axes?.reuseFrom).toBe(`${created[0].id}/${placements[0].id}`);
    expect(placements[1].crop).toEqual(frames[1].crop);
  });

  it("says which frame is not calibrated yet", () => {
    const frames = [axes("1", 1, false)];
    const made = framesToModels(frames, { id: "pdf-1", originalName: "s.pdf", multiPage: true, vector: false }, "point");
    expect(made).toMatchObject({ ok: false, error: expect.stringMatching(/^Frame 1 \(Section 1\): /) });
  });
});

describe("the drawing's coordinates and the new fields' persistence", () => {
  it("places a DWG or DXF drawing at its own coordinates, its unit to metres", () => {
    const r = evaluateForm({ ...emptyForm("du"), mode: "drawing", drawingUnit: 4 }, null, "millimeter");
    expect(r.fit).toMatchObject({ ok: true, transform: { a: 0.001, b: 0, c: 0, d: -0.001, e: 0, f: 0 } });
    expect(r.calibration).toEqual({ mode: "drawing", points: [] });
    // Recalibrating finds the mode and the unit again.
    const f = formForVector({ mode: "drawing", points: [] }, { a: 0.001, b: 0, c: 0, d: -0.001, e: 0, f: 0 }, 0, () => []);
    expect([f.mode, f.drawingUnit]).toEqual(["drawing", 4]);
  });

  it("reads hiddenLayers (strings, once each) and the drawing unit of a scale", () => {
    const [b] = normalizeBackgrounds([
      {
        id: "d",
        assetId: "a",
        transform: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 },
        calibration: { mode: "scale", points: [], scale: { metersPerUnit: 0.001, unit: "du" } },
        hiddenLayers: ["text", 3, "text", "axes"],
      },
    ]);
    expect(b.hiddenLayers).toEqual(["text", "axes"]);
    expect(b.calibration.scale).toEqual({ metersPerUnit: 0.001, unit: "du" });
    expect(normalizeBackgrounds([{ id: "d", assetId: "a", transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, hiddenLayers: [] }])[0]).not.toHaveProperty("hiddenLayers");
  });

  it("writes and reads a DXF drawing and its placement with hidden layers (.cslp)", async () => {
    useAppStore.getState().newProject();
    const s = useAppStore.getState();
    const model = s.models.find((m) => m.id === s.activeModelId)!;
    const placement: BackgroundImage = {
      id: "drawing-1",
      assetId: "dxf-1",
      calibration: { mode: "drawing", points: [] },
      transform: { a: 0.001, b: 0, c: 0, d: -0.001, e: 0, f: 0 },
      crop: { x0: -10, y0: -20, x1: 100, y1: 5 },
      opacity: 0.8,
      visible: true,
      order: 0,
      hiddenLayers: ["text"],
    };
    const file = { version: 3, activeModelId: model.id, models: [{ ...model, backgrounds: [placement] }] } as unknown as ProjectFile;
    const bytes = new TextEncoder().encode("  0\nSECTION\n  2\nENTITIES\n  0\nENDSEC\n  0\nEOF\n");
    const assets: ProjectAsset[] = [{ id: "dxf-1", mime: "image/vnd.dxf", originalName: "plan.dxf", addedAt: "2026-11-05T00:00:00.000Z", data: () => bytes }];
    const read = await readProject(await writeProjectArchive(file, { assets }));
    expect(read.assets.map((a) => [a.id, a.mime])).toEqual([["dxf-1", "image/vnd.dxf"]]);
    expect(Array.from(await read.assets[0].data())).toEqual(Array.from(bytes));
    expect(read.file.models[0].backgrounds).toEqual([placement]);
  });
});
