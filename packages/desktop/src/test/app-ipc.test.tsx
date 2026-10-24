import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";

vi.mock("../utils/is-electron", () => ({ isElectron: true }));

import App from "../App";
import { useAppStore } from "../store/app-store";
import { paperContentOf } from "../features/view/extents";
import { DEFAULT_MATERIAL } from "../store/defaults";

type Handler = (event: unknown, payload?: unknown) => void;
const handlers = new Map<string, Handler[]>();
const sent: { name: string; payload: unknown }[] = [];
const calls: string[] = [];

/** window.cslope stand-in: records on* handlers, send* payloads and other calls. */
function installFakeBridge() {
  (window as unknown as { cslope: unknown }).cslope = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop.startsWith("on")) {
          return (fn: Handler) => {
            handlers.set(prop, [...(handlers.get(prop) ?? []), fn]);
            return () => handlers.set(prop, (handlers.get(prop) ?? []).filter((h) => h !== fn));
          };
        }
        if (prop.startsWith("send")) return (payload: unknown) => sent.push({ name: prop, payload });
        return () => {
          calls.push(prop);
          return Promise.resolve(null);
        };
      },
    },
  );
}

function emit(name: string, payload?: unknown) {
  act(() => {
    for (const fn of handlers.get(name) ?? []) fn({}, payload);
  });
}

const lastSent = (name: string) => [...sent].reverse().find((m) => m.name === name)?.payload as Record<string, unknown>;
const sentCount = (name: string) => sent.filter((m) => m.name === name).length;
const RESULT = { minFOS: 1.5, allSurfaces: [], criticalSurface: null, criticalSlices: [] } as unknown as AnalysisResult;

