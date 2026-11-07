import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { AnalysisClient } from "./engine/client";

function renderApp(loadEngine: () => Promise<WebAssembly.Module>) {
  const client = new AnalysisClient({ loadEngine, createWorker: () => ({ postMessage() {}, onmessage: null, onerror: null, terminate() {} }) });
  return render(
    <ThemeProvider>
      <App client={client} />
    </ThemeProvider>,
  );
}

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

describe("App", () => {
  it("shows the heading, loads the engine and says when it is ready", async () => {
    renderApp(() => Promise.resolve({} as WebAssembly.Module));
    expect(screen.getByRole("heading", { level: 1, name: "Slope stability in the browser" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the engine");
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Engine ready");
  });

  it("says why when the engine does not load", async () => {
    renderApp(() => Promise.reject(new Error("no network")));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("The engine could not load: no network");
  });

  it("switches the theme and remembers it", async () => {
    renderApp(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("cslope-ui-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("links the wordmark to the website", () => {
    renderApp(() => new Promise(() => {}));
    expect(screen.getByRole("link", { name: "cSlope website" })).toHaveAttribute("href", "https://cslope.com");
  });
});
