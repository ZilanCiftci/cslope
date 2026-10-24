/**
 * Collision-aware placement of point labels (greedy point-feature
 * labelling): each label tries candidate positions around its point in
 * order of preference and takes the first that is clear of everything
 * placed or reserved before it: other labels, symbols and markers (boxes)
 * and the lines of the drawing (segments with a half-width). A label with
 * no free position is left out.
 */

/** An axis-aligned box in canvas pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A line segment [x1, y1, x2, y2]. */
export type Seg = readonly [number, number, number, number];

/** Space kept between labels and other things, in pixels. */
const CLEARANCE = 1;

export function boxesOverlap(a: Box, b: Box, clearance = CLEARANCE): boolean {
  return (
    a.left < b.right + clearance &&
    b.left < a.right + clearance &&
    a.top < b.bottom + clearance &&
    b.top < a.bottom + clearance
  );
}

/** Whether a segment passes through a box (Liang–Barsky clipping). */
export function segmentHitsBox([x1, y1, x2, y2]: Seg, b: Box): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - b.left, b.right - x1, y1 - b.top, b.bottom - y1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/** Whether two segments intersect (touching counts). */
export function segmentsCross(a: Seg, b: Seg): boolean {
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const [ax, ay, bx, by] = a;
  const [cx, cy, dx, dy] = b;
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  // Collinear overlaps.
  const within = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy);
  return (
    (o1 === 0 && within(ax, ay, bx, by, cx, cy)) ||
    (o2 === 0 && within(ax, ay, bx, by, dx, dy)) ||
    (o3 === 0 && within(cx, cy, dx, dy, ax, ay)) ||
    (o4 === 0 && within(cx, cy, dx, dy, bx, by))
  );
}

