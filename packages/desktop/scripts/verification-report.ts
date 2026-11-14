/**
 * cSlope verification report.
 *
 * Runs every published verification problem (packages/engine/src/
 * verification/cases.ts) through the engine and writes a PDF: a summary of
 * the deviations from the other programs, the literature and the finite
 * element references (the statistics of VERIFICATION-LOG.md, computed here
 * from the results), then one section per problem with a figure (geometry,
 * materials, water, loads, critical surface), the material table and one
 * row per analysis with every comparison, and the full list of results in
 * an appendix.
 *
 *   bun run verification-report            (from packages/desktop)
 *   bun scripts/verification-report.ts [output.pdf] [--public]
 *
 * --public writes the edition published on the website: no tolerances or
 * pass marks, only the reference and the computed value. The problems
 * carry cSlope's own ids and anonymous sources; any text that still names
 * another program stops the run (see packages/website/scripts).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GState, jsPDF } from "jspdf";
import {
  buildSlope,
  initEngine,
  isPointInPolygon,
  polygonizeRegions,
  toCanonicalSlopeDefinition,
  type MaterialModel,
  type SlopeDefinition,
} from "@cslope/engine";
import {
  RELIABILITY_CASES,
  VERIFICATION_CASES,
  VERIFICATION_OPTIONS,
  FULL_VERIFICATION_OPTIONS,
  NON_CIRCULAR_VERIFICATION_OPTIONS,
  runReliabilityCase,
  runVerification,
  type ReliabilityCheckResult,
  type VerificationCase,
  type VerificationCheck,
  agrees,
  formatPaperValue,
  formatRange,
  isProgramSource,
  paperValues,
  presentedAnalyses,
  femAgrees,
  femDeviation,
  type FemReference,
} from "@cslope/engine/verification";
import type { Slope } from "@cslope/engine";
import { findForbiddenNames } from "../../website/scripts/forbidden-names";
import { points as logPoints, stats as logStats } from "../../website/scripts/verification-log";
import type { PublishedValue, VerificationData, VerificationProblem, VerificationResult } from "../../website/src/content/verification-types";
import { freeWaterPolygons } from "../src/utils/piezo";
import { POND_COLOR, POND_OPACITY } from "../src/features/rendering/style-spec";

type Pt = [number, number];

// The engine's WebAssembly, read from disk.
await initEngine();

// import.meta.dirname, not the URL pathname: on Windows that is "/D:/…".
const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "../../..");
// The report is published: it uses the full search, like the website's table
// (the test suite runs a shorter one on circular problems).
process.env.CSLOPE_VERIFICATION_FULL = "1";

const ARGS = process.argv.slice(2);
const PUBLIC = ARGS.includes("--public");
// Absolute, so creating its directory works for any argument (on Windows,
// Bun's recursive mkdir throws EEXIST for an existing relative "..\..").
const OUT = path.resolve(
  ARGS.find((a) => !a.startsWith("--")) ??
  path.join(REPO, "docs", "verification", PUBLIC ? "cSlope-verification-report-public.pdf" : "cSlope-verification-report.pdf"),
);

// The data names no other program (problems.ts); the internal edition labels
// them "commercial program A" and so on. The public one names none, not
// even by letter, and leaves out the tolerances, pass marks and notes.
const CASES = VERIFICATION_CASES;
const RELIABILITY = RELIABILITY_CASES;

/** In the public edition, stop at any text that still names a program. */
function guard(text: string): string {
  if (PUBLIC) {
    const hits = findForbiddenNames("report", text);
    if (hits.length) throw new Error(`The public report would name "${hits[0].match}": …${hits[0].context}…`);
    const letter = text.match(/\b[Pp]rogram [A-Z]\b/);
    if (letter) throw new Error(`The public report would name "${letter[0]}" in: ${text}`);
    const id = text.match(/\b(?:VP|GS)\d[\w.-]*|\b(?:models?|problems?|examples?)\s+#\d+/i);
    if (id) throw new Error(`The public report would show the engine id "${id[0]}" in: ${text}`);
  }
  return text;
}

// ── Page set-up ──────────────────────────────────────────────────────

const PAGE_W = 210;
const PAGE_H = 297;
const M = 18; // margin
const CONTENT_W = PAGE_W - 2 * M;
const TOP = 24;
const BOTTOM = PAGE_H - 20;

const INK: [number, number, number] = [33, 37, 41];
const MUTED: [number, number, number] = [108, 117, 125];
const ACCENT: [number, number, number] = [23, 92, 140];
const RULE: [number, number, number] = [206, 212, 218];
/** The figures' grid: see-through hairlines in the muted text color, over the soil and under the lines. */
const GRID_WIDTH = 0.1;
const GRID_OPACITY = 0.35;
/** Target and least distance between the figures' axis ticks, in mm on the page. */
const TICK_MM = 10;
const TICK_MIN_MM = 6;
const PASS: [number, number, number] = [25, 135, 84];
const FAIL: [number, number, number] = [200, 35, 51];
const HEAD_BG: [number, number, number] = [233, 238, 243];
const WATER: [number, number, number] = [30, 110, 220];
const LOAD: [number, number, number] = [180, 40, 40];
const SURFACE: [number, number, number] = [200, 30, 30];

/**
 * Soil classes: every material is drawn in the color of its class, so that
 * the same kind of soil looks the same in every problem. The hues follow the
 * browser version's layer swatches (packages/web/src/templates/colors.ts),
 * lightened for print where the fill is large.
 */
type SoilClass = "clay" | "organic" | "sand" | "friction" | "cphi" | "rock" | "weak";
const SOIL_CLASSES: { id: SoilClass; label: string; rule: string; fill: RGB }[] = [
  { id: "sand", label: "Sand", rule: "named sand (not sandy clay)", fill: [238, 224, 160] },
  { id: "friction", label: "Gravel, fill and other friction soil", rule: "named fill, embankment, gravel, rockfill, filter, till and the like; otherwise c′ = 0", fill: [212, 163, 115] },
  { id: "cphi", label: "Soil with c′ and φ′", rule: "no telling name, c′ > 0 and φ′ > 0", fill: [206, 192, 168] },
  { id: "clay", label: "Clay and undrained soil", rule: "named clay or crust; otherwise undrained (φ = 0, Su models)", fill: [159, 183, 201] },
  { id: "organic", label: "Silt, peat and organic soil", rule: "named silt, peat, mud or organic", fill: [170, 186, 150] },
  { id: "rock", label: "Rock", rule: "named rock, limestone or hard base or layer", fill: [158, 158, 154] },
  { id: "weak", label: "Weak layer or seam", rule: "named weak, seam or joint", fill: [181, 131, 141] },
];
/** How far the tints of one class spread: the weakest material of a class lighter, the strongest darker. */
const TINT_LIGHTER = 0.3;
const TINT_DARKER = 0.2;
/**
 * "rank": within a problem, the materials of a class are tinted by their
 * order of strength. "absolute": by strength on a fixed log scale per class
 * (TINT_RANGE), the same strength giving the same tint in every problem.
 * CSLOPE_REPORT_TINTS=absolute selects the second, to compare the two.
 */
const TINT_SCALE: "rank" | "absolute" = process.env.CSLOPE_REPORT_TINTS === "absolute" ? "absolute" : "rank";
/** The strengths (kPa, from strengthKpa) at the light and the dark end of each class's absolute scale. */
const TINT_RANGE: Record<SoilClass, [number, number]> = {
  clay: [10, 200],
  organic: [5, 100],
  weak: [5, 100],
  sand: [100 * Math.tan((25 * Math.PI) / 180), 100 * Math.tan((45 * Math.PI) / 180)],
  friction: [100 * Math.tan((25 * Math.PI) / 180), 100 * Math.tan((45 * Math.PI) / 180)],
  cphi: [50, 300],
  rock: [100, 2000],
};
/** The normal stress at which the strength of a material is compared, kPa. */
const STRENGTH_SIGMA = 100;
const KPA_PER_PSF = 0.04788026;

/** The class of a material: its name first, its strength model where the name says nothing. */
function soilClass(name: string, model: MaterialModel | undefined): SoilClass {
  const n = name.toLowerCase();
  if (/\b(weak|seam|joint)\b/.test(n)) return "weak";
  if (/silt|peat|organic|\bmud\b/.test(n)) return "organic";
  if (/\b(rock|limestone|bedrock)\b|\bhard (base|layer)\b/.test(n)) return "rock";
  const clay = /\bclay(ey)?\b|\bcrust\b|\bcore\b/.test(n);
  if (/\bsand\b/.test(n) && (!clay || /^sand\b/.test(n))) return "sand";
  if (clay) return "clay";
  if (/fill|embankment|gravel|gabion|granular|filter|shell|transition|\btill\b|spoil|drain|reinforced/.test(n)) return "friction";
  switch (model?.kind) {
    case "mohr-coulomb":
      if (model.frictionAngle === 0) return "clay";
      return model.cohesion === 0 && !model.cohesionRateOfChange ? "friction" : "cphi";
    case "impenetrable":
    case "high-strength":
      return "rock";
    case undefined:
      return "cphi";
    default:
      return "clay";
  }
}

const mix = (c: RGB, t: number): RGB => c.map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t))) as RGB;

/** Each material's fill: its class color, in tints from lighter to darker when a problem has several of a class. */
function materialFills(materials: { name: string; model?: MaterialModel }[]): Map<string, RGB> {
  const classes = materials.map((m) => soilClass(m.name, m.model));
  const out = new Map<string, RGB>();
  materials.forEach((m, i) => {
    const same = classes.filter((c) => c === classes[i]).length;
    const k = classes.slice(0, i).filter((c) => c === classes[i]).length;
    const base = SOIL_CLASSES.find((c) => c.id === classes[i])!.fill;
    out.set(m.name, same === 1 ? base : mix(base, TINT_LIGHTER - ((TINT_LIGHTER + TINT_DARKER) * k) / (same - 1)));
  });
  return out;
}

const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
pdf.setProperties({
  title: "cSlope verification manual",
  subject: "cSlope's factors of safety on published slope stability problems, against the literature and other programs",
  author: "Ibirico",
  creator: "cSlope",
});
if (PUBLIC) {
  // Every string on the page passes the guard, before and after it is
  // wrapped into lines (a name could be split at a line break).
  const split = pdf.splitTextToSize.bind(pdf);
  pdf.splitTextToSize = ((t: string, ...rest: unknown[]) => {
    guard(String(t));
    return (split as (...a: unknown[]) => string[])(t, ...rest);
  }) as typeof pdf.splitTextToSize;
  const text = pdf.text.bind(pdf);
  pdf.text = ((t: string | string[], ...rest: unknown[]) => {
    (Array.isArray(t) ? t : [t]).forEach(guard);
    return (text as (...a: unknown[]) => jsPDF)(t, ...rest);
  }) as typeof pdf.text;
}
const fontDir = path.join(HERE, "report-fonts");
for (const [file, style] of [
  ["LiberationSans-Regular.ttf", "normal"],
  ["LiberationSans-Bold.ttf", "bold"],
  ["LiberationSans-Italic.ttf", "italic"],
] as const) {
  pdf.addFileToVFS(file, fs.readFileSync(path.join(fontDir, file)).toString("base64"));
  pdf.addFont(file, "Lib", style);
}

