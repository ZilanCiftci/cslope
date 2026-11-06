/**
 * The Place drawing window before its drawing has opened: the mode a
 * drawing of the project starts in, the steps without a drawing, and the
 * names of the crop commands.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlaceDrawingWindow } from "./PlaceDrawingWindow";
import { setAssetLoader } from "./drawing-cache";
import { DWG_MIME } from "./sources";
import type { DrawingWindowState } from "./window-sync";

beforeAll(() => {
  // The files never open here: the window as it is while one is read.
  setAssetLoader(() => new Promise(() => {}));
});

afterEach(cleanup);

const state = (assets: DrawingWindowState["assets"]): DrawingWindowState => ({
  modelId: "m1",
  modelName: "Section 1",
  outline: { exterior: [], lines: [] },
  assets,
  placements: [],
  edit: null,
});

const radio = (name: string) => screen.getByRole("radio", { name });

describe("Place drawing window", () => {
  it("starts a DWG drawing already in the project at its drawing coordinates", () => {
    render(
      <PlaceDrawingWindow
        state={state([{ id: "a", mime: DWG_MIME, originalName: "sections.dwg", usedBy: ["Section 2"] }])}
        onCommand={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(radio("Drawing coordinates")).toHaveAttribute("aria-checked", "true");
    // One name for the axes mode, whatever the file.
    expect(radio("Axes")).toHaveAttribute("aria-checked", "false");
    // One crop control: the toolbar's Crop toggle.
    expect(screen.getByRole("button", { name: "Crop" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Crop…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear crop" })).toBeDisabled();
    expect(screen.getByText(/The whole drawing is placed now/)).toBeInTheDocument();
  });

  it("starts a PDF in axes mode, the first axis point to click a plain next step", () => {
    render(
      <PlaceDrawingWindow
        state={state([{ id: "p", mime: "application/pdf", originalName: "sheet.pdf", usedBy: [] }])}
        onCommand={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(radio("Axes")).toHaveAttribute("aria-checked", "true");
    const message = screen.getByTestId("calibration-message");
    expect(message).toHaveTextContent("Click point x1 on the x axis.");
    expect(message).toHaveAttribute("data-kind", "prompt");
  });

  it("offers no steps and no viewer tools before there is a drawing", () => {
    render(<PlaceDrawingWindow state={state([])} onCommand={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("no-drawing-steps")).toHaveTextContent("Add a drawing to crop and calibrate it.");
    expect(screen.queryByRole("radiogroup", { name: "Calibration" })).toBeNull();
    for (const name of ["Pick points", "Crop", "Pan", "Fit"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Place" })).toBeDisabled();
  });
});
