/**
 * Writes the WebP variants of every PNG under public/media (image-variants.ts)
 * and src/content/generated/media-sizes.json: for each PNG its size in
 * pixels, a hash of its content and the widths of its WebP variants, so
 * that images keep their layout while they load and the browser can choose
 * a smaller file, without sizes typed by hand. Run after capturing new
 * screenshots:
 *
 *   bun scripts/media-sizes.ts
 *
 * media.test.ts fails when the file is out of date or a variant is missing.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { variantFile, variantWidths, type MediaEntry } from "../src/content/media-variants";

const root = join(import.meta.dirname, "..");
const PUBLIC = join(root, "public");
export const MEDIA_DIR = join(PUBLIC, "media");
export const SIZES_FILE = join(root, "src/content/generated/media-sizes.json");

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** The start of the SHA-256 of a file. */
export function fileHash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);
}

/** Every PNG under public/media, sorted. */
export function pngs(dir: string = MEDIA_DIR): string[] {
  return readdirSync(dir)
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? pngs(p) : p.endsWith(".png") ? [p] : [];
    })
    .sort();
}

/** "/media/<path>" of a file under public/media. */
export const mediaPath = (file: string) => "/" + relative(PUBLIC, file).split(sep).join("/");

/** The file on disk of a "/media/<path>". */
export const publicFile = (src: string) => join(PUBLIC, src);

/** "/media/<path>" -> its entry, sorted by path. The variants listed are those on disk. */
export function mediaSizes(): Record<string, MediaEntry> {
  const out: Record<string, MediaEntry> = {};
  for (const f of pngs()) {
    const src = mediaPath(f);
    const size = pngSize(f);
    const webp = variantWidths(src, size[0]).filter((w) => existsSync(publicFile(variantFile(src, w))));
    out[src] = { size, hash: fileHash(f), webp };
  }
  return out;
}

if (import.meta.main) {
  // sharp is needed here only, not by the tests that import this file.
  const { writeVariants } = await import("./image-variants");
  const previous = (existsSync(SIZES_FILE) ? JSON.parse(readFileSync(SIZES_FILE, "utf8")) : {}) as Record<string, Partial<MediaEntry>>;
  const written = await writeVariants(previous);
  const sizes = mediaSizes();
  writeFileSync(SIZES_FILE, JSON.stringify(sizes, null, 1) + "\n");
  console.log(`${Object.keys(sizes).length} images, ${written} WebP files written → ${relative(root, SIZES_FILE)}`);
}
