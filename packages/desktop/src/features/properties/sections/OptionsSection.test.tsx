import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionsSection } from "./OptionsSection";
import { useAppStore } from "../../../store/app-store";
import { DEFAULT_FEM_SETTINGS } from "@cslope/engine";

async function typeInto(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, text);
  return input as HTMLInputElement;
}

describe("OptionsSection inputs", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.getState().setOptions({ method: "Morgenstern-Price" });
    render(<OptionsSection plain />);
  });

  it("keeps typed numbers instead of clamping each keystroke", async () => {
    const slices = await typeInto("Number of slices", "50");
    expect(slices.value).toBe("50");
    expect(useAppStore.getState().options.slices).toBe(50);

    const tol = await typeInto("Tolerance", "0.01");
    expect(tol.value).toBe("0.01");
    expect(useAppStore.getState().options.tolerance).toBe(0.01);

    const iters = await typeInto("Number of iterations", "2000");
    expect(iters.value).toBe("2000");
    expect(useAppStore.getState().options.iterations).toBe(2000);
  });

  it("reads a decimal comma as well as a point", async () => {
    const tol = await typeInto("Tolerance", "0,02");
    expect(tol.value).toBe("0,02");
    expect(useAppStore.getState().options.tolerance).toBe(0.02);
    await userEvent.tab();
    expect(useAppStore.getState().options.tolerance).toBe(0.02);
  });

  it("marks text that is not a number as invalid and keeps the value", async () => {
    const before = useAppStore.getState().options.slices;
    const slices = await typeInto("Number of slices", "4x");
    expect(slices).toHaveAttribute("aria-invalid", "true");
    await userEvent.tab();
    expect(useAppStore.getState().options.slices).toBe(before);
    expect(slices.value).toBe(String(before));
  });

  it("clamps out-of-range values when the field is left", async () => {
    const slices = await typeInto("Number of slices", "5");
    await userEvent.tab();
    expect(slices.value).toBe("10");
    expect(useAppStore.getState().options.slices).toBe(10);
  });

  it("lets interslice data points be typed with separators", async () => {
    useAppStore.getState().setOptions({ intersliceFunction: "data-point-specified" });
    const input = await screen.findByLabelText("Interslice data points");
    await userEvent.clear(input);
    await userEvent.type(input, "0,0; 0.5,1; 1,0");
    expect(useAppStore.getState().options.intersliceDataPoints).toEqual([
      [0, 0],
      [0.5, 1],
      [1, 0],
    ]);
  });
});

describe("OptionsSection Bishop hint", () => {
  const hint = /Bishop's method is defined for circular surfaces/;

  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("shows when Bishop is used with non-circular optimisation", () => {
    useAppStore.getState().setOptions({ method: "Bishop", nonCircularOptimization: true });
    render(<OptionsSection plain />);
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it("is hidden for a circular search or another method", () => {
    useAppStore.getState().setOptions({ method: "Bishop", nonCircularOptimization: false });
    const { unmount } = render(<OptionsSection plain />);
    expect(screen.queryByText(hint)).toBeNull();
    unmount();
    useAppStore.getState().setOptions({ method: "Morgenstern-Price", nonCircularOptimization: true });
    render(<OptionsSection plain />);
    expect(screen.queryByText(hint)).toBeNull();
  });
});

describe("OptionsSection finite elements", () => {
  it("marks finite elements, and the seepage, as experimental", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().setOptions({ fem: { ...DEFAULT_FEM_SETTINGS, enabled: true } });
    render(<OptionsSection plain />);
    expect(screen.getByRole("heading", { name: /Finite elements/ })).toHaveTextContent("Experimental");
    expect(screen.getByText("Experimental")).toHaveAttribute(
      "title",
      "Finite element analysis is experimental: fewer verification problems than limit equilibrium; results may change between versions.",
    );
    expect(screen.getByRole("note", { name: "Finite elements are experimental" })).toHaveTextContent(
      /results may change between versions. Base the design on the limit equilibrium result/,
    );
    expect(screen.getByRole("option", { name: "Steady seepage (FE, experimental)" })).toBeInTheDocument();
  });

  it("selects the recommended flow rule, Davis B, in a new project", async () => {
    useAppStore.getState().newProject();
    render(<OptionsSection plain />);
    // The settings are hidden until the analysis is turned on.
    expect(screen.queryByRole("combobox", { name: "Flow rule" })).toBeNull();
    expect(screen.getByText("Run strength reduction (FE)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Strength reduction by finite elements" }));
    const flowRule = screen.getByRole<HTMLSelectElement>("combobox", { name: "Flow rule" });
    expect(flowRule.value).toBe("davis-b");
    expect(flowRule.selectedOptions[0].textContent).toBe("Davis B (recommended)");
    expect(useAppStore.getState().options.fem).toMatchObject({ enabled: true, flowRule: "davis-b" });
  });

  it("keeps the flow rule of a project that has one", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().setOptions({ fem: { ...DEFAULT_FEM_SETTINGS, enabled: true, flowRule: "non-associated" } });
    render(<OptionsSection plain />);
    expect((screen.getByRole<HTMLSelectElement>("combobox", { name: "Flow rule" })).value).toBe("non-associated");
  });
});

