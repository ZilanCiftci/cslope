/**
 * The latest published release on GitHub, looked up at build time so that
 * the site links only to files that exist: the Windows installer and the
 * verification report are release assets, and there is nothing to link to
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
    report: asset(/^cSlope-verification-report\.pdf$/),
  };
}

/** The latest release, or null when there is none or GitHub cannot be reached. */
export async function latestRelease(): Promise<LatestRelease | null> {
  if (existsSync(CACHE)) {
    const cached = JSON.parse(readFileSync(CACHE, "utf8")) as { at: number; release: LatestRelease | null };
    if (Date.now() - cached.at < CACHE_MS) return cached.release;
  }
  let release: LatestRelease | null = null;
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    // 404: no release yet.
    if (res.ok) release = toLatestRelease((await res.json()) as GitHubRelease);
    else if (res.status !== 404) console.warn(`GitHub answered ${res.status}; building without release links.`);
  } catch (e) {
    console.warn(`GitHub could not be reached (${(e as Error).message}); building without release links.`);
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ at: Date.now(), release }));
  return release;
}
