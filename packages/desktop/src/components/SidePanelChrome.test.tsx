import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CollapsedPanelStrip, PanelHeaderRow } from "./SidePanelChrome";

afterEach(cleanup);

describe("PanelHeaderRow", () => {
  it("collapses from its button, at the window edge of the row", () => {
    const onCollapse = vi.fn();
    const onMove = vi.fn();
    render(
      <PanelHeaderRow side="left" label="Models" onCollapse={onCollapse} onMove={onMove}>
        <span>MODELS</span>
      </PanelHeaderRow>,
    );
    const row = screen.getByTestId("panel-header-models");
    const button = screen.getByLabelText("Collapse models");
    expect(row.lastElementChild).toBe(button);
    fireEvent.click(button);
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();

    cleanup();
    render(
      <PanelHeaderRow side="right" label="Models" onCollapse={onCollapse} onMove={onMove}>
        <span>MODELS</span>
      </PanelHeaderRow>,
    );
    expect(screen.getByTestId("panel-header-models").firstElementChild).toBe(
      screen.getByLabelText("Collapse models"),
    );
  });

  it("moves the panel only from its context menu", () => {
    const onMove = vi.fn();
    render(
      <PanelHeaderRow side="left" label="Models" onCollapse={vi.fn()} onMove={onMove}>
        <span>MODELS</span>
      </PanelHeaderRow>,
    );
    fireEvent.contextMenu(screen.getByTestId("panel-header-models"));
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move panel to the right" }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("CollapsedPanelStrip", () => {
  it("shows the panel's name and opens it from its button", () => {
    const onOpen = vi.fn();
    render(<CollapsedPanelStrip side="left" label="Properties" onOpen={onOpen} onMove={vi.fn()} />);
    const strip = screen.getByTestId("collapsed-properties");
    expect(strip.style.width).toBe("22px");
    expect(strip.style.borderRight).toContain("1px solid");
    expect(screen.getByText("Properties")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Open properties"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("borders the inner side and offers a move to the other side", () => {
    const onMove = vi.fn();
    render(<CollapsedPanelStrip side="right" label="Models" onOpen={vi.fn()} onMove={onMove} />);
    expect(screen.getByTestId("collapsed-models").style.borderLeft).toContain("1px solid");
    fireEvent.contextMenu(screen.getByLabelText("Open models"));
    expect(screen.getByRole("menuitem", { name: "Move panel to the left" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByLabelText("Open models"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });
});
