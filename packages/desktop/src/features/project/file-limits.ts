/**
 * The largest file the renderer reads from a file picker (project files
 * opened through the main process have the same limit, MAX_PROJECT_BYTES in
 * electron/main.ts). A real project or import is a few MB; a multi-GB file
 * chosen by mistake would freeze or crash the window.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Why `file` is not read, or nothing when it is small enough. */
export function fileTooLarge(file: { name: string; size: number }): string | undefined {
  if (file.size <= MAX_FILE_BYTES) return undefined;
  const mb = (n: number) => `${Math.ceil(n / (1024 * 1024))} MB`;
  return `${file.name} is too large (${mb(file.size)}; files of at most ${mb(MAX_FILE_BYTES)} can be read).`;
}
