//! Port of packages/engine/src/model/geometry-ops.ts
//!
//! Geometry operations for slope analysis.
//!
//! The TypeScript file uses jsts (the JavaScript port of the JTS Topology
//! Suite) to split polygons and to cut the slope into regions. jsts is
//! replaced by `jts`, a self-contained port of exactly the jsts 2.12.1 code
//! paths used here (snap-rounding noding, the overlay union of linework,
//! the polygonizer, interior points and point location), with the same
//! arithmetic and iteration orders, so that the faces, their order, start
//! vertices and holes are those of jsts.

pub mod jts;

use crate::error::EngineError;
use crate::js;
use crate::math::interpolation::get_y_at_x;
use jts::algorithm::{locate_in_polygon_ring, Coord, JtsResult, Location};
use serde::{Deserialize, Serialize};

/// A point `[x, y]`.
pub type Pt = [f64; 2];

/// A polygon piece as x and y arrays.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PolygonXY {
    pub px: Vec<f64>,
    pub py: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPolygonResult {
    pub pieces: Vec<PolygonXY>,
    pub split_failed: bool,
}

/// A polyline as x and y arrays.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Polyline {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
}

/// Which side of x a polyline is approached from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}

// ── Line-segment intersection ─────────────────────────────────────

/// Compute the intersection point of two line segments, if any.
///
/// Uses parametric form: P = p1 + t*(p2 - p1), Q = p3 + u*(p4 - p3)
/// Returns the intersection point if 0 ≤ t ≤ 1 and 0 ≤ u ≤ 1.
#[allow(clippy::too_many_arguments)]
pub fn line_segment_intersection(
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    x3: f64,
    y3: f64,
    x4: f64,
    y4: f64,
) -> Option<Pt> {
    let dx1 = x2 - x1;
    let dy1 = y2 - y1;
    let dx2 = x4 - x3;
    let dy2 = y4 - y3;
    let denom = dx1 * dy2 - dy1 * dx2;

    if denom.abs() < 1e-12 {
        return None; // parallel / collinear
    }

    let t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / denom;
    let u = ((x3 - x1) * dy1 - (y3 - y1) * dx1) / denom;

    // (comparisons, not ranges: a NaN t or u passes, as in TS)
    #[allow(clippy::manual_range_contains)]
    if t < -1e-9 || t > 1.0 + 1e-9 || u < -1e-9 || u > 1.0 + 1e-9 {
        return None;
    }

    Some([x1 + t * dx1, y1 + t * dy1])
}

// ── Polyline Y-interpolation (for splitting) ──────────────────────

/// Get the y-value of a polyline at a given x-coordinate.
/// Returns `None` (TS `undefined`) if x is outside the polyline's x-range.
pub fn polyline_y_at_x(lx: &[f64], ly: &[f64], x: f64) -> Option<f64> {
    let n = lx.len();
    if n == 0 {
        return None; // TS: undefined bounds, no segment
    }
    let x_min = if lx[0] <= lx[n - 1] { lx[0] } else { lx[n - 1] };
    let x_max = if lx[0] >= lx[n - 1] { lx[0] } else { lx[n - 1] };
    if x < x_min - 1e-9 || x > x_max + 1e-9 {
        return None;
    }

    for i in 0..n.saturating_sub(1) {
        let seg_x_min = js::math::min(lx[i], lx[i + 1]);
        let seg_x_max = js::math::max(lx[i], lx[i + 1]);
        if x >= seg_x_min - 1e-9 && x <= seg_x_max + 1e-9 {
            let (y0, y1) = (at(ly, i), at(ly, i + 1));
            if (lx[i + 1] - lx[i]).abs() < 1e-12 {
                return Some((y0 + y1) / 2.0);
            }
            let t = (x - lx[i]) / (lx[i + 1] - lx[i]);
            return Some(y0 + t * (y1 - y0));
        }
    }
    None
}

// ── getSurfaceLine ────────────────────────────────────────────────

/// Horizontal run per unit rise up to which an end side of the model counts
/// as vertical (1:100, about 0.6° from the vertical).
pub const VERTICAL_SIDE_SLOPE: f64 = 0.01;

/// The top of the vertical side of the model at an end vertex of the
/// polygon (the first `n` vertices, open): from `idx`, up every boundary edge
/// that rises and runs at most `VERTICAL_SIDE_SLOPE` per unit rise, in
/// either direction around the polygon. `idx` itself when no edge from it
/// is such a side.
fn top_of_vertical_side(px: &[f64], py: &[f64], n: usize, idx: usize) -> usize {
    let steep_rise = |from: usize, to: usize| {
        let dy = at(py, to) - at(py, from);
        dy > 0.0 && (px[to] - px[from]).abs() <= VERTICAL_SIDE_SLOPE * dy
    };
    for step in [1, n - 1] {
        let mut top = idx;
        let mut moved = false;
        // (at most n − 1 edges: the polygon cannot be all side)
        for _ in 0..n - 1 {
            let next = (top + step) % n;
            if !steep_rise(top, next) {
                break;
            }
            top = next;
            moved = true;
        }
        if moved {
            return top;
        }
    }
    idx
}

