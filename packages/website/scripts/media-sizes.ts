/**
 * Writes src/content/generated/media-sizes.json: the size in pixels of every
 * PNG under public/media, so that images keep their layout while they load
 * without sizes typed by hand. Run after capturing new screenshots:
 *
 *   bun scripts/media-sizes.ts
 *
 * media.test.ts fails when the file is out of date.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = join(import.meta.dirname, "..");
const MEDIA = join(root, "public/media");
export const SIZES_FILE = join(root, "src/content/generated/media-sizes.json");

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function pngs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? pngs(p) : p.endsWith(".png") ? [p] : [];
  });
}

/** "/media/<path>" -> [width, height], sorted by path. */
export function mediaSizes(): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const f of pngs(MEDIA).sort()) out["/media/" + relative(MEDIA, f).split(sep).join("/")] = pngSize(f);
  return out;
}

if (import.meta.main) {
  writeFileSync(SIZES_FILE, JSON.stringify(mediaSizes(), null, 1) + "\n");
  console.log(`${Object.keys(mediaSizes()).length} images → ${relative(root, SIZES_FILE)}`);
}
