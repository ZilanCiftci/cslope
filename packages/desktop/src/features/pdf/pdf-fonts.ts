/**
 * The sans-serif font of the PDF exports: Liberation Sans (SIL Open Font
 * License, see assets/fonts/OFL.txt), embedded so that Greek letters and
 * symbols print (φ, γ, ′, ≥, ³); the standard PDF fonts only have Latin-1.
 * Subset to Latin, Greek, punctuation and mathematical symbols.
 */
import type { jsPDF } from "jspdf";
import regular from "../../assets/fonts/LiberationSans-Regular.ttf?inline";
import bold from "../../assets/fonts/LiberationSans-Bold.ttf?inline";
import italic from "../../assets/fonts/LiberationSans-Italic.ttf?inline";

export const PDF_SANS = "LiberationSans";

export type PdfFontStyle = "normal" | "bold" | "italic" | "bolditalic";

/** The base64 data of a data URL (Vite inlines the font as one). */
const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

// Bold italic uses the bold face (the subset has no bold italic).
const FACES: [file: string, data: string, style: PdfFontStyle][] = [
  ["LiberationSans-Regular.ttf", regular, "normal"],
  ["LiberationSans-Bold.ttf", bold, "bold"],
  ["LiberationSans-Italic.ttf", italic, "italic"],
  ["LiberationSans-Bold.ttf", bold, "bolditalic"],
];

/** What the font helpers need of a document (tests pass light fakes). */
type FontTarget = { setFont(family: string, style: string): unknown } & Partial<Pick<jsPDF, "getFontList" | "addFileToVFS" | "addFont">>;

/** Add the embedded font to the document, once. */
export function ensurePdfFonts(pdf: FontTarget): void {
  if (!pdf.getFontList || !pdf.addFileToVFS || !pdf.addFont) return;
  if (pdf.getFontList()[PDF_SANS]) return;
  const added = new Set<string>();
  for (const [file, data, style] of FACES) {
    if (!added.has(file)) {
      pdf.addFileToVFS!(file, base64(data));
      added.add(file);
    }
    pdf.addFont!(file, PDF_SANS, style);
  }
}

/** Use the embedded sans-serif font. */
export function setSansFont(pdf: FontTarget, style: PdfFontStyle = "normal"): void {
  ensurePdfFonts(pdf);
  pdf.setFont(PDF_SANS, style);
}
