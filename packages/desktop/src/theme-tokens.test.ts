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
