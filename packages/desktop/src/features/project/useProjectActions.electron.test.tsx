import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { useAppStore } from "../../store/app-store";
import { useProjectActions } from "./useProjectActions";

const bridge = {
  openFile: vi.fn<() => Promise<string | null>>(),
  confirmFileOpened: vi.fn(),
  saveFile: vi.fn<(content: string) => Promise<boolean>>(),
  saveFileAs: vi.fn<(content: string) => Promise<boolean>>(),
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
    bridge.openFile.mockResolvedValue('{"name":"not a project"}');
    const { result } = renderHook(() => useProjectActions("project"));
    await act(() => result.current.handleOpen());
    expect(window.alert).toHaveBeenCalled();
    expect(bridge.confirmFileOpened).not.toHaveBeenCalled();
  });

  it("adopts the file as save target after a successful load", async () => {
    const { serializeProject } = await import("../../store/persistence");
    bridge.openFile.mockResolvedValue(
      JSON.stringify(serializeProject(useAppStore.getState())),
    );
    const { result } = renderHook(() => useProjectActions("project"));
    await act(() => result.current.handleOpen());
    expect(bridge.confirmFileOpened).toHaveBeenCalledTimes(1);
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
