//! Robust geometric primitives of JTS as jsts 2.12.1 implements them:
//! coordinates and envelopes, the double-double orientation predicate
//! (`CGAlgorithmsDD`), the segment intersection point (`Intersection`),
//! `RobustLineIntersector`, the fixed `PrecisionModel`, quadrants and
//! octants, ray-crossing point location and ring orientation.
//!
//! Every function reproduces the jsts arithmetic operation by operation, so
//! that intersection points and predicates are bit for bit those of jsts.

use std::cmp::Ordering;

/// A JTS `Error` as far as the callers distinguish them: a
/// `RuntimeException` (topology and assertion failures, caught by
/// `SnapIfNeededOverlayOp`) or any other error (an `IllegalArgumentException`
/// or a JavaScript error, which pass through it).
#[derive(Debug, Clone, PartialEq)]
pub enum JtsError {
    Runtime(String),
    Other(String),
}

impl JtsError {
    pub fn message(&self) -> &str {
        match self {
            JtsError::Runtime(m) | JtsError::Other(m) => m,
        }
    }
}

pub type JtsResult<T> = Result<T, JtsError>;

/// `Assert.isTrue`: an `AssertionFailedException` (a runtime exception).
pub fn assert_true(cond: bool, message: &str) -> JtsResult<()> {
    if cond {
        Ok(())
    } else {
        Err(JtsError::Runtime(message.to_string()))
    }
}

/// A 2D coordinate; `==` is `Coordinate.equals2D`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coord {
    pub x: f64,
    pub y: f64,
}

impl Coord {
    pub const fn new(x: f64, y: f64) -> Coord {
        Coord { x, y }
    }

    /// `Coordinate.compareTo`: x first, then y.
    pub fn compare(&self, o: &Coord) -> Ordering {
        if self.x < o.x {
            return Ordering::Less;
        }
        if self.x > o.x {
            return Ordering::Greater;
        }
        if self.y < o.y {
            return Ordering::Less;
        }
        if self.y > o.y {
            return Ordering::Greater;
        }
        Ordering::Equal
    }

    /// `Coordinate.distance`.
    pub fn distance(&self, c: &Coord) -> f64 {
        let dx = self.x - c.x;
        let dy = self.y - c.y;
        (dx * dx + dy * dy).sqrt()
    }
}

pub use crate::js::math::{max as js_max, min as js_min, round as js_round};

/// A Java comparator result as the number a JS comparator returns.
pub fn cmp_num(o: Ordering) -> f64 {
    match o {
        Ordering::Less => -1.0,
        Ordering::Equal => 0.0,
        Ordering::Greater => 1.0,
    }
}

/// A JTS `Envelope` (never null here; a null envelope is an `Option`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Envelope {
    pub minx: f64,
    pub maxx: f64,
    pub miny: f64,
    pub maxy: f64,
}

impl Envelope {
    /// `new Envelope(p1, p2)`.
    pub fn of_points(p1: &Coord, p2: &Coord) -> Envelope {
        let (minx, maxx) = if p1.x < p2.x {
            (p1.x, p2.x)
        } else {
            (p2.x, p1.x)
        };
        let (miny, maxy) = if p1.y < p2.y {
            (p1.y, p2.y)
        } else {
            (p2.y, p1.y)
        };
        Envelope {
            minx,
            maxx,
            miny,
            maxy,
        }
    }

    /// The envelope of a coordinate list (`expandToInclude` per point), or
    /// `None` (a null envelope) for no points.
    pub fn of_coords(pts: &[Coord]) -> Option<Envelope> {
        let mut env: Option<Envelope> = None;
        for p in pts {
            match env.as_mut() {
                None => {
                    env = Some(Envelope {
                        minx: p.x,
                        maxx: p.x,
                        miny: p.y,
                        maxy: p.y,
                    });
                }
                Some(e) => e.expand_to_include(p.x, p.y),
            }
        }
        env
    }

