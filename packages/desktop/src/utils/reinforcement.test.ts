import { beforeEach, describe, expect, it } from "vitest";
import { mapAnalysisResultToModelSpace, type AnalysisResult, type SlopeDefinition } from "@cslope/engine";
import { useAppStore } from "../store/app-store";
import { buildSlopeDTOFromModel } from "../store/helpers";
import { parseProjectFile, serializeProject } from "../store/persistence";
import { snapshotFromState } from "../store/slices/analysisSlice";
import {
  newPile,
  newReinforcement,
  pilePreset,
  reinforcementPreset,
  sanitizePile,
  sanitizeReinforcement,
  toEnginePile,
  toEngineReinforcement,
} from "./reinforcement";

const ground: [number, number][] = [[0, -5], [0, 10], [10, 10], [20, 0], [30, 0], [30, -5]];

describe("reinforcement rows", () => {
  it("maps each type to the engine's capacity model", () => {
    const base = newReinforcement("r", "anchor", ground, "ltr");
    expect(toEngineReinforcement(base).pullout).toBeUndefined();
    const tieback = toEngineReinforcement({ ...base, ...reinforcementPreset("tieback") });
    expect(tieback.pullout).toEqual({ kind: "bond", strength: 60, bondedLength: 5 });
    expect(tieback.end1Capacity).toBe(300);
    const nail = toEngineReinforcement({ ...base, ...reinforcementPreset("nail") });
    // Bond along the whole nail (no bonded length), passive.
    expect(nail.pullout).toEqual({ kind: "bond", strength: 15 });
    expect(nail.application).toBe("passive");
    const geo = toEngineReinforcement({ ...base, ...reinforcementPreset("geosynthetic") });
    expect(geo.pullout).toEqual({ kind: "interface", adhesion: 0, frictionAngle: 20 });
    expect(geo.direction).toBe("tangent");
  });

  it("new elements point into the slope", () => {
    const ltr = newReinforcement("a", "nail", ground, "ltr");
    expect(ltr.x2).toBeLessThan(ltr.x1);
    expect(ltr.y2).toBeLessThan(ltr.y1);
    expect(newReinforcement("b", "nail", ground, "rtl").x2).toBeGreaterThan(ltr.x1);
  });

  it("drops invalid file entries and repairs invalid values", () => {
    expect(sanitizeReinforcement({ type: "rocket", x1: 0, y1: 0, x2: 1, y2: 0 }, "x")).toBeNull();
    expect(sanitizeReinforcement({ type: "anchor", x1: 0, y1: Number.NaN, x2: 1, y2: 0 }, "x")).toBeNull();
    const r = sanitizeReinforcement(
      { type: "nail", x1: 0, y1: 0, x2: 1, y2: 0, spacing: -1, tensileCapacity: -5, direction: "sideways", interfaceFriction: 95 },
      "x",
    )!;
    expect(r.id).toBe("x");
    expect(r.spacing).toBe(1.5);
    expect(r.tensileCapacity).toBe(100);
    expect(r.direction).toBe("axial");
    expect(r.interfaceFriction).toBe(0);
  });
});

describe("reinforcement in the store", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("is saved with the project and reaches the engine", () => {
    useAppStore.getState().addReinforcement("tieback");
    const [row] = useAppStore.getState().reinforcements;
    useAppStore.getState().updateReinforcement(row.id, { tensileCapacity: 250 });
    useAppStore.getState().saveCurrentModel();
    const loaded = parseProjectFile(JSON.stringify(serializeProject(useAppStore.getState()))).models[0];
    expect(loaded.reinforcements?.[0]).toMatchObject({ type: "tieback", tensileCapacity: 250 });
    const dto = buildSlopeDTOFromModel(snapshotFromState(useAppStore.getState()));
    expect(dto.reinforcements?.[0].tensileCapacity).toBe(250);
    useAppStore.getState().removeReinforcement(row.id);
    expect(useAppStore.getState().reinforcements).toHaveLength(0);
  });

  it("a duplicated model gets its own elements", () => {
    useAppStore.getState().addReinforcement("anchor");
    useAppStore.getState().saveCurrentModel();
    const id = useAppStore.getState().activeModelId;
    useAppStore.getState().duplicateModel(id);
    const models = useAppStore.getState().models;
    const [a, b] = models.map((m) => m.reinforcements?.[0]?.id);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });
});

