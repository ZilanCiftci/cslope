/**
 * The documentation's paths, without loading the documentation itself: the
 * glob is not eager, so only the file names end up in the main bundle.
 */

/** The path under /docs of a file in src/docs ("tutorials/index.mdx" -> "tutorials"). */
export const slugOf = (file: string) => file.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "");

/** A slug without leading or trailing slashes. */
export const cleanSlug = (slug: string) => slug.replace(/^\/+|\/+$/g, "");

const SLUGS = new Set(Object.keys(import.meta.glob("./**/*.mdx")).map((p) => slugOf(p.replace(/^\.\//, ""))));

export const isDocSlug = (slug: string) => SLUGS.has(cleanSlug(slug));