    pub fn expand_to_include(&mut self, x: f64, y: f64) {
        if x < self.minx {
            self.minx = x;
        }
        if x > self.maxx {
            self.maxx = x;
        }
        if y < self.miny {
            self.miny = y;
        }
        if y > self.maxy {
            self.maxy = y;
        }
    }

    pub fn expand_to_include_env(&mut self, o: &Envelope) {
        if o.minx < self.minx {
            self.minx = o.minx;
        }
        if o.maxx > self.maxx {
            self.maxx = o.maxx;
        }
        if o.miny < self.miny {
            self.miny = o.miny;
        }
        if o.maxy > self.maxy {
            self.maxy = o.maxy;
        }
    }

    /// `Envelope.intersects(Envelope)`.
    pub fn intersects(&self, o: &Envelope) -> bool {
        !(o.minx > self.maxx || o.maxx < self.minx || o.miny > self.maxy || o.maxy < self.miny)
    }

    /// `Envelope.intersects(Coordinate a, Coordinate b)`: the box of a, b.
    pub fn intersects_segment(&self, a: &Coord, b: &Coord) -> bool {
        let envminx = if a.x < b.x { a.x } else { b.x };
        if envminx > self.maxx {
            return false;
        }
        let envmaxx = if a.x > b.x { a.x } else { b.x };
        if envmaxx < self.minx {
            return false;
        }
        let envminy = if a.y < b.y { a.y } else { b.y };
        if envminy > self.maxy {
            return false;
        }
        let envmaxy = if a.y > b.y { a.y } else { b.y };
        if envmaxy < self.miny {
            return false;
        }
        true
    }

    /// `Envelope.intersects(x, y)` (covers the point).
    pub fn intersects_point(&self, p: &Coord) -> bool {
        !(p.x > self.maxx || p.x < self.minx || p.y > self.maxy || p.y < self.miny)
    }

    /// `Envelope.contains(Envelope)` (= covers).
    pub fn contains(&self, o: &Envelope) -> bool {
        o.minx >= self.minx && o.maxx <= self.maxx && o.miny >= self.miny && o.maxy <= self.maxy
    }

    /// `Envelope.contains(Coordinate)` (= covers).
    pub fn contains_point(&self, p: &Coord) -> bool {
        p.x >= self.minx && p.x <= self.maxx && p.y >= self.miny && p.y <= self.maxy
    }

    pub fn width(&self) -> f64 {
        self.maxx - self.minx
    }

    pub fn height(&self) -> f64 {
        self.maxy - self.miny
    }
}

/// Static `Envelope.intersects(p1, p2, q)`: q in the box of p1, p2.
pub fn env_intersects_pt(p1: &Coord, p2: &Coord, q: &Coord) -> bool {
    q.x >= (if p1.x < p2.x { p1.x } else { p2.x })
        && q.x <= (if p1.x > p2.x { p1.x } else { p2.x })
        && q.y >= (if p1.y < p2.y { p1.y } else { p2.y })
        && q.y <= (if p1.y > p2.y { p1.y } else { p2.y })
}

/// Static `Envelope.intersects(p1, p2, q1, q2)`: the boxes of two segments.
pub fn env_intersects_seg(p1: &Coord, p2: &Coord, q1: &Coord, q2: &Coord) -> bool {
    let mut minq = js_min(q1.x, q2.x);
    let mut maxq = js_max(q1.x, q2.x);
    let mut minp = js_min(p1.x, p2.x);
    let mut maxp = js_max(p1.x, p2.x);
    if minp > maxq {
        return false;
    }
    if maxp < minq {
        return false;
    }
    minq = js_min(q1.y, q2.y);
    maxq = js_max(q1.y, q2.y);
    minp = js_min(p1.y, p2.y);
    maxp = js_max(p1.y, p2.y);
    if minp > maxq {
        return false;
    }
    if maxp < minq {
        return false;
    }
    true
}

// ── DD (double-double) arithmetic, the parts CGAlgorithmsDD uses ──

#[derive(Debug, Clone, Copy)]
struct DD {
    hi: f64,
    lo: f64,
}

const DD_SPLIT: f64 = 134217729.0;

impl DD {
    fn new(x: f64) -> DD {
        DD { hi: x, lo: 0.0 }
    }

