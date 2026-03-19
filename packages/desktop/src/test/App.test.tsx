import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { useAppStore } from "../store/app-store";

describe("App — VS Code dark layout", () => {
  beforeEach(() => {
    // Reset Zustand store between tests
    const initial = useAppStore.getState();
    useAppStore.setState({
      mode: "edit",
      explorerOpen: true,
      sidebarOpen: true,
      runState: "idle",
      progress: 0,
      result: null,
      errorMessage: null,
      coordinates: initial.coordinates,
    });
  });

  it("renders the title bar with current model name", () => {
    render(<App />);
    expect(screen.getByText("File")).toBeInTheDocument();
    // Title bar displays model name — use substring match to avoid coupling
    // to the exact format "Untitled — cSlope"
    expect(screen.getByText(/— cSlope$/)).toBeInTheDocument();
  });

  it("renders Edit and Results mode tabs", () => {
    render(<App />);
    expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Results").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Run button in the tab bar", () => {
    render(<App />);
    const button = screen.getByTitle("Run analysis and view results");
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("renders the activity bar with models toggle", () => {
    render(<App />);
    expect(screen.getByLabelText("Toggle models")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Toggle properties"),
    ).not.toBeInTheDocument();
  });

  it("shows the explorer sidebar by default", () => {
    render(<App />);
    // Explorer model row has aria-label matching the model name
    expect(screen.getByLabelText("Untitled")).toBeInTheDocument();
  });

  it("can toggle explorer open/closed", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByLabelText("Toggle models");
    // Explorer sidebar should be visible initially — model row has aria-label
    expect(screen.getByLabelText("Untitled")).toBeInTheDocument();
    // Close explorer
    await user.click(toggle);
    // Model row should no longer be present
    expect(screen.queryByLabelText("Untitled")).not.toBeInTheDocument();
    // Re-open
    await user.click(toggle);
    expect(screen.getByLabelText("Untitled")).toBeInTheDocument();
  });

  it("renders the interactive canvas in edit mode", () => {
    render(<App />);
    expect(screen.getByTestId("slope-canvas")).toBeInTheDocument();
  });

  it("renders the status bar with mode and point count", () => {
    render(<App />);
    expect(screen.getByText("EDIT")).toBeInTheDocument();
    const pointCount = useAppStore.getState().coordinates.length;
    expect(
      screen.getByText(new RegExp(`Points: ${pointCount}`)),
    ).toBeInTheDocument();
  });

  it("does not show properties sidebar in edit mode", () => {
    render(<App />);
    expect(
      screen.queryByText("Analysis controls moved"),
    ).not.toBeInTheDocument();
  });

  // ── Running / error / result states ──────────────────────────────────

  it("shows cancel button and analysing indicator when running", () => {
    useAppStore.setState({ runState: "running", progress: 0.4 });
    render(<App />);
    // TabBar should show a Cancel button when running
    const cancelBtn = screen.getByTitle("Cancel running analysis");
    expect(cancelBtn).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    // StatusBar shows "Analysing..."
    expect(screen.getByText("Analysing...")).toBeInTheDocument();
  });

  it("shows FOS result in status bar when analysis is done", () => {
    useAppStore.setState({
      mode: "result",
      runState: "done",
      result: {
        minFOS: 1.234,
        maxFOS: 1.6,
        criticalSurface: {
          cx: 10,
          cy: 12,
          radius: 10,
          fos: 1.234,
          entryPoint: [2, 8],
          exitPoint: [18, 2],
          converged: true,
        },
        allSurfaces: [
          {
            cx: 10,
            cy: 12,
            radius: 10,
            fos: 1.234,
            entryPoint: [2, 8],
            exitPoint: [18, 2],
            converged: true,
          },
        ],
        criticalSlices: [],
        method: "Bishop",
        elapsedMs: 100,
      },
    });
    render(<App />);
    // StatusBar displays FOS and method
    expect(screen.getByText("1.234")).toBeInTheDocument();
    expect(screen.getByText(/(Bishop)/)).toBeInTheDocument();
    // Status bar shows RESULT mode
    expect(screen.getByText("RESULT")).toBeInTheDocument();
  });

  it("disables run-all menu when analysis is running", () => {
    useAppStore.setState({ runState: "running" });
    render(<App />);
    const runMenu = screen.getByLabelText("Run menu");
    expect(runMenu).toBeDisabled();
  });
});
