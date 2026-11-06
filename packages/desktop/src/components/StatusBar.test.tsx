import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { elapsedText } from "../utils/elapsed-text";
import type { AnalysisResult } from "../store/types";
import { APP_VERSION } from "../utils/app-version";

const noop = () => {};

const defaultProps = {
  mode: "edit" as const,
  runState: "idle" as const,
  result: null as AnalysisResult | null,
  snapToGrid: false,
  gridSnapSize: 1,
  setSnapToGrid: noop,
  setGridSnapSize: noop,
  coordinateCount: 5,
  cursorWorld: null as [number, number] | null,
};

describe("StatusBar", () => {
  it("shows the Edit mode indicator", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("shows the Result mode indicator", () => {
    render(<StatusBar {...defaultProps} mode="result" />);
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("shows point count", () => {
    render(<StatusBar {...defaultProps} coordinateCount={12} />);
    expect(screen.getByText("Points: 12")).toBeInTheDocument();
  });

  it("shows FOS result with success color when FOS >= 1.5", () => {
    const result: AnalysisResult = {
      minFOS: 1.8,
      maxFOS: 2.0,
      criticalSurface: null as never,
      allSurfaces: [],
      criticalSlices: [],
      method: "Bishop",
      elapsedMs: 100,
    };
    render(<StatusBar {...defaultProps} result={result} />);
    const fosEl = screen.getByText("1.800");
    expect(fosEl).toBeInTheDocument();
    expect(fosEl.style.color).toContain("success");
    expect(screen.getByText(/Bishop/)).toBeInTheDocument();
  });

  it("shows FOS with warning color when 1.0 <= FOS < 1.5", () => {
    const result: AnalysisResult = {
      minFOS: 1.2,
      maxFOS: 1.4,
      criticalSurface: null as never,
      allSurfaces: [],
      criticalSlices: [],
      method: "Janbu",
      elapsedMs: 50,
    };
    render(<StatusBar {...defaultProps} result={result} />);
    const fosEl = screen.getByText("1.200");
    expect(fosEl.style.color).toContain("warning");
  });

  it("has no warning band for an FOS on design values, as the summary", () => {
    const result: AnalysisResult = {
      minFOS: 1.172,
      maxFOS: 1.4,
      criticalSurface: null as never,
      allSurfaces: [],
      criticalSlices: [],
      method: "Bishop",
      elapsedMs: 50,
    };
    render(<StatusBar {...defaultProps} result={result} designValues />);
    expect(screen.getByText("1.172").style.color).toContain("success");
  });

  it("shows FOS with error color when FOS < 1.0", () => {
    const result: AnalysisResult = {
      minFOS: 0.85,
      maxFOS: 0.9,
      criticalSurface: null as never,
      allSurfaces: [],
      criticalSlices: [],
      method: "Bishop",
      elapsedMs: 30,
    };
    render(<StatusBar {...defaultProps} result={result} />);
    const fosEl = screen.getByText("0.850");
    expect(fosEl.style.color).toContain("error");
  });

  it("shows Analyzing indicator when running", () => {
    render(<StatusBar {...defaultProps} runState="running" />);
    expect(screen.getByText("Analyzing...")).toBeInTheDocument();
  });

  it("does not show result or analysing when idle", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.queryByText("Analyzing...")).not.toBeInTheDocument();
    expect(screen.queryByText(/FOS:/)).not.toBeInTheDocument();
  });

  it("shows cursor world coordinates when available", () => {
    render(<StatusBar {...defaultProps} cursorWorld={[12.34, 5.67]} />);
    expect(screen.getByText("12.34")).toBeInTheDocument();
    expect(screen.getByText("5.67")).toBeInTheDocument();
  });

  it("shows placeholder dashes when no cursor world", () => {
    render(<StatusBar {...defaultProps} cursorWorld={null} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("toggles snap to grid checkbox", () => {
    const setSnap = vi.fn();
    render(<StatusBar {...defaultProps} setSnapToGrid={setSnap} />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(setSnap).toHaveBeenCalledWith(true);
  });

  it("shows snap grid size selector", () => {
    const setSize = vi.fn();
    render(
      <StatusBar
        {...defaultProps}
        snapToGrid={true}
        gridSnapSize={0.5}
        setGridSnapSize={setSize}
      />,
    );
    const select = screen.getByRole("combobox");
    expect(select).not.toBeDisabled();
    fireEvent.change(select, { target: { value: "2" } });
    expect(setSize).toHaveBeenCalledWith(2);
  });

  it("disables grid size selector when snap is off", () => {
    render(<StatusBar {...defaultProps} snapToGrid={false} />);
    const select = screen.getByRole("combobox");
    expect(select).toBeDisabled();
  });

  it("shows the app version", () => {
    render(<StatusBar {...defaultProps} />);
    expect(
      screen.getByText(APP_VERSION ? `cSlope v${APP_VERSION}` : "cSlope"),
    ).toBeInTheDocument();
    expect(screen.queryByText("cSlope v0.1")).toBeNull();
  });

  it("gives the snap sizes in metres", () => {
    render(<StatusBar {...defaultProps} snapToGrid gridSnapSize={0.5} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("0.5 m");
  });

  it("says only that the run failed: the reason is in the banner", () => {
    render(<StatusBar {...defaultProps} runState="error" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/^Analysis failed$/);
    expect(status).not.toHaveAttribute("title");
  });

  it("shows the stage of a finite element run and its elapsed time while it runs", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
      const started = Date.now() - 65_000;
      render(
        <StatusBar
          {...defaultProps}
          runState="running"
          runStage="Finite elements: strength reduction, trial F = 1.23 (5)"
          runStartedAt={started}
        />,
      );
      expect(screen.getByTestId("status-run-stage")).toHaveTextContent("Finite elements: strength reduction, trial F = 1.23 (5)");
      expect(screen.getByTestId("status-run-elapsed")).toHaveTextContent("1:05");
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId("status-run-elapsed")).toHaveTextContent("1:07");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no stage or elapsed time unless a run is going on", () => {
    render(<StatusBar {...defaultProps} runStage="stale" runStartedAt={Date.now()} />);
    expect(screen.queryByTestId("status-run-stage")).toBeNull();
    expect(screen.queryByTestId("status-run-elapsed")).toBeNull();
  });

  it("gives the elapsed time as m:ss, from an hour h:mm:ss", () => {
    expect(elapsedText(0)).toBe("0:00");
    expect(elapsedText(59_999)).toBe("0:59");
    expect(elapsedText(61_000)).toBe("1:01");
    expect(elapsedText(3_725_000)).toBe("1:02:05");
  });

  it("shows no error unless the run failed", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.queryByText("Analysis failed")).toBeNull();
  });

  it("shows a running Run All as finished/total with its progress bar", () => {
    render(
      <StatusBar
        {...defaultProps}
        runState="running"
        runAll={{ total: 20, finished: 7, failed: 0, progress: 0.42, running: true }}
      />,
    );
    expect(screen.getByTestId("status-run-all")).toHaveTextContent("Run all 7/20");
    const bar = screen.getByRole("progressbar", { name: "Run all progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect((bar.firstChild as HTMLElement).style.width).toBe("42%");
    // (the batch stands for the "Analyzing..." of a single run)
    expect(screen.queryByText("Analyzing...")).toBeNull();
  });

  it("shows the outcome of an ended Run All, with the failed models if any", () => {
    const { rerender } = render(
      <StatusBar {...defaultProps} runAll={{ total: 20, finished: 20, failed: 2, progress: 1, running: false }} />,
    );
    expect(screen.getByTestId("status-run-all")).toHaveTextContent("Run all done: 20 models, 2 failed");
    expect(screen.queryByRole("progressbar")).toBeNull();
    rerender(<StatusBar {...defaultProps} runAll={{ total: 1, finished: 1, failed: 0, progress: 1, running: false }} />);
    expect(screen.getByTestId("status-run-all")).toHaveTextContent(/^Run all done: 1 model$/);
  });

  it("shows no Run All without a batch", () => {
    render(<StatusBar {...defaultProps} runState="running" runAll={null} />);
    expect(screen.queryByTestId("status-run-all")).toBeNull();
    expect(screen.getByText("Analyzing...")).toBeInTheDocument();
  });
});
