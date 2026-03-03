import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import type { AnalysisResult } from "../store/types";

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
  it("shows EDIT mode indicator", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByText("EDIT")).toBeInTheDocument();
  });

  it("shows RESULT mode indicator", () => {
    render(<StatusBar {...defaultProps} mode="result" />);
    expect(screen.getByText("RESULT")).toBeInTheDocument();
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

  it("shows Analysing indicator when running", () => {
    render(<StatusBar {...defaultProps} runState="running" />);
    expect(screen.getByText("Analysing...")).toBeInTheDocument();
  });

  it("does not show result or analysing when idle", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.queryByText("Analysing...")).not.toBeInTheDocument();
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

  it("shows version info", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByText("cSlope v0.1")).toBeInTheDocument();
  });
});
