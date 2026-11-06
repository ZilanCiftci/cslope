/**
 * Fails when a built page has an inline script that the Content-Security-
 * Policy of vercel.json does not allow by hash (the theme script of
 * index.html is the only one), when a built stylesheet embeds a font as a
 * data: URL that the policy blocks (#63), or when the policy is missing.
 * Run on dist/ after every build: a page the policy blocks would lose its
 * theme script or a font, silently.
 *
 *   bun scripts/check-csp.ts dist
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { allowsDataFonts, inlineScriptHashes, inlinedFonts, vercelCsp } from "./csp";

function walk(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => walk(join(path, name))) : [path];
}

const dist = process.argv[2] ?? "dist";
const csp = vercelCsp(readFileSync(join(import.meta.dirname, "../vercel.json"), "utf8"));
if (!csp) {
  console.error("vercel.json sets no Content-Security-Policy for /(.*)");
  process.exit(1);
}
const problems: string[] = [];
let pages = 0;
for (const file of walk(dist).filter((f) => f.endsWith(".html"))) {
  pages++;
  for (const hash of inlineScriptHashes(readFileSync(file, "utf8"))) {
    if (!csp.includes(hash)) problems.push(`${file}: inline script ${hash} is not allowed by the policy`);
  }
}
if (!allowsDataFonts(csp)) {
  for (const file of walk(dist).filter((f) => f.endsWith(".css"))) {
    for (const font of inlinedFonts(readFileSync(file, "utf8"))) {
      problems.push(`${file}: a font is inlined as ${font}…, which font-src blocks; emit it as a file`);
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`The policy allows the inline scripts of all ${pages} pages and every font.`);
