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
    document.title = pageTitle(title);
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [title, description]);
}
