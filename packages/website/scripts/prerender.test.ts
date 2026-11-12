// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fillTemplate, hasFormulas, lastCommitTime, outputFile, lazyStylesheets, sitemap } from "./prerender";

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
  it("lists every page under the origin, with its last change where known", () => {
    const xml = sitemap("https://cslope.example", [{ path: "/" }, { path: "/docs" }, { path: "/docs/theory", lastmod: "2026-03-04" }]);
    expect(xml).toContain("<url><loc>https://cslope.example/</loc></url>");
    expect(xml).toContain("<url><loc>https://cslope.example/docs/theory</loc><lastmod>2026-03-04</lastmod></url>");
    expect(xml.match(/<url>/g)).toHaveLength(3);
  });
});

describe("lastCommitTime", () => {
  // In a repository of its own: the checkout the tests run in can be a
  // shallow clone (CI), where the date of the boundary commit is left out.
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "cslope-lastmod-"));
    git(dir, "init", "-q");
    writeFileSync(join(dir, "a.txt"), "a");
    git(dir, "add", "a.txt");
    git(dir, "commit", "-q", "-m", "a");
    return dir;
  };

  it("dates committed files and not unknown ones", () => {
    const dir = repo();
    try {
      expect(lastCommitTime(["a.txt"], dir)).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(lastCommitTime(["no-such-file.txt"], dir)).toBeUndefined();
      expect(lastCommitTime([], dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gives no date for the boundary commit of a shallow clone", () => {
    const dir = repo();
    try {
      writeFileSync(join(dir, "b.txt"), "b");
      git(dir, "add", "b.txt");
      git(dir, "commit", "-q", "-m", "b");
      const shallow = git(dir, "rev-parse", "--path-format=absolute", "--git-path", "shallow");
      // As a clone of depth 1 records it: the last commit is the boundary.
      writeFileSync(shallow, git(dir, "rev-parse", "HEAD") + "\n");
      expect(lastCommitTime(["b.txt"], dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("og:type and formulas", () => {
  it("sets og:type when given", () => {
    const html = fillTemplate(template, "", { title: "T", description: "D", url: "", type: "article" });
    expect(html).toContain('<meta property="og:type" content="article" />');
  });

  it("finds formulas in a rendered page", () => {
    expect(hasFormulas('<span class="katex">x</span>')).toBe(true);
    expect(hasFormulas("<p>No formulas</p>")).toBe(false);
  });
});