describe("reinforcement forces in model space", () => {
  it("are mirrored back for a right-to-left model", () => {
    const def: SlopeDefinition = {
      orientation: "rtl",
      coordinates: [[0, 0], [0, 5], [10, 10], [20, 10], [20, 0]],
      materials: [],
    };
    const result = {
      criticalSurface: {
        cx: 5, cy: 20, radius: 15, fos: 1.2, entryPoint: [2, 6], exitPoint: [15, 10],
        reinforcementForces: [{ index: 0, x: 4, y: 3, fx: -10, fy: 2, force: 10.2, passive: false }],
      },
      allSurfaces: [],
      criticalSlices: [],
    } as unknown as AnalysisResult;
    const mapped = mapAnalysisResultToModelSpace(result, def);
    expect(mapped.criticalSurface!.reinforcementForces![0]).toMatchObject({ x: 16, fx: 10, fy: 2 });
  });
});

describe("pile rows", () => {
  it("map to the engine: Ito & Matsui without a force, capacities 0 = none", () => {
    const pile = newPile("p", "pile", ground);
    expect(pile.x1).toBe(pile.x2);
    const e = toEnginePile(pile);
    expect(e.force).toBeUndefined();
    expect(e.shearCapacity).toBeUndefined();
    expect(e.application).toBe("passive");
    const wall = toEnginePile({ ...pile, ...pilePreset("sheet-pile"), shearCapacity: 80 });
    expect(wall).toMatchObject({ force: 100, spacing: 1, shearCapacity: 80, application: "active" });
  });

  it("are read from a file, invalid entries dropped or repaired", () => {
    expect(sanitizePile({ type: "pile", x1: 0, y1: 0, x2: 0 }, "x")).toBeNull();
    const p = sanitizePile({ type: "pile", x1: 0, y1: 0, x2: 0, y2: -5, spacing: 0, angle: 120 }, "x")!;
    expect(p.spacing).toBe(2);
    expect(p.angle).toBe(0);
  });

  it("are saved with the project and reach the engine", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().addPile("sheet-pile");
    useAppStore.getState().saveCurrentModel();
    const loaded = parseProjectFile(JSON.stringify(serializeProject(useAppStore.getState()))).models[0];
    expect(loaded.piles?.[0].type).toBe("sheet-pile");
    const dto = buildSlopeDTOFromModel(snapshotFromState(useAppStore.getState()));
    expect(dto.piles?.[0].force).toBe(100);
  });
});

describe("support defaults by type", () => {
  it("geosynthetics and piles are passive, anchors and tiebacks active", () => {
    expect(reinforcementPreset("geosynthetic").application).toBe("passive");
    expect(reinforcementPreset("nail").application).toBe("passive");
    expect(reinforcementPreset("anchor").application).toBe("active");
    expect(reinforcementPreset("tieback").application).toBe("active");
    expect(pilePreset("pile").application).toBe("passive");
    expect(pilePreset("sheet-pile").application).toBe("active");
  });

  it("a pile row acts tangent to the slip surface, a sheet pile wall at its angle", () => {
    const pile = newPile("p", "pile", ground);
    expect(pile.direction).toBe("tangent");
    expect(toEnginePile(pile).direction).toBe("tangent");
    const wall = newPile("w", "sheet-pile", ground);
    expect(wall.direction).toBeUndefined();
    expect("direction" in toEnginePile(wall)).toBe(false);
  });

  it("a geosynthetic saved without an application stays active", () => {
    const r = sanitizeReinforcement({ type: "geosynthetic", x1: 0, y1: 0, x2: 5, y2: 0 }, "g")!;
    expect(r.application).toBe("active");
    expect(sanitizeReinforcement({ type: "geosynthetic", x1: 0, y1: 0, x2: 5, y2: 0, application: "passive" }, "g")!.application).toBe("passive");
  });

  it("reads the pile direction from a file; absent stays absent", () => {
    const raw = { type: "pile", x1: 0, y1: 0, x2: 0, y2: -5 };
    const old = sanitizePile(raw, "x")!;
    expect("direction" in old).toBe(false);
    expect("direction" in toEnginePile(old)).toBe(false);
    expect(sanitizePile({ ...raw, direction: "perpendicular" }, "x")!.direction).toBe("perpendicular");
    expect("direction" in sanitizePile({ ...raw, direction: "sideways" }, "x")!).toBe(false);
  });

  it("keeps the pile direction through save and load", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().addPile("pile");
    useAppStore.getState().addPile("sheet-pile");
    const [pile] = useAppStore.getState().piles;
    useAppStore.getState().updatePile(pile.id, { direction: "perpendicular" });
    useAppStore.getState().saveCurrentModel();
    const loaded = parseProjectFile(JSON.stringify(serializeProject(useAppStore.getState()))).models[0];
    expect(loaded.piles?.[0].direction).toBe("perpendicular");
    expect(loaded.piles?.[1] && "direction" in loaded.piles[1]).toBe(false);
    const dto = buildSlopeDTOFromModel(snapshotFromState(useAppStore.getState()));
    expect(dto.piles?.[0].direction).toBe("perpendicular");
    expect(dto.piles?.[1].direction).toBeUndefined();
  });
});
