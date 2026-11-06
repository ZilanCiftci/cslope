/**
 * The theme is a copy of the website's (decision B6): every CSS variable of
 * packages/website/src/index.css, in the same block, with the same value.
 * A change there must be made here too, and this test says so.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = join(import.meta.dirname, "../src/index.css");
const website = join(import.meta.dirname, "../../website/src/index.css");

/**
 * The custom properties of a stylesheet, keyed by the blocks that hold them
 * ("@layer base > :root > --background") with their values.
 */
export function cssVariables(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const stack: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    const close = css.indexOf("}", i);
    const semi = css.indexOf(";", i);
    const next = [open, close, semi].filter((n) => n >= 0).reduce((a, b) => Math.min(a, b), css.length);
    const text = css.slice(i, next).trim();
    if (next === css.length) break;
    if (next === open) {
      stack.push(text.replace(/\s+/g, " "));
    } else if (next === close) {
      stack.pop();
    } else if (text.startsWith("--")) {
      const colon = text.indexOf(":");
      out.set(`${stack.join(" > ")} > ${text.slice(0, colon).trim()}`, text.slice(colon + 1).trim());
    }
    i = next + 1;
  }
  return out;
}

describe("the theme", () => {
  it("reads the variables of a stylesheet by block", () => {
    expect(cssVariables(":root { --a: 1; } .dark { --a: 2; color: red; }")).toEqual(
      new Map([
        [":root > --a", "1"],
        [".dark > --a", "2"],
      ]),
    );
  });

  it("has every CSS variable of the website's theme, with the same value", () => {
    const ours = cssVariables(readFileSync(here, "utf8"));
    const theirs = cssVariables(readFileSync(website, "utf8"));
    expect(theirs.size).toBeGreaterThan(40);
    expect(Object.fromEntries(ours)).toEqual(Object.fromEntries(theirs));
  });
});