let y = TOP;
const font = (size: number, style: "normal" | "bold" | "italic" = "normal", color = INK) => {
  pdf.setFont("Lib", style);
  pdf.setFontSize(size);
  pdf.setTextColor(...color);
};
const newPage = () => {
  pdf.addPage();
  y = TOP;
};
const ensure = (h: number) => {
  if (y + h > BOTTOM) newPage();
};
const lineH = (size: number) => size * 0.42;

function paragraph(text: string, size = 9.5, style: "normal" | "bold" | "italic" = "normal", color = INK, width = CONTENT_W, x = M) {
  font(size, style, color);
  // A number keeps its unit on its line ("1 %", "20 m").
  const lines = pdf.splitTextToSize(text.replace(/(\d) (%|m\b|kPa\b)/g, "$1\u00a0$2"), width) as string[];
  // No single line of a paragraph alone at the foot of a page.
  ensure(Math.min(lines.length, 2) * (lineH(size) + 0.6) + 0.4);
  for (const l of lines) {
    ensure(lineH(size) + 1);
    pdf.text(l, x, y, { baseline: "top" });
    y += lineH(size) + 0.6;
  }
}

/** Contents entries (level 1 and the summary's subsections) and PDF bookmarks. */
const contents: { level: 1 | 2; text: string; page: number }[] = [];
const outlineParents = new Map<string, unknown>();
const currentPage = () => pdf.getNumberOfPages();

/**
 * A heading, kept with at least `keep` mm of what follows it. `toc` puts it
 * in the contents; every level 1 heading is a bookmark, a level 2 one under
 * `bookmarkUnder` when given.
 */
function heading(text: string, level: 1 | 2, opts: { toc?: boolean; keep?: number; bookmarkUnder?: string } = {}) {
  const size = level === 1 ? 15 : 12;
  font(size, "bold", ACCENT);
  const lines = pdf.splitTextToSize(text, CONTENT_W) as string[];
  ensure(lines.length * (lineH(size) + 1) + (opts.keep ?? (level === 1 ? 30 : 24)));
  if (level === 1) y += 2;
  font(size, "bold", ACCENT);
  for (const l of lines) {
    pdf.text(l, M, y, { baseline: "top" });
    y += lineH(size) + 1;
  }
  y += 0.5;
  if (level === 1) {
    pdf.setDrawColor(...ACCENT);
    pdf.setLineWidth(0.4);
    pdf.line(M, y, PAGE_W - M, y);
    y += 3;
  }
  if (opts.toc ?? level === 1) contents.push({ level, text, page: currentPage() });
  if (level === 1) outlineParents.set(text, pdf.outline.add(null, text, { pageNumber: currentPage() }));
  else if (opts.bookmarkUnder) pdf.outline.add(outlineParents.get(opts.bookmarkUnder) ?? null, text, { pageNumber: currentPage() });
}

/** Links to a problem's page, drawn when every problem has its page. */
const problemPage = new Map<string, number>();
const pendingLinks: { page: number; x: number; y: number; w: number; h: number; id: string }[] = [];

interface Column {
  title: string;
  width: number;
  align?: "left" | "right" | "center";
}

type RGB = [number, number, number];
interface CellMeta {
  text?: string;
  color?: RGB;
  bold?: boolean;
  italic?: boolean;
  swatch?: RGB;
  /** A problem id: the cell links to its page. */
  link?: string;
}
type Cell = string | (CellMeta & { text: string });

/**
 * A table. The header repeats after a page break, and a row never splits.
 * `groupStarts[i]` false keeps row i on the page of the row before it (the
 * sub-rows of one analysis); a rule is drawn only above a group.
 */
function table(columns: Column[], rows: Cell[][], size = 8.5, groupStarts?: boolean[]) {
  const rowH = lineH(size) + 2.6;
  const drawHeader = () => {
    pdf.setFillColor(...HEAD_BG);
    pdf.rect(M, y, CONTENT_W, rowH, "F");
    font(size, "bold", INK);
    let x = M;
    for (const c of columns) {
      const tx = c.align === "right" ? x + c.width - 1.5 : c.align === "center" ? x + c.width / 2 : x + 1.5;
      pdf.text(c.title, tx, y + rowH / 2, { baseline: "middle", align: c.align ?? "left" });
      x += c.width;
    }
    y += rowH;
  };
  const hasHeader = columns.some((c) => c.title !== "");
  // Wrap the cells, row height = tallest cell.
  font(size);
  const wrapped = rows.map((row) =>
    row.map((cell, i) => {
      const text = typeof cell === "string" ? cell : cell.text;
      return pdf.splitTextToSize(text, columns[i].width - 3 - (typeof cell !== "string" && cell.swatch ? 5 : 0)) as string[];
    }),
  );
  const heights = wrapped.map((cells) => Math.max(...cells.map((c) => c.length)) * (lineH(size) + 0.5) + 2.1);
  const starts = (i: number) => !groupStarts || groupStarts[i] !== false;
  const groupHeight = (i: number) => {
    let h = heights[i];
    for (let k = i + 1; k < rows.length && !starts(k); k++) h += heights[k];
    return h;
  };
  ensure((hasHeader ? rowH : 0) + Math.min(groupHeight(0) || rowH, BOTTOM - TOP - rowH));
  if (hasHeader) drawHeader();
  rows.forEach((row, ri) => {
    const cells = wrapped[ri];
    const h = heights[ri];
    const need = starts(ri) ? Math.min(groupHeight(ri), BOTTOM - TOP - rowH) : h;
    if (y + need > BOTTOM) {
      newPage();
      if (hasHeader) drawHeader();
    }
    if (ri > 0 && starts(ri)) {
      pdf.setDrawColor(...RULE);
      pdf.setLineWidth(0.15);
      pdf.line(M, y, PAGE_W - M, y);
    }
    let x = M;
    row.forEach((cell, i) => {
      const c = columns[i];
      const meta: CellMeta = typeof cell === "string" ? {} : cell;
      if (meta.link) pendingLinks.push({ page: currentPage(), x, y, w: c.width, h, id: meta.link });
      font(size, meta.bold ? "bold" : meta.italic ? "italic" : "normal", meta.color ?? (meta.link ? ACCENT : INK));
      let tx = c.align === "right" ? x + c.width - 1.5 : c.align === "center" ? x + c.width / 2 : x + 1.5;
      if (meta.swatch) {
        pdf.setFillColor(...meta.swatch);
        pdf.setDrawColor(...MUTED);
        pdf.setLineWidth(0.15);
        pdf.rect(x + 1.5, y + 1.3, 3.5, 3.5, "FD");
        tx += 5;
      }
      cells[i].forEach((l, k) => {
        pdf.text(l, tx, y + 1.2 + k * (lineH(size) + 0.5), { baseline: "top", align: c.align ?? "left" });
      });
      x += c.width;
    });
    y += h;
  });
  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.15);
  pdf.line(M, y, PAGE_W - M, y);
  y += 3;
}