    fn is_nan(&self) -> bool {
        self.hi.is_nan()
    }

    /// `selfAdd(double)`.
    fn self_add_f(&mut self, y: f64) -> &mut DD {
        let s_big = self.hi + y;
        let e = s_big - self.hi;
        let mut s = s_big - e;
        s = y - e + (self.hi - s);
        let f = s + self.lo;
        let h_big = s_big + f;
        let h = f + (s_big - h_big);
        self.hi = h_big + h;
        self.lo = h + (h_big - self.hi);
        self
    }

    /// `selfAdd(yhi, ylo)`.
    fn self_add(&mut self, yhi: f64, ylo: f64) -> &mut DD {
        let s_big = self.hi + yhi;
        let t_big = self.lo + ylo;
        let mut e = s_big - self.hi;
        let f = t_big - self.lo;
        let mut s = s_big - e;
        let mut t = t_big - f;
        s = yhi - e + (self.hi - s);
        t = ylo - f + (self.lo - t);
        e = s + t_big;
        let h_big = s_big + e;
        let h = e + (s_big - h_big);
        e = t + h;
        let zhi = h_big + e;
        let zlo = e + (h_big - zhi);
        self.hi = zhi;
        self.lo = zlo;
        self
    }

    /// `selfSubtract(DD)`.
    fn self_subtract(&mut self, y: &DD) -> &mut DD {
        if self.is_nan() {
            return self;
        }
        self.self_add(-y.hi, -y.lo)
    }

    /// `selfMultiply(DD)`.
    fn self_multiply(&mut self, y: &DD) -> &mut DD {
        let (yhi, ylo) = (y.hi, y.lo);
        let mut c_big = DD_SPLIT * self.hi;
        let mut hx = c_big - self.hi;
        let mut c = DD_SPLIT * yhi;
        hx = c_big - hx;
        let tx = self.hi - hx;
        let mut hy = c - yhi;
        c_big = self.hi * yhi;
        hy = c - hy;
        let ty = yhi - hy;
        c = hx * hy - c_big + hx * ty + tx * hy + tx * ty + (self.hi * ylo + self.lo * yhi);
        let zhi = c_big + c;
        hx = c_big - zhi;
        let zlo = c + hx;
        self.hi = zhi;
        self.lo = zlo;
        self
    }

    fn signum(&self) -> i32 {
        if self.hi > 0.0 {
            return 1;
        }
        if self.hi < 0.0 {
            return -1;
        }
        if self.lo > 0.0 {
            return 1;
        }
        if self.lo < 0.0 {
            return -1;
        }
        0
    }
}

fn signum(x: f64) -> i32 {
    if x > 0.0 {
        return 1;
    }
    if x < 0.0 {
        return -1;
    }
    0
}

const DP_SAFE_EPSILON: f64 = 1e-15;

/// `CGAlgorithmsDD.orientationIndexFilter`: the sign when it is certain
/// in double precision, else 2.
fn orientation_index_filter(pa: &Coord, pb: &Coord, pc: &Coord) -> i32 {
    let detsum;
    let detleft = (pa.x - pc.x) * (pb.y - pc.y);
    let detright = (pa.y - pc.y) * (pb.x - pc.x);
    let det = detleft - detright;
    if detleft > 0.0 {
        if detright <= 0.0 {
            return signum(det);
        } else {
            detsum = detleft + detright;
        }
    } else if detleft < 0.0 {
        if detright >= 0.0 {
            return signum(det);
        } else {
            detsum = -detleft - detright;
        }
    } else {
        return signum(det);
    }
    let errbound = DP_SAFE_EPSILON * detsum;
    if det >= errbound || -det >= errbound {
        return signum(det);
    }
    2
}

