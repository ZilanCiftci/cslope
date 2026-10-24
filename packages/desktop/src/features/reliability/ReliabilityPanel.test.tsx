import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReliabilityResult } from "@cslope/engine";
import { ReliabilityPanel } from "./ReliabilityPanel";
import { useReliabilityStore } from "./store";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_MATERIAL } from "../../store/defaults";

vi.mock("../../utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/download")>()),
  downloadFile: vi.fn(),
}));
import { downloadFile } from "../../utils/download";

const run = vi.fn(async () => {});
const cancel = vi.fn();

function openPanel() {
  act(() => useReliabilityStore.getState().setOpen(true));
  // Replace the actions after opening (setOpen itself calls cancel).
  act(() => useReliabilityStore.setState({ run, cancel }));
}

function taylorResult(over: Partial<ReliabilityResult> = {}): ReliabilityResult {
  return {
    method: "taylor",
    fos: 1.5,
    meanFOS: 1.5,
    sdFOS: 0.2,
    cov: 0.1333,
    betaLognormal: 3.01,
    pfLognormal: 0.0013,
    betaNormal: 2.5,
    terms: [{ variable: 0, mean: 12, sd: 3, fPlus: 1.7, fMinus: 1.3 }],
    surface: {} as ReliabilityResult["surface"],
    failed: 0,
    ...over,
  } as ReliabilityResult;
}

