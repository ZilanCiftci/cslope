/**
 * Triangular meshing of a slope for the finite element module.
 *
 * Method and sources:
 * - Delaunay triangulation by incremental insertion (Bowyer 1981, Comput.
 *   J. 24(2), 162–166; Watson 1981, Comput. J. 24(2), 167–172) of the
 *   planar straight-line graph formed by the external boundary and every
 *   material boundary.
 * - Delaunay refinement by Ruppert's algorithm (Ruppert 1995, J. Algorithms
 *   18(3), 548–585; Shewchuk 2002, Comput. Geom. 22, 21–74): encroached
 *   segments are split, and poor triangles (smallest angle below
 *   `minAngle`, or larger than the size field) get a vertex at their
 *   circumcentre unless that vertex would encroach a segment, in which
 *   case the segment is split instead. A segment with an input vertex at
 *   one end is split on concentric shells around that vertex (Ruppert 1995;
 *   Shewchuk 2002), so that the subsegments at a small input angle become
 *   equally long.
 *
 * Implementation choices (not from the literature), with their reasons:
 * - Smallest angle 25° by default (Ruppert's guarantee is about 20.7°,
 *   and the algorithm usually terminates up to about 33°; Shewchuk 2002).
 * - Small input angles (thin layers meeting the ground at a shallow
 *   angle), where Ruppert's algorithm need not terminate, are handled by
 *   refining for angle only triangles whose circumradius exceeds `minSize`
 *   (default 1/8 of the smallest size) and by a vertex cap.
 * - A triangle is split for size when its longest edge exceeds 1.4 × the
 *   size field.
 * - Constraint segments that cross (a reinforcement line through a
 *   material boundary) get a vertex at the crossing.
 */

export interface MeshInput {
  /** Polygon of the whole domain (closed implicitly). */
  boundary: [number, number][];
  /** Further constraint polylines inside the domain (material boundaries). */
  segments: [number, number][][];
  /** Target element size at a point (m). */
  size: (x: number, y: number) => number;
  /** Smallest acceptable angle in degrees (default 25). */
  minAngle?: number;
  /** No triangle is split for its angle below this circumradius, and no segment shorter than it for encroachment (default: 1/8 of the smallest size, see `sizeMin`). */
  minSize?: number;
  /** Smallest value of `size` anywhere, when known (the default minSize also looks at the input vertices). */
  sizeMin?: number;
  /** Upper bound on the number of vertices (default 60 000). */
  maxVertices?: number;
}