/// `Orientation.index` (= `CGAlgorithmsDD.orientationIndex`): 1 when q is
/// left of p1→p2, −1 right, 0 collinear.
pub fn orientation_index(p1: &Coord, p2: &Coord, q: &Coord) -> i32 {
    let index = orientation_index_filter(p1, p2, q);
    if index <= 1 {
        return index;
    }
    let mut dx1 = DD::new(p2.x);
    dx1.self_add_f(-p1.x);
    let mut dy1 = DD::new(p2.y);
    dy1.self_add_f(-p1.y);
    let mut dx2 = DD::new(q.x);
    dx2.self_add_f(-p2.x);
    let mut dy2 = DD::new(q.y);
    dy2.self_add_f(-p2.y);
    dx1.self_multiply(&dy2);
    dy1.self_multiply(&dx2);
    dx1.self_subtract(&dy1).signum()
}

/// `Orientation.isCCW(Coordinate[])`.
pub fn is_ccw(ring: &[Coord]) -> JtsResult<bool> {
    let n_pts = ring.len() as isize - 1;
    if n_pts < 3 {
        return Err(JtsError::Other(
            "Ring has fewer than 4 points, so orientation cannot be determined".into(),
        ));
    }
    let n = n_pts as usize;
    let mut hi_pt = ring[0];
    let mut hi_index = 0usize;
    for (i, p) in ring.iter().enumerate().take(n + 1).skip(1) {
        if p.y > hi_pt.y {
            hi_pt = *p;
            hi_index = i;
        }
    }
    let mut i_prev = hi_index;
    loop {
        i_prev = if i_prev == 0 { n } else { i_prev - 1 };
        if !(ring[i_prev] == hi_pt && i_prev != hi_index) {
            break;
        }
    }
    let mut i_next = hi_index;
    loop {
        i_next = (i_next + 1) % n;
        if !(ring[i_next] == hi_pt && i_next != hi_index) {
            break;
        }
    }
    let prev = ring[i_prev];
    let next = ring[i_next];
    if prev == hi_pt || next == hi_pt || prev == next {
        return Ok(false);
    }
    let disc = orientation_index(&prev, &hi_pt, &next);
    Ok(if disc == 0 { prev.x > next.x } else { disc > 0 })
}

/// `Intersection.intersection`: the intersection point of the two lines,
/// computed about the midpoint of the segments' envelope intersection, or
/// `None` when it is not finite.
pub fn intersection(p1: &Coord, p2: &Coord, q1: &Coord, q2: &Coord) -> Option<Coord> {
    let min_x0 = if p1.x < p2.x { p1.x } else { p2.x };
    let min_y0 = if p1.y < p2.y { p1.y } else { p2.y };
    let max_x0 = if p1.x > p2.x { p1.x } else { p2.x };
    let max_y0 = if p1.y > p2.y { p1.y } else { p2.y };
    let min_x1 = if q1.x < q2.x { q1.x } else { q2.x };
    let min_y1 = if q1.y < q2.y { q1.y } else { q2.y };
    let max_x1 = if q1.x > q2.x { q1.x } else { q2.x };
    let max_y1 = if q1.y > q2.y { q1.y } else { q2.y };
    let int_min_x = if min_x0 > min_x1 { min_x0 } else { min_x1 };
    let int_max_x = if max_x0 < max_x1 { max_x0 } else { max_x1 };
    let int_min_y = if min_y0 > min_y1 { min_y0 } else { min_y1 };
    let int_max_y = if max_y0 < max_y1 { max_y0 } else { max_y1 };
    let midx = (int_min_x + int_max_x) / 2.0;
    let midy = (int_min_y + int_max_y) / 2.0;
    let p1x = p1.x - midx;
    let p1y = p1.y - midy;
    let p2x = p2.x - midx;
    let p2y = p2.y - midy;
    let q1x = q1.x - midx;
    let q1y = q1.y - midy;
    let q2x = q2.x - midx;
    let q2y = q2.y - midy;
    let px = p1y - p2y;
    let py = p2x - p1x;
    let pw = p1x * p2y - p2x * p1y;
    let qx = q1y - q2y;
    let qy = q2x - q1x;
    let qw = q1x * q2y - q2x * q1y;
    let x = py * qw - qy * pw;
    let y = qx * pw - px * qw;
    let w = px * qy - qx * py;
    let x_int = x / w;
    let y_int = y / w;
    if !x_int.is_finite() || !y_int.is_finite() {
        return None;
    }
    Some(Coord::new(x_int + midx, y_int + midy))
}

