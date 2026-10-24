import { afterEach, describe, expect, it } from "vitest";
import { installFocusSource } from "./focus-source";

describe("installFocusSource", () => {
  let uninstall = () => {};
  afterEach(() => {
    uninstall();
    delete document.documentElement.dataset.focusSource;
  });

  it("tracks whether the pointer or a navigation key moved focus last", () => {
    uninstall = installFocusSource();
    const root = document.documentElement;
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(root.dataset.focusSource).toBe("pointer");
    // Escape or a shortcut after a click keeps the ring hidden.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(root.dataset.focusSource).toBe("pointer");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(root.dataset.focusSource).toBe("keyboard");
  });

  it("stops tracking once uninstalled", () => {
    installFocusSource()();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.documentElement.dataset.focusSource).toBeUndefined();
  });
});
