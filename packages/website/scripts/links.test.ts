// @vitest-environment node
/**
 * Every internal link on the site (in the pages' code and in the docs)
 * points at a page that exists: a route, or a doc under /docs.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { outputFile } from "./prerender";

const src = join(import.meta.dirname, "../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const all = files(src).filter((f) => /\.(tsx?|mdx)$/.test(f) && !/\.test\./.test(f));

/** A path relative to `from`, with forward slashes on every platform. */
const rel = (from: string, f: string) => relative(from, f).split(sep).join("/");

/** Doc paths from the files in src/docs ("index.mdx" is /docs). */
const docPaths = new Set(
  all
    .filter((f) => rel(src, f).startsWith("docs/") && f.endsWith(".mdx"))
    .map((f) => "/docs/" + rel(join(src, "docs"), f).replace(/\.mdx$/, "").replace(/(^|\/)index$/, ""))
    .map((p) => p.replace(/\/$/, "")),
);

/** Top-level pages from routes.tsx. */
const routes = [...readFileSync(join(src, "routes.tsx"), "utf8").matchAll(/path: "([^"]+)"/g)].map((m) => m[1]);

function exists(path: string): boolean {
  const p = path.replace(/[#?].*$/, "").replace(/\/$/, "") || "/";
  if (p === "/docs" || p.startsWith("/docs/")) return docPaths.has(p);
  return routes.includes(p);
}

/** Internal links: to="/x", to: "/x", docs: "/x", href="/x" and Markdown ](/x). */
const LINK = /(?:\bto=|\bto:\s*|\bdocs:\s*|\bhref=)"(\/[^"]*)"|\]\((\/[^)\s]*)\)/g;

describe("internal links", () => {
  it("find the docs and routes", () => {
    expect(docPaths.has("/docs")).toBe(true);
    expect(routes).toContain("/");
  });

  it("all point at pages that exist", () => {
    const broken: string[] = [];
    for (const f of all) {
      for (const m of readFileSync(f, "utf8").matchAll(LINK)) {
        const link = m[1] ?? m[2];
        // Files under public/ (images, the share image) are not pages.
        if (/\.(png|svg|pdf|ico|json|txt)$/.test(link) || link.startsWith("/media/")) continue;
        if (!exists(link)) broken.push(`${rel(src, f)}: ${link}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("to a heading point at a heading that exists", () => {
    const broken: string[] = [];
    for (const f of all) {
      for (const m of readFileSync(f, "utf8").matchAll(LINK)) {
        const [path, fragment] = (m[1] ?? m[2]).split("#");
        if (!fragment || !(path === "/docs" || path.startsWith("/docs/"))) continue;
        const ids = headingIds(path);
        if (ids && !ids.has(fragment)) broken.push(`${rel(src, f)}: ${path}#${fragment}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

/**
 * The ids rehype-slug gives a doc's headings (GitHub's slugs: lower case,
 * punctuation removed, spaces to hyphens, "-1" for repeats), or null when
 * the path is not a doc.
 */
function headingIds(path: string): Set<string> | null {
  const docPath = (f: string) => ("/docs/" + rel(join(src, "docs"), f).replace(/\.mdx$/, "").replace(/(^|\/)index$/, "")).replace(/\/$/, "");
  const file = all.find((f) => f.endsWith(".mdx") && rel(src, f).startsWith("docs/") && docPath(f) === path.replace(/\/$/, ""));
  if (!file) return null;
  const seen = new Map<string, number>();
  const ids = new Set<string>();
  // Headings outside code blocks.
  const text = readFileSync(file, "utf8").replace(/^```[\s\S]*?^```/gm, "");
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const text = m[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Emphasis and code marks go; underscores stay, as in github-slugger.
      .replace(/[*`]/g, "")
      .replace(/\$[^$]*\$/g, (x) => x.slice(1, -1));
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.add(n ? `${base}-${n}` : base);
  }
  return ids;
}

describe("vercel.json", () => {
  const vercel = JSON.parse(readFileSync(join(src, "../vercel.json"), "utf8")) as {
    rewrites: { source: string; destination: string }[];
  };
  const sources = vercel.rewrites.map((r) => r.source);

  it("rewrites exactly the pages and docs, so any other URL gets a real 404", () => {
    const pages = routes.filter((r) => !r.includes("*"));
    expect([...sources].sort()).toEqual([...new Set([...pages, ...docPaths])].sort());
  });

  it("serves each page from its pre-rendered file (scripts/prerender.ts)", () => {
    const wrong = vercel.rewrites.filter((r) => r.destination !== "/" + outputFile(r.source));
    expect(wrong).toEqual([]);
  });
});

describe("images in the docs", () => {
  const sizes = JSON.parse(readFileSync(join(src, "content/generated/media-sizes.json"), "utf8")) as Record<string, unknown>;

  it("exist and have a size (run bun scripts/media-sizes.ts after capturing)", () => {
    const missing: string[] = [];
    for (const f of all.filter((f) => f.endsWith(".mdx"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/<Figure[^>]*\bsrc="([^"]+)"/g)) {
        if (!(m[1] in sizes)) missing.push(`${rel(src, f)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
