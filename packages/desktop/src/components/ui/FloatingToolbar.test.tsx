import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FloatingToolbar, type FloatingToolbarProps } from "./FloatingToolbar";
import type { CanvasToolbarState } from "../../store/types";

function canvasToolbar(patch: Partial<CanvasToolbarState> = {}): CanvasToolbarState {
  return {
    zoomBoxActive: false,
    panActive: false,
    zoomPercent: 100,
    onFitToScreen: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onSetZoomPercent: vi.fn(),
    onToggleZoomBox: vi.fn(),
    onTogglePan: vi.fn(),
    ...patch,
  };
}

function setup(patch: Partial<FloatingToolbarProps> = {}) {
  const props: FloatingToolbarProps = {
    mode: "edit",
    setMode: vi.fn(),
    runState: "idle",
    hasResult: true,
    onRun: vi.fn(),
    onCancel: vi.fn(),
    onRunAll: vi.fn(),
    onReset: vi.fn(),
    onResetAll: vi.fn(),
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canvasToolbar: canvasToolbar(),
    ...patch,
  };
  const utils = render(<FloatingToolbar {...props} />);
  return { props, ...utils };
}

const click = (el: Element) => fireEvent.click(el);

afterEach(() => {
  vi.useRealTimers();
});

describe("FloatingToolbar", () => {
  it("switches between edit and results mode", () => {
    const { props } = setup();
    click(screen.getByTitle("Results"));
    expect(props.setMode).toHaveBeenCalledWith("result");
    click(screen.getByTitle("Edit"));
    expect(props.setMode).toHaveBeenCalledWith("edit");
  });

  it("does not switch to results without a result", () => {
    const { props } = setup({ hasResult: false });
    click(screen.getByTitle("Results"));
    expect(props.setMode).not.toHaveBeenCalled();
  });

  it("runs, and cancels while running", () => {
    const { props, rerender } = setup();
    const run = screen.getByTitle("Run analysis and view results");
    expect(run).toHaveTextContent("Run");
    click(run);
    expect(props.onRun).toHaveBeenCalledTimes(1);

    rerender(<FloatingToolbar {...props} runState="running" />);
    const cancel = screen.getByTitle("Cancel running analysis");
    expect(cancel).toHaveTextContent("Cancel");
    click(cancel);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onRun).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("More run options")).toBeDisabled();
  });

  it("offers Run all, Reset and Reset all in the run menu", () => {
    const { props } = setup();
    click(screen.getByTitle("More run options"));
    click(screen.getByRole("button", { name: "Run all" }));
    expect(props.onRunAll).toHaveBeenCalled();
    // The menu closes after a choice.
    expect(screen.queryByRole("button", { name: "Run all" })).toBeNull();

    click(screen.getByTitle("More run options"));
    click(screen.getByRole("button", { name: "Reset" }));
    expect(props.onReset).toHaveBeenCalled();

    click(screen.getByTitle("More run options"));
    click(screen.getByRole("button", { name: "Reset all" }));
    expect(props.onResetAll).toHaveBeenCalled();
  });

  it("disables Reset without a result and closes the menu on an outside click", () => {
    setup({ hasResult: false });
    click(screen.getByTitle("More run options"));
    expect(screen.getByRole("button", { name: "Reset" }).style.pointerEvents).toBe("none");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "Reset all" })).toBeNull();
  });

  it("does not reset from the keyboard while Reset is disabled", async () => {
    const { props } = setup({ hasResult: false });
    click(screen.getByTitle("More run options"));
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled();
    reset.focus();
    await userEvent.keyboard("{Enter}");
    fireEvent.click(reset);
    expect(props.onReset).not.toHaveBeenCalled();
  });

  it("undoes and redoes only when available", () => {
    const { props } = setup({ canUndo: true, canRedo: false });
    click(screen.getByTitle("Undo (Ctrl+Z)"));
    click(screen.getByTitle("Redo (Ctrl+Shift+Z)"));
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onRedo).not.toHaveBeenCalled();
  });

  it("forwards the viewport controls to the canvas", () => {
    const tb = canvasToolbar({ zoomPercent: 140, panActive: true });
    setup({ canvasToolbar: tb });
    click(screen.getByTitle("Zoom in"));
    click(screen.getByTitle("Zoom out"));
    click(screen.getByTitle("Zoom box"));
    click(screen.getByTitle("Pan"));
    click(screen.getByTitle("Fit to screen"));
    expect(tb.onZoomIn).toHaveBeenCalled();
    expect(tb.onZoomOut).toHaveBeenCalled();
    expect(tb.onToggleZoomBox).toHaveBeenCalled();
    expect(tb.onTogglePan).toHaveBeenCalled();
    expect(tb.onFitToScreen).toHaveBeenCalled();
    // The zoom preset closest to the current zoom is shown.
    const zoom = screen.getByRole("combobox") as HTMLSelectElement;
    expect(zoom.value).toBe("150");
    fireEvent.change(zoom, { target: { value: "300" } });
    expect(tb.onSetZoomPercent).toHaveBeenCalledWith(300);
  });

  it("disables the viewport controls without a canvas", () => {
    setup({ canvasToolbar: null });
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect((screen.getByTitle("Zoom in") as HTMLElement).style.pointerEvents).toBe("none");
  });

  it("fades after 3 s without hover and comes back on hover", () => {
    vi.useFakeTimers();
    setup();
    const toolbar = screen.getByRole("toolbar", { name: "Floating toolbar" });
    expect(toolbar.style.opacity).toBe("1");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(toolbar.style.opacity).toBe("0.4");
    fireEvent.pointerEnter(toolbar);
    expect(toolbar.style.opacity).toBe("1");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(toolbar.style.opacity).toBe("1");
    fireEvent.pointerLeave(toolbar);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(toolbar.style.opacity).toBe("1");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toolbar.style.opacity).toBe("0.4");
  });

  it("collapses to icons when the canvas is narrow", () => {
    let callback: ResizeObserverCallback | null = null;
    const Original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        callback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      const { container } = render(
        <div>
          <FloatingToolbar
            mode="edit"
            setMode={vi.fn()}
            runState="idle"
            hasResult
            onRun={vi.fn()}
            onCancel={vi.fn()}
            onRunAll={vi.fn()}
            onReset={vi.fn()}
            onResetAll={vi.fn()}
            canUndo
            canRedo
            onUndo={vi.fn()}
            onRedo={vi.fn()}
            canvasToolbar={canvasToolbar()}
          />
        </div>,
      );
      expect(screen.getByText("Edit")).toBeInTheDocument();
      act(() => {
        callback!(
          [{ contentRect: { width: 400 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
      expect(screen.queryByText("Edit")).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(container.textContent).not.toContain("Run");
    } finally {
      globalThis.ResizeObserver = Original;
    }
  });
});
