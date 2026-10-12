import "katex/dist/katex.min.css";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { ChevronLeft, ChevronRight, Menu, Pencil } from "lucide-react";

import { DOCS, SECTIONS, docPath, findDoc, type Doc } from "@/docs/registry";
import { MDX_COMPONENTS } from "@/docs/mdx-components";
import { usePageMeta } from "@/lib/page-meta";
import { NotFound } from "@/pages/NotFound";
import { SITE } from "@/site";
import { cn } from "@/lib/utils";

function Sidebar({ current, onNavigate }: { current: Doc; onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation" className="space-y-6 text-sm">
      {SECTIONS.map((section) => {
        const docs = DOCS.filter((d) => d.section === section);
        if (!docs.length) return null;
        return (
          <div key={section}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section}</h2>
            <ul className="space-y-0.5 border-l">
              {docs.map((d) => (
                <li key={d.slug}>
                  <NavLink
                    to={docPath(d)}
                    end
                    onClick={onNavigate}
                    aria-current={d === current ? "page" : undefined}
                    className={cn(
                      "-ml-px block border-l py-1.5 pl-3 transition-colors hover:border-foreground/40 hover:text-foreground",
                      d === current ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground",
                    )}
                  >
                    {d.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** The h2 and h3 headings of the rendered article, for the page contents. */
function useHeadings(article: React.RefObject<HTMLElement | null>, key: string): Heading[] {
  const [headings, setHeadings] = useState<Heading[]>([]);
  useEffect(() => {
    // Read the rendered article once it is on the page.
    const frame = requestAnimationFrame(() => {
      const el = article.current;
      if (!el) return;
      setHeadings(
        [...el.querySelectorAll<HTMLHeadingElement>("h2[id], h3[id]")].map((h) => ({
          id: h.id,
          text: h.textContent ?? "",
          level: h.tagName === "H2" ? 2 : 3,
        })),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [article, key]);
  return headings;
}

function PageContents({ headings }: { headings: Heading[] }) {
  if (headings.length < 2) return null;
  return (
    <nav aria-label="On this page" className="text-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</h2>
      <ul className="space-y-1.5">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "pl-3" : undefined}>
            <a href={`#${h.id}`} className="text-muted-foreground hover:text-foreground">
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DocsPage() {
  const slug = useParams()["*"] ?? "";
  const doc = findDoc(slug);
  const article = useRef<HTMLElement>(null);
  const headings = useHeadings(article, slug);
  const [menuOpen, setMenuOpen] = useState(false);
  usePageMeta(doc ? (doc.slug ? `${doc.title} · Docs` : "Documentation") : "Page not found", doc?.description);

  if (!doc) return <NotFound />;
  const i = DOCS.indexOf(doc);
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="grid gap-10 py-10 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_12rem]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-8">
            <Sidebar current={doc} />
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-6 lg:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="docs-menu"
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
              Documentation menu
            </button>
            {menuOpen && (
              <div id="docs-menu" className="mt-4 rounded-lg border bg-surface p-4">
                <Sidebar current={doc} onNavigate={() => setMenuOpen(false)} />
              </div>
            )}
          </div>

          <p className="text-sm font-medium text-primary">{doc.section}</p>
          <article
            ref={article}
            className="prose prose-slate mt-2 max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:before:content-none prose-code:after:content-none prose-img:rounded-lg"
          >
            <h1>{doc.title}</h1>
            <p className="lead">{doc.description}</p>
            <doc.Component components={MDX_COMPONENTS} />
          </article>

          <div className="mt-12 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:justify-between">
            {prev ? (
              <Link to={docPath(prev)} className="group flex flex-col rounded-lg border p-4 hover:border-primary sm:w-[48%]">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ChevronLeft className="h-3 w-3" aria-hidden="true" /> Previous
                </span>
                <span className="mt-1 font-medium group-hover:text-primary">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link
                to={docPath(next)}
                className="group flex flex-col items-end rounded-lg border p-4 text-right hover:border-primary sm:w-[48%]"
              >
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  Next <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </span>
                <span className="mt-1 font-medium group-hover:text-primary">{next.title}</span>
              </Link>
            )}
          </div>
          <a
            href={`${SITE.github}/edit/main/packages/website/src/docs/${doc.file}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Suggest a change to this page
          </a>
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-24">
            <PageContents headings={headings} />
          </div>
        </aside>
      </div>
    </div>
  );
}
