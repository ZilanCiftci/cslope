import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LongTitleTooltip } from "./components/ui/LongTitleTooltip";
import { useAppStore } from "./store/app-store";
import { paperPngDataUrl } from "./features/export/paper-png";
import { installFocusSource } from "./utils/focus-source";
import { initEngine } from "@cslope/engine";
// The engine's WebAssembly, inlined: the app runs from file://, where it
// cannot be fetched as a separate file.
import engineWasm from "@cslope/engine/wasm?base64";

// Set initial theme before first render (respect saved preference, default to light)
document.documentElement.dataset.theme =
  localStorage.getItem("cslope-theme") || "light";

// Focus ring for keyboard navigation only (see index.css).
installFocusSource();

// Expose the app store for automated media capture tooling.
// Keeping this always-on avoids brittle build-time env coupling.
(window as unknown as Record<string, unknown>).__CSLOPE_STORE__ = useAppStore;
// The result plot exactly as "Export PNG" saves it (website images).
(window as unknown as Record<string, unknown>).__CSLOPE_EXPORT_PNG__ = paperPngDataUrl;

/** The base64 of the `?base64` import as bytes. */
function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// The engine is compiled asynchronously (a browser's main thread must, for
// a module of this size) before the first render; after that every engine
// call is synchronous, and the workers get the compiled module.
void initEngine(base64Bytes(engineWasm)).then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
        <LongTitleTooltip />
      </ErrorBoundary>
    </StrictMode>,
  );
  (window as unknown as Record<string, unknown>).__CSLOPE_CAPTURE_READY__ = true;
}, (err: unknown) => {
  // Without the engine the app cannot work: say why instead of a blank window.
  const root = document.getElementById("root")!;
  root.textContent = `cSlope could not start its analysis engine: ${err instanceof Error ? err.message : String(err)}`;
  root.style.padding = "2rem";
  console.error(err);
});
