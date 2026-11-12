// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { render, sitePaths, sourceFiles } from "./entry-server";

describe("pre-rendering", () => {
  it("lists every page and documentation page once", () => {
    const paths = sitePaths();
    expect(paths).toContain("/");
    expect(paths).toContain("/docs");
    expect(paths).toContain("/docs/tutorials/first-analysis");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("renders a page with its title and description", async () => {
    const page = await render("/features");
    expect(page.title).toBe("Features: limit equilibrium slope analysis · cSlope");
    expect(page.html).toContain("<h1");
  });

  it("links the home and download pages to the browser version", async () => {
    for (const path of ["/", "/download"]) {
      const { html } = await render(path);
      expect(html).toMatch(/<a href="https:\/\/app\.cslope\.com" target="_blank" rel="noopener noreferrer"[^>]*>Try in the browser/);
    }
  });

  it("renders a lazy docs page in full", async () => {
    const page = await render("/docs/theory");
    expect(page.title).toBe("Theory: limit equilibrium methods · Docs · cSlope");
    expect(page.html).toContain("Morgenstern");
    expect(page.html).toContain('class="katex"');
    // Inline, not a hidden boundary that a script reveals later.
    expect(page.html).not.toContain("<!--$?-->");
    expect(page.html).not.toContain("<template");
  });

  it("renders an unknown docs URL as dist/404.html, which Vercel serves for it", async () => {
    // The same page; only the menu marks Docs as current, an attribute that
    // React leaves as the server wrote it.
    const [docs, other] = await Promise.all([render("/docs/no-such-page"), render("/404")]);
    const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main(docs.html)).toBe(main(other.html));
    expect(main(docs.html)).toContain("Page not found");
    expect(main(docs.html)).not.toContain("Loading");
    expect(docs.title).toBe(other.title);
  });

  it("renders the not-found page for an unknown URL", async () => {
    const page = await render("/no-such-page");
    expect(page.title).toBe("Page not found · cSlope");
    expect(page.html).toContain("Page not found");
  });
});

describe("search engines", () => {
  it("give every page its own title and description, of a length search results show whole", async () => {
    const pages = await Promise.all(sitePaths().map(async (path) => ({ path, ...(await render(path)) })));
    const unique = (key: "title" | "description") => new Set(pages.map((p) => p[key])).size;
    expect(unique("title")).toBe(pages.length);
    expect(unique("description")).toBe(pages.length);
    for (const p of pages) {
      expect([p.path, p.title.length <= 70]).toEqual([p.path, true]);
      expect([p.path, p.description.length >= 50 && p.description.length <= 210]).toEqual([p.path, true]);
      expect([p.path, (p.html.match(/<h1[\s>]/g) ?? []).length]).toEqual([p.path, 1]);
    }
  }, 60_000);

  it("date every page from source files that exist", () => {
    const root = join(import.meta.dirname, "..");
    for (const path of sitePaths()) {
      const files = sourceFiles(path);
      expect([path, files.length > 0]).toEqual([path, true]);
      for (const f of files) expect([path, f, existsSync(join(root, f))]).toEqual([path, f, true]);
    }
  });
});