/// `Distance.pointToSegment`.
pub fn point_to_segment(p: &Coord, a: &Coord, b: &Coord) -> f64 {
    if a.x == b.x && a.y == b.y {
        return p.distance(a);
    }
    let len2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
    let r = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2;
    if r <= 0.0 {
        return p.distance(a);
    }
    if r >= 1.0 {
        return p.distance(b);
    }
    let s = ((a.y - p.y) * (b.x - a.x) - (a.x - p.x) * (b.y - a.y)) / len2;
    s.abs() * len2.sqrt()
}

/// A fixed `PrecisionModel` (the floating model is `None` where used).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PrecisionModel {
    pub scale: f64,
}

impl PrecisionModel {
    /// `new PrecisionModel(scale)`: fixed, with |scale|.
    pub fn fixed(scale: f64) -> PrecisionModel {
        PrecisionModel { scale: scale.abs() }
    }

    pub fn make_precise_value(&self, val: f64) -> f64 {
        if val.is_nan() {
            return val;
        }
        js_round(val * self.scale) / self.scale
    }

    pub fn make_precise(&self, c: &mut Coord) {
        c.x = self.make_precise_value(c.x);
        c.y = self.make_precise_value(c.y);
    }
}

pub const NO_INTERSECTION: usize = 0;
pub const POINT_INTERSECTION: usize = 1;
pub const COLLINEAR_INTERSECTION: usize = 2;

/// `RobustLineIntersector` (with the state of `LineIntersector`).
#[derive(Debug, Clone)]
pub struct LineIntersector {
    pub result: usize,
    pub int_pt: [Coord; 2],
    pub input: [[Coord; 2]; 2],
    is_proper: bool,
    pub precision: Option<PrecisionModel>,
}

impl Default for LineIntersector {
    fn default() -> Self {
        LineIntersector::new(None)
    }
}

impl LineIntersector {
    pub fn new(precision: Option<PrecisionModel>) -> LineIntersector {
        let zero = Coord::new(0.0, 0.0);
        LineIntersector {
            result: 0,
            int_pt: [zero; 2],
            input: [[zero; 2]; 2],
            is_proper: false,
            precision,
        }
    }

    pub fn has_intersection(&self) -> bool {
        self.result != NO_INTERSECTION
    }

    pub fn is_proper(&self) -> bool {
        self.has_intersection() && self.is_proper
    }

    pub fn intersection_num(&self) -> usize {
        self.result
    }

    /// `LineIntersector.computeIntersection(p1, p2, p3, p4)`.
    pub fn compute_intersection(&mut self, p1: &Coord, p2: &Coord, p3: &Coord, p4: &Coord) {
        self.input = [[*p1, *p2], [*p3, *p4]];
        self.result = self.compute_intersect(p1, p2, p3, p4);
    }

    /// `isInteriorIntersection()`: an intersection point that is not an
    /// endpoint of both input segments.
    pub fn is_interior_intersection(&self) -> bool {
        self.is_interior_intersection_of(0) || self.is_interior_intersection_of(1)
    }

    fn is_interior_intersection_of(&self, input_line_index: usize) -> bool {
        for i in 0..self.result {
            let p = self.int_pt[i];
            if !(p == self.input[input_line_index][0] || p == self.input[input_line_index][1]) {
                return true;
            }
        }
        false
    }

    /// `isIntersection(pt)`.
    pub fn is_intersection(&self, pt: &Coord) -> bool {
        (0..self.result).any(|i| self.int_pt[i] == *pt)
    }

    /// `getEdgeDistance(segmentIndex, intIndex)`.
    pub fn edge_distance(&self, segment_index: usize, int_index: usize) -> JtsResult<f64> {
        compute_edge_distance(
            &self.int_pt[int_index],
            &self.input[segment_index][0],
            &self.input[segment_index][1],
        )
    }