/// Extract the upper (surface) boundary of a polygon.
///
/// Replaces `utilities.get_surface_line(Polygon)`.
///
/// Algorithm:
/// 1. Find the leftmost (min-x, max-y) and rightmost (max-x, max-y) vertices.
/// 2. Walk the polygon boundary in both directions between these vertices.
/// 3. Return the path with the higher average y (= upper boundary).
///
/// `px`, `py`: polygon coordinates (may be closed or open). Returns the
/// surface line as sorted x, y arrays.
pub fn get_surface_line(px: &[f64], py: &[f64]) -> Result<Polyline, EngineError> {
    let mut n = px.len();
    if n < 3 {
        return Err(EngineError::new("Polygon must have at least 3 vertices"));
    }

    // Remove closing vertex if present
    if (px[0] - px[n - 1]).abs() < 1e-12 && (at(py, 0) - at(py, n - 1)).abs() < 1e-12 {
        n -= 1;
    }

    // Find leftmost vertex (min x, tie-break max y)
    let mut left_idx = 0;
    for i in 1..n {
        if px[i] < px[left_idx] || (px[i] == px[left_idx] && at(py, i) > at(py, left_idx)) {
            left_idx = i;
        }
    }

    // Find rightmost vertex (max x, tie-break max y)
    let mut right_idx = 0;
    for i in 1..n {
        if px[i] > px[right_idx] || (px[i] == px[right_idx] && at(py, i) > at(py, right_idx)) {
            right_idx = i;
        }
    }

    // A side of the model that is vertical but for drawing or rounding
    // error (a model rotated by 0.005° or drawn without snapping) is not
    // ground either: from an end vertex below it, the end moves up the side.
    // Otherwise a side leaning out by a fraction of a millimetre put its
    // bottom corner at the extreme x, and the whole side, an artificial cut,
    // in the ground line: the search took circles entering or leaving the
    // model through it (one reaching the bottom corner was critical).
    // (not in a polygon narrower than a hundredth of its height, all side)
    let (left_idx, right_idx) = match (
        top_of_vertical_side(px, py, n, left_idx),
        top_of_vertical_side(px, py, n, right_idx),
    ) {
        (l, r) if l != r => (l, r),
        _ => (left_idx, right_idx),
    };

    // Walk forward from leftIdx → rightIdx
    let mut fwd_x = Vec::new();
    let mut fwd_y = Vec::new();
    let mut idx = left_idx;
    loop {
        fwd_x.push(px[idx]);
        fwd_y.push(at(py, idx));
        if idx == right_idx {
            break;
        }
        idx = (idx + 1) % n;
    }

    // Walk backward from leftIdx → rightIdx
    let mut bwd_x = Vec::new();
    let mut bwd_y = Vec::new();
    idx = left_idx;
    loop {
        bwd_x.push(px[idx]);
        bwd_y.push(at(py, idx));
        if idx == right_idx {
            break;
        }
        idx = (idx + n - 1) % n;
    }

    // Pick the path with higher average y (= surface).  Average over x,
    // not over vertices: a densely digitised stretch must not outweigh the
    // rest of the path.
    let avg_fwd = average_y_over_x(&fwd_x, &fwd_y);
    let avg_bwd = average_y_over_x(&bwd_x, &bwd_y);

    Ok(if avg_fwd >= avg_bwd {
        Polyline { x: fwd_x, y: fwd_y }
    } else {
        Polyline { x: bwd_x, y: bwd_y }
    })
}

// ── clipLineToSurface ─────────────────────────────────────────────

/// Y-value of a polyline at x, approached from one side.
///
/// Only non-vertical segments are considered, so at a vertical step the
/// "left" and "right" values differ.  Returns NaN when no segment on that
/// side contains x.
pub fn polyline_y_at_side(px: &[f64], py: &[f64], x: f64, side: Side) -> f64 {
    for i in 0..px.len().saturating_sub(1) {
        let a = js::math::min(px[i], px[i + 1]);
        let b = js::math::max(px[i], px[i + 1]);
        if b - a < 1e-12 {
            continue;
        }
        let inside = if side == Side::Left {
            a < x && x <= b
        } else {
            a <= x && x < b
        };
        if inside {
            let t = (x - px[i]) / (px[i + 1] - px[i]);
            return at(py, i) + t * (at(py, i + 1) - at(py, i));
        }
    }
    f64::NAN
}

/// y of a polyline at x approached from one side (at a vertical step the
/// two sides differ), or its plain value where that side has no segment.
pub fn polyline_y_from(px: &[f64], py: &[f64], x: f64, side: Side) -> f64 {
    let y = polyline_y_at_side(px, py, x, side);
    if y.is_finite() {
        y
    } else if py.len() < px.len() {
        // (getYAtX reads the missing y values as undefined: NaN)
        let padded: Vec<f64> = (0..px.len()).map(|i| at(py, i)).collect();
        get_y_at_x(px, &padded, x)
    } else {
        get_y_at_x(px, py, x)
    }
}

