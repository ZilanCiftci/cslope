import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("../utils/is-electron", () => ({ isElectron: true }));

import App from "../App";
import { InteriorBoundariesDialogApp } from "../features/properties/InteriorBoundariesDialogApp";
import { useAppStore } from "../store/app-store";
import { computeRegions, regionInteriorPoint } from "../utils/regions";

type Handler = (event: unknown, payload: unknown) => void;
const handlers = new Map<string, Handler[]>();
const sent: { name: string; payload: Record<string, unknown> }[] = [];

function installFakeBridge() {
  const api = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop.startsWith("on")) {
          return (fn: Handler) => {
            handlers.set(prop, [...(handlers.get(prop) ?? []), fn]);
            return () =>
              handlers.set(
                prop,
                (handlers.get(prop) ?? []).filter((h) => h !== fn),
              );
          };
        }
        if (prop.startsWith("send")) {
          return (payload: Record<string, unknown>) =>
            sent.push({ name: prop, payload });
        }
        return () => Promise.resolve(null);
      },
    },
  );
  (window as unknown as { cslope: unknown }).cslope = api;
}

function emit(name: string, payload: unknown) {
  act(() => {
    for (const fn of handlers.get(name) ?? []) fn({}, payload);
  });
}

beforeEach(() => {
  handlers.clear();
  sent.length = 0;
  installFakeBridge();
  useAppStore.getState().newProject();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { cslope?: unknown }).cslope;
});

describe("dialog windows (round 4)", () => {
  it("a material deleted in the Materials window loses its assignments", () => {
    render(<App />);
    act(() => {
      useAppStore.getState().addMaterial();
    });
    const [m1, m2] = useAppStore.getState().materials;
    const [x, y] = useAppStore.getState().coordinates[1];
    act(() => {
      useAppStore.setState({
        regionMaterials: [{ point: [x + 1, y - 1], materialId: m2.id }],
      });
      useAppStore.getState().addPiezoLine([[0, 5], [10, 5]]);
      useAppStore.getState().addPiezoLine([[0, 6], [10, 6]]);
      const lineId = useAppStore.getState().piezometricLine.lines[1].id;
      useAppStore.getState().setPiezoMaterialAssignment(m2.id, lineId);
      useAppStore.getState().setAssigningMaterial(m2.id);
    });
    emit("onMaterialsChanged", {
      materials: [structuredClone(m1)],
      parameters: structuredClone(useAppStore.getState().parameters),
    });
    const s = useAppStore.getState();
    expect(s.materials.map((m) => m.id)).toEqual([m1.id]);
    expect(s.regionMaterials).toEqual([]);
    expect(s.piezometricLine.materialAssignment[m2.id]).toBeUndefined();
    expect(s.assigningMaterialId).toBeNull();
  });

  it("the Interior Boundaries window does not send its copy back on deselect", () => {
    Element.prototype.scrollIntoView ??= () => {};
    render(<InteriorBoundariesDialogApp />);
    const base = {
      coordinates: [[0, 0], [0, 10], [20, 10], [20, 0]],
      materialBoundaries: [
        { id: "b1", coordinates: [[0, 5], [20, 5]], coordinateExpressions: [{}, {}] },
      ],
      selectedMaterialBoundaryId: "b1",
      parameters: [],
    };
    emit("onInteriorBoundariesState", base);
    emit("onInteriorBoundariesChanged", { ...base, selectedMaterialBoundaryId: null });
    expect(sent).toEqual([]);
  });
});

describe("region interior point", () => {
  it("assigning the outer region of a ring keeps the lens material", () => {
    useAppStore.setState({
      coordinates: [[0, 0], [0, 10], [20, 10], [20, 0]],
      coordinateExpressions: [{}, {}, {}, {}],
      materialBoundaries: [],
      regionMaterials: [],
    });
    useAppStore.getState().addMaterialBoundary([[8, 4], [12, 4], [12, 6], [8, 6], [8, 4]]);
    useAppStore.getState().addMaterial();
    useAppStore.getState().addMaterial();
    const [m1, m2, m3] = useAppStore.getState().materials;
    const regionsNow = () => {
      const st = useAppStore.getState();
      return computeRegions(st.coordinates, st.materialBoundaries, st.regionMaterials, m1.id);
    };
    const lens = regionsNow().find((r) => !r.holes)!;
    useAppStore.getState().setRegionMaterial(regionInteriorPoint(lens.px, lens.py), m3.id);
    const ring = regionsNow().find((r) => r.holes)!;
    useAppStore
      .getState()
      .setRegionMaterial(regionInteriorPoint(ring.px, ring.py, ring.holes), m2.id);
    const after = regionsNow();
    expect(after.find((r) => r.holes)!.materialId).toBe(m2.id);
    expect(after.find((r) => !r.holes)!.materialId).toBe(m3.id);
  });
});
