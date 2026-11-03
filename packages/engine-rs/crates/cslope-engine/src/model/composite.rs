//! Port of packages/engine/src/model/composite.ts
//!
//! Composite circular slip surfaces: a circle that reaches impenetrable
//! material (bedrock) follows its top instead of entering it, and,
//! optionally (compositeBase), the base of the model likewise, as commercial
//! programs and the literature treat a circle on a firm base (Duncan &
//! Wright 2014, ch. 6: composite surfaces; the "lera på fast botten" of
//! Swedish practice). The part along the floor is a straight-based
//! polyline, analysed about the circle's centre with the moment arms of its
//! normal forces, as a non-circular surface.

use crate::js;
use crate::model::geometry_ops::Side;
use crate::types::geometry::GeometryWithMaterial;
use crate::types::material::Material;

/// A point `[x, y]`.
pub type Pt = [f64; 2];

/// The floor of the model: the base of the model and the impenetrable
/// regions stacked on it (bedrock), as a polyline from left to right.
/// A vertical step (the side of a rock step) is two points with the same x.
#[derive(Debug, Clone, PartialEq)]
pub struct CompositeFloor {
    pub pts: Vec<Pt>,
    /// The x ranges where the floor is the bare base of the model (no
    /// impenetrable material on it); empty when the base is followed
    /// (compositeBase). A circle below the floor there is not analysed.
    pub bare: Vec<[f64; 2]>,
}

/// The lowest and highest y where the vertical line at x crosses the
/// polygon's boundary; None when it does not. x must not be a vertex (the
/// callers query just beside the vertices).
fn vertical_range(px: &[f64], py: &[f64], x: f64) -> Option<[f64; 2]> {
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    let n = px.len();
    for i in 0..n {
        let j = if i + 1 == n { 0 } else { i + 1 };
        let xa = px[i];
        let xb = px[j];
        if xa == xb {
            continue;
        }
        if (x - xa) * (x - xb) > 0.0 {
            continue;
        }
        let y = py[i] + ((x - xa) / (xb - xa)) * (py[j] - py[i]);
        if y < lo {
            lo = y;
        }
        if y > hi {
            hi = y;
        }
    }
    if lo <= hi {
        Some([lo, hi])
    } else {
        None
    }
}

/// JavaScript `Set` membership of numbers (SameValueZero: -0 is 0, NaN is NaN).
pub(crate) fn same_value_zero(a: f64, b: f64) -> bool {
    a == b || (a.is_nan() && b.is_nan())
}

/// `[...new Set(xs)]`: the values in first-insertion order without repeats.
pub(crate) fn unique_numbers(xs: impl IntoIterator<Item = f64>) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::new();
    for x in xs {
        if !out.iter().any(|&v| same_value_zero(v, x)) {
            out.push(x);
        }
    }
    out
}

/// The floor of a model (see `CompositeFloor`). None when the boundary is
/// degenerate, or when there is nothing to follow (no impenetrable material
/// on the base and the base itself is not followed). `materials` is the
/// slope's material table that the geometries' ids index.
pub fn composite_floor(
    bx: &[f64],
    by: &[f64],
    geometries: &[GeometryWithMaterial],
    materials: &[Material],
    // Whether the bare base of the model is part of the floor (TypeScript's default: true).
    follow_base: bool,
) -> Option<CompositeFloor> {
    if bx.len() < 3 {
        return None;
    }
    let x0 = js::math::min_of(bx);
    let x1 = js::math::max_of(bx);
    if !(x1 > x0) {
        return None;
    }
    let rock: Vec<&GeometryWithMaterial> = geometries
        .iter()
        .filter(|g| materials[g.material.0 as usize].model.kind() == "impenetrable")
        .collect();
    let delta = 1e-9 * (x1 - x0);
    let mut ys: Vec<f64> = by.to_vec();
    for g in &rock {
        ys.extend_from_slice(&g.py);
    }
    let touch = 1e-6 * js::math::max(1.0, js::math::max_of(&ys) - js::math::min_of(&ys));

    // The floor at x: from the base of the model up through the impenetrable
    // regions stacked on it (each starting where the one below ends). A lens
    // or a wall of impenetrable material with soil below it is no floor: a
    // circle below it stays a circle.
    let floor_rock = |x: f64| -> (f64, bool) {
        let Some(b) = vertical_range(bx, by, x) else {
            return (f64::NAN, false);
        };
        let mut top = b[0];
        let ranges: Vec<[f64; 2]> = rock
            .iter()
            .filter_map(|g| vertical_range(&g.px, &g.py, x))
            .collect();
        let mut grew = true;
        while grew {
            grew = false;
            for &[lo, hi] in &ranges {
                if lo <= top + touch && hi > top + touch {
                    top = hi;
                    grew = true;
                }
            }
        }
        (top, top > b[0])
    };
    let floor_at = |x: f64| floor_rock(x).0;

    let mut xs_set: Vec<f64> = vec![x0, x1];
    xs_set.extend_from_slice(bx);
    for g in &rock {
        for &x in &g.px {
            if x > x0 && x < x1 {
                xs_set.push(x);
            }
        }
    }
    let mut xs = unique_numbers(xs_set);
    js::array::sort_by(&mut xs, |a, b| a - b);

    let mut pts: Vec<Pt> = Vec::new();
    let mut bare: Vec<[f64; 2]> = Vec::new();
    let mut rock_anywhere = false;
    let push = |pts: &mut Vec<Pt>, x: f64, y: f64| {
        if !y.is_finite() {
            return;
        }
        if let Some(last) = pts.last() {
            if (last[0] - x).abs() <= delta && (last[1] - y).abs() <= delta {
                return;
            }
        }
        pts.push([x, y]);
    };
    // Between the vertices every boundary is straight and the stack of
    // regions the same, so the floor is straight there.
    let mut k = 0;
    while k + 1 < xs.len() {
        let a = xs[k];
        let b = xs[k + 1];
        k += 1;
        if b - a <= 2.0 * delta {
            continue;
        }
        push(&mut pts, a, floor_at(a + delta));
        push(&mut pts, b, floor_at(b - delta));
        if floor_rock((a + b) / 2.0).1 {
            rock_anywhere = true;
        } else if !follow_base {
            match bare.last_mut() {
                Some(last) if last[1] == a => last[1] = b,
                _ => bare.push([a, b]),
            }
        }
    }
    if !follow_base && !rock_anywhere {
        return None;
    }
    if pts.len() >= 2 {
        Some(CompositeFloor { pts, bare })
    } else {
        None
    }
}

