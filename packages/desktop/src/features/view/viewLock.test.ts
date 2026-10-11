import { describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { viewLockContains, viewLockForModel } from "./viewLock";

describe("view lock follows a growing model", () => {
  it("refits a lock that showed the whole model, keeps a deliberate zoom", () => {
    useAppStore.getState().newProject();
    const s = useAppStore.getState();
    const lock = viewLockForModel(s.coordinates, 1.4);
    s.setResultViewSettings({ viewLock: lock });
    const bigger = s.coordinates.map(([x, y]) => [x * 2, y * 2] as [number, number]);
    useAppStore.getState().setCoordinates(bigger);
    const after = useAppStore.getState().resultViewSettings.viewLock!;
    expect(viewLockContains(after, bigger)).toBe(true);

    // A lock on part of the model stays as the user set it.
    const zoom = { bottomLeft: [0, 0] as [number, number], topRight: [1, 1] as [number, number] };
    useAppStore.getState().setResultViewSettings({ viewLock: zoom });
    useAppStore.getState().setCoordinates(bigger.map(([x, y]) => [x + 1, y] as [number, number]));
    expect(useAppStore.getState().resultViewSettings.viewLock).toEqual(zoom);
  });
});
