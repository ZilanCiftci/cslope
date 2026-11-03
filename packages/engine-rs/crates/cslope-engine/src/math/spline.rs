//! Port of packages/engine/src/math/spline.ts
//!
//! Cubic spline through points (x increasing): natural (zero curvature at
//! the ends) unless an end slope is given (clamped there). Beyond the ends
//! it continues as a straight line with the end slope. Used for strength
//! functions given as points that their source smooths with a spline.

use crate::js;

#[derive(Debug, Clone, PartialEq)]
pub struct CubicSpline {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    /// Second derivatives at the points.
    pub m: Vec<f64>,
}

/// Value and first derivative of a spline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SplineValue {
    pub value: f64,
    pub slope: f64,
}

/// Build the spline. `slopes`: the first derivative at the start and the end (None: natural).
pub fn cubic_spline(points: &[[f64; 2]], slopes: [Option<f64>; 2]) -> CubicSpline {
    let n = points.len();
    let x: Vec<f64> = points.iter().map(|p| p[0]).collect();
    let y: Vec<f64> = points.iter().map(|p| p[1]).collect();
    let mut m = vec![0.0; n];
    if n < 3 && slopes[0].is_none() && slopes[1].is_none() {
        return CubicSpline { x, y, m };
    }
    if n < 2 {
        // TypeScript reads past the ends here: m is NaN (and unused, a
        // spline of one point is constant)
        m.fill(f64::NAN);
        return CubicSpline { x, y, m };
    }
    // tridiagonal system for the second derivatives (Thomas algorithm)
    let mut a = vec![0.0; n];
    let mut b = vec![0.0; n];
    let mut c = vec![0.0; n];
    let mut r = vec![0.0; n];
    let h = |i: usize| x[i + 1] - x[i];
    let d = |i: usize| (y[i + 1] - y[i]) / h(i);
    match slopes[0] {
        None => b[0] = 1.0,
        Some(s0) => {
            b[0] = 2.0 * h(0);
            c[0] = h(0);
            r[0] = 6.0 * (d(0) - s0);
        }
    }
    for i in 1..n.saturating_sub(1) {
        a[i] = h(i - 1);
        b[i] = 2.0 * (h(i - 1) + h(i));
        c[i] = h(i);
        r[i] = 6.0 * (d(i) - d(i - 1));
    }
    match slopes[1] {
        None => b[n - 1] = 1.0,
        Some(s1) => {
            a[n - 1] = h(n - 2);
            b[n - 1] = 2.0 * h(n - 2);
            r[n - 1] = 6.0 * (s1 - d(n - 2));
        }
    }
    for i in 1..n {
        let w = a[i] / b[i - 1];
        b[i] -= w * c[i - 1];
        r[i] -= w * r[i - 1];
    }
    m[n - 1] = r[n - 1] / b[n - 1];
    for i in (0..n - 1).rev() {
        m[i] = (r[i] - c[i] * m[i + 1]) / b[i];
    }
    CubicSpline { x, y, m }
}

/// Value and first derivative of the spline at t.
pub fn eval_spline(s: &CubicSpline, t: f64) -> SplineValue {
    let CubicSpline { x, y, m } = s;
    let n = x.len();
    if n == 0 {
        return SplineValue {
            value: 0.0,
            slope: 0.0,
        };
    }
    if n == 1 {
        return SplineValue {
            value: y[0],
            slope: 0.0,
        };
    }
    let seg_slope = |i: usize, start: bool| {
        let h = x[i + 1] - x[i];
        let d = (y[i + 1] - y[i]) / h;
        if start {
            d - (h * (2.0 * m[i] + m[i + 1])) / 6.0
        } else {
            d + (h * (m[i] + 2.0 * m[i + 1])) / 6.0
        }
    };
    if t <= x[0] {
        let k = seg_slope(0, true);
        return SplineValue {
            value: y[0] + (t - x[0]) * k,
            slope: k,
        };
    }
    if t >= x[n - 1] {
        let k = seg_slope(n - 2, false);
        return SplineValue {
            value: y[n - 1] + (t - x[n - 1]) * k,
            slope: k,
        };
    }
    let mut i = 0;
    while i < n - 2 && x[i + 1] < t {
        i += 1;
    }
    let h = x[i + 1] - x[i];
    let a = (x[i + 1] - t) / h;
    let b = (t - x[i]) / h;
    let value = a * y[i]
        + b * y[i + 1]
        + (((js::math::pow(a, 3.0) - a) * m[i] + (js::math::pow(b, 3.0) - b) * m[i + 1]) * h * h)
            / 6.0;
    let slope = (y[i + 1] - y[i]) / h
        + ((-(3.0 * a * a - 1.0) * m[i] + (3.0 * b * b - 1.0) * m[i + 1]) * h) / 6.0;
    SplineValue { value, slope }
}
