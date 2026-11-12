/**
 * Pre-render every page into dist after the client and server builds:
 *
 *  - dist/<path>/index.html for each page and documentation page, with the
 *    page's HTML in #root and its own title, description, og:title,
 *    og:description, og:type and, when the origin is known, canonical,
 *    og:url and structured data (JSON-LD); on docs pages with formulas, the
 *    stylesheets of the lazily loaded docs;
 *  - dist/404.html, the not-found page (served by Vercel with a 404 status);
 *  - dist/sitemap.xml, with each page's last change from git where it is
 *    known, and a Sitemap line in dist/robots.txt, when the origin is known.
 *
 * Usage: bun scripts/prerender.ts [dist] [dist-ssr]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { siteOrigin } from "./site-origin";

export interface PageHead {
  title: string;
  description: string;
  /** The absolute URL of the page, or "" when the origin is unknown. */
  url: string;
  noindex?: boolean;
  /** og:type: "article" for documentation pages, "website" (the template's) otherwise. */
  type?: "website" | "article";
  /** Extra tags for the head (stylesheets, structured data). */
  links?: string[];
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Replace a tag's content attribute, failing if the template lacks the tag. */
function setMeta(html: string, attr: "name" | "property", key: string, content: string): string {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`index.html has no <meta ${attr}="${key}">`);
  return html.replace(re, (_, a: string, b: string) => `${a}${escapeAttr(content)}${b}`);
}

