import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { isRunShortcut, useRunShortcut } from "./run-shortcut";

function Harness({ run }: { run: () => void }) {
  useRunShortcut(run);
  return (
    <div>
      <input aria-label="field" />
      <button>button</button>
    </div>
  );
}

const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe("run shortcut", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("is F5 or Ctrl/Cmd+Enter", () => {
    const k = (init: KeyboardEventInit) => isRunShortcut(new KeyboardEvent("keydown", init));
    expect(k({ key: "F5" })).toBe(true);
    expect(k({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(k({ key: "Enter", metaKey: true })).toBe(true);
    expect(k({ key: "Enter" })).toBe(false);
    expect(k({ key: "Enter", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(k({ key: "F5", ctrlKey: true })).toBe(false);
    expect(k({ key: "F6" })).toBe(false);
  });

  it("runs on F5 and Ctrl+Enter", () => {
    const run = vi.fn();
    render(<Harness run={run} />);
    const e = key({ key: "F5" });
    expect(e.defaultPrevented).toBe(true);
    key({ key: "Enter", ctrlKey: true }, document.querySelector("button")!);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs from a checkbox, which takes no typed text", () => {
    const run = vi.fn();
    render(<Harness run={run} />);
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.appendChild(box);
    key({ key: "F5" }, box);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run while typing, on key repeat or under a modal", () => {
    const run = vi.fn();
    render(<Harness run={run} />);
    key({ key: "F5" }, document.querySelector("input")!);
    key({ key: "Enter", ctrlKey: true }, document.querySelector("input")!);
    key({ key: "F5", repeat: true });
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    key({ key: "F5" });
    modal.remove();
    expect(run).not.toHaveBeenCalled();
    key({ key: "F5" });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
