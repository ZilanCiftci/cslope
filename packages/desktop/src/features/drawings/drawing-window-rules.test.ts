/**
 * Small rules of the drawing windows and commands: the form a drawing
 * starts with, the viewer's size hint, which drawing Pick lines… starts
 * on, and the calibration's next step (a prompt) told from an error.
 */
import { describe, expect, it } from "vitest";
import type { BackgroundImage } from "../../store/types";
import { emptyForm, evaluateForm, initialForm, targetLabel, withSource, type CalibrationForm } from "./calibration-form";
import { drawingExtentText } from "./place-window-shared";
import { PICK_LINES_HIDDEN, PICK_LINES_NO_DRAWING, pickLinesTarget } from "./pick-lines-target";
import { DWG_MIME } from "./sources";

describe("initialForm", () => {
  it("starts a DWG or DXF drawing at its own coordinates, also the one shown first", () => {
    expect(initialForm("du")).toMatchObject({ mode: "drawing", scale: { unit: "du" } });
    expect(initialForm("du", { ...emptyForm("pt"), mode: "points" })).toMatchObject({ mode: "drawing" });
  });

  it("starts another file in the mode of the one before, in its own unit", () => {
    expect(initialForm("pt")).toMatchObject({ mode: "axes", scale: { unit: "pt" } });
    expect(initialForm("px", { ...emptyForm("pt"), mode: "points" })).toMatchObject({ mode: "points", scale: { unit: "px" } });
    expect(initialForm("px", { ...emptyForm("du"), mode: "drawing" })).toMatchObject({ mode: "axes" });
  });
});

describe("drawingExtentText", () => {
  it("gives a PDF page in mm, an image in pixels and a DWG's extent in meters, grouped", () => {
    expect(drawingExtentText("pdf", { width: 841.89, height: 595.28 }, null)).toBe("page 297 × 210 mm");
    expect(drawingExtentText("image", { width: 1100, height: 780 }, null)).toBe("1,100 × 780 px");
    expect(drawingExtentText("vector", { width: 237474, height: 40634 }, 0.001)).toBe("extent 237.5 × 40.6 m");
    expect(drawingExtentText("vector", { width: 2374740, height: 40634 }, 0.001)).toBe("extent 2,374.7 × 40.6 m");
    expect(drawingExtentText("vector", { width: 1234.56, height: 10 }, null)).toBe("extent 1,234.6 × 10 drawing units");
  });
});

describe("pickLinesTarget", () => {
  const p = (id: string, assetId: string, order: number, visible = true): BackgroundImage => ({
    id,
    assetId,
    name: id,
    calibration: { mode: "drawing", points: [] },
    transform: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 },
    opacity: 0.5,
    visible,
    order,
  });
  const mimes: Record<string, string> = { png: "image/png", pdf: "application/pdf", dwg: DWG_MIME };
  const mimeOf = (id: string) => mimes[id];

  it("takes the topmost shown drawing with line work", () => {
    expect(pickLinesTarget([p("a", "dwg", 0), p("b", "pdf", 1), p("c", "png", 2)], mimeOf)).toEqual({ id: "b" });
    expect(pickLinesTarget([p("a", "dwg", 0), p("b", "pdf", 1, false)], mimeOf)).toEqual({ id: "a" });
  });

  it("says why there is none", () => {
    expect(pickLinesTarget([], mimeOf)).toEqual({ reason: PICK_LINES_NO_DRAWING });
    expect(pickLinesTarget([p("c", "png", 0)], mimeOf)).toEqual({ reason: PICK_LINES_NO_DRAWING });
    expect(pickLinesTarget([p("a", "dwg", 0, false)], mimeOf)).toEqual({ reason: PICK_LINES_HIDDEN });
  });
});

describe("calibration messages", () => {
  it("marks a missing input as a prompt (the next step), a fit that fails as an error", () => {
    const start = evaluateForm(emptyForm("px"), null, "pixel");
    expect(start.fit.ok).toBe(false);
    expect(start.prompt).toBe(true);

    let form: CalibrationForm = { ...emptyForm("px"), mode: "points" };
    form = withSource(form, { kind: "point", index: 0 }, [10, 10]);
    form = withSource(form, { kind: "point", index: 1 }, [10.0000001, 10]);
    form = { ...form, points: form.points.map((r, i) => ({ ...r, x: String(i), y: "0" })) };
    const failed = evaluateForm(form, null, "pixel");
    expect(failed.fit.ok).toBe(false);
    expect(failed.prompt).toBeFalsy();
  });

  it("names the scale origin's button in words, and a PDF's unit as pt", () => {
    expect(targetLabel({ kind: "origin" })).toBe("Origin");
    let form: CalibrationForm = { ...emptyForm("pt"), mode: "points" };
    form = withSource(form, { kind: "point", index: 0 }, [0, 0]);
    form = withSource(form, { kind: "point", index: 1 }, [100, 0]);
    form = { ...form, points: [{ ...form.points[0], x: "0", y: "0" }, { ...form.points[1], x: "10", y: "0" }] };
    expect(evaluateForm(form, null, "pt").summary[0]).toBe("Scale 0.100 m per pt");
  });
});
