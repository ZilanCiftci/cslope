// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fillTemplate, outputFile, lazyStylesheets, sitemap } from "./prerender";

const template = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");

describe("fillTemplate", () => {
  const head = { title: 'Docs · "cSlope" & <more> $&', description: "A page.", url: "" };

  it("puts the page in #root and its title and description in the head", () => {
    const html = fillTemplate(template, "<main>$& $1 content</main>", head);
    expect(html).toContain('<div id="root"><main>$& $1 content</main></div>');
    expect(html).toContain("<title>Docs · \"cSlope\" &amp; &lt;more&gt; $&amp;</title>");
    expect(html).toContain('content="A page."');
    expect(html).toContain('<meta property="og:title" content="Docs · &quot;cSlope&quot; &amp; &lt;more&gt; $&amp;"');
    expect(html).not.toContain("canonical");
    expect(html).not.toContain("noindex");
  });

  it("adds canonical, og:url, noindex and extra tags when given", () => {
    const html = fillTemplate(template, "", {
      ...head,
      url: "https://cslope.example/docs",
      noindex: true,
      links: ['<link rel="modulepreload" href="/assets/x.js" />'],
    });
    const headPart = html.slice(0, html.indexOf("</head>"));
    expect(headPart).toContain('<link rel="canonical" href="https://cslope.example/docs" />');
    expect(headPart).toContain('<meta property="og:url" content="https://cslope.example/docs" />');
    expect(headPart).toContain('<meta name="robots" content="noindex" />');
    expect(headPart).toContain('<link rel="modulepreload" href="/assets/x.js" />');
  });

  it("fails on a template without the tags it replaces", () => {
    expect(() => fillTemplate("<html></html>", "", head)).toThrow(/root/);
    expect(() => fillTemplate('<head></head><div id="root"></div>', "", head)).toThrow(/description/);
  });
});

describe("outputFile", () => {
  it("serves / from index.html and every other page from its folder", () => {
    expect(outputFile("/")).toBe("index.html");
    expect(outputFile("/docs")).toBe("docs/index.html");
    expect(outputFile("/docs/tutorials/dam")).toBe("docs/tutorials/dam/index.html");
  });
});

describe("lazyStylesheets", () => {
  const manifest = {
    "index.html": { file: "assets/index.js", isEntry: true, css: ["assets/index.css"] },
    "src/pages/DocsPage.tsx": {
      file: "assets/DocsPage.js",
      src: "src/pages/DocsPage.tsx",
      css: ["assets/DocsPage.css"],
      imports: ["index.html", "_shared.js"],
    },
    "_shared.js": { file: "assets/shared.js", css: ["assets/DocsPage.css", "assets/shared.css"] },
  };

  it("lists the lazy module's stylesheets once, not the entry's", () => {
    expect(lazyStylesheets(manifest, "src/pages/DocsPage.tsx")).toEqual([
      '<link rel="stylesheet" crossorigin href="/assets/DocsPage.css" />',
      '<link rel="stylesheet" crossorigin href="/assets/shared.css" />',
    ]);
  });

  it("fails when the module is not in the manifest", () => {
    expect(() => lazyStylesheets(manifest, "src/pages/Missing.tsx")).toThrow(/Missing/);
  });
});

describe("sitemap", () => {
  it("lists every page under the origin", () => {
    const xml = sitemap("https://cslope.example", ["/", "/docs", "/docs/theory"]);
    expect(xml).toContain("<loc>https://cslope.example/</loc>");
    expect(xml).toContain("<loc>https://cslope.example/docs/theory</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(3);
  });
});
