import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SensitivityPanel } from "./SensitivityPanel";
import { useSensitivityStore } from "./store";
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
  act(() => useSensitivityStore.getState().setOpen(true));
  act(() => useSensitivityStore.setState({ run, cancel }));
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

function type(label: string, value: string) {
  const el = input(label);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

beforeEach(() => {
  useAppStore.getState().newProject();
  // Clay: γ = 18, c = 12, φ = 0; one parameter H = 10.
  useAppStore.setState({
    materials: [{ ...DEFAULT_MATERIAL }],
    parameters: [{ name: "H", expression: "10" } as never],
  });
  run.mockClear();
  cancel.mockClear();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => {
  cleanup();
  act(() => useSensitivityStore.setState({ open: false, points: [], running: false, total: 0, label: "", runValue: null }));
});

describe("SensitivityPanel", () => {
  it("renders nothing while closed", () => {
    render(<SensitivityPanel />);
    expect(screen.queryByText("Sensitivity analysis")).toBeNull();
  });

  it("lists parameters and material values with ±20 % as the default range", () => {
    render(<SensitivityPanel />);
    openPanel();
    const select = screen.getByLabelText("Variable") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Parameter H (now 10)",
      "Clay: γ (kN/m³) (now 18)",
      "Clay: c (kPa) (now 12)",
      "Clay: φ (°) (now 0)",
    ]);
    expect(input("From").value).toBe("8");
    expect(input("To").value).toBe("12");
    expect(input("Number of values").value).toBe("9");
  });

  it("resets the range when another variable is chosen (±5 around zero)", () => {
    render(<SensitivityPanel />);
    openPanel();
    const select = screen.getByLabelText("Variable") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: select.options[2].value } });
    expect(input("From").value).toBe("9.6");
    expect(input("To").value).toBe("14.4");
    fireEvent.change(select, { target: { value: select.options[3].value } });
    expect(input("From").value).toBe("-5");
    expect(input("To").value).toBe("5");
  });

  it("runs the model for evenly spaced values of the chosen variable", () => {
    render(<SensitivityPanel />);
    openPanel();
    const select = screen.getByLabelText("Variable") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: select.options[2].value } });
    type("From", "10");
    type("To", "14");
    type("Number of values", "5");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const [model, variable, info, values] = run.mock.calls[0] as unknown as [
      { materials: unknown[] },
      unknown,
      unknown,
      number[],
    ];
    expect(model.materials).toHaveLength(1);
    expect(variable).toEqual({ kind: "material", materialId: DEFAULT_MATERIAL.id, field: "cohesion" });
    expect(info).toEqual({ key: `m:${DEFAULT_MATERIAL.id}:cohesion`, label: "Clay: c (kPa)", value: 12 });
    expect(values).toEqual([10, 11, 12, 13, 14]);
  });

  it("cannot run an empty range and ignores an out-of-range number of values", () => {
    render(<SensitivityPanel />);
    openPanel();
    type("Number of values", "500");
    type("To", "8");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    type("To", "9");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect((run.mock.calls[0] as unknown[])[3]).toHaveLength(9);
  });

  it("shows progress while running and cancels", () => {
    render(<SensitivityPanel />);
    openPanel();
    act(() =>
      useSensitivityStore.setState({ running: true, total: 9, points: [{ value: 8, fos: 1.1 }], label: "Parameter H" }),
    );
    expect(screen.getByText("1 / 9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
  });

  it("tabulates the results, flags values without a FOS and exports CSV", () => {
    render(<SensitivityPanel />);
    openPanel();
    act(() =>
      useSensitivityStore.setState({
        label: "Parameter H",
        runValue: 10,
        total: 3,
        points: [
          { value: 8, fos: 1.2346 },
          { value: 10, fos: 1.1 },
          { value: 12, fos: null, error: "No valid surface" },
        ],
      }),
    );
    expect(screen.getByText("2 of 3 values gave a FOS")).toBeInTheDocument();
    expect(screen.getByText("1.235")).toBeInTheDocument();
    expect(screen.getByText("no surface").closest("tr")).toHaveAttribute("title", "No valid surface");
    expect(screen.getByText(/1 value\(s\) gave no result/)).toBeInTheDocument();
    expect(screen.getByLabelText("FOS against the varied value")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const [filename, data] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toBe(`${useAppStore.getState().models[0].name} sensitivity.csv`);
    const csv = String(data);
    expect(csv.startsWith("﻿Parameter H,FOS,Note")).toBe(true);
    expect(csv).toContain("8,1.2346");
    expect(csv).toContain("No valid surface");
  });

  it("says so when there is nothing to vary", () => {
    act(() => useAppStore.setState({ materials: [], parameters: [] }));
    render(<SensitivityPanel />);
    openPanel();
    expect(screen.getByText("The model has no parameters or material values to vary.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("closes when another model becomes active", () => {
    render(<SensitivityPanel />);
    openPanel();
    act(() => useAppStore.setState({ activeModelId: "other" }));
    expect(useSensitivityStore.getState().open).toBe(false);
  });
});
