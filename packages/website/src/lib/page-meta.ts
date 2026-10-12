import { createContext, useContext, useEffect } from "react";
import { useLocation } from "react-router";
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

/** The site's origin, from the canonical link of the first page loaded (none without a known origin). */
let canonicalOrigin: string | null | undefined;

/**
 * Sets the document title and description for the current page. A page
 * that is not found passes `canonical: false`: it has no canonical URL.
 */
export function usePageMeta(
  title: string | null,
  description: string = SITE.description,
  { canonical = true }: { canonical?: boolean } = {},
) {
  const { pathname } = useLocation();
  useContext(PageMetaCollector)?.({ title: pageTitle(title), description });
  useEffect(() => {
    const full = pageTitle(title);
    document.title = full;
    const set = (selector: string, value: string) => document.querySelector(selector)?.setAttribute("content", value);
    set('meta[name="description"]', description);
    set('meta[property="og:title"]', full);
    set('meta[property="og:description"]', description);
    // The pre-rendered page has the canonical URL of the first page loaded;
    // keep it (and og:url) in step with the page shown after navigating.
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonicalOrigin === undefined) canonicalOrigin = link ? new URL(link.href).origin : null;
    if (!canonicalOrigin) return;
    if (!canonical) {
      link?.remove();
      return;
    }
    const url = canonicalOrigin + (pathname === "/" ? "/" : pathname.replace(/\/+$/, ""));
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.append(link);
    }
    link.href = url;
    set('meta[property="og:url"]', url);
  }, [title, description, canonical, pathname]);
}
