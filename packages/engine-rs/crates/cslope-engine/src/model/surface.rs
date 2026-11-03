//! Port of packages/engine/src/model/surface.ts
//!
//! Non-circular (polyline) slip surfaces.
//!
//! A polyline surface runs from the entry to the exit point with x strictly
//! increasing (canonical coordinates: the mass slides towards +x). Moment
//! equilibrium is taken about an axis point, which for a surface derived
//! from a circle is the circle centre.

use crate::js;
use crate::math::interpolation::get_y_at_x;
use crate::model::composite::unique_numbers;
use crate::model::geometry_ops::{polyline_y_from, Polyline, Side};
use crate::model::slope::Slope;
use std::collections::HashSet;
use std::f64::consts::PI;

/// A point `[x, y]`.
pub type Pt = [f64; 2];

/// y of the polyline at x (linear between vertices; NaN outside).
pub fn polyline_y_at(points: &[Pt], x: f64) -> f64 {
    let n = points.len();
    if n < 2 || x < points[0][0] || x > points[n - 1][0] {
        return f64::NAN;
    }
    for i in 0..n - 1 {
        let [ax, ay] = points[i];
        let [bx, by] = points[i + 1];
        if x <= bx {
            return if bx == ax {
                by
            } else {
                ay + ((x - ax) / (bx - ax)) * (by - ay)
            };
        }
    }
    points[n - 1][1]
}

/// x of every crossing between the polyline and the segments of a path
/// (closed: polygon, else polyline).
pub fn polyline_crossings_x(points: &[Pt], px: &[f64], py: &[f64], closed: bool) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::new();
    let m = px.len();
    let edges = if closed { m } else { m.saturating_sub(1) };
    for i in 0..points.len().saturating_sub(1) {
        let [ax, ay] = points[i];
        let [bx, by] = points[i + 1];
        for j in 0..edges {
            let cx = px[j];
            let cy = py[j];
            let dx = px[(j + 1) % m];
            let dy = py[(j + 1) % m];
            let den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
            if den.abs() < 1e-14 {
                continue;
            }
            let t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
            let u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
            if t >= -1e-12 && t <= 1.0 + 1e-12 && u >= -1e-12 && u <= 1.0 + 1e-12 {
                out.push(ax + t * (bx - ax));
            }
        }
    }
    out
}

