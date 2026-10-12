import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync } from "node:fs";
import path from "path";

/**
 * dist/404.html: Vercel serves it with a 404 status for URLs that are not
 * rewritten to index.html (see vercel.json), and the app renders NotFound.
 */
function notFoundPage(): Plugin {
  let outDir = "dist";
  return {
    name: "not-found-page",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(path.join(outDir, "index.html"), path.join(outDir, "404.html"));
    },
  };
}

/**
 * The site's public origin, for the absolute URLs that link previews need
 * (og:image). VITE_SITE_URL wins; on Vercel, previews use their own URL and
 * production builds the production URL. Without an origin the tags are left
 * out rather than given a relative URL, which crawlers ignore.
 */
export function siteOrigin(env: Record<string, string | undefined>): string {
  const host =
    env.VITE_SITE_URL ||
    (env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL) ||
    env.VERCEL_PROJECT_PRODUCTION_URL ||
    "";
  if (!host) return "";
  return (/^https?:\/\//.test(host) ? host : `https://${host}`).replace(/\/+$/, "");
}

function shareImage(origin: string): Plugin {
  return {
    name: "share-image",
    transformIndexHtml() {
      if (!origin) return [];
      const meta = (property: string, content: string, attr = "property") => ({
        tag: "meta",
        attrs: { [attr]: property, content },
        injectTo: "head" as const,
      });
      return [
        meta("og:image", `${origin}/og-image.png`),
        meta("og:image:width", "1200"),
        meta("og:image:height", "630"),
        meta("og:url", origin),
        meta("twitter:card", "summary_large_image", "name"),
      ];
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), react(), notFoundPage(), shareImage(siteOrigin(loadEnv(mode, process.cwd(), "")))],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
