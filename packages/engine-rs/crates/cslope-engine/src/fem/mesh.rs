//! Port of packages/engine/src/fem/mesh.ts.
//!
//! Triangular meshing of a slope for the finite element module.
//!
//! Method and sources:
//! - Delaunay triangulation by incremental insertion (Bowyer 1981, Comput.
//!   J. 24(2), 162–166; Watson 1981, Comput. J. 24(2), 167–172) of the
//!   planar straight-line graph formed by the external boundary and every
//!   material boundary.
//! - Delaunay refinement by Ruppert's algorithm (Ruppert 1995, J. Algorithms
//!   18(3), 548–585; Shewchuk 2002, Comput. Geom. 22, 21–74): encroached
//!   segments are split, and poor triangles (smallest angle below
//!   `min_angle`, or larger than the size field) get a vertex at their
//!   circumcentre unless that vertex would encroach a segment, in which
//!   case the segment is split instead. A segment with an input vertex at
//!   one end is split on concentric shells around that vertex (Ruppert 1995;
//!   Shewchuk 2002), so that the subsegments at a small input angle become
//!   equally long.
//!
//! Implementation choices (not from the literature), with their reasons:
//! - Smallest angle 25° by default (Ruppert's guarantee is about 20.7°,
//!   and the algorithm usually terminates up to about 33°; Shewchuk 2002).
//! - Small input angles (thin layers meeting the ground at a shallow
//!   angle), where Ruppert's algorithm need not terminate, are handled by
//!   refining for angle only triangles whose circumradius exceeds `min_size`
//!   (default 1/8 of the smallest size) and by a vertex cap.
//! - A triangle is split for size when its longest edge exceeds 1.4 × the
//!   size field.
//! - Constraint segments that cross (a reinforcement line through a
//!   material boundary) get a vertex at the crossing.
//!
//! Rust notes: the TypeScript `Set`s and `Map`s whose iteration order
//! matters (the cavity of an insertion, the deduplicated segments) are
//! vectors in insertion order with a membership index beside them.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::error::{EngineError, Result};
use crate::js;
use std::collections::HashMap;

/// Input of `mesh_domain`.
pub struct MeshInput<'a> {
    /// Polygon of the whole domain (closed implicitly).
    pub boundary: Vec<[f64; 2]>,
    /// Further constraint polylines inside the domain (material boundaries).
    pub segments: Vec<Vec<[f64; 2]>>,
    /// Target element size at a point (m).
    pub size: &'a dyn Fn(f64, f64) -> f64,
    /// Smallest acceptable angle in degrees (default 25).
    pub min_angle: Option<f64>,
    /// No triangle is split for its angle below this circumradius, and no segment shorter than it for encroachment (default: 1/8 of the smallest size, see `size_min`).
    pub min_size: Option<f64>,
    /// Smallest value of `size` anywhere, when known (the default min_size also looks at the input vertices).
    pub size_min: Option<f64>,
    /// Upper bound on the number of vertices (default 60 000).
    pub max_vertices: Option<usize>,
}

/// A triangulation of the domain.
#[derive(Debug, Clone, PartialEq)]
pub struct TriMesh {
    /// Vertex coordinates.
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    /// Corner vertices of each triangle, counter-clockwise (3 per triangle).
    pub tri: Vec<usize>,
    /// Number of triangles.
    pub count: usize,
    /// Whether refinement stopped at the vertex cap.
    pub capped: bool,
    /// Constraint segments missing from the triangulation (shorter than the merge tolerance); normally 0.
    pub missing_segments: usize,
}

