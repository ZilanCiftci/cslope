import type { ReactNode } from "react";
import { DocsRoute } from "@/pages/DocsRoute";
import { Home } from "@/pages/Home";
import { Features } from "@/pages/Features";
import { Verification } from "@/pages/Verification";
import { Download } from "@/pages/Download";
import { About } from "@/pages/About";
import { Changelog } from "@/pages/Changelog";

/**
 * The site's pages. Each is pre-rendered (scripts/prerender.ts) and must
 * be rewritten to its file in vercel.json (routes.test.tsx and
 * links.test.ts check this); other URLs get dist/404.html with a real 404
 * status.
 */
export const routes: { path: string; element: ReactNode }[] = [
  { path: "/", element: <Home /> },
  { path: "/features", element: <Features /> },
  { path: "/verification", element: <Verification /> },
  { path: "/download", element: <Download /> },
  // The overview at /docs and every page under it.
  { path: "/docs/*", element: <DocsRoute /> },
  { path: "/about", element: <About /> },
  { path: "/changelog", element: <Changelog /> },
];
