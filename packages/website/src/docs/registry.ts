import type { ComponentType } from "react";
import type { MDXComponents } from "mdx/types";
import { cleanSlug, slugOf } from "./slugs";

/** The sidebar groups, in order. */
export const SECTIONS = ["Getting started", "Modelling", "Analysis", "Results", "Tutorials", "Reference"] as const;
export type DocSection = (typeof SECTIONS)[number];

export interface DocFrontmatter {
  title: string;
  description: string;
  section: DocSection;
  /** Position within the section. */
  order: number;
}

export interface Doc extends DocFrontmatter {
  /** The path under /docs ("" for the overview, "tutorials/first-analysis"). */
  slug: string;
  /** The source file, relative to src/docs. */
  file: string;
  Component: ComponentType<{ components?: MDXComponents }>;
}

interface DocModule {
  default: Doc["Component"];
  frontmatter?: Partial<DocFrontmatter>;
}

/** A doc from its module, with its frontmatter checked. */
export function toDoc(file: string, m: DocModule): Doc {
  const f = m.frontmatter ?? {};
  const missing = (["title", "description", "section", "order"] as const).filter((k) => f[k] === undefined);
  if (missing.length) throw new Error(`${file}: frontmatter is missing ${missing.join(", ")}`);
  if (!SECTIONS.includes(f.section as DocSection)) throw new Error(`${file}: unknown section "${f.section}"`);
  const slug = slugOf(file);
  return { ...(f as DocFrontmatter), slug, file, Component: m.default };
}

const modules = import.meta.glob<DocModule>("./**/*.mdx", { eager: true });

/** Every doc, in sidebar order. */
export const DOCS: Doc[] = Object.entries(modules)
  .map(([path, m]) => toDoc(path.replace(/^\.\//, ""), m))
  .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order);

export const docPath = (d: Doc) => (d.slug ? `/docs/${d.slug}` : "/docs");

export function findDoc(slug: string): Doc | undefined {
  const clean = cleanSlug(slug);
  return DOCS.find((d) => d.slug === clean);
}
