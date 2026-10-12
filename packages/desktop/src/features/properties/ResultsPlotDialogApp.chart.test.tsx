import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalysisResult, SlipSurfaceResult } from "@cslope/engine";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));
// jsdom has no layout: give the charts a fixed size so axes are drawn.
vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactNode }) =>
    isValidElement(children)
      ? cloneElement(children as React.ReactElement<{ width: number; height: number }>, {
          width: 600,
          height: 400,
        })
      : null,
}));

import { ResultsPlotDialogApp } from "./ResultsPlotDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { ModelEntry } from "../../store/types";

let bridge: FakeBridge;

function activeModel(): ModelEntry {
  const s = useAppStore.getState();
  return structuredClone(s.models.find((m) => m.id === s.activeModelId)!);
}

function surface(model: ModelEntry, fos: number): SlipSurfaceResult {
  const xs = model.coordinates.map((c) => c[0]);
  const ys = model.coordinates.map((c) => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys);
  const entry: [number, number] = [xMin + (xMax - xMin) * 0.25, yMax];
  const exit: [number, number] = [xMin + (xMax - xMin) * 0.75, yMax];
  const radius = (exit[0] - entry[0]) * 0.8;
  const cy = yMax + Math.sqrt(radius ** 2 - ((exit[0] - entry[0]) / 2) ** 2);
  return { cx: (entry[0] + exit[0]) / 2, cy, radius, fos, entryPoint: entry, exitPoint: exit };
}

function result(s: SlipSurfaceResult, method: AnalysisResult["method"]): AnalysisResult {
  return {
    minFOS: s.fos,
    maxFOS: s.fos,
    criticalSurface: s,
    allSurfaces: [s],
    criticalSlices: [],
    method,
    elapsedMs: 1,
  };
}

/** Text of the SVG tick labels of the chart. */
const tickTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".recharts-cartesian-axis-tick-value")).map(
    (t) => t.textContent ?? "",
  );

/** Axis titles drawn in the SVG. */
const axisLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("svg .recharts-label")).map(
    (t) => t.textContent ?? "",
  );

beforeEach(() => {
  useAppStore.getState().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("ResultsPlotDialogApp charts", () => {
  it("labels the slip surface plot axes with the metric and unit", async () => {
    const model = activeModel();
    const { container } = render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", { model, result: result(surface(model, 1.3), "Bishop") });
    expect(axisLabels(container)).toEqual(
      expect.arrayContaining(["Slice number", "Shear strength (kPa)"]),
    );
    // Both axes are drawn with ticks.
    const ticks = tickTexts(container);
    expect(ticks.length).toBeGreaterThan(2);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Y axis" }), "pwp");
    expect(axisLabels(container)).toContain("PWP (kN)");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "X axis" }), "x");
    expect(axisLabels(container)).toContain("X value");
    // x spans more than 2 m: whole-metre ticks.
    const xTicks = tickTexts(container).filter((t) => /^-?\d+$/.test(t));
    expect(xTicks.length).toBeGreaterThan(1);
  });

  it("draws Fm and Ff against lambda with the equilibrium point", async () => {
    const model = activeModel();
    const s: SlipSurfaceResult = {
      ...surface(model, 1.3),
      lffArray: [
        [0, 1.4, 1.1, 0.3],
        [0.2, 1.31, 1.29, 0.02],
        [0.4, 1.35, 1.2, 0.15],
      ],
    };
    const { container } = render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", { model, result: result(s, "Morgenstern-Price") });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Plot" }), "lambdaFmFf");
    expect(screen.getByText("Moment (Fm)")).toBeInTheDocument();
    expect(screen.getByText("Force (Ff)")).toBeInTheDocument();
    // Lambda ticks are shown with three decimals.
    expect(tickTexts(container).some((t) => /^0\.\d{3}$/.test(t))).toBe(true);
    expect(container.querySelector(".recharts-reference-line")).not.toBeNull();
  });

  it("pads the lambda axis when all points share one lambda", async () => {
    const model = activeModel();
    const s: SlipSurfaceResult = { ...surface(model, 1.3), lffArray: [[0.3, 1.3, 1.3, 0]] };
    const { container } = render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", { model, result: result(s, "Morgenstern-Price") });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Plot" }), "lambdaFmFf");
    expect(screen.getByText("Lambda points: 1")).toBeInTheDocument();
    expect(screen.getByText("Equilibrium λ: 0.3000")).toBeInTheDocument();
    expect(tickTexts(container).length).toBeGreaterThan(0);
  });
});
