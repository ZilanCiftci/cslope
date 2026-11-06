/// <reference types="node" />
/**
 * Every theme token the sources use (var(--color-…)) must be defined in a
 * stylesheet: an undefined variable makes the browser drop the whole
 * declaration, so a border or background silently disappears.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// (vitest runs from packages/desktop; under jsdom import.meta.url is not a file URL)
const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("theme tokens", () => {
  it("every var(--color-…) used in src is defined in a stylesheet", () => {
    const all = files(SRC);
    const defined = new Set<string>();
    const used = new Map<string, string>();
    for (const path of all) {
      const text = readFileSync(path, "utf8");
      if (path.endsWith(".css")) {
        for (const m of text.matchAll(/(--color-[\w-]+)\s*:/g)) defined.add(m[1]);
      }
      for (const m of text.matchAll(/var\((--color-[\w-]+)/g)) {
        if (!used.has(m[1])) used.set(m[1], path.slice(SRC.length + 1));
      }
    }
    const missing = [...used].filter(([name]) => !defined.has(name)).map(([name, where]) => `${name} (${where})`);
    expect(missing).toEqual([]);
  });
});

/** The tokens of one theme's block in index.css (the dark theme is :root). */
function themeTokens(theme: "dark" | "light"): Map<string, string> {
  const css = readFileSync(join(SRC, "index.css"), "utf8");
  const start = css.indexOf(theme === "dark" ? '[data-theme="dark"] {' : '[data-theme="light"] {');
  const block = css.slice(start, css.indexOf("\n}", start));
  return new Map([...block.matchAll(/(--color-[\w-]+)\s*:\s*(#[0-9a-f]{3,6})\s*;/gi)].map((m) => [m[1], m[2]]));
}

/** WCAG contrast ratio of two #rgb or #rrggbb colors. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : hex;
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme contrast", () => {
  // Text and the backgrounds it is drawn on: 4.5:1 or more (WCAG AA).
  const pairs: [text: string, background: string][] = [
    ["--color-vsc-text-muted", "--color-vsc-bg"],
    ["--color-vsc-text-muted", "--color-vsc-panel"],
    ["--color-vsc-text-muted", "--color-vsc-sidebar"],
    ["--color-vsc-text-muted", "--color-vsc-status"],
    ["--color-vsc-warning-text", "--color-vsc-bg"],
    ["--color-vsc-warning-text", "--color-vsc-panel"],
    ["--color-canvas-grid-text", "--color-canvas-bg"],
    ["--color-canvas-paper-ticks", "--color-canvas-paper"],
  ];
  for (const theme of ["dark", "light"] as const) {
    it.each(pairs)(`${theme}: %s on %s is 4.5:1 or more`, (text, background) => {
      const tokens = themeTokens(theme);
      const fg = tokens.get(text);
      const bg = tokens.get(background);
      expect(fg && bg).toBeTruthy();
      expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("chart series contrast", () => {
  // Lines and bars in the result windows' charts are graphics, not text:
  // 3:1 or more on the panel they are drawn on (WCAG non-text contrast).
  const series = ["--color-chart-1", "--color-chart-2", "--color-chart-3", "--color-chart-4"];
  for (const theme of ["dark", "light"] as const) {
    it.each(series)(`${theme}: %s on the panel is 3:1 or more`, (token) => {
      const tokens = themeTokens(theme);
      const fg = tokens.get(token);
      const bg = tokens.get("--color-vsc-panel");
      expect(fg && bg).toBeTruthy();
      expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(3);
    });
  }
});
