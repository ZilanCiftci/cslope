import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("../utils/is-electron", () => ({ isElectron: true }));

import { installFakeBridge, type FakeBridge } from "../test/fake-bridge";
import { markProjectClean, useAppStore } from "../store/app-store";
import { useWindowTitle, windowTitleText } from "./useWindowTitle";

function Title() {
  return <span data-testid="title">{useWindowTitle()}</span>;
}

let bridge: FakeBridge;
beforeEach(() => {
  vi.useFakeTimers();
  bridge = installFakeBridge();
  useAppStore.getState().newProject();
  markProjectClean(useAppStore.getState());
});
afterEach(() => {
  cleanup();
  bridge.uninstall();
  vi.useRealTimers();
});

describe("window title", () => {
  it("names the file and marks unsaved changes", () => {
    expect(windowTitleText(null, false)).toBe("Untitled — cSlope");
    expect(windowTitleText("test-pop20", true)).toBe("*test-pop20 — cSlope");
  });

  it("follows the file name from the main process, edits and saving", () => {
    render(<Title />);
    const title = () => screen.getByTestId("title").textContent;
    expect(title()).toBe("Untitled — cSlope");
    bridge.emit("onFileNameChanged", "test-pop20");
    expect(title()).toBe("test-pop20 — cSlope");
    expect(document.title).toBe("test-pop20 — cSlope");
    act(() => {
      const m = useAppStore.getState().materials[0];
      useAppStore.getState().updateMaterial(m.id, { name: "Renamed" });
      vi.advanceTimersByTime(300);
    });
    expect(title()).toBe("*test-pop20 — cSlope");
    expect(document.title).toBe("*test-pop20 — cSlope");
    act(() => markProjectClean(useAppStore.getState()));
    expect(title()).toBe("test-pop20 — cSlope");
    bridge.emit("onFileNameChanged", null);
    expect(title()).toBe("Untitled — cSlope");
  });
});
