/**
 * The files of an image under public/media: the PNG as captured (shown
 * when a figure is opened at full size), its dark-theme capture and the
 * WebP variants the pages load (scripts/image-variants.ts writes them,
 * scripts/media-sizes.ts lists them in generated/media-sizes.json).
 */

/** What media-sizes.json records for one PNG. */
export interface MediaEntry {
  /** Width and height in pixels. */
  size: [number, number];
  /** The start of the SHA-256 of the PNG: a recapture changes it, and media-sizes.ts writes its variants again. */
  hash: string;
  /** Widths of the WebP variants, <name>-<width>.webp beside the PNG. */
  webp: number[];
}

/** WebP widths: about the width an image is shown at, on ordinary and on high-density screens. */
const WIDTHS = [800, 1200, 1600];
/** The home page's example plots are thumbnails (128–176 px wide). */
const THUMBNAIL_WIDTHS = [400, 800];

/** The widths of an image's WebP variants; none is wider than the image itself. */
export function variantWidths(src: string, width: number): number[] {
  const targets = src.startsWith("/media/home/") ? THUMBNAIL_WIDTHS : WIDTHS;
  return [...new Set(targets.map((t) => Math.min(t, width)))].sort((a, b) => a - b);
}

/** "/media/a/b.png" -> "/media/a/b-800.webp". */
export function variantFile(src: string, width: number): string {
  return src.replace(/\.png$/, `-${width}.webp`);
}

/** The dark-theme capture of an image: "/media/a/b.png" -> "/media/a/b-dark.png". */
export function darkFile(src: string): string {
  return src.replace(/\.png$/, "-dark.png");
}

/** The `srcset` of an image's WebP variants. */
export function webpSrcSet(src: string, entry: MediaEntry): string {
  return entry.webp.map((w) => `${variantFile(src, w)} ${w}w`).join(", ");
}
