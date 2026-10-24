import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "../../store/app-store";
import { AnalysisErrorBanner } from "./AnalysisErrorBanner";
import { isNoSlipSurfaceError } from "./analysis-error";

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
    expect(screen.queryByRole("button", { name: "Search limits…" })).toBeNull();
  });

  it("is left to the results sidebar in results mode", () => {
    useAppStore.setState({ mode: "result" });
    render(<AnalysisErrorBanner />);
    fail(NO_SURFACE);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens the search limits when no slip surface was found", () => {
    render(<AnalysisErrorBanner />);
    fail(NO_SURFACE);
    fireEvent.click(screen.getByRole("button", { name: "Search limits…" }));
    expect(useAppStore.getState().activeSection).toBe("Search Limits");
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

  it("recognises the no-slip-surface error", () => {
    expect(isNoSlipSurfaceError(NO_SURFACE)).toBe(true);
    expect(isNoSlipSurfaceError("No valid slip surface at the mean values.")).toBe(true);
    expect(isNoSlipSurfaceError("Reinforcement spacing must be > 0.")).toBe(false);
    expect(isNoSlipSurfaceError(null)).toBe(false);
  });
});