// ── Numbers and units ────────────────────────────────────────────────

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "–");
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} %`;

interface Units {
  length: string;
  stress: string;
  weight: string;
}
const SI: Units = { length: "m", stress: "kPa", weight: "kN/m³" };
const IMPERIAL: Units = { length: "ft", stress: "psf", weight: "pcf" };

function describeModel(model: MaterialModel | undefined, u: Units): { kind: string; gamma: string; strength: string; phi: string } {
  if (!model) return { kind: "–", gamma: "–", strength: "–", phi: "–" };
  const g = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
  switch (model.kind) {
    case "mohr-coulomb": {
      let c = `c′ = ${g(model.cohesion)}`;
      if (model.cohesionRateOfChange) c += `, +${g(model.cohesionRateOfChange)}/${u.length} below y = ${g(model.cohesionRefDepth ?? 0)}`;
      return { kind: "Mohr-Coulomb", gamma: g(model.unitWeight), strength: c, phi: `${g(model.frictionAngle)}°` };
    }
    case "undrained": {
      let s = `Su = ${g(model.undrainedShearStrength)}`;
      if (model.suRateOfChange) s += ` at y = ${g(model.suRefDepth ?? 0)}, +${g(model.suRateOfChange)} ${u.stress}/${u.length} below`;
      return { kind: "Undrained (φ = 0)", gamma: g(model.unitWeight), strength: s, phi: "0°" };
    }
    case "impenetrable":
      return { kind: "Impenetrable (bedrock)", gamma: g(model.unitWeight), strength: "–", phi: "–" };
    case "high-strength":
      return { kind: "High strength", gamma: g(model.unitWeight), strength: "–", phi: "–" };
    case "s-f-depth":
      if (model.drainedCohesion !== undefined && model.drainedFrictionAngle !== undefined)
        return { kind: "S = f(depth), combined", gamma: g(model.unitWeight), strength: `Su = ${g(model.suRef)} at depth ${g(model.depthRef)}, ${g(model.rate)}/${u.length}; c′ = ${g(model.drainedCohesion)}, ${g(model.drainedCohesionRate ?? 0)}/${u.length}`, phi: `${g(model.drainedFrictionAngle)}°` };
      return { kind: "S = f(depth)", gamma: g(model.unitWeight), strength: `Su = ${g(model.suRef)} at depth ${g(model.depthRef)}, ${g(model.rate)}/${u.length}`, phi: "0°" };
    case "s-f-datum":
      return { kind: "S = f(datum)", gamma: g(model.unitWeight), strength: `Su = ${g(model.suRef)} at y = ${g(model.yRef)}, ${g(model.rate)} ${u.stress}/${u.length} below`, phi: "0°" };
    default:
      return { kind: model.kind, gamma: g(model.unitWeight), strength: "see model", phi: "–" };
  }
}

// ── Figure ───────────────────────────────────────────────────────────

interface Plane {
  cx: number;
  cy: number;
  radius: number;
  lc: Pt;
  rc: Pt;
  fos: number;
  points?: Pt[];
}

function criticalPlane(slope: Slope): Plane | null {
  const valid = slope.search.filter((p) => p.fos != null);
  if (valid.length === 0) return null;
  const best = valid.reduce((a, b) => (b.fos! < a.fos! ? b : a));
  return { cx: best.cx, cy: best.cy, radius: best.radius, lc: best.lc, rc: best.rc, fos: best.fos!, points: best.points };
}

/** The smallest step of the 1, 2, 2.5, 5 series that is at least raw. */
function niceStepAbove(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const s of [1, 2, 2.5, 5, 10]) if (s * mag >= raw) return s * mag;
  return 10 * mag;
}

/**
 * Draw the (canonical) model with its critical surface; mirrored back for
 * right-to-left models so the figure matches the input.
 */
function figure(def: SlopeDefinition, slope: Slope, plane: Plane | null, label: string, units: Units, height = 88, canonical = false) {
  // The app's request builder already canonicalises (and the transform is not idempotent).
  const canon = canonical ? def : toCanonicalSlopeDefinition(def);
  const mirror = canon.orientation === "rtl";
  const xs0 = canon.coordinates.map((c) => c[0]);
  const xMinM = Math.min(...xs0);
  const xMaxM = Math.max(...xs0);
  const mx = (x: number) => (mirror ? xMinM + xMaxM - x : x);

  // World bounds: model plus the arc and (when not far away) the center.
  const ys0 = canon.coordinates.map((c) => c[1]);
  let x0 = xMinM;
  let x1 = xMaxM;
  let y0 = Math.min(...ys0);
  // Ponded water above the ground (the main water line, unless it follows
  // the ground), filled as in the program.
  const mainWater =
    canon.waterTable && canon.waterTable.mode === "custom" && Array.isArray(canon.waterTable.value) && canon.waterTable.followBoundary !== true
      ? [...(canon.waterTable.value as Pt[])].sort((a, b) => a[0] - b[0])
      : null;
  const ponds = mainWater ? freeWaterPolygons(mainWater, canon.coordinates) : [];
  let y1 = Math.max(...ys0, ...ponds.flat().map((p) => p[1]));
  const modelH = y1 - y0;
  if (plane && plane.cy - y1 < 0.8 * Math.max(modelH, (x1 - x0) * 0.3)) {
    y1 = Math.max(y1, plane.cy);
    x0 = Math.min(x0, mx(plane.cx));
    x1 = Math.max(x1, mx(plane.cx));
  }
  const padX = (x1 - x0) * 0.04;
  const padY = (y1 - y0) * 0.08;
  x0 -= padX;
  x1 += padX;
  y0 -= padY;
  y1 += padY * 1.6;

  const fw = CONTENT_W - 14;
  const s = Math.min(fw / (x1 - x0), height / (y1 - y0));
  // The box is as tall as the model drawn in it: no empty band above and below a flat slope.
  const fh = (y1 - y0) * s;
  ensure(fh + 26);
  y += 6; // room for the axis label above the plot
  const fx = M + 12;
  const fy = y;
  const ox = fx + (fw - (x1 - x0) * s) / 2;
  const oy = fy;
  const P = (x: number, yy: number): Pt => [ox + (mx(x) - x0) * s, oy + (y1 - yy) * s];
  const ax0 = ox;
  const ay0 = oy + (y1 - y0) * s;
  const axRight = ox + (x1 - x0) * s;
  // One step on both axes (the scales are equal): ticks about 10 mm apart on
  // the page, closer on a flat model so that y still gets about four, but
  // never closer than 6 mm.
  const step = niceStepAbove(Math.max(TICK_MIN_MM / s, Math.min(TICK_MM / s, (y1 - y0) / 4)));
  const ticks = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) out.push(k * step);
    return out;
  };
  const xTicks = ticks(x0, x1);
  const yTicks = ticks(y0, y1);

  // Material regions.
  const faces = polygonizeRegions(
    canon.coordinates.map((c) => c[0]),
    canon.coordinates.map((c) => c[1]),
    (canon.materialBoundaries ?? []).map((b) => b.coordinates),
  );
  const fills = materialFills(canon.materials);
  for (const face of faces) {
    const fxs = face.outer.map((c) => c[0]);
    const fys = face.outer.map((c) => c[1]);
    const inFace = (p: Pt) =>
      isPointInPolygon(p[0], p[1], fxs, fys) &&
      !face.holes.some((h) => isPointInPolygon(p[0], p[1], h.map((c) => c[0]), h.map((c) => c[1])));
    const hit = (canon.regionAssignments ?? []).find((a) => inFace(a.point));
    pdf.setFillColor(...(fills.get(hit?.materialName ?? canon.materials[0]?.name ?? "") ?? SOIL_CLASSES[0].fill));
    const rings = [face.outer, ...face.holes];
    const ops: [number, number][][] = rings.map((r) => r.map(([px, py]) => P(px, py)));
    for (const [k, ring] of ops.entries()) {
      const [sx, sy] = ring[0];
      pdf.moveTo(sx, sy);
      for (const [px, py] of ring.slice(1)) pdf.lineTo(px, py);
      pdf.close();
      if (k === ops.length - 1) pdf.fillEvenOdd();
    }
  }
  // Grid at the axis ticks, over the soil but under every line: see-through
  // hairlines, so that the soil colors show through.
  pdf.saveGraphicsState();
  pdf.setGState(new GState({ "stroke-opacity": GRID_OPACITY }));
  pdf.setDrawColor(...MUTED);
  pdf.setLineWidth(GRID_WIDTH);
  for (const v of xTicks) pdf.line(ox + (v - x0) * s, ay0, ox + (v - x0) * s, oy);
  for (const v of yTicks) pdf.line(ax0, oy + (y1 - v) * s, axRight, oy + (y1 - v) * s);
  pdf.restoreGraphicsState();

  // Outline and boundaries.
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.35);
  const outline = canon.coordinates.map(([px, py]) => P(px, py));
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    pdf.line(a[0], a[1], b[0], b[1]);
  }
  pdf.setLineWidth(0.2);
  for (const face of faces) {
    for (const ring of [face.outer, ...face.holes]) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = P(ring[i][0], ring[i][1]);
        const b = P(ring[i + 1][0], ring[i + 1][1]);
        pdf.line(a[0], a[1], b[0], b[1]);
      }
    }
  }

  if (ponds.length) {
    pdf.saveGraphicsState();
    pdf.setGState(new GState({ opacity: POND_OPACITY }));
    pdf.setFillColor(...POND_COLOR.rgb);
    for (const pond of ponds) {
      const pts = pond.map(([px, py]) => P(px, py));
      pdf.lines(
        pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]),
        pts[0][0],
        pts[0][1],
        [1, 1],
        "F",
        true,
      );
    }
    pdf.restoreGraphicsState();
  }

  // Water lines (continued horizontally to the model edges, as analyzed).
  const waterLines: Pt[][] = [];
  if (canon.waterTable && canon.waterTable.mode === "custom" && Array.isArray(canon.waterTable.value)) {
    waterLines.push(canon.waterTable.value);
  }
  for (const wt of canon.waterTables ?? []) waterLines.push(wt.coordinates);
  for (const line of waterLines) {
    const sorted = [...line].sort((a, b) => a[0] - b[0]);
    pdf.setDrawColor(...WATER);
    pdf.setLineWidth(0.45);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = P(sorted[i][0], sorted[i][1]);
      const b = P(sorted[i + 1][0], sorted[i + 1][1]);
      pdf.line(a[0], a[1], b[0], b[1]);
    }
    pdf.setLineDashPattern([1.2, 0.9], 0);
    pdf.setLineWidth(0.3);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first[0] > xMinM) {
      const a = P(xMinM, first[1]);
      const b = P(first[0], first[1]);
      pdf.line(a[0], a[1], b[0], b[1]);
    }
    if (last[0] < xMaxM) {
      const a = P(last[0], last[1]);
      const b = P(xMaxM, last[1]);
      pdf.line(a[0], a[1], b[0], b[1]);
    }
    pdf.setLineDashPattern([], 0);
    // Water symbol at the middle of the longest segment.
    let bi = 0;
    for (let i = 0; i + 1 < sorted.length; i++) {
      if (sorted[i + 1][0] - sorted[i][0] > sorted[bi + 1][0] - sorted[bi][0]) bi = i;
    }
    const wx = (sorted[bi][0] + sorted[bi + 1][0]) / 2;
    const wy = (sorted[bi][1] + sorted[bi + 1][1]) / 2;
    const [px, py] = P(wx, wy);
    pdf.setFillColor(...WATER);
    pdf.triangle(px - 1.3, py - 2, px + 1.3, py - 2, px, py, "F");
    pdf.line(px - 1.2, py + 0.7, px + 1.2, py + 0.7);
    pdf.line(px - 0.7, py + 1.3, px + 0.7, py + 1.3);
  }

  // Loads.
  const surfaceY = (x: number) => slope.getExternalYIntersection(x);
  const arrow = (x: number, color: [number, number, number], len = 6) => {
    const [px, py] = P(x, surfaceY(x));
    pdf.setDrawColor(...color);
    pdf.setFillColor(...color);
    pdf.setLineWidth(0.3);
    pdf.line(px, py - len, px, py - 1.4);
    pdf.triangle(px - 0.9, py - 1.6, px + 0.9, py - 1.6, px, py, "F");
    return [px, py - len] as Pt;
  };
  for (const u of canon.udls ?? []) {
    const n = Math.max(3, Math.round(((u.x2 - u.x1) * s) / 5));
    const tops: Pt[] = [];
    for (let i = 0; i <= n; i++) tops.push(arrow(u.x1 + ((u.x2 - u.x1) * i) / n, LOAD, 5));
    pdf.setDrawColor(...LOAD);
    for (let i = 0; i + 1 < tops.length; i++) pdf.line(tops[i][0], tops[i][1], tops[i + 1][0], tops[i + 1][1]);
    font(7, "normal", LOAD);
    const mid = tops[Math.floor(tops.length / 2)];
    pdf.text(`q = ${u.magnitude} ${units.stress}`, mid[0], mid[1] - 1, { align: "center" });
  }
  for (const l of canon.lineLoads ?? []) {
    const top = arrow(l.x, LOAD, 8);
    font(7, "normal", LOAD);
    pdf.text(`P = ${l.magnitude}`, top[0], top[1] - 1, { align: "center" });
  }
  // Reinforcement: the bar, with the head (end 1) marked.
  for (const r of canon.reinforcements ?? []) {
    const [ax, ay] = P(r.x1, r.y1);
    const [bx, by] = P(r.x2, r.y2);
    pdf.setDrawColor(142, 68, 173);
    pdf.setLineWidth(0.35);
    pdf.line(ax, ay, bx, by);
    pdf.setFillColor(142, 68, 173);
    pdf.circle(ax, ay, 0.5, "F");
  }
  // Piles: a thick bar.
  for (const p of canon.piles ?? []) {
    const [ax, ay] = P(p.x1, p.y1);
    const [bx, by] = P(p.x2, p.y2);
    pdf.setDrawColor(93, 64, 55);
    pdf.setLineWidth(0.8);
    pdf.line(ax, ay, bx, by);
  }

  // Critical surface.
  if (plane) {
    pdf.setDrawColor(...SURFACE);
    pdf.setLineWidth(0.55);
    const n = 80;
    let prev: Pt | null = null;
    const pts: Pt[] = plane.points ?? Array.from({ length: n + 1 }, (_, i) => {
      const x = plane.lc[0] + ((plane.rc[0] - plane.lc[0]) * i) / n;
      return [x, plane.cy - Math.sqrt(Math.max(0, plane.radius ** 2 - (x - plane.cx) ** 2))] as Pt;
    });
    for (const [x, yy] of pts) {
      const p = P(x, yy);
      if (prev) pdf.line(prev[0], prev[1], p[0], p[1]);
      prev = p;
    }
    const [ccx, ccy] = P(plane.cx, plane.cy);
    // Center and radii only for circles.
    const inside = !plane.points && ccy >= fy && ccy <= fy + fh && ccx >= fx && ccx <= fx + fw;
    pdf.setLineWidth(0.15);
    pdf.setLineDashPattern([0.8, 0.8], 0);
    for (const e of [plane.lc, plane.rc]) {
      const [ex, ey] = P(e[0], e[1]);
      if (inside) pdf.line(ccx, ccy, ex, ey);
    }
    pdf.setLineDashPattern([], 0);
    if (inside) {
      pdf.setFillColor(...SURFACE);
      pdf.circle(ccx, ccy, 0.7, "F");
      font(8, "bold", SURFACE);
      pdf.text(fmt(plane.fos), ccx + 1.8, ccy - 1, { baseline: "bottom" });
    }
  }

  // Axes.
  pdf.setDrawColor(...MUTED);
  pdf.setLineWidth(0.2);
  pdf.line(ax0, ay0, axRight, ay0);
  pdf.line(ax0, ay0, ax0, oy);
  font(6.5, "normal", MUTED);
  // A label that would touch the one before it is left out; its tick stays.
  let labelEnd = -Infinity;
  for (const v of xTicks) {
    const px = ox + (v - x0) * s;
    pdf.line(px, ay0, px, ay0 + 1);
    const text = String(+v.toFixed(2));
    const half = pdf.getTextWidth(text) / 2;
    if (px - half < labelEnd + 1) continue;
    pdf.text(text, px, ay0 + 1.5, { align: "center", baseline: "top" });
    labelEnd = px + half;
  }
  for (const v of yTicks) {
    const py = oy + (y1 - v) * s;
    pdf.line(ax0 - 1, py, ax0, py);
    pdf.text(String(+v.toFixed(2)), ax0 - 1.5, py, { align: "right", baseline: "middle" });
  }
  pdf.text(`x (${units.length})`, axRight, ay0 + 5, { align: "right", baseline: "top" });
  pdf.text(`y (${units.length})`, ax0 - 1, oy - 1.5, { align: "center", baseline: "bottom" });

  y = Math.max(fy + fh, ay0 + 6) + 4;
  // Legend: one sample per kind of line drawn, so the figure reads in greyscale too.
  const legend: { text: string; draw: (x: number, yy: number) => void }[] = [];
  if (plane) {
    legend.push({
      text: plane.points ? "slip surface" : "slip circle",
      draw: (x, yy) => {
        pdf.setDrawColor(...SURFACE);
        pdf.setLineWidth(0.55);
        pdf.line(x, yy, x + 6, yy);
      },
    });
  }
  if (waterLines.length) {
    legend.push({
      text: "piezometric line",
      draw: (x, yy) => {
        pdf.setDrawColor(...WATER);
        pdf.setLineWidth(0.45);
        pdf.line(x, yy, x + 6, yy);
      },
    });
  }
  if ((canon.udls ?? []).length || (canon.lineLoads ?? []).length) {
    legend.push({
      text: "load",
      draw: (x, yy) => {
        pdf.setDrawColor(...LOAD);
        pdf.setFillColor(...LOAD);
        pdf.setLineWidth(0.3);
        pdf.line(x + 3, yy - 1.6, x + 3, yy + 0.2);
        pdf.triangle(x + 2.2, yy + 0.1, x + 3.8, yy + 0.1, x + 3, yy + 1.4, "F");
      },
    });
  }
  if ((canon.reinforcements ?? []).length) {
    legend.push({
      text: "reinforcement",
      draw: (x, yy) => {
        pdf.setDrawColor(142, 68, 173);
        pdf.setLineWidth(0.35);
        pdf.line(x, yy, x + 6, yy);
      },
    });
  }
  if ((canon.piles ?? []).length) {
    legend.push({
      text: "pile",
      draw: (x, yy) => {
        pdf.setDrawColor(93, 64, 55);
        pdf.setLineWidth(0.8);
        pdf.line(x, yy, x + 6, yy);
      },
    });
  }
  if (legend.length) {
    font(7, "normal", MUTED);
    const widths = legend.map((l) => 8 + pdf.getTextWidth(l.text));
    const total = widths.reduce((a, b) => a + b, 0) + 5 * (legend.length - 1);
    let lx = PAGE_W / 2 - total / 2;
    legend.forEach((l, k) => {
      l.draw(lx, y + 1.2);
      font(7, "normal", MUTED);
      pdf.text(l.text, lx + 8, y + 1.2, { baseline: "middle" });
      lx += widths[k] + 5;
    });
    y += 4.5;
  }
  font(8, "italic", MUTED);
  pdf.text(label, PAGE_W / 2, y, { align: "center", baseline: "top" });
  y += 6;
}

// ── Running the problems ─────────────────────────────────────────────

interface CheckResult {
  check: VerificationCheck;
  fos: number | null;
  diff: number;
  pass: boolean;
}
interface CaseResult {
  c: VerificationCase;
  results: CheckResult[];
  /** cSlope's result for each presented analysis (presentation.ts), by index. */
  analyses: (number | null)[];
  slope: Slope;
  plane: Plane | null;
}

function evaluate(c: VerificationCase): CaseResult {
  let firstSlope: Slope | null = null;
  const results = c.checks.map((check) => {
    const { fos, slope } = runVerification(c.definition, check.method, check.options);
    firstSlope ??= slope;
    const diff = fos == null ? NaN : ((fos - check.published) / check.published) * 100;
    return { check, fos, diff, pass: fos != null && agrees(check, fos) };
  });
  // An analysis without checks runs a published value's method: run it,
  // so that the value is compared (as on the website).
  const analyses = presentedAnalyses(c).map((a) =>
    a.checks.length ? results[a.checks[0]].fos : runVerification(c.definition, a.method, a.options).fos,
  );
  // A problem checked by finite elements only has no limit equilibrium
  // analysis: its figure shows the geometry without a surface.
  const slope = firstSlope ?? buildSlope(toCanonicalSlopeDefinition(c.definition));
  const plane = firstSlope ? criticalPlane(firstSlope) : null;
  // The figure needs the geometry and the critical surface only: drop the
  // thousands of searched surfaces (with their slices) kept for every case.
  slope.setSearchResults([]);
  return { c, results, analyses, slope, plane };
}

console.log(`Running ${CASES.length} verification problems…`);
const caseResults = CASES.map((c) => {
  const r = evaluate(c);
  console.log(`  ${c.id.padEnd(8)} ${r.results.map((x) => `${fmt(x.fos ?? NaN)} (${pct(x.diff)})`).join("  ")}`);
  return r;
});

// Probabilistic problems: reliability index and probability of failure.
console.log(`Running ${RELIABILITY.length} probabilistic problems…`);
/** The probabilistic analyses of each problem (a problem can have more than one). */
const reliabilityResults = new Map<string, { rc: (typeof RELIABILITY)[number]; results: ReliabilityCheckResult[] }[]>();
for (const rc of RELIABILITY) {
  const results = runReliabilityCase(rc);
  reliabilityResults.set(rc.id, [...(reliabilityResults.get(rc.id) ?? []), { rc, results }]);
  console.log(`  ${rc.id.padEnd(8)} ${results.map((x) => `${x.quantity} ${fmt(x.computed)}`).join("  ")}`);
}
const RELIABILITY_LABELS: Record<ReliabilityCheckResult["quantity"], string> = {
  fos: "F",
  "beta-taylor": "β lognormal (Taylor series)",
  "pf-taylor": "Pf lognormal (Taylor series)",
  "beta-mc": "β lognormal (Monte Carlo)",
  "pf-mc": "Pf, share F < 1 (Monte Carlo)",
};

/**
 * A probabilistic analysis's results by quantity, as the public edition
 * shows them: cSlope's value, the sources' values, the other programs' range.
 */
function reliabilityPresentation(results: ReliabilityCheckResult[]) {
  const quantities = [...new Set(results.map((x) => x.quantity))].filter((q) => q !== "fos");
  return quantities.map((quantity) => {
    const rows = results.filter((x) => x.quantity === quantity);
    const programs = rows.filter((x) => isProgramSource(x.publishedBy)).map((x) => x.published);
    return {
      quantity,
      computed: rows[0].computed,
      published: rows.filter((x) => !isProgramSource(x.publishedBy)),
      programs: programs.length ? { min: Math.min(...programs), max: Math.max(...programs) } : null,
    };
  });
}

// ── Document ─────────────────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "packages/desktop/package.json"), "utf-8")) as { version?: string };
let commit = "unknown";
try {
  commit = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"]).toString().trim();
} catch {
  // Not a git checkout.
}
const today = new Date().toISOString().slice(0, 10);

const allChecks = caseResults.flatMap((r) => r.results);
const reliabilityRows = [...reliabilityResults.values()].flat().flatMap((e) => e.results).filter((r) => r.quantity !== "fos");
const nChecks = allChecks.length + reliabilityRows.length;
const nPass = allChecks.filter((r) => r.pass).length + reliabilityRows.filter((r) => r.pass).length;
// Failing checks that wait for an engine change (counted as not passing).
const nPending = allChecks.filter((r) => !r.pass && r.check.pending).length;
// Per problem, the sources' values, the other programs' range and cSlope's
// result for each analysis (presentation.ts).
const nPublished = CASES.reduce((n, c) => n + paperValues(c).length, 0);
const nAnalyses = CASES.reduce((n, c) => n + presentedAnalyses(c).length, 0);
/** cSlope's result for each analysis. */
const analysisRows = (r: CaseResult) => presentedAnalyses(r.c).map((a, j) => ({ a, fos: r.analyses[j] }));
const PENDING: [number, number, number] = [196, 120, 20];
/** Pass, Fail, or Pending for a failing check that waits for an engine change (internal edition only). */
const statusCell = (pass: boolean, pending?: string): Cell =>
  pass ? { text: "Pass", color: PASS, bold: true } : pending ? { text: "Pending", color: PENDING, bold: true } : { text: "Fail", color: FAIL, bold: true };

// ── The comparisons ──────────────────────────────────────────────────
//
// Each problem as the website's table has it (generate-data.ts): the values
// its sources publish, each with cSlope's result for the same method, and
// each analysis with cSlope's result and the other programs' range. The
// limit equilibrium results are this run's; the finite element results,
// which take minutes, are read from the committed table.

const FEM_LABEL = "Strength reduction (FE)";
const DATA_FILE = path.join(REPO, "packages/website/src/content/generated/verification.json");
const committed = fs.existsSync(DATA_FILE) ? (JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as VerificationData) : null;
const committedById = new Map((committed?.problems ?? []).map((p) => [p.id, p]));
const round4 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(4)));
/** The site and the public edition name no other program, not even by letter. */
const femSource = (ref: FemReference) => (isProgramSource(ref.source) ? "another program's verification manual" : ref.source);

type ProblemView = Pick<VerificationProblem, "id" | "published" | "results" | "fem">;

function view(r: CaseResult): ProblemView {
  const { c } = r;
  const analyses = presentedAnalyses(c);
  // The same expressions as generate-data.ts, so that the two can be compared.
  let published: PublishedValue[] = paperValues(c).map(({ analysis, ...v }) => {
    const j = analyses.findIndex((a) => a.label === analysis);
    return j >= 0 ? { ...v, analysis, computed: round4(r.analyses[j]) } : { ...v, computed: null };
  });
  const results: VerificationResult[] = analyses.map((a, j) => ({
    method: a.label,
    computed: round4(r.analyses[j]),
    programs: a.programs && { min: a.programs.min, max: a.programs.max },
  }));
  if (!c.fem) return { id: c.id, published, results };
  const table = committedById.get(c.id);
  const computed = table?.results.find((x) => x.method === FEM_LABEL)?.computed ?? null;
  published = published.slice();
  for (const ref of c.fem.references) {
    const source = femSource(ref);
    const j = published.findIndex((v) => v.value === ref.value && v.source === source);
    const disputed = ref.disputed ? { disputed: ref.disputed } : {};
    if (j >= 0) published[j] = { ...published[j], ...disputed, analysis: FEM_LABEL, computed };
    else published.push({ value: ref.value, ...(ref.upper != null ? { upper: ref.upper } : {}), method: ref.method, source, ...disputed, analysis: FEM_LABEL, computed });
  }
  results.push({ method: FEM_LABEL, computed, programs: null });
  return { id: c.id, published, results, ...(table?.fem ? { fem: table.fem } : {}) };
}

const views = caseResults.map(view);
const caseById = new Map(CASES.map((c) => [c.id, c]));
const sectionOf = new Map(CASES.map((c, i) => [c.id, `3.${i + 1}`]));

// The committed table is the website's: say when it no longer matches this run.
if (!committed) {
  console.warn(`No ${path.relative(REPO, DATA_FILE)}: the report has no finite element results.`);
} else {
  const stale = views.filter((v) => {
    const p = committedById.get(v.id);
    return !p || JSON.stringify([p.published, p.results]) !== JSON.stringify([v.published, v.results]);
  });
  if (stale.length) {
    console.warn(
      `The committed verification table differs from this run on ${stale.length} problem(s): ${stale.slice(0, 10).map((v) => v.id).join(", ")}${stale.length > 10 ? ", …" : ""}. Regenerate it (bun scripts/generate-data.ts in packages/website).`,
    );
  } else {
    console.log("The committed verification table matches this run.");
  }
}

/** The midpoint of the other programs' range, the reference of the statistics (VERIFICATION-LOG.md). */
const midpoint = (r: { min: number; max: number }) => (r.min + r.max) / 2;
const relError = (computed: number, reference: number) => ((computed - reference) / reference) * 100;

/** A finite element result's reference in its problem's setup. */
function femReferenceOf(id: string, v: PublishedValue): FemReference | undefined {
  return caseById.get(id)?.fem?.references.find((ref) => ref.value === v.value && femSource(ref) === v.source);
}

interface Point {
  id: string;
  analysis: string;
  reference: string;
  source: string;
  computed: number;
  /** Relative error in percent; for a pair of finite element bounds, from the nearer bound and 0 between them. */
  error: number;
}

const programPoints: Point[] = [];
const literaturePoints: Point[] = [];
const femPoints: Point[] = [];
for (const v of views) {
  for (const res of v.results) {
    if (res.programs && res.computed != null) {
      programPoints.push({ id: v.id, analysis: res.method, reference: formatRange(res.programs), source: "other programs", computed: res.computed, error: relError(res.computed, midpoint(res.programs)) });
    }
  }
  for (const p of v.published) {
    // A disputed value measures its source, not cSlope: shown, not counted.
    if (p.computed == null || p.disputed || !p.analysis) continue;
    if (p.analysis === FEM_LABEL) {
      const ref = femReferenceOf(v.id, p);
      const error = ref ? femDeviation(ref, p.computed) * 100 : relError(p.computed, p.value);
      femPoints.push({ id: v.id, analysis: p.analysis, reference: formatPaperValue(p), source: p.source, computed: p.computed, error });
    } else {
      literaturePoints.push({ id: v.id, analysis: p.analysis, reference: formatPaperValue(p), source: p.source, computed: p.computed, error: relError(p.computed, p.value) });
    }
  }
}

interface Stat {
  n: number;
  mean: number;
  meanAbs: number;
  rms: number;
  maxAbs: number;
}
function statOf(ps: Point[]): Stat {
  const e = ps.map((p) => p.error);
  const n = e.length;
  if (n === 0) return { n, mean: 0, meanAbs: 0, rms: 0, maxAbs: 0 };
  return {
    n,
    mean: e.reduce((s, x) => s + x, 0) / n,
    meanAbs: e.reduce((s, x) => s + Math.abs(x), 0) / n,
    rms: Math.sqrt(e.reduce((s, x) => s + x * x, 0) / n),
    maxAbs: Math.max(...e.map(Math.abs)),
  };
}
const programStat = statOf(programPoints);
const literatureStat = statOf(literaturePoints);
const femStat = statOf(femPoints);

// The limit equilibrium statistics are VERIFICATION-LOG.md's: stop if they drift apart.
{
  const log = logPoints({ problems: views } as unknown as VerificationData);
  const near = (a: Stat, b: ReturnType<typeof logStats>) =>
    a.n === b.n && [a.mean - b.mean, a.meanAbs - b.meanAbs, a.rms - b.rms, a.maxAbs - b.maxAbs].every((d) => Math.abs(d) < 1e-9);
  if (!near(programStat, logStats(log.programs)) || !near(literatureStat, logStats(log.papers))) {
    throw new Error("The report's error statistics differ from those of scripts/verification-log.ts.");
  }
}

// Checks within their tolerance, as the tests count them (tolerance.ts, fem-cases.ts).
const programChecks = allChecks.filter((x) => isProgramSource(x.check.publishedBy));
const literatureChecks = allChecks.filter((x) => !isProgramSource(x.check.publishedBy));
const femRefs = views.flatMap((v) => {
  const c = caseById.get(v.id)!;
  const fos = v.results.find((x) => x.method === FEM_LABEL)?.computed ?? null;
  return (c.fem?.references ?? []).map((ref) => ({ id: v.id, ref, fos }));
});
const femCounted = femRefs.filter((x) => !x.ref.disputed);
const nFemPass = femCounted.filter((x) => x.fos != null && femAgrees(x.ref, x.fos)).length;
const nFemDisputed = femRefs.length - femCounted.length;

// ── Text helpers ─────────────────────────────────────────────────────

const pct2 = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} %`;
const abs2 = (v: number) => `${Math.abs(v).toFixed(2)} %`;
const within = (ps: Point[], limit: number) => ps.filter((p) => Math.abs(p.error) <= limit + 1e-9).length;
const largest = (ps: Point[], n: number) => [...ps].sort((a, b) => Math.abs(b.error) - Math.abs(a.error)).slice(0, n);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

