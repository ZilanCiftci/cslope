import { describe, expect, it } from "vitest";
import {
  axisScalesOf,
  buildPlacement,
  emptyForm,
  evaluateForm,
  formFromCalibration,
  metersPerSourceUnit,
  nextTarget,
  parseNumber,
  pickTargets,
  withSource,
  type CalibrationForm,
} from "./calibration-form";
import { apply } from "./transform";

describe("the Place drawing window's calibration inputs", () => {
  it("reads numbers as typed, with a decimal comma too", () => {
    expect(parseNumber(" 12.5 ")).toBe(12.5);
    expect(parseNumber("-3,25")).toBe(-3.25);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });

  it("walks the clicks through the targets of the mode, skipping those filled", () => {
    let form = emptyForm();
    expect(pickTargets(form).map((t) => t.kind)).toEqual(["x", "x", "y", "y"]);
    let t = nextTarget(form, null);
    expect(t).toEqual({ kind: "x", index: 0 });
    form = withSource(form, t!, [10, 20]);
    t = nextTarget(form, t);
    expect(t).toEqual({ kind: "x", index: 1 });
    form = withSource(form, { kind: "y", index: 0 }, [5, 5]);
    form = withSource(form, t!, [50, 20]);
    expect(nextTarget(form, t)).toEqual({ kind: "y", index: 1 });
    // reusing a scale: one point per axis
    expect(pickTargets({ ...form, reuseFrom: "m/p" }).map((x) => `${x.kind}${"index" in x ? x.index : ""}`)).toEqual(["x0", "y0"]);
    expect(pickTargets({ ...form, mode: "scale" })).toEqual([{ kind: "origin" }]);
  });

  it("axes mode: tells what is missing, then gives the transform and the exaggeration", () => {
    let form: CalibrationForm = emptyForm("pt");
    expect(evaluateForm(form, null, "point").fit).toEqual({ ok: false, error: "Click point x1 on the x axis." });
    form = withSource(form, { kind: "x", index: 0 }, [100, 500]);
    expect(evaluateForm(form, null, "point").fit).toMatchObject({ ok: false, error: "Type the x value at x1." });
    form = { ...form, axes: { ...form.axes, x: [{ source: [100, 500], value: "0" }, { source: [300, 500], value: "20" }] } };
    form = { ...form, axes: { ...form.axes, y: [{ source: [100, 500], value: "0" }, { source: [100, 300], value: "10" }] } };
    const r = evaluateForm(form, null, "point");
    expect(r.fit.ok).toBe(true);
    expect(r.summary).toContain("vertical exaggeration 2.00");
    expect(r.calibration).toMatchObject({ mode: "axes", axes: { x: [{ value: 0 }, { value: 20 }], y: [{ value: 0 }, { value: 10 }] } });
  });

  it("axes mode with a reused scale needs one point per axis", () => {
    const form: CalibrationForm = {
      ...emptyForm(),
      reuseFrom: "model-1/drawing-1",
      axes: { x: [{ source: [200, 400], value: "10" }, { source: null, value: "" }], y: [{ source: [200, 300], value: "4" }, { source: null, value: "" }] },
    };
    const r = evaluateForm(form, { x: 0.1, y: -0.05 }, "pixel");
    expect(r.fit.ok).toBe(true);
    if (!r.fit.ok) return;
    expect(apply(r.fit.transform, [200, 300])).toEqual([10, 4]);
    expect(r.calibration.axes?.reuseFrom).toBe("model-1/drawing-1");
  });

  it("points mode: two points, then three with residuals", () => {
    const rows = (pts: [number, number, string, string][]) => pts.map(([u, v, x, y]) => ({ source: [u, v] as [number, number], x, y }));
    let form: CalibrationForm = { ...emptyForm(), mode: "points", points: rows([[0, 100, "0", "0"], [100, 100, "", ""]]) };
    expect(evaluateForm(form, null, "pixel").fit).toMatchObject({ ok: false, error: "Type the model x and y of point 2." });
    form = { ...form, points: rows([[0, 100, "0", "0"], [100, 100, "10", "0"]]) };
    const two = evaluateForm(form, null, "pixel");
    expect(two.fit.ok).toBe(true);
    expect(two.summary[0]).toBe("Scale 0.100 m per pixel");
    form = { ...form, points: rows([[0, 100, "0", "0"], [100, 100, "10", "0"], [0, 0, "0", "20"]]) };
    const three = evaluateForm(form, null, "pixel");
    expect(three.fit.ok).toBe(true);
    expect(three.summary).toContain("vertical exaggeration 0.50");
    expect(three.calibration.points).toHaveLength(3);
    // an empty row is left out
    form = { ...form, points: [...form.points, { source: null, x: "", y: "" }] };
    expect(evaluateForm(form, null, "pixel").calibration.points).toHaveLength(3);
  });

  it("scale mode: a PDF scale typed per mm is converted to points", () => {
    expect(metersPerSourceUnit(0.2, "mm")).toBeCloseTo((0.2 * 25.4) / 72, 15);
    expect(metersPerSourceUnit(0.2, "pt")).toBe(0.2);
    const form: CalibrationForm = { ...emptyForm("mm"), mode: "scale", scale: { origin: { source: [0, 0], x: "5", y: "1" }, metersPerUnit: "0.2", unit: "mm" } };
    const r = evaluateForm(form, null, "point");
    expect(r.fit.ok).toBe(true);
    if (!r.fit.ok) return;
    const [x] = apply(r.fit.transform, [72 / 25.4, 0]);
    expect(x).toBeCloseTo(5.2, 12);
    expect(r.calibration).toEqual({ mode: "scale", points: [{ source: [0, 0], model: [5, 1] }], scale: { metersPerUnit: 0.2, unit: "mm" } });
    expect(evaluateForm({ ...form, scale: { ...form.scale, metersPerUnit: "0" } }, null, "point").fit).toMatchObject({ ok: false });
  });

  it("refills the form from a stored calibration (recalibrate)", () => {
    const axes = formFromCalibration({ mode: "axes", points: [], axes: { x: [{ source: [1, 2], value: 3 }], y: [], reuseFrom: "a/b" } }, "pt", () => []);
    expect(axes.mode).toBe("axes");
    expect(axes.reuseFrom).toBe("a/b");
    expect(axes.axes.x).toEqual([{ source: [1, 2], value: "3" }, { source: null, value: "" }]);
    const drawing = formFromCalibration({ mode: "drawing", points: [] }, "px", () => [{ source: [0, 0], model: [1.23456789, 2] }]);
    expect(drawing.mode).toBe("points");
    expect(drawing.points[0]).toEqual({ source: [0, 0], x: "1.234568", y: "2" });
  });

  it("knows an axis-aligned placement's scales", () => {
    expect(axisScalesOf({ a: 0.1, b: 0, c: 0, d: -0.05, e: 0, f: 0 })).toEqual({ x: 0.1, y: -0.05 });
    expect(axisScalesOf({ a: 0.1, b: 0.01, c: 0, d: -0.05, e: 0, f: 0 })).toBeNull();
  });

  it("builds the placement, keeping a recalibrated one's opacity, order and results setting", () => {
    const transform = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 };
    const fresh = buildPlacement({ id: "d1", assetId: "a1", name: "Section", page: 2, crop: { x0: 0, y0: 0, x1: 5, y1: 5 }, calibration: { mode: "points", points: [] }, transform });
    expect(fresh).toEqual({ id: "d1", assetId: "a1", name: "Section", page: 2, crop: { x0: 0, y0: 0, x1: 5, y1: 5 }, calibration: { mode: "points", points: [] }, transform, opacity: 0.5, visible: true, order: 0 });
    const again = buildPlacement({ ...fresh, name: "Section", page: undefined, crop: undefined, existing: { ...fresh, opacity: 0.8, order: 3, visible: false, showInResults: true } });
    expect(again).toMatchObject({ opacity: 0.8, order: 3, visible: false, showInResults: true });
    expect(again).not.toHaveProperty("page");
  });
});
