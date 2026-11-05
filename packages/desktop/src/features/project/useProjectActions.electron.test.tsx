import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { useAppStore } from "../../store/app-store";
import { useProjectActions } from "./useProjectActions";

const bridge = {
  openFile: vi.fn<() => Promise<Uint8Array | null>>(),
  confirmFileOpened: vi.fn(),
  saveFile: vi.fn<(content: Uint8Array, name?: string) => Promise<boolean>>(),
  saveFileAs: vi.fn<(content: Uint8Array, name?: string) => Promise<boolean>>(),
  menuNew: vi.fn(),
};

describe("useProjectActions in Electron", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    for (const fn of Object.values(bridge)) fn.mockReset();
    (window as unknown as { cslope: unknown }).cslope = bridge;
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { cslope?: unknown }).cslope;
  });

  it("does not adopt a file as save target when it fails to parse", async () => {
    bridge.openFile.mockResolvedValue(new TextEncoder().encode('{"name":"not a project"}'));
    const { result } = renderHook(() => useProjectActions("project"));
    await act(() => result.current.handleOpen());
    expect(window.alert).toHaveBeenCalled();
    expect(bridge.confirmFileOpened).not.toHaveBeenCalled();
  });

  it("adopts the file as save target after a successful load", async () => {
    const { serializeProject } = await import("../../store/persistence");
    bridge.openFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify(serializeProject(useAppStore.getState()))),
    );
    const { result } = renderHook(() => useProjectActions("project"));
    await act(() => result.current.handleOpen());
    expect(bridge.confirmFileOpened).toHaveBeenCalledTimes(1);
  });

  it("saves a .cslp archive under the model's name and opens it again", async () => {
    const { readProjectBytes } = await import("./cslp");
    useAppStore.getState().addModel("Dam: north / B");
    bridge.saveFile.mockResolvedValue(true);
    const { result } = renderHook(() => useProjectActions("project"));
    await act(() => result.current.handleSave());
    const [data, name] = bridge.saveFile.mock.calls[0];
    expect(name).toBe("Dam_ north _ B.cslp");
    const saved = await readProjectBytes(data);
    expect(saved.models.map((m) => m.name)).toContain("Dam: north / B");

    useAppStore.getState().newProject();
    bridge.openFile.mockResolvedValue(data);
    await act(() => result.current.handleOpen());
    expect(useAppStore.getState().models.map((m) => m.name)).toContain("Dam: north / B");
    expect(bridge.confirmFileOpened).toHaveBeenCalledTimes(1);
  });

  it("keeps the first save's created time on later saves of a new project", async () => {
    const { openProject } = await import("./cslp");
    bridge.saveFile.mockResolvedValue(true);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { result } = renderHook(() => useProjectActions("project"));
      vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
      await act(() => result.current.handleSave());
      vi.setSystemTime(new Date("2026-02-01T10:00:00.000Z"));
      useAppStore.getState().addModel("Second");
      await act(() => result.current.handleSave());
      const manifests = await Promise.all(
        bridge.saveFile.mock.calls.map(async ([data]) => (await openProject(data)).manifest),
      );
      expect(manifests.map((m) => m?.created)).toEqual([
        "2026-01-01T10:00:00.000Z",
        "2026-01-01T10:00:00.000Z",
      ]);
      expect(manifests[1]?.modified).toBe("2026-02-01T10:00:00.000Z");
      expect(useAppStore.getState().projectCreated).toBe("2026-01-01T10:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed read instead of rejecting unhandled", async () => {
    bridge.openFile.mockRejectedValue(new Error("EACCES"));
    const { result } = renderHook(() => useProjectActions("project"));
    await act(() => result.current.handleOpen());
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("EACCES"),
    );
  });

  it("tells the user when saving fails", async () => {
    bridge.saveFile.mockRejectedValue(new Error("EROFS: read-only"));
    const { result } = renderHook(() => useProjectActions("project"));
    await act(() => result.current.handleSave());
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("read-only"),
    );
  });
});
