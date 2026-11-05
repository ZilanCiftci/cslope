/**
 * Drawing a drawing's line work: one Path2D of all its shown paths, made
 * in canvas pixels for the zoom it is drawn at (the transform's linear
 * part; a pan only moves it), with points closer than a fraction of a
 * pixel to the previous one left out. The path is kept per drawing, zoom
 * and hidden layers, so a pan redraws the cached path and a zoom builds
 * one path. Texts are drawn where they are tall enough to read.
 */
import type { Affine } from "./transform";
import type { VectorDrawing } from "./vectors";

/** Points closer than this (canvas px) to the previous point drawn are left out. */
const SIMPLIFY_PX = 0.4;
/** Paths kept per drawing (zoom levels and layer choices). */
const PATHS_PER_DRAWING = 6;

type Linear = Pick<Affine, "a" | "b" | "c" | "d">;

const cache = new WeakMap<VectorDrawing, Map<string, Path2D>>();

/** The key of a linear map, rounded so that a pan's float noise keeps the key. */
const linearKey = (l: Linear) => [l.a, l.b, l.c, l.d].map((v) => v.toPrecision(9)).join(",");

/** Counts the paths built (tests, and the frame-time measurement). */
export const vectorPathStats = { built: 0 };

/** The drawing's shown paths in canvas px under the linear map `l` (no translation). */
export function vectorPath(drawing: VectorDrawing, hidden: ReadonlySet<number>, l: Linear): Path2D {
  const key = `${linearKey(l)}|${[...hidden].sort((x, y) => x - y).join(",")}`;
  let byKey = cache.get(drawing);
  if (!byKey) {
    byKey = new Map();
    cache.set(drawing, byKey);
  }
  const known = byKey.get(key);
  if (known) {
    // (most recently used last)
    byKey.delete(key);
    byKey.set(key, known);
    return known;
  }
  const path = buildPath(drawing, hidden, l);
  vectorPathStats.built++;
  byKey.set(key, path);
  while (byKey.size > PATHS_PER_DRAWING) byKey.delete(byKey.keys().next().value!);
  return path;
}

function buildPath(drawing: VectorDrawing, hidden: ReadonlySet<number>, { a, b, c, d }: Linear): Path2D {
  const path = new Path2D();
  const min2 = SIMPLIFY_PX * SIMPLIFY_PX;
  for (const p of drawing.paths) {
    if (hidden.has(p.layer)) continue;
    const pts = p.pts;
    const n = pts.length / 2;
    let lx = a * pts[0] + c * pts[1];
    let ly = b * pts[0] + d * pts[1];
    path.moveTo(lx, ly);
    for (let i = 1; i < n; i++) {
      const x = a * pts[2 * i] + c * pts[2 * i + 1];
      const y = b * pts[2 * i] + d * pts[2 * i + 1];
      const dx = x - lx;
      const dy = y - ly;
      if (dx * dx + dy * dy < min2 && i < n - 1) continue;
      path.lineTo(x, y);
      lx = x;
      ly = y;
    }
    if (p.closed) path.closePath();
  }
  return path;
}

/** Texts smaller than this (canvas px) are not drawn; nor more than MAX_TEXTS. */
const MIN_TEXT_PX = 4;
const MAX_TEXT_PX = 400;
const MAX_TEXTS = 4000;

/** The drawing's texts of shown layers, through `m` (source → canvas units). */
export function drawVectorTexts(ctx: CanvasRenderingContext2D, drawing: VectorDrawing, hidden: ReadonlySet<number>, m: Affine, color: string): void {
  if (drawing.texts.length === 0) return;
  // The height of a text: its source height along the page's vertical, through m.
  const vScale = Math.hypot(m.c, m.d);
  let drawn = 0;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  for (const t of drawing.texts) {
    if (hidden.has(t.layer)) continue;
    const h = t.height * vScale;
    if (h < MIN_TEXT_PX || h > MAX_TEXT_PX) continue;
    if (++drawn > MAX_TEXTS) break;
    const x = m.a * t.u + m.c * t.v + m.e;
    const y = m.b * t.u + m.d * t.v + m.f;
    const dirx = m.a * Math.cos(t.rotation) + m.c * Math.sin(t.rotation);
    const diry = m.b * Math.cos(t.rotation) + m.d * Math.sin(t.rotation);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(diry, dirx));
    ctx.font = `${h.toFixed(1)}px system-ui, sans-serif`;
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
