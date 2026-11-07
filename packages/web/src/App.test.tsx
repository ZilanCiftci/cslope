import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnalysisResult, ResultSummary, ValidationIssue } from "@cslope/engine";
import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { AnalysisClient, type WorkerLike } from "./engine/client";
import type { WorkerRequest, WorkerResponse } from "./engine/messages";
import { dumps } from "./engine/document";
import { draftOf, emptyLayer, toQuery } from "./form/draft";
import { embankmentDocument } from "./templates/embankment";
import { EMBANKMENT_EXAMPLES } from "./templates/embankment-examples";
import { excavationDocument } from "./templates/excavation";
import { EXCAVATION_DEFAULTS, EXCAVATION_EXAMPLES } from "./templates/excavation-examples";

const SUMMARY = {
  fos: 1.234,
  fosText: "1.234",
  fosLabel: "factor of safety",
  fosHeading: "Minimum factor of safety",
  valueBasis: "characteristic",
  partialFactors: null,
  method: "Morgenstern-Price (complete equilibrium), interslice function half-sine",
  criticalSurface: null,
  surfacesText: "1500",
  nonConvergedText: null,
  warnings: [{ code: "steep-entry-tension", message: "The surface enters the slope at 71°." }],
} as unknown as ResultSummary;

const DOCUMENT_WARNING: ValidationIssue = { path: "/definition/materials/0/model", code: "missing-unit-weight-sat", message: 'Material "Clay": no saturated unit weight.', severity: "warning" };

/** A worker that answers each run as `answer` says, and records the requests. */
function fakeWorker(answer: (request: WorkerRequest) => WorkerResponse | null) {
  const requests: WorkerRequest[] = [];
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(request) {
      requests.push(request);
      const response = answer(request);
      if (response) setTimeout(() => worker.onmessage?.({ data: response } as MessageEvent<WorkerResponse>), 0);
    },
    terminate() {},
  };
  return { worker, requests };
}

const complete = (r: WorkerRequest): WorkerResponse => ({ type: "complete", id: r.id, result: { criticalSlices: [] } as unknown as AnalysisResult, summary: SUMMARY, warnings: [DOCUMENT_WARNING] });

function renderApp({ loadEngine = () => Promise.resolve({} as WebAssembly.Module), answer = complete }: { loadEngine?: () => Promise<WebAssembly.Module>; answer?: (r: WorkerRequest) => WorkerResponse | null } = {}) {
  const fake = fakeWorker(answer);
  const client = new AnalysisClient({ loadEngine, createWorker: () => fake.worker });
  render(
    <ThemeProvider>
      <App client={client} />
    </ThemeProvider>,
  );
  return fake;
}

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const field = (name: string, index = 0) => screen.getAllByLabelText(name)[index] as HTMLInputElement;
const type = (name: string, value: string, index = 0) => fireEvent.change(field(name, index), { target: { value } });

/** The address of a plain excavation, one clay layer without strengths (the embankment's first visit has the same layer). */
const plain = () =>
  window.history.replaceState(null, "", "/?" + toQuery({ template: "excavation", fields: { groundLevel: "0", excavationDepth: "3", slope: "1.5" }, on: [], layers: [{ ...emptyLayer("15"), name: "Clay" }], ponded: false }));

/** Fills in the two empty fields of the plain excavation (or the embankment's clay): the form is ready. */
const fill = (su = "20") => {
  type("γ (kN/m³)", "16");
  type("Su (kPa)", su);
};
const card = () => screen.getByRole("region", { name: "Result" });

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  window.history.replaceState(null, "", "/");
});