let figureNo = 0;
let tableNo = 0;
function caption(text: string) {
  font(8, "italic", MUTED);
  const lines = pdf.splitTextToSize(text, CONTENT_W) as string[];
  ensure(lines.length * 3.6 + 1);
  for (const l of lines) {
    pdf.text(l, PAGE_W / 2, y, { align: "center", baseline: "top" });
    y += 3.6;
  }
  y += 1.5;
}
/** A table caption above its table, kept with the first rows. */
function tableCaption(text: string) {
  ensure(22);
  font(8, "italic", MUTED);
  pdf.text(text, M, y, { baseline: "top" });
  y += 4.5;
}

/**
 * Histograms of the signed deviations, one panel per comparison on the same
 * x scale (small multiples: one series each, so no legend).
 */
function errorHistograms(panels: { title: string; points: Point[] }[]) {
  const all = panels.flatMap((p) => p.points.map((x) => Math.abs(x.error)));
  const range = Math.max(3, Math.ceil(Math.max(...all, 0)));
  const bin = 0.25;
  const bins = Math.round((2 * range) / bin);
  const panelH = 19;
  const gap = 7;
  const x0 = M + 12;
  const w = CONTENT_W - 14;
  const totalH = panels.length * (panelH + gap) + 8;
  ensure(totalH + 12);
  y += 5;
  const bx = (e: number) => x0 + ((e + range) / (2 * range)) * w;
  panels.forEach((panel) => {
    const counts = new Array<number>(bins).fill(0);
    for (const p of panel.points) counts[Math.min(bins - 1, Math.max(0, Math.floor((p.error + range) / bin)))]++;
    const top = Math.max(...counts, 1);
    font(7.5, "bold", INK);
    pdf.text(panel.title, x0, y, { baseline: "bottom" });
    const base = y + panelH;
    // Recessive frame: base line, zero line and the count scale.
    pdf.setDrawColor(...RULE);
    pdf.setLineWidth(0.15);
    pdf.line(x0, base, x0 + w, base);
    pdf.setLineDashPattern([0.8, 0.8], 0);
    pdf.setDrawColor(...MUTED);
    pdf.line(bx(0), y + 1, bx(0), base);
    pdf.setLineDashPattern([], 0);
    font(6.5, "normal", MUTED);
    pdf.text(String(top), x0 - 1.5, y + 1.5, { align: "right", baseline: "middle" });
    pdf.text("0", x0 - 1.5, base, { align: "right", baseline: "middle" });
    pdf.setFillColor(...ACCENT);
    counts.forEach((n, k) => {
      if (!n) return;
      const h = ((panelH - 1.5) * n) / top;
      const left = bx(-range + k * bin) + 0.15;
      const right = bx(-range + (k + 1) * bin) - 0.15;
      pdf.rect(left, base - h, right - left, h, "F");
    });
    y = base + gap;
  });
  // The x axis under the last panel.
  const base = y - gap;
  font(6.5, "normal", MUTED);
  pdf.setDrawColor(...MUTED);
  pdf.setLineWidth(0.15);
  for (let v = -range; v <= range; v++) {
    pdf.line(bx(v), base, bx(v), base + 1);
    pdf.text(v === 0 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}`, bx(v), base + 1.5, { align: "center", baseline: "top" });
  }
  pdf.text("Deviation (%): cSlope above the reference to the right", x0 + w, base + 5, { align: "right", baseline: "top" });
  y = base + 10;
}

// ── Per-analysis comparison rows ─────────────────────────────────────

/** The source of a published value, with its method where that is not the analysis's own. */
function sourceText(p: PublishedValue, analysis: string | null): string {
  return p.method && p.method !== analysis ? `${p.source}: ${p.method}` : p.source;
}

interface ComparisonRows {
  /** Per row: the problem id (on every row of the problem), the cells, and whether it starts an analysis. */
  rows: { id: string; cells: Cell[]; start: boolean; problemStart: boolean }[];
  footnotes: string[];
}

/**
 * One row per analysis: cSlope's value, each published value for the same
 * method with its source and the difference (sub-rows when there are
 * several), and the other programs' range with the difference from its
 * midpoint. Published values whose method cSlope does not have follow, not
 * compared.
 */
function comparisonRows(v: ProblemView): ComparisonRows {
  const rows: ComparisonRows["rows"] = [];
  const footnotes: string[] = [];
  const push = (cells: Cell[], start: boolean) => rows.push({ id: v.id, cells, start, problemStart: rows.length === 0 });
  const diffCell = (p: PublishedValue, computed: number | null): Cell => {
    if (computed == null) return "–";
    let text: string;
    if (p.analysis === FEM_LABEL) {
      const ref = femReferenceOf(v.id, p);
      const dev = ref ? femDeviation(ref, computed) * 100 : relError(computed, p.value);
      text = ref?.kind === "bounds" && dev === 0 ? "in bounds" : pct2(dev);
    } else {
      text = pct2(relError(computed, p.value));
    }
    if (!p.disputed) return text;
    footnotes.push(`* Disputed, not counted in section 2: ${p.source}'s ${formatPaperValue(p)}. ${p.disputed}`);
    return { text: `${text} *`, italic: true, color: MUTED };
  };
  for (const res of v.results) {
    const pubs = v.published.filter((p) => p.analysis === res.method);
    const programs = res.programs ? formatRange(res.programs) : "";
    const programDiff = res.programs && res.computed != null ? pct2(relError(res.computed, midpoint(res.programs))) : "";
    const computed = fmt(res.computed ?? NaN);
    if (!pubs.length) {
      push([res.method, computed, "", "", "", programs, programDiff], true);
      continue;
    }
    pubs.forEach((p, k) =>
      push(
        [
          k === 0 ? res.method : "",
          k === 0 ? computed : "",
          formatPaperValue(p),
          sourceText(p, res.method),
          diffCell(p, res.computed),
          k === 0 ? programs : "",
          k === 0 ? programDiff : "",
        ],
        k === 0,
      ),
    );
  }
  for (const p of v.published.filter((x) => !x.analysis)) {
    push([{ text: "–", color: MUTED }, { text: "–", color: MUTED }, formatPaperValue(p), sourceText(p, null), "", "", ""], true);
  }
  return { rows, footnotes };
}

