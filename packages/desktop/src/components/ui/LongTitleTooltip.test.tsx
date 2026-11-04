import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_TITLE, LongTitleTooltip } from "./LongTitleTooltip";

const LONG = "A long explanation that the system would draw on one line far outside the window. ".repeat(2);

function setup() {
  render(
    <>
      <p title={LONG}>long</p>
      <p title="Short">short</p>
      <span>plain</span>
      <LongTitleTooltip />
    </>,
  );
}

describe("LongTitleTooltip", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a long title in its own wrapped tooltip, then gives the title back", () => {
    setup();
    const el = screen.getByText("long");
    expect(LONG.length).toBeGreaterThanOrEqual(LONG_TITLE);
    fireEvent.mouseOver(el, { clientX: 10, clientY: 10 });
    // The system tooltip is suppressed while the pointer rests on it.
    expect(el.hasAttribute("title")).toBe(false);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(LONG.trim());
    expect(tip.style.maxWidth).toBe("340px");
    fireEvent.mouseOut(el, { relatedTarget: screen.getByText("plain") });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(el.getAttribute("title")).toBe(LONG);
  });

  it("leaves short titles to the system", () => {
    setup();
    const el = screen.getByText("short");
    fireEvent.mouseOver(el);
    act(() => vi.advanceTimersByTime(500));
    expect(el.getAttribute("title")).toBe("Short");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on a click and restores the title", () => {
    setup();
    const el = screen.getByText("long");
    fireEvent.mouseOver(el);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseDown(el);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(el.getAttribute("title")).toBe(LONG);
  });
});
