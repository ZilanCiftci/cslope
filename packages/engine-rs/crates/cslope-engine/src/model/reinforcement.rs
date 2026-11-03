//! Port of packages/engine/src/model/reinforcement.ts
//!
//! Reinforcement forces on the sliding mass.
//!
//! The capacity available at a point s along an element (distance from
//! end 1, length L) is the smallest of its tensile capacity and the force
//! that pullout can develop from either end:
//!
//!   T(s) = min(Tmax, T1 + ∫₀ˢ r, T2 + ∫ₛᴸ r)
//!
//! with r the pullout resistance per metre and T1, T2 the end anchorage
//! capacities. Without pullout both ends are fully anchored (T = Tmax).
//! Forces are per metre of slope: capacities are divided by the spacing.

use crate::error::Result;
use crate::js;
use crate::math::interpolation::get_y_at_x;
use crate::math::polygon::is_point_in_polygon;
use crate::model::composite::unique_numbers;
use crate::model::geometry_ops::material_layer_top_at;
use crate::model::slope::Slope;
use crate::model::waternet::waternet_pore_pressure;
use crate::types::constants::WATER_UNIT_WEIGHT;
use crate::types::geometry::Slice;
use crate::types::material::MaterialId;
use crate::types::material_models::MaterialModel;
use crate::types::reinforcement::{
    Pile, PileForceDirection, PileForceLocation, Reinforcement, ReinforcementApplication,
    ReinforcementDirection, ReinforcementForce, ReinforcementPullout,
};
use crate::types::strength::{
    design_strength, needs_layer_top, resolve_strength, resolve_unit_weight, StrengthContext,
};
use std::f64::consts::PI;

/// Capacity envelope of one element, per element (not per metre).
#[derive(Debug, Clone, PartialEq)]
pub struct ReinforcementEnvelope {
    pub length: f64,
    /// Stations along the element (0..length, increasing).
    pub s: Vec<f64>,
    /// Pullout developed from end 1 up to each station, ∫₀ˢ r.
    pub from_end1: Vec<f64>,
    pub tensile: f64,
    pub end1: f64,
    pub end2: f64,
    /// Fully anchored ends: Tmax everywhere.
    pub anchored: bool,
    /// Development lengths from end 1 and end 2 (pullout kind
    /// "development"); then `s`/`from_end1` are unused.
    pub development: Option<[f64; 2]>,
}

fn material_at(slope: &Slope, x: f64, y: f64) -> Option<MaterialId> {
    slope
        .material_geometries()
        .iter()
        .find(|g| is_point_in_polygon(x, y, &g.px, &g.py))
        .map(|g| g.material)
}

/// Elevation of a material's water line at x (no material: the main line; −∞ without one).
fn water_line_at(slope: &Slope, m: Option<MaterialId>, x: f64) -> f64 {
    let Some(line) = slope.get_water_line_for_material(m) else {
        return f64::NEG_INFINITY;
    };
    let wy = get_y_at_x(&line.x, &line.y, x);
    if wy.is_finite() {
        wy
    } else {
        f64::NEG_INFINITY
    }
}

/// Unit weight at a point, γsat below the material's water line (as the slices weigh it).
fn unit_weight_at(slope: &Slope, m: MaterialId, x: f64, y: f64) -> f64 {
    let model = &slope.material(m).model;
    if let Some(gamma_sat) = model.base().unit_weight_sat {
        if y < water_line_at(slope, Some(m), x) {
            return gamma_sat;
        }
    }
    resolve_unit_weight(model, slope.material(m).unit_weight(), x, y)
}

/// Effective vertical stress at (x, y): the weight of the soil column
/// between the ground and the point (γsat below a material's water line)
/// less the pore pressure there.
pub fn effective_vertical_stress(slope: &Slope, x: f64, y: f64) -> f64 {
    vertical_stress(slope, x, y, true)
}

