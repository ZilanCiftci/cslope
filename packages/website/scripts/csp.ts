/**
 * The site's Content-Security-Policy, set by Vercel from vercel.json. The
 * only inline script is the theme script of index.html (it must run before
 * the first paint, so it cannot be a file); it is allowed by its hash,
 * which scripts/csp.test.ts keeps equal to the script and check-csp.ts
 * checks against every built page.
 */
import { createHash } from "node:crypto";

/**
 * A script element that holds data rather than code (structured data,
 * type="application/ld+json"): the browser does not run it, so the policy
 * does not apply to it.
 */
const DATA_BLOCK = /\btype\s*=\s*["']?application\/(ld\+)?json\b/i;

/** The sha256 source hashes of the inline scripts of an HTML document, as CSP writes them. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (DATA_BLOCK.test(m[1])) continue;
    hashes.push(`'sha256-${createHash("sha256").update(m[2]).digest("base64")}'`);
  }
  return hashes;
}

/** The policy, with the inline scripts allowed by hash. */
export function contentSecurityPolicy(hashes: string[]): string {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashes].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** The Content-Security-Policy header vercel.json sets for every page. */
export function vercelCsp(vercelJson: string): string | undefined {
  const config = JSON.parse(vercelJson) as { headers?: { source: string; headers: { key: string; value: string }[] }[] };
  const all = config.headers?.find((h) => h.source === "/(.*)");
  return all?.headers.find((h) => h.key.toLowerCase() === "content-security-policy")?.value;
}

/**
 * The fonts a stylesheet embeds as data: URLs (the start of each URL). The
 * policy allows fonts from the site only, so the browser blocks them.
 */
export function inlinedFonts(css: string): string[] {
  return [...css.matchAll(/url\(\s*["']?(data:(?:font\/|application\/(?:x-)?font)[^)"']{0,40})/gi)].map((m) => m[1]);
}

/** Whether a policy lets fonts load from data: URLs (font-src, else default-src). */
export function allowsDataFonts(csp: string): boolean {
  const directives = csp.split(";").map((d) => d.trim().split(/\s+/));
  const sources = directives.find((d) => d[0] === "font-src") ?? directives.find((d) => d[0] === "default-src") ?? [];
  return sources.includes("data:");
}
