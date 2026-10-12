import { useEffect } from "react";
import { SITE } from "@/site";

/** Sets the document title and description for the current page. */
export function usePageMeta(title: string | null, description: string = SITE.description) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE.name}` : `${SITE.name} — ${SITE.tagline}`;
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [title, description]);
}
