import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "../../store/app-store";
import { AnalysisErrorBanner } from "./AnalysisErrorBanner";
import { LimitsDirectionWarning } from "./LimitsDirectionWarning";
import { isNoSlipSurfaceError, limitsDirectionMismatch } from "./analysis-error";

const NO_SURFACE =
  "No valid slip surface was found. Check the search limits, the geometry and the material strengths.";

function fail(message: string) {
  act(() => useAppStore.setState({ runState: "error", errorMessage: message }));
}

describe("AnalysisErrorBanner", () => {
  beforeEach(() => {
    useAppStore.setState({
      mode: "edit",
      runState: "idle",
      errorMessage: null,
      activeSection: null,
      orientation: "ltr",
      analysisLimits: { enabled: false, entryLeftX: 0, entryRightX: 0, exitLeftX: 0, exitRightX: 0 },
    });
  });

  it("shows nothing until a run fails", () => {
    render(<AnalysisErrorBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error of a failed run in edit mode", () => {
    render(<AnalysisErrorBanner />);
    fail("Coordinates must have at least 3 points");
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Analysis failed");
    expect(banner).toHaveTextContent("Coordinates must have at least 3 points");
    // Not about the search: no shortcut to the search limits.
    expect(screen.queryByRole("button", { name: "Search limits" })).toBeNull();
  });

  it("shows in results mode too, as soon as the run fails", () => {
    useAppStore.setState({ mode: "result" });
    render(<AnalysisErrorBanner />);
    fail(NO_SURFACE);
    expect(screen.getByRole("alert")).toHaveTextContent("Analysis failed");
  });

  it("says when the search limits are drawn for the other direction, and turns it round", () => {
    useAppStore.getState().setOrientation("rtl");
    useAppStore.getState().setAnalysisLimits({ enabled: true, entryLeftX: -13, entryRightX: -4.5, exitLeftX: -3, exitRightX: 1 });
    render(<AnalysisErrorBanner />);
    fail(NO_SURFACE);
    expect(screen.getByTestId("limits-direction-hint")).toHaveTextContent("left of the exit range");
    // The specific cause comes before the general message.
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text.indexOf("left of the exit range")).toBeLessThan(text.indexOf("No valid slip surface"));
    fireEvent.click(screen.getByRole("button", { name: "Use left to right" }));
    expect(useAppStore.getState().orientation).toBe("ltr");
    expect(screen.queryByTestId("limits-direction-hint")).toBeNull();
  });

  it("opens the search limits when no slip surface was found, and selects them on the canvas", () => {
    useAppStore.getState().setAnalysisLimits({ enabled: true });
    render(<AnalysisErrorBanner />);
    fail(NO_SURFACE);
    fireEvent.click(screen.getByRole("button", { name: "Search limits" }));
    expect(useAppStore.getState().canvasSelection).toEqual({ object: { type: "searchLimits" }, point: null });
  });

  it("stays dismissed until the next run", () => {
    render(<AnalysisErrorBanner />);
    fail(NO_SURFACE);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => useAppStore.setState({ mode: "result" }));
    act(() => useAppStore.setState({ mode: "edit" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => useAppStore.setState({ runState: "running", errorMessage: null }));
    fail(NO_SURFACE);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows again after a new run that fails at once with the same error", () => {
    render(<AnalysisErrorBanner />);
    fail(NO_SURFACE);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    // "running" and "error" in one store update batch, as runAnalysis does
    // when the inputs can't be built: no render sees "running".
    act(() => {
      useAppStore.setState({ runState: "running", errorMessage: null });
      useAppStore.setState({ runState: "error", errorMessage: NO_SURFACE });
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("recognises the no-slip-surface error", () => {
    expect(isNoSlipSurfaceError(NO_SURFACE)).toBe(true);
    expect(isNoSlipSurfaceError("No valid slip surface at the mean values.")).toBe(true);
    expect(isNoSlipSurfaceError("Reinforcement spacing must be > 0.")).toBe(false);
    expect(isNoSlipSurfaceError(null)).toBe(false);
  });
});

describe("limitsDirectionMismatch", () => {
  const limits = (entry: [number, number], exit: [number, number]) => ({
    enabled: true, entryLeftX: entry[0], entryRightX: entry[1], exitLeftX: exit[0], exitRightX: exit[1],
  });
  it("names the direction the limits are drawn for when it is not the model's", () => {
    expect(limitsDirectionMismatch(limits([-13, -4.5], [-3, 1]), "rtl")).toBe("ltr");
    expect(limitsDirectionMismatch(limits([5, 10], [-3, 1]), "ltr")).toBe("rtl");
  });
  it("is null when they agree, overlap or are off", () => {
    expect(limitsDirectionMismatch(limits([-13, -4.5], [-3, 1]), "ltr")).toBeNull();
    expect(limitsDirectionMismatch(limits([-5, 0], [-3, 1]), "rtl")).toBeNull();
    expect(limitsDirectionMismatch({ ...limits([-13, -4.5], [-3, 1]), enabled: false }, "rtl")).toBeNull();
  });
});

describe("LimitsDirectionWarning", () => {
  it("warns before a run and turns the direction round", () => {
    useAppStore.getState().setOrientation("rtl");
    useAppStore.getState().setAnalysisLimits({ enabled: true, entryLeftX: -13, entryRightX: -4.5, exitLeftX: -3, exitRightX: 1 });
    render(<LimitsDirectionWarning />);
    expect(screen.getByTestId("limits-direction-warning")).toHaveTextContent("No slip surface will be found");
    fireEvent.click(screen.getByRole("button", { name: "Use left to right" }));
    expect(useAppStore.getState().orientation).toBe("ltr");
    expect(screen.queryByTestId("limits-direction-warning")).toBeNull();
  });
});
