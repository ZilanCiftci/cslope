import type { jsPDF } from "jspdf";
import type { ProjectInfo } from "../../store/types";
import type { SummarySection } from "../export/analysisSummary";
import { setSansFont } from "./pdf-fonts";

/** Header of the summary pages. */
export interface SummaryHeader {
  projectInfo?: Partial<ProjectInfo>;
  modelName?: string;
  /** cSlope version that ran the analysis. */
  version?: string;
  /** Export date (ISO). */
  date: string;
}

/**
 * Text the embedded font can print: its combining macron sits over a
 * capital B (B̄; the PDF has no mark positioning), so a macron over any
 * other letter is left out. rᵤ prints as it is.
 */
export function pdfSafeText(text: string): string {
  return text.replace(/(?<!B)\u0304/g, "");
}

function pdfSafeSection(section: SummarySection): SummarySection {
  const t = pdfSafeText;
  return {
    title: t(section.title),
    ...(section.rows ? { rows: section.rows.map((r) => ({ label: t(r.label), value: t(r.value) })) } : {}),
    ...(section.table ? { table: { header: section.table.header.map(t), rows: section.table.rows.map((r) => r.map(t)) } } : {}),
    ...(section.note !== undefined ? { note: t(section.note) } : {}),
  };
}

const MARGIN = 15;
const LINE = 4.6;
const BODY_PT = 9;
const LABEL_W = 58;

/**
 * The line above the drawing on page 1: the model (or project) name, then
 * the result row of the summary (the factor of safety) and the method.
 */
export function drawingTitleParts(sections: SummarySection[], header: SummaryHeader): { name: string; result: string } {
  const name = header.modelName?.trim() || header.projectInfo?.title?.trim() || "";
  const [fos, method] = sections[0]?.rows ?? [];
  const result = [fos && `${fos.label} ${fos.value}`, method?.value].filter(Boolean).join(" · ");
  return { name: pdfSafeText(name), result: pdfSafeText(result) };
}

/** Write the drawing's title line in the top margin of page 1, above the frame at `left`, `top`. */
export function drawDrawingTitle(
  pdf: jsPDF,
  sections: SummarySection[],
  header: SummaryHeader,
  frame: { left: number; top: number; width: number },
): void {
  const { name, result } = drawingTitleParts(sections, header);
  if (!name && !result) return;
  const y = frame.top - 2.5;
  pdf.setFontSize(BODY_PT);
  pdf.setTextColor(0, 0, 0);
  let x = frame.left;
  if (name) {
    setSansFont(pdf, "bold");
    pdf.text(name, x, y);
    x += pdf.getTextWidth(name) + 4;
  }
  if (result) {
    setSansFont(pdf, "normal");
    const room = frame.left + frame.width - x;
    const [line] = pdf.splitTextToSize(result, Math.max(room, 10)) as string[];
    pdf.text(line ?? result, x, y);
  }
}

/**
 * Append the analysis summary as text pages after the drawing: method,
 * search, water, partial factors, materials and loads, so the calculation
 * can be checked and repeated from the report.
 */