/// Clip a phreatic / piezometric line so that it never rises above the
/// ground surface: returns the pointwise minimum of the two polylines over
/// their common x-range, including the points where they cross.
///
/// Returns the clipped line, or `None` when the x-ranges do not overlap.
pub fn clip_line_to_surface(wx: &[f64], wy: &[f64], sx: &[f64], sy: &[f64]) -> Option<Polyline> {
    if wx.len() < 2 || sx.len() < 2 {
        return None;
    }
    let lo = js::math::max(js::math::min_of(wx), js::math::min_of(sx));
    let hi = js::math::min(js::math::max_of(wx), js::math::max_of(sx));
    #[allow(clippy::neg_cmp_op_on_partial_ord)] // NaN: no overlap
    if !(hi - lo > 1e-12) {
        return None;
    }

    let mut sorted: Vec<f64> = wx
        .iter()
        .chain(sx.iter())
        .copied()
        .chain([lo, hi])
        .filter(|&x| x >= lo && x <= hi)
        .collect();
    js::array::sort_by(&mut sorted, |a, b| a - b);
    let breaks: Vec<f64> = (0..sorted.len())
        .filter(|&i| i == 0 || sorted[i] - sorted[i - 1] > 1e-9)
        .map(|i| sorted[i])
        .collect();

    let eval_side = |px: &[f64], py: &[f64], x: f64, side: Side| {
        let v = polyline_y_at_side(px, py, x, side);
        if v.is_finite() {
            v
        } else {
            polyline_y_at_side(
                px,
                py,
                x,
                if side == Side::Left {
                    Side::Right
                } else {
                    Side::Left
                },
            )
        }
    };

    let mut out_x: Vec<f64> = Vec::new();
    let mut out_y: Vec<f64> = Vec::new();
    let mut push = |x: f64, y: f64| {
        let n = out_x.len();
        if n > 0 && (out_x[n - 1] - x).abs() < 1e-9 && (out_y[n - 1] - y).abs() < 1e-9 {
            return;
        }
        out_x.push(x);
        out_y.push(y);
    };

    let mut prev_x = f64::NAN;
    let mut prev_diff = f64::NAN;
    for &x in &breaks {
        let w_l = eval_side(wx, wy, x, Side::Left);
        let w_r = eval_side(wx, wy, x, Side::Right);
        let s_l = eval_side(sx, sy, x, Side::Left);
        let s_r = eval_side(sx, sy, x, Side::Right);

        // Crossing strictly between the previous breakpoint and this one.
        let diff_l = w_l - s_l;
        if prev_diff.is_finite() && prev_diff * diff_l < 0.0 {
            let xc = prev_x + ((x - prev_x) * prev_diff) / (prev_diff - diff_l);
            push(xc, eval_side(wx, wy, xc, Side::Right));
        }

        push(x, js::math::min(w_l, s_l));
        push(x, js::math::min(w_r, s_r));
        prev_x = x;
        prev_diff = w_r - s_r;
    }

    if out_x.len() >= 2 {
        Some(Polyline { x: out_x, y: out_y })
    } else {
        None
    }
}

/// Mean y of a path weighted by horizontal extent (vertex mean if vertical).
fn average_y_over_x(px: &[f64], py: &[f64]) -> f64 {
    let mut area = 0.0;
    let mut span = 0.0;
    for i in 0..px.len().saturating_sub(1) {
        let dx = (px[i + 1] - px[i]).abs();
        area += ((py[i] + py[i + 1]) / 2.0) * dx;
        span += dx;
    }
    if span > 1e-12 {
        return area / span;
    }
    js::array::sum(py.iter().copied()) / py.len() as f64
}

// ── splitPolygonByPolyline (jsts replaced by `jts`) ───────────────

/// `px.map((x, i) => new Coordinate(x, py[i]))`: one coordinate per x; a
/// missing y (`py` shorter, `undefined` in TypeScript) is NaN.
fn coords_of(px: &[f64], py: &[f64]) -> Vec<Coord> {
    px.iter()
        .enumerate()
        .map(|(i, &x)| Coord::new(x, at(py, i)))
        .collect()
}

/// `xs[i]`, NaN past the end (TypeScript's `undefined` in arithmetic and
/// comparisons; unequal x and y arrays must not panic).
fn at(xs: &[f64], i: usize) -> f64 {
    xs.get(i).copied().unwrap_or(f64::NAN)
}

fn to_xy(ring: &[Coord]) -> Vec<Pt> {
    ring.iter().map(|c| [c.x, c.y]).collect()
}

fn to_coords(ring: &[Pt]) -> Vec<Coord> {
    ring.iter().map(|p| Coord::new(p[0], p[1])).collect()
}

/// `GeometryFactory.createLinearRing` validation (an
/// `IllegalArgumentException` in jsts): the `LineString` constructor checks
/// first (one point), then the `LinearRing` (closed, at least 4 points).
fn validate_linear_ring(ring: &[Coord]) -> Result<(), EngineError> {
    if ring.len() == 1 {
        return Err(EngineError::new(
            "Invalid number of points in LineString (found 1 - must be 0 or >= 2)",
        ));
    }
    if !ring.is_empty() && ring[0] != ring[ring.len() - 1] {
        return Err(EngineError::new(
            "Points of LinearRing do not form a closed linestring",
        ));
    }
    if !ring.is_empty() && ring.len() < 4 {
        return Err(EngineError::new(format!(
            "Invalid number of points in LinearRing (found {} - must be 0 or >= 4)",
            js::num::to_string(ring.len() as f64)
        )));
    }
    Ok(())
}

/// `polygon.contains(point)` for a polygon of one ring: the point is in
/// the interior (not on the boundary).
fn polygon_contains(ring: &[Coord], p: &Option<Coord>) -> bool {
    match p {
        None => false,
        Some(p) => locate_in_polygon_ring(p, ring) == Location::Interior,
    }
}

/// Split a polygon into pieces along a polyline.
///
/// Algorithm:
/// 1. Node the polygon boundary with the cutting line (union inserts
///    intersection vertices into both geometries).
/// 2. Polygonize the noded edges to rebuild closed polygons.
/// 3. Filter to keep only polygons whose interior lies inside the original.
///
/// Correctly handles concave polygons, multiple crossings, collinear
/// edges, and shared vertices — all cases that tripped up the hand-rolled
/// implementation.
///
/// `px`, `py`: polygon (closed, first == last); `lx`, `ly`: polyline.
/// Returns the pieces (closed), or the original if the polyline doesn't
/// split the polygon.
pub fn split_polygon_by_polyline(
    px: &[f64],
    py: &[f64],
    lx: &[f64],
    ly: &[f64],
) -> Result<Vec<PolygonXY>, EngineError> {
    Ok(split_polygon_by_polyline_detailed(px, py, lx, ly)?.pieces)
}

