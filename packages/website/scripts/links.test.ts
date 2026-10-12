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
});

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
