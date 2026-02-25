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

  it("renders the title bar", () => {
    render(<App />);
    expect(screen.getByText("File")).toBeInTheDocument();
  });

  it("renders Edit and Results mode tabs", () => {
    render(<App />);
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
  });

  it("renders the Run button in the tab bar", () => {
    render(<App />);
    const button = screen.getByTitle("Run analysis and view results");
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("renders the activity bar with explorer & properties toggles", () => {
    render(<App />);
    expect(screen.getByLabelText("Toggle models")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle properties")).toBeInTheDocument();
  });

  it("shows the explorer sidebar by default", () => {
    render(<App />);
    // Explorer (Models) shows the model names
    expect(screen.getAllByText("Untitled").length).toBeGreaterThanOrEqual(1);
  });

  it("can toggle explorer open/closed", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByLabelText("Toggle models");
    // Explorer sidebar should be visible initially
    const explorerModels = screen.getAllByText("Untitled");
    expect(explorerModels.length).toBeGreaterThanOrEqual(2); // title bar + explorer
    // Close explorer
    await user.click(toggle);
    // Only title bar "Untitled" should remain
    const afterClose = screen.getAllByText("Untitled");
    expect(afterClose).toHaveLength(1);
    // Re-open
    await user.click(toggle);
    const afterOpen = screen.getAllByText("Untitled");
    expect(afterOpen.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the interactive canvas in edit mode", () => {
    render(<App />);
    expect(screen.getByTestId("slope-canvas")).toBeInTheDocument();
  });

  it("renders the status bar with mode and point count", () => {
    render(<App />);
    expect(screen.getByText("EDIT")).toBeInTheDocument();
    expect(screen.getByText(/Points: 6/)).toBeInTheDocument();
  });

  it("shows properties panel sections in sidebar", () => {
    render(<App />);
    // PropertiesPanel has collapsible sections
    expect(screen.getByText("Exterior Boundary")).toBeInTheDocument();
    // "Materials" may appear in both explorer and properties — just check at least one
    expect(screen.getAllByText("Materials").length).toBeGreaterThanOrEqual(1);
  });
});
