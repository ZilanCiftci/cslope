import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ThemeProvider } from "@/components/theme-provider";
import { App } from "./App";
import "./index.css";

const app = (
  <StrictMode>
    <ThemeProvider defaultTheme="system">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);

// Pages are pre-rendered at build time (scripts/prerender.ts) and hydrated
// here; the development server serves an empty root.
const root = document.getElementById("root")!;
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
