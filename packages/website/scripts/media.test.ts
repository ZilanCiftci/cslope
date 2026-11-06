// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { MEDIA, homeExampleImage, media } from "../src/content/media";
import { darkFile, variantFile, variantWidths } from "../src/content/media-variants";
import { SIZES_FILE, mediaSizes, pngSize, publicFile } from "./media-sizes";

const sizes = mediaSizes();
const lightSources = Object.keys(sizes).filter((src) => !src.endsWith("-dark.png"));

/** WebP width and height from the file's VP8/VP8L/VP8X header. */
function webpSize(file: string): [number, number] {
  const b = readFileSync(file);
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
}

describe("media", () => {
  it("media-sizes.json is up to date (regenerate with bun scripts/media-sizes.ts)", () => {
    expect(JSON.parse(readFileSync(SIZES_FILE, "utf8"))).toEqual(sizes);
  });

  it("every image the site names exists, with its real size", () => {
    for (const m of Object.values(MEDIA)) {
      expect(existsSync(publicFile(m.src)), m.src).toBe(true);
      expect([m.width, m.height]).toEqual(sizes[m.src].size);
    }
  });

  it("every image has a dark-theme capture", () => {
    expect(lightSources.filter((src) => !sizes[darkFile(src)])).toEqual([]);
    for (const m of Object.values(MEDIA)) expect(m.dark?.src, m.src).toBe(darkFile(m.src));
  });

  it("every image has its WebP variants, at their widths and the image's proportions", () => {
    for (const [src, entry] of Object.entries(sizes)) {
      expect(entry.webp, src).toEqual(variantWidths(src, entry.size[0]));
      for (const w of entry.webp) {
        const file = publicFile(variantFile(src, w));
        expect(existsSync(file), file).toBe(true);
        const [vw, vh] = webpSize(file);
        expect(vw, file).toBe(w);
        expect(Math.abs(vh - (entry.size[1] * w) / entry.size[0]), file).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a page's srcset names its variants, the largest no wider than the capture", () => {
    const m = media("/media/generated/result-app.png", "");
    expect(m.srcSet).toBe(sizes[m.src].webp.map((w) => `${variantFile(m.src, w)} ${w}w`).join(", "));
    expect(Math.max(...sizes[m.src].webp)).toBeLessThanOrEqual(pngSize(publicFile(m.src))[0]);
    // The home page's examples are thumbnails: their smallest variant is small.
    expect(Math.min(...sizes[homeExampleImage("V049", "").src].webp)).toBeLessThanOrEqual(400);
  });

  it("an image that is not in media-sizes.json is an error, not an image without a size", () => {
    expect(() => media("/media/generated/missing.png", "")).toThrow(/media-sizes\.json/);
  });
});