/** The template (dist/index.html) with a page's HTML and head. */
export function fillTemplate(template: string, appHtml: string, head: PageHead): string {
  if (!template.includes('<div id="root"></div>')) throw new Error('index.html has no empty <div id="root">');
  let html = template.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeText(head.title)}</title>`);
  html = setMeta(html, "name", "description", head.description);
  html = setMeta(html, "property", "og:title", head.title);
  html = setMeta(html, "property", "og:description", head.description);
  if (head.type) html = setMeta(html, "property", "og:type", head.type);
  const extra: string[] = [...(head.links ?? [])];
  if (head.url) {
    extra.push(`<link rel="canonical" href="${escapeAttr(head.url)}" />`);
    extra.push(`<meta property="og:url" content="${escapeAttr(head.url)}" />`);
  }
  if (head.noindex) extra.push('<meta name="robots" content="noindex" />');
  if (extra.length) html = html.replace(/\n\s*<\/head>/, () => `\n    ${extra.join("\n    ")}\n  </head>`);
  return html.replace('<div id="root"></div>', () => `<div id="root">${appHtml}</div>`);
}

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  css?: string[];
  imports?: string[];
}

/**
 * The stylesheets of a lazy module and what it imports, from the client
 * build manifest, as tags for the head: the pre-rendered page needs them
 * before its first paint (the formulas in the docs). Its scripts are left
 * to load after the entry, so that they do not hold up the first paint.
 */
export function lazyStylesheets(manifest: Record<string, ManifestChunk>, src: string): string[] {
  if (!manifest[src]) throw new Error(`The build manifest has no ${src}`);
  const seen = new Set<string>();
  const css = new Set<string>();
  const visit = (key: string) => {
    const chunk = manifest[key];
    if (!chunk || chunk.isEntry || seen.has(key)) return;
    seen.add(key);
    chunk.css?.forEach((f) => css.add(f));
    chunk.imports?.forEach(visit);
  };
  visit(src);
  return [...css].map((f) => `<link rel="stylesheet" crossorigin href="/${f}" />`);
}

export interface SitemapEntry {
  path: string;
  /** The date of the page's last change (YYYY-MM-DD), when known. */
  lastmod?: string;
}

export function sitemap(origin: string, pages: SitemapEntry[]): string {
  const urls = pages.map(({ path: p, lastmod }) => {
    const loc = `<loc>${escapeText(origin + (p === "/" ? "/" : p))}</loc>`;
    return `  <url>${loc}${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * The time (ISO 8601) of the latest commit that changed any of these files,
 * or undefined when git cannot tell: outside a repository, for files never
 * committed, and in a shallow clone (Vercel's) when that commit is the
 * clone's boundary, which only says the change is at least that old.
 */
export function lastCommitTime(files: string[], cwd: string): string | undefined {
  if (!files.length) return undefined;
  const git = (...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const log = git("log", "-1", "--format=%H %cI", "--", ...files);
  const [hash, time] = log.status === 0 ? log.stdout.trim().split(" ") : [];
  if (!hash || !time) return undefined;
  const shallowFile = git("rev-parse", "--path-format=absolute", "--git-path", "shallow").stdout.trim();
  if (shallowFile && existsSync(shallowFile) && readFileSync(shallowFile, "utf8").split("\n").includes(hash)) return undefined;
  return time;
}

/** The file a path is served from: "/" -> index.html, "/docs" -> docs/index.html. */
export const outputFile = (path: string) => (path === "/" ? "index.html" : `${path.replace(/^\/+/, "")}/index.html`);

interface ServerEntry {
  sitePaths(): string[];
  render(url: string): Promise<{ html: string; title: string; description: string }>;
  sourceFiles(path: string): string[];
  structuredData(path: string, origin: string, options: { dateModified?: string }): Record<string, unknown>[];
  jsonLdTag(things: Record<string, unknown>[]): string;
}

/** Whether a pre-rendered docs page has formulas, which need the KaTeX stylesheet before the first paint. */
export const hasFormulas = (html: string) => html.includes('class="katex"');

async function main() {
  const dist = resolve(process.argv[2] ?? "dist");
  const ssr = resolve(process.argv[3] ?? "dist-ssr");
  const entry = (await import(pathToFileURL(join(ssr, "entry-server.js")).href)) as ServerEntry;
  const origin = siteOrigin(process.env);
  const template = readFileSync(join(dist, "index.html"), "utf8");
  const paths = entry.sitePaths();
  const manifestFile = join(dist, ".vite", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, ManifestChunk>;
  const docsLinks = lazyStylesheets(manifest, "src/pages/DocsPage.tsx");

  const root = resolve(import.meta.dirname, "..");
  const pages: SitemapEntry[] = [];
  for (const path of paths) {
    const page = await entry.render(path);
    const file = join(dist, outputFile(path));
    mkdirSync(dirname(file), { recursive: true });
    const url = origin && origin + (path === "/" ? "/" : path);
    const isDoc = path === "/docs" || path.startsWith("/docs/");
    const modified = lastCommitTime(entry.sourceFiles(path), root);
    const jsonLd = entry.jsonLdTag(entry.structuredData(path, origin, { dateModified: modified }));
    // The KaTeX stylesheet blocks the first paint, so only pages with
    // formulas link it; on the others it loads with the docs' script.
    const links = [...(isDoc && hasFormulas(page.html) ? docsLinks : []), ...(jsonLd ? [jsonLd] : [])];
    writeFileSync(file, fillTemplate(template, page.html, { ...page, url, links, type: isDoc ? "article" : undefined }));
    pages.push({ path, lastmod: modified?.slice(0, 10) });
  }

  const missing = await entry.render("/404");
  writeFileSync(join(dist, "404.html"), fillTemplate(template, missing.html, { ...missing, url: "", noindex: true }));

  const robots = join(dist, "robots.txt");
  let robotsText = readFileSync(robots, "utf8").trimEnd() + "\n";
  if (origin) {
    writeFileSync(join(dist, "sitemap.xml"), sitemap(origin, pages));
    robotsText += `\nSitemap: ${origin}/sitemap.xml\n`;
  }
  writeFileSync(robots, robotsText);

  // The server build and the manifest are only needed here.
  rmSync(ssr, { recursive: true, force: true });
  rmSync(dirname(manifestFile), { recursive: true, force: true });
  console.log(`Pre-rendered ${paths.length} pages and 404.html${origin ? ` for ${origin}` : " (no origin: no sitemap)"}`);
}

if (import.meta.main) await main();
