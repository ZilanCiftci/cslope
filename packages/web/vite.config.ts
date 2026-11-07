import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

/**
 * The engine the page runs, recorded with a result in a downloaded project
 * (src/engine/project.ts), as the desktop app records its own: the engine
 * package's version and the source hash of its WebAssembly build.
 */
function engineBuild(): { version: string; sourceHash: string } {
  const read = (file: string) => JSON.parse(readFileSync(path.join(__dirname, "../engine", file), "utf8")) as Record<string, unknown>;
  const version = read("package.json").version;
  const sourceHash = read("src/wasm/BUILD-INFO.json").sourceHash;
  return { version: typeof version === "string" ? version : "", sourceHash: typeof sourceHash === "string" ? sourceHash : "" };
}

const webVersion = (JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")) as { version: string }).version;

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
  define: {
    __ENGINE_BUILD__: JSON.stringify(engineBuild()),
    __WEB_VERSION__: JSON.stringify(webVersion),
  },
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
