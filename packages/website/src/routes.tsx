import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Loading } from "@/components/Loading";
import { DocsRoute } from "@/pages/DocsRoute";
import { Home } from "@/pages/Home";
import { Features } from "@/pages/Features";
import { Download } from "@/pages/Download";
import { About } from "@/pages/About";

/**
 * A page that loads only when it is opened: the verification table and the
 * changelog are large and no other page needs them. Pre-rendering waits
 * for it, so its HTML is served whole.
 */
function lazyPage(load: () => Promise<ComponentType>): ReactNode {
  const Page = lazy(() => load().then((C) => ({ default: C })));
  return (
    <Suspense fallback={<Loading label="Loading the page" />}>
      <Page />
    </Suspense>
  );
}

/**
 * The site's pages. Each is pre-rendered (scripts/prerender.ts) and must
 * be rewritten to its file in vercel.json (routes.test.tsx and
 * links.test.ts check this); other URLs get dist/404.html with a real 404
 * status.
 */
export const routes: { path: string; element: ReactNode }[] = [
  { path: "/", element: <Home /> },
  { path: "/features", element: <Features /> },
  { path: "/verification", element: lazyPage(() => import("@/pages/Verification").then((m) => m.Verification)) },
  { path: "/download", element: <Download /> },
  // The overview at /docs and every page under it.
  { path: "/docs/*", element: <DocsRoute /> },
  { path: "/about", element: <About /> },
  { path: "/changelog", element: lazyPage(() => import("@/pages/Changelog").then((m) => m.Changelog)) },
];
