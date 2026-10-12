import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalysisResult, SlipSurfaceResult } from "@cslope/engine";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { ResultsPlotDialogApp } from "./ResultsPlotDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { ModelEntry } from "../../store/types";

let bridge: FakeBridge;

function activeModel(): ModelEntry {
  const s = useAppStore.getState();
  return structuredClone(s.models.find((m) => m.id === s.activeModelId)!);
}

/** A circle through the toe and the crest of the default model. */
function surfaceThroughSlope(model: ModelEntry, fos: number, dr = 0): SlipSurfaceResult {
  const xs = model.coordinates.map((c) => c[0]);
  const ys = model.coordinates.map((c) => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys);
  const entry: [number, number] = [xMin + (xMax - xMin) * 0.25, yMax];
  const exit: [number, number] = [xMin + (xMax - xMin) * 0.75, yMax];
  const cx = (entry[0] + exit[0]) / 2;
  const radius = (exit[0] - entry[0]) * 0.8 + dr;
  const cy = yMax + Math.sqrt(radius ** 2 - ((exit[0] - entry[0]) / 2) ** 2);
  return { cx, cy, radius, fos, entryPoint: entry, exitPoint: exit };
}

function result(
  surfaces: SlipSurfaceResult[],
  method: AnalysisResult["method"] = "Bishop",
): AnalysisResult {
  const critical = [...surfaces].sort((a, b) => a.fos - b.fos)[0];
  return {
    minFOS: critical.fos,
    maxFOS: Math.max(...surfaces.map((s) => s.fos)),
    criticalSurface: critical,
    allSurfaces: surfaces,
    criticalSlices: [],
    method,
    elapsedMs: 1,
  };
}

