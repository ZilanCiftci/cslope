// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA } from "../src/content/media";
import { SIZES_FILE, mediaSizes } from "./media-sizes";

describe("media", () => {
  it("media-sizes.json is up to date (regenerate with bun scripts/media-sizes.ts)", () => {
    expect(JSON.parse(readFileSync(SIZES_FILE, "utf8"))).toEqual(mediaSizes());
  });

  it("every image the site names exists, with its real size", () => {
    const sizes = mediaSizes();
    for (const m of Object.values(MEDIA)) {
      expect(existsSync(join(import.meta.dirname, "../public", m.src)), m.src).toBe(true);
      expect([m.width, m.height]).toEqual(sizes[m.src]);
    }
  });
});