/** Distance from (x, y) to the segment a–b. */
export function distanceToSegment(
  x: number,
  y: number,
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** A box of half-size `r` around a point. */
export function boxAround(x: number, y: number, rx: number, ry = rx): Box {
  return { left: x - rx, top: y - ry, right: x + rx, bottom: y + ry };
}

/** A box grown by `d` on every side. */
export function growBox(b: Box, d: number): Box {
  return { left: b.left - d, top: b.top - d, right: b.right + d, bottom: b.bottom + d };
}

/** Moves a box inward so it lies inside `bounds` (when it fits). */
export function clampBox(b: Box, bounds: Box): Box {
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const left = Math.max(bounds.left, Math.min(b.left, bounds.right - w));
  const top = Math.max(bounds.top, Math.min(b.top, bounds.bottom - h));
  return { left, top, right: left + w, bottom: top + h };
}

/** Whether (x, y) lies inside `b` grown by `margin`. */
export function pointInBox(x: number, y: number, b: Box, margin = 0): boolean {
  return x >= b.left - margin && x <= b.right + margin && y >= b.top - margin && y <= b.bottom + margin;
}

/** A reserved line: a segment and the half-width labels keep clear of. */
interface LineObstacle {
  seg: Seg;
  pad: number;
  /** Bounding box grown by `pad`, for a quick rejection. */
  box: Box;
}

export class LabelLayout {
  private readonly taken: Box[] = [];

  private readonly lines: LineObstacle[] = [];

  readonly bounds: Box;

  constructor(bounds: Box) {
    this.bounds = bounds;
  }

  /** Keeps labels off this box (a symbol, marker or another label). */
  reserve(b: Box): void {
    this.taken.push(b);
  }

  /**
   * Keeps labels at least `pad` px from this segment (a boundary, an
   * element, a dashed surface). Segments wholly outside the bounds are
   * ignored.
   */
  reserveSegment(seg: Seg, pad = 2): void {
    const box = growBox(
      {
        left: Math.min(seg[0], seg[2]),
        top: Math.min(seg[1], seg[3]),
        right: Math.max(seg[0], seg[2]),
        bottom: Math.max(seg[1], seg[3]),
      },
      pad,
    );
    if (!boxesOverlap(box, this.bounds, 0)) return;
    this.lines.push({ seg, pad, box });
  }

  /** Reserves each segment of a polyline (closed: also last to first). */
  reservePolyline(pts: readonly (readonly [number, number])[], pad = 2, closed = false): void {
    const n = pts.length;
    for (let i = 1; i < n + (closed ? 1 : 0); i++) {
      const a = pts[i - 1];
      const b = pts[i % n];
      this.reserveSegment([a[0], a[1], b[0], b[1]], pad);
    }
  }

  /**
   * Whether a segment (a leader line) crosses one of the reserved lines
   * or passes through a reserved box.
   */
  crossesLine(seg: Seg): boolean {
    if (this.taken.some((t) => segmentHitsBox(seg, t))) return true;
    return this.lines.some((l) => segmentsCross(seg, l.seg));
  }

  isFree(b: Box): boolean {
    if (this.taken.some((t) => boxesOverlap(b, t))) return false;
    for (const l of this.lines) {
      if (!boxesOverlap(b, l.box, 0)) continue;
      if (segmentHitsBox(l.seg, growBox(b, l.pad))) return false;
    }
    return true;
  }

  /**
   * Places a label at the first free candidate (each moved inside the
   * bounds first) and reserves it. Returns null when none is free, unless
   * `force` is set: then the first candidate is used anyway.
   */
  place(candidates: readonly Box[], force = false): Box | null {
    const inside = candidates.map((c) => clampBox(c, this.bounds));
    const free = inside.find((c) => this.isFree(c));
    const chosen = free ?? (force ? inside[0] : undefined);
    if (!chosen) return null;
    this.reserve(chosen);
    return chosen;
  }
}

/** Number of directions tried around a point. */
const DIRECTIONS = 16;
/** Extra distances (px) beyond the nearest ring of candidates. */
const RINGS = [0, 7, 16];
/** Preference cost of a farther ring, in degrees of turning away from the preferred direction. */
const RING_COST = 55;

/**
 * Candidate boxes of size `w`×`h` for the label of a point at (px, py),
 * clear of a point symbol of half-size `r`, in order of preference.
 *
 * The boxes slide around the point: in each of 16 directions the box sits
 * just beyond the symbol (its near edge or corner `r` + 3 px away), then
 * a little farther out. They are ordered by how far their direction turns
 * from `prefer` (a direction in canvas coordinates, y down, e.g. away from
 * the fill of the boundary the point is on; `true`/`false` mean straight
 * below/above), the nearer ring first among equal turns.
 */
export function pointLabelCandidates(
  px: number,
  py: number,
  w: number,
  h: number,
  prefer: boolean | readonly [number, number],
  r = 6,
): Box[] {
  const [dx, dy] = typeof prefer === "boolean" ? [0, prefer ? 1 : -1] : prefer;
  const preferAngle = Math.atan2(dy, dx);
  const gap = r + 3;
  const out: { box: Box; cost: number; order: number }[] = [];
  for (let ring = 0; ring < RINGS.length; ring++) {
    const g = gap + RINGS[ring];
    for (let k = 0; k < DIRECTIONS; k++) {
      // From straight up, clockwise on screen.
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / DIRECTIONS;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // Direction mapped onto a square, so the box slides around the
      // point keeping `g` clear horizontally or vertically.
      const s = Math.max(Math.abs(ux), Math.abs(uy));
      const vx = Math.abs(ux / s) < 1e-9 ? 0 : ux / s;
      const vy = Math.abs(uy / s) < 1e-9 ? 0 : uy / s;
      const cx = px + vx * (g + w / 2);
      const cy = py + vy * (g + h / 2);
      let turn = Math.abs(a - preferAngle) % (2 * Math.PI);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      out.push({
        box: { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 },
        cost: (turn * 180) / Math.PI + ring * RING_COST,
        order: out.length,
      });
    }
  }
  out.sort((p, q) => p.cost - q.cost || p.order - q.order);
  return out.map((c) => c.box);
}

/**
 * The direction pointing away from the fill at vertex `i` of a closed
 * polygon (canvas coordinates): along the bisector of the corner, on the
 * side outside the polygon; perpendicular to the boundary at a straight
 * vertex. `inside(x, y)` tells whether a point is inside the polygon.
 * Straight up when the corner has no direction (repeated points).
 */
export function outwardDirection(
  pts: readonly (readonly [number, number])[],
  i: number,
  inside: (x: number, y: number) => boolean,
): [number, number] {
  const n = pts.length;
  const [x, y] = pts[i];
  const unit = (ax: number, ay: number): [number, number] | null => {
    const l = Math.hypot(ax, ay);
    return l > 1e-9 ? [ax / l, ay / l] : null;
  };
  // Nearest distinct neighbours on each side.
  let prev: [number, number] | null = null;
  let next: [number, number] | null = null;
  for (let k = 1; k < n && !prev; k++) {
    const p = pts[(i - k + n) % n];
    prev = unit(p[0] - x, p[1] - y);
  }
  for (let k = 1; k < n && !next; k++) {
    const p = pts[(i + k) % n];
    next = unit(p[0] - x, p[1] - y);
  }
  if (!prev || !next) return [0, -1];
  let dir = unit(-(prev[0] + next[0]), -(prev[1] + next[1])) ?? [-next[1], next[0]];
  // Test a few pixels out along the bisector; flip when that is inside.
  const probe = 4;
  if (inside(x + dir[0] * probe, y + dir[1] * probe)) dir = [-dir[0], -dir[1]];
  return dir;
}

/**
 * The parts of a polyline inside a polygon (or on its edge), as
 * segments: each segment is split where it crosses the polygon's edges
 * and the pieces whose middle is inside are kept.
 */
export function segmentsInside(
  line: readonly (readonly [number, number])[],
  polygon: readonly (readonly [number, number])[],
  inside: (x: number, y: number) => boolean,
): Seg[] {
  const out: Seg[] = [];
  const n = polygon.length;
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1];
    const [x2, y2] = line[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const ts = [0, 1];
    for (let k = 0; k < n; k++) {
      const [ax, ay] = polygon[k];
      const [bx, by] = polygon[(k + 1) % n];
      const ex = bx - ax;
      const ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - x1) * ey - (ay - y1) * ex) / den;
      const u = ((ax - x1) * dy - (ay - y1) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (let k = 1; k < ts.length; k++) {
      const t0 = ts[k - 1];
      const t1 = ts[k];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      const mx = x1 + dx * tm;
      const my = y1 + dy * tm;
      const onEdge = polygon.some((a, j) => distanceToSegment(mx, my, a, polygon[(j + 1) % n]) <= 0.5);
      if (onEdge || inside(mx, my)) out.push([x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1]);
    }
  }
  return out;
}