/// Vertical stress at (x, y) from the soil column (and ponded water) above
/// it: effective (σv − u) or total (σv, for undrained strengths, which are
/// total-stress parameters).
pub fn vertical_stress(slope: &Slope, x: f64, y: f64, effective: bool) -> f64 {
    let Some(surf) = slope.surface_line_xy() else {
        return 0.0;
    };
    let y_ground = get_y_at_x(&surf.x, &surf.y, x);
    if !y_ground.is_finite() || y >= y_ground {
        return 0.0;
    }
    let depth = y_ground - y;
    let n = js::math::min(100.0, js::math::max(4.0, (depth / 0.25).ceil()));
    let dz = depth / n;
    let mut sigma = 0.0;
    let mut k = 0.0;
    while k < n {
        let yy = y_ground - (k + 0.5) * dz;
        if let Some(m) = material_at(slope, x, yy) {
            sigma += unit_weight_at(slope, m, x, yy) * dz;
        }
        k += 1.0;
    }
    // Ponded water above the ground weighs on the column: the line of the
    // material just below the ground, as the slices and the Rankine depth
    // take it (freeWaterLineAt in slices.ts); the pore pressure at the point
    // comes from the line of the material there.
    // (the pore pressure ratio of the material at the point takes the soil
    // above it)
    let soil = sigma;
    let y_top = y_ground - 1e-6 * js::math::max(1.0, (surf.x[surf.x.len() - 1] - surf.x[0]).abs());
    let pond = water_line_at(slope, material_at(slope, x, y_top), x);
    sigma += js::math::max(0.0, pond - y_ground) * WATER_UNIT_WEIGHT;
    if !effective {
        return sigma;
    }
    let here = material_at(slope, x, y);
    let ru = here
        .and_then(|m| slope.material(m).model.base().ru)
        .unwrap_or(0.0);
    let u = match slope.waternet() {
        Some(wn) => waternet_pore_pressure(wn, x, y),
        None => water_pore_pressure(slope, here, x, y),
    };
    js::math::max(0.0, sigma - u - ru * soil)
}

/// Pore pressure at (x, y) below the water line of the material there (no waternet).
fn water_pore_pressure(slope: &Slope, m: Option<MaterialId>, x: f64, y: f64) -> f64 {
    js::math::max(0.0, water_line_at(slope, m, x) - y) * WATER_UNIT_WEIGHT
}

/// Effective vertical stress at (x, y) with the slope's distributed loads:
/// `effective_vertical_stress` plus each load over x, for the yield stress a
/// SHANSEP material keeps from an earlier stage (its geometry, water and
/// loads). A load acts as a strip load straight down, without spreading
/// with depth (as the slices take it on their bases); a load normal to the
/// ground counts with its vertical part, which is its magnitude per
/// horizontal metre. The loads are characteristic (the earlier stage is a
/// stress history, not a design state). The part of a load carried by
/// excess pore pressure in the material at the point (`excess_pore_pressure`)
/// does not count where the point is below the water (as the slices take
/// it). Reinforcement pullout uses `effective_vertical_stress`, without the
/// loads.
pub fn effective_vertical_stress_with_loads(slope: &Slope, x: f64, y: f64) -> f64 {
    let base = effective_vertical_stress(slope, x, y);
    let Some(surf) = slope.surface_line_xy() else {
        return base;
    };
    if slope.udls().is_empty() {
        return base;
    }
    let y_ground = get_y_at_x(&surf.x, &surf.y, x);
    if !y_ground.is_finite() || y >= y_ground {
        return base;
    }
    let mut q = 0.0;
    let mut here: Option<Option<MaterialId>> = None;
    let mut wet: Option<bool> = None;
    for l in slope.udls() {
        if x < l.x1 || x > l.x2 {
            continue;
        }
        let mut carried = l.magnitude;
        if !l.excess_pore_pressure.is_empty() {
            let h = *here.get_or_insert_with(|| material_at(slope, x, y));
            let e = h.and_then(|m| {
                let name = &slope.material(m).name;
                l.excess_pore_pressure.iter().find(|p| p.material == *name)
            });
            if let Some(e) = e {
                let w = *wet.get_or_insert_with(|| {
                    (match slope.waternet() {
                        Some(wn) => waternet_pore_pressure(wn, x, y),
                        None => water_pore_pressure(slope, h, x, y),
                    }) > 0.0
                });
                if w {
                    carried *= 1.0 - e.ratio;
                }
            }
        }
        q += carried;
    }
    base + q
}

/// cos 88°: the movement's component along an element that counts as pushing it.
fn near_normal() -> f64 {
    js::math::cos((88.0 * PI) / 180.0)
}

/// Whether a point lies below the ground surface.
fn in_soil(slope: &Slope, x: f64, y: f64) -> bool {
    let Some(surf) = slope.surface_line_xy() else {
        return true;
    };
    let g = get_y_at_x(&surf.x, &surf.y, x);
    !g.is_finite() || y < g
}

