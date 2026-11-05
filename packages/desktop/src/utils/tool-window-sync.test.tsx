import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";

vi.mock("./is-electron", () => ({ isElectron: true }));

import { useAppStore } from "../store/app-store";
import { installFakeBridge, type FakeBridge } from "../test/fake-bridge";
import { useSensitivityStore } from "../features/sensitivity/store";
import { useSensitivityWindowSync, type SensitivityWindowState } from "../features/sensitivity/window-sync";
import { useReliabilityStore } from "../features/reliability/store";
import { useReliabilityWindowSync, type ReliabilityWindowState } from "../features/reliability/window-sync";
import { SensitivityDialogApp } from "../features/sensitivity/SensitivityDialogApp";
import { ReliabilityDialogApp } from "../features/reliability/ReliabilityDialogApp";

let bridge: FakeBridge;

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.getState().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  bridge.uninstall();
});

describe("main window side of the Sensitivity window", () => {
  it("sends the model on request, and its changes and the run's only while the window is open", () => {
    renderHook(() => useSensitivityWindowSync(true));
    act(() => useAppStore.setState({ parameters: [{ name: "H", expression: "10" } as never] }));
    act(() => vi.advanceTimersByTime(100));
    // Not open yet: nothing is sent.
    expect(bridge.sentOf("sendSensitivityChanged")).toHaveLength(0);

    bridge.emit("onSensitivityRequestState");
    const [state] = bridge.sentOf<SensitivityWindowState>("sendSensitivityState");
    expect(state.model.parameters).toEqual([{ name: "H", expression: "10" }]);
    expect(state.model.name).toBe(useAppStore.getState().models[0].name);
    expect(state.running).toBe(false);

    act(() => useSensitivityStore.setState({ points: [{ value: 1, fos: 1.2 }], total: 2 }));
    act(() => useAppStore.setState((s) => ({ options: { ...s.options, slices: 40 } })));
    act(() => vi.advanceTimersByTime(100));
    // Both changes in one message.
    const changed = bridge.sentOf<SensitivityWindowState>("sendSensitivityChanged");
    expect(changed).toHaveLength(1);
    expect(changed[0].points).toEqual([{ value: 1, fos: 1.2 }]);
    expect(changed[0].model.options?.slices).toBe(40);
  });

  it("runs and cancels on the window's commands, and stops when it closes or the model changes", () => {
    const run = vi.fn(async () => {});
    const cancel = vi.fn();
    const reset = vi.fn();
    useSensitivityStore.setState({ run, cancel, reset });
    renderHook(() => useSensitivityWindowSync(true));
    const variable = { kind: "parameter" as const, name: "H" };
    const info = { key: "p:H", label: "Parameter H", value: 10 };
    bridge.emit("onSensitivityCommand", { type: "run", variable, info, values: [9, 11] });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ id: useAppStore.getState().activeModelId }),
      variable,
      info,
      [9, 11],
    );
    bridge.emit("onSensitivityCommand", { type: "cancel" });
    expect(cancel).toHaveBeenCalled();
    bridge.emit("onSensitivityClosed");
    expect(reset).toHaveBeenCalledTimes(1);
    act(() => useAppStore.setState({ activeModelId: "other" }));
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("does nothing in a dialog window", () => {
    renderHook(() => useSensitivityWindowSync(false));
    expect(bridge.listenerCount("onSensitivityRequestState")).toBe(0);
  });
});

describe("main window side of the Probabilistic analysis window", () => {
  it("sends the state and runs the window's commands", () => {
    const run = vi.fn(async () => {});
    useReliabilityStore.setState({ run });
    renderHook(() => useReliabilityWindowSync(true));
    bridge.emit("onReliabilityRequestState");
    const [state] = bridge.sentOf<ReliabilityWindowState>("sendReliabilityState");
    expect(state.model.materials).toEqual(useAppStore.getState().materials);
    expect(state.result).toBeNull();
    const variables = [{ material: 0, field: "cohesion", sd: 1 }];
    bridge.emit("onReliabilityCommand", { type: "run", variables, labels: ["c"], options: { method: "taylor" } });
    expect(run).toHaveBeenCalledWith(expect.anything(), variables, ["c"], { method: "taylor" });
  });
});

describe("tool windows", () => {
  it("ask the main window for the state, wait for it and send commands back", () => {
    render(<SensitivityDialogApp />);
    expect(bridge.callNames()).toContain("requestSensitivityState");
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the main window…");
    renderHook(() => useSensitivityWindowSync(true));
    bridge.emit("onSensitivityRequestState");
    bridge.emit("onSensitivityState", bridge.sentOf("sendSensitivityState")[0]);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => screen.getByRole("button", { name: "Run" }).click());
    expect(bridge.sentOf("sendSensitivityCommand")[0]).toMatchObject({ type: "run" });
  });

  it("the Probabilistic analysis window asks for its state", () => {
    render(<ReliabilityDialogApp />);
    expect(bridge.callNames()).toContain("requestReliabilityState");
    expect(screen.getByText("Probabilistic analysis")).toBeInTheDocument();
  });
});
