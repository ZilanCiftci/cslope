import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS, SECTIONS, docPath, findDoc, toDoc } from "./registry";
import { isDocSlug } from "./slugs";
import { parseFrontmatter } from "../../scripts/frontmatter";

describe("docs registry", () => {
  it("loads every doc with a unique path, in section order", () => {
    const paths = DOCS.map(docPath);
    expect(new Set(paths).size).toBe(paths.length);
    expect(findDoc("")?.title).toBe("Documentation");
    const order = DOCS.map((d) => SECTIONS.indexOf(d.section));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("finds a doc with or without slashes", () => {
    expect(findDoc("/")).toBe(findDoc(""));
  });

  it("knows the same paths without loading the docs", () => {
    for (const d of DOCS) expect(isDocSlug(d.slug)).toBe(true);
    expect(isDocSlug("/tutorials/")).toBe(true);
    expect(isDocSlug("no-such-page")).toBe(false);
  });

  it("rejects missing frontmatter and unknown sections", () => {
    const C = () => null;
    expect(() => toDoc("x.mdx", { title: "T" }, C)).toThrow(/missing description, section, order/);
    expect(() =>
      toDoc("x.mdx", { title: "T", description: "D", section: "Other" as never, order: 1 }, C),
    ).toThrow(/unknown section/);
    expect(toDoc("tutorials/index.mdx", { title: "T", description: "D", section: "Tutorials", order: 0 }, C).slug).toBe(
      "tutorials",
    );
  });

  it("reads each page's frontmatter as its compiled page exports it", async () => {
    const pages = import.meta.glob<{ frontmatter: unknown }>("./**/*.mdx");
    expect(Object.keys(pages).length).toBe(DOCS.length);
    for (const d of DOCS) {
      const { frontmatter } = await pages[`./${d.file}`]();
      const { title, description, section, order } = d;
      expect({ title, description, section, order }).toEqual(frontmatter);
    }
  });

  it("parses only flat frontmatter of strings and numbers", () => {
    const text = readFileSync(join(import.meta.dirname, "index.mdx"), "utf8");
    expect(parseFrontmatter("index.mdx", text)).toMatchObject({ title: "Documentation", order: 0 });
    expect(parseFrontmatter("x", '---\ntitle: "A: b"\norder: 2.5\n---\n')).toEqual({ title: "A: b", order: 2.5 });
    expect(() => parseFrontmatter("x", "---\ntags:\n  - a\n---\n")).toThrow(/not "key: value"/);
    expect(() => parseFrontmatter("x", "---\nlist: [a, b]\n---\n")).toThrow(/not a plain string/);
    expect(() => parseFrontmatter("x", "# no frontmatter")).toThrow(/no frontmatter/);
  });
});
