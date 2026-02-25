import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Set initial theme before first render (respect saved preference, default to light)
document.documentElement.dataset.theme =
  localStorage.getItem("cslope-theme") || "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
