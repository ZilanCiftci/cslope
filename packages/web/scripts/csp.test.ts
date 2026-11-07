import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowsDataFonts, contentSecurityPolicy, inlineScriptHashes, vercelCsp } from "./csp";
import { contentSecurityPolicy as websitePolicy } from "../../website/scripts/csp";

const root = join(import.meta.dirname, "..");
const vercel = () => vercelCsp(readFileSync(join(root, "vercel.json"), "utf8"));

describe("content security policy", () => {
  it("vercel.json allows exactly the inline theme script of index.html, and WebAssembly", () => {
    const hashes = inlineScriptHashes(readFileSync(join(root, "index.html"), "utf8"));
    expect(hashes).toHaveLength(1);
    expect(vercel()).toBe(contentSecurityPolicy(hashes));
    expect(vercel()).toContain("script-src 'self' 'wasm-unsafe-eval'");
  });

  it("is the website's policy apart from WebAssembly", () => {
    const hashes = ["'sha256-x'"];
    expect(contentSecurityPolicy(hashes).replace(" 'wasm-unsafe-eval'", "")).toBe(websitePolicy(hashes));
  });

  it("the theme script is the website's", () => {
    const script = (html: string) => html.match(/<script>([\s\S]*?)<\/script>/)![1];
    expect(script(readFileSync(join(root, "index.html"), "utf8"))).toBe(script(readFileSync(join(root, "../website/index.html"), "utf8")));
  });

  it("blocks fonts from data: URLs, so none may be inlined", () => {
    expect(allowsDataFonts(vercel()!)).toBe(false);
  });
});
