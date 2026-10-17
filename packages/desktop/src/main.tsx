import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAppStore } from "./store/app-store";
import { paperPngDataUrl } from "./features/export/paper-png";

// Set initial theme before first render (respect saved preference, default to light)
document.documentElement.dataset.theme =
  localStorage.getItem("cslope-theme") || "light";

// Expose the app store for automated media capture tooling.
// Keeping this always-on avoids brittle build-time env coupling.
(window as unknown as Record<string, unknown>).__CSLOPE_STORE__ = useAppStore;
// The result plot exactly as "Export PNG" saves it (website images).
(window as unknown as Record<string, unknown>).__CSLOPE_EXPORT_PNG__ = paperPngDataUrl;
(window as unknown as Record<string, unknown>).__CSLOPE_CAPTURE_READY__ = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
