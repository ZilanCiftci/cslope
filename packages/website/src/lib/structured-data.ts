/**
 * Structured data (schema.org, as JSON-LD) for the pre-rendered pages
 * (scripts/prerender.ts): what the site is, who publishes it and what the
 * product is on the home page, and on documentation pages the article and
 * its place in the documentation. Search engines read it; nothing on the
 * page shows it. It is written only when the site's origin is known, since
 * its URLs must be absolute.
 */
import { OFFERED_VERSION } from "@/content/release";
import { DOCS, docPath, findDoc } from "@/docs/registry";
import { SITE } from "@/site";

type Thing = Record<string, unknown>;

const ids = (origin: string) => ({
  website: `${origin}/#website`,
  organization: `${origin}/#organization`,
  software: `${origin}/#software`,
});

function organization(origin: string): Thing {
  return {
    "@type": "Organization",
    "@id": ids(origin).organization,
    name: SITE.company.name,
    url: SITE.company.url,
  };
}

function website(origin: string): Thing {
  return {
    "@type": "WebSite",
    "@id": ids(origin).website,
    name: SITE.name,
    url: `${origin}/`,
    inLanguage: "en",
    publisher: { "@id": ids(origin).organization },
  };
}

function software(origin: string): Thing {
  return {
    "@type": "SoftwareApplication",
    "@id": ids(origin).software,
    name: SITE.name,
    description: SITE.metaDescription,
    url: `${origin}/`,
    applicationCategory: "EngineeringApplication",
    applicationSubCategory: "Slope stability analysis",
    operatingSystem: "Windows",
    softwareVersion: OFFERED_VERSION,
    downloadUrl: `${origin}/download`,
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    image: `${origin}/og-image.png`,
    publisher: { "@id": ids(origin).organization },
    codeRepository: SITE.github,
  };
}

function breadcrumbs(items: { name: string; url: string }[]): Thing {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: item.url })),
  };
}

/**
 * The JSON-LD of the page at this path: a list of schema.org things, empty
 * for a page that has none.
 * `dateModified` (ISO 8601) is the last change to the page's source, when known.
 */
export function structuredData(path: string, origin: string, { dateModified }: { dateModified?: string } = {}): Thing[] {
  if (!origin) return [];
  if (path === "/") return [website(origin), organization(origin), software(origin)];
  const docs = path === "/docs" ? "" : path.startsWith("/docs/") ? path.slice("/docs/".length) : null;
  if (docs === null) return [];
  const doc = findDoc(docs);
  if (!doc) return [];
  const url = origin + docPath(doc);
  const trail = [{ name: "Documentation", url: `${origin}/docs` }];
  const tutorials = DOCS.find((d) => d.slug === "tutorials");
  if (doc.section === "Tutorials" && doc.slug !== "tutorials" && tutorials) {
    trail.push({ name: tutorials.title, url: origin + docPath(tutorials) });
  }
  if (doc.slug) trail.push({ name: doc.title, url });
  return [
    {
      "@type": "TechArticle",
      headline: doc.title,
      description: doc.description,
      url,
      mainEntityOfPage: url,
      inLanguage: "en",
      ...(dateModified ? { dateModified } : {}),
      // Whole, not by @id: the things they would refer to are on the home page.
      isPartOf: { "@type": "WebSite", "@id": ids(origin).website, name: SITE.name, url: `${origin}/` },
      publisher: organization(origin),
      about: { "@type": "SoftwareApplication", "@id": ids(origin).software, name: SITE.name },
    },
    breadcrumbs(trail),
  ];
}

/**
 * The script tag that carries the page's structured data. "<" is written
 * as its JSON escape, so that no text in it can close the tag.
 */
export function jsonLdTag(things: Thing[]): string {
  if (!things.length) return "";
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": things }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
