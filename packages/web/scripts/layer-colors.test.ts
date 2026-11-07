/**
 * The layers' colors: the first swatches are the app's material colors
 * (copied from the desktop app's store, not imported), every swatch has its
 * own name, and on every swatch, as the drawing shows it over the card in
 * each theme, the theme's ink (the layers' names) has a contrast of 4.5:1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_MATERIAL_COLORS, appMaterialColor, defaultLayerColor, LAYER_COLORS, LAYER_FILL_OPACITY, layerColorOf } from "../src/templates/colors";

/** A file as text: the app's store is read, not imported. */
const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
const appDefaults = read("../../desktop/src/store/defaults.ts");
const indexCss = read("../src/index.css");
const sectionSource = read("../src/section/Section.tsx");

/** An HSL triple of index.css ("222 47% 11%") as RGB 0–255. */
function hsl(text: string): [number, number, number] {
  const [h, s, l] = text.split(/\s+/).map((v) => parseFloat(v));
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** A theme's variables in index.css: ":root" or ".dark". */
function theme(selector: ":root" | ".dark"): Record<string, string> {
  const css = indexCss;
  const block = css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("the layers' colors", () => {
  it("start with the app's material colors, in its order", () => {
    const store = appDefaults;
    const app = /export const MATERIAL_COLORS = \[([^\]]*)\]/.exec(store)?.[1].match(/#[0-9a-f]{6}/gi);
    expect(app).toEqual([...APP_MATERIAL_COLORS]);
    expect(LAYER_COLORS.slice(0, app!.length).map((c) => c.color)).toEqual(app);
    for (let i = 0; i < 12; i++) expect(appMaterialColor(i)).toBe(app![i % app!.length]);
  });

  it("are 14 swatches, each with its own color and name, the layers in turn by default", () => {
    expect(LAYER_COLORS).toHaveLength(14);
    expect(new Set(LAYER_COLORS.map((c) => c.color)).size).toBe(14);
    expect(new Set(LAYER_COLORS.map((c) => c.name)).size).toBe(14);
    for (const c of LAYER_COLORS) expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(defaultLayerColor(0)).toBe("#d4a373");
    expect(defaultLayerColor(14)).toBe("#d4a373");
    expect(layerColorOf("A0522D")).toBe("#a0522d");
    expect(layerColorOf("#a0522d")).toBe("#a0522d");
    expect(layerColorOf("123456")).toBeNull();
    expect(layerColorOf(null)).toBeNull();
  });

  it("keep the layers' names readable in the drawing, in both themes", () => {
    expect(sectionSource).toContain(`"[fill-opacity:${LAYER_FILL_OPACITY.light}] dark:[fill-opacity:${LAYER_FILL_OPACITY.dark}]"`);
    for (const selector of [":root", ".dark"] as const) {
      const vars = theme(selector);
      const card = hsl(vars.card);
      const ink = hsl(vars.foreground);
      const opacity = LAYER_FILL_OPACITY[selector === ":root" ? "light" : "dark"];
      for (const c of LAYER_COLORS) {
        const fill = hex(c.color).map((v, i) => opacity * v + (1 - opacity) * card[i]) as [number, number, number];
        expect(contrast(fill, ink), `${c.name} in ${selector}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
