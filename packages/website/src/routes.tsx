import type { ReactNode } from "react";
import { Home } from "@/pages/Home";
import { Docs } from "@/pages/Docs";

/**
 * The site's pages. Every path here must also be rewritten to index.html
 * in vercel.json (routes.test.ts checks this); other URLs get dist/404.html
 * with a real 404 status.
 */
export const routes: { path: string; element: ReactNode }[] = [
  { path: "/", element: <Home /> },
  { path: "/docs", element: <Docs /> },
];