export function drawSummaryPages(
  pdf: jsPDF,
  rawSections: SummarySection[],
  header: SummaryHeader,
  paper: { w: number; h: number; landscape: boolean },
): void {
  const sections = rawSections.map(pdfSafeSection);
  const width = paper.w - 2 * MARGIN;
  const bottom = paper.h - MARGIN - 8;
  /** The document's numbers of the summary pages, for their footers. */
  const pages: number[] = [];
  let y = 0;

  // Numbered as pages of the whole document ("Page 2 of 3"), so a printed
  // or quoted page number matches the PDF's.
  const footers = () => {
    const total = pdf.getNumberOfPages();
    const left = `cSlope${header.version ? ` ${header.version}` : ""} · analysis summary · exported ${header.date}`;
    for (const n of pages) {
      pdf.setPage(n);
      setSansFont(pdf, "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(110, 110, 110);
      pdf.text(left, MARGIN, paper.h - MARGIN + 2);
      pdf.text(`Page ${n} of ${total}`, paper.w - MARGIN, paper.h - MARGIN + 2, { align: "right" });
      pdf.setTextColor(0, 0, 0);
    }
    pdf.setPage(total);
  };

  const newPage = () => {
    pdf.addPage([paper.w, paper.h], paper.landscape ? "landscape" : "portrait");
    pages.push(pdf.getNumberOfPages());
    y = MARGIN + 4;
    setSansFont(pdf, "bold");
    pdf.setFontSize(13);
    pdf.text("Analysis summary", MARGIN, y);
    const info = header.projectInfo ?? {};
    const sub = [
      info.title,
      info.projectNumber && `project ${info.projectNumber}`,
      info.revision && `rev. ${info.revision}`,
      // The project title is the model's name by default: not twice.
      header.modelName && header.modelName !== info.title && `model ${header.modelName}`,
    ]
      .filter(Boolean)
      .join(" · ");
    setSansFont(pdf, "normal");
    pdf.setFontSize(BODY_PT);
    if (sub) {
      y += LINE + 0.6;
      pdf.text(sub, MARGIN, y, { maxWidth: width });
    }
    y += 2.5;
    pdf.setDrawColor(150, 150, 150);
    pdf.setLineWidth(0.2);
    pdf.line(MARGIN, y, paper.w - MARGIN, y);
    y += LINE + 1;
  };

  /** Room for `h` mm more on this page, else a new page. */
  const ensure = (h: number) => {
    if (y + h > bottom) newPage();
  };

  newPage();
  for (const section of sections) {
    ensure(LINE * 3);
    setSansFont(pdf, "bold");
    pdf.setFontSize(10.5);
    pdf.text(section.title, MARGIN, y);
    y += LINE + 0.8;
    pdf.setFontSize(BODY_PT);

    for (const row of section.rows ?? []) {
      setSansFont(pdf, "normal");
      const value = pdf.splitTextToSize(row.value, width - LABEL_W) as string[];
      ensure(value.length * LINE);
      pdf.setTextColor(80, 80, 80);
      pdf.text(row.label, MARGIN, y);
      pdf.setTextColor(0, 0, 0);
      pdf.text(value, MARGIN + LABEL_W, y);
      y += value.length * LINE;
    }

    if (section.table) {
      if (section.rows?.length) y += 1;
      drawTable(section.table.header, section.table.rows);
    }

    if (section.note) {
      setSansFont(pdf, "italic");
      const note = pdf.splitTextToSize(section.note, width) as string[];
      ensure(note.length * LINE);
      pdf.setTextColor(80, 80, 80);
      pdf.text(note, MARGIN, y);
      pdf.setTextColor(0, 0, 0);
      y += note.length * LINE;
    }
    y += LINE * 0.8;
  }
  footers();

  function drawTable(head: string[], rows: string[][]) {
    // Column widths from the longest text in each column, the widest
    // column (the strength text) taking what is left.
    // The header is drawn in bold, the rows in the normal weight.
    setSansFont(pdf, "bold");
    const headWidths = head.map((h) => pdf.getTextWidth(h));
    setSansFont(pdf, "normal");
    const natural = head.map((_, c) =>
      Math.max(headWidths[c], ...rows.map((r) => pdf.getTextWidth(r[c] ?? ""))) + 3,
    );
    const total = natural.reduce((a, b) => a + b, 0);
    const widths =
      total <= width
        ? natural
        : (() => {
            const widest = natural.indexOf(Math.max(...natural));
            const rest = total - natural[widest];
            const w = natural.map((n) => Math.min(n, width * 0.3));
            w[widest] = Math.max(width * 0.25, width - Math.min(rest, width * 0.75));
            const scale = width / w.reduce((a, b) => a + b, 0);
            return w.map((x) => x * scale);
          })();

    const drawRow = (cells: string[], bold: boolean) => {
      setSansFont(pdf, bold ? "bold" : "normal");
      const wrapped = cells.map((t, c) => pdf.splitTextToSize(t ?? "", widths[c] - 2) as string[]);
      const lines = Math.max(1, ...wrapped.map((w) => w.length));
      ensure(lines * LINE + 1);
      let x = MARGIN;
      wrapped.forEach((w, c) => {
        pdf.text(w, x, y);
        x += widths[c];
      });
      y += lines * LINE - LINE + 1.6;
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.15);
      pdf.line(MARGIN, y, MARGIN + widths.reduce((a, b) => a + b, 0), y);
      y += LINE - 0.4;
    };
    drawRow(head, true);
    for (const r of rows) drawRow(r, false);
  }
}
