/**
 * The data pdf.js loads besides a PDF file, carried by the app: the
 * WebAssembly of its image decoders (JBIG2 and CCITT fax, the images of
 * scanned sheets; JPEG 2000), without which such images stay blank, and
 * the two standard fonts it does not take from the system (Symbol,
 * ZapfDingbats).
 *
 * The app's page is a file:// URL in the desktop app, from which pdf.js
 * cannot fetch, so it is given a BinaryDataFactory that hands it these
 * bytes from the app's own bundle: each file is a chunk of its own (a
 * `?base64` import, vite.config.ts), loaded the first time a PDF needs
 * it. Nothing is fetched, so the Content Security Policy needs no
 * connect-src; the decoders compile in pdf.js's worker, which
 * 'wasm-unsafe-eval' allows as it does the engine's WebAssembly.
 */

const FILES: Record<string, () => Promise<{ default: string }>> = {
  "wasmUrl/jbig2.wasm": () => import("pdfjs-dist/wasm/jbig2.wasm?base64"),
  "wasmUrl/openjpeg.wasm": () => import("pdfjs-dist/wasm/openjpeg.wasm?base64"),
  "standardFontDataUrl/FoxitSymbol.pfb": () => import("pdfjs-dist/standard_fonts/FoxitSymbol.pfb?base64"),
  "standardFontDataUrl/FoxitDingbats.pfb": () => import("pdfjs-dist/standard_fonts/FoxitDingbats.pfb?base64"),
};

/** The files carried, as `<kind>/<file name>` (kind: pdf.js's option that names their folder). */
export const PDF_DATA_FILES = Object.keys(FILES);

/**
 * The base pdf.js is given for the wasm files and the standard fonts
 * (`wasmUrl`, `standardFontDataUrl`): it must be set for pdf.js to ask
 * for them, and names no place (the factory below serves them).
 */
export const PDF_DATA_URL = "cslope-bundled/";

function base64Bytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** pdf.js's BinaryDataFactory (getDocument): the files above, from the bundle. */
export class BundledPdfData {
  // (pdf.js constructs it with the URLs, which name nothing here)
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const load = FILES[`${kind}/${filename}`];
    if (!load) throw new Error(`The app does not carry the PDF reader's ${filename}.`);
    return base64Bytes((await load()).default);
  }
}