describe("OptionsSection rapid drawdown", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    render(<OptionsSection plain />);
  });

  const piezo = () => useAppStore.getState().piezometricLine;

  it("turns on a level across the model, sets it, and turns it off", async () => {
    expect(screen.queryByLabelText("Water level before drawdown")).toBeNull();
    await userEvent.click(screen.getByLabelText("Rapid drawdown"));
    const xs = useAppStore.getState().coordinates.map((c) => c[0]);
    const line = piezo().rapidDrawdown!.waterBefore;
    expect(line.map((p) => p[0])).toEqual([Math.min(...xs), Math.max(...xs)]);
    await typeInto("Water level before drawdown", "7.5");
    expect(piezo().rapidDrawdown!.waterBefore.map((p) => p[1])).toEqual([7.5, 7.5]);
    await userEvent.click(screen.getByLabelText("Rapid drawdown"));
    expect(piezo().rapidDrawdown).toBeUndefined();
  });

  it("shows an imported line and keeps it until it is replaced with a level", async () => {
    act(() => useAppStore.getState().setPiezoRapidDrawdown({ waterBefore: [[0, 9], [10, 8], [20, 8]] }));
    expect(screen.getByTestId("drawdown-imported-line")).toHaveTextContent("Imported line (3 points)");
    // No level field to type into by accident.
    expect(screen.queryByLabelText("Water level before drawdown")).toBeNull();
    expect(piezo().rapidDrawdown!.waterBefore).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Replace with level" }));
    expect(piezo().rapidDrawdown!.waterBefore.map((p) => p[1])).toEqual([9, 9]);
    await typeInto("Water level before drawdown", "6");
    expect(piezo().rapidDrawdown!.waterBefore.map((p) => p[1])).toEqual([6, 6]);
  });
});

describe("OptionsSection unit weight of water", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.temporal.getState().clear();
    render(<OptionsSection plain />);
  });

  it("shows 9.807 without a setting and stores the model's own value as one undo step", () => {
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Unit weight of water" });
    expect(input.value).toBe("9.807");
    expect(useAppStore.getState().options.waterUnitWeight).toBeUndefined();
    fireEvent.change(input, { target: { value: "9.82" } });
    expect(useAppStore.getState().options.waterUnitWeight).toBe(9.82);
    act(() => useAppStore.temporal.getState().undo());
    expect(useAppStore.getState().options.waterUnitWeight).toBeUndefined();
  });

  it("keeps no setting for the default or an empty field, and ignores a value that is not positive", () => {
    const input = screen.getByRole("textbox", { name: "Unit weight of water" });
    fireEvent.change(input, { target: { value: "10" } });
    expect(useAppStore.getState().options.waterUnitWeight).toBe(10);
    fireEvent.change(input, { target: { value: "0" } });
    expect(useAppStore.getState().options.waterUnitWeight).toBe(10);
    fireEvent.change(input, { target: { value: "9.807" } });
    expect(useAppStore.getState().options.waterUnitWeight).toBeUndefined();
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(useAppStore.getState().options.waterUnitWeight).toBeUndefined();
  });
});
