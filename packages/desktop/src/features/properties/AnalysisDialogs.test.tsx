import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { OptionsDialogApp } from "./OptionsDialogApp";
import { SearchLimitsDialogApp } from "./SearchLimitsDialogApp";
import { CustomSearchPlanesDialogApp } from "./CustomSearchPlanesDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { AnalysisLimitsState, CustomSearchPlane, ModelEntry } from "../../store/types";

let bridge: FakeBridge;
const store = () => useAppStore.getState();
const opts = () => store().options;

function hydrate(patch: {
  options?: Partial<ModelEntry["options"]>;
  analysisLimits?: Partial<AnalysisLimitsState>;
  customSearchPlanes?: CustomSearchPlane[];
  customPlanesOnly?: boolean;
  orientation?: "ltr" | "rtl";
} = {}) {
  const s = store();
  bridge.emit("onAnalysisState", {
    coordinates: [
      [0, 0],
      [0, 10],
      [30, 10],
      [40, 0],
    ],
    orientation: patch.orientation ?? "ltr",
    analysisLimits: { ...s.analysisLimits, ...patch.analysisLimits },
    customSearchPlanes: patch.customSearchPlanes ?? [],
    customPlanesOnly: patch.customPlanesOnly ?? false,
    options: { ...s.options, ...patch.options },
  });
}

const lastSent = () =>
  bridge.sentOf<{
    options: ModelEntry["options"];
    analysisLimits: AnalysisLimitsState;
    customSearchPlanes: CustomSearchPlane[];
    customPlanesOnly: boolean;
    orientation: string;
  }>("sendAnalysisChanged").at(-1)!;

