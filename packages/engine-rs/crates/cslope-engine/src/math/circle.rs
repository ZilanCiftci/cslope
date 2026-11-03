//! Port of packages/engine/src/math/circle.ts
//!
//! Circle geometry calculations.

use crate::js;

/// Get the y-coordinate on the bottom of a circle at a given x (on the
/// lower arc).
pub fn get_circle_y_coordinate_at_x(cx: f64, cy: f64, radius: f64, x: f64) -> f64 {
    cy - js::math::max(0.0, radius * radius - (x - cx) * (x - cx)).sqrt()
}

/// Get intersections between a circle and a polyline, as [x, y] points.
pub fn get_circle_line_intersections(
    cx: f64,
    cy: f64,
    r: f64,
    px: &[f64],
    py: &[f64],
) -> Vec<[f64; 2]> {
    let mut intersections: Vec<[f64; 2]> = Vec::new();
    let r2 = r * r;

    for i in 0..px.len().saturating_sub(1) {
        let (x1, y1) = (px[i], py[i]);
        let (x2, y2) = (px[i + 1], py[i + 1]);

        let dx = x2 - x1;
        let dy = y2 - y1;

        if dx.abs() < 1e-12 && dy.abs() < 1e-12 {
            continue;
        }

        let a = dx * dx + dy * dy;
        let f1 = x1 - cx;
        let f2 = y1 - cy;
        let b = 2.0 * (dx * f1 + dy * f2);
        let c = f1 * f1 + f2 * f2 - r2;

        let discriminant = b * b - 4.0 * a * c;
        if discriminant < 0.0 {
            continue;
        }

        let sqrt_disc = discriminant.sqrt();
        let t1 = (-b + sqrt_disc) / (2.0 * a);
        let t2 = (-b - sqrt_disc) / (2.0 * a);

        // A crossing exactly at a vertex can come out as t = 1 + 2e-16 on one
        // segment and t = -2e-16 on the next and be lost on both: accept a
        // tiny overshoot and snap it onto the vertex.
        const T_TOL: f64 = 1e-9;
        if t1 >= -T_TOL && t1 <= 1.0 + T_TOL {
            let t = js::math::min(1.0, js::math::max(0.0, t1));
            intersections.push([x1 + t * dx, y1 + t * dy]);
        }
        if discriminant > 1e-12 && t2 >= -T_TOL && t2 <= 1.0 + T_TOL {
            let t = js::math::min(1.0, js::math::max(0.0, t2));
            intersections.push([x1 + t * dx, y1 + t * dy]);
        }
    }

    intersections
}

/// Calculate circle radius from intersecting chord property.
/// a * b = c * d  →  R = (C + c²) / (2c)
#[allow(non_snake_case)]
pub fn circle_radius_from_abcd(c_to_e: f64, C: f64) -> Option<f64> {
    if c_to_e.abs() < 1e-12 {
        return None;
    }
    Some((C + c_to_e * c_to_e) / (2.0 * c_to_e))
}

/// Calculate circle centre from chord intersection.
pub fn circle_centre(beta: f64, chord_intersection: [f64; 2], chord_to_centre: f64) -> [f64; 2] {
    let dy = js::math::cos(beta) * chord_to_centre;
    let dx = js::math::sin(beta) * chord_to_centre;
    [chord_intersection[0] + dx, chord_intersection[1] + dy]
}

/// Generate coordinates around the bottom half of a circle circumference,
/// as ([x], [y]); `num_points` defaults to 90 in TypeScript.
pub fn generate_circle_coordinates(
    cx: f64,
    cy: f64,
    radius: f64,
    num_points: usize,
) -> (Vec<f64>, Vec<f64>) {
    let mut x: Vec<f64> = Vec::new();
    let mut y: Vec<f64> = Vec::new();
    if num_points < 2 {
        let angle = std::f64::consts::PI / 2.0;
        x.push(js::math::round((cx - js::math::cos(angle) * radius) * 1000.0) / 1000.0);
        y.push(js::math::round((cy - js::math::sin(angle) * radius) * 1000.0) / 1000.0);
        return (x, y);
    }
    for i in 0..num_points {
        let angle =
            ((1.0 + (i as f64 * 178.0) / (num_points - 1) as f64) * std::f64::consts::PI) / 180.0;
        x.push(js::math::round((cx - js::math::cos(angle) * radius) * 1000.0) / 1000.0);
        y.push(js::math::round((cy - js::math::sin(angle) * radius) * 1000.0) / 1000.0);
    }
    (x, y)
}
