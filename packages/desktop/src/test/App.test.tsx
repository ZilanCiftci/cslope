import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { useAppStore } from "../store/app-store";

describe("App — VS Code dark layout", () => {
  const getActiveModelName = () => {
    const state = useAppStore.getState();
    return (
      state.models.find((m) => m.id === state.activeModelId)?.name ??
      "Model 1"
    );
  };

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
    // to the exact format "<model> — cSlope"
    expect(screen.getByText(/— cSlope$/)).toBeInTheDocument();
  });

  it("renders Edit and Results mode tabs", () => {
    render(<App />);
    expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Results").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Run button in the floating toolbar", () => {
    render(<App />);
    const button = screen.getByTitle("Run analysis and view results");
    expect(button).toBeInTheDocument();
  });

  it("has no activity bar: each panel carries its own collapse button", () => {
    render(<App />);
    expect(screen.queryByLabelText("Toggle models")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Collapse models")).toBeInTheDocument();
    // The results panel exists in result mode only.
    expect(screen.queryByLabelText("Collapse results")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Open results")).not.toBeInTheDocument();
  });

  it("shows the explorer sidebar by default", () => {
    render(<App />);
    // Explorer model row has aria-label matching the model name
    expect(screen.getByLabelText(getActiveModelName())).toBeInTheDocument();
  });

  it("collapses the explorer to a strip and opens it again", async () => {
    const user = userEvent.setup();
    render(<App />);
    const modelName = getActiveModelName();
    expect(screen.getByLabelText(modelName)).toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-models")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Collapse models"));
    expect(useAppStore.getState().explorerOpen).toBe(false);
    expect(screen.queryByLabelText(modelName)).not.toBeInTheDocument();
    // The strip stands where the panel was, with its name along it.
    const strip = screen.getByTestId("collapsed-models");
    expect(within(strip).getByText("Models")).toBeInTheDocument();

    await user.click(within(strip).getByLabelText("Open models"));
    expect(useAppStore.getState().explorerOpen).toBe(true);
    expect(screen.getByLabelText(modelName)).toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-models")).not.toBeInTheDocument();
  });

  it("collapses and opens the results panel in result mode", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ mode: "result" });
    render(<App />);
    await user.click(screen.getByLabelText("Collapse results"));
    expect(useAppStore.getState().sidebarOpen).toBe(false);
    const strip = screen.getByTestId("collapsed-results");
    expect(within(strip).getByText("Results")).toBeInTheDocument();
    await user.click(within(strip).getByLabelText("Open results"));
    expect(useAppStore.getState().sidebarOpen).toBe(true);
    expect(screen.getByLabelText("Collapse results")).toBeInTheDocument();
    expect(screen.queryByTestId("collapsed-results")).not.toBeInTheDocument();
  });

  it("keeps the explorer on the right, open or collapsed", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ explorerLocation: "right" });
    try {
      render(<App />);
      const canvas = screen.getByTestId("slope-canvas");
      const after = (el: HTMLElement) =>
        Boolean(canvas.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(after(screen.getByTestId("panel-header-models"))).toBe(true);
      await user.click(screen.getByLabelText("Collapse models"));
      expect(after(screen.getByTestId("collapsed-models"))).toBe(true);
      await user.click(screen.getByLabelText("Open models"));
      expect(after(screen.getByTestId("panel-header-models"))).toBe(true);
    } finally {
      useAppStore.setState({ explorerLocation: "left" });
    }
  });

  it("moves the explorer from the panel header's context menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    try {
      await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("panel-header-models") });
      await user.click(screen.getByRole("menuitem", { name: "Move panel to the right" }));
      expect(useAppStore.getState().explorerLocation).toBe("right");
      expect(screen.queryByRole("menuitem", { name: /Move panel/ })).not.toBeInTheDocument();
    } finally {
      useAppStore.setState({ explorerLocation: "left" });
    }
  });

  it("renders the interactive canvas in edit mode", () => {
    render(<App />);
    expect(screen.getByTestId("slope-canvas")).toBeInTheDocument();
  });

  it("renders the status bar with mode and point count", () => {
    render(<App />);
    expect(within(screen.getByTestId("status-bar")).getByText("Edit")).toBeInTheDocument();
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
    // FloatingToolbar should show a Cancel button when running
    const cancelBtn = screen.getByTitle("Cancel running analysis");
    expect(cancelBtn).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    // StatusBar shows "Analyzing"
    expect(screen.getByText("Analyzing")).toBeInTheDocument();
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
    // StatusBar displays FOS and method. The FOS value also appears in the
    // result sidebar summary, so scope the query to the status bar.
    const statusBar = within(screen.getByTestId("status-bar"));
    expect(statusBar.getByText("1.234")).toBeInTheDocument();
    expect(statusBar.getByText(/\(Bishop\)/)).toBeInTheDocument();
    // Status bar shows the Result mode
    expect(statusBar.getByText("Result")).toBeInTheDocument();
  });

  it("disables run-all menu when analysis is running", () => {
    useAppStore.setState({ runState: "running" });
    render(<App />);
    const runMenu = screen.getByTitle("More run options");
    expect(runMenu).toBeDisabled();
  });
});
