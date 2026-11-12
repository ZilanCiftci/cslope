/** The website's pages the app links to (packages/website/src/routes.tsx). */
export const SITE_URL = "https://cslope.com";
export const DOWNLOAD_URL = `${SITE_URL}/download`;
/** The documentation of the page itself: what the templates do and do not do (packages/website/src/docs/browser.mdx). */
export const DOCS_URL = `${SITE_URL}/docs/browser`;
export const LIMITATIONS_URL = `${DOCS_URL}#limitations`;

/**
 * The note under the result. The documentation page (DOCS_URL) starts
 * with the same sentence; a test keeps the two equal.
 */
export const TEMPLATE_NOTE = "This is a template calculation. Check the model and the result before you use them in a design.";
