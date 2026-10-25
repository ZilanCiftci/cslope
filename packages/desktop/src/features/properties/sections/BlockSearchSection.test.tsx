import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionsSection } from "./OptionsSection";
import { blockObjectKind, blockObjectProblem } from "../../../utils/block-search";
import { useAppStore } from "../../../store/app-store";

describe("block search settings", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    render(<OptionsSection plain />);
  });

  it("shows the objects and angles only for a block search", async () => {
    expect(screen.queryByText("+ Add Search Object")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Search method"), "block");
    expect(useAppStore.getState().options.searchMethod).toBe("block");
    expect(screen.getByText("+ Add Search Object")).toBeTruthy();
    expect(screen.getByText(/Add at least one object/)).toBeTruthy();
  });

  it("adds an object from typed points", async () => {
    await userEvent.selectOptions(screen.getByLabelText("Search method"), "block");
    await userEvent.click(screen.getByText("+ Add Search Object"));
    const input = screen.getByLabelText("Block search object points");
    await userEvent.type(input, "25, 26.75; 50, 26.75");
    expect(useAppStore.getState().blockSearchObjects[0].points).toEqual([
      [25, 26.75],
      [50, 26.75],
    ]);
    expect(screen.getByText(/Object 1 \(line\)/)).toBeTruthy();
  });

  it("sets an angle range, ordered, and clears it to automatic", async () => {
    await userEvent.selectOptions(screen.getByLabelText("Search method"), "block");
    const lo = screen.getByLabelText("Upslope end angle (°), minimum");
    await userEvent.type(lo, "60");
    expect(useAppStore.getState().options.blockActiveAngle).toEqual([60, 60]);
    const hi = screen.getByLabelText("Upslope end angle (°), maximum");
    // (Emptying a field makes the range automatic: the text is replaced instead.)
    await userEvent.tripleClick(hi);
    await userEvent.keyboard("70");
    // Typing passes through 7, below the minimum: not kept meanwhile.
    expect(useAppStore.getState().options.blockActiveAngle).toEqual([60, 70]);
    await userEvent.tripleClick(hi);
    await userEvent.keyboard("50");
    await userEvent.tab();
    // A maximum below the minimum, put in order when the field is left.
    expect(useAppStore.getState().options.blockActiveAngle).toEqual([50, 60]);
    await userEvent.clear(lo);
    expect(useAppStore.getState().options.blockActiveAngle).toBeNull();
  });
});

describe("block search object helpers", () => {
  it("names objects by their number of points", () => {
    expect(blockObjectKind(1)).toBe("point");
    expect(blockObjectKind(2)).toBe("line");
    expect(blockObjectKind(4)).toBe("window");
  });

  it("flags lines without length and windows without area", () => {
    expect(blockObjectProblem([[1, 1], [1, 1]])).toMatch(/coincide/);
    expect(blockObjectProblem([[0, 0], [1, 0], [2, 0]])).toMatch(/no area/);
    expect(blockObjectProblem([[0, 0], [1, 0], [1, 1]])).toBeNull();
  });
});
