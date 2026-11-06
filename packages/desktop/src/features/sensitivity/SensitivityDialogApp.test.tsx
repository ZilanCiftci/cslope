import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SensitivityWindow } from "./SensitivityDialogApp";
import { useSensitivityStore } from "./store";
import { sensitivityWindowState, type SensitivityCommand } from "./window-sync";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_MATERIAL } from "../../store/defaults";

vi.mock("../../utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/download")>()),
  downloadFile: vi.fn(),
}));
import { downloadFile } from "../../utils/download";

const onCommand = vi.fn<(command: SensitivityCommand) => void>();

/** The window with the state the main window would send it. */
function Harness() {
  useAppStore((s) => s);
  useSensitivityStore((s) => s);
  return <SensitivityWindow state={sensitivityWindowState()} onCommand={onCommand} />;
}

const renderWindow = () => render(<Harness />);

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
  onCommand.mockClear();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => {
  cleanup();
  act(() => useSensitivityStore.setState({ points: [], running: false, total: 0, label: "", runValue: null }));
});

describe("Sensitivity window", () => {
  it("waits for the main window", () => {
    render(<SensitivityWindow state={null} onCommand={onCommand} />);
    expect(screen.getByText("Sensitivity analysis")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the main window…");
  });

  it("lists parameters and material values with ±20 % as the default range", () => {
    renderWindow();
    const select = screen.getByLabelText("Variable") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Parameter H, now 10",
      "Clay: γ (kN/m³), now 18",
      "Clay: c (kPa), now 12",
      "Clay: φ (°), now 0",
    ]);
    expect(input("From").value).toBe("8");
    expect(input("To").value).toBe("12");
    expect(input("Number of values").value).toBe("9");
    // Before the first run, the chart's place says how to fill it.
    expect(screen.getByTestId("sensitivity-empty")).toHaveTextContent("Run to plot F against Parameter H.");
  });

  it("resets the range when another variable is chosen (±5 around zero)", () => {
    renderWindow();
    const select = screen.getByLabelText("Variable") as HTMLSelectElement;
    // A parameter has no unit; a material value shows its unit in the labels.
    expect(screen.getByText("From")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: select.options[2].value } });
    expect(screen.getByText("From (kPa)")).toBeInTheDocument();
    expect(screen.getByText("To (kPa)")).toBeInTheDocument();
    expect(input("From").value).toBe("9.6");
    expect(input("To").value).toBe("14.4");
    fireEvent.change(select, { target: { value: select.options[3].value } });
    expect(input("From").value).toBe("-5");
    expect(input("To").value).toBe("5");
  });

  it("runs the model for evenly spaced values of the chosen variable", () => {
    renderWindow();
    const select = screen.getByLabelText("Variable") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: select.options[2].value } });
    type("From", "10");
    type("To", "14");
    type("Number of values", "5");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const command = onCommand.mock.calls[0][0];
    if (command.type !== "run") throw new Error("not a run");
    const { variable, info, values } = command;
    expect(variable).toEqual({ kind: "material", materialId: DEFAULT_MATERIAL.id, field: "cohesion" });
    expect(info).toEqual({ key: `m:${DEFAULT_MATERIAL.id}:cohesion`, label: "Clay: c (kPa)", value: 12 });
    expect(values).toEqual([10, 11, 12, 13, 14]);
  });

  it("cannot run an empty range and ignores an out-of-range number of values", () => {
    renderWindow();
    type("Number of values", "500");
    type("To", "8");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    type("To", "9");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onCommand.mock.calls[0][0]).toMatchObject({ type: "run", values: expect.any(Array) });
    expect((onCommand.mock.calls[0][0] as { values: number[] }).values).toHaveLength(9);
  });

  it("shows progress while running and cancels", () => {
    renderWindow();
    act(() =>
      useSensitivityStore.setState({ running: true, total: 9, points: [{ value: 8, fos: 1.1 }], label: "Parameter H" }),
    );
    expect(screen.getByText("1 / 9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "cancel" });
  });

  it("tabulates the results, flags values without an F and exports CSV", () => {
    renderWindow();
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
    expect(screen.getByText("2 of 3 values gave an F")).toBeInTheDocument();
    expect(screen.getByText("1.235")).toBeInTheDocument();
    expect(screen.getByText("no surface").closest("tr")).toHaveAttribute("title", "No valid surface");
    expect(screen.getByText(/1 value\(s\) gave no result/)).toBeInTheDocument();
    expect(screen.getByLabelText("F against the varied value")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const [filename, data] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename).toBe(`${useAppStore.getState().models[0].name} sensitivity.csv`);
    const csv = String(data);
    expect(csv.startsWith("﻿Parameter H,F,Note")).toBe(true);
    expect(csv).toContain("8,1.2346");
    expect(csv).toContain("No valid surface");
  });

  it("says so when there is nothing to vary", () => {
    act(() => useAppStore.setState({ materials: [], parameters: [] }));
    renderWindow();
    expect(screen.getByText("The model has no parameters or material values to vary.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("follows edits of the model: a variable that is gone gives way to the first one", () => {
    renderWindow();
    const select = screen.getByLabelText("Variable") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: select.options[3].value } });
    act(() => useAppStore.setState({ materials: [{ ...DEFAULT_MATERIAL, name: "Silt", model: { ...DEFAULT_MATERIAL.model, frictionAngle: undefined } as never }] }));
    expect((screen.getByLabelText("Variable") as HTMLSelectElement).value).toBe("p:H");
    expect(input("From").value).toBe("8");
  });
});