    fn nearest_endpoint(p1: &Coord, p2: &Coord, q1: &Coord, q2: &Coord) -> Coord {
        let mut nearest = *p1;
        let mut min_dist = point_to_segment(p1, q1, q2);
        let mut dist = point_to_segment(p2, q1, q2);
        if dist < min_dist {
            min_dist = dist;
            nearest = *p2;
        }
        dist = point_to_segment(q1, p1, p2);
        if dist < min_dist {
            min_dist = dist;
            nearest = *q1;
        }
        dist = point_to_segment(q2, p1, p2);
        if dist < min_dist {
            nearest = *q2;
        }
        nearest
    }

    fn is_in_segment_envelopes(&self, p: &Coord) -> bool {
        let env0 = Envelope::of_points(&self.input[0][0], &self.input[0][1]);
        let env1 = Envelope::of_points(&self.input[1][0], &self.input[1][1]);
        env0.contains_point(p) && env1.contains_point(p)
    }

    /// The proper intersection point, rounded to the precision model.
    /// (jsts rounds an endpoint returned by `nearestEndpoint` in place, i.e.
    /// it alters the input coordinate; that happens only when the
    /// intersection of two properly crossing segments is not finite, and
    /// here only the copy is rounded.)
    fn intersection_point(&self, p1: &Coord, p2: &Coord, q1: &Coord, q2: &Coord) -> Coord {
        let mut int_pt = intersection(p1, p2, q1, q2)
            .unwrap_or_else(|| LineIntersector::nearest_endpoint(p1, p2, q1, q2));
        if !self.is_in_segment_envelopes(&int_pt) {
            int_pt = LineIntersector::nearest_endpoint(p1, p2, q1, q2);
        }
        if let Some(pm) = &self.precision {
            pm.make_precise(&mut int_pt);
        }
        int_pt
    }

    fn compute_collinear_intersection(
        &mut self,
        p1: &Coord,
        p2: &Coord,
        q1: &Coord,
        q2: &Coord,
    ) -> usize {
        let p1q1p2 = env_intersects_pt(p1, p2, q1);
        let p1q2p2 = env_intersects_pt(p1, p2, q2);
        let q1p1q2 = env_intersects_pt(q1, q2, p1);
        let q1p2q2 = env_intersects_pt(q1, q2, p2);
        if p1q1p2 && p1q2p2 {
            self.int_pt = [*q1, *q2];
            return COLLINEAR_INTERSECTION;
        }
        if q1p1q2 && q1p2q2 {
            self.int_pt = [*p1, *p2];
            return COLLINEAR_INTERSECTION;
        }
        if p1q1p2 && q1p1q2 {
            self.int_pt = [*q1, *p1];
            return if q1 == p1 && !p1q2p2 && !q1p2q2 {
                POINT_INTERSECTION
            } else {
                COLLINEAR_INTERSECTION
            };
        }
        if p1q1p2 && q1p2q2 {
            self.int_pt = [*q1, *p2];
            return if q1 == p2 && !p1q2p2 && !q1p1q2 {
                POINT_INTERSECTION
            } else {
                COLLINEAR_INTERSECTION
            };
        }
        if p1q2p2 && q1p1q2 {
            self.int_pt = [*q2, *p1];
            return if q2 == p1 && !p1q1p2 && !q1p2q2 {
                POINT_INTERSECTION
            } else {
                COLLINEAR_INTERSECTION
            };
        }
        if p1q2p2 && q1p2q2 {
            self.int_pt = [*q2, *p2];
            return if q2 == p2 && !p1q1p2 && !q1p1q2 {
                POINT_INTERSECTION
            } else {
                COLLINEAR_INTERSECTION
            };
        }
        NO_INTERSECTION
    }

