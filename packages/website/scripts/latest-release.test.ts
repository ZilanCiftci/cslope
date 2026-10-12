// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toLatestRelease } from "./latest-release";

describe("latest release", () => {
  it("finds the installer and the report among the assets", () => {
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
      report: "https://dl/report.pdf",
    });
  });

  it("leaves out files the release does not have", () => {
    const r = toLatestRelease({ tag_name: "v0.2.0", html_url: "u", assets: [] });
    expect(r.installer).toBeUndefined();
    expect(r.report).toBeUndefined();
  });
});
