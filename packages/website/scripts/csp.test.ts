import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, inlineScriptHashes, vercelCsp } from "./csp";

const root = join(import.meta.dirname, "..");

describe("content security policy", () => {
  it("hashes an inline script's source exactly", () => {
    // echo -n 'x' | openssl dgst -sha256 -binary | base64
    expect(inlineScriptHashes("<script>x</script><script src=\"a.js\"></script>")).toEqual(["'sha256-LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE='"]);
    expect(inlineScriptHashes('<script type="module" src="/src/main.tsx"></script>')).toEqual([]);
  });

  it("vercel.json allows exactly the inline theme script of index.html", () => {
    const hashes = inlineScriptHashes(readFileSync(join(root, "index.html"), "utf8"));
    expect(hashes).toHaveLength(1);
    expect(vercelCsp(readFileSync(join(root, "vercel.json"), "utf8"))).toBe(contentSecurityPolicy(hashes));
  });
});
