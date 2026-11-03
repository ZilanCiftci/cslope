import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionsSection } from "./OptionsSection";
import { useAppStore } from "../../../store/app-store";

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
  it("marks finite elements as experimental and not for design", () => {
    useAppStore.getState().newProject();
    render(<OptionsSection plain />);
    expect(screen.getByRole("heading", { name: /Finite elements/ })).toHaveTextContent("Experimental");
    expect(screen.getByRole("note", { name: "Finite elements are experimental" })).toHaveTextContent(
      /not verified for design and cannot be guaranteed/,
    );
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

  it("shows an imported line and keeps it until a level is entered", async () => {
    act(() => useAppStore.getState().setPiezoRapidDrawdown({ waterBefore: [[0, 9], [10, 8], [20, 8]] }));
    const input = screen.getByLabelText("Water level before drawdown") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("imported line (3 points)");
    expect(piezo().rapidDrawdown!.waterBefore).toHaveLength(3);
    await typeInto("Water level before drawdown", "6");
    expect(piezo().rapidDrawdown!.waterBefore.map((p) => p[1])).toEqual([6, 6]);
  });
});