    fn compute_intersect(&mut self, p1: &Coord, p2: &Coord, q1: &Coord, q2: &Coord) -> usize {
        self.is_proper = false;
        if !env_intersects_seg(p1, p2, q1, q2) {
            return NO_INTERSECTION;
        }
        let pq1 = orientation_index(p1, p2, q1);
        let pq2 = orientation_index(p1, p2, q2);
        if (pq1 > 0 && pq2 > 0) || (pq1 < 0 && pq2 < 0) {
            return NO_INTERSECTION;
        }
        let qp1 = orientation_index(q1, q2, p1);
        let qp2 = orientation_index(q1, q2, p2);
        if (qp1 > 0 && qp2 > 0) || (qp1 < 0 && qp2 < 0) {
            return NO_INTERSECTION;
        }
        let collinear = pq1 == 0 && pq2 == 0 && qp1 == 0 && qp2 == 0;
        if collinear {
            return self.compute_collinear_intersection(p1, p2, q1, q2);
        }
        if pq1 == 0 || pq2 == 0 || qp1 == 0 || qp2 == 0 {
            self.is_proper = false;
            if p1 == q1 || p1 == q2 {
                self.int_pt[0] = *p1;
            } else if p2 == q1 || p2 == q2 {
                self.int_pt[0] = *p2;
            } else if pq1 == 0 {
                self.int_pt[0] = *q1;
            } else if pq2 == 0 {
                self.int_pt[0] = *q2;
            } else if qp1 == 0 {
                self.int_pt[0] = *p1;
            } else if qp2 == 0 {
                self.int_pt[0] = *p2;
            }
        } else {
            self.is_proper = true;
            self.int_pt[0] = self.intersection_point(p1, p2, q1, q2);
        }
        POINT_INTERSECTION
    }
}

/// `LineIntersector.computeEdgeDistance`: a cheap monotone measure of the
/// position of p along p0→p1.
pub fn compute_edge_distance(p: &Coord, p0: &Coord, p1: &Coord) -> JtsResult<f64> {
    let dx = (p1.x - p0.x).abs();
    let dy = (p1.y - p0.y).abs();
    let mut dist;
    if p == p0 {
        dist = 0.0;
    } else if p == p1 {
        dist = if dx > dy { dx } else { dy };
    } else {
        let pdx = (p.x - p0.x).abs();
        let pdy = (p.y - p0.y).abs();
        dist = if dx > dy { pdx } else { pdy };
        if dist == 0.0 && p != p0 {
            dist = js_max(pdx, pdy);
        }
    }
    assert_true(!(dist == 0.0 && p != p0), "Bad distance calculation")?;
    Ok(dist)
}

/// `Quadrant.quadrant(p0, p1)`: NE 0, NW 1, SW 2, SE 3.
pub fn quadrant(p0: &Coord, p1: &Coord) -> JtsResult<i32> {
    if p1.x == p0.x && p1.y == p0.y {
        return Err(JtsError::Other(format!(
            "Cannot compute the quadrant for two identical points {}",
            fmt_coord(p0)
        )));
    }
    Ok(quadrant_of(p1.x >= p0.x, p1.y >= p0.y))
}

/// `Quadrant.quadrant(dx, dy)`.
pub fn quadrant_dxdy(dx: f64, dy: f64) -> JtsResult<i32> {
    if dx == 0.0 && dy == 0.0 {
        return Err(JtsError::Other(format!(
            "Cannot compute the quadrant for point ( {}, {} )",
            crate::js::num::to_string(dx),
            crate::js::num::to_string(dy)
        )));
    }
    Ok(quadrant_of(dx >= 0.0, dy >= 0.0))
}

fn quadrant_of(east: bool, north: bool) -> i32 {
    match (east, north) {
        (true, true) => 0,
        (true, false) => 3,
        (false, true) => 1,
        (false, false) => 2,
    }
}

/// `Octant.octant(p0, p1)` (the caller guards identical points).
pub fn octant(p0: &Coord, p1: &Coord) -> i32 {
    let dx = p1.x - p0.x;
    let dy = p1.y - p0.y;
    let adx = dx.abs();
    let ady = dy.abs();
    if dx >= 0.0 {
        if dy >= 0.0 {
            if adx >= ady {
                0
            } else {
                1
            }
        } else if adx >= ady {
            7
        } else {
            6
        }
    } else if dy >= 0.0 {
        if adx >= ady {
            3
        } else {
            2
        }
    } else if adx >= ady {
        4
    } else {
        5
    }
}

