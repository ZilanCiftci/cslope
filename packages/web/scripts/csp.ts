/**
 * The app's Content-Security-Policy, set by Vercel from vercel.json: the
 * website's (packages/website/scripts/csp.ts) with 'wasm-unsafe-eval', which
 * the engine needs to compile its WebAssembly. The only inline script is
 * the theme script of index.html, allowed by its hash; csp.test.ts keeps
 * the hash equal to the script and check-csp.ts checks it against every
 * built page.
 */
export { allowsDataFonts, inlinedFonts, inlineScriptHashes, vercelCsp } from "../../website/scripts/csp";

/** The policy, with the inline scripts allowed by hash. */
export function contentSecurityPolicy(hashes: string[]): string {
  return [
    "default-src 'self'",
    ["script-src 'self' 'wasm-unsafe-eval'", ...hashes].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}
