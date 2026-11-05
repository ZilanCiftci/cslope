/**
 * A uniform grid over a drawing's segments (source coordinates), so that
 * what lies near the pointer is found without looking at every segment:
 * snapping and line picking stay fast with hundreds of thousands of
 * segments. Each segment is entered in the cells it passes through (not
 * those of its bounding box), so a long diagonal line costs a row of
 * cells, not a square of them.
 */
import type { Crop } from "./transform";
import type { VectorDrawing } from "./vectors";

export class SegmentIndex {
  /** Segment k: (x0[k], y0[k]) → (x1[k], y1[k]), of path `path[k]`, its `index[k]`-th segment. */
  readonly x0: Float64Array;
  readonly y0: Float64Array;
  readonly x1: Float64Array;
  readonly y1: Float64Array;
  readonly path: Int32Array;
  readonly index: Int32Array;
  readonly count: number;
  private readonly ox: number;
  private readonly oy: number;
  private readonly cell: number;
  private readonly nx: number;
  private readonly ny: number;
  /** Compressed rows: the segments of cell c are items[start[c] .. start[c + 1]). */
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly stamp: Uint32Array;
  private epoch = 0;

  constructor(drawing: Pick<VectorDrawing, "paths" | "extent">) {
    let n = 0;
    for (const p of drawing.paths) n += p.pts.length / 2 - 1 + (p.closed ? 1 : 0);
    this.count = n;
    this.x0 = new Float64Array(n);
    this.y0 = new Float64Array(n);
    this.x1 = new Float64Array(n);
    this.y1 = new Float64Array(n);
    this.path = new Int32Array(n);
    this.index = new Int32Array(n);
    let k = 0;
    drawing.paths.forEach((p, pi) => {
      const a = p.pts;
      const m = a.length / 2;
      const segs = m - 1 + (p.closed ? 1 : 0);
      for (let s = 0; s < segs; s++) {
        const t = (s + 1) % m;
        this.x0[k] = a[2 * s];
        this.y0[k] = a[2 * s + 1];
        this.x1[k] = a[2 * t];
        this.y1[k] = a[2 * t + 1];
        this.path[k] = pi;
        this.index[k] = s;
        k++;
      }
    });
    const e = drawing.extent;
    const w = Math.max(e.x1 - e.x0, 1e-9);
    const h = Math.max(e.y1 - e.y0, 1e-9);
    // About two segments per cell, at most 512 × 512 cells.
    const cells = Math.min(512 * 512, Math.max(1, n / 2));
    this.cell = Math.max(Math.sqrt((w * h) / cells), Math.max(w, h) / 512);
    this.ox = e.x0;
    this.oy = e.y0;
    this.nx = Math.max(1, Math.ceil(w / this.cell) + 1);
    this.ny = Math.max(1, Math.ceil(h / this.cell) + 1);
    const counts = new Int32Array(this.nx * this.ny + 1);
    for (let s = 0; s < n; s++) this.visitCells(s, (c) => counts[c]++);
    this.start = new Int32Array(this.nx * this.ny + 1);
    for (let c = 0; c < this.nx * this.ny; c++) this.start[c + 1] = this.start[c] + counts[c];
    this.items = new Int32Array(this.start[this.nx * this.ny]);
    const fill = this.start.slice(0, this.nx * this.ny);
    for (let s = 0; s < n; s++) this.visitCells(s, (c) => (this.items[fill[c]++] = s));
    this.stamp = new Uint32Array(n);
  }

  private cx(x: number): number {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.ox) / this.cell)));
  }

  private cy(y: number): number {
    return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.oy) / this.cell)));
  }

  /** The cells segment s passes through: column by column, the rows its y spans there. */
  private visitCells(s: number, visit: (cell: number) => void): void {
    let ax = this.x0[s];
    let ay = this.y0[s];
    let bx = this.x1[s];
    let by = this.y1[s];
    if (ax > bx) [ax, ay, bx, by] = [bx, by, ax, ay];
    const c0 = this.cx(ax);
    const c1 = this.cx(bx);
    const dx = bx - ax;
    for (let c = c0; c <= c1; c++) {
      // The segment's y over this column's x range.
      const xa = Math.max(ax, this.ox + c * this.cell);
      const xb = Math.min(bx, this.ox + (c + 1) * this.cell);
      const ya = dx === 0 ? ay : ay + ((by - ay) * (xa - ax)) / dx;
      const yb = dx === 0 ? by : ay + ((by - ay) * (xb - ax)) / dx;
      const r0 = this.cy(Math.min(ya, yb));
      const r1 = this.cy(Math.max(ya, yb));
      for (let r = r0; r <= r1; r++) visit(r * this.nx + c);
    }
  }

  /** Each segment that may cross the rectangle, once (and some near it). */
  query(rect: Crop, visit: (segment: number) => void): void {
    if (this.count === 0) return;
    this.epoch = (this.epoch + 1) >>> 0;
    if (this.epoch === 0) {
      this.stamp.fill(0);
      this.epoch = 1;
    }
    const c0 = this.cx(rect.x0);
    const c1 = this.cx(rect.x1);
    const r0 = this.cy(rect.y0);
    const r1 = this.cy(rect.y1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.nx + c;
        for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
          const s = this.items[k];
          if (this.stamp[s] === this.epoch) continue;
          this.stamp[s] = this.epoch;
          visit(s);
        }
      }
    }
  }
}
