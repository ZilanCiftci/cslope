import { describe, expect, it } from "vitest";
import { DOCS, SECTIONS, docPath, findDoc, toDoc } from "./registry";
import { isDocSlug } from "./slugs";

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
    expect(() => toDoc("x.mdx", { default: C, frontmatter: { title: "T" } })).toThrow(/missing description, section, order/);
    expect(() =>
      toDoc("x.mdx", { default: C, frontmatter: { title: "T", description: "D", section: "Other" as never, order: 1 } }),
    ).toThrow(/unknown section/);
    expect(toDoc("tutorials/index.mdx", { default: C, frontmatter: { title: "T", description: "D", section: "Tutorials", order: 0 } }).slug).toBe(
      "tutorials",
    );
  });
});
