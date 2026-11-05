/**
 * The PDF reader's image decoders come with the app: a scanned sheet (a
 * CCITT G4 image, as scanners write them) decodes to its picture with the
 * bundled data, and to nothing without it. pdf.js runs here in Node (its
 * build for older runtimes, in this thread), with the factory the app
 * hands it (sources.ts).
 */
import { describe, expect, it } from "vitest";
import { BundledPdfData, PDF_DATA_FILES, PDF_DATA_URL } from "./pdf-data";

/**
 * A 64 × 48 pt page of one 64 × 48 px image, CCITT G4 (CCITTFaxDecode,
 * K -1): a black 32 × 24 px square on white (a 1-bit image saved by
 * Pillow as a Group 4 TIFF, its strip wrapped in a PDF).
 */
const CCITT_PDF =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFsz" +
  "IDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2NCA0OF0gL1Jlc291" +
  "cmNlcyA8PCAvWE9iamVjdCA8PCAvSW0wIDQgMCBSID4+ID4+IC9Db250ZW50cyA1IDAgUiA+PgplbmRvYmoKNCAwIG9iago8PCAvVHlwZSAvWE9iamVjdCAv" +
  "U3VidHlwZSAvSW1hZ2UgL1dpZHRoIDY0IC9IZWlnaHQgNDggL0JpdHNQZXJDb21wb25lbnQgMSAvQ29sb3JTcGFjZSAvRGV2aWNlR3JheSAvRmlsdGVyIC9D" +
  "Q0lUVEZheERlY29kZSAvRGVjb2RlUGFybXMgPDwgL0sgLTEgL0NvbHVtbnMgNjQgL1Jvd3MgNDggL0JsYWNrSXMxIGZhbHNlID4+IC9MZW5ndGggMjggPj4K" +
  "c3RyZWFtCiageG////yC43///////////////4////ABABAKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMjggPj4Kc3RyZWFtCnEgNjQg" +
  "MCAwIDQ4IDAgMCBjbSAvSW0wIERvIFEKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAK" +
  "MDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDMgMDAwMDAgbiAKMDAwMDAwMDUwMyAwMDAwMCBuIAp0cmFpbGVyCjw8" +
  "IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjU4MQolJUVPRgo=";

/** The image a PDF's first page paints, as pdf.js decodes it (null: it could not be decoded). */
async function firstImage(options: Record<string, unknown>): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: Uint8Array.from(atob(CCITT_PDF), (c) => c.charCodeAt(0)), verbosity: 0, ...options });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const list = await page.getOperatorList();
    const at = list.fnArray.indexOf(lib.OPS.paintImageXObject);
    expect(at).toBeGreaterThanOrEqual(0);
    const name = (list.argsArray[at] as [string])[0];
    return await new Promise((resolve) => page.objs.get(name, resolve));
  } finally {
    await task.destroy();
  }
}

describe("the PDF reader's bundled data", () => {
  it("carries the decoders and the fonts pdf.js asks for", async () => {
    expect(PDF_DATA_FILES).toEqual(expect.arrayContaining(["wasmUrl/jbig2.wasm", "wasmUrl/openjpeg.wasm", "standardFontDataUrl/FoxitSymbol.pfb"]));
    const factory = new BundledPdfData();
    for (const file of PDF_DATA_FILES) {
      const [kind, filename] = file.split("/");
      const bytes = await factory.fetch({ kind, filename });
      expect(bytes.length).toBeGreaterThan(1000);
      if (filename.endsWith(".wasm")) expect([...bytes.subarray(0, 4)]).toEqual([0, 0x61, 0x73, 0x6d]);
    }
    await expect(factory.fetch({ kind: "wasmUrl", filename: "quickjs-eval.wasm" })).rejects.toThrow(/does not carry/);
  });

  it("decodes a scanned (CCITT G4) image with them; without them it stays blank", async () => {
    const image = await firstImage({ BinaryDataFactory: BundledPdfData, useWorkerFetch: false, wasmUrl: PDF_DATA_URL, standardFontDataUrl: PDF_DATA_URL });
    expect(image).not.toBeNull();
    expect([image!.width, image!.height]).toEqual([64, 48]);
    // 1 bit per pixel, 8 bytes a row: the square's 4 bytes in 24 of the
    // 48 rows differ from the rest of the page
    const bytes = [...image!.data];
    const counts = new Map<number, number>();
    for (const b of bytes) counts.set(b, (counts.get(b) ?? 0) + 1);
    expect([...counts.values()].sort((a, b) => a - b)).toEqual([96, 288]);

    // pdf.js without the decoders (no wasm to load): no picture
    expect(await firstImage({ useWasm: false, wasmUrl: undefined })).toBeNull();
  });
});
