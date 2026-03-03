import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "../../store/app-store";
import { ResultPanel } from "./ResultPanel";

function resetStore() {
  useAppStore.setState({
    runState: "idle",
    progress: 0,
    result: null,
    errorMessage: null,
  });
}

describe("ResultPanel", () => {
  beforeEach(resetStore);

  // ── Idle state ───────────────────────────────────────────────

  it("shows prompt text when idle", () => {
    render(<ResultPanel />);
    expect(screen.getByText(/Run Analysis/)).toBeInTheDocument();
  });

  it("shows Results title by default", () => {
    render(<ResultPanel />);
    expect(screen.getByText("Results")).toBeInTheDocument();
  });

  it("hides title when showTitle is false", () => {
    render(<ResultPanel showTitle={false} />);
    expect(screen.queryByText("Results")).not.toBeInTheDocument();
  });

  // ── Running state ────────────────────────────────────────────

  it("shows progress bar and percentage when running", () => {
    useAppStore.setState({ runState: "running", progress: 0.45 });
    render(<ResultPanel />);
    expect(screen.getByText(/Analysing/)).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("shows 0% progress when progress is 0", () => {
    useAppStore.setState({ runState: "running", progress: 0 });
    render(<ResultPanel />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  // ── Done state ───────────────────────────────────────────────

  it("shows result summary when done", () => {
    useAppStore.setState({
      runState: "done",
      result: {
        minFOS: 1.234,
        maxFOS: 1.678,
        criticalSurface: {
          cx: 10,
          cy: 12,
          radius: 8.5,
          fos: 1.234,
          entryPoint: [2, 8],
          exitPoint: [18, 2],
          converged: true,
        },
        allSurfaces: [
          {
            cx: 10,
            cy: 12,
            radius: 8.5,
            fos: 1.234,
            entryPoint: [2, 8],
            exitPoint: [18, 2],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 250,
      },
    });
    render(<ResultPanel />);
    expect(screen.getByText("1.234")).toBeInTheDocument();
    expect(screen.getByText("1.678")).toBeInTheDocument();
    expect(screen.getByText("Bishop")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // surfaces count
    expect(screen.getByText("250 ms")).toBeInTheDocument();
    expect(screen.getByText("Critical Surface")).toBeInTheDocument();
    expect(screen.getByText(/Centre/)).toBeInTheDocument();
    expect(screen.getByText(/Radius: 8.50 m/)).toBeInTheDocument();
  });

  it("shows unsafe FOS color for FOS < 1.0", () => {
    useAppStore.setState({
      runState: "done",
      result: {
        minFOS: 0.85,
        maxFOS: 0.85,
        criticalSurface: {
          cx: 5,
          cy: 5,
          radius: 5,
          fos: 0.85,
          entryPoint: [1, 4],
          exitPoint: [9, 1],
          converged: true,
        },
        allSurfaces: [
          {
            cx: 5,
            cy: 5,
            radius: 5,
            fos: 0.85,
            entryPoint: [1, 4],
            exitPoint: [9, 1],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 50,
      },
    });
    render(<ResultPanel />);
    // Min FOS and Max FOS both show 0.850 — get the first (Min FOS)
    const fosElements = screen.getAllByText("0.850");
    const fosEl = fosElements[0];
    expect(fosEl).toBeInTheDocument();
    expect(fosEl.style.color).toContain("error");
  });

  it("shows warning FOS color for 1.0 ≤ FOS < 1.5", () => {
    useAppStore.setState({
      runState: "done",
      result: {
        minFOS: 1.2,
        maxFOS: 1.2,
        criticalSurface: {
          cx: 5,
          cy: 5,
          radius: 5,
          fos: 1.2,
          entryPoint: [1, 4],
          exitPoint: [9, 1],
          converged: true,
        },
        allSurfaces: [
          {
            cx: 5,
            cy: 5,
            radius: 5,
            fos: 1.2,
            entryPoint: [1, 4],
            exitPoint: [9, 1],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Janbu",
        elapsedMs: 50,
      },
    });
    render(<ResultPanel />);
    // Min FOS and Max FOS both show 1.200 — get the first (Min FOS)
    const fosElements = screen.getAllByText("1.200");
    const fosEl = fosElements[0];
    expect(fosEl.style.color).toContain("warning");
  });

  it("shows convergence warning when non-converged surfaces exist", () => {
    useAppStore.setState({
      runState: "done",
      result: {
        minFOS: 1.5,
        maxFOS: 1.8,
        criticalSurface: {
          cx: 5,
          cy: 5,
          radius: 5,
          fos: 1.5,
          entryPoint: [1, 4],
          exitPoint: [9, 1],
          converged: true,
        },
        allSurfaces: [
          {
            cx: 5,
            cy: 5,
            radius: 5,
            fos: 1.5,
            entryPoint: [1, 4],
            exitPoint: [9, 1],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 100,
        nonConvergedSurfaces: 3,
      },
    });
    render(<ResultPanel />);
    expect(
      screen.getByText(/3 surface\(s\) with weak equilibrium/),
    ).toBeInTheDocument();
  });

  it("shows split failure warning when splits failed", () => {
    useAppStore.setState({
      runState: "done",
      result: {
        minFOS: 1.5,
        maxFOS: 1.8,
        criticalSurface: {
          cx: 5,
          cy: 5,
          radius: 5,
          fos: 1.5,
          entryPoint: [1, 4],
          exitPoint: [9, 1],
          converged: true,
        },
        allSurfaces: [
          {
            cx: 5,
            cy: 5,
            radius: 5,
            fos: 1.5,
            entryPoint: [1, 4],
            exitPoint: [9, 1],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 100,
        splitFailureCount: 2,
      },
    });
    render(<ResultPanel />);
    expect(
      screen.getByText(/2 split operation\(s\) failed/),
    ).toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────

  it("shows error message when in error state", () => {
    useAppStore.setState({
      runState: "error",
      errorMessage: "Analysis timed out after 60 seconds",
    });
    render(<ResultPanel />);
    expect(
      screen.getByText(/Analysis timed out after 60 seconds/),
    ).toBeInTheDocument();
  });
});
