import { createContext, useContext, useEffect } from "react";
import { SITE } from "@/site";

export interface PageMeta {
  title: string;
  description: string;
}

/**
 * Collects the page's title and description while it is pre-rendered
 * (scripts/prerender.ts); effects do not run there.
 */
export const PageMetaCollector = createContext<((meta: PageMeta) => void) | null>(null);

export function pageTitle(title: string | null): string {
  return title ? `${title} · ${SITE.name}` : `${SITE.name} — ${SITE.tagline}`;
}

/** Sets the document title and description for the current page. */
export function usePageMeta(title: string | null, description: string = SITE.description) {
  useContext(PageMetaCollector)?.({ title: pageTitle(title), description });
  useEffect(() => {
    const full = pageTitle(title);
    document.title = full;
    const set = (selector: string, value: string) => document.querySelector(selector)?.setAttribute("content", value);
    set('meta[name="description"]', description);
    set('meta[property="og:title"]', full);
    set('meta[property="og:description"]', description);
    // The pre-rendered page has the canonical URL of the first page loaded;
    // keep it (and og:url) on the page shown after navigating in the app.
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) {
      const path = location.pathname === "/" ? "/" : location.pathname.replace(/\/+$/, "");
      const url = new URL(canonical.href).origin + path;
      canonical.href = url;
      set('meta[property="og:url"]', url);
    }
  }, [title, description]);
}
