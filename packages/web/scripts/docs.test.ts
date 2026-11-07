// @vitest-environment node
/**
 * The page's note and its documentation (packages/website/src/docs/
 * browser.mdx) say the same: the page links there, and the page starts
 * with the note's sentence; its section "Limitations" is the link's target.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_URL, LIMITATIONS_URL, TEMPLATE_NOTE } from "../src/links";
import { SPECS } from "../src/form/specs";

const doc = readFileSync(join(import.meta.dirname, "../../website/src/docs/browser.mdx"), "utf8");

describe("the documentation of the page", () => {
  it("has the note's sentence and the limitations the note links to", () => {
    expect(DOCS_URL).toBe("https://cslope.com/docs/browser");
    expect(doc).toContain(TEMPLATE_NOTE);
    expect(LIMITATIONS_URL).toBe(`${DOCS_URL}#limitations`);
    expect(doc).toMatch(/^## Limitations$/m);
  });

  it("names every template by its title and its id in the address", () => {
    for (const s of SPECS) {
      expect(doc).toContain(`**${s.template.title}.**`);
      expect(doc).toContain(`t=${s.template.id}`);
    }
  });
});