/// How far a circle may dip below the floor and still count as a circle
/// (tangent to it, to rounding): the same tolerance as the search's check
/// that a circle stays inside the model (search.ts), so that the circle the
/// search finds tangent to the base is analysed as a circle.
pub fn floor_dip_tolerance(model_height: f64) -> f64 {
    1e-6 * js::math::max(1.0, model_height)
}

/// Whether the circle (its lower arc between x0 and x1) goes below the
/// floor by more than `tol` where the floor is the bare base of the model
/// (not followed: the circle leaves the model there).
#[allow(clippy::too_many_arguments)]
pub fn circle_below_bare_base(
    floor: &CompositeFloor,
    cx: f64,
    cy: f64,
    radius: f64,
    x0: f64,
    x1: f64,
    tol: f64,
) -> bool {
    let arc = |x: f64| cy - js::math::max(0.0, radius * radius - (x - cx) * (x - cx)).sqrt();
    let p = &floor.pts;
    for &[u, v] in &floor.bare {
        let mut i = 0;
        while i + 1 < p.len() {
            let a = js::math::max(js::math::max(u, x0), p[i][0]);
            let b = js::math::min(js::math::min(v, x1), p[i + 1][0]);
            let [ax, ay] = p[i];
            let [bx, by] = p[i + 1];
            i += 1;
            if !(b > a) {
                continue;
            }
            // arc − floor is convex on a straight floor segment: its minimum by
            // golden-section search
            let gap = |x: f64| arc(x) - (ay + ((x - ax) / (bx - ax)) * (by - ay));
            let mut lo = a;
            let mut hi = b;
            let g = (5f64.sqrt() - 1.0) / 2.0;
            let mut k = 0;
            while k < 60 && hi - lo > 1e-12 * js::math::max(1.0, radius) {
                let m1 = hi - g * (hi - lo);
                let m2 = lo + g * (hi - lo);
                if gap(m1) < gap(m2) {
                    hi = m2;
                } else {
                    lo = m1;
                }
                k += 1;
            }
            if js::math::min(js::math::min(gap(a), gap(b)), gap((lo + hi) / 2.0)) < -tol {
                return true;
            }
        }
    }
    false
}

/// The floor's y at x from the given side of a step (NaN outside it);
/// TypeScript's default side is "left".
pub fn floor_y_at(floor: &CompositeFloor, x: f64, side: Side) -> f64 {
    let p = &floor.pts;
    let n = p.len();
    if n < 2 || x < p[0][0] || x > p[n - 1][0] {
        return f64::NAN;
    }
    if side == Side::Right {
        for i in (0..n - 1).rev() {
            let [ax, ay] = p[i];
            let [bx, by] = p[i + 1];
            if x >= ax && x <= bx {
                return if bx == ax {
                    by
                } else {
                    ay + ((x - ax) / (bx - ax)) * (by - ay)
                };
            }
        }
        return p[n - 1][1];
    }
    for i in 0..n - 1 {
        let [ax, ay] = p[i];
        let [bx, by] = p[i + 1];
        if x >= ax && x <= bx {
            return if bx == ax {
                ay
            } else {
                ay + ((x - ax) / (bx - ax)) * (by - ay)
            };
        }
    }
    p[n - 1][1]
}