pub fn split_polygon_by_polyline_detailed(
    px: &[f64],
    py: &[f64],
    lx: &[f64],
    ly: &[f64],
) -> Result<SplitPolygonResult, EngineError> {
    // Ensure polygon is closed (each array on its own, as TypeScript; an
    // empty or short array reads NaN)
    let mut cpx = px.to_vec();
    let mut cpy = py.to_vec();
    if (at(&cpx, 0) - at(&cpx, cpx.len().wrapping_sub(1))).abs() > 1e-12
        || (at(&cpy, 0) - at(&cpy, cpy.len().wrapping_sub(1))).abs() > 1e-12
    {
        cpx.push(at(&cpx, 0));
        cpy.push(at(&cpy, 0));
    }
    let original = |failed: bool| SplitPolygonResult {
        pieces: vec![PolygonXY {
            px: cpx.clone(),
            py: cpy.clone(),
        }],
        split_failed: failed,
    };

    // Build the geometries
    let polygon = coords_of(&cpx, &cpy);
    validate_linear_ring(&polygon)?;

    let line = coords_of(lx, ly);
    if line.len() < 2 {
        return Ok(original(false));
    }

    // Quick bail-out if line doesn't touch the polygon (jsts's relate
    // computation; it throws on a self-crossing outline, outside the try)
    match jts::relate::polygon_intersects_line(&polygon, &line) {
        Ok(true) => {}
        Ok(false) => return Ok(original(false)),
        Err(e) => return Err(EngineError::new(e.message())),
    }

    let split = || -> JtsResult<Vec<PolygonXY>> {
        // Node the polygon boundary with the cutting line
        let noded = jts::overlay::union_ring_line(&polygon, &line)?;

        // Polygonize the noded edges
        let (polys, _) = jts::polygonize::polygonize(&noded)?;

        // Filter to polygons inside the original
        let mut results = Vec::new();
        for p in &polys {
            if polygon_contains(&polygon, &jts::interior_point::interior_point(p)?) {
                let holes: Vec<Vec<Pt>> = p.holes.iter().map(|h| to_xy(h)).collect();
                // A piece around a closed boundary (lens) has a hole. The engine's
                // polygons are single rings, so cut the hole in through a bridge;
                // dropping it made the lens count twice (weight) and gave its
                // slices the surrounding material.
                let ring = keyhole_ring(&to_xy(&p.shell), &holes);
                results.push(PolygonXY {
                    px: ring.iter().map(|c| c[0]).collect(),
                    py: ring.iter().map(|c| c[1]).collect(),
                });
            }
        }
        Ok(results)
    };

    let mut results = match split() {
        Ok(r) => r,
        // If the split fails for any reason, return the original polygon
        // unsplit, but make the failure explicit for diagnostics.
        Err(_) => return Ok(original(true)),
    };

    if results.is_empty() {
        return Ok(original(false));
    }

    // Only accept a clean split: no sliver pieces and the pieces add up
    // to the original. Re-splitting with a line that runs along an
    // existing edge produced zero-area and duplicated "phantom" pieces.
    let xy = |px: &[f64], py: &[f64]| {
        px.iter()
            .zip(py.iter())
            .map(|(&x, &y)| [x, y])
            .collect::<Vec<Pt>>()
    };
    let parent_area = signed_area(&xy(&cpx, &cpy)).abs();
    let areas: Vec<f64> = results
        .iter()
        .map(|r| signed_area(&xy(&r.px, &r.py)).abs())
        .collect();
    let eps = 1e-9 * js::math::max(1.0, parent_area);
    let total = js::array::sum(areas.iter().copied());
    if results.len() > 1
        && (areas.iter().any(|&a| a <= eps)
            || (total - parent_area).abs() > 1e-6 * js::math::max(1.0, parent_area))
    {
        return Ok(original(false));
    }

    // Sort by average y descending so upper (surface-side) pieces come first,
    // matching the expected order for slope analysis.
    let avg = |p: &PolygonXY| js::array::sum(p.py.iter().copied()) / p.py.len() as f64;
    js::array::sort_by(&mut results, |a, b| avg(b) - avg(a));

    Ok(SplitPolygonResult {
        pieces: results,
        split_failed: false,
    })
}

// ── Helper: Create a GeometryWithMaterial ─────────────────────────

pub use crate::types::geometry::GeometryWithMaterial;
pub use crate::types::material::MaterialId;

/// Factory function to create a GeometryWithMaterial from coordinates.
pub fn create_geometry_with_material(
    px: &[f64],
    py: &[f64],
    material: MaterialId,
    calculate_bounds: bool,
) -> GeometryWithMaterial {
    let mut gm = GeometryWithMaterial {
        px: px.to_vec(),
        py: py.to_vec(),
        material,
        x_min: None,
        x_max: None,
        y_max: None,
    };
    if calculate_bounds && !px.is_empty() {
        gm.x_min = Some(js::math::min_of(px));
        gm.x_max = Some(js::math::max_of(px));
        gm.y_max = Some(js::math::max_of(py));
    }
    gm
}

// ── Top of a material layer ───────────────────────────────────────

