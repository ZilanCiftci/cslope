/** Offer data as a file download (a save dialog in the desktop app). */
export function downloadFile(
  filename: string,
  data: BlobPart,
  type: string,
): void {
  const blob = new Blob([data], { type });
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

/** A file name from a model name: safe characters, given extension. */
export function safeFileName(base: string, extension: string): string {
  const clean = base.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ") || "cslope";
  return `${clean}.${extension}`;
}
