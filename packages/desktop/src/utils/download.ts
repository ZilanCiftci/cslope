/** Offer data as a file download (a save dialog in the desktop app). */
export function downloadFile(
  filename: string,
  data: BlobPart,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  // The download has started; the URL is no longer needed.
  URL.revokeObjectURL(url);
}

/** A file name from a model name: safe characters, given extension. */
export function safeFileName(base: string, extension: string): string {
  const clean = base.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ") || "cslope";
  return `${clean}.${extension}`;
}
