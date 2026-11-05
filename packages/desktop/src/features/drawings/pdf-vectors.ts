/**
 * The vector paths of a PDF page, for snapping and picking lines (the
 * page itself is still shown as an image): the operator list pdf.js
 * parses (in its worker) walked here with the current transformation
 * matrix: save/restore, transform, form XObjects, and each path that is
 * stroked or filled (curves flattened); clipping paths are left out. The
 * result is in the page's points as the page is shown (top left origin,
 * y down, its rotation applied: pdf.js's viewport transform at scale 1).
 * A scanned page has no paths, and so no line work.
 */
import type { Pt } from "./transform";
import { extentOf, type VectorDrawing, type VectorPath, type VectorText } from "./vectors";

/** The operator numbers this reads (pdf.js's OPS). */
export interface PdfOps {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
}

/** pdf.js's path drawing operators (DrawOPS) in a constructPath's data. */
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

type M = [number, number, number, number, number, number];
const mul = (o: M, n: M): M => [
  o[0] * n[0] + o[2] * n[1],
  o[1] * n[0] + o[3] * n[1],
  o[0] * n[2] + o[2] * n[3],
  o[1] * n[2] + o[3] * n[3],
  o[0] * n[4] + o[2] * n[5] + o[4],
  o[1] * n[4] + o[3] * n[5] + o[5],
];
const ap = (m: M, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** At most this many points per page. */
const MAX_POINTS = 2_000_000;

/**
 * The paths of an operator list (`fnArray`, `argsArray`) under `base`
 * (the viewport transform: PDF user space → page points shown).
 */
export function pathsFromOperatorList(
  list: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> },
  ops: PdfOps,
  base: M,
): VectorPath[] {
  const painted = new Set([ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const stack: M[] = [];
  let ctm: M = base;
  const out: VectorPath[] = [];
  let budget = MAX_POINTS;
  const emit = (pts: number[], closed: boolean) => {
    if (pts.length < 4 || budget <= 0) return;
    budget -= pts.length / 2;
    out.push({ layer: 0, pts: Float64Array.from(pts), closed });
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[] | null;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? base;
    else if (fn === ops.transform && args) ctm = mul(ctm, args as unknown as M);
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = args?.[0] as M | null | undefined;
      if (matrix && matrix.length === 6) ctm = mul(ctm, Array.from(matrix) as M);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? base;
    else if (fn === ops.constructPath && args) {
      const op = args[0] as number;
      if (!painted.has(op)) continue;
      const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!data) continue;
      const closeAll = op === ops.closeStroke || op === ops.closeFillStroke || op === ops.closeEOFillStroke;
      let cur: number[] = [];
      let start: Pt | null = null;
      let last: Pt = [0, 0];
      let closed = false;
      const flush = () => {
        emit(cur, closed || closeAll);
        cur = [];
        closed = false;
      };
      for (let k = 0; k < data.length; ) {
        const code = data[k++];
        if (code === MOVE) {
          flush();
          last = [data[k++], data[k++]];
          start = last;
          cur.push(...ap(ctm, last[0], last[1]));
        } else if (code === LINE) {
          last = [data[k++], data[k++]];
          cur.push(...ap(ctm, last[0], last[1]));
        } else if (code === CURVE || code === QUAD) {
          const c1: Pt = [data[k++], data[k++]];
          const c2: Pt = code === CURVE ? [data[k++], data[k++]] : c1;
          const end: Pt = [data[k++], data[k++]];
          // Flattened: segments by the curve's size on the page.
          const p0 = ap(ctm, last[0], last[1]);
          const p3 = ap(ctm, end[0], end[1]);
          const q1 = ap(ctm, c1[0], c1[1]);
          const q2 = ap(ctm, c2[0], c2[1]);
          const size = Math.hypot(q1[0] - p0[0], q1[1] - p0[1]) + Math.hypot(q2[0] - q1[0], q2[1] - q1[1]) + Math.hypot(p3[0] - q2[0], p3[1] - q2[1]);
          const n = Math.min(64, Math.max(2, Math.ceil(size / 2)));
          for (let s = 1; s <= n; s++) {
            const t = s / n;
            const u = 1 - t;
            if (code === CURVE) {
              cur.push(
                u * u * u * p0[0] + 3 * u * u * t * q1[0] + 3 * u * t * t * q2[0] + t * t * t * p3[0],
                u * u * u * p0[1] + 3 * u * u * t * q1[1] + 3 * u * t * t * q2[1] + t * t * t * p3[1],
              );
            } else {
              cur.push(u * u * p0[0] + 2 * u * t * q1[0] + t * t * p3[0], u * u * p0[1] + 2 * u * t * q1[1] + t * t * p3[1]);
            }
          }
          last = end;
        } else if (code === CLOSE) {
          if (start) {
            const s0 = ap(ctm, start[0], start[1]);
            const n = cur.length;
            // (closed: the start point is not repeated)
            if (n >= 2 && Math.abs(cur[n - 2] - s0[0]) < 1e-9 && Math.abs(cur[n - 1] - s0[1]) < 1e-9) cur.length = n - 2;
            closed = true;
            flush();
            // (a path may go on from its start point)
            cur.push(s0[0], s0[1]);
            last = start;
          }
        } else {
          break;
        }
      }
      flush();
    }
  }
  return out;
}

/** A page's line work and texts as a vector drawing (one layer, in points). */
export function pdfVectorDrawing(paths: VectorPath[], texts: VectorText[]): VectorDrawing {
  let segmentCount = 0;
  for (const p of paths) segmentCount += p.pts.length / 2 - 1 + (p.closed ? 1 : 0);
  return {
    layers: [""],
    layersOff: [],
    paths,
    texts,
    extent: extentOf(paths, texts),
    metersPerUnit: null,
    unitName: "point",
    segmentCount,
    notes: [],
  };
}

/** pdf.js text items (`getTextContent`) as texts on the page shown (`base`: the viewport transform). */
export function textsFromContent(items: readonly unknown[], base: M): VectorText[] {
  const out: VectorText[] = [];
  for (const item of items) {
    const it = item as { str?: unknown; transform?: unknown };
    if (typeof it.str !== "string" || !it.str.trim() || !Array.isArray(it.transform) || it.transform.length !== 6) continue;
    const t = it.transform as M;
    const m = mul(base, t);
    // The glyphs' height: the text matrix's y axis on the page.
    const height = Math.hypot(m[2], m[3]);
    out.push({ layer: 0, text: it.str.trim(), u: m[4], v: m[5], height, rotation: Math.atan2(m[1], m[0]) });
  }
  return out;
}
