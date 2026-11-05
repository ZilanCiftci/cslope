import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { DEFAULT_FEM_SETTINGS } from "@cslope/engine";
import { OptionsDialogApp } from "./OptionsDialogApp";
import { LineLoadsDialogApp } from "./LineLoadsDialogApp";
import { ReinforcementDialogApp } from "./ReinforcementDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";

let bridge: FakeBridge;

beforeEach(() => {
  useAppStore.getState().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

/** The pages the "?" buttons opened. */
const opened = () => bridge.calls.filter((c) => c.name === "openDocumentation").map((c) => c.args[0]);

/** Every tooltip in the document, longest first. */
const tooltips = () =>
  [...document.querySelectorAll<HTMLElement>("[title]")]
    .map((e) => e.getAttribute("title") ?? "")
    .sort((a, b) => b.length - a.length);

describe("help links and short tooltips", () => {
  it("Options: a ? per section opens the documentation at its heading; tooltips are short", () => {
    render(<OptionsDialogApp />);
    const s = useAppStore.getState();
    bridge.emit("onAnalysisState", {
      coordinates: s.coordinates,
      orientation: "ltr",
      analysisLimits: s.analysisLimits,
      customSearchPlanes: [],
      customPlanesOnly: false,
      // All the finite element settings shown.
      options: { ...s.options, fem: { ...DEFAULT_FEM_SETTINGS, enabled: true } },
    });
    const sections: [string, string][] = [
      ["Method", "analysis#method"],
      ["Search", "search#search-settings"],
      ["Water and tension crack", "analysis#tension-crack"],
      ["Rapid drawdown", "water#rapid-drawdown"],
      ["Seismic", "analysis#seismic-load-pseudostatic"],
      ["Design", "analysis#partial-factors"],
      ["Finite elements", "analysis#finite-elements-experimental"],
    ];
    for (const [topic] of sections) fireEvent.click(screen.getByRole("button", { name: `Help: ${topic}` }));
    expect(opened()).toEqual(sections.map(([, page]) => page));
    expect(screen.getByLabelText("Strength reduction by finite elements")).toBeInTheDocument();
    const [longest] = tooltips();
    expect(longest.length, longest).toBeLessThanOrEqual(200);
  });

  it("Line loads and Reinforcement: a ? at the heading", () => {
    render(<LineLoadsDialogApp />);
    fireEvent.click(screen.getByRole("button", { name: "Help: Line loads" }));
    cleanup();
    render(<ReinforcementDialogApp />);
    fireEvent.click(screen.getByRole("button", { name: "Help: Reinforcement" }));
    fireEvent.click(screen.getByRole("button", { name: "Help: Piles and sheet piles" }));
    expect(opened()).toEqual(["loads#line-loads", "reinforcement#reinforcement", "reinforcement#piles-and-sheet-piles"]);
    for (const t of tooltips()) expect(t.length, t).toBeLessThanOrEqual(200);
  });
});
