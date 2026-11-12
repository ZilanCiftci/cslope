import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowsDataFonts, contentSecurityPolicy, inlinedFonts, inlineScriptHashes, vercelCsp } from "./csp";

const root = join(import.meta.dirname, "..");

describe("content security policy", () => {
  it("hashes an inline script's source exactly", () => {
    // echo -n 'x' | openssl dgst -sha256 -binary | base64
    expect(inlineScriptHashes("<script>x</script><script src=\"a.js\"></script>")).toEqual(["'sha256-LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE='"]);
    expect(inlineScriptHashes('<script type="module" src="/src/main.tsx"></script>')).toEqual([]);
  });

  it("leaves out structured data, which the browser does not run", () => {
    expect(inlineScriptHashes('<script type="application/ld+json">{"@context":"https://schema.org"}</script><script>x</script>')).toEqual([
      "'sha256-LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE='",
    ]);
  });

  it("vercel.json allows exactly the inline theme script of index.html", () => {
    const hashes = inlineScriptHashes(readFileSync(join(root, "index.html"), "utf8"));
    expect(hashes).toHaveLength(1);
    expect(vercelCsp(readFileSync(join(root, "vercel.json"), "utf8"))).toBe(contentSecurityPolicy(hashes));
  });

  it("finds fonts a stylesheet embeds as data: URLs (#63)", () => {
    const css = `@font-face{font-family:KaTeX_Size3;src:url(data:font/woff2;base64,d09GMgAB) format("woff2"),url(/assets/KaTeX_Size3.woff) format("woff")}` +
      `.x{background:url("data:image/svg+xml;utf8,<svg/>")}@font-face{src:url('data:application/font-woff;base64,AAAA')}`;
    expect(inlinedFonts(css)).toEqual(["data:font/woff2;base64,d09GMgAB", "data:application/font-woff;base64,AAAA"]);
    expect(inlinedFonts("@font-face{src:url(/assets/a.woff2)}")).toEqual([]);
  });

  it("the site's policy blocks fonts from data: URLs, so none may be inlined", () => {
    expect(allowsDataFonts(vercelCsp(readFileSync(join(root, "vercel.json"), "utf8"))!)).toBe(false);
    expect(allowsDataFonts("default-src 'self'; font-src 'self' data:")).toBe(true);
    expect(allowsDataFonts("default-src 'self' data:")).toBe(true);
  });
});
