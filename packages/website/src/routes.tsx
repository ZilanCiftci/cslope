import { lazy, Suspense, type ReactNode } from "react";
import { DocsLoading } from "@/components/DocsLoading";
import { Home } from "@/pages/Home";
// The documentation (every page, its formulas and their stylesheet) loads
// only when a docs page is opened.
const DocsPage = lazy(() => import("@/pages/DocsPage").then((m) => ({ default: m.DocsPage })));
import { Features } from "@/pages/Features";
import { Verification } from "@/pages/Verification";
import { Download } from "@/pages/Download";
import { About } from "@/pages/About";
import { Changelog } from "@/pages/Changelog";

/**
 * The site's pages. Every path here must also be rewritten to index.html
 * in vercel.json (routes.test.ts checks this); other URLs get dist/404.html
 * with a real 404 status.
 */
export const routes: { path: string; element: ReactNode }[] = [
  { path: "/", element: <Home /> },
  { path: "/features", element: <Features /> },
  { path: "/verification", element: <Verification /> },
  { path: "/download", element: <Download /> },
  // The overview at /docs and every page under it.
  {
    path: "/docs/*",
    element: (
      <Suspense fallback={<DocsLoading />}>
        <DocsPage />
      </Suspense>
    ),
  },
  { path: "/about", element: <About /> },
  { path: "/changelog", element: <Changelog /> },
];
