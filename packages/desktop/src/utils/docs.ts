import { isElectron } from "./is-electron";

/** The online documentation (the website's /docs pages). */
export const DOCS_URL = "https://cslope.com/docs";

/**
 * Open the documentation in the browser: its first page, or `page` (a path
 * under /docs with an optional heading, such as "analysis#method").
 */
export function openDocumentation(page?: string): void {
  if (isElectron) window.cslope.openDocumentation(page);
  else window.open(page ? `${DOCS_URL}/${page}` : DOCS_URL, "_blank", "noopener");
}
