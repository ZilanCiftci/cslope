import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./app-store";
import { performUndo } from "./selectors";
import { asDialogEdit, changedPaths, COALESCE_MS } from "./undo-coalesce";

const store = () => useAppStore.getState();
const steps = () => useAppStore.temporal.getState().pastStates.length;
const setRu = (ru: number | undefined) => {
  const m = store().materials[0];
  store().updateMaterial(m.id, { model: { ...m.model, ru } });
};

describe("changedPaths", () => {
  it("names the values that differ, ignoring equal content", () => {
    expect(changedPaths({ a: [{ x: 1, y: 2 }], b: { c: 1 } }, { a: [{ x: 1, y: 3 }], b: { c: 1 } })).toBe("a.0.y");
    expect(changedPaths({ a: { ru: 0.3 } }, { a: {} })).toBe("a.ru");
    expect(changedPaths({ a: { ru: undefined } }, { a: {} })).toBe("");
    expect(changedPaths({ a: [1, 2] }, { a: [1, 2, 3] })).toBe("a");
    expect(changedPaths({ a: Array.from({ length: 20 }, () => 0) }, { a: Array.from({ length: 20 }, () => 1) })).toBeNull();
  });
});

describe("one undo step per edit of a field", () => {
  let input: HTMLInputElement;
  beforeEach(() => {
    store().newProject();
    useAppStore.temporal.getState().clear();
    input = document.createElement("input");
    document.body.appendChild(input);
  });
  afterEach(() => {
    input.remove();
    vi.useRealTimers();
  });

  it("joins the keystrokes typed in one focused field", () => {
    input.focus();
    setRu(0);
    setRu(0.5);
    setRu(0.55);
    expect(steps()).toBe(1);
    // Another value in the same field is another edit.
    const m = store().materials[0];
    store().updateMaterial(m.id, { model: { ...m.model, unitWeight: 21 } });
    expect(steps()).toBe(2);
    performUndo();
    performUndo();
    expect(store().materials[0].model.ru).toBeUndefined();
  });

  it("starts a new step when the field is focused again or after an undo", () => {
    input.focus();
    setRu(0.4);
    input.blur();
    input.focus();
    setRu(0.5);
    expect(steps()).toBe(2);
    performUndo();
    setRu(0.6);
    setRu(0.7);
    expect(steps()).toBe(2);
    performUndo();
    expect(store().materials[0].model.ru).toBe(0.4);
  });

  it("keeps changes made in code (no field focused) as steps of their own", () => {
    setRu(0.4);
    setRu(0.5);
    expect(steps()).toBe(2);
  });

  it("joins the changes a dialog window sends while they follow each other", () => {
    vi.useFakeTimers();
    asDialogEdit(() => setRu(0));
    vi.advanceTimersByTime(500);
    asDialogEdit(() => setRu(0.5));
    expect(steps()).toBe(1);
    vi.advanceTimersByTime(COALESCE_MS + 1);
    asDialogEdit(() => setRu(0.6));
    expect(steps()).toBe(2);
    performUndo();
    expect(store().materials[0].model.ru).toBe(0.5);
    performUndo();
    expect(store().materials[0].model.ru).toBeUndefined();
  });
});
