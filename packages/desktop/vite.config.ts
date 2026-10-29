import { defineConfig } from "vite";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(path.join(__dirname, "package.json"), "utf8"),
) as { version: string };

/**
 * `import s from "file?base64"`: the file's bytes as a base64 string, for a
 * binary the app must carry inside a bundle (the HiGHS WebAssembly of the
 * limit analysis bounds, which a worker cannot fetch from file://).
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

export default defineConfig({
  worker: { format: "es", plugins: () => [base64Import()] },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    base64Import(),
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
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("jspdf")) return "vendor-jspdf";
            if (id.includes("jsts")) return "vendor-jsts";
            if (id.includes("react")) return "vendor-react";
          }
        },
      },
    },
  },
});
