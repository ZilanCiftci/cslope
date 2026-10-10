import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchLimitsSection } from "./SearchLimitsSection";
import { useAppStore } from "../../../store/app-store";

describe("SearchLimitsSection inputs", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    useAppStore.setState({
      coordinates: [
        [-10, -10],
        [-10, 0],
        [5, 0],
        [15, -5],
        [20, -5],
        [20, -10],
      ],
      analysisLimits: {
        enabled: true,
        entryLeftX: -8,
        entryRightX: 4,
        exitLeftX: 10,
        exitRightX: 18,
      },
    });
    render(<SearchLimitsSection plain />);
  });

  it("accepts 0 and negative values instead of the geometry extent", async () => {
    const entryMax = screen.getByLabelText("Entry maximum X");
    await userEvent.clear(entryMax);
    await userEvent.type(entryMax, "0");
    expect(useAppStore.getState().analysisLimits.entryRightX).toBe(0);

    const entryMin = screen.getByLabelText("Entry minimum X");
    await userEvent.clear(entryMin);
    await userEvent.type(entryMin, "-3");
    expect(useAppStore.getState().analysisLimits.entryLeftX).toBe(-3);
  });
});