/// Stations (distance from end 1) where an element crosses the ground surface.
fn ground_crossings(slope: &Slope, r: &Reinforcement, length: f64) -> Vec<f64> {
    let Some(surf) = slope.surface_line_xy() else {
        return Vec::new();
    };
    if !(length > 0.0) {
        return Vec::new();
    }
    let mut out: Vec<f64> = Vec::new();
    let ex = r.x2 - r.x1;
    let ey = r.y2 - r.y1;
    let mut i = 0;
    while i + 1 < surf.x.len() {
        let bx = surf.x[i];
        let by = surf.y[i];
        let dx = surf.x[i + 1] - bx;
        let dy = surf.y[i + 1] - by;
        i += 1;
        let den = dx * ey - dy * ex;
        if den.abs() < 1e-14 * js::math::max(1.0, js::math::hypot(&[dx, dy]) * length) {
            continue;
        }
        let qx = r.x1 - bx;
        let qy = r.y1 - by;
        let u = (qx * ey - qy * ex) / den;
        let t = (qx * dy - qy * dx) / den;
        if u >= 0.0 && u <= 1.0 && t > 0.0 && t < 1.0 {
            out.push(t * length);
        }
    }
    out
}

/// Capacity envelope of an element in the slope (per element).
pub fn build_envelope(slope: &Slope, r: &Reinforcement) -> ReinforcementEnvelope {
    let length = js::math::hypot(&[r.x2 - r.x1, r.y2 - r.y1]);
    let base = ReinforcementEnvelope {
        length,
        s: vec![0.0, length],
        from_end1: vec![0.0; 2],
        tensile: r.tensile_capacity,
        end1: r.end1_capacity.unwrap_or(0.0),
        end2: r.end2_capacity.unwrap_or(0.0),
        anchored: false,
        development: None,
    };
    let Some(p) = &r.pullout else {
        return ReinforcementEnvelope {
            anchored: true,
            ..base
        };
    };
    match *p {
        ReinforcementPullout::Development { length1, length2 } => ReinforcementEnvelope {
            development: Some([length1, length2]),
            ..base
        },
        ReinforcementPullout::Bond {
            strength,
            bonded_length,
        } => {
            // Constant bond over the bonded length at end 2 (default: all of it),
            // where the element is in the soil: a part in the air (a head beyond
            // the face) develops nothing.
            let bonded = js::math::min(length, bonded_length.unwrap_or(length));
            let start = length - bonded;
            let mut breaks = vec![0.0, start, length];
            breaks.extend(ground_crossings(slope, r, length));
            let mut st = unique_numbers(breaks.into_iter().filter(|&v| v >= 0.0 && v <= length));
            js::array::sort_by(&mut st, |u, v| u - v);
            let mut from_end1 = vec![0.0; st.len()];
            for k in 1..st.len() {
                let mid = (st[k - 1] + st[k]) / 2.0;
                let t = mid / length;
                let rate = if mid > start
                    && in_soil(slope, r.x1 + t * (r.x2 - r.x1), r.y1 + t * (r.y2 - r.y1))
                {
                    strength
                } else {
                    0.0
                };
                from_end1[k] = from_end1[k - 1] + rate * (st[k] - st[k - 1]);
            }
            ReinforcementEnvelope {
                s: st,
                from_end1,
                ..base
            }
        }
        ReinforcementPullout::Interface {
            adhesion,
            friction_angle,
            coverage,
        } => {
            // Interface friction: r = 2(a + σ′v tan δ), integrated along the element.
            let n = js::math::min(200.0, js::math::max(20.0, (length / 0.1).ceil())) as usize;
            let nf = n as f64;
            let mut s = vec![0.0; n + 1];
            let mut from_end1 = vec![0.0; n + 1];
            let tan_delta = js::math::tan((friction_angle * PI) / 180.0);
            // r is per metre of slope; the envelope is kept per element (× spacing).
            let per_element = coverage.unwrap_or(1.0) * r.spacing.unwrap_or(1.0);
            let surf = slope.surface_line_xy();
            for k in 0..n {
                let t = (k as f64 + 0.5) / nf;
                let x = r.x1 + t * (r.x2 - r.x1);
                let y = r.y1 + t * (r.y2 - r.y1);
                // No interface outside the soil.
                let in_soil = surf.is_some_and(|surf| y < get_y_at_x(&surf.x, &surf.y, x));
                let rate = if in_soil {
                    2.0 * (adhesion + effective_vertical_stress(slope, x, y) * tan_delta)
                        * per_element
                } else {
                    0.0
                };
                s[k + 1] = ((k as f64 + 1.0) / nf) * length;
                from_end1[k + 1] = from_end1[k] + rate * (length / nf);
            }
            ReinforcementEnvelope {
                s,
                from_end1,
                ..base
            }
        }
    }
}

