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
import { latestRelease } from "./scripts/latest-release";
import license from "rollup-plugin-license";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "path";

/**
 * Packages that reach the site only as stylesheets and fonts, which the
 * licence plugin (it follows JavaScript modules) does not see.
 */
const CSS_PACKAGES = ["katex", "@fontsource-variable/inter", "@fontsource/ibm-plex-mono"];

function cssLicenses(file: string): Plugin {
  return {
    name: "css-licenses",
    apply: "build",
    closeBundle() {
      if (!existsSync(file)) return;
      const require = createRequire(import.meta.url);
      for (const name of CSS_PACKAGES) {
        const pkgFile = require.resolve(`${name}/package.json`);
        const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { version: string; license: string };
        const licence = path.join(path.dirname(pkgFile), "LICENSE");
        const text = existsSync(licence) ? readFileSync(licence, "utf8").trim() : "";
        appendFileSync(file, `\n---\n\nName: ${name}\nVersion: ${pkg.version}\nLicense: ${pkg.license}\n\n${text}\n`);
      }
    },
  };
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
        meta("twitter:card", "summary_large_image", "name"),
      ];
    },
  };
}

export default defineConfig(async ({ mode, isSsrBuild }) => ({
  // The client manifest tells scripts/prerender.ts which stylesheets the
  // lazily loaded docs need, so that pre-rendered docs pages link them.
  build: { manifest: !isSsrBuild },
  // The year in the footer, fixed at build time so that a pre-rendered page
  // hydrates without a mismatch after New Year.
  define: {
    __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()),
    // The latest release on GitHub (scripts/latest-release.ts); none in tests.
    __LATEST_RELEASE__: JSON.stringify(mode === "test" ? null : await latestRelease()),
  },
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
    // The licences of the third-party code and fonts in the client bundle,
    // published as /third-party-licenses.txt (linked from the footer).
    !isSsrBuild &&
      license({
        thirdParty: {
          includePrivate: false,
          output: { file: path.resolve(__dirname, "dist/third-party-licenses.txt") },
        },
      }),
    !isSsrBuild && cssLicenses(path.resolve(__dirname, "dist/third-party-licenses.txt")),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
