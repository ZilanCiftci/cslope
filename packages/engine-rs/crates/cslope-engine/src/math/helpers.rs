//! Port of packages/engine/src/math/helpers.ts
//!
//! Miscellaneous helper/utility functions.

use crate::error::{EngineError, Result};
use crate::js;
use crate::types::analysis::IntersliceFunctionType;

/// Constant interslice function (unity across domain).
pub fn constant_interslice(x: f64, x_start: f64, x_end: f64) -> f64 {
    if x <= x_start || x >= x_end {
        return 0.0;
    }
    1.0
}

/// Half-sine interslice function for Morgenstern-Price analysis (0
/// outside the domain [x_start, x_end]).
pub fn halfsine(x: f64, x_start: f64, x_end: f64) -> f64 {
    if x <= x_start || x >= x_end {
        return 0.0;
    }
    js::math::sin((std::f64::consts::PI * (x - x_start)) / (x_end - x_start))
}

/// Clipped-sine interslice function.
///
/// Uses a half-sine profile clipped from below to avoid very low tail values.
pub fn clipped_sine(x: f64, x_start: f64, x_end: f64) -> f64 {
    if x <= x_start || x >= x_end {
        return 0.0;
    }
    let y = halfsine(x, x_start, x_end);
    js::math::max(0.35, y)
}

/// Trapezoidal interslice function.
///
/// Piecewise-linear rise (0–20%), flat top (20–80%), and fall (80–100%).
pub fn trapezoidal(x: f64, x_start: f64, x_end: f64) -> f64 {
    if x <= x_start || x >= x_end {
        return 0.0;
    }
    let span = x_end - x_start;
    if span <= 0.0 {
        return 0.0;
    }

    let xi = (x - x_start) / span;
    if xi <= 0.0 || xi >= 1.0 {
        return 0.0;
    }
    if xi < 0.2 {
        return xi / 0.2;
    }
    if xi <= 0.8 {
        return 1.0;
    }
    (1.0 - xi) / 0.2
}

/// Data-point-specified interslice function using piecewise-linear interpolation.
///
/// The provided points are normalized: x in [0,1], f in [0,1].
pub fn data_point_specified(x: f64, x_start: f64, x_end: f64, points: &[[f64; 2]]) -> f64 {
    if x <= x_start || x >= x_end {
        return 0.0;
    }
    let span = x_end - x_start;
    if span <= 0.0 || points.is_empty() {
        return halfsine(x, x_start, x_end);
    }

    let xi = (x - x_start) / span;
    if xi <= 0.0 || xi >= 1.0 {
        return 0.0;
    }

    let mut normalized: Vec<[f64; 2]> = points
        .iter()
        .filter(|p| p[0].is_finite() && p[1].is_finite())
        .map(|&[px, py]| {
            [
                js::math::max(0.0, js::math::min(1.0, px)),
                js::math::max(0.0, py),
            ]
        })
        .collect();
    js::array::sort_by(&mut normalized, |a, b| a[0] - b[0]);

    if normalized.is_empty() {
        return halfsine(x, x_start, x_end);
    }

    if xi <= normalized[0][0] {
        return normalized[0][1];
    }
    if xi >= normalized[normalized.len() - 1][0] {
        return normalized[normalized.len() - 1][1];
    }

    for i in 0..normalized.len() - 1 {
        let [x0, y0] = normalized[i];
        let [x1, y1] = normalized[i + 1];
        if xi >= x0 && xi <= x1 {
            let dx = x1 - x0;
            if dx <= 1e-12 {
                return y1;
            }
            let t = (xi - x0) / dx;
            return y0 + t * (y1 - y0);
        }
    }

    0.0
}

