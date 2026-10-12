// @vitest-environment node
import { describe, expect, it } from "vitest";
import { render, sitePaths } from "./entry-server";

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
    expect(page.title).toBe("Features · cSlope");
    expect(page.html).toContain("<h1");
  });

  it("renders a lazy docs page in full", async () => {
    const page = await render("/docs/theory");
    expect(page.title).toBe("Theory · Docs · cSlope");
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