/// Vertical extents [bottom, top] of a polygon on the line at x, appended
/// to `out`. Edges are taken half-open in x so that a vertex on the line is
/// counted once; vertical edges never cross it.
fn vertical_extents_at(px: &[f64], py: &[f64], x: f64, out: &mut Vec<[f64; 2]>) {
    let mut ys: Vec<f64> = Vec::new();
    let n = px.len();
    for i in 0..n {
        let j = if i + 1 < n { i + 1 } else { 0 };
        let xi = px[i];
        let xj = px[j];
        if (xi <= x && x < xj) || (xj <= x && x < xi) {
            ys.push(at(py, i) + ((x - xi) * (at(py, j) - at(py, i))) / (xj - xi));
        }
    }
    if ys.len() < 2 {
        return;
    }
    js::array::sort_by(&mut ys, |a, b| a - b);
    let mut k = 0;
    while k + 1 < ys.len() {
        out.push([ys[k], ys[k + 1]]);
        k += 2;
    }
}

/// Elevation of the top of the layer of `material` at the point (x, y):
/// the highest y reached by going straight up from the point while staying
/// inside regions of that material. Adjoining regions of the same material
/// (a layer split by another boundary line) count as one layer; a lens of
/// the same material higher up, separated by another material, does not.
/// For the uppermost material this is the ground surface.
///
/// Returns the layer top, or `None` when the point is not inside `material`.
pub fn material_layer_top_at(
    geometries: &[GeometryWithMaterial],
    material: MaterialId,
    x: f64,
    y: f64,
) -> Option<f64> {
    let mut extents: Vec<[f64; 2]> = Vec::new();
    for g in geometries {
        if g.material != material {
            continue;
        }
        if let (Some(x_min), Some(x_max)) = (g.x_min, g.x_max) {
            if x < x_min || x > x_max {
                continue;
            }
        }
        vertical_extents_at(&g.px, &g.py, x, &mut extents);
    }
    if extents.is_empty() {
        return None;
    }
    let tol = |v: f64| 1e-6 * js::math::max(1.0, v.abs());
    let mut top: Option<f64> = None;
    for &[lo, hi] in &extents {
        if y >= lo - tol(lo) && y <= hi + tol(hi) && (top.is_none() || hi > top.expect("checked")) {
            top = Some(hi);
        }
    }
    let mut top = top?;
    // Climb through same-material regions stacked directly on top.
    js::array::sort_by(&mut extents, |a, b| a[0] - b[0]);
    for &[lo, hi] in &extents {
        if lo <= top + tol(top) && hi > top {
            top = hi;
        }
    }
    Some(top)
}

fn signed_area(ring: &[Pt]) -> f64 {
    let mut a = 0.0;
    let n = ring.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
        j = i;
    }
    a / 2.0
}

/// Single closed ring for a polygon with holes: each hole is joined to the
/// outline by a zero-width bridge between their nearest vertices and
/// traversed in the opposite direction, so the shoelace area and even-odd
/// point tests treat it as a hole.
pub fn keyhole_ring(outer: &[Pt], holes: &[Vec<Pt>]) -> Vec<Pt> {
    let open = |r: &[Pt]| -> Vec<Pt> {
        if r.len() > 1 && r[0][0] == r[r.len() - 1][0] && r[0][1] == r[r.len() - 1][1] {
            r[..r.len() - 1].to_vec()
        } else {
            r.to_vec()
        }
    };
    let mut ring = open(outer);
    let outer_sign = js::math::sign(signed_area(&ring));
    for raw_hole in holes {
        let mut hole = open(raw_hole);
        // (an empty outline cannot take a hole; TS would splice in undefined)
        if hole.len() < 3 || ring.is_empty() {
            continue;
        }
        if js::math::sign(signed_area(&hole)) == outer_sign {
            hole.reverse();
        }
        let mut bi = 0;
        let mut bj = 0;
        let mut best = f64::INFINITY;
        for (i, r) in ring.iter().enumerate() {
            for (j, h) in hole.iter().enumerate() {
                let d = js::math::pow(r[0] - h[0], 2.0) + js::math::pow(r[1] - h[1], 2.0);
                if d < best {
                    best = d;
                    bi = i;
                    bj = j;
                }
            }
        }
        let mut hole_loop: Vec<Pt> = hole[bj..].to_vec();
        hole_loop.extend_from_slice(&hole[..bj]);
        hole_loop.push(hole[bj]);
        let mut next: Vec<Pt> = ring[..bi + 1].to_vec();
        next.extend(hole_loop);
        next.push(ring[bi]);
        next.extend_from_slice(&ring[bi + 1..]);
        ring = next;
    }
    // (TS appends ring[0], undefined for an empty outline)
    if let Some(&first) = ring.first() {
        ring.push(first);
    }
    ring
}

/// A face of the slope cut by all material boundaries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RegionFace {
    pub outer: Vec<Pt>,
    pub holes: Vec<Vec<Pt>>,
}

/// Faces of the slope, and whether noding the boundaries failed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionFacesResult {
    pub faces: Vec<RegionFace>,
    /// True when the boundaries could not be noded (slope left unsplit).
    pub failed: bool,
    /// Indices (into the given lines) of boundaries with an end that lies
    /// inside the slope, off the outline and off every other boundary, after
    /// snapping (see END_SNAP_TOLERANCE). Such an end does not split the
    /// region it lies in.
    pub dangling_boundaries: Vec<usize>,
}