export interface TriMesh {
  /** Vertex coordinates. */
  x: Float64Array;
  y: Float64Array;
  /** Corner vertices of each triangle, counter-clockwise (3 per triangle). */
  tri: Int32Array;
  /** Number of triangles. */
  count: number;
  /** Whether refinement stopped at the vertex cap. */
  capped: boolean;
  /** Constraint segments missing from the triangulation (shorter than the merge tolerance); normally 0. */
  missingSegments: number;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Whether d lies strictly inside the circumcircle of the counter-clockwise triangle a, b, c. */
function inCircle(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number,
): boolean {
  const adx = ax - dx, ady = ay - dy, bdx = bx - dx, bdy = by - dy, cdx = cx - dx, cdy = cy - dy;
  const ad = adx * adx + ady * ady, bd = bdx * bdx + bdy * bdy, cd = cdx * cdx + cdy * cdy;
  const det = adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
  return det > 0;
}

export function pointInPolygon(px: number, py: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

class Delaunay {
  x: number[] = [];
  y: number[] = [];
  v: number[] = []; // 3 per triangle
  n: number[] = []; // neighbour opposite vertex i
  alive: boolean[] = [];
  vtri: number[] = []; // a live triangle at each vertex
  private hint = 0;
  /** Triangles created by the last insertion. */
  created: number[] = [];

  constructor(xmin: number, ymin: number, xmax: number, ymax: number) {
    const d = Math.max(xmax - xmin, ymax - ymin) * 20 + 1;
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
    this.x.push(cx - d, cx + d, cx);
    this.y.push(cy - d, cy - d, cy + d);
    this.v.push(0, 1, 2);
    this.n.push(-1, -1, -1);
    this.alive.push(true);
    this.vtri.push(0, 0, 0);
  }

  isSuper(i: number): boolean {
    return i < 3;
  }

  /** Triangle containing the point (walk from the last hint). */
  locate(px: number, py: number): number {
    let t = this.hint;
    if (!this.alive[t]) t = this.alive.lastIndexOf(true);
    for (let guard = 0; guard < 4 * this.alive.length + 100; guard++) {
      let moved = false;
      for (let i = 0; i < 3; i++) {
        const a = this.v[3 * t + ((i + 1) % 3)], b = this.v[3 * t + ((i + 2) % 3)];
        if (orient(this.x[a], this.y[a], this.x[b], this.y[b], px, py) < -1e-14 * (1 + Math.abs(px) + Math.abs(py))) {
          const nb = this.n[3 * t + i];
          if (nb >= 0) {
            t = nb;
            moved = true;
            break;
          }
        }
      }
      if (!moved) return t;
    }
    // Fallback: brute force, with a tolerance relative to the edge and the
    // point's distance (orient is twice the area, a length squared).
    const left = (a: number, b: number) => {
      const ex = this.x[b] - this.x[a], ey = this.y[b] - this.y[a], qx = px - this.x[a], qy = py - this.y[a];
      return orient(this.x[a], this.y[a], this.x[b], this.y[b], px, py) >= -1e-12 * (ex * ex + ey * ey + qx * qx + qy * qy);
    };
    for (let s = 0; s < this.alive.length; s++) {
      if (!this.alive[s]) continue;
      const [a, b, c] = [this.v[3 * s], this.v[3 * s + 1], this.v[3 * s + 2]];
      if (left(a, b) && left(b, c) && left(c, a)) return s;
    }
    throw new Error("Point location failed");
  }

  /** Insert a point; returns its index, or the index of an existing vertex at the same place. */
  insert(px: number, py: number, tol: number): number {
    const t0 = this.locate(px, py);
    for (let i = 0; i < 3; i++) {
      const w = this.v[3 * t0 + i];
      if (Math.abs(this.x[w] - px) <= tol && Math.abs(this.y[w] - py) <= tol) return w;
    }
    const p = this.x.length;
    this.x.push(px);
    this.y.push(py);
    this.vtri.push(-1);
    // Cavity: triangles whose circumcircle contains p, grown from t0.
    const bad = new Set<number>([t0]);
    const stack = [t0];
    while (stack.length) {
      const t = stack.pop()!;
      for (let i = 0; i < 3; i++) {
        const nb = this.n[3 * t + i];
        if (nb < 0 || bad.has(nb)) continue;
        const [a, b, c] = [this.v[3 * nb], this.v[3 * nb + 1], this.v[3 * nb + 2]];
        if (inCircle(this.x[a], this.y[a], this.x[b], this.y[b], this.x[c], this.y[c], px, py)) {
          bad.add(nb);
          stack.push(nb);
        }
      }
    }
    // A new triangle (a, b, p) must not be degenerate: when p lies on a
    // cavity edge, the triangle across that edge joins the cavity.
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of [...bad]) {
        for (let i = 0; i < 3; i++) {
          const nb = this.n[3 * t + i];
          if (nb < 0 || bad.has(nb)) continue;
          const a = this.v[3 * t + ((i + 1) % 3)], b = this.v[3 * t + ((i + 2) % 3)];
          const ex = this.x[b] - this.x[a], ey = this.y[b] - this.y[a];
          const len2 = ex * ex + ey * ey;
          if (orient(this.x[a], this.y[a], this.x[b], this.y[b], px, py) <= 1e-10 * len2) {
            bad.add(nb);
            grew = true;
          }
        }
      }
    }
    // Boundary edges of the cavity, each giving a new triangle (a, b, p).
    const edgeOwner = new Map<string, [number, number]>(); // key "u,w" → [triangle, local index opposite]
    this.created = [];
    for (const t of bad) {
      for (let i = 0; i < 3; i++) {
        const nb = this.n[3 * t + i];
        if (nb >= 0 && bad.has(nb)) continue;
        const a = this.v[3 * t + ((i + 1) % 3)], b = this.v[3 * t + ((i + 2) % 3)];
        const nt = this.alive.length;
        this.v.push(a, b, p);
        this.n.push(-1, -1, nb); // opposite a: edge (b, p); opposite b: edge (p, a); opposite p: edge (a, b)
        this.alive.push(true);
        this.created.push(nt);
        if (nb >= 0) {
          for (let j = 0; j < 3; j++) {
            const u = this.v[3 * nb + ((j + 1) % 3)], w = this.v[3 * nb + ((j + 2) % 3)];
            if (u === b && w === a) this.n[3 * nb + j] = nt;
          }
        }
        this.vtri[a] = nt;
        this.vtri[b] = nt;
        this.vtri[p] = nt;
        // Link the edges through p.
        for (const [u, w, local] of [[b, p, 0], [p, a, 1]] as [number, number, number][]) {
          const key = `${w},${u}`; // the twin edge is oriented the other way
          const other = edgeOwner.get(key);
          if (other) {
            this.n[3 * nt + local] = other[0];
            this.n[3 * other[0] + other[1]] = nt;
            edgeOwner.delete(key);
          } else {
            edgeOwner.set(`${u},${w}`, [nt, local]);
          }
        }
      }
    }
    for (const t of bad) this.alive[t] = false;
    this.hint = this.created[0];
    return p;
  }

