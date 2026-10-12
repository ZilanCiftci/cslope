import { describe, expect, it } from "vitest";
import vercel from "../vercel.json";
import { routes } from "./routes";

/** A Vercel rewrite source ("/docs/:path*") as a regular expression. */
function sourceToRegExp(source: string): RegExp {
  const pattern = source
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\/:\w+\*/g, "(?:/.*)?")
    .replace(/:\w+/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

/** A concrete URL for a react-router path ("/docs/*" -> "/docs/x"). */
const sample = (path: string) => path.replace(/\*/g, "x").replace(/:\w+/g, "x");

const rewrites = vercel.rewrites.filter((r) => r.destination === "/index.html").map((r) => sourceToRegExp(r.source));
const rewritten = (url: string) => rewrites.some((re) => re.test(url));

describe("routes and vercel.json", () => {
  it("rewrite every page to index.html (the docs are checked one by one in links.test.ts)", () => {
    const pages = routes.map((r) => r.path).filter((p) => !p.includes("*"));
    expect(pages.filter((p) => !rewritten(sample(p)))).toEqual([]);
    expect(rewritten("/docs")).toBe(true);
  });

  it("leave unknown URLs and assets alone, so they get a real 404", () => {
    expect(rewritten("/no-such-page")).toBe(false);
    expect(rewritten("/docs/no-such-page")).toBe(false);
    expect(rewritten("/assets/index-old.js")).toBe(false);
  });
});