/// Cut the slope polygon by all boundary polylines at once and return the
/// faces inside it (with holes for enclosed lenses).
///
/// Noding every line together makes the result independent of the order
/// of the boundaries and avoids re-splitting already split pieces (which
/// produced slivers and duplicate pieces). The canvas and the engine both
/// use this, so the regions shown are the regions analysed.
/// Errors where TypeScript throws (jsts rejects the outline: a NaN first or
/// last vertex leaves the ring unclosed).
pub fn polygonize_regions(
    px: &[f64],
    py: &[f64],
    lines: &[Vec<Pt>],
) -> Result<Vec<RegionFace>, EngineError> {
    Ok(polygonize_regions_detailed(px, py, lines)?.faces)
}

/// Relative tolerances of the region split (fractions of the model size).
///
/// END_SNAP_TOLERANCE: a boundary end inside the model this close to the
/// outline or to another boundary is put on the nearest point of it (an end
/// outside the model crosses the outline and is cut there). An end short of the
/// model edge or of the boundary it meets (by a rounding error, or a
/// millimetre in a hand-edited or imported file) left the boundary
/// dangling, and the layer below it was silently not split off: one
/// region, the first material throughout. 1e-3 of the model size (4 cm on
/// a 40 m model) is a geometric tolerance of the drawing, as in the
/// endpoint snapping of CAD and GIS line cleaning; it is not fitted to any
/// result. An end farther away is left as drawn and reported in
/// `danglingBoundaries`.
///
/// SNAP_ROUNDING_GRID: the grid of snap rounding when plain noding fails.
/// DANGLE_TOLERANCE: an end this close to a line counts as on it.
const END_SNAP_TOLERANCE: f64 = 1e-3;
const DANGLE_TOLERANCE: f64 = 1e-9;
const SNAP_ROUNDING_GRID: f64 = 1e-9;
/// The faces must cover the slope to this fraction of its area.
const COVERAGE_TOLERANCE: f64 = 1e-6;

/// The point of the ring nearest to (x, y), and its distance.
fn nearest_on_ring(ring: &[Pt], x: f64, y: f64) -> (Pt, f64) {
    let (p, d, _) = nearest_on_ring_segment(ring, x, y);
    (p, d)
}

