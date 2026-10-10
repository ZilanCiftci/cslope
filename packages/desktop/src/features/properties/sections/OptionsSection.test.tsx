import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
