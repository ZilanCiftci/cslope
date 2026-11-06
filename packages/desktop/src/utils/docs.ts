import { isElectron } from "./is-electron";

/** The online documentation (the website's /docs pages). */
export const DOCS_URL = "https://cslope.com/docs";

/** The source code repository (also fixed in electron/main.ts). */
export const SOURCE_URL = "https://github.com/ZilanCiftci/cslope";

/** The third-party notices in the repository (the app opens its installed copy). */
const NOTICES_URL = `${SOURCE_URL}/blob/main/packages/desktop/THIRD-PARTY-NOTICES.txt`;

/**
 * Open the documentation in the browser: its first page, or `page` (a path
 * under /docs with an optional heading, such as "analysis#method").
 */
export function openDocumentation(page?: string): void {
  if (isElectron) window.cslope.openDocumentation(page);
  else window.open(page ? `${DOCS_URL}/${page}` : DOCS_URL, "_blank", "noopener");
}

/** Help › About's links: the third-party licenses, or the source code. */
export function openAboutLink(target: "licenses" | "source"): void {
  if (isElectron) window.cslope.openAboutLink(target);
  else window.open(target === "source" ? SOURCE_URL : NOTICES_URL, "_blank", "noopener");
}
