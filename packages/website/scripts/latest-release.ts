/**
 * The latest published release on GitHub, looked up at build time so that
 * the site links only to files that exist: the Windows installer is a
 * release asset, and there is nothing to link to
 * before the first release.
 *
 * The result is cached for a few minutes, so that the client and the
 * server (pre-rendering) builds of one deployment agree.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LatestRelease } from "../src/content/release-types";

export type { LatestRelease };

const REPO = "ZilanCiftci/cslope";
const CACHE = join(import.meta.dirname, "../node_modules/.cache/cslope-latest-release.json");
const CACHE_MS = 15 * 60 * 1000;

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

/** The release as the site needs it, from GitHub's "latest release" answer. */
export function toLatestRelease(r: GitHubRelease): LatestRelease {
  const asset = (test: RegExp) => r.assets.find((a) => test.test(a.name))?.browser_download_url;
  return {
    tag: r.tag_name,
    version: r.tag_name.replace(/^v/, ""),
    url: r.html_url,
    installer: asset(/^cSlope-Windows-.*-Setup\.exe$/),
  };
}

/**
 * The latest release, or null when there is none. When GitHub cannot be
 * asked (a rate limit, a bad token, a timeout) a production build fails:
 * the site would otherwise go out without its download links and nothing
 * would say so (#63). Other builds go on without the links, with a warning.
 * Only an answer is cached, never a failure.
 */
export async function latestRelease(
  env: Record<string, string | undefined> = process.env,
  fetchRelease: typeof fetch = fetch,
  cache: string = CACHE,
): Promise<LatestRelease | null> {
  if (existsSync(cache)) {
    const cached = JSON.parse(readFileSync(cache, "utf8")) as { at: number; release: LatestRelease | null };
    if (Date.now() - cached.at < CACHE_MS) return cached.release;
  }
  let release: LatestRelease | null = null;
  let failure: string | undefined;
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const res = await fetchRelease(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    // 404: no release yet.
    if (res.ok) release = toLatestRelease((await res.json()) as GitHubRelease);
    else if (res.status !== 404) failure = `GitHub answered ${res.status}`;
  } catch (e) {
    failure = `GitHub could not be reached (${(e as Error).message})`;
  }
  if (failure !== undefined) {
    if (env.VERCEL_ENV === "production") {
      throw new Error(`${failure}; a production build needs the latest release for the download links.`);
    }
    console.warn(`${failure}; building without release links.`);
    return null;
  }
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, JSON.stringify({ at: Date.now(), release }));
  return release;
}
