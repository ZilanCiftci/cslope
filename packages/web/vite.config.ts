import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/** Font files, which are never inlined (see build.assetsInlineLimit). */
const FONT_FILE = /\.(woff2?|ttf|otf|eot)$/i;

/**
 * The browser app (app.cslope.com): Vite + React + Tailwind as the website
 * (packages/website), with the engine in a Web Worker. The engine's
 * WebAssembly is imported as a URL (src/engine/engine-module.ts), so the
 * build copies it to dist/assets with a content hash in its name, where
 * vercel.json gives it a long cache; the main thread fetches and compiles
 * it once and posts the module to the worker.
 */
export default defineConfig({
  build: {
    // Fonts are always emitted as files: the policy allows fonts from the
    // site only (font-src 'self'), so a font inlined as a data: URL would be
    // blocked (the website's #63).
    assetsInlineLimit: (file: string) => (FONT_FILE.test(file) ? false : undefined),
  },
  // The analysis worker is a module worker, bundled on its own.
  worker: { format: "es" },
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
