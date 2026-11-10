//! `InteriorPointArea` of jsts 2.12.1 for one polygon: the midpoint of the
//! widest interior section of a horizontal scan line at the y midway
//! between the two vertex ordinates nearest the centre of the envelope.

use super::algorithm::{assert_true, Coord, Envelope, JtsResult};
use super::polygonize::Polygon;

fn avg(a: f64, b: f64) -> f64 {
    (a + b) / 2.0
}

/// `ScanLineYOrdinateFinder.getScanLineY`.
fn scan_line_y(poly: &Polygon, env: &Envelope) -> f64 {
    let mut hi_y = env.maxy;
    let mut lo_y = env.miny;
    let centre_y = avg(lo_y, hi_y);
    for ring in std::iter::once(&poly.shell).chain(poly.holes.iter()) {
        for p in ring {
            let y = p.y;
            if y <= centre_y {
                if y > lo_y {
                    lo_y = y;
                }
            } else if y > centre_y && y < hi_y {
                hi_y = y;
            }
        }
    }
    avg(hi_y, lo_y)
}

/// `InteriorPointPolygon.intersection`.
fn intersection(p0: &Coord, p1: &Coord, y: f64) -> f64 {
    let x0 = p0.x;
    let x1 = p1.x;
    if x0 == x1 {
        return x0;
    }
    let seg_dx = x1 - x0;
    let seg_dy = p1.y - p0.y;
    let m = seg_dy / seg_dx;
    x0 + (y - p0.y) / m
}

/// `getInteriorPoint()` of a polygon (`None` for an empty one).
pub fn interior_point(poly: &Polygon) -> JtsResult<Option<Coord>> {
    let Some(env) = Envelope::of_coords(&poly.shell) else {
        return Ok(None);
    };
    let y = scan_line_y(poly, &env);
    let mut interior = poly.shell[0];
    let mut crossings: Vec<f64> = Vec::new();
    for ring in std::iter::once(&poly.shell).chain(poly.holes.iter()) {
        let Some(renv) = Envelope::of_coords(ring) else {
            continue;
        };
        if y < renv.miny || y > renv.maxy {
            continue;
        }
        for i in 1..ring.len() {
            let (p0, p1) = (&ring[i - 1], &ring[i]);
            // intersectsHorizontalLine
            if (p0.y > y && p1.y > y) || (p0.y < y && p1.y < y) {
                continue;
            }
            // isEdgeCrossingCounted
            if p0.y == p1.y {
                continue;
            }
            if p0.y == y && p1.y < y {
                continue;
            }
            if p1.y == y && p0.y < y {
                continue;
            }
            crossings.push(intersection(p0, p1, y));
        }
    }
    // findBestMidpoint
    if !crossings.is_empty() {
        assert_true(
            crossings.len().is_multiple_of(2),
            "Interior Point robustness failure: odd number of scanline crossings",
        )?;
        crate::js::array::sort_by(&mut crossings, |a, b| {
            if a < b {
                -1.0
            } else if a > b {
                1.0
            } else {
                0.0
            }
        });
        let mut width_best = 0.0;
        for k in (0..crossings.len()).step_by(2) {
            let (x1, x2) = (crossings[k], crossings[k + 1]);
            let width = x2 - x1;
            if width > width_best {
                width_best = width;
                interior = Coord::new(avg(x1, x2), y);
            }
        }
    }
    Ok(Some(interior))
}