beforeEach(() => {
  store().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("OptionsDialogApp", () => {
  it("shows the options from the main window and resyncs the number fields", () => {
    render(<OptionsDialogApp />);
    expect(bridge.callNames()).toContain("requestAnalysisState");
    hydrate({ options: { method: "Janbu", slices: 40, tolerance: 0.005 } });
    expect(screen.getByLabelText("Analysis method")).toHaveValue("Janbu");
    expect(screen.getByLabelText("Number of slices")).toHaveValue("40");
    expect(screen.getByLabelText("Tolerance")).toHaveValue("0.005");
    expect(bridge.sentOf("sendAnalysisChanged")).toEqual([]);
    bridge.emit("onAnalysisChanged", {
      ...lastSentOrState(),
      options: { ...opts(), slices: 60 },
    });
    expect(screen.getByLabelText("Number of slices")).toHaveValue("60");
  });

  it("shows the model's rapid drawdown and sends a change of it back", async () => {
    render(<OptionsDialogApp />);
    const s = store();
    bridge.emit("onAnalysisState", {
      coordinates: [[0, 0], [0, 10], [30, 10], [40, 0]],
      orientation: "ltr",
      analysisLimits: s.analysisLimits,
      customSearchPlanes: [],
      customPlanesOnly: false,
      options: s.options,
      piezometricLine: { ...s.piezometricLine, rapidDrawdown: { waterBefore: [[0, 9], [40, 9]] } },
    });
    expect(screen.getByLabelText("Rapid drawdown")).toBeChecked();
    expect(screen.getByLabelText("Water level before drawdown")).toHaveValue("9");
    await userEvent.click(screen.getByLabelText("Rapid drawdown"));
    expect(bridge.sentOf<{ rapidDrawdown: unknown }>("sendAnalysisChanged").at(-1)!.rapidDrawdown).toBeNull();
    await userEvent.click(screen.getByLabelText("Rapid drawdown"));
    const sent = bridge.sentOf<{ rapidDrawdown: { waterBefore: [number, number][] } | null }>("sendAnalysisChanged").at(-1)!;
    expect(sent.rapidDrawdown!.waterBefore.map((p) => p[0])).toEqual([0, 40]);
  });

  it("switches the analysis direction", async () => {
    render(<OptionsDialogApp />);
    hydrate();
    const rtl = screen.getByRole("button", { name: "Analysis direction right to left" });
    expect(rtl).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(rtl);
    expect(store().orientation).toBe("rtl");
    expect(rtl).toHaveAttribute("aria-pressed", "true");
    expect(lastSent().orientation).toBe("rtl");
    await userEvent.click(
      screen.getByRole("button", { name: "Analysis direction left to right" }),
    );
    expect(store().orientation).toBe("ltr");
  });

  it("shows the Janbu correction only for Janbu", async () => {
    render(<OptionsDialogApp />);
    hydrate({ options: { method: "Bishop" } });
    expect(screen.queryByLabelText("Apply Janbu correction factor")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Analysis method"), "Janbu");
    await userEvent.click(screen.getByLabelText("Apply Janbu correction factor"));
    expect(opts()).toMatchObject({ method: "Janbu", janbuCorrection: true });
    expect(screen.queryByLabelText("Morgenstern-Price interslice function")).toBeNull();
  });

  it("chooses the Morgenstern-Price interslice function", async () => {
    render(<OptionsDialogApp />);
    hydrate({ options: { method: "Morgenstern-Price" } });
    await userEvent.selectOptions(
      screen.getByLabelText("Morgenstern-Price interslice function"),
      "trapezoidal",
    );
    expect(opts().intersliceFunction).toBe("trapezoidal");
    expect(screen.queryByLabelText("Interslice data points")).toBeNull();
  });

  it("clamps iterations, refined iterations and tolerance on blur", async () => {
    render(<OptionsDialogApp />);
    hydrate();
    const iters = screen.getByLabelText("Number of iterations");
    fireEvent.change(iters, { target: { value: "1" } });
    expect(iters).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(iters);
    expect(opts().iterations).toBeGreaterThan(1);
    expect(iters).toHaveAttribute("aria-invalid", "false");

    const refined = screen.getByLabelText("Number of refined iterations");
    fireEvent.change(refined, { target: { value: "-5" } });
    fireEvent.blur(refined);
    expect(opts().refinedIterations).toBe(0);
    fireEvent.change(refined, { target: { value: "250" } });
    expect(opts().refinedIterations).toBe(250);

    const tol = screen.getByLabelText("Tolerance");
    fireEvent.change(tol, { target: { value: "5" } });
    fireEvent.blur(tol);
    expect(opts().tolerance).toBe(0.1);
  });

  it("sets the pore pressure head and the minimum slip size", async () => {
    render(<OptionsDialogApp />);
    hydrate();
    await userEvent.selectOptions(
      screen.getByLabelText("Pore pressure head"),
      "phreatic-correction",
    );
    expect(opts().porePressureHead).toBe("phreatic-correction");

    const depth = screen.getByLabelText("Minimum slip depth");
    await userEvent.clear(depth);
    await userEvent.type(depth, "1.5");
    expect(opts().minSlipDepth).toBe(1.5);

    const area = screen.getByLabelText("Minimum slip area");
    expect(area).toHaveValue("0");
    await userEvent.clear(area);
    expect(opts().minSlipArea).toBe(0);
    await userEvent.type(area, "2");
    expect(opts().minSlipArea).toBe(2);
    // empty is 0 (no limit), not automatic
    await userEvent.clear(area);
    expect(opts().minSlipArea).toBe(0);
  });

  it("enables crack water only with a crack, and disables the depth when automatic", async () => {
    render(<OptionsDialogApp />);
    hydrate({ options: { tensionCrackDepth: 0, tensionCrackAuto: false } });
    const water = screen.getByLabelText("Water in crack");
    const depth = screen.getByLabelText("Tension crack depth");
    expect(water).toBeDisabled();
    await userEvent.clear(depth);
    await userEvent.type(depth, "2");
    expect(opts().tensionCrackDepth).toBe(2);
    expect(water).toBeEnabled();
    await userEvent.clear(water);
    await userEvent.type(water, "50");
    expect(opts().tensionCrackWater).toBe(0.5);
    // Over 100 % is ignored.
    fireEvent.change(water, { target: { value: "150" } });
    expect(opts().tensionCrackWater).toBe(0.5);

    await userEvent.click(screen.getByLabelText("Automatic tension crack depth"));
    expect(opts().tensionCrackAuto).toBe(true);
    expect(depth).toBeDisabled();
    expect(depth).toHaveValue("");
    expect(water).toBeEnabled();
  });

  it("toggles non-circular optimisation and both directions", async () => {
    render(<OptionsDialogApp />);
    hydrate();
    await userEvent.click(screen.getByLabelText("Non-circular optimization"));
    const bothButton = screen.getByRole("button", { name: "Analyze both directions" });
    await userEvent.click(bothButton);
    expect(opts()).toMatchObject({ nonCircularOptimization: true, bothDirections: true });
    expect(lastSent().options).toMatchObject({ bothDirections: true });
    // The three direction buttons are one choice: "Both" is pressed alone,
    // and picking a direction again turns "both" off.
    expect(bothButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Analysis direction left to right" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Analysis direction right to left" }));
    expect(opts()).toMatchObject({ bothDirections: false });
    expect(store().orientation).toBe("rtl");
    expect(bothButton).toHaveAttribute("aria-pressed", "false");
  });

  it("applies partial factor presets and edits single factors", async () => {
    render(<OptionsDialogApp />);
    hydrate({ options: { partialFactors: null } });
    expect(screen.queryByLabelText("Partial factor preset")).toBeNull();
    await userEvent.click(screen.getByLabelText("Partial factors"));
    expect(opts().partialFactors).toEqual({
      cu: 1.5,
      cohesion: 1.3,
      tanPhi: 1.3,
      variableLoad: 1.3,
    });
    await userEvent.selectOptions(screen.getByLabelText("Partial factor preset"), "ec7");
    expect(opts().partialFactors).toEqual({
      cu: 1.4,
      cohesion: 1.25,
      tanPhi: 1.25,
      variableLoad: 1.3,
    });
    const cu = screen.getByLabelText("Partial factor on undrained shear strength");
    await userEvent.clear(cu);
    await userEvent.type(cu, "1.6");
    expect(opts().partialFactors?.cu).toBe(1.6);
    // Zero is not a valid factor.
    fireEvent.change(cu, { target: { value: "0" } });
    expect(opts().partialFactors?.cu).toBe(1.6);
    await userEvent.selectOptions(screen.getByLabelText("Partial factor preset"), "se");
    expect(opts().partialFactors?.cu).toBe(1.5);
    await userEvent.click(screen.getByLabelText("Partial factors"));
    expect(opts().partialFactors).toBeNull();
  });

  it("sets the minimum entry–exit distance", async () => {
    render(<OptionsDialogApp />);
    hydrate({ options: { partialFactors: null } });
    const d = screen.getByLabelText("Minimum entry–exit distance");
    await userEvent.clear(d);
    await userEvent.type(d, "2");
    expect(opts().minFailureDist).toBe(2);
  });

  it("sets the 3D effects: stage length, adjacent F2D and the materials out of the end faces", async () => {
    render(<OptionsDialogApp />);
    hydrate({ options: { partialFactors: null } });
    expect(screen.queryByLabelText("Stage length L")).toBeNull();
    await userEvent.click(screen.getByLabelText("3D effects (SGI)"));
    expect(opts().sgi3d).toEqual({ enabled: true, length: 15, overstrongF2D: null, excludeMaterials: [] });
    const L = screen.getByLabelText("Stage length L");
    await userEvent.clear(L);
    await userEvent.type(L, "10");
    expect(opts().sgi3d?.length).toBe(10);
    fireEvent.change(screen.getByLabelText("Adjacent F2D"), { target: { value: "2.5" } });
    expect(opts().sgi3d?.overstrongF2D).toBe(2.5);
    fireEvent.change(screen.getByLabelText("Adjacent F2D"), { target: { value: "" } });
    expect(opts().sgi3d?.overstrongF2D).toBeNull();
    const first = screen.getAllByLabelText(/Leave .* out of the end faces/)[0];
    await userEvent.click(first);
    expect(opts().sgi3d?.excludeMaterials).toHaveLength(1);
    await userEvent.click(first);
    expect(opts().sgi3d?.excludeMaterials).toEqual([]);
  });

  it("forms the Swedish factors from the safety class and η", async () => {
    render(<OptionsDialogApp />);
    hydrate({ options: { partialFactors: null } });
    await userEvent.click(screen.getByLabelText("Partial factors"));
    await userEvent.selectOptions(screen.getByLabelText("Partial factor preset"), "se-class");
    // safety class 2, η = 1: γQ = 1.3 · 0.91
    expect(opts().partialFactors?.cu).toBeCloseTo(1.5, 10);
    expect(opts().partialFactors?.variableLoad).toBeCloseTo(1.183, 10);
    await userEvent.selectOptions(screen.getByLabelText("Safety class"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Load factor before γd"), "1.4");
    expect(opts().partialFactors?.variableLoad).toBe(1.162);
    const eta = screen.getByLabelText("η on the undrained shear strength");
    await userEvent.clear(eta);
    await userEvent.type(eta, "1.1");
    expect(opts().partialFactors?.cu).toBe(1.364); // 1.5 / 1.1, three decimals
    expect(opts().partialFactors?.basis).toMatchObject({ safetyClass: 1, etaCu: 1.1, variableLoadBase: 1.4 });
    // a factor entered by hand: the basis is gone, the other factors stay
    const tanPhi = screen.getByLabelText("Partial factor on tan φ'");
    await userEvent.clear(tanPhi);
    await userEvent.type(tanPhi, "1.25");
    expect(opts().partialFactors?.basis).toBeUndefined();
    expect(opts().partialFactors?.cu).toBe(1.364);
    expect(screen.queryByLabelText("Safety class")).toBeNull();
  });
});

function lastSentOrState() {
  const s = store();
  return {
    coordinates: s.coordinates,
    orientation: s.orientation,
    analysisLimits: s.analysisLimits,
    customSearchPlanes: s.customSearchPlanes,
    customPlanesOnly: s.customPlanesOnly,
  };
}

describe("SearchLimitsDialogApp", () => {
  it("names the crest and toe sides for the sliding direction", async () => {
    render(<SearchLimitsDialogApp />);
    hydrate({ analysisLimits: { enabled: true }, orientation: "rtl" });
    expect(screen.getByText("Entry range (crest side — right)")).toBeInTheDocument();
    expect(screen.getByText("Exit range (toe side — left)")).toBeInTheDocument();
    expect(screen.getByText("Model X range: 0 – 40 m")).toBeInTheDocument();
  });

  it("restricts the ranges and sends the limits", async () => {
    render(<SearchLimitsDialogApp />);
    hydrate({ analysisLimits: { enabled: false } });
    expect(screen.queryByLabelText("Exit maximum X")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /Restrict entry\/exit ranges/ }));
    expect(store().analysisLimits.enabled).toBe(true);
    const exitMax = screen.getByLabelText("Exit maximum X");
    await userEvent.clear(exitMax);
    await userEvent.type(exitMax, "38");
    const exitMin = screen.getByLabelText("Exit minimum X");
    await userEvent.clear(exitMin);
    await userEvent.type(exitMin, "31");
    expect(store().analysisLimits).toMatchObject({ exitLeftX: 31, exitRightX: 38 });
    expect(lastSent().analysisLimits).toMatchObject({ exitLeftX: 31, exitRightX: 38 });
  });
});

describe("CustomSearchPlanesDialogApp", () => {
  it("adds a circle and edits its centre and radius", async () => {
    render(<CustomSearchPlanesDialogApp />);
    hydrate();
    expect(screen.queryByText(/Only analyze these surfaces/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "+ Add circle" }));
    expect(store().customSearchPlanes).toHaveLength(1);
    // A new circle starts inside the model: centre above the middle of the
    // slope face (x 30 to 40), reaching down to just above the base.
    expect(store().customSearchPlanes[0]).toMatchObject({ cx: 35, cy: 15, radius: 14.5 });
    const cx = screen.getByLabelText("Circle center X");
    await userEvent.clear(cx);
    await userEvent.type(cx, "15");
    const cy = screen.getByLabelText("Circle center Y");
    await userEvent.clear(cy);
    await userEvent.type(cy, "-2");
    expect(store().customSearchPlanes[0]).toMatchObject({ cx: 15, cy: -2, radius: 14.5 });
    expect(lastSent().customSearchPlanes[0]).toMatchObject({ cx: 15, cy: -2 });
  });

  it("flags a non-positive radius and corrects it on blur", async () => {
    render(<CustomSearchPlanesDialogApp />);
    hydrate({ customSearchPlanes: [{ id: "c1", cx: 10, cy: 20, radius: 12 }] });
    const r = screen.getByLabelText("Circle radius");
    await userEvent.clear(r);
    await userEvent.type(r, "0");
    expect(r).toHaveAttribute("aria-invalid", "true");
    await userEvent.tab();
    expect(store().customSearchPlanes[0].radius).toBe(0.1);
    expect(r).toHaveAttribute("aria-invalid", "false");
  });

  it("restricts the search to custom planes", async () => {
    render(<CustomSearchPlanesDialogApp />);
    hydrate({ customSearchPlanes: [{ id: "c1", cx: 10, cy: 20, radius: 12 }] });
    await userEvent.click(screen.getByRole("checkbox", { name: /Only analyze these surfaces/ }));
    expect(store().customPlanesOnly).toBe(true);
    expect(lastSent().customPlanesOnly).toBe(true);
  });

  it("edits non-circular surface points, keeping incomplete text", async () => {
    render(<CustomSearchPlanesDialogApp />);
    hydrate();
    await userEvent.click(
      screen.getByRole("button", { name: "+ Add non-circular surface" }),
    );
    const pts = screen.getByLabelText("Non-circular surface points") as HTMLInputElement;
    // Not flagged before anything is typed.
    expect(pts).toHaveAttribute("aria-invalid", "false");
    await userEvent.type(pts, "5, 10; 20, 2");
    expect(store().customSearchPlanes[0].points).toEqual([
      [5, 10],
      [20, 2],
    ]);
    expect(pts).toHaveAttribute("aria-invalid", "false");
    // A pair being typed is kept as text and not stored.
    await userEvent.type(pts, "; 35,");
    expect(pts.value).toBe("5, 10; 20, 2; 35,");
    expect(pts).toHaveAttribute("aria-invalid", "true");
    expect(store().customSearchPlanes[0].points).toHaveLength(2);
    await userEvent.type(pts, "9");
    expect(store().customSearchPlanes[0].points).toHaveLength(3);
    await userEvent.tab();
    expect(pts.value).toBe("5, 10; 20, 2; 35, 9");
  });

  it("shows the numbers a canvas drag in the main window sends, and sends typed numbers back", async () => {
    render(<CustomSearchPlanesDialogApp />);
    hydrate({
      customSearchPlanes: [
        { id: "c1", cx: 10, cy: 20, radius: 12 },
        { id: "p1", cx: 0, cy: 0, radius: 0, points: [[5, 8], [25, 4]] },
      ],
    });
    // The canvas moved the circle, dragged its rim and added a vertex.
    bridge.emit("onAnalysisChanged", {
      ...lastSentOrState(),
      customSearchPlanes: [
        { id: "c1", cx: 18.3, cy: 15.2, radius: 13 },
        { id: "p1", cx: 0, cy: 0, radius: 0, points: [[5, 8], [15, 2], [25, 4]] },
      ],
    });
    expect(screen.getByLabelText("Circle center X")).toHaveValue("18.3");
    expect(screen.getByLabelText("Circle center Y")).toHaveValue("15.2");
    expect(screen.getByLabelText("Circle radius")).toHaveValue("13");
    expect(screen.getByLabelText("Non-circular surface points")).toHaveValue("5, 8; 15, 2; 25, 4");
    // Nothing is echoed back; a typed number is.
    expect(bridge.sentOf("sendAnalysisChanged")).toEqual([]);
    const r = screen.getByLabelText("Circle radius");
    await userEvent.clear(r);
    await userEvent.type(r, "9");
    expect(store().customSearchPlanes[0]).toMatchObject({ cx: 18.3, cy: 15.2, radius: 9 });
    expect(lastSent().customSearchPlanes[0].radius).toBe(9);
    expect(lastSent().customSearchPlanes[1].points).toHaveLength(3);
  });

  it("removes circles and non-circular surfaces", async () => {
    render(<CustomSearchPlanesDialogApp />);
    hydrate({
      customSearchPlanes: [
        { id: "c1", cx: 10, cy: 20, radius: 12 },
        { id: "p1", cx: 0, cy: 0, radius: 0, points: [[1, 2], [3, 4]] },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Remove non-circular surface" }));
    expect(store().customSearchPlanes.map((p) => p.id)).toEqual(["c1"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove search plane" }));
    expect(store().customSearchPlanes).toEqual([]);
  });
});
