/**
 * Pre-render every page into dist after the client and server builds:
 *
 *  - dist/<path>/index.html for each page and documentation page, with the
 *    page's HTML in #root and its own title, description, og:title,
 *    og:description and, when the origin is known, canonical and og:url;
 *    on docs pages, the stylesheets of the lazily loaded docs;
 *  - dist/404.html, the not-found page (served by Vercel with a 404 status);
 *  - dist/sitemap.xml and a Sitemap line in dist/robots.txt, when the
 *    origin is known.
 *
 * Usage: bun scripts/prerender.ts [dist] [dist-ssr]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { siteOrigin } from "./site-origin";

export interface PageHead {
  title: string;
  description: string;
  /** The absolute URL of the page, or "" when the origin is unknown. */
  url: string;
  noindex?: boolean;
  /** Extra tags for the head (stylesheets). */
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

export function sitemap(origin: string, paths: string[]): string {
  const urls = paths.map((p) => `  <url><loc>${escapeText(origin + (p === "/" ? "/" : p))}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** The file a path is served from: "/" -> index.html, "/docs" -> docs/index.html. */
export const outputFile = (path: string) => (path === "/" ? "index.html" : `${path.replace(/^\/+/, "")}/index.html`);

interface ServerEntry {
  sitePaths(): string[];
  render(url: string): Promise<{ html: string; title: string; description: string }>;
}

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

  for (const path of paths) {
    const page = await entry.render(path);
    const file = join(dist, outputFile(path));
    mkdirSync(dirname(file), { recursive: true });
    const url = origin && origin + (path === "/" ? "/" : path);
    const links = path === "/docs" || path.startsWith("/docs/") ? docsLinks : [];
    writeFileSync(file, fillTemplate(template, page.html, { ...page, url, links }));
  }

  const missing = await entry.render("/404");
  writeFileSync(join(dist, "404.html"), fillTemplate(template, missing.html, { ...missing, url: "", noindex: true }));

  const robots = join(dist, "robots.txt");
  let robotsText = readFileSync(robots, "utf8").trimEnd() + "\n";
  if (origin) {
    writeFileSync(join(dist, "sitemap.xml"), sitemap(origin, paths));
    robotsText += `\nSitemap: ${origin}/sitemap.xml\n`;
  }
  writeFileSync(robots, robotsText);

  // The server build and the manifest are only needed here.
  rmSync(ssr, { recursive: true, force: true });
  rmSync(dirname(manifestFile), { recursive: true, force: true });
  console.log(`Pre-rendered ${paths.length} pages and 404.html${origin ? ` for ${origin}` : " (no origin: no sitemap)"}`);
}

if (import.meta.main) await main();