/// Pullout developed from end 1 up to distance s, ∫₀ˢ r (per element).
fn developed_from_end1(env: &ReinforcementEnvelope, s: f64) -> f64 {
    let st = &env.s;
    let from_end1 = &env.from_end1;
    let last = st.len() - 1;
    if s <= 0.0 {
        return 0.0;
    }
    if s >= env.length {
        return from_end1[last];
    }
    let mut k = 1;
    while k < last && st[k] < s {
        k += 1;
    }
    let span = st[k] - st[k - 1];
    let t = if span > 0.0 {
        (s - st[k - 1]) / span
    } else {
        1.0
    };
    from_end1[k - 1] + t * (from_end1[k] - from_end1[k - 1])
}

/// Pullout resistance beyond distance s towards end 2 (per element): the
/// end-2 anchorage plus the pullout developed between s and end 2 — what a
/// pullout table gives for the resisting zone behind a failure surface.
pub fn pullout_beyond(env: &ReinforcementEnvelope, s: f64) -> f64 {
    if env.anchored {
        return f64::INFINITY;
    }
    if let Some([_, l2]) = env.development {
        return if l2 > 0.0 {
            env.end2 + (env.tensile * js::math::max(0.0, env.length - s)) / l2
        } else {
            f64::INFINITY
        };
    }
    env.end2 + env.from_end1[env.from_end1.len() - 1] - developed_from_end1(env, s)
}

/// Capacity (per element) at distance s from end 1.
pub fn envelope_at(env: &ReinforcementEnvelope, s: f64) -> f64 {
    if env.anchored {
        return env.tensile;
    }
    if let Some([l1, _]) = env.development {
        // Linear development over each length; length 0: fully anchored end.
        let from1 = if l1 > 0.0 {
            env.end1 + (env.tensile * js::math::max(0.0, s)) / l1
        } else {
            f64::INFINITY
        };
        return js::math::max(
            0.0,
            js::math::min(js::math::min(env.tensile, from1), pullout_beyond(env, s)),
        );
    }
    let developed = developed_from_end1(env, s);
    js::math::max(
        0.0,
        js::math::min(
            js::math::min(env.tensile, env.end1 + developed),
            pullout_beyond(env, s),
        ),
    )
}

/// A crossing of a line with a slice base.
struct Crossing {
    /// Index of the slice.
    slice: usize,
    /// Crossing point.
    px: f64,
    py: f64,
    /// Position along the line, 0 (start) – 1 (end).
    t: f64,
    /// Direction of movement along the base (towards +x).
    tx: f64,
    ty: f64,
}

/// Crossings of a line with the slice bases of a slip surface; a crossing
/// at a slice edge lies on both slices' bases and is reported once.
fn crossings(slices: &[Slice], x1: f64, y1: f64, x2: f64, y2: f64) -> Vec<Crossing> {
    let ex = x2 - x1;
    let ey = y2 - y1;
    let len = js::math::hypot(&[ex, ey]);
    let mut out: Vec<Crossing> = Vec::new();
    if !(len > 0.0) {
        return out;
    }
    for (index, s) in slices.iter().enumerate() {
        let bx0 = s.x_left;
        let by0 = s.y0_bottom;
        let bdx = s.x_right - s.x_left;
        let bdy = s.y1_bottom - s.y0_bottom;
        let blen = js::math::hypot(&[bdx, bdy]);
        if !(blen > 0.0) {
            continue;
        }
        let denom = bdx * ey - bdy * ex;
        if denom.abs() < 1e-12 * blen * len {
            continue; // parallel
        }
        let qx = x1 - bx0;
        let qy = y1 - by0;
        let u = (qx * ey - qy * ex) / denom;
        let t = (qx * bdy - qy * bdx) / denom;
        if u < 0.0 || u > 1.0 || t < 0.0 || t > 1.0 {
            continue;
        }
        let px = bx0 + u * bdx;
        let py = by0 + u * bdy;
        if out
            .iter()
            .any(|c| (c.px - px).abs() < 1e-9 && (c.py - py).abs() < 1e-9)
        {
            continue;
        }
        out.push(Crossing {
            slice: index,
            px,
            py,
            t,
            tx: bdx / blen,
            ty: bdy / blen,
        });
    }
    out
}

