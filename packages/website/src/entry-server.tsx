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
import { DOCS, docPath } from "@/docs/registry";
import { PageMetaCollector, pageTitle, type PageMeta } from "@/lib/page-meta";
import { routes } from "@/routes";
import { SITE } from "@/site";
import { App } from "./App";

/** Every URL the site has: the pages and each documentation page. */
export function sitePaths(): string[] {
  const pages = routes.map((r) => r.path).filter((p) => !p.includes("*"));
  return [...pages, ...DOCS.map(docPath)];
}

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
  let meta: PageMeta = { title: pageTitle(null), description: SITE.description };
  // The innermost page to render last wins (a docs page that is not found
  // renders NotFound).
  const html = await toHtml(url, (m) => {
    meta = m;
  });
  if (html.includes("<!--$?-->")) throw new Error(`${url}: a part of the page is not inline`);
  return { html, ...meta };
}
