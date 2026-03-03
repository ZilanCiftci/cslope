import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { INITIAL_MODEL } from "../../store/slices/modelsSlice";
import { useProjectActions } from "./useProjectActions";

function clone<T>(value: T): T {
  const sc = globalThis.structuredClone as ((v: T) => T) | undefined;
  return sc ? sc(value) : JSON.parse(JSON.stringify(value));
}

// Capture the real createElement *once*, before any vi.spyOn touches it.
const realCreateElement = document.createElement.bind(document);

/** Mock `document.createElement` so that `<a>` returns a lightweight stub. */
function mockAnchorDownload() {
  const clickSpy = vi.fn();
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "a") {
      return {
        href: "",
        download: "",
        click: clickSpy,
      } as unknown as HTMLAnchorElement;
    }
    return realCreateElement(tag);
  });
  return clickSpy;
}

function resetStore() {
  const baseModel = clone(INITIAL_MODEL);
  useAppStore.setState({
    activeModelId: baseModel.id,
    models: [baseModel],
  });
}

describe("useProjectActions", () => {
  beforeEach(() => {
    resetStore();
    // Clear temporal history
    useAppStore.temporal.getState().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── handleNew ────────────────────────────────────────────────────

  it("handleNew resets project and clears temporal history", () => {
    // Give the store a second model so loadProject is observable
    useAppStore.getState().loadProject({
      models: [
        { ...clone(INITIAL_MODEL), id: "m-extra", name: "Extra" },
        clone(INITIAL_MODEL),
      ],
      activeModelId: "m-extra",
    });

    const { result } = renderHook(() => useProjectActions("cslope-project"));

    act(() => {
      result.current.handleNew();
    });

    // newProject resets to a single default model
    expect(useAppStore.getState().models).toHaveLength(1);
    expect(result.current.fileName).toBe("");
  });

  // ── handleOpen (browser path) ────────────────────────────────────

  it("handleOpen clicks the hidden file input in browser mode", async () => {
    const { result } = renderHook(() => useProjectActions("cslope-project"));

    // Create a mock input element
    const mockInput = document.createElement("input");
    const clickSpy = vi.spyOn(mockInput, "click");
    (
      result.current.fileInputRef as { current: HTMLInputElement | null }
    ).current = mockInput;

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(clickSpy).toHaveBeenCalledOnce();
  });

  // ── handleFileChange ─────────────────────────────────────────────

  it("handleFileChange parses a file and loads the project", async () => {
    const { result } = renderHook(() => useProjectActions("cslope-project"));

    const testModel = {
      ...clone(INITIAL_MODEL),
      id: "file-model",
      name: "From File",
    };
    const fileContents = JSON.stringify({
      version: 1,
      activeModelId: "file-model",
      models: [testModel],
    });

    const file = new File([fileContents], "test-project.json", {
      type: "application/json",
    });

    // Simulate the onChange event by creating a synthetic event
    await act(async () => {
      const event = {
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      result.current.handleFileChange(event);

      // Wait for FileReader to finish
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(useAppStore.getState().activeModelId).toBe("file-model");
    expect(result.current.fileName).toBe("test-project");
  });

  it("handleFileChange shows alert on invalid file", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { result } = renderHook(() => useProjectActions("cslope-project"));

    const file = new File(["not json"], "bad.json", {
      type: "application/json",
    });

    await act(async () => {
      const event = {
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      result.current.handleFileChange(event);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // ── handleSave (browser path) ────────────────────────────────────

  it("handleSave triggers a browser download with default name", async () => {
    const { result } = renderHook(() => useProjectActions("cslope-project"));

    // Mock only *after* renderHook has created its DOM nodes
    const clickSpy = mockAnchorDownload();
    const createURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:fake");
    const revokeURLSpy = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();

    await act(async () => {
      await result.current.handleSave();
    });

    expect(createURLSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeURLSpy).toHaveBeenCalledWith("blob:fake");
    // After save, fileName should be set
    expect(result.current.fileName).toBe("cslope-project");
  });

  // ── handleSaveAs (browser path) ──────────────────────────────────

  it("handleSaveAs prompts for name and downloads", async () => {
    const { result } = renderHook(() => useProjectActions("cslope-project"));

    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("my-slope");
    const clickSpy = mockAnchorDownload();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue();

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(promptSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(result.current.fileName).toBe("my-slope");
  });

  it("handleSaveAs does nothing when prompt is cancelled", async () => {
    const { result } = renderHook(() => useProjectActions("cslope-project"));

    vi.spyOn(window, "prompt").mockReturnValue(null);
    const createURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:fake");

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(createURLSpy).not.toHaveBeenCalled();
  });

  // ── fileName state ───────────────────────────────────────────────

  it("fileName starts empty", () => {
    const { result } = renderHook(() => useProjectActions("cslope-project"));
    expect(result.current.fileName).toBe("");
  });

  it("fileInputRef is created", () => {
    const { result } = renderHook(() => useProjectActions("cslope-project"));
    expect(result.current.fileInputRef).toBeDefined();
    expect(result.current.fileInputRef.current).toBeNull();
  });
});
