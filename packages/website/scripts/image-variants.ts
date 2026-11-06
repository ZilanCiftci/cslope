/**
 * The WebP variants of the PNGs under public/media, at the widths of
 * src/content/media-variants.ts: <name>-<width>.webp beside each PNG.
 * Run through media-sizes.ts, which then records them:
 *
 *   bun scripts/media-sizes.ts
 *
 * A PNG whose hash is the one media-sizes.json recorded, with all its
 * variants on disk, is skipped; a WebP no PNG asks for is removed.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { variantFile, variantWidths, type MediaEntry } from "../src/content/media-variants";
import { MEDIA_DIR, fileHash, mediaPath, pngSize, pngs, publicFile } from "./media-sizes";

/**
 * Lossy WebP: screenshots with small text keep it legible at this
 * quality, at about a tenth of the PNG's bytes.
 */
const WEBP = { quality: 82, effort: 6, smartSubsample: true } as const;

function webps(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? webps(p) : p.endsWith(".webp") ? [p] : [];
  });
}

/** Writes the missing and stale variants; returns how many files were written. */
export async function writeVariants(previous: Record<string, Partial<MediaEntry>>): Promise<number> {
  let written = 0;
  const wanted = new Set<string>();
  for (const file of pngs()) {
    const src = mediaPath(file);
    const [width] = pngSize(file);
    const widths = variantWidths(src, width);
    const outputs = widths.map((w) => publicFile(variantFile(src, w)));
    outputs.forEach((o) => wanted.add(o));
    const current = previous[src]?.hash === fileHash(file) && outputs.every((o) => existsSync(o));
    if (current) continue;
    for (const [i, w] of widths.entries()) {
      await sharp(file).resize({ width: w, kernel: "lanczos3" }).webp(WEBP).toFile(outputs[i]);
      written++;
    }
  }
  for (const f of webps(MEDIA_DIR)) if (!wanted.has(f)) rmSync(f);
  return written;
}
