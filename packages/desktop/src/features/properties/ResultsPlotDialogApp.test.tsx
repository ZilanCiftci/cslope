import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalysisResult, SlipSurfaceResult } from "@cslope/engine";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));
vi.mock("../../utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/download")>()),
  downloadFile: vi.fn(),
}));
import { downloadFile } from "../../utils/download";

import { ResultsPlotDialogApp } from "./ResultsPlotDialogApp";
import { resultDefinition } from "./result-definition";
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
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the main window…");
    expect(
      screen.getByText("Run an analysis first to open results plots."),
    ).toBeInTheDocument();
  });

  it("shows the empty hint when the main window has no result", () => {
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", { model: activeModel(), result: null });
    // Nothing to say once the result is there.
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByText("Run an analysis first to open results plots."),
    ).toBeInTheDocument();
  });

  it("lists surfaces sorted by F with the critical one first", () => {
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
      "Critical – F 1.250",
      "2 – F 1.500",
      "3 – F 1.800",
    ]);
    expect(screen.getByText("F: 1.250")).toBeInTheDocument();
    expect(screen.getByText("Critical surface")).toBeInTheDocument();
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
    expect(screen.getByText("F: 1.500")).toBeInTheDocument();
    expect(screen.getByText("Non-critical surface")).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Y axis" }),
      "sliceWeight",
    );
    expect(screen.getByRole("combobox", { name: "Y axis" })).toHaveValue("sliceWeight");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Y axis" }),
      "frictionAngle",
    );
    expect(screen.getByRole("combobox", { name: "Y axis" })).toHaveValue("frictionAngle");

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
    expect(screen.getByText("F: 1.700")).toBeInTheDocument();
    bridge.emit("onResultsPlotChanged", {
      model,
      result: result([surfaceThroughSlope(model, 1.1)]),
    });
    expect(screen.getByText("F: 1.100")).toBeInTheDocument();
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

  it("shows the F against λ summary with the equilibrium point", async () => {
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
    expect(screen.getByText("λ points: 3")).toBeInTheDocument();
    expect(screen.getByText("Equilibrium λ: 0.2000")).toBeInTheDocument();
    // The axis selectors become fixed labels.
    expect(screen.queryByRole("combobox", { name: "X axis" })).toBeNull();
    expect(screen.getByText("λ")).toBeInTheDocument();
    expect(screen.getByText("F")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "F against λ" })).toBeInTheDocument();

    // A later Bishop result falls back to the slip-surface plot.
    bridge.emit("onResultsPlotChanged", {
      model,
      result: result([surfaceThroughSlope(model, 1.3)], "Bishop"),
    });
    expect(
      (screen.getByRole("combobox", { name: "Plot" }) as HTMLSelectElement).value,
    ).toBe("slipSurface");
    expect(screen.getByText("F: 1.300")).toBeInTheDocument();
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
      screen.getByText(/No values of F against λ are available/),
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

  it("derives slices in the opposite direction when that direction governs", () => {
    // A ridge drawn left-to-right whose steeper left face governs: the
    // critical surface slides left, entry on the crest at the right.
    const model = activeModel();
    model.coordinates = [[0, -15], [0, -10], [10, -10], [20, 0], [30, 0], [40, -10], [50, -10], [50, -15]];
    model.orientation = "ltr";
    const cx = 257 / 26;
    const surface: SlipSurfaceResult = {
      cx,
      cy: 10,
      radius: Math.hypot(25 - cx, 10),
      fos: 1.2,
      entryPoint: [25, 0],
      exitPoint: [12, -8],
    };
    const governing = { ...result([surface]), slidingDirection: "rtl" as const };

    const { slopeDef, orientation } = resultDefinition(model, governing);
    expect(orientation).toBe("rtl");
    // Canonical space of the opposite direction: the model mirrored.
    expect(slopeDef.coordinates[0]).toEqual([50, -15]);

    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", { model, result: governing });
    const slices = screen.getByText(/^Slices: \d+$/);
    expect(Number(slices.textContent!.split(": ")[1])).toBeGreaterThan(0);
  });

  it("keeps the model's own direction when it governs", () => {
    const model = activeModel();
    const own = { ...result([surfaceThroughSlope(model, 1.3)]), slidingDirection: "ltr" as const };
    const { slopeDef, orientation } = resultDefinition(model, own);
    expect(orientation).toBe("ltr");
    expect(slopeDef.coordinates).toEqual(model.coordinates);
  });
});

describe("Export CSV in the Results plot", () => {
  it("is disabled before there is a result", () => {
    render(<ResultsPlotDialogApp />);
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("exports every quantity per slice of the surface shown, and λ, Fm, Ff of the F against λ plot", async () => {
    localStorage.removeItem("cslope-csv-decimal");
    const model = activeModel();
    const surface: SlipSurfaceResult = {
      ...surfaceThroughSlope(model, 1.3),
      lffArray: [
        [0, 1.4, 1.1, 0.3],
        [0.2, 1.31, 1.29, 0.02],
      ],
    };
    render(<ResultsPlotDialogApp />);
    bridge.emit("onResultsPlotState", { model, result: result([surface], "Morgenstern-Price") });
    vi.mocked(downloadFile).mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const [file, data] = vi.mocked(downloadFile).mock.calls[0];
    expect(file).toBe(`${model.name} slices.csv`);
    const lines = String(data).replace("\uFEFF", "").split("\r\n");
    expect(lines[0].startsWith("Slice,x (m),Shear strength (kPa),")).toBe(true);
    expect(lines[0]).toContain("Local F,");
    expect(lines[1].startsWith("1,")).toBe(true);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Plot" }), "lambdaFmFf");
    // With the decimal comma from the menu.
    await userEvent.click(screen.getByRole("button", { name: "CSV decimal separator" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Decimal comma (1,5)" }));
    const [file2, data2] = vi.mocked(downloadFile).mock.calls[1];
    expect(file2).toBe(`${model.name} F against lambda.csv`);
    expect(String(data2)).toBe("\uFEFFλ;Fm;Ff\r\n0;1,4;1,1\r\n0,2;1,31;1,29\r\n");
  });
});