/// The point of the ring nearest to (x, y), its distance, and the index of
/// the segment it lies on (the segment from ring[i] to ring[i + 1]).
fn nearest_on_ring_segment(ring: &[Pt], x: f64, y: f64) -> (Pt, f64, usize) {
    let mut best: (Pt, f64, usize) = ([x, y], f64::INFINITY, 0);
    let mut i = 0;
    while i + 1 < ring.len() {
        let [ax, ay] = ring[i];
        let [bx, by] = ring[i + 1];
        let dx = bx - ax;
        let dy = by - ay;
        let len2 = dx * dx + dy * dy;
        let t = if len2 > 0.0 {
            js::math::max(
                0.0,
                js::math::min(1.0, ((x - ax) * dx + (y - ay) * dy) / len2),
            )
        } else {
            0.0
        };
        let p: Pt = [ax + t * dx, ay + t * dy];
        let d = js::math::hypot(&[x - p[0], y - p[1]]);
        if d < best.1 {
            best = (p, d, i);
        }
        i += 1;
    }
    best
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum End {
    First,
    Last,
}

/// The point of the other lines nearest to the end `which` of line k (its
/// own segments count too, except the one the end belongs to, so that a
/// lens drawn with a small gap closes).
fn nearest_on_lines(lines: &[Vec<Pt>], k: usize, which: End) -> (Pt, f64) {
    let l = &lines[k];
    let [x, y] = if which == End::First {
        l[0]
    } else {
        l[l.len() - 1]
    };
    let mut best: (Pt, f64) = ([x, y], f64::INFINITY);
    for (j, line) in lines.iter().enumerate() {
        let line: &[Pt] = if j == k {
            let own = if which == End::First {
                &l[1..]
            } else {
                &l[..l.len() - 1]
            };
            if own.len() < 2 {
                continue;
            }
            own
        } else {
            line
        };
        let r = nearest_on_ring(line, x, y);
        if r.1 < best.1 {
            best = r;
        }
    }
    best
}

/// True when the polyline is closed (a lens); a closed line has no ends.
fn is_closed_line(l: &[Pt]) -> bool {
    l.len() > 2 && l[0][0] == l[l.len() - 1][0] && l[0][1] == l[l.len() - 1][1]
}

/// Put each boundary end within `tol` of the outline or of another boundary
/// on the nearest point of it. Ends nearest the outline are snapped first,
/// then ends nearest a boundary, onto the boundaries as already snapped (a
/// T-junction then meets the line it ends on where that line now runs).
///
/// Only ends strictly inside the polygon are snapped. An end outside it (or
/// on it) already crosses or meets the outline, and noding cuts the line
/// there; snapping it could put it on a neighbouring boundary instead, and
/// a layer thinner than `tol` between two boundaries drawn past the edge
/// then vanished (issue #93 a).
///
/// An end snapped to the outline is put on the outline exactly: the point
/// is inserted into the ring as a vertex (the same pair of numbers as the
/// end), so that noding meets it there whatever the rounding of the
/// nearest point. Otherwise an end on a sloping face, off it by a rounding
/// error, could leave the layer unsplit (issue #93 b). Returns the ring
/// with the inserted vertices, and the lines.
fn snap_boundary_ends(
    polygon: &[Coord],
    ring: &[Pt],
    lines: &[Vec<Pt>],
    tol: f64,
    same: f64,
) -> (Vec<Pt>, Vec<Vec<Pt>>) {
    let mut out: Vec<Vec<Pt>> = lines.to_vec();
    let set = |out: &mut Vec<Vec<Pt>>, k: usize, which: End, p: Pt| {
        let i = if which == End::First {
            0
        } else {
            out[k].len() - 1
        };
        out[k][i] = p;
    };
    let mut to_lines: Vec<(usize, End)> = Vec::new();
    // (segment index, point) of the ends put on the outline
    let mut on_outline: Vec<(usize, Pt)> = Vec::new();
    for k in 0..out.len() {
        if is_closed_line(&out[k]) {
            continue;
        }
        for which in [End::First, End::Last] {
            let [x, y] = if which == End::First {
                out[k][0]
            } else {
                out[k][out[k].len() - 1]
            };
            if !polygon_contains(polygon, &Some(Coord::new(x, y))) {
                continue;
            }
            let (p, d, seg) = nearest_on_ring_segment(ring, x, y);
            let on_line = nearest_on_lines(lines, k, which);
            if d <= on_line.1 {
                if d <= tol {
                    // a point this close to a vertex of the outline is that vertex
                    let p = [ring[seg], ring[seg + 1]]
                        .into_iter()
                        .find(|v| js::math::hypot(&[v[0] - p[0], v[1] - p[1]]) <= same)
                        .unwrap_or(p);
                    set(&mut out, k, which, p);
                    on_outline.push((seg, p));
                }
            } else if on_line.1 > 0.0 && on_line.1 <= tol {
                to_lines.push((k, which));
            }
        }
    }
    for (k, which) in to_lines {
        let (p, d) = nearest_on_lines(&out, k, which);
        if d > 0.0 && d <= tol {
            set(&mut out, k, which, p);
        }
    }
    (insert_ring_vertices(ring, &on_outline), out)
}

/// The closed ring with the points inserted as vertices, each on the
/// segment given with it (from ring[i] to ring[i + 1]), in order along it.
/// A point equal to a vertex is not inserted again.
fn insert_ring_vertices(ring: &[Pt], points: &[(usize, Pt)]) -> Vec<Pt> {
    if points.is_empty() {
        return ring.to_vec();
    }
    let mut result: Vec<Pt> = Vec::with_capacity(ring.len() + points.len());
    for i in 0..ring.len() - 1 {
        let (a, b) = (ring[i], ring[i + 1]);
        result.push(a);
        let dist2 = |p: &Pt| (p[0] - a[0]) * (p[0] - a[0]) + (p[1] - a[1]) * (p[1] - a[1]);
        let mut on_segment: Vec<Pt> = points
            .iter()
            .filter(|(seg, p)| *seg == i && *p != a && *p != b)
            .map(|&(_, p)| p)
            .collect();
        on_segment.sort_by(|p, q| dist2(p).total_cmp(&dist2(q)));
        on_segment.dedup();
        result.extend(on_segment);
    }
    result.push(ring[ring.len() - 1]);
    result
}

/// Indices of the lines with an end strictly inside the polygon and more
/// than `tol` from the outline and from every other line.
fn dangling_lines(polygon: &[Coord], ring: &[Pt], lines: &[Vec<Pt>], tol: f64) -> Vec<usize> {
    let mut result = Vec::new();
    for (k, l) in lines.iter().enumerate() {
        if is_closed_line(l) {
            continue;
        }
        let dangles = [End::First, End::Last].into_iter().any(|which| {
            let [x, y] = if which == End::First {
                l[0]
            } else {
                l[l.len() - 1]
            };
            if !polygon_contains(polygon, &Some(Coord::new(x, y))) {
                return false;
            }
            nearest_on_ring(ring, x, y).1 > tol && nearest_on_lines(lines, k, which).1 > tol
        });
        if dangles {
            result.push(k);
        }
    }
    result
}

/// Cut the ring by the lines: node all linework, polygonize, and keep the
/// faces inside the ring. With `grid`, noding is by snap rounding on that
/// grid (Hobby 1999, as JTS implements it), which is robust where plain
/// floating-point noding throws or loses faces (a boundary vertex on the
/// outline, a boundary through a vertex of the outline).
fn polygonize_once(
    polygon: &[Coord],
    ring: &[Pt],
    lines: &[Vec<Pt>],
    grid: Option<f64>,
) -> JtsResult<(Vec<RegionFace>, usize)> {
    let mut line_strings: Vec<Vec<Coord>> = vec![to_coords(ring)];
    line_strings.extend(lines.iter().map(|l| to_coords(l)));
    let merged = match grid {
        // One unary union nodes everything at once (a union per line was
        // quadratic: 150 ms for 50 layers, recomputed while dragging).
        None => jts::overlay::unary_union_lines(&line_strings)?,
        Some(grid) => {
            let noded = jts::noding::snap_round_node(&line_strings, 1.0 / grid)?;
            jts::overlay::unary_union_lines(&noded)?
        }
    };
    let (polys, dangles) = jts::polygonize::polygonize(&merged)?;
    let parent_area = signed_area(ring).abs();
    let mut faces = Vec::new();
    for p in &polys {
        // Polygon.getArea: the shell, less each hole in turn
        let area = p.holes.iter().fold(
            0.0 + jts::algorithm::area_of_ring_signed(&p.shell).abs(),
            |a, h| a - jts::algorithm::area_of_ring_signed(h).abs(),
        );
        if area <= 1e-9 * js::math::max(1.0, parent_area) {
            continue;
        }
        if !polygon_contains(polygon, &jts::interior_point::interior_point(p)?) {
            continue;
        }
        faces.push(RegionFace {
            outer: to_xy(&p.shell),
            holes: p.holes.iter().map(|h| to_xy(h)).collect(),
        });
    }
    // A boundary end not exactly on the outline or another boundary is a
    // dangle: plain noding leaves it unsplit (and the faces still cover the
    // slope, so only the dangle shows it).
    Ok((faces, dangles))
}

/// Area of the faces (outer rings less holes).
fn faces_area(faces: &[RegionFace]) -> f64 {
    faces.iter().fold(0.0, |sum, f| {
        sum + signed_area(&f.outer).abs()
            - f.holes.iter().fold(0.0, |h, r| h + signed_area(r).abs())
    })
}

/// polygonizeRegions that also reports a failed split.
pub fn polygonize_regions_detailed(
    px: &[f64],
    py: &[f64],
    lines: &[Vec<Pt>],
) -> Result<RegionFacesResult, EngineError> {
    let mut ring: Vec<Pt> = px
        .iter()
        .enumerate()
        .map(|(i, &x)| [x, at(py, i)])
        .collect();
    if !ring.is_empty()
        && (ring[0][0] != ring[ring.len() - 1][0] || ring[0][1] != ring[ring.len() - 1][1])
    {
        ring.push(ring[0]);
    }
    if ring.len() < 4 {
        return Ok(RegionFacesResult {
            faces: vec![],
            failed: false,
            dangling_boundaries: vec![],
        });
    }
    let polygon = to_coords(&ring);
    // gf.createLinearRing(ring): throws outside the try blocks below
    validate_linear_ring(&polygon)?;
    let xs: Vec<f64> = ring.iter().map(|p| p[0]).collect();
    let ys: Vec<f64> = ring.iter().map(|p| p[1]).collect();
    let size = js::math::max(
        js::math::max(
            js::math::max_of(&xs) - js::math::min_of(&xs),
            js::math::max_of(&ys) - js::math::min_of(&ys),
        ),
        1e-9,
    );
    // Boundary ends near the outline or another boundary are put on it.
    let indices: Vec<usize> = (0..lines.len()).filter(|&i| lines[i].len() >= 2).collect();
    let selected: Vec<Vec<Pt>> = indices.iter().map(|&i| lines[i].clone()).collect();
    let (snapped_ring, usable) = snap_boundary_ends(
        &polygon,
        &ring,
        &selected,
        END_SNAP_TOLERANCE * size,
        DANGLE_TOLERANCE * size,
    );
    let dangling: Vec<usize> = dangling_lines(&polygon, &ring, &usable, DANGLE_TOLERANCE * size)
        .into_iter()
        .map(|k| indices[k])
        .collect();
    let to_face = |outer: Vec<Pt>, failed: bool| RegionFacesResult {
        faces: vec![RegionFace {
            outer,
            holes: vec![],
        }],
        failed,
        dangling_boundaries: dangling.clone(),
    };
    if usable.is_empty() {
        return Ok(to_face(ring, false));
    }

    let parent_area = signed_area(&ring).abs();
    let covers = |faces: &[RegionFace]| {
        !faces.is_empty()
            && (faces_area(faces) - parent_area).abs() <= COVERAGE_TOLERANCE * parent_area
    };

    // Plain noding first: exact where it works (no dangles, the slope
    // covered).
    let mut plain: Option<Vec<RegionFace>> = None;
    // The ring with the boundary ends put on it as vertices.
    let snapped_polygon = to_coords(&snapped_ring);
    if let Ok((faces, dangles)) = polygonize_once(&snapped_polygon, &snapped_ring, &usable, None) {
        if covers(&faces) {
            if dangles == 0 {
                return Ok(RegionFacesResult {
                    faces,
                    failed: false,
                    dangling_boundaries: dangling,
                });
            }
            plain = Some(faces);
        }
    }
    // Snap rounding where plain noding throws, loses a face or leaves a
    // boundary end unsplit (an end on a sloping edge or on another boundary
    // is off it by a rounding error). It runs about a local origin, so that
    // the grid suits the model's size also at large map coordinates. A
    // dangle left after it is a boundary that really ends inside a region.
    {
        let (ox, oy) = (js::math::min_of(&xs), js::math::min_of(&ys));
        let local = |pts: &[Pt]| {
            pts.iter()
                .map(|&[x, y]| [x - ox, y - oy])
                .collect::<Vec<Pt>>()
        };
        let back = |pts: &[Pt]| {
            pts.iter()
                .map(|&[x, y]| [x + ox, y + oy])
                .collect::<Vec<Pt>>()
        };
        let local_ring = local(&snapped_ring);
        let local_polygon = to_coords(&local_ring);
        let local_lines: Vec<Vec<Pt>> = usable.iter().map(|l| local(l)).collect();
        if let Ok((faces, _)) = polygonize_once(
            &local_polygon,
            &local_ring,
            &local_lines,
            Some(SNAP_ROUNDING_GRID * size),
        ) {
            let faces: Vec<RegionFace> = faces
                .iter()
                .map(|f| RegionFace {
                    outer: back(&f.outer),
                    holes: f.holes.iter().map(|h| back(h)).collect(),
                })
                .collect();
            // Taken only when it splits more than plain noding did: a boundary
            // that really ends inside a region keeps the exact plain faces.
            if covers(&faces) && plain.as_ref().is_none_or(|p| faces.len() > p.len()) {
                return Ok(RegionFacesResult {
                    faces,
                    failed: false,
                    dangling_boundaries: dangling,
                });
            }
        }
        // fall back to the plain faces, if they cover the slope
    }
    if let Some(faces) = plain {
        return Ok(RegionFacesResult {
            faces,
            failed: false,
            dangling_boundaries: dangling,
        });
    }
    // (TS: console.warn("polygonizeRegions failed; using the unsplit slope."))
    Ok(to_face(ring, true))
}
