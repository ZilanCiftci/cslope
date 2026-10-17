import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";

vi.mock("../utils/is-electron", () => ({ isElectron: true }));

import App from "../App";
import { isProjectDirty, useAppStore } from "../store/app-store";
import { useProjectActions } from "../features/project/useProjectActions";

type Handler = (event: unknown, payload?: unknown) => void;
const handlers = new Map<string, Handler[]>();
const bridge = {
  askUnsavedChanges: vi.fn<() => Promise<"save" | "discard" | "cancel">>(),
  saveFile: vi.fn<(json: string) => Promise<boolean>>(),
  saveFileAs: vi.fn<(json: string) => Promise<boolean>>(),
  confirmClose: vi.fn(),
  closeGuardReady: vi.fn(),
  closeGuardReleased: vi.fn(),
  menuNew: vi.fn(),
};

function installBridge() {
  (window as unknown as { cslope: unknown }).cslope = new Proxy(bridge, {
    get: (t, prop: string) => {
      if (prop in t) return t[prop as keyof typeof t];
      if (prop.startsWith("on")) {
        return (fn: Handler) => {
          handlers.set(prop, [...(handlers.get(prop) ?? []), fn]);
          return () => {};
        };
      }
      return () => Promise.resolve(null);
    },
  });
}

const dirty = () => isProjectDirty(useAppStore.getState());
const editGeometry = () =>
  act(() => {
    const [x, y] = useAppStore.getState().coordinates[1];
    useAppStore.getState().setCoordinate(1, [x + 1, y]);
  });
const frames = (n: number) =>
  act(() => new Promise<void>((r) => setTimeout(r, 20 * n)));

describe("unsaved changes", () => {
  beforeEach(() => {
    handlers.clear();
    for (const fn of Object.values(bridge)) fn.mockReset();
    installBridge();
    useAppStore.getState().newProject();
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { cslope?: unknown }).cslope;
  });

  it("tracks edits, ignores view and analysis state, and resets on save", async () => {
    expect(dirty()).toBe(false);
    act(() => useAppStore.setState({ editViewScale: 42, mode: "result" }));
    expect(dirty()).toBe(false);
    editGeometry();
    expect(dirty()).toBe(true);

    bridge.saveFile.mockResolvedValue(true);
    const { result } = renderHook(() => useProjectActions("p"));
    await act(() => result.current.handleSave());
    expect(dirty()).toBe(false);
  });

  it("does not report a freshly loaded project as changed after rendering", async () => {
    act(() => useAppStore.getState().loadBenchmarks());
    render(<App />);
    await frames(3);
    expect(dirty()).toBe(false);
  });

  it("asks before New and respects Cancel, Don't Save and Save", async () => {
    const { result } = renderHook(() => useProjectActions("p"));
    editGeometry();
    const edited = useAppStore.getState().coordinates;

    bridge.askUnsavedChanges.mockResolvedValue("cancel");
    await act(async () => {
      await result.current.handleNew();
    });
    expect(useAppStore.getState().coordinates).toEqual(edited);

    bridge.askUnsavedChanges.mockResolvedValue("save");
    bridge.saveFile.mockResolvedValue(false); // user cancelled Save As
    await act(async () => {
      await result.current.handleNew();
    });
    expect(useAppStore.getState().coordinates).toEqual(edited);

    bridge.askUnsavedChanges.mockResolvedValue("discard");
    await act(async () => {
      await result.current.handleNew();
    });
    expect(useAppStore.getState().coordinates).not.toEqual(edited);
    expect(dirty()).toBe(false);
  });

  it("does not ask when there is nothing to save", async () => {
    const { result } = renderHook(() => useProjectActions("p"));
    await act(async () => {
      await result.current.handleNew();
    });
    expect(bridge.askUnsavedChanges).not.toHaveBeenCalled();
  });

  it("only closes the window once unsaved changes are dealt with", async () => {
    render(<App />);
    await frames(1);
    expect(bridge.closeGuardReady).toHaveBeenCalled();
    const requestClose = async () => {
      await act(async () => {
        for (const fn of handlers.get("onCloseRequested") ?? []) fn({});
        await new Promise((r) => setTimeout(r, 0));
      });
    };

    await requestClose();
    expect(bridge.confirmClose).toHaveBeenCalledTimes(1); // clean: closes

    editGeometry();
    bridge.askUnsavedChanges.mockResolvedValue("cancel");
    await requestClose();
    expect(bridge.confirmClose).toHaveBeenCalledTimes(1);

    bridge.askUnsavedChanges.mockResolvedValue("save");
    bridge.saveFile.mockResolvedValue(true);
    await requestClose();
    expect(bridge.saveFile).toHaveBeenCalled();
    expect(bridge.confirmClose).toHaveBeenCalledTimes(2);
  });
});
