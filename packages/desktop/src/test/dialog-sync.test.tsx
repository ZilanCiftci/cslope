import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";

vi.mock("../utils/is-electron", () => ({ isElectron: true }));

import App from "../App";
import { useAppStore } from "../store/app-store";
import { performUndo } from "../store/selectors";
import type { ModelEarlierStage, ModelWaternet } from "../store/types";

type Handler = (event: unknown, payload: unknown) => void;
const handlers = new Map<string, Handler[]>();
const sent: { name: string; payload: unknown }[] = [];

/** Minimal window.cslope stand-in: records on* handlers and send* calls. */
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
          return (payload: unknown) => sent.push({ name: prop, payload });
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

const RESULT = { minFOS: 1.5 } as AnalysisResult;

describe("main window <-> dialog sync", () => {
  beforeEach(() => {
    handlers.clear();
    sent.length = 0;
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

  it("invalidates the result and updates the model when a dialog changes loads", () => {
    emit("onLoadsChanged", {
      udls: [{ id: "u1", magnitude: 10, x1: 1, x2: 2 }],
      lineLoads: [],
    });
    const s = useAppStore.getState();
    expect(s.result).toBeNull();
    expect(s.runState).toBe("idle");
    const entry = s.models.find((m) => m.id === s.activeModelId)!;
    expect(entry.udls).toHaveLength(1);
  });

  it("keeps the result when the Materials window echoes unchanged materials", () => {
    const { materials, parameters } = useAppStore.getState();
    emit("onMaterialsChanged", {
      materials: structuredClone(materials),
      parameters: structuredClone(parameters),
    });
    expect(useAppStore.getState().result).toBe(RESULT);
  });

  it("pushes material changes made in the main window to the Materials window", () => {
    sent.length = 0;
    act(() => {
      useAppStore.getState().addMaterial();
    });
    expect(sent.some((m) => m.name === "sendMaterialsChanged")).toBe(true);
  });
});

describe("imported waternet and earlier stage <-> dialogs", () => {
  const waternet: ModelWaternet = {
    headLines: [{ id: "PL1", points: [[0, 8], [20, 4]] }],
    referenceLines: [],
    phreaticLineId: "PL1",
  };
  const earlierStage: ModelEarlierStage = {
    coordinates: [[0, 0], [0, 8], [20, 5], [20, 0]],
    materials: [{ name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 17, cohesion: 5, frictionAngle: 25 } }],
  };
  const active = () => {
    const s = useAppStore.getState();
    return s.models.find((m) => m.id === s.activeModelId)!;
  };

  beforeEach(() => {
    handlers.clear();
    sent.length = 0;
    installFakeBridge();
    useAppStore.getState().newProject();
    useAppStore.setState((s) => ({
      waternet,
      earlierStage,
      models: s.models.map((m) => (m.id === s.activeModelId ? { ...m, waternet, earlierStage } : m)),
    }));
    render(<App />);
    act(() => {
      useAppStore.setState({ runState: "done", result: RESULT });
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { cslope?: unknown }).cslope;
  });

  it("sends them to the dialogs", () => {
    emit("onPiezoRequestState", undefined);
    emit("onMaterialsRequestState", undefined);
    const last = (name: string) => sent.filter((m) => m.name === name).at(-1)!.payload as Record<string, unknown>;
    expect(last("sendPiezoState").waternet).toEqual(waternet);
    expect(last("sendMaterialsState").earlierStage).toEqual(earlierStage);
  });

  it("keeps them, and the result, when a dialog echoes them", () => {
    const s = useAppStore.getState();
    emit("onPiezoChanged", {
      piezometricLine: structuredClone(s.piezometricLine),
      coordinates: structuredClone(s.coordinates),
      materials: structuredClone(s.materials),
      parameters: structuredClone(s.parameters),
      waternet: structuredClone(waternet),
    });
    emit("onMaterialsChanged", {
      materials: structuredClone(s.materials),
      parameters: structuredClone(s.parameters),
      earlierStage: structuredClone(earlierStage),
    });
    expect(useAppStore.getState().waternet).toEqual(waternet);
    expect(useAppStore.getState().earlierStage).toEqual(earlierStage);
    expect(useAppStore.getState().result).toBe(RESULT);
  });

  it("removes them when a dialog removed them, undoably", () => {
    const s = useAppStore.getState();
    emit("onPiezoChanged", {
      piezometricLine: structuredClone(s.piezometricLine),
      coordinates: structuredClone(s.coordinates),
      materials: structuredClone(s.materials),
      parameters: structuredClone(s.parameters),
      waternet: null,
    });
    expect(useAppStore.getState().waternet).toBeUndefined();
    expect(active().waternet).toBeUndefined();
    expect(useAppStore.getState().result).toBeNull();
    emit("onMaterialsChanged", {
      materials: structuredClone(s.materials),
      parameters: structuredClone(s.parameters),
      earlierStage: null,
    });
    expect(useAppStore.getState().earlierStage).toBeUndefined();
    expect(active().earlierStage).toBeUndefined();
    act(() => performUndo());
    expect(useAppStore.getState().earlierStage).toEqual(earlierStage);
    expect(useAppStore.getState().waternet).toBeUndefined();
    act(() => performUndo());
    expect(useAppStore.getState().waternet).toEqual(waternet);
  });
});
