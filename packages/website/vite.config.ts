import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@mdx-js/rollup";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import rehypeSlug from "rehype-slug";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { siteOrigin } from "./scripts/site-origin";
import path from "path";

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
        meta("twitter:card", "summary_large_image", "name"),
      ];
    },
  };
}

export default defineConfig(({ mode, isSsrBuild }) => ({
  // The client manifest tells scripts/prerender.ts which stylesheets the
  // lazily loaded docs need, so that pre-rendered docs pages link them.
  build: { manifest: !isSsrBuild },
  // The year in the footer, fixed at build time so that a pre-rendered page
  // hydrates without a mismatch after New Year.
  define: { __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()) },
  plugins: [
    // Documentation pages: Markdown with JSX, frontmatter exported as `frontmatter`.
    {
      enforce: "pre" as const,
      ...mdx({
        // Only .mdx: plain .md files (CHANGELOG.md) are imported as text.
        mdExtensions: [],
        include: /\.mdx$/,
        remarkPlugins: [remarkGfm, remarkFrontmatter, remarkMdxFrontmatter, remarkMath],
        rehypePlugins: [rehypeSlug, [rehypeKatex, { output: "html" }]],
      }),
    },
    tailwindcss(),
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
    shareImage(siteOrigin(loadEnv(mode, process.cwd(), ""))),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
