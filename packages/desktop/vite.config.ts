import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
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
