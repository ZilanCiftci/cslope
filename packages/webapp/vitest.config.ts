/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    alias: {
      "react-plotly.js": resolve(
        __dirname,
        "src/test/__mocks__/react-plotly.js.tsx",
      ),
    },
  },
});
