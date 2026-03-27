/**
 * Store-injection capture — hydrate Zustand store with benchmark state,
 * wait for canvas render, extract PNG via canvas.toDataURL().
 *
 * This module is evaluated by Bun and communicates with the Electron
 * renderer process via Playwright's page.evaluate().
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate() runs in renderer context without type imports */

import type { Page } from "playwright";
import type { Scene } from "../../../website/src/content/media-scene-types";
import { RENDER_SETTLE_MS, ANALYSIS_TIMEOUT_MS } from "./capture-config";

/**
 * Capture a single scene by injecting state into the renderer store.
 *
 * Steps:
 *  1. Load benchmarks into the store.
 *  2. Switch to the target model (by name).
 *  3. Apply scene-specific overrides (mode, resultView settings).
 *  4. If needed, run analysis and wait for completion.
 *  5. Wait for canvas render.
 *  6. Extract the canvas as a PNG data URL.
 */
export async function captureScene(page: Page, scene: Scene): Promise<Buffer> {
  // 1. Load benchmarks and switch to the target model
  await page.evaluate(
    ({ benchmarkName, setup }) => {
      const store = (window as any).__CSLOPE_STORE__;
      if (!store)
        throw new Error(
          "Store bridge not available — is VITE_CAPTURE_MODE set?",
        );

      // Load all benchmark models
      store.getState().loadBenchmarks();

      // Find and switch to the requested model
      const state = store.getState();
      const target = state.models.find((m: any) => m.name === benchmarkName);
      if (!target) {
        const names = state.models.map((m: any) => m.name).join(", ");
        throw new Error(
          `Benchmark "${benchmarkName}" not found. Available: ${names}`,
        );
      }
      store.getState().switchModel(target.id);

      // 2. Apply mode
      if (setup.mode) {
        store.getState().setMode(setup.mode);
      }

      // 3. Apply result-view overrides
      if (setup.resultView) {
        const current = store.getState().resultViewSettings;
        store.getState().setResultViewSettings({
          ...current,
          ...setup.resultView,
        });
      }
    },
    { benchmarkName: scene.benchmark, setup: scene.setup },
  );

  // 4. Run analysis if requested
  if (scene.setup.runAnalysis) {
    await page.evaluate(() => {
      const store = (window as any).__CSLOPE_STORE__;
      store.getState().runAnalysis();
    });

    // Poll for analysis completion
    await page.waitForFunction(
      () => {
        const store = (window as any).__CSLOPE_STORE__;
        const state = store.getState();
        return state.runState === "done" || state.runState === "error";
      },
      { timeout: ANALYSIS_TIMEOUT_MS },
    );

    // Check for errors
    const runState = await page.evaluate(() => {
      const store = (window as any).__CSLOPE_STORE__;
      const s = store.getState();
      return { runState: s.runState, error: s.errorMessage };
    });

    if (runState.runState === "error") {
      throw new Error(`Analysis failed for "${scene.id}": ${runState.error}`);
    }

    // Switch to result mode after analysis completes
    await page.evaluate(() => {
      const store = (window as any).__CSLOPE_STORE__;
      store.getState().setMode("result");
    });
  }

  // 5. Let the canvas render settle
  await page.waitForTimeout(RENDER_SETTLE_MS);

  // 6. Extract canvas as PNG
  const dataUrl = await page.evaluate((crop) => {
    const canvas = document.querySelector(
      "[data-testid='slope-canvas']",
    ) as HTMLCanvasElement | null;
    if (!canvas) throw new Error("Canvas element not found");

    if (crop === "canvas") {
      // Crop to the paper-frame area (same logic as existing PNG export)
      return canvas.toDataURL("image/png");
    }
    return canvas.toDataURL("image/png");
  }, scene.output.crop);

  // Convert data URL to Buffer
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Buffer.from(base64, "base64");
}