const COMPARISON_COLUMNS: Column[] = [
  { title: "Analysis", width: 42 },
  { title: "cSlope", width: 14, align: "right" },
  { title: "Published", width: 17, align: "right" },
  { title: "Source", width: 47 },
  { title: "Diff.", width: 17, align: "right" },
  { title: "Other programs", width: 23, align: "right" },
  { title: "Diff.", width: 14, align: "right" },
];

// ── Cover ────────────────────────────────────────────────────────────

pdf.setFillColor(...ACCENT);
pdf.rect(0, 0, PAGE_W, 92, "F");
font(34, "bold", [255, 255, 255]);
pdf.text("cSlope", M, 42);
font(20, "normal", [255, 255, 255]);
pdf.text("Verification manual", M, 56);
font(11, "normal", [220, 232, 242]);
pdf.text("Slope stability analyses compared with published results", M, 68);
y = 112;
paragraph(
  PUBLIC
    ? `This manual gives the factors of safety cSlope computes for ${CASES.length} slope stability problems from the geotechnical literature and from the verification manuals of other slope stability programs, next to the values the sources publish and the range of the other programs' results.`
    : `This manual compares the factors of safety cSlope computes with the values published for ${CASES.length} slope stability problems from the geotechnical literature and from the verification manuals of commercial slope stability programs.`,
  11,
);
y += 4;
table(
  [
    { title: "", width: 80 },
    { title: "", width: CONTENT_W - 80 },
  ],
  [
    ["Program version", `cSlope ${pkg.version ?? ""} (commit ${commit})`],
    ["Report generated", today],
    ["Problems", String(CASES.length)],
    ["cSlope analyses", String(nAnalyses)],
    ["Values published by the sources", String(nPublished)],
    ["Mean absolute deviation from other programs", `${abs2(programStat.meanAbs)} (${programStat.n} results)`],
    ["Mean absolute deviation from the literature", `${abs2(literatureStat.meanAbs)} (${literatureStat.n} values)`],
    ...(PUBLIC
      ? []
      : [
          ["Checks within tolerance", `${nPass} of ${nChecks}`],
          ...(nPending > 0 ? [["Pending engine changes", `${nPending} of the others`]] : []),
        ]),
  ],
  10,
);
font(8, "italic", MUTED);
pdf.text("Produced by packages/desktop/scripts/verification-report.ts from the problems in packages/engine/src/verification.", M, BOTTOM - 4);

