import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("plotly.js")) return "vendor-plotly";
            if (id.includes("react-plotly.js")) return "vendor-plotly";
            if (id.includes("jspdf")) return "vendor-jspdf";
            if (id.includes("jsts")) return "vendor-jsts";
            if (id.includes("react")) return "vendor-react";
          }
        },
      },
    },
  },
});
