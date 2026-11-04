//! Port of packages/engine/src/model/surface-slide.ts
//!
//! The infinite-slope factor of safety of the ground surface where it lies in
//! a purely frictional soil (c′ = 0 at the surface, φ′ > 0).
//!
//! A slab of vanishing depth sliding parallel to a face inclined at β has
//! F = tan φ′ / tan β, whatever its depth, when the soil above the slip plane
//! is dry or submerged in still water (Duncan, Wright & Brandon 2014, Soil
//! Strength and Slope Stability, 2nd ed., § 6.2; a uniform surface load
//! changes the normal and shear stress alike). It is the limit of shallow
//! planar surfaces of the methods of slices and an upper bound of limit
//! analysis (with c = 0 the slab dissipates nothing). The searches miss it:
//! the methods of slices discard surfaces below the minimum slip area, and
//! a finite element mesh cannot represent a slab thinner than its elements
//! (on V052a, rockfill φ′ = 45° on a 30.9° face, F = 1.67 against 1.78 by
//! strength reduction and 1.88 in another program's verification manual).
//!
//! Implementation choices (not from the literature): the faces are the
//! segments of the ground surface line, each sampled at nine points; a
//! sample counts when the material just below it is Mohr–Coulomb (constant
//! or spatial) with c′ = 0 and φ′ > 0 at the surface (design values, partial
//! factors applied) and its water line lies below the surface there (a water
//! line above the ground is clipped to it, so still water over a face cannot
//! be told from seepage out of it, under which the factor would be lower and
//! depend on the flow), and the material takes no strength from suction
//! (φb, which above the line acts as a cohesion). Faces steeper than 89.4°
//! (dx < dy/100: steps and walls) are skipped, as is a face that
//! reinforcement or a pile reaches (within 0.1 % of the model's extent),
//! whose head or facing holds it. For the methods of slices only faces
//! dipping in the analysed direction and within the search limits are
//! checked (`sliding_only`).

use crate::error::Result;
use crate::js;
use crate::math::interpolation::get_y_at_x;
use crate::math::polygon::is_point_in_polygon;
use crate::model::slope::Slope;
use crate::types::material_models::suction_angle;
use crate::types::strength::{design_strength, StrengthContext};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

/// Distance between segments ab and cd (zero when they cross).
#[allow(clippy::too_many_arguments)]
fn segment_distance(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64, dx: f64, dy: f64) -> f64 {
    let cross = |ox: f64, oy: f64, px: f64, py: f64, qx: f64, qy: f64| {
        (px - ox) * (qy - oy) - (py - oy) * (qx - ox)
    };
    let d1 = cross(ax, ay, bx, by, cx, cy);
    let d2 = cross(ax, ay, bx, by, dx, dy);
    let d3 = cross(cx, cy, dx, dy, ax, ay);
    let d4 = cross(cx, cy, dx, dy, bx, by);
    if d1 * d2 < 0.0 && d3 * d4 < 0.0 {
        return 0.0;
    }
    let to_seg = |px: f64, py: f64, sx: f64, sy: f64, ex: f64, ey: f64| {
        let vx = ex - sx;
        let vy = ey - sy;
        let l2 = vx * vx + vy * vy;
        let t = if l2 > 0.0 {
            js::math::min(
                1.0,
                js::math::max(0.0, ((px - sx) * vx + (py - sy) * vy) / l2),
            )
        } else {
            0.0
        };
        js::math::hypot(&[px - sx - t * vx, py - sy - t * vy])
    };
    js::math::min(
        js::math::min(
            js::math::min(
                to_seg(ax, ay, cx, cy, dx, dy),
                to_seg(bx, by, cx, cy, dx, dy),
            ),
            to_seg(cx, cy, ax, ay, bx, by),
        ),
        to_seg(dx, dy, ax, ay, bx, by),
    )
}

/// The face of the ground with the lowest infinite-slope factor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceSlide {
    /// tan φ′ / tan β of the face.
    pub factor_of_safety: f64,
    /// The face: its ends on the ground surface.
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub material: String,
    /// Friction angle (design value) and the face's inclination, degrees.
    pub friction_angle: f64,
    pub inclination: f64,
}