/// Select and evaluate the configured interslice function (None: half-sine).
pub fn get_interslice_function_value(
    kind: Option<IntersliceFunctionType>,
    x: f64,
    x_start: f64,
    x_end: f64,
    points: &[[f64; 2]],
) -> f64 {
    match kind.unwrap_or(IntersliceFunctionType::HalfSine) {
        IntersliceFunctionType::Constant => constant_interslice(x, x_start, x_end),
        IntersliceFunctionType::HalfSine => halfsine(x, x_start, x_end),
        IntersliceFunctionType::ClippedSine => clipped_sine(x, x_start, x_end),
        IntersliceFunctionType::Trapezoidal => trapezoidal(x, x_start, x_end),
        IntersliceFunctionType::DataPointSpecified => {
            data_point_specified(x, x_start, x_end, points)
        }
    }
}

/// Midpoint between two 2D points.
pub fn mid_coord(p1: [f64; 2], p2: [f64; 2]) -> [f64; 2] {
    [(p1[0] + p2[0]) / 2.0, (p1[1] + p2[1]) / 2.0]
}

/// Euclidean distance between two 2D points.
pub fn dist_points(p1: [f64; 2], p2: [f64; 2]) -> f64 {
    (js::math::pow(p1[0] - p2[0], 2.0) + js::math::pow(p1[1] - p2[1], 2.0)).sqrt()
}

/// Extrapolate the lambda value where FS_moment ≈ FS_force
/// for Morgenstern-Price convergence.
///
/// `lff_array`: [lambda, FS, FS_force] triplets. Returns
/// [extrapolated lambda, extrapolated FS].
pub fn extrapolate_lambda(lff_array: &[[f64; 3]]) -> Result<[f64; 2]> {
    if lff_array.len() < 2 {
        return Err(EngineError::new(
            "lffArray must contain at least two points for extrapolation.",
        ));
    }

    // Sort by |FS - FS_force| (ascending — closest pair first)
    let mut sorted = lff_array.to_vec();
    js::array::sort_by(&mut sorted, |a, b| {
        (a[1] - a[2]).abs() - (b[1] - b[2]).abs()
    });
    let [lambda1, fs1, fs_force1] = sorted[0];
    let [lambda2, fs2, fs_force2] = sorted[1];

    let slope_m = (fs2 - fs1) / (lambda2 - lambda1);
    let slope_f = (fs_force2 - fs_force1) / (lambda2 - lambda1);

    // Parallel slopes — return the better point
    if (slope_m - slope_f).abs() < 1e-10 {
        let error1 = (fs1 - fs_force1).abs();
        let error2 = (fs2 - fs_force2).abs();
        return Ok(if error1 < error2 {
            [lambda1, fs1]
        } else {
            [lambda2, fs2]
        });
    }

    let mut lambda_extrap = lambda2 + (fs_force2 - fs2) / (slope_m - slope_f);
    // Planar surfaces can need λ above 1 (the step per iteration is
    // limited by the caller).
    lambda_extrap = js::math::max(-5.0, js::math::min(lambda_extrap, 5.0));
    let fs_extrap = fs1 + slope_m * (lambda_extrap - lambda1);
    Ok([lambda_extrap, fs_extrap])
}

/// Determine the decimal precision of a number (from its JavaScript
/// string form).
pub fn get_precision(n: f64) -> usize {
    let mag = js::num::to_string(n);
    let Some((_, decimals)) = mag.split_once('.') else {
        return 0;
    };
    // `split(".")[1]`: up to a second "." (there is none in a number)
    let d = decimals.as_bytes();
    for i in 0..d.len().saturating_sub(2) {
        if d[i] == b'0' && d[i + 1] == b'0' && d[i + 2] == b'0' {
            return i;
        }
    }
    decimals.chars().count()
}

/// Default palette for material layers.
pub const MATERIAL_COLORS: [&str; 10] = [
    "#efa59c", "#77e1ca", "#cdacfc", "#f2c6a7", "#7edff4", "#f2a8c3", "#cde9ba", "#f2c1fa",
    "#f1dba3", "#a3acf7",
];
