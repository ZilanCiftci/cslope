import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReliabilityResult } from "@cslope/engine";
import { ReliabilityWindow } from "./ReliabilityDialogApp";
import { useReliabilityStore } from "./store";
import { reliabilityWindowState, type ReliabilityCommand } from "./window-sync";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_MATERIAL } from "../../store/defaults";

vi.mock("../../utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/download")>()),
  downloadFile: vi.fn(),
}));
import { downloadFile } from "../../utils/download";

const run = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const cancel = vi.fn();

/** The window with the state the main window would send it; its commands go to the spies. */
function Harness() {
  useAppStore((s) => s);
  useReliabilityStore((s) => s);
  const state = reliabilityWindowState();
  const onCommand = (c: ReliabilityCommand) =>
    c.type === "run" ? void run(state.model, c.variables, c.labels, c.options) : cancel();
  return <ReliabilityWindow state={state} onCommand={onCommand} />;
}

const renderWindow = () => render(<Harness />);

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
  act(() => useReliabilityStore.setState({ result: null, error: null, running: false, labels: [] }));
});

describe("Probabilistic analysis window", () => {
  it("waits for the main window", () => {
    render(<ReliabilityWindow state={null} onCommand={() => {}} />);
    expect(screen.getByText("Probabilistic analysis")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the main window");
  });

  it("starts with the first strength value as a random variable with a typical σ", () => {
    renderWindow();
    expect(screen.getByText("Probabilistic analysis")).toBeInTheDocument();
    const variable = screen.getByLabelText("Variable 1") as HTMLSelectElement;
    expect(variable.selectedOptions[0].textContent).toBe("Clay: c (kPa), mean 12");
    // σ = 25 % of c = 12.
    expect((screen.getByLabelText("Standard deviation 1") as HTMLInputElement).value).toBe("3");
    // Distribution is fixed for the Taylor series.
    expect(screen.getByLabelText("Distribution 1")).toBeDisabled();
  });

  it("runs the Taylor series with the chosen variables", () => {
    renderWindow();
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
    renderWindow();
    const add = screen.getByRole("button", { name: "+ Add variable" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getByLabelText("Variable 3")).toBeInTheDocument();
    // γ, c and φ are all used now.
    expect(add).toBeDisabled();
    const second = screen.getByLabelText("Variable 2") as HTMLSelectElement;
    expect([...second.options].map((o) => o.textContent)).toEqual(["Clay: γ (kN/m³), mean 18"]);
    // φ = 0 gets σ = 1 instead of 0.
    expect((screen.getByLabelText("Standard deviation 3") as HTMLInputElement).value).toBe("1");

    for (let i = 3; i >= 1; i--) fireEvent.click(screen.getByLabelText(`Remove variable ${i}`));
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("switching the variable resets σ to the new value's default", () => {
    renderWindow();
    const select = screen.getByLabelText("Variable 1");
    const gamma = [...(select as HTMLSelectElement).options].find((o) => o.textContent!.startsWith("Clay: γ"))!;
    fireEvent.change(select, { target: { value: gamma.value } });
    // 5 % of γ = 18 → 0.9.
    expect((screen.getByLabelText("Standard deviation 1") as HTMLInputElement).value).toBe("0.9");
  });

  it("runs Monte Carlo with samples, seed and distribution", () => {
    renderWindow();
    const methods = within(screen.getByRole("group", { name: "Method" }));
    expect(methods.getByRole("button", { name: "Taylor series" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(methods.getByRole("button", { name: "Monte Carlo" }));
    expect(methods.getByRole("button", { name: "Monte Carlo" })).toHaveAttribute("aria-pressed", "true");
    expect(methods.getByRole("button", { name: "Taylor series" })).toHaveAttribute("aria-pressed", "false");
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

  it("says how many analyses the Taylor series runs and where the results will be", () => {
    renderWindow();
    expect(screen.getByRole("checkbox", { name: /\(3 analyses\)/ })).toBeChecked();
    expect(screen.getByTestId("reliability-empty")).toHaveTextContent("Run to compute β and Pf.");
    act(() => useReliabilityStore.setState({ result: taylorResult(), labels: ["Clay: c (kPa)"] }));
    expect(screen.queryByTestId("reliability-empty")).toBeNull();
  });

  it("can skip the new search per value in the Taylor series", () => {
    renderWindow();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect((run.mock.calls[0] as unknown[])[3]).toEqual({ method: "taylor", search: false });
  });

  it("shows progress and cancels a running analysis", () => {
    renderWindow();
    act(() => useReliabilityStore.setState({ running: true, progress: 0.42 }));
    // The progress is status text at the left of the button row, before Close and Cancel.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("42 %");
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(status, screen.getByRole("button", { name: "Close" }))).toBe(true);
    expect(follows(screen.getByRole("button", { name: "Close" }), screen.getByRole("button", { name: "Cancel" }))).toBe(true);
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("shows Taylor results with β, Pf and the terms, and exports them as CSV", () => {
    renderWindow();
    act(() => useReliabilityStore.setState({ result: taylorResult(), labels: ["Clay: c (kPa)"] }));
    const table = within(screen.getByRole("table", { name: "Probabilistic results" }));
    expect(table.getByText("Reliability index β (lognormal)").nextSibling!.textContent).toBe("3.010");
    expect(table.getByText("Probability of failure (lognormal)").nextSibling!.textContent).toBe("0.13 %");
    expect(table.queryByText("Mean F of the samples")).toBeNull();
    const terms = within(screen.getByRole("table", { name: "Taylor series terms" }));
    expect(terms.getByText("Clay: c (kPa)")).toBeInTheDocument();
    expect(terms.getByText("1.700")).toBeInTheDocument();

    // The decimal comma from the split button's menu.
    fireEvent.click(screen.getByRole("button", { name: "CSV decimal separator" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Decimal comma (1,5)" }));
    const [filename, data, type] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toBe(`${useAppStore.getState().models[0].name} probabilistic.csv`);
    expect(String(data).startsWith("﻿")).toBe(true);
    expect(String(data)).toContain("Taylor series");
    expect(String(data)).toContain(";");
    expect(type).toBe("text/csv;charset=utf-8");
  });

  it("formats an infinite β and a tiny Pf, and shows Monte Carlo extras", () => {
    renderWindow();
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
    expect(table.getByText("Share of samples with F < 1").nextSibling!.textContent).toBe("2.00 %");
    expect(table.getByText("Mean F of the samples").nextSibling!.textContent).toBe("1.480");
    expect(table.getByText("Samples without an F (left out)").nextSibling!.textContent).toBe("2");
    expect(screen.getByLabelText("Distribution of F")).toBeInTheDocument();
  });

  it("shows errors and notes about partial factors and both directions", () => {
    act(() =>
      useAppStore.setState((s) => ({ options: { ...s.options, partialFactors: { gammaC: 1.5 } as never, bothDirections: true } })),
    );
    renderWindow();
    act(() => useReliabilityStore.setState({ error: "Worker failed" }));
    expect(screen.getByText("Worker failed")).toBeInTheDocument();
    expect(screen.getByText(/Partial factors are applied/)).toBeInTheDocument();
    expect(screen.getByText(/Only the model's own sliding direction/)).toBeInTheDocument();
  });

  it("says so when the model has no material values", () => {
    act(() => useAppStore.setState({ materials: [] }));
    renderWindow();
    expect(screen.getByText("The model has no material values to vary.")).toBeInTheDocument();
  });
});
