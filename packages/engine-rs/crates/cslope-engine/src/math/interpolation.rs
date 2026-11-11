//! Port of packages/engine/src/math/interpolation.ts
//!
//! Polyline interpolation functions.

use crate::error::{EngineError, Result};
use crate::js;

/// Get the y-coordinate on a polyline at a specific x-coordinate.
/// If multiple segments contain x, returns the average y.
///
/// Returns the interpolated y-coordinate, or NaN if out of bounds.
pub fn get_y_at_x(poly_x: &[f64], poly_y: &[f64], x: f64) -> f64 {
    let mut y_sum = 0.0;
    let mut count = 0;

    for i in 0..poly_x.len().saturating_sub(1) {
        let (x1, x2) = (poly_x[i], poly_x[i + 1]);
        let (y1, y2) = (poly_y[i], poly_y[i + 1]);

        if (x1 <= x && x <= x2) || (x2 <= x && x <= x1) {
            if (x1 - x2).abs() < 1e-12 {
                y_sum += (y1 + y2) / 2.0;
            } else {
                let t = (x - x1) / (x2 - x1);
                y_sum += y1 + t * (y2 - y1);
            }
            count += 1;
        }
    }

    if count > 0 {
        y_sum / count as f64
    } else {
        f64::NAN
    }
}

/// Get y-coordinates on a polyline for multiple x-coordinates (NaN where
/// out of bounds).
pub fn get_y_at_x_many(poly_x: &[f64], poly_y: &[f64], x_values: &[f64]) -> Vec<f64> {
    x_values
        .iter()
        .map(|&x| get_y_at_x(poly_x, poly_y, x))
        .collect()
}

/// Get the y-coordinate on a line at x (strict — an error if out of bounds).
/// Mirrors utilities.get_y_at_x (the non-Numba version).
///
/// `line` is the polyline as ([x], [y]).
pub fn get_y_at_x_strict(line: (&[f64], &[f64]), x: f64) -> Result<f64> {
    let (x_arr, y_arr) = line;
    let x_min = js::math::min_of(x_arr);
    let x_max = js::math::max_of(x_arr);

    if x < x_min - 1e-7 || x > x_max + 1e-7 {
        return Err(EngineError::range(format!(
            "x ({}) is outside the limits of the line ({} to {}).",
            js::num::to_string(x),
            js::num::to_string(x_min),
            js::num::to_string(x_max)
        )));
    }

    // Clamp
    let x_clamped = js::math::max(x_min, js::math::min(x_max, x));

    for i in 0..x_arr.len().saturating_sub(1) {
        let seg_min = js::math::min(x_arr[i], x_arr[i + 1]);
        let seg_max = js::math::max(x_arr[i], x_arr[i + 1]);
        if seg_min <= x_clamped && x_clamped <= seg_max {
            let dx = x_arr[i + 1] - x_arr[i];
            if dx.abs() < 1e-12 {
                return Ok((y_arr[i] + y_arr[i + 1]) / 2.0);
            }
            let slope = (y_arr[i + 1] - y_arr[i]) / dx;
            return Ok(y_arr[i] + slope * (x_clamped - x_arr[i]));
        }
    }

    Err(EngineError::range(format!(
        "Could not interpolate y-value for x={}",
        js::num::to_string(x)
    )))
}

/// Get the line segment between two x-coordinates on a polyline, as
/// ([x], [y]).
pub fn get_line_between_points(
    line: (&[f64], &[f64]),
    x1: f64,
    x2: f64,
) -> Result<(Vec<f64>, Vec<f64>)> {
    let (x_arr, y_arr) = line;
    let line_x_min = js::math::min_of(x_arr);
    let line_x_max = js::math::max_of(x_arr);

    if x1 < line_x_min || x1 > line_x_max || x2 < line_x_min || x2 > line_x_max {
        return Err(EngineError::range(
            "x1 or x2 is outside the limits of the line.",
        ));
    }

    let mut x_out: Vec<f64> = Vec::new();
    let mut y_out: Vec<f64> = Vec::new();

    // Gather points inside [x1, x2]
    for i in 0..x_arr.len() {
        if x_arr[i] >= x1 && x_arr[i] <= x2 {
            x_out.push(x_arr[i]);
            y_out.push(y_arr[i]);
        }
    }

    if x_out.is_empty() {
        return Ok((
            vec![x1, x2],
            vec![get_y_at_x_strict(line, x1)?, get_y_at_x_strict(line, x2)?],
        ));
    }

    // Ensure first point is at x1
    if x_out[0] > x1 {
        x_out.insert(0, x1);
        y_out.insert(0, get_y_at_x_strict(line, x1)?);
    }

    // Ensure last point is at x2
    if x_out[x_out.len() - 1] < x2 {
        x_out.push(x2);
        y_out.push(get_y_at_x_strict(line, x2)?);
    }

    Ok((x_out, y_out))
}

// ── 2D Spatial Interpolation ───────────────────────────────────

/// A 2D data point with arbitrary numeric values.
#[derive(Debug, Clone, PartialEq)]
pub struct SpatialDataPoint {
    pub x: f64,
    pub y: f64,
    pub values: Vec<f64>,
}

/// Inverse Distance Weighting (IDW) interpolation in 2D.
///
/// Interpolates `values` at query point `(qx, qy)` from a set of
/// data points using the formula:
///   v = Σ(wi * vi) / Σ(wi),  where wi = 1 / dist(q, pi)^p
///
/// If the query point coincides with (or is very close to) a data point,
/// that data point's values are returned directly to avoid division by zero.
///
/// `power`: distance exponent (TypeScript default 2); `eps`: distance
/// threshold below which a point is considered coincident (default 1e-10).
/// Returns an empty list if `points` is empty.
pub fn interpolate_idw(
    points: &[SpatialDataPoint],
    qx: f64,
    qy: f64,
    power: f64,
    eps: f64,
) -> Vec<f64> {
    if points.is_empty() {
        return Vec::new();
    }
    let n_values = points[0].values.len();

    if points.len() == 1 {
        return points[0].values.clone();
    }

    // Check for coincident point
    for p in points {
        let d = (js::math::pow(p.x - qx, 2.0) + js::math::pow(p.y - qy, 2.0)).sqrt();
        if d < eps {
            return p.values.clone();
        }
    }

    let mut result = vec![0.0; n_values];
    let mut w_sum = 0.0;

    for p in points {
        let d = (js::math::pow(p.x - qx, 2.0) + js::math::pow(p.y - qy, 2.0)).sqrt();
        let w = 1.0 / js::math::pow(d, power);
        w_sum += w;
        for (j, r) in result.iter_mut().enumerate() {
            // (a shorter values list reads undefined in TypeScript: NaN)
            *r += w * p.values.get(j).copied().unwrap_or(f64::NAN);
        }
    }

    for r in result.iter_mut() {
        *r /= w_sum;
    }

    result
}

/// Nearest-neighbour interpolation in 2D.
///
/// Returns the values of the data point closest to `(qx, qy)`.
pub fn interpolate_nearest(points: &[SpatialDataPoint], qx: f64, qy: f64) -> Vec<f64> {
    if points.is_empty() {
        return Vec::new();
    }

    let mut best_dist = f64::INFINITY;
    let mut best_idx = 0;

    for (i, p) in points.iter().enumerate() {
        let d = js::math::pow(p.x - qx, 2.0) + js::math::pow(p.y - qy, 2.0);
        if d < best_dist {
            best_dist = d;
            best_idx = i;
        }
    }

    points[best_idx].values.clone()
}