/// Add a force (fx, fy per metre, +x sliding, +y up) acting at `at` (the
/// crossing [force.x, force.y] unless given) to a slice's reinforcement
/// loads; (cx, cy) the centre / axis point.
fn add_force(s: &mut Slice, force: ReinforcementForce, cx: f64, cy: f64, at: Option<[f64; 2]>) {
    let at = at.unwrap_or([force.x, force.y]);
    let f_down = -force.fy;
    // Moment beyond fDown·dx, which the solvers take with the slice load;
    // the force acts at `at` (the crossing unless given).
    let moment = f_down * (cx - at[0]) + force.fx * (cy - at[1]) - f_down * s.dx;
    let load = if force.passive {
        s.reinforcement_passive.get_or_insert([0.0, 0.0, 0.0])
    } else {
        s.reinforcement_active.get_or_insert([0.0, 0.0, 0.0])
    };
    load[0] += f_down;
    load[1] += force.fx;
    load[2] += moment;
    s.reinforcement_forces
        .get_or_insert_with(Vec::new)
        .push(force);
}

/// Apply the reinforcement forces to the slices of a slip surface: where
/// an element crosses a slice base, its force acts on that slice at the
/// crossing. The force pulls the sliding mass towards the part of the
/// element in stable ground; an element that the movement would push
/// (compress) carries nothing. (cx, cy) is the centre / axis point for
/// moments, the solvers' convention: driving moment of a force
/// (Fx, Fdown) at (x, y) is Fdown·(cx − x) + Fx·(cy − y).
///
/// Returns the applied forces.
pub fn apply_reinforcement(
    slope: &Slope,
    slices: &mut [Slice],
    cx: f64,
    cy: f64,
) -> Result<Vec<ReinforcementForce>> {
    let mut forces: Vec<ReinforcementForce> = Vec::new();
    if slices.is_empty() {
        return Ok(forces);
    }
    let elements = slope.reinforcements();
    let envelopes: &[ReinforcementEnvelope] = if !elements.is_empty() {
        slope.reinforcement_envelopes()
    } else {
        &[]
    };
    let near_normal = near_normal();
    for (k, r) in elements.iter().enumerate() {
        let env = &envelopes[k];
        if !(env.length > 0.0) {
            continue;
        }
        let ax = (r.x2 - r.x1) / env.length;
        let ay = (r.y2 - r.y1) / env.length;
        for c in crossings(slices, r.x1, r.y1, r.x2, r.y2) {
            let Crossing {
                slice,
                px,
                py,
                t,
                tx,
                ty,
            } = c;
            // Stable side: +a points into the sliding mass when it lies above
            // (to the left of) the base direction.
            let into = tx * ay - ty * ax > 0.0;
            let dx = if into { -ax } else { ax };
            let dy = if into { -ay } else { ay };
            // Tension only: the movement must pull away from the stable part. An
            // element within 2° of the normal to the base (the movement neither
            // pulls nor pushes it appreciably) still carries its force along
            // itself, as commercial programs apply it whatever the angle.
            let along = dx * tx + dy * ty;
            if along >= near_normal {
                continue;
            }
            let magnitude = envelope_at(env, t * env.length) / r.spacing.unwrap_or(1.0);
            if !(magnitude > 0.0) {
                continue;
            }
            let direction = if along > 0.0 {
                ReinforcementDirection::Axial
            } else {
                r.direction.unwrap_or(ReinforcementDirection::Axial)
            };
            let (fx, fy) = match direction {
                ReinforcementDirection::Tangent => (-tx, -ty),
                ReinforcementDirection::Bisector => {
                    let bxv = dx - tx;
                    let byv = dy - ty;
                    let bl = js::math::hypot(&[bxv, byv]);
                    (bxv / bl, byv / bl)
                }
                ReinforcementDirection::Axial => (dx, dy),
            };
            let force = ReinforcementForce {
                index: k,
                pile: None,
                x: px,
                y: py,
                fx: fx * magnitude,
                fy: fy * magnitude,
                force: magnitude,
                passive: r.application.unwrap_or(ReinforcementApplication::Active)
                    == ReinforcementApplication::Passive,
            };
            add_force(&mut slices[slice], force.clone(), cx, cy, None);
            forces.push(force);
        }
    }

    // Piles push back against the movement: tilted by their angle, along
    // the slip surface or perpendicular to the pile.
    let profiles: &[Option<PileProfile>] = if !slope.piles().is_empty() {
        slope.pile_profiles()?
    } else {
        &[]
    };
    for (k, p) in slope.piles().iter().enumerate() {
        for c in crossings(slices, p.x1, p.y1, p.x2, p.y2) {
            let Crossing {
                slice,
                px,
                py,
                tx,
                ty,
                ..
            } = c;
            let PileForce {
                per_metre: magnitude,
                resultant_above,
                ..
            } = pile_force(slope, p, px, py, profiles[k].as_ref());
            if !(magnitude > 0.0) {
                continue;
            }
            let [ux, uy] = pile_force_direction(p, tx, ty);
            let force = ReinforcementForce {
                index: k,
                pile: Some(true),
                x: px,
                y: py,
                fx: magnitude * ux,
                fy: magnitude * uy,
                force: magnitude,
                passive: p.application.unwrap_or(ReinforcementApplication::Active)
                    == ReinforcementApplication::Passive,
            };
            // The soil pressure acts on the pile from its head (or the ground)
            // down to the slip surface, so its moment about the centre is that
            // of the resultant, `resultantAbove` up the pile from the crossing:
            // at the crossing the arm of a horizontal force is the longest it
            // can be, and the pile's moment came out about 5 % too large (V013c).
            let mut at: [f64; 2] = [px, py];
            if p.location.unwrap_or(PileForceLocation::Centroid) == PileForceLocation::Centroid
                && resultant_above > 0.0
            {
                let len = js::math::hypot(&[p.x2 - p.x1, p.y2 - p.y1]);
                let up = if p.y1 >= p.y2 { 1.0 } else { -1.0 };
                if len > 0.0 {
                    at = [
                        px + (up * (p.x1 - p.x2) / len) * resultant_above,
                        py + (up * (p.y1 - p.y2) / len) * resultant_above,
                    ];
                }
            }
            add_force(&mut slices[slice], force.clone(), cx, cy, Some(at));
            forces.push(force);
        }
    }
    Ok(forces)
}

