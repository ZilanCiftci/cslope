import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../../../store/app-store";
import { DEFAULT_MATERIAL } from "../../../store/defaults";
import { MaterialsSection } from "./MaterialsSection";
import { LoadsSection } from "./LoadsSection";

describe("Property sections — invalid input handling", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSection: "Materials",
      materials: [{ ...DEFAULT_MATERIAL }],
      udls: [],
      lineLoads: [],
    });
  });

  it("sanitizes invalid numeric inputs in MaterialsSection", async () => {
    const user = userEvent.setup();
    render(<MaterialsSection />);

    const [unitWeightInput, frictionAngleInput, cohesionInput] =
      screen.getAllByRole("spinbutton") as HTMLInputElement[];

    fireEvent.change(unitWeightInput, { target: { value: "-5" } });
    expect(unitWeightInput).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(unitWeightInput);
    expect(unitWeightInput).toHaveValue(0.1);
    expect(unitWeightInput).toHaveAttribute("aria-invalid", "false");

    await user.clear(frictionAngleInput);
    fireEvent.blur(frictionAngleInput);
    expect(frictionAngleInput).toHaveValue(0);
    expect(frictionAngleInput).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(cohesionInput, { target: { value: "-2" } });
    expect(cohesionInput).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(cohesionInput);
    expect(cohesionInput).toHaveValue(0);
    expect(cohesionInput).toHaveAttribute("aria-invalid", "false");
  });

  it("sanitizes invalid numeric inputs in LoadsSection", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ activeSection: "Loads" });
    render(<LoadsSection />);

    await user.click(screen.getByRole("button", { name: "+ Add UDL" }));
    await user.click(screen.getByRole("button", { name: "+ Add Line Load" }));

    const udlMagnitude = screen.getByLabelText(
      "UDL magnitude",
    ) as HTMLInputElement;
    const udlX1 = screen.getByLabelText("UDL x1") as HTMLInputElement;
    const udlX2 = screen.getByLabelText("UDL x2") as HTMLInputElement;
    const lineLoadMagnitude = screen.getByLabelText(
      "Line load magnitude",
    ) as HTMLInputElement;

    fireEvent.change(udlMagnitude, { target: { value: "-10" } });
    expect(udlMagnitude).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(udlMagnitude);
    expect(udlMagnitude).toHaveValue(0.1);
    expect(udlMagnitude).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(udlX2, { target: { value: "0" } });
    expect(udlX1).toHaveAttribute("aria-invalid", "true");
    expect(udlX2).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(lineLoadMagnitude, { target: { value: "-1" } });
    expect(lineLoadMagnitude).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(lineLoadMagnitude);
    expect(lineLoadMagnitude).toHaveValue(0.1);
    expect(lineLoadMagnitude).toHaveAttribute("aria-invalid", "false");
  });
});
