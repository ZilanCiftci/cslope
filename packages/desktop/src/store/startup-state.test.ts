import { describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";

describe("startup state", () => {
  it("shows the model the explorer lists", () => {
    const s = useAppStore.getState();
    const active = s.models.find((m) => m.id === s.activeModelId)!;
    expect(s.coordinates).toEqual(active.coordinates);
    expect(s.materials).toEqual(active.materials);
    expect(s.options).toEqual(active.options);
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