describe("main window IPC", () => {
  beforeEach(() => {
    handlers.clear();
    sent.length = 0;
    calls.length = 0;
    window.location.hash = "";
    installFakeBridge();
    useAppStore.getState().newProject();
    render(<App />);
    act(() => {
      useAppStore.setState({ runState: "done", result: RESULT });
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { cslope?: unknown }).cslope;
  });

  it("tells the main process the window is ready", () => {
    expect(calls).toContain("appReady");
  });

  it("answers every dialog's state request with the current model", () => {
    const s = useAppStore.getState();
    const cases: [string, string, Record<string, unknown>][] = [
      ["onMaterialsRequestState", "sendMaterialsState", { materials: s.materials, parameters: s.parameters }],
      ["onMaterialAssignmentRequestState", "sendMaterialAssignmentState", { regionMaterials: s.regionMaterials }],
      ["onGeometryRequestState", "sendGeometryState", { coordinates: s.coordinates }],
      ["onInteriorBoundariesRequestState", "sendInteriorBoundariesState", { materialBoundaries: s.materialBoundaries }],
      ["onLoadsRequestState", "sendLoadsState", { udls: s.udls, orientation: s.orientation }],
      ["onPiezoRequestState", "sendPiezoState", { piezometricLine: s.piezometricLine }],
      ["onParametersRequestState", "sendParametersState", { parameters: s.parameters }],
      ["onAnalysisRequestState", "sendAnalysisState", { options: s.options, analysisLimits: s.analysisLimits }],
      [
        "onViewSettingsRequestState",
        "sendViewSettingsState",
        // What the model draws, for the dialog's "Use model bounds".
        { resultViewSettings: s.resultViewSettings, paperContent: paperContentOf(s) },
      ],
    ];
    for (const [request, response, expected] of cases) {
      emit(request);
      expect(lastSent(response), response).toMatchObject(expected);
    }
    emit("onResultsPlotRequestState");
    const plot = lastSent("sendResultsPlotState");
    expect(plot.result).toBe(RESULT);
    expect((plot.model as { name: string }).name).toBe(s.models[0].name);
  });

  it("moves boundary points with a vertex edited in the Geometry window", () => {
    const coords = useAppStore.getState().coordinates.map((c) => [...c]) as [number, number][];
    const i = 1;
    const [vx, vy] = coords[i];
    act(() =>
      useAppStore.setState({
        materialBoundaries: [{ id: "b", coordinates: [[vx, vy], [vx + 5, vy - 3]] }],
      }),
    );
    coords[i] = [vx, vy + 1];
    sent.length = 0;
    emit("onGeometryChanged", { coordinates: coords, coordinateExpressions: [] });
    const s = useAppStore.getState();
    expect(s.coordinates[i]).toEqual([vx, vy + 1]);
    expect(s.materialBoundaries[0].coordinates[0]).toEqual([vx, vy + 1]);
    expect(s.result).toBeNull();
    // The change is not echoed back to the Geometry window.
    expect(sentCount("sendGeometryChanged")).toBe(0);
  });

  it("applies interior boundaries, assignments and parameters from their windows", () => {
    const coordinates = useAppStore.getState().coordinates;
    emit("onInteriorBoundariesChanged", {
      coordinates,
      materialBoundaries: [{ id: "b", coordinates: [[0, 4], [25, 4]] }],
      selectedMaterialBoundaryId: "b",
      parameters: [{ name: "H", expression: "3" }],
    });
    let s = useAppStore.getState();
    expect(s.materialBoundaries).toHaveLength(1);
    expect(s.selectedMaterialBoundaryId).toBe("b");
    expect(s.parameters).toEqual([{ name: "H", expression: "3" }]);
    expect(s.models.find((m) => m.id === s.activeModelId)!.materialBoundaries).toHaveLength(1);

    emit("onMaterialAssignmentChanged", { regionMaterials: [{ point: [1, 1], materialId: s.materials[0].id }] });
    expect(useAppStore.getState().regionMaterials).toHaveLength(1);

    emit("onParametersChanged", { parameters: [{ name: "H", expression: "4" }] });
    s = useAppStore.getState();
    expect(s.parameters[0].expression).toBe("4");
  });

  it("takes reinforcement only from the reinforcement window and ignores malformed loads", () => {
    act(() => useAppStore.getState().addReinforcement("anchor"));
    expect(useAppStore.getState().reinforcements).toHaveLength(1);
    emit("onLoadsChanged", { udls: [], lineLoads: [{ id: "l", magnitude: 5, x: 3 }] });
    expect(useAppStore.getState().lineLoads).toHaveLength(1);
    expect(useAppStore.getState().reinforcements).toHaveLength(1);
    emit("onLoadsChanged", { udls: [], lineLoads: [], reinforcements: [], piles: [], parameters: [] });
    expect(useAppStore.getState().reinforcements).toHaveLength(0);
    emit("onLoadsChanged", { udls: "nope" });
    emit("onLoadsChanged", null);
    expect(useAppStore.getState().lineLoads).toHaveLength(0);
  });

  it("applies the water table from the piezometric window and ignores malformed payloads", () => {
    const s0 = useAppStore.getState();
    const piezometricLine = {
      ...s0.piezometricLine,
      enabled: true,
      lines: [{ id: "w", name: "W", color: "#00f", coordinates: [[0, 6], [25, 6]] }],
      activeLineId: "w",
    };
    emit("onPiezoChanged", { piezometricLine, coordinates: s0.coordinates, materials: s0.materials });
    expect(useAppStore.getState().piezometricLine.lines).toHaveLength(1);
    expect(useAppStore.getState().result).toBeNull();
    emit("onPiezoChanged", { piezometricLine: null, coordinates: [], materials: [] });
    emit("onPiezoChanged", undefined);
    expect(useAppStore.getState().piezometricLine.lines).toHaveLength(1);
  });

  it("keeps the result when the analysis window echoes unchanged settings, and invalidates on a change", () => {
    const s = useAppStore.getState();
    const payload = {
      coordinates: s.coordinates,
      orientation: s.orientation,
      analysisLimits: s.analysisLimits,
      customSearchPlanes: s.customSearchPlanes,
      customPlanesOnly: s.customPlanesOnly,
      options: s.options,
    };
    emit("onAnalysisChanged", structuredClone(payload));
    expect(useAppStore.getState().result).toBe(RESULT);
    emit("onAnalysisChanged", { ...structuredClone(payload), options: { ...s.options, slices: 12 } });
    expect(useAppStore.getState().options.slices).toBe(12);
    expect(useAppStore.getState().result).toBeNull();
  });

  it("applies view settings without discarding the result", () => {
    const s = useAppStore.getState();
    emit("onViewSettingsChanged", {
      resultViewSettings: { ...s.resultViewSettings, showGrid: false },
      coordinates: s.coordinates,
    });
    expect(useAppStore.getState().resultViewSettings.showGrid).toBe(false);
    expect(useAppStore.getState().result).toBe(RESULT);
  });

  it("drops assignments of materials deleted in the Materials window", () => {
    act(() =>
      useAppStore.setState({
        materials: [{ ...DEFAULT_MATERIAL }, { ...DEFAULT_MATERIAL, id: "sand", name: "Sand" }],
        regionMaterials: [{ point: [1, 1], materialId: "sand" }],
        assigningMaterialId: "sand",
      }),
    );
    emit("onMaterialsChanged", [{ ...DEFAULT_MATERIAL }]);
    const s = useAppStore.getState();
    expect(s.materials.map((m) => m.id)).toEqual([DEFAULT_MATERIAL.id]);
    expect(s.regionMaterials).toEqual([]);
    expect(s.assigningMaterialId).toBeNull();
  });

  it("broadcasts main-window edits to the open dialogs", () => {
    sent.length = 0;
    act(() => useAppStore.getState().addUdl());
    expect(sentCount("sendLoadsChanged")).toBe(1);
    expect(sentCount("sendResultsPlotChanged")).toBeGreaterThan(0);
    act(() => useAppStore.getState().setParameters([{ name: "Q", expression: "1" }] as never));
    expect(lastSent("sendParametersChanged")).toEqual({ parameters: [{ name: "Q", expression: "1" }] });
    act(() => useAppStore.getState().setResultViewSettings({ showSlices: false }));
    expect((lastSent("sendViewSettingsChanged").resultViewSettings as { showSlices: boolean }).showSlices).toBe(false);
  });

  it("tracks whether the Interior Boundaries window is open", () => {
    emit("onInteriorBoundariesDialogOpenChanged", true);
    expect(useAppStore.getState().interiorBoundariesDialogOpen).toBe(true);
    emit("onInteriorBoundariesDialogOpenChanged", false);
    expect(useAppStore.getState().interiorBoundariesDialogOpen).toBe(false);
  });
});

describe("dialog windows", () => {
  beforeEach(() => {
    handlers.clear();
    sent.length = 0;
    calls.length = 0;
    installFakeBridge();
    useAppStore.getState().newProject();
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
    vi.restoreAllMocks();
    delete (window as unknown as { cslope?: unknown }).cslope;
  });

  const DIALOGS = [
    "materials-dialog",
    "material-assignment-dialog",
    "geometry-dialog",
    "interior-boundaries-dialog",
    "udl-dialog",
    "line-loads-dialog",
    "reinforcement-dialog",
    "piezo-dialog",
    "parameters-dialog",
    "results-plot-dialog",
    "search-limits-dialog",
    "custom-search-planes-dialog",
    "options-dialog",
    "view-settings-dialog",
  ];

  it.each(DIALOGS)("renders only the dialog for #%s and asks the main window for its state", (hash) => {
    window.location.hash = `#${hash}`;
    const { container } = render(<App />);
    expect(container.querySelector("[data-testid='slope-canvas']")).toBeNull();
    expect(container.textContent!.length).toBeGreaterThan(0);
    expect(calls).not.toContain("appReady");
    expect(calls.some((c) => /^request[A-Za-z]+State$/.test(c))).toBe(true);
    // The main-window sync handlers are not installed in a dialog window.
    expect(handlers.get("onMaterialsRequestState") ?? []).toHaveLength(0);
  });

  it("closes on Escape, also from a field, after leaving the field", () => {
    vi.useFakeTimers();
    try {
      window.location.hash = "#parameters-dialog";
      const close = vi.spyOn(window, "close").mockImplementation(() => {});
      render(<App />);
      expect(calls).not.toContain("appReady");
      const input = document.createElement("input");
      const blurred = vi.fn();
      input.addEventListener("blur", blurred);
      document.body.appendChild(input);
      input.focus();
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      // The field is left first (it commits on blur), the window closes after.
      expect(blurred).toHaveBeenCalledTimes(1);
      expect(document.activeElement).not.toBe(input);
      act(() => vi.advanceTimersByTime(200));
      expect(close).toHaveBeenCalledTimes(1);
      input.remove();
      // A key the field already used (preventDefault) does not close.
      const used = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      used.preventDefault();
      act(() => {
        window.dispatchEvent(used);
        vi.advanceTimersByTime(200);
      });
      expect(close).toHaveBeenCalledTimes(1);
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        vi.advanceTimersByTime(200);
      });
      expect(close).toHaveBeenCalledTimes(1);
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        vi.advanceTimersByTime(200);
      });
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
