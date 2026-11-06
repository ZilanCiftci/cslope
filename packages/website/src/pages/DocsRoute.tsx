import { lazy, Suspense } from "react";
import { useParams } from "react-router";
import { Loading } from "@/components/Loading";
import { isDocSlug } from "@/docs/slugs";
import { NotFound } from "@/pages/NotFound";

// The documentation (every page, its formulas and their stylesheet) loads
// only when a docs page is opened.
const DocsPage = lazy(() => import("@/pages/DocsPage").then((m) => ({ default: m.DocsPage })));

/**
 * /docs and every path under it. An unknown path renders NotFound outside
 * the lazy boundary, as dist/404.html does, so that the not-found page
 * hydrates without loading the documentation.
 */
export function DocsRoute() {
  const slug = useParams()["*"] ?? "";
  if (!isDocSlug(slug)) return <NotFound />;
  return (
    <Suspense fallback={<Loading label="Loading the documentation" />}>
      <DocsPage />
    </Suspense>
  );
}