/// Unit direction of a pile's force on the sliding mass (+x sliding, +y up)
/// for the movement (tx, ty) along the slip surface at the crossing.
pub fn pile_force_direction(p: &Pile, tx: f64, ty: f64) -> [f64; 2] {
    // (an unknown direction, which `set_piles` rejects, is "angle" here as
    // in TypeScript)
    let direction = p.direction.clone().unwrap_or(PileForceDirection::Angle);
    if direction == PileForceDirection::Tangent {
        return [-tx, -ty];
    }
    if direction == PileForceDirection::Perpendicular {
        let len = js::math::hypot(&[p.x2 - p.x1, p.y2 - p.y1]);
        if len > 0.0 {
            // Normal of the pile axis, the one opposing the movement.
            let mut nx = -(p.y2 - p.y1) / len;
            let mut ny = (p.x2 - p.x1) / len;
            let along = nx * tx + ny * ty;
            if along > 0.0 || (along == 0.0 && nx > 0.0) {
                nx = -nx;
                ny = -ny;
            }
            return [nx, ny];
        }
    }
    let a = (p.angle.unwrap_or(0.0) * PI) / 180.0;
    [-js::math::cos(a), js::math::sin(a)]
}

/// Ito & Matsui (1975) coefficients of the lateral pressure on a pile,
/// p(z) = c·A1 + γ·z·A2, for clear spacing D1, diameter D and friction
/// angle φ. The φ = 0 solution (their Eq. 23) is a lower bound for every φ:
/// the c-φ expressions dip below it at small φ, which is unphysical.
#[allow(non_snake_case)]
pub fn ito_matsui_coefficients(D1: f64, D: f64, phi_deg: f64) -> [f64; 2] {
    let S = D1 + D;
    let A1phi0 =
        S * (3.0 * js::math::log(S / D1) + (D / D1) * js::math::tan(PI / 8.0) - 2.0) + 2.0 * D1;
    let A2phi0 = D;
    if phi_deg < 0.01 {
        return [A1phi0, A2phi0];
    }
    let phi = (phi_deg * PI) / 180.0;
    let Nphi = js::math::pow(js::math::tan(PI / 4.0 + phi / 2.0), 2.0);
    let sN = Nphi.sqrt();
    let tp = js::math::tan(phi);
    let R = js::math::pow(S / D1, sN * tp + Nphi - 1.0);
    let E = js::math::exp((D / D1) * Nphi * tp * js::math::tan(PI / 8.0 + phi / 4.0));
    let A2 = (S * R * E - D1) / Nphi;
    let F = (2.0 * tp + 2.0 * sN + 1.0 / sN) / (sN * tp + Nphi - 1.0);
    let A1 =
        (S * R * (E - 2.0 * sN * tp - 1.0)) / (Nphi * tp) + S * F * (R - 1.0) + (2.0 * D1) / sN;
    [js::math::max(A1, A1phi0), js::math::max(A2, A2phi0)]
}

