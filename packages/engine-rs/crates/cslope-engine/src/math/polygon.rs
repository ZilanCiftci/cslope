//! Port of packages/engine/src/math/polygon.ts
//!
//! Polygon area and point-in-polygon calculations.

/// Calculate the area of a polygon using the Shoelace formula (always
/// positive).
pub fn calculate_polygon_area(x: &[f64], y: &[f64]) -> f64 {
    let n = x.len();
    if n < 3 {
        return 0.0;
    }

    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        area += x[i] * y[j];
        area -= x[j] * y[i];
    }
    area.abs() / 2.0
}

/// Determine if a point (px, py) is inside a polygon using ray casting.
pub fn is_point_in_polygon(px: f64, py: f64, poly_x: &[f64], poly_y: &[f64]) -> bool {
    let n = poly_x.len();
    let mut inside = false;
    for i in 0..n {
        let j = (i + 1) % n;
        if (poly_y[i] > py) != (poly_y[j] > py)
            && px
                < ((poly_x[j] - poly_x[i]) * (py - poly_y[i])) / (poly_y[j] - poly_y[i] + 1e-15)
                    + poly_x[i]
        {
            inside = !inside;
        }
    }
    inside
}

/// Clip a polygon by a half-plane ax + by + c >= 0 (Sutherland–Hodgman).
///
/// Returns the clipped polygon as ([x], [y]).
pub fn clip_polygon_halfplane(
    px: &[f64],
    py: &[f64],
    a: f64,
    b: f64,
    c: f64,
) -> (Vec<f64>, Vec<f64>) {
    let n = px.len();
    if n == 0 {
        return (Vec::new(), Vec::new());
    }

    let mut out_x: Vec<f64> = Vec::new();
    let mut out_y: Vec<f64> = Vec::new();

    for i in 0..n {
        let k = (i + 1) % n;
        let (p1x, p1y) = (px[i], py[i]);
        let (p2x, p2y) = (px[k], py[k]);

        let d1 = a * p1x + b * p1y + c;
        let d2 = a * p2x + b * p2y + c;

        let in1 = d1 >= -1e-12;
        let in2 = d2 >= -1e-12;

        if in1 {
            if in2 {
                // Both inside
                out_x.push(p2x);
                out_y.push(p2y);
            } else {
                // Leaving boundary: add intersection
                let dx = p2x - p1x;
                let dy = p2y - p1y;
                let denom = a * dx + b * dy;
                if denom.abs() > 1e-14 {
                    let t = -d1 / denom;
                    out_x.push(p1x + t * dx);
                    out_y.push(p1y + t * dy);
                }
            }
        } else if in2 {
            // Entering boundary: add intersection then vertex
            let dx = p2x - p1x;
            let dy = p2y - p1y;
            let denom = a * dx + b * dy;
            if denom.abs() > 1e-14 {
                let t = -d1 / denom;
                out_x.push(p1x + t * dx);
                out_y.push(p1y + t * dy);
            }
            out_x.push(p2x);
            out_y.push(p2y);
        }
    }

    (out_x, out_y)
}

/// Clip a polygon to a vertical strip [x_min, x_max].
///
/// Returns the clipped polygon as ([x], [y]).
pub fn clip_polygon_vertical(
    poly_x: &[f64],
    poly_y: &[f64],
    x_min: f64,
    x_max: f64,
) -> (Vec<f64>, Vec<f64>) {
    // Clip against xMin: x >= xMin  →  1·x + 0·y - xMin >= 0
    let (mut rx, mut ry) = clip_polygon_halfplane(poly_x, poly_y, 1.0, 0.0, -x_min);
    // Clip against xMax: x <= xMax  →  -1·x + 0·y + xMax >= 0
    if !rx.is_empty() {
        (rx, ry) = clip_polygon_halfplane(&rx, &ry, -1.0, 0.0, x_max);
    }
    (rx, ry)
}

/// Whether `p` lies inside the closed ring `ring` (even–odd rule, as
/// [`is_point_in_polygon`]).
pub fn point_in_ring(p: [f64; 2], ring: &[[f64; 2]]) -> bool {
    let xs: Vec<f64> = ring.iter().map(|c| c[0]).collect();
    let ys: Vec<f64> = ring.iter().map(|c| c[1]).collect();
    is_point_in_polygon(p[0], p[1], &xs, &ys)
}

/// Whether `p` lies on the edges of the closed ring `ring`, within `tol`.
pub fn point_on_ring(p: [f64; 2], ring: &[[f64; 2]], tol: f64) -> bool {
    (0..ring.len()).any(|i| {
        let a = ring[i];
        let b = ring[(i + 1) % ring.len()];
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len2 = dx * dx + dy * dy;
        let t = if len2 > 0.0 {
            (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let (qx, qy) = (a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
        (qx * qx + qy * qy).sqrt() <= tol
    })
}