/// Default axis point for moment equilibrium: the centre of the circle
/// through the entry, the exit and the deepest point of the surface below
/// their chord. For a planar surface (no depth below the chord) a point
/// above the chord midpoint at a distance of one chord length.
pub fn default_axis_point(points: &[Pt]) -> Pt {
    let a = points[0];
    let b = points[points.len() - 1];
    let len = js::math::hypot(&[b[0] - a[0], b[1] - a[1]]);
    // Unit normal of the chord pointing up (towards the sliding mass).
    let mut nx = -(b[1] - a[1]) / len;
    let mut ny = (b[0] - a[0]) / len;
    if ny < 0.0 {
        nx = -nx;
        ny = -ny;
    }
    let mut deepest = a;
    let mut depth = 0.0;
    for p in points {
        let d = -((p[0] - a[0]) * nx + (p[1] - a[1]) * ny);
        if d > depth {
            depth = d;
            deepest = *p;
        }
    }
    let mid: Pt = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    let fallback: Pt = [mid[0] + nx * len, mid[1] + ny * len];
    if depth < 1e-6 * len {
        return fallback;
    }
    // Circumcentre of a, b, deepest.
    let [x1, y1] = a;
    let [x2, y2] = b;
    let [x3, y3] = deepest;
    let d = 2.0 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    let s1 = x1 * x1 + y1 * y1;
    let s2 = x2 * x2 + y2 * y2;
    let s3 = x3 * x3 + y3 * y3;
    let centre: Pt = [
        (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d,
        (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d,
    ];
    // The axis must lie above the sliding mass: for deep or skewed surfaces
    // the circumcentre drops below the chord (tiny or negative shear arms).
    let above = (centre[0] - mid[0]) * nx + (centre[1] - mid[1]) * ny;
    if !(above > 0.25 * len)
        || js::math::hypot(&[centre[0] - mid[0], centre[1] - mid[1]]) > 10.0 * len
    {
        return fallback;
    }
    centre
}

/// Fit a user polyline to the ground: the surface starts where it first
/// passes from above to below the ground and ends where it comes out again.
/// End segments that stop below the ground are extended along their
/// direction until they reach it. Returns None if no sliding mass results.
pub fn fit_polyline_to_ground(slope: &Slope, input: &[Pt]) -> Option<Vec<Pt>> {
    let surf = slope.surface_line_xy()?;
    if input.len() < 2 {
        return None;
    }
    let mut pts: Vec<Pt> = input
        .iter()
        .filter(|p| p[0].is_finite() && p[1].is_finite())
        .copied()
        .collect();
    js::array::sort_by(&mut pts, |p, q| p[0] - q[0]);
    for i in 1..pts.len() {
        if pts[i][0] - pts[i - 1][0] < 1e-9 {
            return None;
        }
    }
    if pts.len() < 2 {
        return None;
    }
    let x_min = js::math::min_of(&surf.x);
    let x_max = js::math::max_of(&surf.x);
    let clamp = |x: f64| js::math::min(x_max, js::math::max(x_min, x));
    // Clamped: rounding can put an extended end a hair outside the model.
    let ground = |x: f64| get_y_at_x(&surf.x, &surf.y, clamp(x));
    // At a vertical face the ground has two heights; a point is below the
    // ground only below the lower one, and on it anywhere on the face.
    let sides = |x: f64| -> [f64; 2] {
        let xc = clamp(x);
        [
            polyline_y_from(&surf.x, &surf.y, xc, Side::Left),
            polyline_y_from(&surf.x, &surf.y, xc, Side::Right),
        ]
    };
    let below = |p: Pt| {
        let [l, r] = sides(p[0]);
        p[1] < js::math::min(l, r) - 1e-9
    };
    let on_ground = |p: Pt| {
        let [l, r] = sides(p[0]);
        p[1] >= js::math::min(l, r) - 1e-6 && p[1] <= js::math::max(l, r) + 1e-6
    };

    // Extend the end segments until they meet the ground.
    let extend = |p: Pt, q: Pt, towards_low: bool| -> Option<Pt> {
        // Walk from p away from q in steps until above ground or out of model.
        let dx = p[0] - q[0];
        let dy = p[1] - q[1];
        if (towards_low && dx >= 0.0) || (!towards_low && dx <= 0.0) {
            return None;
        }
        let limit = if towards_low { x_min } else { x_max };
        let t_max = (limit - p[0]) / dx;
        // An end point beyond the model edge (below the ground continued
        // there): the line comes in through the side of the model, not through
        // the ground. Walking back from it put an end point on the wrong side
        // of its neighbour and the polyline out of order.
        if !(t_max > 0.0) {
            return None;
        }
        let f = |t: f64| p[1] + t * dy - ground(p[0] + t * dx);
        if f(t_max) < 0.0 {
            return None;
        }
        let mut lo = 0.0;
        let mut hi = t_max;
        for _ in 0..60 {
            let mid = (lo + hi) / 2.0;
            if f(mid) < 0.0 {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        Some([clamp(p[0] + hi * dx), p[1] + hi * dy])
    };
    if below(pts[0]) {
        let e = extend(pts[0], pts[1], true)?;
        pts.insert(0, e);
    }
    let n = pts.len();
    if below(pts[n - 1]) {
        let e = extend(pts[n - 1], pts[n - 2], false)?;
        pts.push(e);
    }

    // Crossings with the ground: entry = first down-crossing, exit = the
    // next up-crossing. Kept within the polyline: for a polyline that ends
    // on the ground (e.g. one fitted before, as the reliability analysis
    // passes back) rounding can put the crossing a hair beyond the end
    // vertex, where the polyline has no height (NaN exit, surface dropped).
    let x_first = pts[0][0];
    let x_last = pts[pts.len() - 1][0];
    let mut crossings = unique_numbers(
        polyline_crossings_x(&pts, &surf.x, &surf.y, false)
            .into_iter()
            .map(|x| js::math::min(x_last, js::math::max(x_first, x))),
    );
    js::array::sort_by(&mut crossings, |p, q| p - q);
    let eps = 1e-6;
    let mut entry: Option<f64> = None;
    let mut exit: Option<f64> = None;
    let yb = |t: f64| polyline_y_at(&pts, t) - ground(t);
    for &x in &crossings {
        if entry.is_none() {
            if yb(x + eps) < 0.0 && !(yb(x - eps) < 0.0) {
                entry = Some(x);
            }
        } else if yb(x - eps) < 0.0 && !(yb(x + eps) < 0.0) {
            exit = Some(x);
            break;
        }
    }
    // A surface that starts or ends on the ground (e.g. at the foot of a
    // vertical wall, where the ground is double-valued) enters or leaves
    // there.
    let first = pts[0];
    let last = pts[pts.len() - 1];
    // On the polyline (at a vertical face the ground there is ambiguous).
    let mut entry_pt: Option<Pt> = entry.map(|e| [e, polyline_y_at(&pts, e)]);
    if entry_pt.is_none()
        && on_ground(first)
        && polyline_y_at(&pts, first[0] + eps) < ground(first[0] + eps)
    {
        entry = Some(first[0]);
        entry_pt = Some([first[0], first[1]]);
    }
    let mut exit_pt: Option<Pt> = exit.map(|e| [e, polyline_y_at(&pts, e)]);
    if entry.is_some()
        && exit_pt.is_none()
        && on_ground(last)
        && polyline_y_at(&pts, last[0] - eps) < ground(last[0] - eps)
    {
        exit = Some(last[0]);
        exit_pt = Some([last[0], last[1]]);
    }
    let (Some(entry), Some(exit), Some(entry_pt), Some(exit_pt)) = (entry, exit, entry_pt, exit_pt)
    else {
        return None;
    };
    if exit - entry < 1e-6 {
        return None;
    }
    let mut out: Vec<Pt> = vec![entry_pt];
    for p in &pts {
        if p[0] > entry + 1e-9 && p[0] < exit - 1e-9 {
            out.push([p[0], p[1]]);
        }
    }
    out.push(exit_pt);
    Some(out)
}

/// Kinematic and geometric admissibility of a polyline surface: x strictly
/// increasing, interior vertices below the ground and inside the model,
/// no segment above the ground, and concave (the base inclination never
/// increases towards the exit), within `concavity_tol_deg` (TypeScript's
/// default: 1).
pub fn is_admissible_polyline(slope: &Slope, points: &[Pt], concavity_tol_deg: f64) -> bool {
    let Some(surf) = slope.surface_line_xy() else {
        return false;
    };
    if points.len() < 2 {
        return false;
    }
    if !points.iter().all(|p| p[0].is_finite() && p[1].is_finite()) {
        return false;
    }
    let mut prev_alpha = f64::INFINITY;
    let tol = (concavity_tol_deg * PI) / 180.0;
    for i in 0..points.len() - 1 {
        let [ax, ay] = points[i];
        let [bx, by] = points[i + 1];
        if bx - ax < 1e-6 {
            return false;
        }
        let alpha = js::math::atan2(ay - by, bx - ax);
        if alpha > prev_alpha + tol {
            return false;
        }
        prev_alpha = alpha;
    }
    for &[x, y] in &points[1..points.len() - 1] {
        if !(y < get_y_at_x(&surf.x, &surf.y, x) - 1e-6) {
            return false;
        }
        if !slope.is_inside_external_boundary(x, y + 1e-6) {
            return false;
        }
    }
    // Between its vertices a segment must stay below the ground too: with
    // both ends below, it can only rise above it at a ground vertex (the
    // foot of a vertical face, a bench edge), so those are checked.
    for i in 0..points.len() - 1 {
        let [ax, ay] = points[i];
        let [bx, by] = points[i + 1];
        for k in 0..surf.x.len() {
            let gx = surf.x[k];
            if gx <= ax + 1e-9 || gx >= bx - 1e-9 {
                continue;
            }
            let seg_y = ay + ((gx - ax) / (bx - ax)) * (by - ay);
            if seg_y > surf.y[k] + 1e-6 {
                return false;
            }
        }
    }
    // Nor may it pass below the model: at a re-entrant corner of the base
    // both ends can be inside with the segment outside between them.
    if boundary_corner_in_mass(slope, points[0][0], points[points.len() - 1][0], |x| {
        polyline_y_at(points, x)
    }) {
        return false;
    }
    true
}

/// The part of the external boundary that is not ground: its corners and
/// its edges (an edge between two ground vertices is ground), with the
/// x-range of the ground and a length tolerance. Cached per slope
/// (`Slope::below_ground`, a WeakMap in TypeScript).
#[derive(Debug, Clone)]
pub struct BelowGround {
    corners: Vec<Pt>,
    edges: Vec<[Pt; 2]>,
    x_min: f64,
    x_max: f64,
    tol: f64,
}

fn below_ground_boundary<'a>(slope: &'a Slope, surf: &Polyline) -> &'a BelowGround {
    slope.below_ground.get_or_init(|| {
        let (bx, by) = slope.external_boundary_xy();
        let on_ground: HashSet<String> = surf
            .x
            .iter()
            .zip(&surf.y)
            .map(|(&x, &y)| format!("{},{}", js::num::to_string(x), js::num::to_string(y)))
            .collect();
        let ground: Vec<bool> = bx
            .iter()
            .zip(by)
            .map(|(&x, &y)| {
                on_ground.contains(&format!(
                    "{},{}",
                    js::num::to_string(x),
                    js::num::to_string(y)
                ))
            })
            .collect();
        let n = bx.len();
        let mut value = BelowGround {
            corners: Vec::new(),
            edges: Vec::new(),
            x_min: js::math::min_of(&surf.x),
            x_max: js::math::max_of(&surf.x),
            tol: 1e-6 * js::math::max(1.0, slope.model_height()),
        };
        for k in 0..n {
            if !ground[k] {
                value.corners.push([bx[k], by[k]]);
            }
            let j = (k + 1) % n;
            if !(ground[k] && ground[j]) {
                value.edges.push([[bx[k], by[k]], [bx[j], by[j]]]);
            }
        }
        value
    })
}

/// Strictly below the ground at x (at a vertical face below its lower end).
fn is_below_ground(surf: &Polyline, x: f64, y: f64, tol: f64) -> bool {
    y < js::math::min(
        polyline_y_from(&surf.x, &surf.y, x, Side::Left),
        polyline_y_from(&surf.x, &surf.y, x, Side::Right),
    ) - tol
}

/// True when a corner of the model's external boundary (other than one on
/// the ground) lies strictly inside the sliding mass, between the slip
/// surface `base_y` and the ground from x0 to x1. Next to any boundary point
/// lies ground outside the model, so the mass then is not wholly inside it:
/// the surface leaves the model, typically below a re-entrant corner of its
/// base, where the vertices of a polyline and samples along a circle can
/// all lie inside. For a polyline this is exact: a straight segment between
/// two points inside the model leaves it only around a corner.
pub fn boundary_corner_in_mass(
    slope: &Slope,
    x0: f64,
    x1: f64,
    base_y: impl Fn(f64) -> f64,
) -> bool {
    let Some(surf) = slope.surface_line_xy() else {
        return false;
    };
    let bg = below_ground_boundary(slope, surf);
    for &[x, y] in &bg.corners {
        if x <= x0 + 1e-9 || x >= x1 - 1e-9 || x <= bg.x_min || x >= bg.x_max {
            continue;
        }
        if y > base_y(x) + bg.tol && is_below_ground(surf, x, y, bg.tol) {
            return true;
        }
    }
    false
}

/// True when a circular surface from x0 to x1 passes outside the model:
/// a boundary corner lies in the sliding mass (boundary_corner_in_mass), or
/// a point of a boundary edge below the ground lies strictly inside the
/// circle. The second catches a circle that cuts a little below a sloping
/// base between the points sampled along it, where it touches no corner.
/// On a straight edge the points inside the circle, if any, include the
/// point nearest the centre, so that point decides.
pub fn circle_leaves_model(slope: &Slope, cx: f64, cy: f64, radius: f64, x0: f64, x1: f64) -> bool {
    let arc_y = |x: f64| {
        cy - js::math::max(0.0, js::math::pow(radius, 2.0) - js::math::pow(x - cx, 2.0)).sqrt()
    };
    if boundary_corner_in_mass(slope, x0, x1, arc_y) {
        return true;
    }
    let Some(surf) = slope.surface_line_xy() else {
        return false;
    };
    let bg = below_ground_boundary(slope, surf);
    let tol = bg.tol;
    let lo = x0 + 1e-9;
    let hi = x1 - 1e-9;
    for &[[ax, ay], [bx, by]] in &bg.edges {
        let dx = bx - ax;
        let dy = by - ay;
        // The part of the edge within the span, as a parameter range.
        let mut t0 = 0.0;
        let mut t1 = 1.0;
        if dx.abs() < 1e-12 {
            if ax <= lo || ax >= hi {
                continue;
            }
        } else {
            let ta = (lo - ax) / dx;
            let tb = (hi - ax) / dx;
            t0 = js::math::max(0.0, js::math::min(ta, tb));
            t1 = js::math::min(1.0, js::math::max(ta, tb));
            if t0 > t1 {
                continue;
            }
        }
        let len2 = dx * dx + dy * dy;
        if len2 == 0.0 {
            continue;
        }
        let t = js::math::min(
            t1,
            js::math::max(t0, ((cx - ax) * dx + (cy - ay) * dy) / len2),
        );
        let px = ax + t * dx;
        let py = ay + t * dy;
        if js::math::hypot(&[px - cx, py - cy]) >= radius - tol {
            continue;
        }
        if is_below_ground(surf, px, py, tol) {
            return true;
        }
    }
    false
}

/// Points of a circular arc between entry and exit as a polyline.
pub fn circle_to_polyline(
    cx: f64,
    cy: f64,
    radius: f64,
    lc: Pt,
    rc: Pt,
    vertices: usize,
) -> Vec<Pt> {
    let mut out: Vec<Pt> = vec![[lc[0], lc[1]]];
    let last = vertices as f64 - 1.0;
    let mut i = 1;
    while i + 1 < vertices {
        let x = lc[0] + ((rc[0] - lc[0]) * i as f64) / last;
        out.push([
            x,
            cy - js::math::max(0.0, js::math::pow(radius, 2.0) - js::math::pow(x - cx, 2.0)).sqrt(),
        ]);
        i += 1;
    }
    out.push([rc[0], rc[1]]);
    out
}