// Contents: filled in at the end, when the page numbers are known.
newPage();
const CONTENTS_PAGE = currentPage();

// ── 1 Introduction ───────────────────────────────────────────────────

newPage();
heading("1  Introduction", 1);
paragraph(
  "Each problem is defined once, in cSlope's source code (packages/engine/src/verification/problems.ts). The automated tests run the same definitions on every change to the program, with a shorter search on the circular problems; this report runs them with the full search given below.",
);
y += 2;
heading("Analysis settings", 2, { toc: false });
table(
  [
    { title: "Setting", width: 62 },
    { title: "Value", width: CONTENT_W - 62 },
  ],
  [
    ["Slip surfaces", "The surface the source gives, circular or not, where it gives one; otherwise a search for the critical circle, followed by non-circular optimization where the problem says so."],
    ["Number of slices", `${VERIFICATION_OPTIONS.slices}, unless the problem states otherwise`],
    ["Search", `${FULL_VERIFICATION_OPTIONS.iterations} entry and exit combinations, then ${FULL_VERIFICATION_OPTIONS.refinedIterations} more around the best surfaces`],
    ["Convergence tolerance", `${VERIFICATION_OPTIONS.tolerance} on the factor of safety; ${NON_CIRCULAR_VERIFICATION_OPTIONS.tolerance} with non-circular optimization`],
    ["Methods", "Bishop simplified; Janbu simplified (uncorrected unless stated); Morgenstern-Price with a half-sine interslice function; Spencer, which is Morgenstern-Price with a constant interslice function"],
    [
      "Pore pressure",
      `From the piezometric line: the head is the vertical distance below the line (the usual convention). Problems described with "phreatic correction" use the vertical distance × cos²θ, where θ is the inclination of the line.`,
    ],
    ["Unit weight of water", "9.807 kN/m³"],
  ],
);
heading("Units", 2, { toc: false, keep: 12 });
paragraph(
  "Problems published in imperial units without water are entered in those units (ft, psf, pcf); the factor of safety is dimensionless. Problems with water are converted to SI, because cSlope uses γw = 9.807 kN/m³ (62.4 pcf is 9.80 kN/m³, less than 0.1 % apart).",
);
y += 2;
heading("Source of the input data", 2, { toc: false, keep: 12 });
paragraph(
  PUBLIC
    ? "The input data were transcribed from the publications and from the verification manuals of other slope stability programs, most of them commercial, and cross-checked against an independent open-source transcription of the same problems. For each problem the report lists the values the sources publish, with the method where the source names one; some are hand calculations, chart readings, trial wedges or finite element results rather than the method of slices. For each analysis it also gives the range of results that other programs publish in their verification manuals, without naming the programs. Problem ids are cSlope's own: the number is the slope, the letter a variant of it."
    : "The input data were transcribed from the publications and from the verification manuals of commercial slope stability programs, and cross-checked against an independent open-source transcription of the same problems. Values that only a commercial program's manual gives are attributed to \"commercial program A\", \"B\" and so on, one letter per program. Each published value is labeled with its source; where a figure had to be digitized or an input inferred, the notes of the problem say so. Checks marked \"pending\" wait for an engine change named in the notes. Problem ids are cSlope's own: the number is the slope, the letter a variant of it.",
);
y += 2;
heading("How to read the tables", 2, { toc: false, keep: 12 });
paragraph(
  "In section 3 and in appendix A each row is one cSlope analysis (a method on a surface or a search): cSlope's factor of safety, each value the literature publishes for the same method with its source, and the range of the other programs' results. Diff. is cSlope's value minus the reference, in percent of the reference: the lower end of a published range, the midpoint of the programs' range, as in the statistics of section 2. A finite element result between a published pair of bounds is marked \"in bounds\". A published value whose method cSlope does not have is listed with \"–\" in the Analysis column and is not compared. A value marked * is disputed: it is shown with the reason and left out of the statistics.",
);
y += 2;
heading("Soil colors", 2, { toc: false, keep: 50 });
paragraph(
  "The figures and material tables color each material by its kind of soil, the same in every problem. The class comes from the material's name, and from its strength model where the name does not tell. Where a problem has several materials of one class, they are drawn in tints of its color, lighter to darker in the order of the material table.",
);
table(
  [
    { title: "Class", width: 62 },
    { title: "Rule", width: CONTENT_W - 62 },
  ],
  SOIL_CLASSES.map((c) => [{ text: c.label, swatch: c.fill }, c.rule]),
);

// ── 2 Summary ────────────────────────────────────────────────────────

newPage();
heading("2  Summary of results", 1);
const SUMMARY = "2  Summary of results";
paragraph(
  `cSlope was run on ${CASES.length} problems, with ${nAnalyses} analyses. Each result is compared with two kinds of reference. The first is the results that other slope stability programs publish for the same analysis in their verification manuals: ${programStat.n} results, compared with the midpoint of the programs' range where more than one program gives a value. The second is the literature: ${literatureStat.n} values from papers, books, design manuals and theory. The finite element factors of safety are compared with published finite element, finite difference, limit analysis and theoretical values (${femStat.n} references). The deviation is cSlope's factor of safety minus the reference, in percent of the reference, so a negative mean deviation means that cSlope is lower on average.`,
);
y += 2;
heading("2.1  Deviations from each reference", 2, { toc: true, bookmarkUnder: SUMMARY });
tableCaption(`Table ${++tableNo}. Deviations of cSlope's factors of safety from each reference, in percent of the reference.`);
const statRow = (label: string, s: Stat, tol: string): Cell[] => [label, String(s.n), pct2(s.mean), abs2(s.meanAbs), abs2(s.rms), abs2(s.maxAbs), tol];
table(
  [
    { title: "Reference", width: 50 },
    { title: "Results", width: 15, align: "right" },
    { title: "Mean", width: 17, align: "right" },
    { title: "Mean abs.", width: 18, align: "right" },
    { title: "RMS", width: 16, align: "right" },
    { title: "Largest", width: 17, align: "right" },
    { title: "Within tolerance", width: CONTENT_W - 133, align: "right" },
  ],
  [
    statRow("Other programs", programStat, `${programChecks.filter((x) => x.pass).length} of ${programChecks.length} checks`),
    statRow("Literature", literatureStat, `${literatureChecks.filter((x) => x.pass).length} of ${literatureChecks.length} checks`),
    ...(femStat.n ? [statRow("Finite elements (section 4)", femStat, `${nFemPass} of ${femCounted.length} references`)] : []),
  ],
  8.5,
);
const largestOf = (ps: Point[]) => {
  const [p] = largest(ps, 1);
  return p ? `${pct2(p.error)} (${p.id}, ${p.analysis})` : "–";
};
paragraph(
  `Against the other programs, ${within(programPoints, 0.5)} of the ${programStat.n} results lie within 0.5 %, ${within(programPoints, 1)} within 1 % and ${within(programPoints, 2)} within 2 %; the largest deviation is ${largestOf(programPoints)}. ` +
    `Against the literature the spread is wider: ${within(literaturePoints, 1)} of ${literatureStat.n} values lie within 1 %, ${within(literaturePoints, 2)} within 2 % and ${within(literaturePoints, 5)} within 5 %, and the largest deviation is ${largestOf(literaturePoints)}. ` +
    "Many literature values are printed to two decimals, some are read from charts, some come from hand calculations or from another method such as finite elements or a trial wedge, and on some problems the sources differ from each other; section 2.4 lists the largest deviations.",
);
y += 1;
paragraph(
  "\"Within tolerance\" counts the checks that the automated tests apply on every change to the program. Each check compares cSlope with one published value, so an analysis with values from three programs gives three checks, while the statistics use the midpoint of their range. " +
    "A check agrees when cSlope is within 1 % of the reference on a given surface and 2 % for a search, plus half a unit of the reference's last printed digit, plus 1 % where the input or the reference was read from a figure, plus 1 % where the surface ends in a vertical or near-vertical scarp; 5 % against a finite element value. " +
    `The finite element references have their own rule (section 4)${nFemDisputed ? `; ${count(nFemDisputed, "disputed reference is", "disputed references are")} shown there and not counted` : ""}. ` +
    `The ${reliabilityRows.length} reliability indices and probabilities of failure of the probabilistic problems are compared with absolute tolerances: ${reliabilityRows.filter((x) => x.pass).length} of ${reliabilityRows.length} agree. ` +
    "Section 3 and appendix A show every difference but do not mark single results as passed or failed.",
);
y += 2;
heading("2.2  Distribution of the deviations", 2, { toc: true, bookmarkUnder: SUMMARY, keep: 115 });
errorHistograms([
  { title: `Against other programs (${programStat.n} results)`, points: programPoints },
  { title: `Against the literature (${literatureStat.n} values)`, points: literaturePoints },
  ...(femStat.n ? [{ title: `Finite elements against their references (${femStat.n})`, points: femPoints }] : []),
]);
caption(`Figure ${++figureNo}. Number of results per 0.25 % of deviation. The dashed line is zero deviation.`);

