import { lazy, type ComponentType } from "react";
import type { MDXComponents } from "mdx/types";
import { cleanSlug, slugOf } from "./slugs";

/** The sidebar groups, in order. */
export const SECTIONS = ["Getting started", "Modeling", "Analysis", "Results", "Tutorials", "Reference"] as const;
export type DocSection = (typeof SECTIONS)[number];

export interface DocFrontmatter {
  title: string;
  description: string;
  section: DocSection;
  /** Position within the section. */
  order: number;
}

export type DocComponent = ComponentType<{ components?: MDXComponents }>;

export interface Doc extends DocFrontmatter {
  /** The path under /docs ("" for the overview, "tutorials/first-analysis"). */
  slug: string;
  /** The source file, relative to src/docs. */
  file: string;
  /** The page's content, loaded when it is first rendered (render it inside Suspense). */
  Component: DocComponent;
}

/** A doc from its frontmatter, checked, and its content. */
export function toDoc(file: string, frontmatter: Partial<DocFrontmatter> | undefined, Component: DocComponent): Doc {
  const f = frontmatter ?? {};
  const missing = (["title", "description", "section", "order"] as const).filter((k) => f[k] === undefined);
  if (missing.length) throw new Error(`${file}: frontmatter is missing ${missing.join(", ")}`);
  if (!SECTIONS.includes(f.section as DocSection)) throw new Error(`${file}: unknown section "${f.section}"`);
  const slug = slugOf(file);
  return { ...(f as DocFrontmatter), slug, file, Component };
}

// Every page's frontmatter now (scripts/frontmatter.ts), each page's
// content (its text, formulas and figures) only when it is opened.
const frontmatters = import.meta.glob<Partial<DocFrontmatter>>("./**/*.mdx", {
  eager: true,
  query: "?frontmatter",
  import: "default",
});
const pages = import.meta.glob<DocComponent>("./**/*.mdx", { import: "default" });

/** Every doc, in sidebar order. */
export const DOCS: Doc[] = Object.entries(frontmatters)
  .map(([path, f]) => toDoc(path.replace(/^\.\//, ""), f, lazy(() => pages[path]().then((C) => ({ default: C })))))
  .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order);

export const docPath = (d: Doc) => (d.slug ? `/docs/${d.slug}` : "/docs");

export function findDoc(slug: string): Doc | undefined {
  const clean = cleanSlug(slug);
  return DOCS.find((d) => d.slug === clean);
}