describe("App", () => {
  it("opens the excavation's defaults complete and computes F at once, the haul road on", async () => {
    const { requests } = renderApp();
    expect(screen.getByRole("heading", { level: 1, name: "Excavation in clay with a haul road" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Haul road behind the crest" })).toBeChecked();
    expect(screen.getByRole("button", { name: /^Dry crust/ })).toHaveTextContent("Undrained · 1 m (0 to −1 m) · Su 30 kPa");
    expect(screen.getByRole("button", { name: /^Sand and gravel/ })).toHaveTextContent("Mohr-Coulomb · 5 m (−4 to −9 m) · c′ 0 kPa, φ′ 35°");
    expect(field("Excavation depth H (m)").value).toBe("2.5");
    expect(field("Slope 1:n").value).toBe("2");
    // No field is empty: it runs by itself, with the defaults' document.
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].document).toEqual(excavationDocument(EXCAVATION_DEFAULTS));
    expect(await within(card()).findByText("F 1.234")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeEnabled();
  });

  it("resets every field to the template's defaults", async () => {
    const { requests } = renderApp();
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.change(field("Excavation depth H (m)"), { target: { value: "3.5" } });
    expect(field("Excavation depth H (m)").value).toBe("3.5");
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(field("Excavation depth H (m)").value).toBe("2.5");
    expect(screen.getByRole("checkbox", { name: "Haul road behind the crest" })).toBeChecked();
    expect(screen.getByRole("button", { name: /^Dry crust/ })).toHaveTextContent("Undrained · 1 m (0 to −1 m) · Su 30 kPa");
  });

  it("asks for the empty strengths of a plain section without running", async () => {
    plain();
    const { requests } = renderApp();
    expect(screen.getByRole("heading", { level: 1, name: "Excavation in clay with a haul road" })).toBeInTheDocument();
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("To get F, fill in 2 empty fields.");
    expect(field("Su (kPa)").value).toBe("");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDisabled();
    expect(requests).toEqual([]);
    expect(screen.queryByRole("complementary", { name: "Result summary" })).toBeNull();
  });

  it("runs when the form is filled in and shows F with its label, without the engine's warnings", async () => {
    plain();
    const { requests } = renderApp();
    type("γ (kN/m³)", "16");
    type("Su (kPa)", "20");
    const card = await screen.findByRole("region", { name: "Result" });
    expect(await within(card).findByText("F 1.234")).toBeInTheDocument();
    expect(within(card).getByText("Minimum factor of safety")).toBeInTheDocument();
    // The bar that keeps F in view on a phone, with a link to the card.
    const bar = screen.getByRole("complementary", { name: "Result summary" });
    // The same label as the card's.
    expect(bar).toHaveTextContent("F 1.234Minimum factor of safety");
    expect(within(bar).getByRole("link", { name: "Result" })).toHaveAttribute("href", "#result");
    // The engine's warnings are not shown (the app shows them): the page's users cannot act on them.
    expect(screen.queryByText("The surface enters the slope at 71°.")).toBeNull();
    expect(screen.queryByText(/warnings? from the engine/i)).toBeNull();
    expect(screen.queryByText(DOCUMENT_WARNING.message)).toBeNull();
    expect(card).not.toHaveTextContent(/warning/i);
    expect(requests).toHaveLength(1);
    const material = requests[0].document.definition.materials[0];
    expect(material).toEqual({ name: "Clay", model: { kind: "undrained", unitWeight: 16, unitWeightSat: 16, undrainedShearStrength: 20 } });
    // The address holds the parameters.
    expect(new URLSearchParams(window.location.search).get("layer1.su")).toBe("20");
  });

  it("marks a value out of bounds at its field and does not run", async () => {
    plain();
    const { requests } = renderApp();
    type("γ (kN/m³)", "16");
    type("Su (kPa)", "-5");
    expect(field("Su (kPa)")).toHaveAttribute("aria-invalid", "true");
    // At the field, the bounds alone: the field's label is beside them.
    expect(screen.getByText("Must be more than 0 kPa.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("To get F, correct the field marked in red.");
    // Su 0 is refused too: an undrained layer needs a strength.
    type("Su (kPa)", "0");
    expect(field("Su (kPa)")).toHaveAttribute("aria-invalid", "true");
    await act(() => new Promise<void>((r) => setTimeout(r, 400)));
    expect(requests).toEqual([]);
  });

  it("puts the engine's issues at their fields", async () => {
    plain();
    const issue: ValidationIssue = { path: "/definition/materials/0/model", code: "invalid-material-model", message: 'Material "Clay": Unit weight (γ) must be a positive number.', severity: "error" };
    renderApp({ answer: (r) => ({ type: "invalid", id: r.id, issues: [issue] }) });
    type("γ (kN/m³)", "16");
    type("Su (kPa)", "20");
    expect(await screen.findByText(issue.message)).toBeInTheDocument();
    expect(field("γ (kN/m³)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("status")).toHaveTextContent("The engine found errors in the model.");
  });

  it("opens the section of a shared link on characteristic values, without a safety section", async () => {
    window.history.replaceState(null, "", "/?" + toQuery(draftOf("excavation", EXCAVATION_EXAMPLES["clay-road"])));
    const { requests } = renderApp();
    expect(screen.getByRole("checkbox", { name: "Haul road behind the crest" })).toBeChecked();
    expect(field("Traffic load q (kPa)").value).toBe("20");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].document.options.partialFactors).toBeUndefined();
    expect(screen.queryByRole("heading", { name: "Safety" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Design values" })).toBeNull();
    expect(screen.queryByLabelText("η undrained")).toBeNull();
    expect(await within(card()).findByText("F 1.234")).toBeInTheDocument();
  });

  it("adds a layer open with the focus on its name, and after a remove puts the focus on the header of the layer before", () => {
    plain();
    renderApp();
    const header = (name: RegExp) => screen.getByRole("button", { name });
    // A first visit opens the first layer: its strengths are empty.
    expect(header(/^Clay/)).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    // The new layer opens, the first closes: one open at a time.
    expect(header(/^Clay/)).toHaveAttribute("aria-expanded", "false");
    expect(header(/^Layer 2/)).toHaveAttribute("aria-expanded", "true");
    expect(field("Thickness (m)")).toHaveValue("5");
    expect(header(/^Layer 2/)).toHaveTextContent("Undrained · 5 m (−15 to −20 m)");
    expect(document.activeElement).toBe(field("Name"));
    type("Name", "Sand");
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    expect(header(/^Layer 3/)).toHaveTextContent("5 m (−20 to −25 m)");
    fireEvent.click(screen.getByRole("button", { name: "Remove Sand" }));
    // The third layer is now the second, and moves up by the removed one's thickness; the focus is on the first layer's header.
    expect(header(/^Layer 2/)).toHaveTextContent("5 m (−15 to −20 m)");
    expect(document.activeElement).toBe(header(/^Clay/));
    fireEvent.click(screen.getByRole("button", { name: "Remove Layer 2" }));
    expect(screen.queryByRole("button", { name: "Remove Clay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move Clay up" })).toBeNull();
  });

  it("undoes a removed layer: back in its place with its values and its color, the focus on its header", async () => {
    const { requests } = renderApp();
    await waitFor(() => expect(requests).toHaveLength(1));
    const names = () => screen.getAllByRole("button", { name: /^(Dry crust|Clay|Sand and gravel)/ }).map((b) => /^(Dry crust|Clay|Sand and gravel)/.exec(b.textContent ?? "")?.[0]);
    // The clay, open, gets its own color and strength.
    fireEvent.click(screen.getByRole("button", { name: /^Clay/ }));
    fireEvent.click(screen.getByRole("button", { name: "Color" }));
    fireEvent.click(screen.getByRole("option", { name: "Sienna" }));
    type("Su (kPa)", "17");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("layer2.su")).toBe("17"));
    const address = window.location.search;
    fireEvent.click(screen.getByRole("button", { name: "Remove Clay" }));
    expect(names()).toEqual(["Dry crust", "Sand and gravel"]);
    // The message names the layer, with Undo, in the card's live region.
    const live = within(card()).getByText("Removed Clay.").closest("[aria-live]")!;
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Removed Clay. Undo");
    fireEvent.click(within(card()).getByRole("button", { name: "Undo" }));
    expect(names()).toEqual(["Dry crust", "Clay", "Sand and gravel"]);
    const clay = screen.getByRole("button", { name: /^Clay/ });
    expect(clay).toHaveTextContent("Undrained · 3 m (−1 to −4 m) · Su 17 kPa");
    expect(clay).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Color" })).toHaveTextContent("Sienna");
    expect(document.activeElement).toBe(clay);
    expect(within(card()).queryByRole("button", { name: "Undo" })).toBeNull();
    // The exact draft: the same address as before the remove.
    await waitFor(() => expect(window.location.search).toBe(address));
  });

  it("has one live region and one Undo for the message, also while the phone's bar shows", async () => {
    renderApp();
    await screen.findByRole("complementary", { name: "Result summary" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Clay" }));
    // The card's line is the phone's toast too (placed by CSS): not a second copy.
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
    expect([...document.querySelectorAll("[aria-live]")].filter((e) => e.textContent?.includes("Removed Clay."))).toHaveLength(1);
    // The bar, back with the new F, does not repeat it.
    expect(within(await screen.findByRole("complementary", { name: "Result summary" })).queryByText(/Removed Clay/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("undoes a reset to the template's defaults, with the focus on the first field", async () => {
    const { requests } = renderApp();
    await waitFor(() => expect(requests).toHaveLength(1));
    type("Excavation depth H (m)", "3.5");
    fireEvent.click(screen.getByRole("checkbox", { name: "Haul road behind the crest" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(field("Excavation depth H (m)").value).toBe("2.5");
    expect(screen.queryByRole("button", { name: /^Layer 4/ })).toBeNull();
    expect(within(card()).getByText("Reset to the template's defaults.").closest("[aria-live]")).toHaveTextContent("Reset to the template's defaults. Undo");
    fireEvent.click(within(card()).getByRole("button", { name: "Undo" }));
    expect(field("Excavation depth H (m)").value).toBe("3.5");
    expect(screen.getByRole("checkbox", { name: "Haul road behind the crest" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /^Layer 4/ })).toBeInTheDocument();
    expect(document.activeElement).toBe(field("Ground level (m)"));
  });

  it("keeps Undo for about 8 seconds, and only for the last change", () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/?" + toQuery(draftOf("excavation", EXCAVATION_EXAMPLES["crust-over-clay"])));
      renderApp({ loadEngine: () => new Promise(() => {}) });
      fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove Clay" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove Layer 2" }));
      // Undo brings back the last one removed only, within 8 s.
      expect(within(card()).getByText("Removed Layer 2.")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(7900));
      fireEvent.click(within(card()).getByRole("button", { name: "Undo" }));
      expect(screen.getByRole("button", { name: /^Layer 2/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Clay/ })).toBeNull();
      // After 8 s the message and its Undo are gone.
      fireEvent.click(screen.getByRole("button", { name: "Remove Layer 2" }));
      act(() => vi.advanceTimersByTime(7900));
      expect(within(card()).getByRole("button", { name: "Undo" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(200));
      expect(within(card()).queryByRole("button", { name: "Undo" })).toBeNull();
      expect(within(card()).queryByText("Removed Layer 2.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a picture of the section in the phone's bar, which opens the drawing across the screen and closes with the keyboard", async () => {
    // A critical surface of three slices, from the crest down to the toe.
    const slices = [-2, 1, 4].map((x) => ({ x, xLeft: x - 1.5, xRight: x + 1.5, yTop: 0, yBottom: -2 + x / 4, alpha: -0.3 }));
    renderApp({ answer: (r) => ({ ...(complete(r) as Extract<WorkerResponse, { type: "complete" }>), result: { criticalSlices: slices } as unknown as AnalysisResult }) });
    const bar = await screen.findByRole("complementary", { name: "Result summary" });
    expect(bar).toHaveTextContent("F 1.234");
    const thumb = within(bar).getByRole("button", { name: "Show the section" });
    expect(thumb).toHaveAttribute("aria-haspopup", "dialog");
    expect(thumb).toHaveAttribute("aria-expanded", "false");
    // The picture is the drawing scaled down, hidden from screen readers (the button names it).
    expect(thumb.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    thumb.focus();
    fireEvent.click(thumb);
    const sheet = screen.getByRole("dialog", { name: "Section" });
    expect(thumb).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByRole("img")).toHaveAccessibleName(/^Section of the excavation: .*, and the critical surface of F 1\.234\.$/);
    expect(within(sheet).getByText("F 1.234")).toBeInTheDocument();
    // The focus is on Close and stays in the sheet; Escape closes it and gives the focus back to the picture.
    const close = within(sheet).getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(thumb);
    expect(thumb).toHaveAttribute("aria-expanded", "false");
    // Close, and a tap on the drawing, close it too.
    fireEvent.click(thumb);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Section" })).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(thumb);
    fireEvent.click(thumb);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Section" })).getByRole("img"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves a layer up and down with the focus kept on its button, and inserts one above another, open with the focus on its name", async () => {
    window.history.replaceState(null, "", "/?" + toQuery(draftOf("excavation", EXCAVATION_EXAMPLES["crust-over-clay"])));
    renderApp({ loadEngine: () => new Promise(() => {}) });
    const header = (name: RegExp) => screen.getByRole("button", { name });
    const names = () => screen.getAllByRole("button", { name: /^(Crust|Clay|Silt)/ }).map((b) => b.textContent);
    expect(screen.getByRole("button", { name: "Move Crust up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Clay down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Insert a layer above Clay" }));
    // The new layer: second, 1 m thick, open, the focus on its name; the clay below moves down by 1 m.
    expect(header(/^Layer 2/)).toHaveAttribute("aria-expanded", "true");
    expect(header(/^Layer 2/)).toHaveTextContent("1 m (−1.5 to −2.5 m)");
    expect(header(/^Clay/)).toHaveTextContent("18.5 m (−2.5 to −21 m)");
    expect(document.activeElement).toBe(field("Name"));
    type("Name", "Silt");
    // Down twice from the top: the focus stays on "Move Crust down", then (at the end, where it is disabled) on "Move Crust up".
    fireEvent.click(screen.getByRole("button", { name: "Move Crust down" }));
    expect(names().map((t) => /^(Silt|Crust|Clay)/.exec(t ?? "")?.[0])).toEqual(["Silt", "Crust", "Clay"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Crust down" }));
    expect(header(/^Crust/)).toHaveTextContent("1.5 m (−1 to −2.5 m)");
    fireEvent.click(screen.getByRole("button", { name: "Move Crust down" }));
    expect(screen.getByRole("button", { name: "Move Crust down" })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Crust up" }));
    expect(header(/^Crust/)).toHaveTextContent("1.5 m (−19.5 to −21 m)");
    fireEvent.click(screen.getByRole("button", { name: "Move Crust up" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Crust up" }));
    // Up to the top: "Move Crust up" is disabled, the focus goes to "Move Crust down".
    fireEvent.click(screen.getByRole("button", { name: "Move Crust up" }));
    expect(screen.getByRole("button", { name: "Move Crust up" })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Crust down" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Crust down" }));
    // A problem stays with the moved layer's field: the crust's c′, moved from the second place to the first.
    fireEvent.click(header(/^Crust/));
    type("c′ (kPa)", "-1");
    fireEvent.click(screen.getByRole("button", { name: "Move Crust up" }));
    expect(header(/^Crust/)).toHaveTextContent("Problem");
    expect(header(/^Silt/)).not.toHaveTextContent("Problem");
    expect(field("c′ (kPa)")).toHaveAttribute("aria-invalid", "true");
    // The address follows: the crust first again, with its thickness and its wrong c′.
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("layer1.c")).toBe("-1"));
    expect(new URLSearchParams(window.location.search).get("layer1.t")).toBe("1.5");
    expect(new URLSearchParams(window.location.search).get("layer2.name")).toBe("Silt");
  });

  it("chooses a layer's color from the swatches with the keyboard, into the drawing, the address and the document", async () => {
    plain();
    const { requests } = renderApp();
    fill();
    await waitFor(() => expect(requests).toHaveLength(1));
    // The first layer's color is the app's first: not in the document.
    expect(requests[0].document.definition.materials[0].color).toBeUndefined();
    const color = screen.getByRole("button", { name: "Color" });
    expect(color).toHaveTextContent("Tan");
    fireEvent.click(color);
    const grid = screen.getByRole("listbox", { name: "Color of Clay" });
    expect(within(grid).getAllByRole("option")).toHaveLength(14);
    expect(document.activeElement).toBe(within(grid).getByRole("option", { name: "Tan" }));
    expect(within(grid).getByRole("option", { name: "Tan" })).toHaveAttribute("aria-selected", "true");
    // Escape closes it and gives the focus back to the button; nothing changes.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(color);
    fireEvent.click(color);
    // Right, then down a row: Sage, then the swatch under it (Olive); Enter chooses it.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toHaveAccessibleName("Sage");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toHaveAccessibleName("Olive");
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(color);
    expect(color).toHaveTextContent("Olive");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("layer1.color")).toBe("7f9172"));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].document.definition.materials[0]).toMatchObject({ name: "Clay", color: "#7f9172" });
    // A click on a swatch chooses too; a press outside closes the grid.
    fireEvent.click(color);
    fireEvent.click(screen.getByRole("option", { name: "Sienna" }));
    expect(color).toHaveTextContent("Sienna");
    fireEvent.click(color);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows the layers as an accordion: a summary in each header, one open at a time, problems and empty fields in the header", () => {
    window.history.replaceState(null, "", "/?" + toQuery(draftOf("excavation", EXCAVATION_EXAMPLES["crust-over-clay"])));
    renderApp({ loadEngine: () => new Promise(() => {}) });
    const crust = screen.getByRole("button", { name: /^Crust/ });
    const clay = screen.getByRole("button", { name: /^Clay/ });
    // A filled-in link: all closed, the profile at a glance.
    expect(crust).toHaveAttribute("aria-expanded", "false");
    expect(clay).toHaveAttribute("aria-expanded", "false");
    expect(crust).toHaveTextContent("Mohr-Coulomb · 1.5 m (0 to −1.5 m) · c′ 2 kPa, φ′ 32°");
    expect(clay).toHaveTextContent("Undrained · 18.5 m (−1.5 to −20 m) · Su 18 kPa");
    expect(screen.queryByLabelText("Su (kPa)")).toBeNull();
    fireEvent.click(clay);
    expect(clay).toHaveAttribute("aria-expanded", "true");
    expect(clay).toHaveAttribute("aria-controls", screen.getByRole("group", { name: /^Clay/ }).id);
    type("Su increase rate (kPa/m)", "1.2");
    expect(clay).toHaveTextContent("Su 18 kPa, +1.2 kPa/m");
    fireEvent.click(crust);
    expect(crust).toHaveAttribute("aria-expanded", "true");
    expect(clay).toHaveAttribute("aria-expanded", "false");
    type("c′ (kPa)", "-1");
    expect(screen.getByText("Must be at least 0 kPa.")).toBeInTheDocument();
    fireEvent.click(crust);
    expect(crust).toHaveAttribute("aria-expanded", "false");
    expect(crust).toHaveTextContent("Problem");
    fireEvent.click(crust);
    type("c′ (kPa)", "");
    fireEvent.click(crust);
    expect(crust).toHaveTextContent("Required");
    expect(crust).not.toHaveTextContent("Problem");
  });

  it("draws only the outline, greyed, while the layers cannot be built, and the layers again once they can", () => {
    window.history.replaceState(null, "", "/?" + toQuery(draftOf("excavation", EXCAVATION_EXAMPLES["crust-over-clay"])));
    renderApp({ loadEngine: () => new Promise(() => {}) });
    const section = () => screen.getByRole("img", { name: /section/i });
    expect(section()).toHaveAccessibleName(/^Section of the excavation: 2 layers/);
    expect(within(section()).getByText("Crust")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Clay/ }));
    type("Thickness (m)", "abc");
    // Not the last section's layers: the outline, and a note.
    expect(section()).toHaveAccessibleName("Outline of the section; the layers are drawn when they are correct.");
    expect(within(section()).queryByText("Crust")).toBeNull();
    expect(within(section()).queryByText("Clay")).toBeNull();
    expect(screen.getByText(/^Fix the layers to draw the section\./)).toBeInTheDocument();
    // An empty thickness, or a removed layer that leaves the rest invalid, the same.
    type("Thickness (m)", "");
    expect(section()).toHaveAccessibleName(/^Outline of the section/);
    type("Thickness (m)", "10");
    expect(section()).toHaveAccessibleName(/^Section of the excavation: 2 layers/);
    expect(within(section()).getByText("Clay")).toBeInTheDocument();
    expect(screen.queryByText(/^Fix the layers to draw the section\./)).toBeNull();
    // Removing the clay leaves the crust ending above the excavation bottom: the removed clay is not drawn.
    fireEvent.click(screen.getByRole("button", { name: "Remove Clay" }));
    expect(section()).toHaveAccessibleName(/^Outline of the section/);
    expect(within(section()).queryByText("Clay")).toBeNull();
  });

  it("names the layer kinds as the app names its material models", () => {
    window.history.replaceState(null, "", "/?t=excavation&layers=2&layer1.kind=undrained&layer1.t=5&layer1.su=10&layer1.suRate=1.5&layer2.kind=mohr-coulomb&layer2.t=15");
    renderApp({ loadEngine: () => new Promise(() => {}) });
    // Its unit weight is empty: the first layer is open.
    expect(screen.getByRole("button", { name: /^Layer 1/ })).toHaveAttribute("aria-expanded", "true");
    const select = screen.getByRole("combobox", { name: "Material model" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Undrained", "Mohr-Coulomb", "Impenetrable (bedrock)"]);
    expect(select).toHaveValue("undrained");
    expect(field("Su increase rate (kPa/m)").value).toBe("1.5");
    fireEvent.click(screen.getByRole("button", { name: /^Layer 2/ }));
    expect(screen.getByRole("combobox", { name: "Material model" })).toHaveValue("mohr-coulomb");
  });

  it("cancels a run", async () => {
    plain();
    renderApp({ answer: () => null });
    fill();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Analyzing"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("The analysis was cancelled. Run it again with Run.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("runs once when Run is pressed before the form runs by itself", async () => {
    plain();
    const { requests } = renderApp();
    await flush();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await within(card()).findByText("F 1.234")).toBeInTheDocument();
    await act(() => new Promise<void>((r) => setTimeout(r, 400)));
    expect(requests).toHaveLength(1);
  });

  it("clears the result when a value changes, and shows the last one as previous while the next runs", async () => {
    plain();
    let answer = true;
    renderApp({ answer: (r) => (answer ? complete(r) : null) });
    fill();
    expect(await within(card()).findByText("F 1.234")).toBeInTheDocument();
    answer = false;
    type("Su (kPa)", "25");
    expect(within(card()).queryByText("F 1.234")).toBeNull();
    expect(await within(card()).findByText("Previous result")).toBeInTheDocument();
    expect(within(card()).getByText("F 1.234")).toBeInTheDocument();
  });

  it("downloads the analysis document, without waiting for the engine", async () => {
    plain();
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderApp({ loadEngine: () => new Promise(() => {}) });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    expect(click).toHaveBeenCalledOnce();
    const params = { ...EXCAVATION_EXAMPLES["clay-3m"], groundLevel: 0, excavationDepth: 3, slope: 1.5, layers: [{ name: "Clay", bottomLevel: -15, material: { kind: "undrained" as const, gamma: 16, su: 20 } }] };
    expect(await blob!.text()).toBe(dumps(excavationDocument(params)));
  });

  it("copies the link of the section", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("says why when the engine does not load", async () => {
    renderApp({ loadEngine: () => Promise.reject(new Error("no network")) });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("The engine could not load: no network");
  });

  it("links to the website's download and limitations pages; no .cslp download yet", () => {
    renderApp({ loadEngine: () => new Promise(() => {}) });
    expect(screen.getByRole("link", { name: "Get the cSlope app" })).toHaveAttribute("href", "https://cslope.com/download");
    expect(screen.getByRole("link", { name: "limitations" })).toHaveAttribute("href", "https://cslope.com/docs/browser#limitations");
    // The .cslp download is not shown until it works (#107).
    expect(screen.queryByRole("button", { name: "Download .cslp" })).toBeNull();
    expect(screen.queryByText(/\.cslp/)).toBeNull();
  });

  it("switches the theme and remembers it", async () => {
    renderApp({ loadEngine: () => new Promise(() => {}) });
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("cslope-ui-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("lists the two templates, the excavation active, and switches to the embankment and back", async () => {
    plain();
    const { requests } = renderApp();
    const picker = screen.getByRole("group", { name: "Template" });
    const excavation = within(picker).getByRole("button", { name: "Excavation in clay with a haul road" });
    const embankment = within(picker).getByRole("button", { name: "Embankment on clay" });
    expect(excavation).toHaveAttribute("aria-pressed", "true");
    expect(embankment).toHaveAttribute("aria-pressed", "false");
    expect(document.title).toBe("Excavation in clay with a haul road — cSlope");
    type("Excavation depth H (m)", "4");
    fireEvent.click(embankment);
    expect(screen.getByRole("heading", { level: 1, name: "Embankment on clay" })).toBeInTheDocument();
    expect(embankment).toHaveAttribute("aria-pressed", "true");
    expect(document.title).toBe("Embankment on clay — cSlope");
    expect(screen.getByText("Elevation, and distance from the crest's right edge (m).")).toBeInTheDocument();
    expect(picker).toHaveAttribute("aria-labelledby");
    expect(screen.queryByLabelText("Excavation depth H (m)")).toBeNull();
    expect(field("Embankment height h (m)").value).toBe("3");
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("To get F, fill in 5 empty fields.");
    await act(() => new Promise<void>((r) => setTimeout(r, 400)));
    expect(new URLSearchParams(window.location.search).get("t")).toBe("embankment");
    type("Fill γ (kN/m³)", "19");
    type("Fill c′ (kPa)", "0");
    type("Fill φ′ (°)", "35");
    type("Load on the crest q (kPa)", "10");
    fill("15");
    await waitFor(() => expect(requests).toHaveLength(1));
    const def = requests[0].document.definition;
    expect(def.materials.map((m) => m.name)).toEqual(["Clay", "Embankment"]);
    expect(def.udls).toEqual([{ magnitude: 10, x1: -6, x2: 0 }]);
    expect(await within(card()).findByText("F 1.234")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Section of the embankment: 1 layer, a load of 10 kPa on the crest, and the critical surface of F 1.234\.$/ })).toBeInTheDocument();
    // Back to the excavation as it was left.
    fireEvent.click(within(picker).getByRole("button", { name: "Excavation in clay with a haul road" }));
    expect(field("Excavation depth H (m)").value).toBe("4");
  });

  it("opens an embankment from its shared link, and downloads its document", async () => {
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    let name = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    const params = EMBANKMENT_EXAMPLES["crust-over-clay"];
    window.history.replaceState(null, "", "/?" + toQuery(draftOf("embankment", params)));
    const { requests } = renderApp();
    expect(screen.getByRole("heading", { level: 1, name: "Embankment on clay" })).toBeInTheDocument();
    expect(field("Crest width B (m)").value).toBe("10");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].document).toEqual(embankmentDocument(params));
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    expect(name).toBe("cslope-embankment.json");
    expect(await blob!.text()).toBe(dumps(embankmentDocument(params)));
  });

  it("links the wordmark to the website", () => {
    renderApp({ loadEngine: () => new Promise(() => {}) });
    expect(screen.getByRole("link", { name: "cSlope website" })).toHaveAttribute("href", "https://cslope.com");
  });
});