heading("2.3  By method", 2, { toc: true, bookmarkUnder: SUMMARY });
const FAMILIES: { label: string; test: (analysis: string) => boolean }[] = [
  { label: "Bishop simplified", test: (a) => a.startsWith("Bishop") && !a.includes("non-circular") },
  { label: "Janbu simplified and corrected", test: (a) => a.startsWith("Janbu") && !a.includes("non-circular") },
  { label: "Spencer and Morgenstern-Price", test: (a) => /^(Spencer|Morgenstern)/.test(a) && !a.includes("non-circular") },
  { label: "Non-circular optimization, all methods", test: (a) => a.includes("non-circular") },
];
const familyCells = (ps: Point[]): Cell[] => {
  const s = statOf(ps);
  return s.n ? [String(s.n), abs2(s.meanAbs), abs2(s.maxAbs)] : ["0", "–", "–"];
};
tableCaption(`Table ${++tableNo}. Mean absolute and largest deviation by method, from the other programs and from the literature.`);
table(
  [
    { title: "Method", width: 64 },
    { title: "Programs: n", width: 20, align: "right" },
    { title: "Mean abs.", width: 18, align: "right" },
    { title: "Largest", width: 17, align: "right" },
    { title: "Literature: n", width: 21, align: "right" },
    { title: "Mean abs.", width: 18, align: "right" },
    { title: "Largest", width: CONTENT_W - 158, align: "right" },
  ],
  FAMILIES.map((f) => [f.label, ...familyCells(programPoints.filter((p) => f.test(p.analysis))), ...familyCells(literaturePoints.filter((p) => f.test(p.analysis)))]),
  8.5,
);
paragraph(
  "The first three rows hold circles and the surfaces the sources give; the last holds the searches that optimize a circle into a non-circular surface, whatever the method. Non-circular searches depend on the search more than circular ones, and two programs need not end on the same surface.",
  9,
);

y += 2;
heading("2.4  Largest deviations", 2, { toc: true, bookmarkUnder: SUMMARY });
paragraph(
  "The largest deviations from each reference, with the notes of those problems. The problem id links to its section.",
  9,
);
const deviationTable = (title: string, ps: Point[]) => {
  tableCaption(title);
  table(
    [
      { title: "Problem", width: 24 },
      { title: "Analysis", width: 40 },
      { title: "Reference", width: 18, align: "right" },
      { title: "Source", width: 56 },
      { title: "cSlope", width: 15, align: "right" },
      { title: "Deviation", width: CONTENT_W - 153, align: "right" },
    ],
    ps.map((p) => [{ text: `${p.id} (${sectionOf.get(p.id)})`, link: p.id }, p.analysis, p.reference, p.source, fmt(p.computed), pct2(p.error)]),
    7.8,
  );
};
const topPrograms = largest(programPoints, 5);
const topLiterature = largest(literaturePoints, 5);
const topFem = largest(femPoints, 3);
deviationTable(`Table ${++tableNo}. The five largest deviations from other programs (reference: the midpoint of their range).`, topPrograms);
deviationTable(`Table ${++tableNo}. The five largest deviations from the literature.`, topLiterature);
if (topFem.length) deviationTable(`Table ${++tableNo}. The three largest deviations of the finite element analysis from its references.`, topFem);
{
  const ids = [...new Set([...topPrograms, ...topLiterature, ...topFem].map((p) => p.id))];
  const noted = ids.filter((id) => caseById.get(id)?.publicNote);
  const silent = ids.filter((id) => !caseById.get(id)?.publicNote);
  if (noted.length) {
    font(9, "bold", INK);
    ensure(10);
    pdf.text("Notes of these problems", M, y, { baseline: "top" });
    y += 4.5;
    for (const id of noted) paragraph(`${id}: ${caseById.get(id)!.publicNote}`, 8.5, "normal", INK, CONTENT_W - 4, M + 2);
  }
  if (silent.length) {
    y += 1;
    paragraph(
      `${silent.join(", ")} ${silent.length === 1 ? "has" : "have"} no note: the table of ${silent.length === 1 ? "that problem" : "each problem"} in section 3 gives every published value and the other programs' range for the same analysis.`,
      8.5,
      "italic",
      MUTED,
    );
  }
}

// ── 3 Problems ───────────────────────────────────────────────────────

newPage();
const PROBLEMS = "3  Verification problems";
heading(PROBLEMS, 1, { keep: 60 });
caseResults.forEach((r, i) => {
  if (i > 0) newPage();
  const { c } = r;
  const v = views[i];
  problemPage.set(c.id, currentPage());
  const units = c.units === "SI" ? SI : IMPERIAL;
  const nonCircular = !!r.plane?.points;
  const feOnly = r.results.length === 0 && analysisRows(r).length === 0;
  const surfaceKind = feOnly ? "Finite elements only" : c.surface === "fixed"
    ? nonCircular ? "Specified non-circular surface" : "Fixed circle"
    : nonCircular ? "Circle search with non-circular optimization" : "Critical circle search";
  heading(`3.${i + 1}  ${c.id}: ${c.title}`, 2, { toc: false, keep: 60, bookmarkUnder: PROBLEMS });
  paragraph(c.reference, 8.5, "italic", MUTED);
  y += 1;
  paragraph(
    `${surfaceKind}  ·  Units: ${c.units === "SI" ? "SI (m, kPa, kN/m³)" : "imperial (ft, psf, pcf)"}`,
    8.5,
    "bold",
    INK,
  );
  y += 1;
  paragraph(c.description);
  y += 2;
  const first = analysisRows(r)[0];
  const surfaceName = c.surface === "fixed" ? (nonCircular ? "analyzed surface" : "analyzed circle") : nonCircular ? "critical surface" : "critical circle";
  const fills = materialFills(c.definition.materials);
  figure(
    c.definition,
    r.slope,
    r.plane,
    feOnly || !first
      ? `Figure ${++figureNo}. ${c.id}: geometry and water.`
      : `Figure ${++figureNo}. ${c.id}: ${surfaceName} (${PUBLIC || !r.results[0] ? first.a.label : r.results[0].check.label}, F = ${fmt(PUBLIC || !r.results[0] ? first.fos ?? NaN : r.results[0].fos ?? NaN)}).`,
    units,
  );
  table(
    [
      { title: "Material", width: 34 },
      { title: "Model", width: 36 },
      { title: `γ (${units.weight})`, width: 20, align: "right" },
      { title: `Strength (${units.stress})`, width: CONTENT_W - 34 - 36 - 20 - 18 },
      { title: "φ", width: 18, align: "right" },
    ],
    c.definition.materials.map((m) => {
      const d = describeModel(m.model, units);
      return [
        { text: m.name, swatch: fills.get(m.name) },
        d.kind,
        d.gamma,
        d.strength,
        d.phi,
      ];
    }),
  );
  const cmp = comparisonRows(v);
  if (!v.published.length) {
    paragraph("The sources publish no factor of safety for this problem.", 8.5, "italic", MUTED);
    y += 1;
  }
  table(
    COMPARISON_COLUMNS,
    cmp.rows.map((x) => x.cells),
    8,
    cmp.rows.map((x) => x.start),
  );
  for (const f of cmp.footnotes) paragraph(f, 8, "italic", MUTED);
  if (cmp.footnotes.length) y += 1;
  if (!PUBLIC) {
    // The internal edition adds the checks with their tolerances.
    table(
      [
        { title: "Check", width: 56 },
        { title: "Published by", width: 34 },
        { title: "Published", width: 19, align: "right" },
        { title: "cSlope", width: 17, align: "right" },
        { title: "Difference", width: 19, align: "right" },
        { title: "Tolerance", width: 17, align: "right" },
        { title: "", width: CONTENT_W - 162, align: "center" },
      ],
      r.results.map((x) => [
        x.check.label,
        x.check.publishedBy,
        fmt(x.check.published),
        fmt(x.fos ?? NaN),
        pct(x.diff),
        `± ${(x.check.tolerance * 100).toFixed(1)} %`,
        statusCell(x.pass, x.check.pending),
      ]),
    );
  }
  if (PUBLIC && c.publicNote) paragraph(c.publicNote, 8.5, "italic", MUTED);
  for (const { rc, results } of reliabilityResults.get(c.id) ?? []) {
    const reliability = results.filter((x) => x.quantity !== "fos");
    if (!reliability.length) continue;
    y += 1;
    paragraph(
      `Probabilistic analysis on the same surface: ${rc.variables.length} normal variables (${rc.correlations?.length ? rc.correlations.map((k) => `ρ = ${k.rho}`).join(", ") + " between pairs" : "independent"}); Taylor series (mean ± σ) and Monte Carlo with ${rc.samples} samples (seed ${rc.seed}).${PUBLIC ? "" : " Differences in β and Pf are absolute."}`,
      8.5,
    );
    if (PUBLIC) {
      table(
        [
          { title: "Quantity", width: 50 },
          { title: "Published", width: 54 },
          { title: "Other programs", width: 36, align: "right" },
          { title: "cSlope", width: CONTENT_W - 140, align: "right" },
        ],
        reliabilityPresentation(results).map((x) => [
          RELIABILITY_LABELS[x.quantity],
          x.published.map((p) => `${p.published.toFixed(3)} ${p.publishedBy}`).join("; ") || "–",
          x.programs ? formatRange(x.programs) : "–",
          x.computed.toFixed(3),
        ]),
      );
    } else {
      table(
        [
          { title: "Quantity", width: 56 },
          { title: "Published by", width: 34 },
          { title: "Published", width: 19, align: "right" },
          { title: "cSlope", width: 17, align: "right" },
          { title: "Difference", width: 19, align: "right" },
          { title: "Tolerance", width: 17, align: "right" },
          { title: "", width: CONTENT_W - 162, align: "center" },
        ],
        reliability.map((x) => [
          RELIABILITY_LABELS[x.quantity],
          x.publishedBy,
          x.published.toFixed(3),
          x.computed.toFixed(3),
          (x.computed - x.published >= 0 ? "+" : "") + (x.computed - x.published).toFixed(3),
          `± ${x.tolerance.toFixed(3)}`,
          statusCell(x.pass),
        ]),
      );
    }
  }
  const notes = [
    ...(c.notes ?? []),
    ...r.results.flatMap((x) => (x.check.note ? [x.check.note] : [])),
    ...r.results.flatMap((x) =>
      x.check.pending ? [`${x.check.label} (${x.check.publishedBy}) is pending: it waits for the engine change "${x.check.pending}".`] : [],
    ),
  ];
  // The public edition leaves the internal notes out: they name the other programs.
  if (!PUBLIC && notes.length > 0) {
    font(9, "bold", INK);
    ensure(6);
    pdf.text("Notes", M, y, { baseline: "top" });
    y += 4.5;
    for (const n of notes) paragraph(`•  ${n}`, 8.5, "normal", INK, CONTENT_W - 4, M + 2);
  }
});

