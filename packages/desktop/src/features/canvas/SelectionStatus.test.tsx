import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "../../store/app-store";
import { canvasObjectLabel } from "../../store/canvas-selection";
import { SelectionStatus } from "./SelectionStatus";

describe("SelectionStatus", () => {
  beforeEach(() => {
    useAppStore.setState({
      mode: "edit",
      canvasSelection: { object: { type: "exterior" }, point: null },
      canvasSelectionCycle: null,
      locks: { exterior: true },
    });
  });

  it("says that the selection is locked and unlocks it", () => {
    render(<SelectionStatus />);
    const label = canvasObjectLabel(useAppStore.getState(), { type: "exterior" });
    expect(screen.getByTestId("status-selection")).toHaveTextContent("locked");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: `Unlock ${label}` }));
    });
    expect(useAppStore.getState().locks.exterior).toBeFalsy();
    expect(screen.queryByRole("button", { name: `Unlock ${label}` })).toBeNull();
  });

  it("offers no Unlock for an unlocked selection", () => {
    act(() => useAppStore.setState({ locks: {} }));
    render(<SelectionStatus />);
    expect(screen.queryByRole("button", { name: /^Unlock/ })).toBeNull();
  });
});