/// The face of the ground surface with the lowest infinite-slope factor, or
/// None when no face is in a frictional soil. Coordinates in model space (a
/// mirrored slope's x mirrored back). `sliding_only`: only faces dipping
/// towards +x (the canonical sliding direction) between the entry and exit
/// limits, as the methods of slices search (TypeScript's default: false).
pub fn frictional_surface_slide(slope: &Slope, sliding_only: bool) -> Result<Option<SurfaceSlide>> {
    let Some(line) = slope.surface_line_xy() else {
        return Ok(None);
    };
    let sx = &line.x;
    let sy = &line.y;
    let (ext_x, ext_y) = slope.external_boundary_xy();
    let x_min = js::math::min_of(ext_x);
    let x_max = js::math::max_of(ext_x);
    let span = js::math::max(
        x_max - x_min,
        js::math::max_of(ext_y) - js::math::min_of(ext_y),
    );
    let eps = 1e-6 * span;
    let [entry_left, _, _, exit_right] = slope.limits();
    let limited = sliding_only && exit_right > entry_left;
    let held: Vec<[f64; 4]> = slope
        .reinforcements()
        .iter()
        .map(|r| [r.x1, r.y1, r.x2, r.y2])
        .chain(slope.piles().iter().map(|r| [r.x1, r.y1, r.x2, r.y2]))
        .collect();
    let mut best: Option<SurfaceSlide> = None;
    let mut i = 0;
    while i + 1 < sx.len() {
        let x1 = sx[i];
        let y1 = sy[i];
        let x2 = sx[i + 1];
        let y2 = sy[i + 1];
        i += 1;
        let dx = (x2 - x1).abs();
        let dy = (y2 - y1).abs();
        if dx <= eps || dy <= eps || dx < dy / 100.0 {
            continue;
        }
        if sliding_only && (y2 - y1) * (x2 - x1) > 0.0 {
            continue;
        }
        if held
            .iter()
            .any(|r| segment_distance(x1, y1, x2, y2, r[0], r[1], r[2], r[3]) <= 1e-3 * span)
        {
            continue;
        }
        for k in 0..9 {
            let t = (k as f64 + 0.5) / 9.0;
            let x = x1 + t * (x2 - x1);
            let y = y1 + t * (y2 - y1);
            if limited && (x < entry_left || x > exit_right) {
                continue;
            }
            let Some(g) = slope
                .material_geometries()
                .iter()
                .find(|q| is_point_in_polygon(x, y - eps, &q.px, &q.py))
            else {
                continue;
            };
            let m = slope.material(g.material);
            let kind = m.model.kind();
            if kind != "mohr-coulomb" && kind != "spatial-mohr-coulomb" {
                continue;
            }
            let st = m.get_strength(&StrengthContext {
                y_bottom: y,
                x,
                y_ground: y,
                y_layer_top: None,
                alpha: 0.0,
                suction: None,
                effective_vertical_stress: None,
            })?;
            let d = design_strength(Some(kind), &st, slope.partial_factors());
            if d.undrained
                || d.cohesion > 0.0
                || !(d.tan_phi > 0.0)
                || (st.is_combined == Some(true) && d.cohesion_undrained.is_finite())
            {
                continue;
            }
            let wl = slope.get_water_line_for_material(Some(g.material));
            let yw = match wl {
                Some(wl) => get_y_at_x(&wl.x, &wl.y, x),
                None => f64::NAN,
            };
            if yw.is_finite() && yw >= y {
                continue;
            }
            // with φb the suction above the line is an apparent cohesion: a slab
            // of vanishing depth has strength to spare
            if yw.is_finite() && suction_angle(&m.model) > 0.0 {
                continue;
            }
            let f = (d.tan_phi * dx) / dy;
            if best.as_ref().is_none_or(|b| f < b.factor_of_safety) {
                best = Some(SurfaceSlide {
                    factor_of_safety: f,
                    x1: slope.to_model_x(x1)?,
                    y1,
                    x2: slope.to_model_x(x2)?,
                    y2,
                    material: m.name.clone(),
                    friction_angle: (js::math::atan(d.tan_phi) * 180.0) / PI,
                    inclination: (js::math::atan(dy / dx) * 180.0) / PI,
                });
            }
            break;
        }
    }
    Ok(best)
}

/// The warning text when the face's factor is below an analysis' factor of
/// safety `f`.
pub fn surface_slide_message(s: &SurfaceSlide, f: f64) -> String {
    let fx = |v: f64| js::num::to_fixed(v, 2);
    format!(
        "The ground surface from ({}, {}) to ({}, {}) in {} (c′ = 0, design φ′ = {}°) is inclined at {}°: a shallow slide parallel to it has F = tan φ′/tan β = {}, below {}. The analysis cannot represent so thin a slide; the slope face governs.",
        fx(s.x1),
        fx(s.y1),
        fx(s.x2),
        fx(s.y2),
        s.material,
        js::num::to_fixed(s.friction_angle, 1),
        js::num::to_fixed(s.inclination, 1),
        js::num::to_fixed(s.factor_of_safety, 3),
        js::num::to_fixed(f, 3),
    )
}
