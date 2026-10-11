import { describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { importDxf } from "./importDxf";

const dxf = (pairs: (string | number)[][]) => pairs.map(([c, v]) => `${c}\n${v}`).join("\n") + "\n";
const lw = (layer: string, closed: boolean, pts: number[][]) => [
  [0, "LWPOLYLINE"], [8, layer], [90, pts.length], [70, closed ? 1 : 0],
  ...pts.flatMap(([x, y]) => [[10, x], [20, y]]),
];

describe("importDxf", () => {
  it("adds a model with the outline, boundaries, water line and the right orientation", () => {
    useAppStore.getState().newProject();
    const before = useAppStore.getState().models.length;
    // Crest on the right: the model slides to the left.
    const text = dxf([
      [0, "SECTION"], [2, "ENTITIES"],
      ...lw("outline", true, [[0, -20], [0, -10], [20, -10], [40, 0], [60, 0], [60, -20]]),
      ...lw("layer", false, [[0, -14], [60, -12]]),
      ...lw("piezo", false, [[0, -10], [60, -4]]),
      [0, "ARC"], [8, "x"],
      [0, "ENDSEC"], [0, "EOF"],
    ]);
    const message = importDxf(text, "Profil A.dxf");
    const s = useAppStore.getState();
    expect(s.models).toHaveLength(before + 1);
    expect(s.models.find((m) => m.id === s.activeModelId)!.name).toBe("Profil A");
    expect(s.coordinates).toHaveLength(6);
    expect(s.orientation).toBe("rtl");
    expect(s.materialBoundaries).toHaveLength(1);
    expect(s.piezometricLine.lines).toHaveLength(1);
    expect(message).toContain("1 ARC");
    expect(s.analysisLimits.enabled).toBe(false);
    // The import is one step: nothing to undo piece by piece.
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