/// Ito & Matsui pressure on a vertical pile, integrated down from its head
/// (or the ground, if lower): at depths z[k] below the ground, the force
/// F[k] = ∫p dz and the moment Q[k] = ∫p·z dz per pile. Strength as in the
/// analysis (design values with partial factors), γz as the effective
/// vertical stress (γ as the slices weigh it, less the pore pressure).
#[derive(Debug, Clone, PartialEq)]
pub struct PileProfile {
    pub z: Vec<f64>,
    pub f: Vec<f64>,
    pub q: Vec<f64>,
}

const PROFILE_STEP: f64 = 0.05;

pub fn build_pile_profile(slope: &Slope, p: &Pile) -> Result<Option<PileProfile>> {
    let (None, Some(d)) = (p.force, p.diameter) else {
        return Ok(None);
    };
    let x = p.x1;
    let y_ground = match slope.surface_line_xy() {
        Some(surf) => get_y_at_x(&surf.x, &surf.y, x),
        None => f64::NAN,
    };
    if !y_ground.is_finite() {
        return Ok(None);
    }
    let z_top = js::math::max(0.0, y_ground - js::math::max(p.y1, p.y2));
    let z_tip = js::math::max(z_top, y_ground - js::math::min(p.y1, p.y2));
    let d1 = p.spacing.unwrap_or(1.0) - d;
    let f = slope.partial_factors();
    let n = js::math::max(1.0, ((z_tip - z_top) / PROFILE_STEP).ceil()) as usize;
    let nf = n as f64;
    let dz = (z_tip - z_top) / nf;
    let mut z = vec![0.0; n + 1];
    let mut force = vec![0.0; n + 1];
    let mut moment = vec![0.0; n + 1];
    z[0] = z_top;
    for k in 0..n {
        let zm = z_top + (k as f64 + 0.5) * dz;
        let yy = y_ground - zm;
        let mut pz = 0.0;
        if let Some(m) = material_at(slope, x, yy) {
            let model: &MaterialModel = &slope.material(m).model;
            let y_layer_top = if needs_layer_top(model) {
                material_layer_top_at(slope.material_geometries(), m, x, yy)
            } else {
                None
            };
            let st = resolve_strength(
                model,
                &StrengthContext {
                    y_bottom: yy,
                    x,
                    y_ground,
                    y_layer_top,
                    alpha: 0.0,
                    suction: None,
                    effective_vertical_stress: if model.kind() == "shansep" {
                        Some(effective_vertical_stress(slope, x, yy))
                    } else {
                        None
                    },
                },
            )?;
            // High-strength or bedrock: no soil to squeeze between the piles.
            if st.cohesion.is_finite() && !st.impenetrable.unwrap_or(false) {
                let ds = design_strength(Some(model.kind()), &st, f);
                let [a1, a2] =
                    ito_matsui_coefficients(d1, d, (js::math::atan(ds.tan_phi) * 180.0) / PI);
                // The overburden term is the effective vertical stress σ′v = γz − u
                // of the soil squeezed between the piles: Ito & Matsui (1975) with
                // effective parameters, γ′ below the water table as in Poulos
                // (1995) and Hassiotis et al. (1997). The pore pressure itself acts
                // on both faces of the pile and gives it no net force. An undrained
                // strength is a total-stress parameter, so there the overburden is
                // the total vertical stress (Ito & Matsui's φ = 0 case).
                pz = ds.cohesion * a1 + vertical_stress(slope, x, yy, !ds.undrained) * a2;
                if st.is_combined.unwrap_or(false) {
                    // A combined material (lime-cement columns in their drained
                    // limit, Mohr-Coulomb with cFactor) is as strong as the lower of
                    // its drained and undrained strength, as on the slice bases
                    // (solvers): the soil between the piles then flows at the
                    // undrained pressure, Ito & Matsui's φ = 0 case with the total
                    // vertical stress.
                    let [a1u, a2u] = ito_matsui_coefficients(d1, d, 0.0);
                    pz = js::math::min(
                        pz,
                        ds.cohesion_undrained * a1u + vertical_stress(slope, x, yy, false) * a2u,
                    );
                }
            }
        }
        z[k + 1] = z_top + (k as f64 + 1.0) * dz;
        force[k + 1] = force[k] + pz * dz;
        moment[k + 1] = moment[k] + pz * zm * dz;
    }
    Ok(Some(PileProfile {
        z,
        f: force,
        q: moment,
    }))
}

