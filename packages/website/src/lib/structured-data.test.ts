import { describe, expect, it } from "vitest";
import { DOCS } from "@/docs/registry";
import { DOC_PAGE_TITLES, docPageTitle } from "@/docs/page-titles";
import { jsonLdTag, structuredData } from "./structured-data";

const origin = "https://cslope.example";
const types = (things: Record<string, unknown>[]) => things.map((t) => t["@type"]);

describe("structured data", () => {
  it("describes the site, its publisher and the product on the home page", () => {
    const things = structuredData("/", origin);
    expect(types(things)).toEqual(["WebSite", "Organization", "SoftwareApplication"]);
    const app = things[2];
    expect(app).toMatchObject({ name: "cSlope", operatingSystem: "Windows", isAccessibleForFree: true });
    expect(app.downloadUrl).toBe(`${origin}/download`);
  });

  it("describes a documentation page as an article with its place in the docs", () => {
    const [article, trail] = structuredData("/docs/tutorials/dam", origin, { dateModified: "2026-01-02T03:04:05Z" });
    expect(article).toMatchObject({ "@type": "TechArticle", url: `${origin}/docs/tutorials/dam`, dateModified: "2026-01-02T03:04:05Z" });
    const items = (trail.itemListElement as { name: string; item: string; position: number }[]).map((i) => [i.position, i.item]);
    expect(items).toEqual([
      [1, `${origin}/docs`],
      [2, `${origin}/docs/tutorials`],
      [3, `${origin}/docs/tutorials/dam`],
    ]);
  });

  it("has none without an origin, on other pages and for unknown docs", () => {
    expect(structuredData("/", "")).toEqual([]);
    expect(structuredData("/features", origin)).toEqual([]);
    expect(structuredData("/docs/no-such-page", origin)).toEqual([]);
  });

  it("writes a script tag that text in the data cannot close", () => {
    const tag = jsonLdTag([{ "@type": "Thing", name: "</script><script>x()</script>" }]);
    expect(tag.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
    const data = JSON.parse(tag.replace(/^<script[^>]*>|<\/script>$/g, "")) as { "@graph": { name: string }[] };
    expect(data["@graph"][0].name).toBe("</script><script>x()</script>");
    expect(jsonLdTag([])).toBe("");
  });
});

describe("documentation page titles", () => {
  it("are given only for pages that exist, and mark tutorials", () => {
    const slugs = new Set(DOCS.map((d) => d.slug));
    expect(Object.keys(DOC_PAGE_TITLES).filter((s) => !slugs.has(s))).toEqual([]);
    const tutorial = DOCS.find((d) => d.slug === "tutorials/reporting")!;
    expect(docPageTitle(tutorial)).toBe("Tutorial: Reporting · Docs");
    expect(docPageTitle(DOCS.find((d) => d.slug === "water")!)).toBe("Water: piezometric lines and pore pressure · Docs");
  });
});
