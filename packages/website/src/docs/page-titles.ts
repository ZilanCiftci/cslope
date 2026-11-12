import type { Doc } from "./registry";

/**
 * The browser and search-result titles of documentation pages whose own
 * title (the page's h1, from its frontmatter) is a single word that says
 * little out of context ("Water"). Keyed by slug; a page not listed here
 * uses its own title. Keep each under about 45 characters, so that with
 * " · Docs · cSlope" the title is not cut in search results.
 */
export const DOC_PAGE_TITLES: Record<string, string> = {
  analysis: "Analysis options: method and slices",
  conventions: "Conventions: coordinates and signs",
  geometry: "Geometry: section boundaries and DXF import",
  installation: "Installation on Windows",
  loads: "Loads: distributed and line loads",
  materials: "Material models and soil properties",
  python: "Python package and the cslope command",
  reporting: "Reporting: result sheet and PDF export",
  results: "Results: factor of safety, summary and plots",
  sensitivity: "Sensitivity and probability of failure",
  theory: "Theory: limit equilibrium methods",
  water: "Water: piezometric lines and pore pressure",
};

/** A documentation page's title in the browser tab and search results (without the site's suffix). */
export function docPageTitle(doc: Doc): string {
  if (!doc.slug) return "Documentation";
  // Tutorials share titles with reference pages ("Reporting"): say which.
  const tutorial = doc.section === "Tutorials" && doc.slug !== "tutorials" ? "Tutorial: " : "";
  return `${tutorial}${DOC_PAGE_TITLES[doc.slug] ?? doc.title} · Docs`;
}