fn orient(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> f64 {
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/// Whether d lies strictly inside the circumcircle of the counter-clockwise triangle a, b, c.
#[allow(clippy::too_many_arguments)]
fn in_circle(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64, dx: f64, dy: f64) -> bool {
    let (adx, ady, bdx, bdy, cdx, cdy) = (ax - dx, ay - dy, bx - dx, by - dy, cx - dx, cy - dy);
    let ad = adx * adx + ady * ady;
    let bd = bdx * bdx + bdy * bdy;
    let cd = cdx * cdx + cdy * cdy;
    let det =
        adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
    det > 0.0
}

/// Whether (px, py) lies inside the polygon (even-odd rule).
pub fn point_in_polygon(px: f64, py: f64, poly: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let n = poly.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let [xi, yi] = poly[i];
        let [xj, yj] = poly[j];
        if (yi > py) != (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

struct Delaunay {
    x: Vec<f64>,
    y: Vec<f64>,
    /// 3 per triangle.
    v: Vec<usize>,
    /// Neighbour opposite vertex i (−1: none).
    n: Vec<i64>,
    alive: Vec<bool>,
    /// A live triangle at each vertex (−1: none).
    vtri: Vec<i64>,
    hint: usize,
    /// Triangles created by the last insertion.
    created: Vec<usize>,
    /// Cavity membership of the current insertion (`bad_mark[t] == bad_stamp`).
    bad_mark: Vec<u32>,
    bad_stamp: u32,
}

impl Delaunay {
    fn new(xmin: f64, ymin: f64, xmax: f64, ymax: f64) -> Self {
        let d = js::math::max(xmax - xmin, ymax - ymin) * 20.0 + 1.0;
        let cx = (xmin + xmax) / 2.0;
        let cy = (ymin + ymax) / 2.0;
        Delaunay {
            x: vec![cx - d, cx + d, cx],
            y: vec![cy - d, cy - d, cy + d],
            v: vec![0, 1, 2],
            n: vec![-1, -1, -1],
            alive: vec![true],
            vtri: vec![0, 0, 0],
            hint: 0,
            created: Vec::new(),
            bad_mark: vec![0],
            bad_stamp: 0,
        }
    }

    fn is_super(&self, i: usize) -> bool {
        i < 3
    }

    /// Triangle containing the point (walk from the last hint).
    fn locate(&self, px: f64, py: f64) -> Result<usize> {
        let mut t = self.hint;
        if !self.alive[t] {
            t = self
                .alive
                .iter()
                .rposition(|&a| a)
                .expect("a live triangle");
        }
        let guard_max = 4 * self.alive.len() + 100;
        for _ in 0..guard_max {
            let mut moved = false;
            for i in 0..3 {
                let a = self.v[3 * t + (i + 1) % 3];
                let b = self.v[3 * t + (i + 2) % 3];
                if orient(self.x[a], self.y[a], self.x[b], self.y[b], px, py)
                    < -1e-14 * (1.0 + px.abs() + py.abs())
                {
                    let nb = self.n[3 * t + i];
                    if nb >= 0 {
                        t = nb as usize;
                        moved = true;
                        break;
                    }
                }
            }
            if !moved {
                return Ok(t);
            }
        }
        // Fallback: brute force, with a tolerance relative to the edge and the
        // point's distance (orient is twice the area, a length squared).
        let left = |a: usize, b: usize| {
            let ex = self.x[b] - self.x[a];
            let ey = self.y[b] - self.y[a];
            let qx = px - self.x[a];
            let qy = py - self.y[a];
            orient(self.x[a], self.y[a], self.x[b], self.y[b], px, py)
                >= -1e-12 * (ex * ex + ey * ey + qx * qx + qy * qy)
        };
        for s in 0..self.alive.len() {
            if !self.alive[s] {
                continue;
            }
            let (a, b, c) = (self.v[3 * s], self.v[3 * s + 1], self.v[3 * s + 2]);
            if left(a, b) && left(b, c) && left(c, a) {
                return Ok(s);
            }
        }
        Err(EngineError::new("Point location failed"))
    }

    fn push_triangle(&mut self, a: usize, b: usize, c: usize, na: i64, nb: i64, nc: i64) -> usize {
        let nt = self.alive.len();
        self.v.extend_from_slice(&[a, b, c]);
        self.n.extend_from_slice(&[na, nb, nc]);
        self.alive.push(true);
        self.bad_mark.push(0);
        nt
    }

    /// Insert a point; returns its index, or the index of an existing vertex at the same place.
    fn insert(&mut self, px: f64, py: f64, tol: f64) -> Result<usize> {
        let t0 = self.locate(px, py)?;
        for i in 0..3 {
            let w = self.v[3 * t0 + i];
            if (self.x[w] - px).abs() <= tol && (self.y[w] - py).abs() <= tol {
                return Ok(w);
            }
        }
        let p = self.x.len();
        self.x.push(px);
        self.y.push(py);
        self.vtri.push(-1);
        // Cavity: triangles whose circumcircle contains p, grown from t0.
        self.bad_stamp = self.bad_stamp.wrapping_add(1);
        if self.bad_stamp == 0 {
            self.bad_mark.fill(0);
            self.bad_stamp = 1;
        }
        let stamp = self.bad_stamp;
        let mut bad: Vec<usize> = vec![t0];
        self.bad_mark[t0] = stamp;
        let mut stack = vec![t0];
        while let Some(t) = stack.pop() {
            for i in 0..3 {
                let nb = self.n[3 * t + i];
                if nb < 0 || self.bad_mark[nb as usize] == stamp {
                    continue;
                }
                let nb = nb as usize;
                let (a, b, c) = (self.v[3 * nb], self.v[3 * nb + 1], self.v[3 * nb + 2]);
                if in_circle(
                    self.x[a], self.y[a], self.x[b], self.y[b], self.x[c], self.y[c], px, py,
                ) {
                    self.bad_mark[nb] = stamp;
                    bad.push(nb);
                    stack.push(nb);
                }
            }
        }
        // A new triangle (a, b, p) must not be degenerate: when p lies on a
        // cavity edge, the triangle across that edge joins the cavity.
        let mut grew = true;
        while grew {
            grew = false;
            let snapshot = bad.clone();
            for &t in &snapshot {
                for i in 0..3 {
                    let nb = self.n[3 * t + i];
                    if nb < 0 || self.bad_mark[nb as usize] == stamp {
                        continue;
                    }
                    let a = self.v[3 * t + (i + 1) % 3];
                    let b = self.v[3 * t + (i + 2) % 3];
                    let ex = self.x[b] - self.x[a];
                    let ey = self.y[b] - self.y[a];
                    let len2 = ex * ex + ey * ey;
                    if orient(self.x[a], self.y[a], self.x[b], self.y[b], px, py) <= 1e-10 * len2 {
                        self.bad_mark[nb as usize] = stamp;
                        bad.push(nb as usize);
                        grew = true;
                    }
                }
            }
        }
        // Boundary edges of the cavity, each giving a new triangle (a, b, p).
        // key (u, w) → (triangle, local index opposite)
        let mut edge_owner: HashMap<(usize, usize), (usize, usize)> = HashMap::new();
        self.created.clear();
        for &t in &bad {
            for i in 0..3 {
                let nb = self.n[3 * t + i];
                if nb >= 0 && self.bad_mark[nb as usize] == stamp {
                    continue;
                }
                let a = self.v[3 * t + (i + 1) % 3];
                let b = self.v[3 * t + (i + 2) % 3];
                // opposite a: edge (b, p); opposite b: edge (p, a); opposite p: edge (a, b)
                let nt = self.push_triangle(a, b, p, -1, -1, nb);
                self.created.push(nt);
                if nb >= 0 {
                    let nbu = nb as usize;
                    for j in 0..3 {
                        let u = self.v[3 * nbu + (j + 1) % 3];
                        let w = self.v[3 * nbu + (j + 2) % 3];
                        if u == b && w == a {
                            self.n[3 * nbu + j] = nt as i64;
                        }
                    }
                }
                self.vtri[a] = nt as i64;
                self.vtri[b] = nt as i64;
                self.vtri[p] = nt as i64;
                // Link the edges through p.
                for (u, w, local) in [(b, p, 0usize), (p, a, 1usize)] {
                    // the twin edge is oriented the other way
                    if let Some((ot, ol)) = edge_owner.remove(&(w, u)) {
                        self.n[3 * nt + local] = ot as i64;
                        self.n[3 * ot + ol] = nt as i64;
                    } else {
                        edge_owner.insert((u, w), (nt, local));
                    }
                }
            }
        }
        for &t in &bad {
            self.alive[t] = false;
        }
        self.hint = self.created[0];
        Ok(p)
    }

    /// A live triangle with the edge a–b, and the local index of its third vertex, or None.
    fn find_edge(&self, a: usize, b: usize) -> Option<(usize, usize)> {
        let start = self.vtri[a];
        if start < 0 || !self.alive[start as usize] {
            return self.find_edge_brute(a, b);
        }
        let start = start as usize;
        for dir in [1, 2] {
            let mut t = start;
            for _ in 0..1000 {
                let mut ia: i64 = -1;
                for i in 0..3 {
                    if self.v[3 * t + i] == a {
                        ia = i as i64;
                    }
                }
                if ia < 0 {
                    break;
                }
                let ia = ia as usize;
                let i1 = (ia + 1) % 3;
                let i2 = (ia + 2) % 3;
                if self.v[3 * t + i1] == b {
                    return Some((t, i2));
                }
                if self.v[3 * t + i2] == b {
                    return Some((t, i1));
                }
                // Rotate across the edge (a, v[i1]) (opposite i2) or (a, v[i2]) (opposite i1).
                let nb = self.n[3 * t + if dir == 1 { i2 } else { i1 }];
                if nb < 0 || nb as usize == start {
                    break;
                }
                t = nb as usize;
            }
        }
        self.find_edge_brute(a, b)
    }

    fn find_edge_brute(&self, a: usize, b: usize) -> Option<(usize, usize)> {
        for t in 0..self.alive.len() {
            if !self.alive[t] {
                continue;
            }
            let vs = [self.v[3 * t], self.v[3 * t + 1], self.v[3 * t + 2]];
            let ia = vs.iter().position(|&q| q == a);
            let ib = vs.iter().position(|&q| q == b);
            if let (Some(ia), Some(ib)) = (ia, ib) {
                return Some((t, 3 - ia - ib));
            }
        }
        None
    }
}

fn circumcentre(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> (f64, f64, f64) {
    let d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    let a2 = ax * ax + ay * ay;
    let b2 = bx * bx + by * by;
    let c2 = cx * cx + cy * cy;
    let ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    let uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    (ux, uy, dist(ax - ux, ay - uy))
}

/// Length of (dx, dy). The mesh uses only +, −, ×, / and √, which IEEE 754
/// rounds correctly, so that it is the same in every JavaScript engine;
/// Math.hypot, acos, log2 and ** may differ by an ulp between engines and
/// would change the mesh.
fn dist(dx: f64, dy: f64) -> f64 {
    (dx * dx + dy * dy).sqrt()
}

/// cos x by its Taylor series in correctly rounded arithmetic (|x| ≤ π/2).
fn cosine(x: f64) -> f64 {
    let mut term = 1.0;
    let mut sum = 1.0;
    for k in 1..=12 {
        let k = k as f64;
        term *= -(x * x) / ((2.0 * k - 1.0) * (2.0 * k));
        sum += term;
    }
    sum
}

/// Cosine of the smallest angle of a triangle (the angle opposite the shortest side, by the law of cosines).
fn min_angle_cos(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> f64 {
    let la = dist(bx - cx, by - cy);
    let lb = dist(ax - cx, ay - cy);
    let lc = dist(ax - bx, ay - by);
    let s = js::math::min(js::math::min(la, lb), lc);
    let (p, q) = if s == la {
        (lb, lc)
    } else if s == lb {
        (la, lc)
    } else {
        (la, lb)
    };
    (p * p + q * q - s * s) / (2.0 * p * q)
}

/// The state of the refinement: the triangulation and its constraint segments.
struct Mesher<'a> {
    dt: Delaunay,
    segments: Vec<(usize, usize)>,
    span: f64,
    tol: f64,
    min_size: f64,
    max_vertices: usize,
    input_verts: usize,
    is_input: Vec<u8>,
    capped: bool,
    size: &'a dyn Fn(f64, f64) -> f64,
}

impl Mesher<'_> {
    fn encroached_by(&self, s: (usize, usize), px: f64, py: f64) -> bool {
        let (a, b) = s;
        let dt = &self.dt;
        (dt.x[a] - px) * (dt.x[b] - px) + (dt.y[a] - py) * (dt.y[b] - py)
            < -1e-12 * self.span * self.span
    }

    fn seg_encroached(&self, s: (usize, usize)) -> bool {
        let (a, b) = s;
        let dt = &self.dt;
        let Some((t, _)) = dt.find_edge(a, b) else {
            return true;
        };
        // Apices of both triangles at the edge.
        let mut ts = vec![t];
        for i in 0..3 {
            let nb = dt.n[3 * t + i];
            let u = dt.v[3 * t + (i + 1) % 3];
            let w = dt.v[3 * t + (i + 2) % 3];
            if ((u == a && w == b) || (u == b && w == a)) && nb >= 0 {
                ts.push(nb as usize);
            }
        }
        for &tt in &ts {
            for i in 0..3 {
                let c = dt.v[3 * tt + i];
                if c == a || c == b || dt.is_super(c) {
                    continue;
                }
                if self.encroached_by(s, dt.x[c], dt.y[c]) {
                    return true;
                }
            }
        }
        false
    }

    fn input0(&self, v: usize) -> bool {
        v < self.input_verts && self.is_input[v] == 1
    }

    // Ruppert's concentric shells: a segment with an input vertex at one end
    // is split at a power-of-two distance from that vertex, so that the
    // subsegments around a small input angle end up equally long and stop
    // encroaching on each other.
    fn split_segment(&mut self, k: usize) -> Result<bool> {
        let (a, b) = self.segments[k];
        let len = {
            let dt = &self.dt;
            dist(dt.x[b] - dt.x[a], dt.y[b] - dt.y[a])
        };
        let mut t = 0.5;
        if self.input0(a) != self.input0(b) {
            // The power of two nearest to len/2 (in ratio): d ≤ len/2 < 2d, and
            // 2d if len/2 ≥ √2·d.
            let half = len / 2.0;
            let mut d = 1.0;
            while d * 2.0 <= half {
                d *= 2.0;
            }
            while d > half {
                d /= 2.0;
            }
            if half * half >= 2.0 * d * d {
                d *= 2.0;
            }
            let f = d / len;
            t = if self.input0(a) { f } else { 1.0 - f };
            #[allow(clippy::manual_range_contains)] // (NaN stays NaN, as in TypeScript)
            if t < 0.25 || t > 0.75 {
                t = 0.5;
            }
        }
        let (mx, my) = {
            let dt = &self.dt;
            (
                dt.x[a] + t * (dt.x[b] - dt.x[a]),
                dt.y[a] + t * (dt.y[b] - dt.y[a]),
            )
        };
        let m = self.dt.insert(mx, my, self.tol)?;
        // A segment within the merge tolerance of its length cannot be split.
        if m == a || m == b {
            return Ok(false);
        }
        self.segments[k] = (a, m);
        self.segments.push((m, b));
        Ok(true)
    }

    fn seg_length(&self, k: usize) -> f64 {
        let (a, b) = self.segments[k];
        dist(self.dt.x[b] - self.dt.x[a], self.dt.y[b] - self.dt.y[a])
    }

    fn recover_segments(&mut self) -> Result<()> {
        for _pass in 0..100000 {
            let mut any = false;
            let mut k = 0;
            while k < self.segments.len() {
                if self.dt.x.len() >= self.max_vertices {
                    self.capped = true;
                    return Ok(());
                }
                let (a, b) = self.segments[k];
                let missing = self.dt.find_edge(a, b).is_none();
                // A present but encroached segment is split only while it is longer
                // than the smallest size; a missing one is always split.
                if (missing
                    || (self.seg_length(k) > self.min_size
                        && self.seg_encroached(self.segments[k])))
                    && self.split_segment(k)?
                {
                    any = true;
                }
                k += 1;
            }
            if !any {
                return Ok(());
            }
        }
        Ok(())
    }
}

/// Mesh the domain. An error if the input is degenerate.
pub fn mesh_domain(input: &MeshInput) -> Result<TriMesh> {
    // A triangle is poor when its smallest angle is below min_angle, i.e. the
    // cosine of that angle is above cos(min_angle).
    let cos_min_angle = cosine((input.min_angle.unwrap_or(25.0) * std::f64::consts::PI) / 180.0);
    let max_vertices = input.max_vertices.unwrap_or(60000);
    let all: Vec<&Vec<[f64; 2]>> = std::iter::once(&input.boundary)
        .chain(input.segments.iter())
        .collect();
    let (mut xmin, mut ymin, mut xmax, mut ymax) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for line in &all {
        for &[px, py] in line.iter() {
            xmin = js::math::min(xmin, px);
            xmax = js::math::max(xmax, px);
            ymin = js::math::min(ymin, py);
            ymax = js::math::max(ymax, py);
        }
    }
    let span = js::math::max(xmax - xmin, ymax - ymin);
    let tol = 1e-9 * span;
    let mut dt = Delaunay::new(xmin, ymin, xmax, ymax);

    // Input vertices (deduplicated by the insertion) and segments between them.
    let mut segs: Vec<(usize, usize)> = Vec::new();
    let mut add_line = |dt: &mut Delaunay, pts: &[[f64; 2]], closed: bool| -> Result<()> {
        let mut ids = Vec::with_capacity(pts.len());
        for &[px, py] in pts {
            ids.push(dt.insert(px, py, tol)?);
        }
        let m = if closed {
            ids.len()
        } else {
            ids.len().saturating_sub(1)
        };
        for i in 0..m {
            let a = ids[i];
            let b = ids[(i + 1) % ids.len()];
            if a != b {
                segs.push((a, b));
            }
        }
        Ok(())
    };
    add_line(&mut dt, &input.boundary, true)?;
    for s in &input.segments {
        add_line(&mut dt, s, false)?;
    }

    // Crossing segments (a reinforcement line through a material boundary)
    // get a vertex at the crossing, so that both are split there below.
    {
        let n0 = segs.len();
        for i in 0..n0 {
            let (a, b) = segs[i];
            for &(c, d) in &segs[i + 1..n0] {
                if a == c || a == d || b == c || b == d {
                    continue;
                }
                let (ax, ay, bx, by) = (dt.x[a], dt.y[a], dt.x[b], dt.y[b]);
                let (cx, cy, dx, dy) = (dt.x[c], dt.y[c], dt.x[d], dt.y[d]);
                let den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
                if den.abs() < 1e-12 * span * span {
                    continue;
                }
                let t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
                let u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
                if t > 1e-9 && t < 1.0 - 1e-9 && u > 1e-9 && u < 1.0 - 1e-9 {
                    dt.insert(ax + t * (bx - ax), ay + t * (by - ay), tol)?;
                }
            }
        }
    }

    // Split every segment at input vertices lying on it, and drop duplicates.
    let input_verts = dt.x.len();
    let on_seg = |dt: &Delaunay, a: usize, b: usize, c: usize| -> f64 {
        let (ax, ay, bx, by, cx, cy) = (dt.x[a], dt.y[a], dt.x[b], dt.y[b], dt.x[c], dt.y[c]);
        let len2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
        let t = ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / len2;
        if t <= 1e-9 || t >= 1.0 - 1e-9 {
            return -1.0;
        }
        let d = orient(ax, ay, bx, by, cx, cy).abs() / len2.sqrt();
        if d <= 1e-7 * span {
            t
        } else {
            -1.0
        }
    };
    // (a Map keyed by the sorted pair: first insertion fixes the order, a later one the orientation)
    let mut seg_index: HashMap<(usize, usize), usize> = HashMap::new();
    let mut segments: Vec<(usize, usize)> = Vec::new();
    for &(a, b) in &segs {
        let mut pts: Vec<(f64, usize)> = Vec::new();
        for c in 3..input_verts {
            if c == a || c == b {
                continue;
            }
            let t = on_seg(&dt, a, b, c);
            if t > 0.0 {
                pts.push((t, c));
            }
        }
        js::array::sort_by(&mut pts, |p, q| p.0 - q.0);
        let mut chain = Vec::with_capacity(pts.len() + 2);
        chain.push(a);
        chain.extend(pts.iter().map(|p| p.1));
        chain.push(b);
        for i in 0..chain.len() - 1 {
            let (u, w) = (chain[i], chain[i + 1]);
            let key = if u < w { (u, w) } else { (w, u) };
            match seg_index.get(&key) {
                Some(&at) => segments[at] = (u, w),
                None => {
                    seg_index.insert(key, segments.len());
                    segments.push((u, w));
                }
            }
        }
    }

    // Smallest size for splitting for angle or encroachment: 1/8 of the
    // smallest target size, at any input vertex (boundary and constraint
    // lines) or as given by the size field (`size_min`), so that a fine region
    // inside the domain is not held at the boundary's size.
    let mut size0 = input.size_min.unwrap_or(f64::INFINITY);
    for line in &all {
        for &[px, py] in line.iter() {
            size0 = js::math::min(size0, (input.size)(px, py));
        }
    }
    let min_size = input.min_size.unwrap_or(size0 / 8.0);
    let boundary = &input.boundary;
    let inside_domain = |px: f64, py: f64| point_in_polygon(px, py, boundary);

    let mut is_input = vec![0u8; input_verts];
    for v in is_input.iter_mut().skip(3) {
        *v = 1;
    }
    let mut ms = Mesher {
        dt,
        segments,
        span,
        tol,
        min_size,
        max_vertices,
        input_verts,
        is_input,
        capped: false,
        size: input.size,
    };
    ms.recover_segments()?;

    // Refine poor and oversized triangles.
    let mut queue: Vec<usize> = (0..ms.dt.alive.len()).filter(|&t| ms.dt.alive[t]).collect();
    while !queue.is_empty() {
        if ms.dt.x.len() >= ms.max_vertices {
            ms.capped = true;
            break;
        }
        let t = queue.pop().expect("a queued triangle");
        if !ms.dt.alive[t] {
            continue;
        }
        let (a, b, c) = (ms.dt.v[3 * t], ms.dt.v[3 * t + 1], ms.dt.v[3 * t + 2]);
        if ms.dt.is_super(a) || ms.dt.is_super(b) || ms.dt.is_super(c) {
            continue;
        }
        let (xs, ys) = (&ms.dt.x, &ms.dt.y);
        let gx = (xs[a] + xs[b] + xs[c]) / 3.0;
        let gy = (ys[a] + ys[b] + ys[c]) / 3.0;
        if !inside_domain(gx, gy) {
            continue;
        }
        let (ux, uy, r) = circumcentre(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
        let max_edge = js::math::max(
            js::math::max(
                dist(xs[a] - xs[b], ys[a] - ys[b]),
                dist(xs[b] - xs[c], ys[b] - ys[c]),
            ),
            dist(xs[c] - xs[a], ys[c] - ys[a]),
        );
        let too_big = max_edge > 1.4 * (ms.size)(gx, gy);
        let too_thin = r > ms.min_size
            && min_angle_cos(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]) > cos_min_angle;
        if !too_big && !too_thin {
            continue;
        }
        let mut enc: Vec<usize> = Vec::new();
        let mut blocked = false;
        for k in 0..ms.segments.len() {
            if !ms.encroached_by(ms.segments[k], ux, uy) {
                continue;
            }
            if ms.seg_length(k) > ms.min_size {
                enc.push(k);
            } else {
                blocked = true;
            }
        }
        if blocked && enc.is_empty() {
            continue;
        }
        if !enc.is_empty() {
            let n0 = ms.dt.alive.len();
            let mut split = false;
            for &k in &enc {
                if ms.split_segment(k)? {
                    split = true;
                }
            }
            if !split {
                continue;
            }
            ms.recover_segments()?;
            // Only the triangles made by the splits are new; the rest were checked.
            for s in n0..ms.dt.alive.len() {
                if ms.dt.alive[s] {
                    queue.push(s);
                }
            }
            if ms.dt.alive[t] {
                queue.push(t);
            }
            continue;
        }
        if !inside_domain(ux, uy) {
            continue;
        }
        let before = ms.dt.x.len();
        ms.dt.insert(ux, uy, ms.tol)?;
        // The circumcentre merged with an existing vertex: nothing changed, and
        // re-queueing the triangle would loop.
        if ms.dt.x.len() == before {
            continue;
        }
        queue.extend_from_slice(&ms.dt.created);
        if ms.dt.alive[t] {
            queue.push(t);
        }
    }

    // Keep the triangles inside the domain.
    let dt = &ms.dt;
    let mut keep: Vec<usize> = Vec::new();
    for t in 0..dt.alive.len() {
        if !dt.alive[t] {
            continue;
        }
        let (a, b, c) = (dt.v[3 * t], dt.v[3 * t + 1], dt.v[3 * t + 2]);
        if dt.is_super(a) || dt.is_super(b) || dt.is_super(c) {
            continue;
        }
        let gx = (dt.x[a] + dt.x[b] + dt.x[c]) / 3.0;
        let gy = (dt.y[a] + dt.y[b] + dt.y[c]) / 3.0;
        if inside_domain(gx, gy) {
            keep.extend_from_slice(&[a, b, c]);
        }
    }
    // Compact the vertices (drop the super triangle and unused points).
    let mut map: Vec<i64> = vec![-1; dt.x.len()];
    let mut xs: Vec<f64> = Vec::new();
    let mut ys: Vec<f64> = Vec::new();
    let mut tri = vec![0usize; keep.len()];
    for (i, &v) in keep.iter().enumerate() {
        if map[v] < 0 {
            map[v] = xs.len() as i64;
            xs.push(dt.x[v]);
            ys.push(dt.y[v]);
        }
        tri[i] = map[v] as usize;
    }
    let missing_segments = ms
        .segments
        .iter()
        .filter(|&&(a, b)| dt.find_edge(a, b).is_none())
        .count();
    Ok(TriMesh {
        x: xs,
        y: ys,
        count: keep.len() / 3,
        tri,
        capped: ms.capped,
        missing_segments,
    })
}