  /** A live triangle with the edge a–b, and the local index of its third vertex, or null. */
  findEdge(a: number, b: number): [number, number] | null {
    const start = this.vtri[a];
    if (start < 0 || !this.alive[start]) return this.findEdgeBrute(a, b);
    for (const dir of [1, 2]) {
      let t = start;
      for (let guard = 0; guard < 1000; guard++) {
        let ia = -1;
        for (let i = 0; i < 3; i++) if (this.v[3 * t + i] === a) ia = i;
        if (ia < 0) break;
        const i1 = (ia + 1) % 3, i2 = (ia + 2) % 3;
        if (this.v[3 * t + i1] === b) return [t, i2];
        if (this.v[3 * t + i2] === b) return [t, i1];
        // Rotate across the edge (a, v[i1]) (opposite i2) or (a, v[i2]) (opposite i1).
        const nb = this.n[3 * t + (dir === 1 ? i2 : i1)];
        if (nb < 0 || nb === start) break;
        t = nb;
      }
    }
    return this.findEdgeBrute(a, b);
  }

  private findEdgeBrute(a: number, b: number): [number, number] | null {
    for (let t = 0; t < this.alive.length; t++) {
      if (!this.alive[t]) continue;
      const vs = [this.v[3 * t], this.v[3 * t + 1], this.v[3 * t + 2]];
      const ia = vs.indexOf(a), ib = vs.indexOf(b);
      if (ia >= 0 && ib >= 0) return [t, 3 - ia - ib];
    }
    return null;
  }
}

function circumcentre(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): [number, number, number] {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return [ux, uy, dist(ax - ux, ay - uy)];
}

/**
 * Length of (dx, dy). The mesh uses only +, −, ×, / and √, which IEEE 754
 * rounds correctly, so that it is the same in every JavaScript engine;
 * Math.hypot, acos, log2 and ** may differ by an ulp between engines and
 * would change the mesh.
 */
