// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA } from "../src/content/media";

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe("media", () => {
  it("declares each image's real size", () => {
    const pub = join(import.meta.dirname, "../public");
    for (const m of Object.values(MEDIA)) {
      expect({ src: m.src, ...pngSize(join(pub, m.src)) }).toEqual({ src: m.src, width: m.width, height: m.height });
    }
  });
});