beforeEach(() => {
  useAppStore.getState().newProject();
  // Clay: γ = 18, c = 12, φ = 0.
  useAppStore.setState({ materials: [{ ...DEFAULT_MATERIAL }] });
  run.mockClear();
  cancel.mockClear();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => {
  cleanup();
  act(() => useReliabilityStore.setState({ open: false, result: null, error: null, running: false, labels: [] }));
});

describe("ReliabilityPanel", () => {
  it("renders nothing while closed", () => {
    render(<ReliabilityPanel />);
    expect(screen.queryByText("Probabilistic analysis")).toBeNull();
  });

  it("starts with the first strength value as a random variable with a typical σ", () => {
    render(<ReliabilityPanel />);
    openPanel();
    expect(screen.getByText("Probabilistic analysis")).toBeInTheDocument();
    const variable = screen.getByLabelText("Variable 1") as HTMLSelectElement;
    expect(variable.selectedOptions[0].textContent).toBe("Clay: c (kPa) (12)");
    // σ = 25 % of c = 12.
    expect((screen.getByLabelText("Standard deviation 1") as HTMLInputElement).value).toBe("3");
    // Distribution is fixed for the Taylor series.
    expect(screen.getByLabelText("Distribution 1")).toBeDisabled();
  });

  it("runs the Taylor series with the chosen variables", () => {
    render(<ReliabilityPanel />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(run).toHaveBeenCalledTimes(1);
    const [model, variables, labels, options] = run.mock.calls[0] as unknown as [
      { materials: unknown[] },
      unknown[],
      string[],
      unknown,
    ];
    expect(model.materials).toHaveLength(1);
    expect(variables).toEqual([{ material: 0, field: "cohesion", sd: 3, distribution: "normal" }]);
    expect(labels).toEqual(["Clay: c (kPa)"]);
    expect(options).toEqual({ method: "taylor", search: true });
  });

  it("adds and removes variables, offering each value once", () => {
    render(<ReliabilityPanel />);
    openPanel();
    const add = screen.getByRole("button", { name: "+ Add variable" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getByLabelText("Variable 3")).toBeInTheDocument();
    // γ, c and φ are all used now.
    expect(add).toBeDisabled();
    const second = screen.getByLabelText("Variable 2") as HTMLSelectElement;
    expect([...second.options].map((o) => o.textContent)).toEqual(["Clay: γ (kN/m³) (18)"]);
    // φ = 0 gets σ = 1 instead of 0.
    expect((screen.getByLabelText("Standard deviation 3") as HTMLInputElement).value).toBe("1");

    for (let i = 3; i >= 1; i--) fireEvent.click(screen.getByLabelText(`Remove variable ${i}`));
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("switching the variable resets σ to the new value's default", () => {
    render(<ReliabilityPanel />);
    openPanel();
    const select = screen.getByLabelText("Variable 1");
    const gamma = [...(select as HTMLSelectElement).options].find((o) => o.textContent!.startsWith("Clay: γ"))!;
    fireEvent.change(select, { target: { value: gamma.value } });
    // 5 % of γ = 18 → 0.9.
    expect((screen.getByLabelText("Standard deviation 1") as HTMLInputElement).value).toBe("0.9");
  });

  it("runs Monte Carlo with samples, seed and distribution", () => {
    render(<ReliabilityPanel />);
    openPanel();
    fireEvent.click(screen.getByLabelText("Monte Carlo"));
    expect(screen.getByLabelText("Distribution 1")).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Distribution 1"), { target: { value: "lognormal" } });
    const samples = screen.getByLabelText("Samples");
    fireEvent.change(samples, { target: { value: "500" } });
    fireEvent.blur(samples);
    const seed = screen.getByLabelText("Seed");
    fireEvent.change(seed, { target: { value: "7" } });
    fireEvent.blur(seed);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const [, variables, , options] = run.mock.calls[0] as unknown as [unknown, { distribution: string }[], unknown, unknown];
    expect(variables[0].distribution).toBe("lognormal");
    expect(options).toEqual({ method: "monte-carlo", samples: 500, seed: 7 });
  });

  it("can skip the new search per value in the Taylor series", () => {
    render(<ReliabilityPanel />);
    openPanel();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect((run.mock.calls[0] as unknown[])[3]).toEqual({ method: "taylor", search: false });
  });

  it("shows progress and cancels a running analysis", () => {
    render(<ReliabilityPanel />);
    openPanel();
    act(() => useReliabilityStore.setState({ running: true, progress: 0.42 }));
    expect(screen.getByText("42 %")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("shows Taylor results with β, Pf and the terms, and exports them as CSV", () => {
    render(<ReliabilityPanel />);
    openPanel();
    act(() => useReliabilityStore.setState({ result: taylorResult(), labels: ["Clay: c (kPa)"] }));
    const table = within(screen.getByRole("table", { name: "Probabilistic results" }));
    expect(table.getByText("Reliability index β (lognormal)").nextSibling!.textContent).toBe("3.010");
    expect(table.getByText("Probability of failure (lognormal)").nextSibling!.textContent).toBe("0.13 %");
    expect(table.queryByText("Mean FOS of the samples")).toBeNull();
    const terms = within(screen.getByRole("table", { name: "Taylor series terms" }));
    expect(terms.getByText("Clay: c (kPa)")).toBeInTheDocument();
    expect(terms.getByText("1.700")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "CSV (decimal comma)" }));
    const [filename, data, type] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toBe(`${useAppStore.getState().models[0].name} probabilistic.csv`);
    expect(String(data).startsWith("﻿")).toBe(true);
    expect(String(data)).toContain("Taylor series");
    expect(String(data)).toContain(";");
    expect(type).toBe("text/csv;charset=utf-8");
  });

  it("formats an infinite β and a tiny Pf, and shows Monte Carlo extras", () => {
    render(<ReliabilityPanel />);
    openPanel();
    act(() =>
      useReliabilityStore.setState({
        result: taylorResult({
          method: "monte-carlo",
          terms: undefined,
          betaLognormal: Infinity,
          pfLognormal: 0,
          pf: 0.02,
          meanFOS: 1.48,
          samples: [1.2, 1.4, 1.5, 1.6, 0.9],
          failed: 2,
        }),
        labels: ["Clay: c (kPa)"],
      }),
    );
    const table = within(screen.getByRole("table", { name: "Probabilistic results" }));
    expect(table.getByText("∞ (σ = 0)")).toBeInTheDocument();
    expect(table.getByText("< 0.01 %")).toBeInTheDocument();
    expect(table.getByText("Share of samples with FOS < 1").nextSibling!.textContent).toBe("2.00 %");
    expect(table.getByText("Mean FOS of the samples").nextSibling!.textContent).toBe("1.480");
    expect(table.getByText("Samples without a FOS (left out)").nextSibling!.textContent).toBe("2");
    expect(screen.getByLabelText("Distribution of the FOS")).toBeInTheDocument();
  });

  it("shows errors and notes about partial factors and both directions", () => {
    act(() =>
      useAppStore.setState((s) => ({ options: { ...s.options, partialFactors: { gammaC: 1.5 } as never, bothDirections: true } })),
    );
    render(<ReliabilityPanel />);
    openPanel();
    act(() => useReliabilityStore.setState({ error: "Worker failed" }));
    expect(screen.getByText("Worker failed")).toBeInTheDocument();
    expect(screen.getByText(/Partial factors are applied/)).toBeInTheDocument();
    expect(screen.getByText(/Only the model's own sliding direction/)).toBeInTheDocument();
  });

  it("says so when the model has no material values", () => {
    act(() => useAppStore.setState({ materials: [] }));
    render(<ReliabilityPanel />);
    openPanel();
    expect(screen.getByText("The model has no material values to vary.")).toBeInTheDocument();
  });

  it("closes when another model becomes active", () => {
    render(<ReliabilityPanel />);
    openPanel();
    act(() => useAppStore.setState({ activeModelId: "other" }));
    expect(useReliabilityStore.getState().open).toBe(false);
    expect(screen.queryByText("Probabilistic analysis")).toBeNull();
  });
});