/// `Coordinate.toString()` of a 2D coordinate: `(x, y, NaN)`, numbers as
/// JavaScript prints them.
pub fn fmt_coord(c: &Coord) -> String {
    format!(
        "({}, {}, NaN)",
        crate::js::num::to_string(c.x),
        crate::js::num::to_string(c.y)
    )
}

/// `Location`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Location {
    Interior,
    Boundary,
    Exterior,
}

/// `RayCrossingCounter.locatePointInRing(p, Coordinate[])`.
pub fn locate_point_in_ring(p: &Coord, ring: &[Coord]) -> Location {
    let mut crossing_count = 0usize;
    for i in 1..ring.len() {
        let p1 = &ring[i];
        let p2 = &ring[i - 1];
        // countSegment(p1, p2)
        if p1.x < p.x && p2.x < p.x {
            continue;
        }
        if p.x == p2.x && p.y == p2.y {
            return Location::Boundary;
        }
        if p1.y == p.y && p2.y == p.y {
            let mut minx = p1.x;
            let mut maxx = p2.x;
            if minx > maxx {
                minx = p2.x;
                maxx = p1.x;
            }
            if p.x >= minx && p.x <= maxx {
                return Location::Boundary;
            }
            continue;
        }
        if (p1.y > p.y && p2.y <= p.y) || (p2.y > p.y && p1.y <= p.y) {
            let mut orient = orientation_index(p1, p2, p);
            if orient == 0 {
                return Location::Boundary;
            }
            if p2.y < p1.y {
                orient = -orient;
            }
            if orient == 1 {
                crossing_count += 1;
            }
        }
    }
    if crossing_count % 2 == 1 {
        Location::Interior
    } else {
        Location::Exterior
    }
}

/// `PointLocator.locate(p, polygon)` for a polygon of one ring: exterior
/// outside the ring's envelope, else by ray crossing.
pub fn locate_in_polygon_ring(p: &Coord, ring: &[Coord]) -> Location {
    match Envelope::of_coords(ring) {
        None => Location::Exterior,
        Some(env) if !env.intersects_point(p) => Location::Exterior,
        Some(_) => locate_point_in_ring(p, ring),
    }
}

/// `Area.ofRingSigned` (the coordinate sequence form `Polygon.getArea`
/// uses; the arithmetic is that of the array form).
pub fn area_of_ring_signed(ring: &[Coord]) -> f64 {
    let n = ring.len();
    if n < 3 {
        return 0.0;
    }
    let x0 = ring[0].x;
    let mut p0y;
    let mut p1 = ring[0];
    let mut p2 = Coord::new(ring[1].x - x0, ring[1].y);
    let mut sum = 0.0;
    for r in ring.iter().take(n).skip(2) {
        p0y = p1.y;
        p1 = p2;
        p2 = Coord::new(r.x - x0, r.y);
        sum += p1.x * (p0y - p2.y);
    }
    sum / 2.0
}

/// `CoordinateArrays.removeRepeatedPoints` (consecutive duplicates).
pub fn remove_repeated_points(coords: &[Coord]) -> Vec<Coord> {
    let mut out: Vec<Coord> = Vec::with_capacity(coords.len());
    for c in coords {
        if out.last() != Some(c) {
            out.push(*c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orientation_is_exact_near_collinear() {
        let p1 = Coord::new(0.1, 0.1);
        let p2 = Coord::new(0.3, 0.3);
        let q = Coord::new(0.2, 0.2);
        // 0.2 is not exactly between in binary; the DD sign is not 0 or is
        assert!(orientation_index(&p1, &p2, &q).abs() <= 1);
        assert_eq!(
            orientation_index(
                &Coord::new(0., 0.),
                &Coord::new(1., 0.),
                &Coord::new(2., 1.)
            ),
            1
        );
        assert_eq!(
            orientation_index(
                &Coord::new(0., 0.),
                &Coord::new(1., 0.),
                &Coord::new(2., 0.)
            ),
            0
        );
    }
}
