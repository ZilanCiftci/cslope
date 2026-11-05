/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import type { AnalysisResult } from "@cslope/engine";
import { INK_TOKENS, PRINT_INK, type CanvasInk } from "./ink";
import { drawAnnotations, drawCriticalSurface } from "../pdf/pdf-drawing";
import { DEFAULT_PIEZO_LINE, DEFAULT_RESULT_VIEW_SETTINGS } from "../../store/defaults";

// (vitest runs from packages/desktop)
const CSS = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");

/** The custom properties of the first rule whose selector starts with `selector`. */
function block(selector: string): Map<string, string> {
  const start = CSS.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(CSS.indexOf("{", start) + 1, CSS.indexOf("}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}
const norm = (c: string) => c.replace(/\s+/g, "").toLowerCase();

describe("canvas ink tokens", () => {
  const dark = block(":root,");
  const light = block('[data-theme="light"]');

  it("the light theme's ink is the print colours (the light theme draws as before)", () => {
    for (const [key, token] of Object.entries(INK_TOKENS)) {
      expect(light.get(token), token).toBeDefined();
      expect(norm(light.get(token)!), token).toBe(norm(PRINT_INK[key as keyof CanvasInk]));
    }
  });

  it("the dark theme sets every ink token", () => {
    for (const token of Object.values(INK_TOKENS)) expect(dark.get(token), token).toBeDefined();
  });

  it("every canvas token of the dark theme is also set in the light theme (it would inherit the dark one)", () => {
    const missing = [...dark.keys()].filter((t) => t.startsWith("--color-canvas-") && !light.has(t));
    expect(missing).toEqual([]);
  });
});

describe("the PDF keeps the print colours in the dark theme", () => {
  const root = () => document.documentElement;
  beforeEach(() => {
    for (const [token, value] of block(":root,")) if (token.startsWith("--color-canvas-")) root().style.setProperty(token, value);
  });
  afterEach(() => {
    for (const token of block(":root,").keys()) root().style.removeProperty(token);
  });

  function recorder() {
    const pdf = new jsPDF({ unit: "mm", format: [297, 210], orientation: "landscape" });
    const colors: string[] = [];
    for (const name of ["setDrawColor", "setFillColor", "setTextColor"] as const) {
      const original = (pdf[name] as (...a: unknown[]) => unknown).bind(pdf);
      (pdf as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        colors.push(`${name}(${args.join(",")})`);
        return original(...args);
      };
    }
    return { pdf, colors };
  }

  it("draws the critical surface and its FOS label black, and a text annotation's default colour black", () => {
    // the tokens are in effect
    expect(getComputedStyle(root()).getPropertyValue("--color-canvas-ink").trim()).toBe("#eef0f2");
    const cs = { cx: 15, cy: 14, radius: 9, fos: 1.234, entryPoint: [8, 10], exitPoint: [22, 5] } as unknown as NonNullable<AnalysisResult["criticalSurface"]>;
    const result = { minFOS: 1.234, maxFOS: 1.8, criticalSurface: cs, allSurfaces: [cs], criticalSlices: [], method: "Bishop", elapsedMs: 1 } as unknown as AnalysisResult;
    const tf = { worldToPdf: (x: number, y: number) => [20 + x * 5, 150 - y * 5] as [number, number], canvasToPdf: (x: number, y: number) => [x * 0.25, y * 0.25] as [number, number], mmPerPx: 0.25, paperW: 297, paperH: 210 };
    const coords: [number, number][] = [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]];
    const rvs = { ...DEFAULT_RESULT_VIEW_SETTINGS, annotations: [], showFosLabel: true, showCentreMarker: true, showSlices: false };

    const surface = recorder();
    drawCriticalSurface(surface.pdf, tf, result, rvs, coords);
    expect(surface.colors).toContain("setDrawColor(0,0,0)");
    expect(surface.colors).toContain("setTextColor(0,0,0)");
    expect(surface.colors.filter((c) => /238,240,242/.test(c))).toEqual([]);

    const text = recorder();
    drawAnnotations(text.pdf, tf, [{ id: "t", type: "text", x: 0.1, y: 0.1, text: "Plain" }], result, [], DEFAULT_PIEZO_LINE, {}, [], { x: 0, y: 0, w: 297, h: 210 });
    expect(text.colors).toContain("setTextColor(0,0,0)");
  });
});
