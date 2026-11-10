import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "dist",
    "dist-electron",
    "release",
    "coverage",
    ".nyc_output",
    // The DWG reader's generated WebAssembly glue (packages/dwg-rs/tools/build-dwg-wasm.ts).
    "src/dwg-wasm",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests: fakes, mocks and parsed fixtures are typed `any` on purpose
    // (vi.fn(), the Electron fakes, JSON read back), so the no-unsafe-*
    // rules only restate that; and expect(obj.method) is how a mocked
    // method is checked, which unbound-method reports. The promise rules
    // stay on.
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // Build and capture tooling that no tsconfig covers: linted without type information.
    files: ["tools/**", "vitest.config.ts", "windowsSign.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
]);
