import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { useAppStore } from "./store/app-store";

// Set initial theme before first render (respect saved preference, default to light)
document.documentElement.dataset.theme =
  localStorage.getItem("cslope-theme") || "light";

// Expose the app store for automated media capture tooling.
// Keeping this always-on avoids brittle build-time env coupling.
(window as unknown as Record<string, unknown>).__CSLOPE_STORE__ = useAppStore;
(window as unknown as Record<string, unknown>).__CSLOPE_CAPTURE_READY__ = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