beforeEach(() => {
  useAppStore.getState().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("ResultsPlotDialogApp", () => {
  it("waits for state and asks the main window for it", () => {
    render(<ResultsPlotDialogApp />);
    expect(bridge.callNames()).toContain("requestResultsPlotState");
    expect(screen.getByText("Waiting for state")).toBeInTheDocument();
    expect(
      screen.getByText("Run an analysis first to open results plots."),
    ).toBeInTheDocument();
  });

  it("shows the empty hint when the main window has no result", () => {
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", { model: activeModel(), result: null });
    expect(screen.getByText("Synced")).toBeInTheDocument();
    expect(
      screen.getByText("Run an analysis first to open results plots."),
    ).toBeInTheDocument();
  });

  it("lists surfaces sorted by FoS with the critical one first", () => {
    const model = activeModel();
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", {
      model,
      result: result([
        surfaceThroughSlope(model, 1.8, 1),
        surfaceThroughSlope(model, 1.25),
        surfaceThroughSlope(model, 1.5, 2),
      ]),
    });
    const surfaceSelect = screen.getByRole("combobox", { name: "Slip surface" });
    const labels = Array.from(
      (surfaceSelect as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    expect(labels).toEqual([
      "Critical - FoS 1.2500",
      "2 - FoS 1.5000",
      "3 - FoS 1.8000",
    ]);
    expect(screen.getByText("FoS: 1.2500")).toBeInTheDocument();
    expect(screen.getByText("Critical surface")).toBeInTheDocument();
    expect(screen.getByText("Metric unit: kPa")).toBeInTheDocument();
    // The slices of the default model are derived for the surface.
    const slices = screen.getByText(/^Slices: \d+$/);
    expect(Number(slices.textContent!.split(": ")[1])).toBeGreaterThan(0);
    expect(
      screen.queryByText("Unable to derive slice values for the selected surface."),
    ).toBeNull();
  });

  it("switches surface, metric and axis", async () => {
    const model = activeModel();
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", {
      model,
      result: result([surfaceThroughSlope(model, 1.25), surfaceThroughSlope(model, 1.5, 2)]),
    });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Slip surface" }),
      "1",
    );
    expect(screen.getByText("FoS: 1.5000")).toBeInTheDocument();
    expect(screen.getByText("Non-critical surface")).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Y axis" }),
      "sliceWeight",
    );
    expect(screen.getByText("Metric unit: kN")).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Y axis" }),
      "frictionAngle",
    );
    expect(screen.getByText("Metric unit: deg")).toBeInTheDocument();

    const xAxis = screen.getByRole("combobox", { name: "X axis" }) as HTMLSelectElement;
    await userEvent.selectOptions(xAxis, "x");
    expect(xAxis.value).toBe("x");
  });

  it("clamps the surface selection when a new result has fewer surfaces", async () => {
    const model = activeModel();
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", {
      model,
      result: result([
        surfaceThroughSlope(model, 1.25),
        surfaceThroughSlope(model, 1.5, 1),
        surfaceThroughSlope(model, 1.7, 2),
      ]),
    });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Slip surface" }),
      "2",
    );
    expect(screen.getByText("FoS: 1.7000")).toBeInTheDocument();
    bridge.emit("onResultsPlotChanged", {
      model,
      result: result([surfaceThroughSlope(model, 1.1)]),
    });
    expect(screen.getByText("FoS: 1.1000")).toBeInTheDocument();
  });

  it("offers the lambda plot only for Morgenstern-Price runs", async () => {
    const model = activeModel();
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", {
      model,
      result: result([surfaceThroughSlope(model, 1.25)], "Bishop"),
    });
    const plot = screen.getByRole("combobox", { name: "Plot" }) as HTMLSelectElement;
    const lambdaOption = Array.from(plot.options).find(
      (o) => o.value === "lambdaFmFf",
    )!;
    expect(lambdaOption.disabled).toBe(true);
  });

  it("shows the lambda vs Fm/Ff summary with the equilibrium point", async () => {
    const model = activeModel();
    const surface: SlipSurfaceResult = {
      ...surfaceThroughSlope(model, 1.3),
      lffArray: [
        [0.4, 1.35, 1.2, 0.15],
        [0, 1.4, 1.1, 0.3],
        [0.2, 1.31, 1.29, 0.02],
      ],
    };
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", {
      model,
      result: result([surface], "Morgenstern-Price"),
    });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Plot" }),
      "lambdaFmFf",
    );
    expect(screen.getByText("Method: Morgenstern-Price")).toBeInTheDocument();
    expect(screen.getByText("Lambda points: 3")).toBeInTheDocument();
    expect(screen.getByText("Equilibrium λ: 0.2000")).toBeInTheDocument();
    // The axis selectors become fixed labels.
    expect(screen.queryByRole("combobox", { name: "X axis" })).toBeNull();
    expect(screen.getByText("Lambda")).toBeInTheDocument();
    expect(screen.getByText("Factor of Safety")).toBeInTheDocument();

    // A later Bishop result falls back to the slip-surface plot.
    bridge.emit("onResultsPlotChanged", {
      model,
      result: result([surfaceThroughSlope(model, 1.3)], "Bishop"),
    });
    expect(
      (screen.getByRole("combobox", { name: "Plot" }) as HTMLSelectElement).value,
    ).toBe("slipSurface");
    expect(screen.getByText("FoS: 1.3000")).toBeInTheDocument();
  });

  it("explains when a Morgenstern-Price surface has no lambda data", async () => {
    const model = activeModel();
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", {
      model,
      result: result([surfaceThroughSlope(model, 1.3)], "Morgenstern-Price"),
    });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Plot" }),
      "lambdaFmFf",
    );
    expect(
      screen.getByText(/No Lambda vs Fm\/Ff data is available/),
    ).toBeInTheDocument();
    expect(screen.getByText("Equilibrium λ: -")).toBeInTheDocument();
  });

  it("reports when slices cannot be derived for the surface", () => {
    const model = activeModel();
    model.coordinates = [];
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", {
      model,
      result: result([{ ...surfaceThroughSlope(activeModel(), 1.3) }]),
    });
    expect(screen.getByText("Slices: 0")).toBeInTheDocument();
    expect(
      screen.getByText("Unable to derive slice values for the selected surface."),
    ).toBeInTheDocument();
  });

  it("derives slices in model space for a right-to-left model", () => {
    const model = activeModel();
    const xs = model.coordinates.map((c) => c[0]);
    const span = Math.min(...xs) + Math.max(...xs);
    model.coordinates = model.coordinates.map(([x, y]) => [span - x, y]);
    model.orientation = "rtl";
    // In a right-to-left model the entry point lies on the right.
    const ltr = surfaceThroughSlope(model, 1.3);
    const surface = { ...ltr, entryPoint: ltr.exitPoint, exitPoint: ltr.entryPoint };
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", { model, result: result([surface]) });
    const slices = screen.getByText(/^Slices: \d+$/);
    expect(Number(slices.textContent!.split(": ")[1])).toBeGreaterThan(0);
  });
});
