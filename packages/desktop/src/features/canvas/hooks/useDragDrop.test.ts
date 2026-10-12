import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const electron = vi.hoisted(() => ({ value: false }));
vi.mock("../../../utils/is-electron", () => ({
  get isElectron() {
    return electron.value;
  },
}));
const confirm = vi.hoisted(() => ({ fn: vi.fn(async () => true) }));
vi.mock("../../project/unsavedGuard", () => ({ confirmUnsavedChanges: () => confirm.fn() }));

import { useDragDrop } from "./useDragDrop";
import { useAppStore } from "../../../store/app-store";
import { serializeProject } from "../../../store/persistence";

/** A project file whose first vertex is at x = `marker` (store actions keep the model entry in sync). */
function projectText(marker: number): string {
  useAppStore.getState().newProject();
  const [, y] = useAppStore.getState().coordinates[0];
  useAppStore.getState().setCoordinate(0, [marker, y]);
  const text = JSON.stringify(serializeProject(useAppStore.getState()));
  useAppStore.getState().newProject();
  return text;
}

function drop(file: File | null, type = "drop") {
  const event = new Event(type, { cancelable: true, bubbles: true }) as Event & { dataTransfer: unknown };
  const dataTransfer = { files: file ? [file] : [], dropEffect: "none" };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, dataTransfer };
}

const firstX = () => useAppStore.getState().coordinates[0][0];

beforeEach(() => {
  electron.value = false;
  confirm.fn.mockReset();
  confirm.fn.mockResolvedValue(true);
  useAppStore.getState().newProject();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { cslope?: unknown }).cslope;
});

describe("useDragDrop", () => {
  it("accepts drags as a copy and blocks the browser default", () => {
    renderHook(() => useDragDrop());
    const over = drop(null, "dragover");
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    expect(drop(null, "dragleave").event.defaultPrevented).toBe(true);
  });

  it("opens a dropped project file read in the browser", async () => {
    renderHook(() => useDragDrop());
    const text = projectText(-77);
    drop(new File([text], "slope.cslope"));
    await waitFor(() => expect(firstX()).toBe(-77));
    expect(confirm.fn).toHaveBeenCalled();
  });

  it("ignores files that are not projects", async () => {
    renderHook(() => useDragDrop());
    drop(new File([projectText(-78)], "picture.png"));
    await Promise.resolve();
    expect(confirm.fn).not.toHaveBeenCalled();
    expect(firstX()).not.toBe(-78);
  });

  it("keeps the current project when unsaved changes are not discarded", async () => {
    confirm.fn.mockResolvedValue(false);
    renderHook(() => useDragDrop());
    drop(new File([projectText(-79)], "other.json"));
    await waitFor(() => expect(confirm.fn).toHaveBeenCalled());
    expect(firstX()).not.toBe(-79);
  });

  it("reports an unreadable file", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderHook(() => useDragDrop());
    drop(new File(["{ not json"], "broken.json"));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringMatching(/^Unable to open project: /)));
  });

  it("reads the native path in the desktop app and confirms the open", async () => {
    electron.value = true;
    const text = projectText(-80);
    const openFilePath = vi.fn(async () => text);
    const confirmFileOpened = vi.fn();
    (window as unknown as { cslope: unknown }).cslope = { openFilePath, confirmFileOpened };
    renderHook(() => useDragDrop());
    const file = new File([""], "native.cslope");
    Object.defineProperty(file, "path", { value: "C:\\models\\native.cslope" });
    drop(file);
    await waitFor(() => expect(firstX()).toBe(-80));
    expect(openFilePath).toHaveBeenCalledWith("C:\\models\\native.cslope");
    expect(confirmFileOpened).toHaveBeenCalled();
  });

  it("stops listening when unmounted", () => {
    const { unmount } = renderHook(() => useDragDrop());
    unmount();
    expect(drop(null, "dragover").event.defaultPrevented).toBe(false);
  });
});
