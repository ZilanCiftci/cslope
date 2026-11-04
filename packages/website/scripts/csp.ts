/**
 * The site's Content-Security-Policy, set by Vercel from vercel.json. The
 * only inline script is the theme script of index.html (it must run before
 * the first paint, so it cannot be a file); it is allowed by its hash,
 * which scripts/csp.test.ts keeps equal to the script and check-csp.ts
 * checks against every built page.
 */
import { createHash } from "node:crypto";

/** The sha256 source hashes of the inline scripts of an HTML document, as CSP writes them. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    hashes.push(`'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
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
