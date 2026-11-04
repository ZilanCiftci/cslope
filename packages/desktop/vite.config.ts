import { defineConfig } from "vite";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { metaCsp, PRODUCTION_CSP } from "./electron/csp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(path.join(__dirname, "package.json"), "utf8"),
) as { version: string };

/**
 * `import s from "file?base64"`: the file's bytes as a base64 string, for a
 * binary the app must carry inside a bundle (the engine's WebAssembly,
 * which cannot be fetched from file://; main.tsx compiles it and posts the
 * module to the workers).
 */
function base64Import(): Plugin {
  return {
    name: "cslope-base64-import",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith("?base64")) return null;
      const r = await this.resolve(source.slice(0, -"?base64".length), importer, { skipSelf: true });
      return r ? `${r.id}?base64` : null;
    },
    load(id) {
      if (!id.endsWith("?base64")) return null;
      const file = id.slice(0, -"?base64".length);
      return `export default ${JSON.stringify(readFileSync(file).toString("base64"))};`;
    },
  };
}

/**
 * The production Content Security Policy as a <meta> in the built
 * index.html (electron/csp.ts): a fallback for the header main.ts sets on
 * every document. Not in development, where Vite's own inline scripts need
 * the looser policy of the header.
 */
function cspMeta(): Plugin {
  return {
    name: "cslope-csp-meta",
    apply: "build",
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: metaCsp(PRODUCTION_CSP) }, injectTo: "head-prepend" }];
    },
  };
}

export default defineConfig({
  worker: { format: "es", plugins: () => [base64Import()] },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    base64Import(),
    cspMeta(),
    tailwindcss(),
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
      },
      renderer: process.env.NODE_ENV === "test" ? undefined : {},
    }),
  ],
  build: {
    // The main chunk carries the engine's WebAssembly as base64 (about 4 MB).
    chunkSizeWarningLimit: 7000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("jspdf")) return "vendor-jspdf";
            if (id.includes("react")) return "vendor-react";
          }
        },
      },
    },
  },
});
