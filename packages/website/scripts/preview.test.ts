// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import vercel from "../vercel.json";
import { headersFor, resolvePath, sourceToRegExp, startPreview } from "./preview";

/** A small dist with the files vercel.json points at. */
function fakeDist(): string {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  for (const f of ["index.html", "404.html", "features/index.html", "docs/index.html", "docs/theory/index.html", "assets/index-x.js"]) {
    mkdirSync(join(dist, f, ".."), { recursive: true });
    writeFileSync(join(dist, f), f);
  }
  return dist;
}

describe("preview server", () => {
  const dist = fakeDist();
  const at = (path: string) => resolvePath(vercel, dist, path);

  it("reads vercel.json's sources as Vercel does", () => {
    expect(sourceToRegExp("/(.*)/index.html").exec("/docs/theory/index.html")?.[1]).toBe("docs/theory");
    expect(sourceToRegExp("/assets/(.*)").test("/assets/a.js")).toBe(true);
    expect(sourceToRegExp("/docs/:path*").test("/docs/a/b")).toBe(true);
    expect(sourceToRegExp("/features").test("/featuresx")).toBe(false);
    expect(sourceToRegExp("/index.html").test("/indexxhtml")).toBe(false);
  });

  it("serves each page's own pre-rendered file through the rewrites", () => {
    expect(at("/")).toEqual({ kind: "file", file: join(dist, "index.html"), status: 200 });
    expect(at("/features")).toEqual({ kind: "file", file: join(dist, "features/index.html"), status: 200 });
    expect(at("/docs/theory")).toEqual({ kind: "file", file: join(dist, "docs/theory/index.html"), status: 200 });
    expect(at("/assets/index-x.js")).toEqual({ kind: "file", file: join(dist, "assets/index-x.js"), status: 200 });
  });

  it("answers unknown paths with 404.html and a 404 status, and stays inside dist", () => {
    expect(at("/no-such-page")).toEqual({ kind: "file", file: join(dist, "404.html"), status: 404 });
    expect(at("/docs/no-such-page").status).toBe(404);
    expect(at("/../../etc/passwd").status).toBe(404);
  });

  it("redirects index.html and trailing slashes", () => {
    expect(at("/docs/theory/index.html")).toEqual({ kind: "redirect", location: "/docs/theory", status: 308 });
    expect(at("/index.html")).toEqual({ kind: "redirect", location: "/", status: 308 });
    expect(at("/features/")).toEqual({ kind: "redirect", location: "/features", status: 308 });
  });

  it("sets the content security policy on every response and caches assets", () => {
    expect(headersFor(vercel, "/features")["Content-Security-Policy"]).toMatch(/^default-src 'self'/);
    expect(headersFor(vercel, "/assets/a.js")["Cache-Control"]).toMatch(/immutable/);
    expect(headersFor(vercel, "/features")["Cache-Control"]).toBeUndefined();
  });

  it("compresses text, as Vercel does, and leaves images as they are", async () => {
    writeFileSync(join(dist, "a.png"), "png");
    const server = await startPreview({ dist, port: 0 });
    try {
      const page = await fetch(`${server.url}/features`, { headers: { "Accept-Encoding": "gzip" } });
      expect(page.headers.get("content-encoding")).toBe("gzip");
      expect(await page.text()).toBe("features/index.html");
      const image = await fetch(`${server.url}/a.png`, { headers: { "Accept-Encoding": "gzip" } });
      expect(image.headers.get("content-encoding")).toBeNull();
    } finally {
      await server.close();
    }
  });
});
