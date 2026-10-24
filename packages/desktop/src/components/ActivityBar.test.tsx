import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActivityBar } from "./ActivityBar";

afterEach(cleanup);

function renderBar(explorerLocation: "left" | "right" = "left") {
  const props = {
    mode: "result" as const,
    explorerOpen: true,
    propertiesOpen: true,
    explorerLocation,
    propertiesLocation: "right" as const,
    onToggleExplorer: vi.fn(),
    onToggleProperties: vi.fn(),
    onToggleExplorerLocation: vi.fn(),
    onTogglePropertiesLocation: vi.fn(),
  };
  render(<ActivityBar {...props} />);
  return props;
}

describe("ActivityBar", () => {
  it("moves a panel only from its context menu", () => {
    const props = renderBar();
    fireEvent.contextMenu(screen.getByLabelText("Toggle models"));
    expect(props.onToggleExplorerLocation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move panel to the right" }));
    expect(props.onToggleExplorerLocation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByLabelText("Toggle properties"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move panel to the left" }));
    expect(props.onTogglePropertiesLocation).toHaveBeenCalledTimes(1);
    expect(props.onToggleExplorerLocation).toHaveBeenCalledTimes(1);
  });

  it("closes the menu with Escape or a click elsewhere", () => {
    const props = renderBar("right");
    fireEvent.contextMenu(screen.getByLabelText("Toggle models"));
    expect(screen.getByRole("menuitem", { name: "Move panel to the left" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByLabelText("Toggle models"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(props.onToggleExplorerLocation).not.toHaveBeenCalled();
  });
});
