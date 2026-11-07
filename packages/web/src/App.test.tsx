import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnalysisResult, ResultSummary, ValidationIssue } from "@cslope/engine";
import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { AnalysisClient, type WorkerLike } from "./engine/client";
import type { WorkerRequest, WorkerResponse } from "./engine/messages";
import { draftOf, toQuery } from "./form/draft";
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
  });

  it("runs when the form is filled in and shows F with its label and the engine's warnings", async () => {
    const { requests } = renderApp();
    type("Unit weight γ (kN/m³)", "16");
    type("Su (kPa)", "20");
    expect(await screen.findByText("F 1.234")).toBeInTheDocument();
    expect(screen.getByText("Minimum factor of safety")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Over-design factor" }));
    expect(screen.getByRole("button", { name: "Over-design factor" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("fill in 4 empty fields");
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    type("η undrained", "1");
    type("η drained", "1");
    type("γQ / γd", "1.3");
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].document.options.partialFactors).toMatchObject({ cu: 1.5, variableLoad: 1.183 });
  });

  it("adds and removes layers", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    expect(screen.getAllByLabelText("Bottom level (m)")[1]).toHaveValue("-20");
    fireEvent.click(screen.getByRole("button", { name: "Remove layer 2" }));
    expect(screen.getAllByLabelText("Bottom level (m)")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Remove layer 1" })).toBeNull();
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
