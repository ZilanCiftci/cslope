/**
 * The site's public origin, for the absolute URLs that link previews and
 * search engines need (og:image, og:url, canonical, sitemap). VITE_SITE_URL
 * wins; on Vercel, previews use their own URL and production builds the
 * production URL. Without an origin these are left out rather than given a
 * relative URL, which crawlers ignore.
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