/// What governs a pile's force.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PileGoverns {
    Given,
    Soil,
    Shear,
    Bending,
}

impl PileGoverns {
    pub fn as_str(self) -> &'static str {
        match self {
            PileGoverns::Given => "given",
            PileGoverns::Soil => "soil",
            PileGoverns::Shear => "shear",
            PileGoverns::Bending => "bending",
        }
    }
}

/// Force of a pile where the slip surface crosses it (see `pile_force`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PileForce {
    pub per_pile: f64,
    pub per_metre: f64,
    pub governs: PileGoverns,
    /// Distance of the soil pressure's resultant above the crossing (m); 0 for a given force.
    pub resultant_above: f64,
}

/// Force of a pile where the slip surface crosses it at (x, y): per pile
/// and per metre of slope, and what governs it. `profile` is the pile's
/// profile (`Slope::pile_profiles`; TypeScript builds it when not given,
/// see `pile_force_with_profile`).
pub fn pile_force(
    slope: &Slope,
    p: &Pile,
    x: f64,
    y: f64,
    profile: Option<&PileProfile>,
) -> PileForce {
    let spacing = p.spacing.unwrap_or(1.0);
    let y_ground = match slope.surface_line_xy() {
        Some(surf) => get_y_at_x(&surf.x, &surf.y, x),
        None => f64::NAN,
    };
    let zf = if y_ground.is_finite() {
        js::math::max(0.0, y_ground - y)
    } else {
        0.0
    };
    // Loaded from the pile head (or the ground, if lower) to the crossing.
    let z_top = if y_ground.is_finite() {
        js::math::max(0.0, y_ground - js::math::max(p.y1, p.y2))
    } else {
        0.0
    };
    let mut per_pile: f64;
    let mut governs: PileGoverns;
    let mut resultant_above = 0.0;
    // Arm of the soil pressure above the slip surface, for the bending limit.
    let mut arm = js::math::max(0.0, zf - z_top) / 3.0;
    match (p.force, profile) {
        (None, Some(profile)) => {
            let PileProfile { z, f, q } = profile;
            let last = z.len() - 1;
            let mut force = 0.0;
            let mut moment = 0.0;
            if zf > z[0] {
                let mut k = 1;
                while k < last && z[k] < zf {
                    k += 1;
                }
                let span = z[k] - z[k - 1];
                let t = if span > 0.0 {
                    js::math::min(1.0, (zf - z[k - 1]) / span)
                } else {
                    1.0
                };
                force = f[k - 1] + t * (f[k] - f[k - 1]);
                // ∫p·(zf − z) dz about the slip surface.
                moment = zf * force - (q[k - 1] + t * (q[k] - q[k - 1]));
            }
            per_pile = force;
            governs = PileGoverns::Soil;
            if force > 0.0 {
                resultant_above = moment / force;
                arm = resultant_above;
            }
        }
        _ => {
            per_pile = p.force.unwrap_or(0.0);
            governs = PileGoverns::Given;
        }
    }
    if let Some(sc) = p.shear_capacity {
        if sc < per_pile {
            per_pile = sc;
            governs = PileGoverns::Shear;
        }
    }
    if let Some(mc) = p.moment_capacity {
        if arm > 0.0 && mc / arm < per_pile {
            per_pile = mc / arm;
            governs = PileGoverns::Bending;
        }
    }
    PileForce {
        per_pile,
        per_metre: per_pile / spacing,
        governs,
        resultant_above,
    }
}

/// `pileForce(slope, p, x, y)` without a profile: built for the pile, as
/// TypeScript's default argument does.
pub fn pile_force_with_profile(slope: &Slope, p: &Pile, x: f64, y: f64) -> Result<PileForce> {
    let profile = build_pile_profile(slope, p)?;
    Ok(pile_force(slope, p, x, y, profile.as_ref()))
}
