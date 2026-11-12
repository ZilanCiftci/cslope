/**
 * Server entry for pre-rendering (scripts/prerender.ts): every page is
 * rendered to HTML at build time, so that it is readable without
 * JavaScript and search engines and link previews see its content, title
 * and description. The browser then hydrates it (main.tsx).
 */
import { StrictMode } from "react";
import { prerender } from "react-dom/static";
import { StaticRouter } from "react-router";
import { ThemeProvider } from "@/components/theme-provider";
import { DOCS, docPath, findDoc } from "@/docs/registry";
import { PageMetaCollector, pageTitle, type PageMeta } from "@/lib/page-meta";
import { routes } from "@/routes";
import { SITE } from "@/site";
import { App } from "./App";

/** Every URL the site has: the pages and each documentation page. */
export function sitePaths(): string[] {
  const pages = routes.map((r) => r.path).filter((p) => !p.includes("*"));
  return [...pages, ...DOCS.map(docPath)];
}

/**
 * The source files of the page at a path, relative to packages/website:
 * the latest commit to any of them dates the page in the sitemap
 * (lastmod) and its structured data (dateModified).
 */
const PAGE_SOURCES: Record<string, string[]> = {
  "/": ["src/pages/Home.tsx", "src/content/home.ts", "src/content/home-examples.ts"],
  "/features": ["src/pages/Features.tsx"],
  "/verification": ["src/pages/Verification.tsx", "src/content/generated/verification.json"],
  "/download": ["src/pages/Download.tsx"],
  "/about": ["src/pages/About.tsx"],
  "/changelog": ["../../CHANGELOG.md"],
};

export function sourceFiles(path: string): string[] {
  if (path === "/docs" || path.startsWith("/docs/")) {
    const doc = findDoc(path.slice("/docs".length));
    return doc ? [`src/docs/${doc.file}`] : [];
  }
  return PAGE_SOURCES[path] ?? [];
}

export { jsonLdTag, structuredData } from "@/lib/structured-data";

export interface Rendered extends PageMeta {
  html: string;
}

function app(url: string, collect: (meta: PageMeta) => void) {
  return (
    <StrictMode>
      <PageMetaCollector.Provider value={collect}>
        <ThemeProvider defaultTheme="system">
          <StaticRouter location={url}>
            <App />
          </StaticRouter>
        </ThemeProvider>
      </PageMetaCollector.Provider>
    </StrictMode>
  );
}

/**
 * React writes a large Suspense boundary (the lazy docs page) as a hidden
 * segment that a script reveals after the rest of the page, which shows the
 * page without its content at first and then shifts the layout. Pre-rendered
 * pages are served whole, so every boundary is written inline.
 */
const toHtml = async (url: string, collect: (meta: PageMeta) => void) => {
  const { prelude } = await prerender(app(url, collect), { progressiveChunkSize: Number.POSITIVE_INFINITY });
  return new Response(prelude).text();
};

/** The app's HTML at this URL, with every page fully rendered. */
export async function render(url: string): Promise<Rendered> {
  let meta: PageMeta = { title: pageTitle(null), description: SITE.metaDescription };
  // The innermost page to render last wins (a docs page that is not found
  // renders NotFound).
  const html = await toHtml(url, (m) => {
    meta = m;
  });
  if (html.includes("<!--$?-->")) throw new Error(`${url}: a part of the page is not inline`);
  return { html, ...meta };
}
