import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";

vi.mock("../utils/is-electron", () => ({ isElectron: true }));

import App from "../App";
import { useAppStore } from "../store/app-store";

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
          };
        }
        if (prop.startsWith("off")) return () => {};
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
