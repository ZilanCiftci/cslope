import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar } from "./TabBar";

const noop = () => {};

const defaultProps = {
  mode: "edit" as const,
  setMode: noop as (mode: "edit" | "result") => void,
  runState: "idle" as const,
  hasResult: false,
  onRun: noop,
  onCancel: noop,
  onRunAll: noop,
};

describe("TabBar", () => {
  it("renders Edit and Results tabs", () => {
    render(<TabBar {...defaultProps} />);
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
  });

  it("shows Run button when idle", () => {
    render(<TabBar {...defaultProps} />);
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(
      screen.getByTitle("Run analysis and view results"),
    ).toBeInTheDocument();
  });

  it("shows Cancel button when running", () => {
    render(<TabBar {...defaultProps} runState="running" />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByTitle("Cancel running analysis")).toBeInTheDocument();
  });

  it("calls onRun when Run button is clicked", () => {
    const onRun = vi.fn();
    render(<TabBar {...defaultProps} onRun={onRun} />);
    fireEvent.click(screen.getByTitle("Run analysis and view results"));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<TabBar {...defaultProps} runState="running" onCancel={onCancel} />);
    fireEvent.click(screen.getByTitle("Cancel running analysis"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("switches to edit mode when Edit tab is clicked", () => {
    const setMode = vi.fn();
    render(<TabBar {...defaultProps} mode="result" setMode={setMode} />);
    fireEvent.click(screen.getByText("Edit"));
    expect(setMode).toHaveBeenCalledWith("edit");
  });

  it("switches to result mode when Results tab is clicked with result", () => {
    const setMode = vi.fn();
    render(<TabBar {...defaultProps} hasResult={true} setMode={setMode} />);
    fireEvent.click(screen.getByText("Results"));
    expect(setMode).toHaveBeenCalledWith("result");
  });

  it("does not switch to result mode when no result", () => {
    const setMode = vi.fn();
    render(<TabBar {...defaultProps} hasResult={false} setMode={setMode} />);
    fireEvent.click(screen.getByText("Results"));
    expect(setMode).not.toHaveBeenCalled();
  });

  it("disables run menu dropdown when running", () => {
    render(<TabBar {...defaultProps} runState="running" />);
    const menuBtn = screen.getByLabelText("Run menu");
    expect(menuBtn).toBeDisabled();
  });

  it("shows Run all option in dropdown menu", async () => {
    const user = userEvent.setup();
    const onRunAll = vi.fn();
    render(<TabBar {...defaultProps} onRunAll={onRunAll} />);
    const menuBtn = screen.getByLabelText("Run menu");
    await user.click(menuBtn);
    const runAllBtn = screen.getByText("Run all");
    expect(runAllBtn).toBeInTheDocument();
    await user.click(runAllBtn);
    expect(onRunAll).toHaveBeenCalledOnce();
  });

  it("shows result indicator dot when results are available but not viewing", () => {
    const { container } = render(
      <TabBar {...defaultProps} mode="edit" hasResult={true} />,
    );
    // Look for the green dot indicator
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots.length).toBeGreaterThan(0);
  });
});