function dist(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** cos x by its Taylor series in correctly rounded arithmetic (|x| ≤ π/2). */
function cosine(x: number): number {
  let term = 1, sum = 1;
  for (let k = 1; k <= 12; k++) {
    term *= -(x * x) / ((2 * k - 1) * (2 * k));
    sum += term;
  }
  return sum;
}

/** Cosine of the smallest angle of a triangle (the angle opposite the shortest side, by the law of cosines). */
function minAngleCos(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const la = dist(bx - cx, by - cy), lb = dist(ax - cx, ay - cy), lc = dist(ax - bx, ay - by);
  const s = Math.min(la, lb, lc);
  const [p, q] = s === la ? [lb, lc] : s === lb ? [la, lc] : [la, lb];
  return (p * p + q * q - s * s) / (2 * p * q);
}

/** Mesh the domain. Throws if the input is degenerate. */
export function meshDomain(input: MeshInput): TriMesh {
  // A triangle is poor when its smallest angle is below minAngle, i.e. the
  // cosine of that angle is above cos(minAngle).
  const cosMinAngle = cosine(((input.minAngle ?? 25) * Math.PI) / 180);
  const maxVertices = input.maxVertices ?? 60000;
  const all = [input.boundary, ...input.segments];
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const line of all) for (const [px, py] of line) {
    xmin = Math.min(xmin, px); xmax = Math.max(xmax, px);
    ymin = Math.min(ymin, py); ymax = Math.max(ymax, py);
  }
  const span = Math.max(xmax - xmin, ymax - ymin);
  const tol = 1e-9 * span;
  const dt = new Delaunay(xmin, ymin, xmax, ymax);

  // Input vertices (deduplicated by the insertion) and segments between them.
  const segs: [number, number][] = [];
  const addLine = (pts: [number, number][], closed: boolean) => {
    const ids = pts.map(([px, py]) => dt.insert(px, py, tol));
    const m = closed ? ids.length : ids.length - 1;
    for (let i = 0; i < m; i++) {
      const a = ids[i], b = ids[(i + 1) % ids.length];
      if (a !== b) segs.push([a, b]);
    }
  };
  addLine(input.boundary, true);
  for (const s of input.segments) addLine(s, false);

  // Crossing segments (a reinforcement line through a material boundary)
  // get a vertex at the crossing, so that both are split there below.
  {
    const n0 = segs.length;
    for (let i = 0; i < n0; i++) {
      const [a, b] = segs[i];
      for (let j = i + 1; j < n0; j++) {
        const [c, d] = segs[j];
        if (a === c || a === d || b === c || b === d) continue;
        const ax = dt.x[a], ay = dt.y[a], bx = dt.x[b], by = dt.y[b];
        const cx = dt.x[c], cy = dt.y[c], dx = dt.x[d], dy = dt.y[d];
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (Math.abs(den) < 1e-12 * span * span) continue;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) dt.insert(ax + t * (bx - ax), ay + t * (by - ay), tol);
      }
    }
  }

  // Split every segment at input vertices lying on it, and drop duplicates.
  const inputVerts = dt.x.length;
  const onSeg = (a: number, b: number, c: number) => {
    const ax = dt.x[a], ay = dt.y[a], bx = dt.x[b], by = dt.y[b], cx = dt.x[c], cy = dt.y[c];
    const len2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
    const t = ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / len2;
    if (t <= 1e-9 || t >= 1 - 1e-9) return -1;
    const d = Math.abs(orient(ax, ay, bx, by, cx, cy)) / Math.sqrt(len2);
    return d <= 1e-7 * span ? t : -1;
  };
  const segSet = new Map<string, [number, number]>();
  for (const [a, b] of segs) {
    const pts: [number, number][] = [];
    for (let c = 3; c < inputVerts; c++) {
      if (c === a || c === b) continue;
      const t = onSeg(a, b, c);
      if (t > 0) pts.push([t, c]);
    }
    pts.sort((p, q) => p[0] - q[0]);
    const chain = [a, ...pts.map((p) => p[1]), b];
    for (let i = 0; i + 1 < chain.length; i++) {
      const u = chain[i], w = chain[i + 1];
      segSet.set(u < w ? `${u},${w}` : `${w},${u}`, [u, w]);
    }
  }
  let segments = [...segSet.values()];

  // Smallest size for splitting for angle or encroachment: 1/8 of the
  // smallest target size, at any input vertex (boundary and constraint
  // lines) or as given by the size field (`sizeMin`), so that a fine region
  // inside the domain is not held at the boundary's size.
  let size0 = input.sizeMin ?? Infinity;
  for (const line of all) for (const [px, py] of line) size0 = Math.min(size0, input.size(px, py));
  const minSize = input.minSize ?? size0 / 8;
  const boundary = input.boundary;
  const insideDomain = (px: number, py: number) => pointInPolygon(px, py, boundary);
  let capped = false;

  const encroachedBy = (s: [number, number], px: number, py: number) => {
    const [a, b] = s;
    return (dt.x[a] - px) * (dt.x[b] - px) + (dt.y[a] - py) * (dt.y[b] - py) < -1e-12 * span * span;
  };
  const segEncroached = (s: [number, number]): boolean => {
    const [a, b] = s;
    const e = dt.findEdge(a, b);
    if (!e) return true;
    const [t] = e;
    // Apices of both triangles at the edge.
    const ts = [t];
    for (let i = 0; i < 3; i++) {
      const nb = dt.n[3 * t + i];
      const u = dt.v[3 * t + ((i + 1) % 3)], w = dt.v[3 * t + ((i + 2) % 3)];
      if (((u === a && w === b) || (u === b && w === a)) && nb >= 0) ts.push(nb);
    }
    for (const tt of ts) for (let i = 0; i < 3; i++) {
      const c = dt.v[3 * tt + i];
      if (c === a || c === b || dt.isSuper(c)) continue;
      if (encroachedBy(s, dt.x[c], dt.y[c])) return true;
    }
    return false;
  };
  // Ruppert's concentric shells: a segment with an input vertex at one end
  // is split at a power-of-two distance from that vertex, so that the
  // subsegments around a small input angle end up equally long and stop
  // encroaching on each other.
  const isInput = new Uint8Array(inputVerts);
  for (let i = 3; i < inputVerts; i++) isInput[i] = 1;
  const input0 = (v: number) => v < inputVerts && isInput[v] === 1;
  const splitSegment = (k: number) => {
    const [a, b] = segments[k];
    const len = dist(dt.x[b] - dt.x[a], dt.y[b] - dt.y[a]);
    let t = 0.5;
    if (input0(a) !== input0(b)) {
      // The power of two nearest to len/2 (in ratio): d ≤ len/2 < 2d, and
      // 2d if len/2 ≥ √2·d.
      const half = len / 2;
      let d = 1;
      while (d * 2 <= half) d *= 2;
      while (d > half) d /= 2;
      if (half * half >= 2 * d * d) d *= 2;
      const f = d / len;
      t = input0(a) ? f : 1 - f;
      if (t < 0.25 || t > 0.75) t = 0.5;
    }
    const m = dt.insert(dt.x[a] + t * (dt.x[b] - dt.x[a]), dt.y[a] + t * (dt.y[b] - dt.y[a]), tol);
    // A segment within the merge tolerance of its length cannot be split.
    if (m === a || m === b) return false;
    segments[k] = [a, m];
    segments.push([m, b]);
    return true;
  };
  const segLength = (k: number) => {
    const [a, b] = segments[k];
    return dist(dt.x[b] - dt.x[a], dt.y[b] - dt.y[a]);
  };
  const recoverSegments = () => {
    for (let pass = 0; pass < 100000; pass++) {
      let any = false;
      for (let k = 0; k < segments.length; k++) {
        if (dt.x.length >= maxVertices) { capped = true; return; }
        const [a, b] = segments[k];
        const missing = !dt.findEdge(a, b);
        // A present but encroached segment is split only while it is longer
        // than the smallest size; a missing one is always split.
        if (missing || (segLength(k) > minSize && segEncroached(segments[k]))) {
          if (splitSegment(k)) any = true;
        }
      }
      if (!any) return;
    }
  };
  recoverSegments();

  // Refine poor and oversized triangles.
  const queue: number[] = [];
  for (let t = 0; t < dt.alive.length; t++) if (dt.alive[t]) queue.push(t);
  while (queue.length) {
    if (dt.x.length >= maxVertices) { capped = true; break; }
    const t = queue.pop()!;
    if (!dt.alive[t]) continue;
    const [a, b, c] = [dt.v[3 * t], dt.v[3 * t + 1], dt.v[3 * t + 2]];
    if (dt.isSuper(a) || dt.isSuper(b) || dt.isSuper(c)) continue;
    const gx = (dt.x[a] + dt.x[b] + dt.x[c]) / 3, gy = (dt.y[a] + dt.y[b] + dt.y[c]) / 3;
    if (!insideDomain(gx, gy)) continue;
    const [ux, uy, r] = circumcentre(dt.x[a], dt.y[a], dt.x[b], dt.y[b], dt.x[c], dt.y[c]);
    const maxEdge = Math.max(
      dist(dt.x[a] - dt.x[b], dt.y[a] - dt.y[b]),
      dist(dt.x[b] - dt.x[c], dt.y[b] - dt.y[c]),
      dist(dt.x[c] - dt.x[a], dt.y[c] - dt.y[a]),
    );
    const tooBig = maxEdge > 1.4 * input.size(gx, gy);
    const tooThin = r > minSize && minAngleCos(dt.x[a], dt.y[a], dt.x[b], dt.y[b], dt.x[c], dt.y[c]) > cosMinAngle;
    if (!tooBig && !tooThin) continue;
    const enc: number[] = [];
    let blocked = false;
    for (let k = 0; k < segments.length; k++) {
      if (!encroachedBy(segments[k], ux, uy)) continue;
      if (segLength(k) > minSize) enc.push(k);
      else blocked = true;
    }
    if (blocked && !enc.length) continue;
    if (enc.length) {
      const n0 = dt.alive.length;
      let split = false;
      for (const k of enc) if (splitSegment(k)) split = true;
      if (!split) continue;
      recoverSegments();
      // Only the triangles made by the splits are new; the rest were checked.
      for (let s = n0; s < dt.alive.length; s++) if (dt.alive[s]) queue.push(s);
      if (dt.alive[t]) queue.push(t);
      continue;
    }
    if (!insideDomain(ux, uy)) continue;
    const before = dt.x.length;
    dt.insert(ux, uy, tol);
    // The circumcentre merged with an existing vertex: nothing changed, and
    // re-queueing the triangle would loop.
    if (dt.x.length === before) continue;
    queue.push(...dt.created);
    if (dt.alive[t]) queue.push(t);
  }

  // Keep the triangles inside the domain.
  const keep: number[] = [];
  for (let t = 0; t < dt.alive.length; t++) {
    if (!dt.alive[t]) continue;
    const [a, b, c] = [dt.v[3 * t], dt.v[3 * t + 1], dt.v[3 * t + 2]];
    if (dt.isSuper(a) || dt.isSuper(b) || dt.isSuper(c)) continue;
    const gx = (dt.x[a] + dt.x[b] + dt.x[c]) / 3, gy = (dt.y[a] + dt.y[b] + dt.y[c]) / 3;
    if (insideDomain(gx, gy)) keep.push(a, b, c);
  }
  // Compact the vertices (drop the super triangle and unused points).
  const map = new Int32Array(dt.x.length).fill(-1);
  const xs: number[] = [], ys: number[] = [];
  const tri = new Int32Array(keep.length);
  for (let i = 0; i < keep.length; i++) {
    const v = keep[i];
    if (map[v] < 0) { map[v] = xs.length; xs.push(dt.x[v]); ys.push(dt.y[v]); }
    tri[i] = map[v];
  }
  let missingSegments = 0;
  for (const [a, b] of segments) if (!dt.findEdge(a, b)) missingSegments++;
  segments = [];
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), tri, count: keep.length / 3, capped, missingSegments };
}
