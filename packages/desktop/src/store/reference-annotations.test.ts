import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { normalizeResultView, parseProjectFile, serializeProject } from "./persistence";
import { DEFAULT_RESULT_VIEW_SETTINGS } from "./defaults";
import type { Annotation, ReferenceAnnotation } from "./types";

const store = () => useAppStore.getState();
const annotations = () => store().resultViewSettings.annotations;
const references = () => annotations().filter((a): a is ReferenceAnnotation => a.type === "reference");

beforeEach(() => {
  store().newProject();
  useAppStore.temporal.getState().clear();
});

describe("reference annotations in the store", () => {
  it("adds a reference annotation with an id, selects it and makes one undo step", () => {
    const id = store().addReferenceAnnotation({ shape: "polyline", points: [[2, 10], [12, 4]], label: "other program" });
    const added = references();
    expect(added).toHaveLength(1);
    expect(added[0]).toEqual({ id, type: "reference", shape: "polyline", points: [[2, 10], [12, 4]], label: "other program" });
    expect(store().selectedAnnotationIds).toEqual([id]);
    expect(store().selectedResultObject).toBeNull();
    // Kept with the model, like the other annotations.
    const model = store().models.find((m) => m.id === store().activeModelId)!;
    expect(model.resultViewSettings?.annotations.find((a) => a.id === id)).toBeDefined();
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(1);
    useAppStore.temporal.getState().undo();
    expect(references()).toHaveLength(0);
  });

  it("copies a custom search plane as a reference line labelled by its number", () => {
    store().addCustomSearchPlane("circle");
    store().addCustomSearchPlane("polyline");
    const [circle, poly] = store().customSearchPlanes;
    store().updateCustomSearchPlane(circle.id, { cx: 15, cy: 14, radius: 10 });
    store().updateCustomSearchPlane(poly.id, { points: [[5, 8], [15, 2], [25, 4]] });

    const c = store().addReferenceFromCustomPlane(circle.id)!;
    const p = store().addReferenceFromCustomPlane(poly.id)!;
    expect(references().map((a) => a.id)).toEqual([c, p]);
    expect(references()[0]).toMatchObject({ shape: "circle", cx: 15, cy: 14, radius: 10, clip: "ground", label: "Custom surface 1" });
    expect(references()[1]).toMatchObject({ shape: "polyline", points: [[5, 8], [15, 2], [25, 4]], label: "Custom surface 2" });
    // The copy is independent of the plane.
    store().updateCustomPlanePoint(poly.id, 0, [6, 9]);
    expect((references()[1] as { points: [number, number][] }).points[0]).toEqual([5, 8]);
    expect(store().addReferenceFromCustomPlane("missing")).toBeNull();
  });

  it("numbers the reference as the result numbers the custom surfaces: circles, then polylines", () => {
    store().addCustomSearchPlane("polyline");
    store().addCustomSearchPlane("polyline");
    store().addCustomSearchPlane("circle");
    const [poly, unfinished, circle] = store().customSearchPlanes;
    store().updateCustomSearchPlane(poly.id, { points: [[5, 8], [15, 2], [25, 4]] });
    store().updateCustomSearchPlane(unfinished.id, { points: [[1, 1]] });
    store().updateCustomSearchPlane(circle.id, { cx: 15, cy: 14, radius: 10 });
    store().addReferenceFromCustomPlane(poly.id);
    store().addReferenceFromCustomPlane(circle.id);
    expect(references().map((a) => a.label)).toEqual(["Custom surface 2", "Custom surface 1"]);
    // An incomplete polyline is not a custom surface of the result.
    expect(store().addReferenceFromCustomPlane(unfinished.id)).toBeNull();
  });

  it("edits and removes reference annotations like the others", () => {
    const id = store().addReferenceAnnotation({ shape: "circle", cx: 1, cy: 2, radius: 3 });
    store().updateAnnotation(id, { radius: 5, color: "#ff00ff", dash: "dotted", showInEdit: true });
    expect(references()[0]).toMatchObject({ radius: 5, color: "#ff00ff", dash: "dotted", showInEdit: true });
    store().setSelectedAnnotations([id]);
    store().removeAnnotation(id);
    expect(references()).toHaveLength(0);
    expect(store().selectedAnnotationIds).toEqual([]);
  });

  it("aligns paper annotations only", () => {
    store().addAnnotation("text");
    store().addAnnotation("text");
    const [t1, t2] = annotations().slice(-2);
    store().updateAnnotation(t1.id, { x: 0.2 });
    store().updateAnnotation(t2.id, { x: 0.6 });
    const ref = store().addReferenceAnnotation({ shape: "polyline", points: [[2, 10], [12, 4]] });
    store().setSelectedAnnotations([t1.id, t2.id, ref]);
    store().alignAnnotations("left");
    expect(annotations().find((a) => a.id === t2.id)!.x).toBe(0.2);
    expect(references()[0]).toEqual({ id: ref, type: "reference", shape: "polyline", points: [[2, 10], [12, 4]] });
  });

  it("copies a duplicated model's reference lines without sharing their points", () => {
    const ref = store().addReferenceAnnotation({ shape: "polyline", points: [[2, 10], [12, 4]] });
    const source = store().activeModelId;
    store().duplicateModel(source);
    const copy = store().models.find((m) => m.id !== source)!;
    const copied = copy.resultViewSettings!.annotations.find((a) => a.id === ref) as { points: [number, number][] };
    const original = store()
      .models.find((m) => m.id === source)!
      .resultViewSettings!.annotations.find((a) => a.id === ref) as { points: [number, number][] };
    expect(copied.points).toEqual(original.points);
    expect(copied.points).not.toBe(original.points);
  });
});

describe("reference annotations in files and templates", () => {
  const VALID: Annotation[] = [
    { id: "t", type: "text", x: 0.1, y: 0.1, text: "Title" },
    { id: "l", type: "reference", shape: "polyline", points: [[2, 10], [12, 4]], label: "other program", dash: "dashed" },
    { id: "c", type: "reference", shape: "circle", cx: 15, cy: 14, radius: 10, clip: "none", width: 2 },
  ];

  it("keeps valid reference annotations with their named fields and drops invalid ones", () => {
    const view = normalizeResultView({
      annotations: [
        ...VALID,
        { id: "bad1", type: "reference", shape: "polyline", points: [[1, 1]] },
        { id: "bad2", type: "reference", shape: "circle", cx: 1, cy: 1, radius: -1 },
        { id: "bad3", type: "reference", shape: "dimension" },
        { id: "l2", type: "reference", shape: "polyline", points: [[0, 0], [1, 1]], extra: true, x: 0.5 },
      ],
    });
    expect(view.annotations.map((a) => a.id)).toEqual(["t", "l", "c", "l2"]);
    expect(view.annotations[1]).toEqual(VALID[1]);
    expect(view.annotations[2]).toEqual(VALID[2]);
    expect(view.annotations[3]).toEqual({ id: "l2", type: "reference", shape: "polyline", points: [[0, 0], [1, 1]] });
  });

  it("leaves files without reference annotations as they were", () => {
    const view = normalizeResultView({ ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [VALID[0]] });
    expect(view.annotations).toEqual([VALID[0]]);
    expect(normalizeResultView({}).annotations).toEqual([]);
  });

  it("round-trips reference annotations through the project file", () => {
    store().setResultViewSettings({ annotations: VALID });
    const parsed = parseProjectFile(JSON.stringify(serializeProject(store())));
    const model = parsed.models[0];
    expect(model.resultViewSettings!.annotations).toEqual(VALID);
  });
});
