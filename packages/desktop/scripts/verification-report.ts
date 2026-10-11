/**
 * cSlope verification report.
 *
 * Runs every published verification problem (packages/engine/src/
 * verification/cases.ts) and the benchmark models bundled with the app
 * through the engine and writes a PDF in the style of the Slide2 / SLOPE/W
 * verification manuals: summary table, then one section per problem with
 * a figure (geometry, materials, water, loads, critical surface), the
 * material table and published vs computed factors of safety.
 *
 *   bun run verification-report            (from packages/desktop)
 *   bun scripts/verification-report.ts [output.pdf]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { jsPDF } from "jspdf";
import {
  RELIABILITY_CASES,
  VERIFICATION_CASES,
  VERIFICATION_OPTIONS,
  runReliabilityCase,
  analyseSlope,
  buildSlope,
  isPointInPolygon,
  polygonizeRegions,
  runVerification,
  toCanonicalSlopeDefinition,
  type AnalysisMethod,
  type AnalysisOptions,
  type MaterialModel,
  type ReliabilityCheckResult,
  type SlopeDefinition,
  type VerificationCase,
  type VerificationCheck,
} from "@cslope/engine";
import type { Slope } from "@cslope/engine";
import { BENCHMARK_MODELS, PUBLISHED_BENCHMARKS } from "../src/store/benchmarks";
import { buildSlopeDTOFromModel } from "../src/store/helpers";

type Pt = [number, number];

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../../..");
const OUT =
  process.argv[2] ??
  path.join(REPO, "docs", "verification", "cSlope-verification-report.pdf");

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
const PASS: [number, number, number] = [25, 135, 84];
const FAIL: [number, number, number] = [200, 35, 51];
const HEAD_BG: [number, number, number] = [233, 238, 243];
const WATER: [number, number, number] = [30, 110, 220];
const LOAD: [number, number, number] = [180, 40, 40];
const SURFACE: [number, number, number] = [200, 30, 30];

const MATERIAL_FILLS: [number, number, number][] = [
  [244, 223, 177],
  [190, 214, 160],
  [176, 205, 232],
  [222, 196, 226],
  [240, 190, 170],
  [205, 205, 190],
  [170, 220, 210],
];

const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
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
  const lines = pdf.splitTextToSize(text, width) as string[];
  for (const l of lines) {
    ensure(lineH(size) + 1);
    pdf.text(l, x, y, { baseline: "top" });
    y += lineH(size) + 0.6;
  }
}

function heading(text: string, level: 1 | 2) {
  const size = level === 1 ? 15 : 12;
  ensure(level === 1 ? 14 : 10);
  if (level === 1) y += 2;
  font(size, "bold", ACCENT);
  pdf.text(text, M, y, { baseline: "top" });
  y += lineH(size) + 1.5;
  if (level === 1) {
    pdf.setDrawColor(...ACCENT);
    pdf.setLineWidth(0.4);
    pdf.line(M, y, PAGE_W - M, y);
    y += 3;
  }
}

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
  swatch?: RGB;
}
type Cell = string | (CellMeta & { text: string });

function table(columns: Column[], rows: Cell[][], size = 8.5) {
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
  ensure(rowH * 2);
  if (hasHeader) drawHeader();
  for (const row of rows) {
    // Wrap the cells, row height = tallest cell.
    font(size);
    const cells = row.map((cell, i) => {
      const text = typeof cell === "string" ? cell : cell.text;
      return pdf.splitTextToSize(text, columns[i].width - 3) as string[];
    });
    const h = Math.max(...cells.map((c) => c.length)) * (lineH(size) + 0.5) + 2.1;
    if (y + h > BOTTOM) {
      newPage();
      if (hasHeader) drawHeader();
    }
    let x = M;
    row.forEach((cell, i) => {
      const c = columns[i];
      const meta: CellMeta = typeof cell === "string" ? {} : cell;
      font(size, meta.bold ? "bold" : "normal", meta.color ?? INK);
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
    pdf.setDrawColor(...RULE);
    pdf.setLineWidth(0.15);
    pdf.line(M, y, PAGE_W - M, y);
  }
  y += 3;
}

// ── Numbers and units ────────────────────────────────────────────────

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "–");
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} %`;
const methodName = (m: AnalysisMethod) =>
  m === "Morgenstern-Price" ? "Morgenstern-Price" : m === "Janbu" ? "Janbu simplified" : "Bishop simplified";

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
      let c = `c' = ${g(model.cohesion)}`;
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
  return { cx: best.cx, cy: best.cy, radius: best.radius, lc: best.lc as Pt, rc: best.rc as Pt, fos: best.fos!, points: best.points as Pt[] | undefined };
}

function niceStep(range: number, target = 6): number {
  const raw = range / target;
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

  // World bounds: model plus the arc and (when not far away) the centre.
  const ys0 = canon.coordinates.map((c) => c[1]);
  let x0 = xMinM;
  let x1 = xMaxM;
  let y0 = Math.min(...ys0);
  let y1 = Math.max(...ys0);
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

  ensure(height + 14);
  y += 6; // room for the axis label above the plot
  const fx = M + 12;
  const fy = y;
  const fw = CONTENT_W - 14;
  const fh = height;
  const s = Math.min(fw / (x1 - x0), fh / (y1 - y0));
  const ox = fx + (fw - (x1 - x0) * s) / 2;
  const oy = fy + (fh - (y1 - y0) * s) / 2;
  const P = (x: number, yy: number): Pt => [ox + (mx(x) - x0) * s, oy + (y1 - yy) * s];

  // Material regions.
  const faces = polygonizeRegions(
    canon.coordinates.map((c) => c[0]),
    canon.coordinates.map((c) => c[1]),
    (canon.materialBoundaries ?? []).map((b) => b.coordinates),
  );
  const matIndex = (name: string) => Math.max(0, canon.materials.findIndex((m) => m.name === name));
  for (const face of faces) {
    const fxs = face.outer.map((c) => c[0]);
    const fys = face.outer.map((c) => c[1]);
    const inFace = (p: Pt) =>
      isPointInPolygon(p[0], p[1], fxs, fys) &&
      !face.holes.some((h) => isPointInPolygon(p[0], p[1], h.map((c) => c[0]), h.map((c) => c[1])));
    const hit = (canon.regionAssignments ?? []).find((a) => inFace(a.point as Pt));
    const idx = hit ? matIndex(hit.materialName) : 0;
    pdf.setFillColor(...MATERIAL_FILLS[idx % MATERIAL_FILLS.length]);
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

  // Water lines (continued horizontally to the model edges, as analysed).
  const waterLines: Pt[][] = [];
  if (canon.waterTable && canon.waterTable.mode === "custom" && Array.isArray(canon.waterTable.value)) {
    waterLines.push(canon.waterTable.value as Pt[]);
  }
  for (const wt of canon.waterTables ?? []) waterLines.push(wt.coordinates as Pt[]);
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
    // Centre and radii only for circles.
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
  const ax0 = ox;
  const ay0 = oy + (y1 - y0) * s;
  pdf.line(ax0, ay0, ox + (x1 - x0) * s, ay0);
  pdf.line(ax0, ay0, ax0, oy);
  font(6.5, "normal", MUTED);
  const sx = niceStep(x1 - x0);
  for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + 1e-9; v += sx) {
    const px = ox + (v - x0) * s;
    pdf.line(px, ay0, px, ay0 + 1);
    pdf.text(String(+v.toFixed(2)), px, ay0 + 1.5, { align: "center", baseline: "top" });
  }
  const sy = niceStep(y1 - y0, 4);
  for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + 1e-9; v += sy) {
    const py = oy + (y1 - v) * s;
    pdf.line(ax0 - 1, py, ax0, py);
    pdf.text(String(+v.toFixed(2)), ax0 - 1.5, py, { align: "right", baseline: "middle" });
  }
  pdf.text(`x (${units.length})`, ox + (x1 - x0) * s, ay0 + 5, { align: "right", baseline: "top" });
  pdf.text(`y (${units.length})`, ax0 - 1, oy - 1.5, { align: "center", baseline: "bottom" });

  y = Math.max(fy + fh, ay0 + 6) + 3;
  font(8, "italic", MUTED);
  pdf.text(label, PAGE_W / 2, y, { align: "center", baseline: "top" });
  y += 6;
  return matIndex;
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
  slope: Slope;
  plane: Plane | null;
}

function evaluate(c: VerificationCase): CaseResult {
  let firstSlope: Slope | null = null;
  const results = c.checks.map((check) => {
    const { fos, slope } = runVerification(c.definition, check.method, check.options);
    firstSlope ??= slope;
    const diff = fos == null ? NaN : ((fos - check.published) / check.published) * 100;
    return { check, fos, diff, pass: fos != null && Math.abs(diff) <= check.tolerance * 100 + 1e-9 };
  });
  return { c, results, slope: firstSlope!, plane: criticalPlane(firstSlope!) };
}

console.log(`Running ${VERIFICATION_CASES.length} verification problems…`);
const caseResults = VERIFICATION_CASES.map((c) => {
  const r = evaluate(c);
  console.log(`  ${c.id.padEnd(8)} ${r.results.map((x) => `${fmt(x.fos ?? NaN)} (${pct(x.diff)})`).join("  ")}`);
  return r;
});

// Probabilistic problems: reliability index and probability of failure.
console.log(`Running ${RELIABILITY_CASES.length} probabilistic problems…`);
const reliabilityResults = new Map<string, ReliabilityCheckResult[]>();
for (const c of RELIABILITY_CASES) {
  const r = runReliabilityCase(c);
  reliabilityResults.set(c.id, r);
  console.log(`  ${c.id.padEnd(8)} ${r.map((x) => `${x.quantity} ${fmt(x.computed)}`).join("  ")}`);
}
const RELIABILITY_LABELS: Record<ReliabilityCheckResult["quantity"], string> = {
  fos: "FOS",
  "beta-taylor": "β lognormal (Taylor series)",
  "pf-taylor": "Pf lognormal (Taylor series)",
  "beta-mc": "β lognormal (Monte Carlo)",
  "pf-mc": "Pf, share FOS < 1 (Monte Carlo)",
};

// Bundled benchmark models of the app, through the app's request builder.
interface BenchResult {
  name: string;
  def: SlopeDefinition;
  rows: { method: AnalysisMethod; published: number; fos: number | null; diff: number; tol: number; pass: boolean }[];
  slope: Slope;
  plane: Plane | null;
}
const benchResults: BenchResult[] = [];
for (const model of BENCHMARK_MODELS) {
  const published = PUBLISHED_BENCHMARKS.filter((b) => b.modelId === model.id);
  if (published.length === 0) continue;
  const def = buildSlopeDTOFromModel(model) as SlopeDefinition;
  let firstSlope: Slope | null = null;
  const rows = published.map((b) => {
    const slope = buildSlope(def);
    slope.updateAnalysisOptions({ ...(model.options as Partial<AnalysisOptions>), method: b.method as AnalysisMethod });
    const fos = analyseSlope(slope);
    firstSlope ??= slope;
    const diff = fos == null ? NaN : ((fos - b.publishedFos) / b.publishedFos) * 100;
    return { method: b.method as AnalysisMethod, published: b.publishedFos, fos, diff, tol: b.tolerance, pass: fos != null && Math.abs(fos - b.publishedFos) <= b.tolerance + 1e-9 };
  });
  benchResults.push({ name: model.name, def, rows, slope: firstSlope!, plane: criticalPlane(firstSlope!) });
  console.log(`  ${model.name}: ${rows.map((r) => fmt(r.fos ?? NaN)).join(", ")}`);
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
const benchRows = benchResults.flatMap((b) => b.rows);
const reliabilityRows = [...reliabilityResults.values()].flat().filter((r) => r.quantity !== "fos");
const nChecks = allChecks.length + benchRows.length + reliabilityRows.length;
const nPass = allChecks.filter((r) => r.pass).length + benchRows.filter((r) => r.pass).length + reliabilityRows.filter((r) => r.pass).length;
const absDiffs = [...allChecks, ...benchRows].map((r) => Math.abs(r.diff)).filter(Number.isFinite);
const meanAbs = absDiffs.reduce((a, b) => a + b, 0) / absDiffs.length;
const maxAbs = Math.max(...absDiffs);

// Cover.
pdf.setFillColor(...ACCENT);
pdf.rect(0, 0, PAGE_W, 92, "F");
font(34, "bold", [255, 255, 255]);
pdf.text("cSlope", M, 42);
font(20, "normal", [255, 255, 255]);
pdf.text("Verification Manual", M, 56);
font(11, "normal", [220, 232, 242]);
pdf.text("Limit equilibrium slope stability analysis — comparison with published results", M, 68);
y = 112;
paragraph(
  `This document compares factors of safety computed by cSlope with values published for ${VERIFICATION_CASES.length} verification problems from the literature and the Slide2 and SLOPE/W verification sets, and with the ${benchResults.length} benchmark models bundled with the program.`,
  11,
);
y += 4;
table(
  [
    { title: "", width: 60 },
    { title: "", width: CONTENT_W - 60 },
  ],
  [
    ["Program version", `cSlope ${pkg.version ?? ""} (commit ${commit})`],
    ["Report generated", today],
    ["Published values compared", String(nChecks)],
    ["Within acceptance tolerance", `${nPass} of ${nChecks}`],
    ["Mean |difference|", `${meanAbs.toFixed(2)} %`],
    ["Max |difference|", `${maxAbs.toFixed(2)} %`],
  ],
  10,
);
font(8, "italic", MUTED);
pdf.text("Generated automatically by packages/desktop/scripts/verification-report.ts from the engine's verification test cases.", M, BOTTOM - 4);

// Introduction.
newPage();
heading("1  Introduction", 1);
paragraph(
  "Each problem below is defined once in the engine's verification data (packages/engine/src/verification/cases.ts). The same definitions are run by the automated test suite on every change, so the values in this report are the values the program computes.",
);
y += 2;
heading("Analysis settings", 2);
table(
  [
    { title: "Setting", width: 62 },
    { title: "Value", width: CONTENT_W - 62 },
  ],
  [
    ["Slip surfaces", "Circular. Fixed circles where the source gives one, otherwise a critical-circle search."],
    ["Number of slices", String(VERIFICATION_OPTIONS.slices)],
    ["Search", `${VERIFICATION_OPTIONS.iterations} entry/exit combinations plus ${VERIFICATION_OPTIONS.refinedIterations} refined around the best surfaces`],
    ["Convergence tolerance", "0.005 on the factor of safety (default)"],
    ["Methods", "Bishop simplified, Janbu simplified (uncorrected unless stated), Morgenstern-Price with half-sine interslice function; Spencer = Morgenstern-Price with a constant interslice function"],
    ["Pore pressure", "Piezometric line; head = vertical distance below the line (default, as Slide2 and SLOPE/W). Checks marked \"phreatic correction\" use vertical distance × cos²θ."],
    ["Unit weight of water", "9.81 kN/m³"],
  ],
);
heading("Acceptance", 2);
paragraph(
  "A result passes when its relative difference from the published value is within the tolerance stated for the problem (0.5–2.5 %). Tighter tolerances are used for fixed circles, wider ones for searches, whose result depends on the search grid of each program.",
);
y += 2;
heading("Units", 2);
paragraph(
  "Problems published in imperial units without water are entered in their own units (ft, psf, pcf); the factor of safety is dimensionless. Problems with water are converted to SI because the program uses γw = 9.81 kN/m³ (62.4 pcf = 9.80 kN/m³, < 0.1 % difference).",
);
y += 2;
heading("Source of the input data", 2);
paragraph(
  "The input data were transcribed via the open-source xslope project (github.com/njones61/xslope, docs/verification), which reproduces the problem definitions of the Slide2 and SLOPE/W verification manuals. The manuals themselves could not be consulted when this report was prepared. Each problem should be checked against the original publication before the report is relied on.",
  9.5,
  "normal",
);

// Summary.
newPage();
heading("2  Summary of results", 1);
const statusCell = (pass: boolean) => ({ text: pass ? "Pass" : "Fail", color: pass ? PASS : FAIL, bold: true });
table(
  [
    { title: "Problem", width: 18 },
    { title: "Description", width: 54 },
    { title: "Method", width: 40 },
    { title: "Published", width: 18, align: "right" },
    { title: "cSlope", width: 15, align: "right" },
    { title: "Diff.", width: 15, align: "right" },
    { title: "", width: CONTENT_W - 160, align: "center" },
  ],
  [
    ...caseResults.flatMap((r) =>
      r.results.map((x) => [
        r.c.id,
        r.c.title,
        x.check.label,
        fmt(x.check.published),
        fmt(x.fos ?? NaN),
        pct(x.diff),
        statusCell(x.pass),
      ]),
    ),
    ...benchResults.flatMap((b) =>
      b.rows.map((x) => [
        "Bundled",
        b.name,
        methodName(x.method),
        fmt(x.published),
        fmt(x.fos ?? NaN),
        pct(x.diff),
        statusCell(x.pass),
      ]),
    ),
    // Reliability (β, Pf): absolute differences.
    ...RELIABILITY_CASES.flatMap((c) =>
      (reliabilityResults.get(c.id) ?? [])
        .filter((x) => x.quantity !== "fos")
        .map((x) => [
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

// Problems.
newPage();
heading("3  Verification problems", 1);
caseResults.forEach((r, i) => {
  if (i > 0) newPage();
  const { c } = r;
  const units = c.units === "SI" ? SI : IMPERIAL;
  const nonCircular = !!r.plane?.points;
  const surfaceKind = c.surface === "fixed"
    ? nonCircular ? "Specified non-circular surface" : "Fixed circle"
    : nonCircular ? "Circle search with non-circular optimisation" : "Critical circle search";
  heading(`3.${i + 1}  ${c.id} — ${c.title}`, 2);
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
  const first = r.results[0];
  const matIndex = figure(
    c.definition,
    r.slope,
    r.plane,
    `Figure ${i + 1}. ${c.id}: ${c.surface === "fixed" ? (nonCircular ? "analysed surface" : "analysed circle") : (nonCircular ? "critical surface" : "critical circle")} (${first.check.label}, FOS = ${fmt(first.fos ?? NaN)}).`,
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
        { text: m.name, swatch: MATERIAL_FILLS[matIndex(m.name) % MATERIAL_FILLS.length] },
        d.kind,
        d.gamma,
        d.strength,
        d.phi,
      ];
    }),
  );
  table(
    [
      { title: "Method", width: 56 },
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
      statusCell(x.pass),
    ]),
  );
  const reliability = reliabilityResults.get(c.id)?.filter((x) => x.quantity !== "fos");
  if (reliability?.length) {
    const rc = RELIABILITY_CASES.find((x) => x.id === c.id)!;
    paragraph(
      `Probabilistic analysis on the same surface: ${rc.variables.length} independent normal variables; Taylor series (mean ± σ) and Monte Carlo with ${rc.samples} samples (seed ${rc.seed}). Differences in β and Pf are absolute.`,
      8.5,
    );
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
  const notes = [...(c.notes ?? []), ...r.results.flatMap((x) => (x.check.note ? [x.check.note] : []))];
  if (notes.length > 0) {
    font(9, "bold", INK);
    ensure(6);
    pdf.text("Notes", M, y, { baseline: "top" });
    y += 4.5;
    for (const n of notes) paragraph(`•  ${n}`, 8.5, "normal", INK, CONTENT_W - 4, M + 2);
  }
});

// Bundled benchmarks.
newPage();
heading("4  Benchmark models bundled with cSlope", 1);
paragraph(
  "These models are shipped with the program (Help → Benchmarks). They are run through the same request builder as the user interface, with the analysis options saved in each model.",
);
benchResults.forEach((b, i) => {
  if (i > 0) newPage();
  else y += 3;
  heading(`4.${i + 1}  ${b.name}`, 2);
  const opts = BENCHMARK_MODELS.find((m) => m.name === b.name)?.options;
  paragraph(
    `Bundled model "${b.name}"  ·  Units: SI (m, kPa, kN/m³)  ·  ${b.def.customPlanesOnly ? "Fixed circle" : "Critical circle search"}${opts ? `  ·  ${opts.slices} slices, ${opts.iterations} + ${opts.refinedIterations} search iterations` : ""}`,
    8.5,
    "bold",
  );
  y += 1;
  const benchIndex = figure(
    b.def,
    b.slope,
    b.plane,
    `Figure ${caseResults.length + i + 1}. ${b.name}: critical circle (${methodName(b.rows[0].method)}, FOS = ${fmt(b.rows[0].fos ?? NaN)}).`,
    SI,
    80,
    true,
  );
  table(
    [
      { title: "Material", width: 34 },
      { title: "Model", width: 36 },
      { title: "γ (kN/m³)", width: 20, align: "right" },
      { title: "Strength (kPa)", width: CONTENT_W - 34 - 36 - 20 - 18 },
      { title: "φ", width: 18, align: "right" },
    ],
    b.def.materials.map((m) => {
      const d = describeModel(m.model, SI);
      return [
        { text: m.name, swatch: MATERIAL_FILLS[benchIndex(m.name) % MATERIAL_FILLS.length] },
        d.kind,
        d.gamma,
        d.strength,
        d.phi,
      ];
    }),
  );
  table(
    [
      { title: "Method", width: 56 },
      { title: "Published", width: 24, align: "right" },
      { title: "cSlope", width: 22, align: "right" },
      { title: "Difference", width: 24, align: "right" },
      { title: "Tolerance", width: 26, align: "right" },
      { title: "", width: CONTENT_W - 152, align: "center" },
    ],
    b.rows.map((x) => [
      methodName(x.method),
      fmt(x.published),
      fmt(x.fos ?? NaN),
      pct(x.diff),
      `± ${x.tol.toFixed(3)}`,
      statusCell(x.pass),
    ]),
  );
});

// Header and footer on every page but the cover.
const pages = pdf.getNumberOfPages();
for (let p = 2; p <= pages; p++) {
  pdf.setPage(p);
  font(7.5, "normal", MUTED);
  pdf.text("cSlope — Verification Manual", M, 12);
  pdf.text(`${today} · commit ${commit}`, PAGE_W - M, 12, { align: "right" });
  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.2);
  pdf.line(M, 14, PAGE_W - M, 14);
  pdf.text(`Page ${p} of ${pages}`, PAGE_W / 2, PAGE_H - 10, { align: "center" });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(pdf.output("arraybuffer")));
console.log(`\n${nPass}/${nChecks} within tolerance. Wrote ${path.relative(process.cwd(), OUT)} (${pages} pages).`);
if (nPass < nChecks) process.exitCode = 1;
