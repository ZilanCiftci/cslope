import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnalysisResult, ResultSummary, ValidationIssue } from "@cslope/engine";
import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { AnalysisClient, type WorkerLike } from "./engine/client";
import type { WorkerRequest, WorkerResponse } from "./engine/messages";
import { dumps } from "./engine/document";
import { draftOf, toQuery } from "./form/draft";
import { excavationDocument } from "./templates/excavation";
import { EXCAVATION_EXAMPLES } from "./templates/excavation-examples";

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

const complete = (r: WorkerRequest): WorkerResponse => ({ type: "complete", id: r.id, result: { criticalSlices: [] } as unknown as AnalysisResult, summary: SUMMARY, warnings: [] });

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

/** Fills in the two empty fields of the first visit: the form is ready. */
const fill = (su = "20") => {
  type("Unit weight γ (kN/m³)", "16");
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
  it("shows the template, and asks for the empty strengths without running", async () => {
    const { requests } = renderApp();
    expect(screen.getByRole("heading", { level: 1, name: "Excavation in clay with a working road" })).toBeInTheDocument();
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("To get F, fill in 2 empty fields.");
    expect(field("Su (kPa)").value).toBe("");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDisabled();
    expect(requests).toEqual([]);
    expect(screen.queryByRole("complementary", { name: "Result summary" })).toBeNull();
  });

  it("runs when the form is filled in and shows F with its label and the engine's warnings", async () => {
    const { requests } = renderApp();
    type("Unit weight γ (kN/m³)", "16");
    type("Su (kPa)", "20");
    const card = await screen.findByRole("region", { name: "Result" });
    expect(await within(card).findByText("F 1.234")).toBeInTheDocument();
    expect(within(card).getByText("Minimum factor of safety")).toBeInTheDocument();
    // The bar that keeps F in view on a phone, with a link to the card.
    const bar = screen.getByRole("complementary", { name: "Result summary" });
    expect(bar).toHaveTextContent("F 1.234Factor of safety");
    expect(within(bar).getByRole("link", { name: "Result" })).toHaveAttribute("href", "#result");
    expect(screen.getByText("The surface enters the slope at 71°.")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    const material = requests[0].document.definition.materials[0];
    expect(material).toEqual({ name: "Clay", model: { kind: "undrained", unitWeight: 16, unitWeightSat: 16, undrainedShearStrength: 20 } });
    // The address holds the parameters.
    expect(new URLSearchParams(window.location.search).get("layer1.su")).toBe("20");
  });

  it("marks a value out of bounds at its field and does not run", async () => {
    const { requests } = renderApp();
    type("Unit weight γ (kN/m³)", "16");
    type("Su (kPa)", "900");
    expect(field("Su (kPa)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Layer 1: Su (kPa) must be from 1 to 500 kPa.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("To get F, correct the field marked in red.");
    await act(() => new Promise<void>((r) => setTimeout(r, 400)));
    expect(requests).toEqual([]);
  });

  it("puts the engine's issues at their fields", async () => {
    const issue: ValidationIssue = { path: "/definition/materials/0/model", code: "invalid-material-model", message: 'Material "Clay": Unit weight (γ) must be a positive number.', severity: "error" };
    renderApp({ answer: (r) => ({ type: "invalid", id: r.id, issues: [issue] }) });
    type("Unit weight γ (kN/m³)", "16");
    type("Su (kPa)", "20");
    expect(await screen.findByText(issue.message)).toBeInTheDocument();
    expect(field("Unit weight γ (kN/m³)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("status")).toHaveTextContent("The engine found errors in the model.");
  });

  it("opens the section of a shared link, and switches to the over-design factor", async () => {
    window.history.replaceState(null, "", "/?" + toQuery(draftOf(EXCAVATION_EXAMPLES["clay-road"])));
    const { requests } = renderApp();
    expect(screen.getByRole("checkbox", { name: "Working road behind the crest" })).toBeChecked();
    expect(field("Traffic load q (kPa)").value).toBe("20");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].document.options.partialFactors).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Design values" }));
    expect(screen.getByRole("button", { name: "Design values" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/^F is an over-design factor/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("fill in 4 empty fields");
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    type("η undrained", "1");
    type("η drained", "1");
    type("γQ / γd", "1.3");
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].document.options.partialFactors).toMatchObject({ cu: 1.5, variableLoad: 1.183 });
  });

  it("adds and removes layers, and puts the focus on a layer's name", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    expect(screen.getAllByLabelText("Bottom level (m)")[1]).toHaveValue("-20");
    expect(document.activeElement).toBe(screen.getAllByLabelText("Name")[1]);
    type("Name", "Sand", 1);
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove layer 2" }));
    // The third layer is now the second, with its own fields; the focus is on the first layer's name.
    expect(screen.getAllByLabelText("Bottom level (m)").map((e) => (e as HTMLInputElement).value)).toEqual(["-15", "-25"]);
    expect(document.activeElement).toBe(screen.getAllByLabelText("Name")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove layer 2" }));
    expect(screen.getAllByLabelText("Bottom level (m)")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Remove layer 1" })).toBeNull();
  });

  it("cancels a run", async () => {
    renderApp({ answer: () => null });
    fill();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Analyzing"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("The analysis was cancelled. Run it again with Run.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("runs once when Run is pressed before the form runs by itself", async () => {
    const { requests } = renderApp();
    await flush();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await within(card()).findByText("F 1.234")).toBeInTheDocument();
    await act(() => new Promise<void>((r) => setTimeout(r, 400)));
    expect(requests).toHaveLength(1);
  });

  it("clears the result when a value changes, and shows the last one as previous while the next runs", async () => {
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

  it("links to the website's download and limitations pages; the .cslp download waits", () => {
    renderApp({ loadEngine: () => new Promise(() => {}) });
    expect(screen.getByRole("link", { name: "Open in cSlope" })).toHaveAttribute("href", "https://cslope.com/download");
    expect(screen.getByRole("link", { name: "limitations" })).toHaveAttribute("href", "https://cslope.com/docs/limitations");
    expect(screen.getByRole("button", { name: "Download .cslp" })).toBeDisabled();
  });

  it("switches the theme and remembers it", async () => {
    renderApp({ loadEngine: () => new Promise(() => {}) });
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("cslope-ui-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("links the wordmark to the website", () => {
    renderApp({ loadEngine: () => new Promise(() => {}) });
    expect(screen.getByRole("link", { name: "cSlope website" })).toHaveAttribute("href", "https://cslope.com");
  });
});
