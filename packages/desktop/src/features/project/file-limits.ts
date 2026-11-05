/**
 * The largest file the renderer reads from a file picker for an import
 * (a model from another program, a template). A real import is a few MB;
 * a multi-GB file chosen by mistake would freeze or crash the window.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * The largest drawing (an image or a PDF placed under a model). Scanned
 * sheets and multi-page PDFs are tens of MB; it is also the largest entry
 * a project archive may hold (ZIP_LIMITS in utils/zip.ts).
 */
export const MAX_DRAWING_BYTES = 100 * 1024 * 1024;

/**
 * The largest project file (MAX_PROJECT_BYTES in electron/main.ts is the
 * same). A project without drawings is a few hundred kB; its drawings are
 * stored in it. Safe to read whole: the archive is opened lazily (openZip
 * reads the directory only), its drawings are stored as they are (no
 * unpacking), and what deflated entries may unpack to stays limited.
 */
export const MAX_PROJECT_FILE_BYTES = 500 * 1024 * 1024;

const mb = (n: number) => `${Math.ceil(n / (1024 * 1024))} MB`;

/** Why `file` is not read, or nothing when it is at most `limit` bytes (default: an import's). */
export function fileTooLarge(file: { name: string; size: number }, limit = MAX_FILE_BYTES): string | undefined {
  if (file.size <= limit) return undefined;
  return `${file.name} is too large (${mb(file.size)}; files of at most ${mb(limit)} can be read).`;
}
