import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";
import { AnalysisClient } from "@/engine/client";
import { App } from "./App";
import "./index.css";

const client = new AnalysisClient();

// A developer check, which the smoke test uses too (scripts/smoke.ts):
// runs an analysis document through the worker from the console.
declare global {
  interface Window {
    cslopeWeb: { run: AnalysisClient["run"]; cancel: AnalysisClient["cancel"] };
  }
}
window.cslopeWeb = { run: (document, onProgress) => client.run(document, onProgress), cancel: () => client.cancel() };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system">
      <App client={client} />
    </ThemeProvider>
  </StrictMode>,
);
