// @vitest-environment node
import { describe, expect, it } from "vitest";
import { siteOrigin } from "./site-origin";

describe("siteOrigin", () => {
  it("prefers VITE_SITE_URL and strips a trailing slash", () => {
    expect(siteOrigin({ VITE_SITE_URL: "https://cslope.example/", VERCEL_URL: "x.vercel.app" })).toBe(
      "https://cslope.example",
    );
  });

  it("uses the deployment URL on Vercel previews and the production URL in production", () => {
    const vercel = { VERCEL_URL: "cslope-abc.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "cslope.vercel.app" };
    expect(siteOrigin({ ...vercel, VERCEL_ENV: "preview" })).toBe("https://cslope-abc.vercel.app");
    expect(siteOrigin({ ...vercel, VERCEL_ENV: "production" })).toBe("https://cslope.vercel.app");
  });

  it("is empty without any origin, so no relative og:image is written", () => {
    expect(siteOrigin({})).toBe("");
  });
});