// ── 4 Finite elements ────────────────────────────────────────────────
// The results of the website's table (generate-data.ts runs them; they take
// minutes), against the published finite element, finite difference, limit
// analysis and theory values.

const FEM_CASES = CASES.filter((c) => c.fem);
if (FEM_CASES.length && committed) {
  newPage();
  heading("4  Strength reduction by finite elements", 1);
  paragraph(
    "cSlope's finite element analysis reduces c and tan φ by a factor F until the elastic, perfectly plastic slope can no longer be brought into equilibrium. " +
      "The mesh is of six-node triangles. It is refined adaptively, at most twice, where the plastic dissipation at failure is largest, until F changes by less than 0.01. " +
      "Each problem is run with its source's flow rule (Davis B, associated, or non-associated with ψ = 0); the source's elastic parameters do not change F appreciably. " +
      "The finite element factor is compared with the source's finite element, finite difference, limit analysis or theoretical value. It agrees within 2 % of a theoretical value or of a pair of bounds, and within 5 % of a published numerical value, which depends on the mesh, the elements and the failure criterion. " +
      `${nFemPass} of the ${femCounted.length} references agree${nFemDisputed ? `; the disputed ${nFemDisputed === 1 ? "one is" : "ones are"} not counted` : ""}.`,
    9,
  );
  y += 2;
  const rows: Cell[][] = [];
  const starts: boolean[] = [];
  const disputed: string[] = [];
  for (const c of FEM_CASES) {
    const v = views.find((x) => x.id === c.id)!;
    const fos = v.results.find((r) => r.method === FEM_LABEL)?.computed ?? null;
    const levels = v.fem?.levels ?? [];
    c.fem!.references.forEach((ref, j) => {
      const pass = fos != null && femAgrees(ref, fos);
      if (ref.disputed) disputed.push(`${c.id}: ${ref.disputed}`);
      // As the source prints it, with at least two decimals (as in section 3).
      const refText = formatPaperValue({ value: ref.value, ...(ref.upper != null ? { upper: ref.upper } : {}), source: ref.source });
      const dev = fos == null ? null : femDeviation(ref, fos) * 100;
      const row: Cell[] = [
        j === 0 ? { text: c.id, link: c.id } : "",
        `${ref.method}, ${PUBLIC ? femSource(ref) : ref.source}${ref.disputed ? " (disputed: see below)" : ""}`,
        refText,
        j === 0 ? (v.fem?.flowRule ?? c.fem!.flowRule ?? "davis-b").replace("davis-b", "Davis B") : "",
        j === 0 ? levels.map((l) => `${l.elements}: ${fmt(l.fos)}`).join(", ") : "",
        j === 0 ? fmt(fos ?? NaN) : "",
        dev == null ? "–" : ref.kind === "bounds" && dev === 0 ? "in bounds" : pct2(dev),
      ];
      if (!PUBLIC) row.push(ref.disputed ? { text: "Disputed", color: PENDING, bold: true } : statusCell(pass));
      rows.push(row);
      starts.push(j === 0);
    });
  }
  tableCaption(`Table ${tableNo + 1}. Finite element factors of safety against the published values; the mesh refinement as number of elements: F.`);
  table(
    PUBLIC
      ? [
          { title: "Problem", width: 15 },
          { title: "Published by", width: 57 },
          { title: "Published", width: 17, align: "right" },
          { title: "Flow rule", width: 23 },
          { title: "Elements: F", width: 33 },
          { title: "cSlope", width: 13, align: "right" },
          { title: "Diff.", width: CONTENT_W - 158, align: "right" },
        ]
      : [
          { title: "Problem", width: 14 },
          { title: "Published by", width: 48 },
          { title: "Published", width: 16, align: "right" },
          { title: "Flow rule", width: 23 },
          { title: "Elements: F", width: 28 },
          { title: "cSlope", width: 12, align: "right" },
          { title: "Diff.", width: 14, align: "right" },
          { title: "", width: CONTENT_W - 155, align: "center" },
        ],
    rows,
    7.2,
    starts,
  );
  for (const d of disputed) {
    y += 1;
    paragraph(d, 8, "italic", MUTED);
  }
  console.log(`${nFemPass}/${femCounted.length} finite element references within tolerance${nFemDisputed ? `, ${nFemDisputed} disputed and not counted` : ""}.`);
}

// ── Appendix A: every result ─────────────────────────────────────────

newPage();
heading("Appendix A  Results of all problems", 1);
paragraph(
  "One row per cSlope analysis of every problem, with the same columns as the tables of section 3 and the page of the problem. The problem id links to its section.",
  9,
);
y += 1;
{
  const rows: Cell[][] = [];
  const starts: boolean[] = [];
  views.forEach((v) => {
    const cmp = comparisonRows(v);
    cmp.rows.forEach((x) => {
      const head: Cell = x.problemStart ? { text: v.id, link: v.id } : "";
      rows.push([head, ...x.cells, x.problemStart ? String(problemPage.get(v.id) ?? "") : ""]);
      // A problem's rows stay together on a page where they fit.
      starts.push(x.problemStart);
    });
  });
  table(
    [
      { title: "Problem", width: 14 },
      { title: "Analysis", width: 35 },
      { title: "cSlope", width: 12, align: "right" },
      { title: "Published", width: 14, align: "right" },
      { title: "Source", width: 41 },
      { title: "Diff.", width: 14, align: "right" },
      { title: "Other programs", width: 21, align: "right" },
      { title: "Diff.", width: 13, align: "right" },
      { title: "Page", width: CONTENT_W - 164, align: "right" },
    ],
    rows,
    6.8,
    starts,
  );
}
if (reliabilityResults.size) {
  heading("Probabilistic problems", 2, { toc: false, keep: 30 });
  table(
    [
      { title: "Problem", width: 16 },
      { title: "Quantity", width: 50 },
      { title: "Published", width: 56 },
      { title: "Other programs", width: 28, align: "right" },
      { title: "cSlope", width: CONTENT_W - 150, align: "right" },
    ],
    [...reliabilityResults.values()].flat().flatMap(({ rc: c, results }) =>
      reliabilityPresentation(results).map((x): Cell[] => [
        { text: c.id, link: c.id },
        RELIABILITY_LABELS[x.quantity],
        x.published.map((v) => `${v.published.toFixed(3)} ${v.publishedBy}`).join("; ") || "–",
        x.programs ? formatRange(x.programs) : "–",
        x.computed.toFixed(3),
      ]),
    ),
    7.2,
  );
}

// The internal edition lists every check with its tolerance and status.
if (!PUBLIC) {
  newPage();
  heading("Appendix B  Checks", 1);
  table(
    [
      { title: "Problem", width: 18 },
      { title: "Description", width: 54 },
      { title: "Check", width: 40 },
      { title: "Published", width: 18, align: "right" },
      { title: "cSlope", width: 15, align: "right" },
      { title: "Diff.", width: 15, align: "right" },
      { title: "", width: CONTENT_W - 160, align: "center" },
    ],
    [
      ...caseResults.flatMap((r) =>
        r.results.map((x): Cell[] => [r.c.id, r.c.title, x.check.label, fmt(x.check.published), fmt(x.fos ?? NaN), pct(x.diff), statusCell(x.pass, x.check.pending)]),
      ),
      ...[...reliabilityResults.values()].flat().flatMap(({ rc: c, results }) =>
        results
          .filter((x) => x.quantity !== "fos")
          .map((x): Cell[] => [
            c.id,
            c.title,
            RELIABILITY_LABELS[x.quantity],
            x.published.toFixed(3),
            x.computed.toFixed(3),
            (x.computed - x.published >= 0 ? "+" : "") + (x.computed - x.published).toFixed(3),
            statusCell(x.pass),
          ]),
      ),
    ],
    7.6,
  );
}

// ── Links, contents, header and footer ───────────────────────────────

for (const l of pendingLinks) {
  const page = problemPage.get(l.id);
  if (page == null) continue;
  pdf.setPage(l.page);
  pdf.link(l.x, l.y, l.w, l.h, { pageNumber: page });
}

pdf.setPage(CONTENTS_PAGE);
y = TOP;
font(15, "bold", ACCENT);
pdf.text("Contents", M, y, { baseline: "top" });
y += lineH(15) + 1.5;
pdf.setDrawColor(...ACCENT);
pdf.setLineWidth(0.4);
pdf.line(M, y, PAGE_W - M, y);
y += 5;
for (const e of contents) {
  const indent = e.level === 1 ? 0 : 8;
  font(e.level === 1 ? 10.5 : 9.5, e.level === 1 ? "bold" : "normal", INK);
  if (e.level === 1) y += 2;
  const pageText = String(e.page);
  const textW = pdf.getTextWidth(e.text);
  const pageW = pdf.getTextWidth(pageText);
  pdf.text(e.text, M + indent, y, { baseline: "top" });
  pdf.text(pageText, PAGE_W - M, y, { baseline: "top", align: "right" });
  // Dotted leader between the title and the page number.
  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.2);
  pdf.setLineDashPattern([0.3, 1.2], 0);
  pdf.line(M + indent + textW + 2, y + 3, PAGE_W - M - pageW - 2, y + 3);
  pdf.setLineDashPattern([], 0);
  pdf.link(M + indent, y - 0.5, CONTENT_W - indent, 5, { pageNumber: e.page });
  y += 6;
}
y += 4;
paragraph(
  `Section 3 has one page per problem, in the order of their ids; appendix A lists them all with their page numbers.`,
  9,
  "italic",
  MUTED,
);

// Header and footer on every page but the cover.
const pages = pdf.getNumberOfPages();
for (let p = 2; p <= pages; p++) {
  pdf.setPage(p);
  font(7.5, "normal", MUTED);
  pdf.text("cSlope verification manual", M, 12);
  pdf.text(`cSlope ${pkg.version ?? ""} · ${today} · commit ${commit}`, PAGE_W - M, 12, { align: "right" });
  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.2);
  pdf.line(M, 14, PAGE_W - M, 14);
  pdf.text(`Page ${p} of ${pages}`, PAGE_W / 2, PAGE_H - 10, { align: "center" });
}

if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(pdf.output("arraybuffer")));
console.log(`\n${nPass}/${nChecks} checks within tolerance (not shown per result in the public edition). Wrote ${path.relative(process.cwd(), OUT)} (${pages} pages).`);
if (nPass < nChecks) process.exitCode = 1;
