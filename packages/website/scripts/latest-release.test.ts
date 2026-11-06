// @vitest-environment node
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { latestRelease, toLatestRelease } from "./latest-release";

const answer = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const cacheFile = () => join(mkdtempSync(join(tmpdir(), "release-")), "cache.json");

describe("latest release", () => {
  it("finds the installer among the assets", () => {
    const r = toLatestRelease({
      tag_name: "v0.1.0",
      html_url: "https://github.com/x/y/releases/tag/v0.1.0",
      assets: [
        { name: "cSlope-Windows-0.1.0-Setup.exe", browser_download_url: "https://dl/setup.exe" },
        { name: "cSlope-Windows-0.1.0-Setup.exe.sha256", browser_download_url: "https://dl/setup.sha256" },
        { name: "cSlope-verification-report.pdf", browser_download_url: "https://dl/report.pdf" },
      ],
    });
    expect(r).toEqual({
      tag: "v0.1.0",
      version: "0.1.0",
      url: "https://github.com/x/y/releases/tag/v0.1.0",
      installer: "https://dl/setup.exe",
    });
  });

  it("leaves out files the release does not have", () => {
    const r = toLatestRelease({ tag_name: "v0.2.0", html_url: "u", assets: [] });
    expect(r.installer).toBeUndefined();
  });

  it("fails a production build when GitHub cannot be asked (#63)", async () => {
    const cache = cacheFile();
    await expect(latestRelease({ VERCEL_ENV: "production" }, answer(401), cache)).rejects.toThrow(/GitHub answered 401/);
    const unreachable = (async () => { throw new Error("timeout"); }) as unknown as typeof fetch;
    await expect(latestRelease({ VERCEL_ENV: "production" }, unreachable, cache)).rejects.toThrow(/could not be reached/);
    expect(existsSync(cache)).toBe(false);
  });

  it("builds a preview without links when GitHub cannot be asked, and does not cache the failure", async () => {
    const cache = cacheFile();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await latestRelease({ VERCEL_ENV: "preview" }, answer(403), cache)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/GitHub answered 403/));
    expect(existsSync(cache)).toBe(false);
    warn.mockRestore();
  });

  it("caches an answer, also that there is no release yet", async () => {
    const cache = cacheFile();
    expect(await latestRelease({ VERCEL_ENV: "production" }, answer(404), cache)).toBeNull();
    expect(existsSync(cache)).toBe(true);
    const r = await latestRelease({}, answer(500), cache);
    expect(r).toBeNull(); // from the cache, not the failing answer
  });
});
