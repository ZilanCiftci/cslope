//! Port of packages/engine/src/model/slices.ts
//!
//! Slice creation and generation for slope stability analysis.
//!
//! The hot path follows ARCHITECTURE.md §1.4: `create_slice` takes the
//! per-surface context (`SliceEnv`: the material table, the regions and the
//! water / base / pore pressure functions TypeScript passes as closures) and
//! a `SliceScratch` with the clip buffers TypeScript keeps at module level,
//! so that a slice needs no heap work in the common case. The arithmetic is
//! TypeScript's, in the same order.

use crate::error::{EngineError, Result};
use crate::js;
use crate::math::circle::{get_circle_line_intersections, get_circle_y_coordinate_at_x};
use crate::math::interpolation::{get_y_at_x, get_y_at_x_many};
use crate::math::loads::calculate_all_loads;
use crate::math::polygon::is_point_in_polygon;
use crate::model::composite::{floor_dip_tolerance, floor_y_at};
use crate::model::geometry_ops::{material_layer_top_at, polyline_y_from, Polyline, Side};
use crate::model::reinforcement::{apply_reinforcement, effective_vertical_stress_with_loads};
use crate::model::slope::{Pt, Slope};
use crate::model::surface::{polyline_crossings_x, polyline_y_at};
use crate::model::waternet::waternet_pore_pressure;
use crate::types::analysis::{PartialFactors, PorePressureHead};
use crate::types::constants::{SLICE_DEDUP_TOLERANCE, WATER_UNIT_WEIGHT};
use crate::types::geometry::{GeometryWithMaterial, Slice};
use crate::types::loads::{Udl, UdlDirection};
use crate::types::material::{Material, MaterialId};
use crate::types::material_models::{suction_angle, MaterialModel, ShansepModel};
use crate::types::strength::{
    design_strength, needs_layer_top, resolve_strength, resolve_unit_weight, ResolvedStrength,
    StrengthContext,
};
use std::f64::consts::PI;
use std::sync::Arc;

// ── createSlice ───────────────────────────────────────────────────

/// Grid of the local origin for clipping material regions (see create_slice).
const LOCAL_ORIGIN_GRID: f64 = 4096.0;

/// Largest arc a slice of a circle spans, at least (rad); see get_slices.
const MAX_SLICE_ARC: f64 = (2.0 * PI) / 180.0;

/// Most segments of the arc under a slice (create_slice).
const MAX_ARC_SEGMENTS: usize = 32;

/// The base of a slice of a circle (not a port: an experiment switch, see
/// PORTING.md "Slice base of a circle"). `Arc` is the engine's: the arc
/// length, α at the middle of the arc and the weight of the soil above the
/// arc. `Chord` is the conventional straight chord between the slice's
/// edges, as most limit equilibrium programs discretise a circle: the
/// chord's length and inclination (the same α: a chord is parallel to the
/// tangent at the middle of its arc) and the weight of the polygon above the
/// chord, with the base point (pore pressure, strength) at the chord's
/// middle. `ChordEven` is the chord without the steep ends of the circle
/// cut into narrower slices (get_slices), i.e. the nominal slices only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SliceBase {
    Arc,
    Chord,
    ChordEven,
}

thread_local! {
    static SLICE_BASE_OVERRIDE: std::cell::Cell<Option<SliceBase>> = const { std::cell::Cell::new(None) };
}

/// The slice base of a circle in force: the override of `with_slice_base`
/// on this thread, else the environment variable `CSLOPE_SLICE_BASE`
/// (`chord`, `chord-even`; read once; absent in WebAssembly), else `Arc`.
pub fn slice_base() -> SliceBase {
    if let Some(b) = SLICE_BASE_OVERRIDE.with(|c| c.get()) {
        return b;
    }
    static FROM_ENV: std::sync::OnceLock<SliceBase> = std::sync::OnceLock::new();
    *FROM_ENV.get_or_init(|| match std::env::var("CSLOPE_SLICE_BASE").as_deref() {
        Ok("chord") => SliceBase::Chord,
        Ok("chord-even") => SliceBase::ChordEven,
        _ => SliceBase::Arc,
    })
}

/// Runs `f` with the slices of circles built on `base` on this thread (a
/// serial analysis; the evaluator's worker threads read the environment).
pub fn with_slice_base<T>(base: SliceBase, f: impl FnOnce() -> T) -> T {
    let before = SLICE_BASE_OVERRIDE.with(|c| c.replace(Some(base)));
    let out = f();
    SLICE_BASE_OVERRIDE.with(|c| c.set(before));
    out
}

// ── Clipping buffers ──────────────────────────────────────────────
// A slice clips every material polygon by the vertical strip, then by
// each slip-surface edge (two on a straight base, more along an arc).
// Done with fresh arrays and `map` passes, the allocation was a fifth of a
// whole search. The clips below write into two reused buffers instead, with
// the same arithmetic in the same order, so the results are identical to
// the last bit. (TypeScript keeps the buffers at module level; here they
// are a scratch passed by `&mut`, one per thread.)

/// The clip buffers of `create_slice` (TypeScript's module-level `bufAx`…).
#[derive(Debug, Clone, Default)]
pub struct SliceScratch {
    ax: Vec<f64>,
    ay: Vec<f64>,
    bx: Vec<f64>,
    by: Vec<f64>,
    /// A fragment in global coordinates (spatially varying unit weight).
    gx: Vec<f64>,
    gy: Vec<f64>,
}

impl SliceScratch {
    pub fn new() -> Self {
        SliceScratch {
            ax: vec![0.0; 64],
            ay: vec![0.0; 64],
            bx: vec![0.0; 64],
            by: vec![0.0; 64],
            gx: Vec::new(),
            gy: Vec::new(),
        }
    }

    /// Make both buffer pairs hold at least `n` vertices (TypeScript's
    /// `ensureClipCapacity`; the capacity does not change any result).
    fn ensure(&mut self, n: usize) {
        if self.ax.len() >= n && self.bx.len() >= n {
            return;
        }
        let mut cap = self.ax.len().max(1);
        while cap < n {
            cap *= 2;
        }
        self.ax.resize(cap, 0.0);
        self.ay.resize(cap, 0.0);
        self.bx.resize(cap, 0.0);
        self.by.resize(cap, 0.0);
    }
}

/// Clip the polygon in (in_x, in_y)[0..n) by the half-plane ax + by + c ≥ 0
/// (Sutherland–Hodgman) into (out_x, out_y); returns the vertex count. Same
/// arithmetic as `clip_polygon_halfplane` in math/polygon.rs.
#[allow(clippy::too_many_arguments)]
fn clip_halfplane_into(
    in_x: &[f64],
    in_y: &[f64],
    n: usize,
    a: f64,
    b: f64,
    c: f64,
    out_x: &mut [f64],
    out_y: &mut [f64],
) -> usize {
    if n == 0 {
        return 0;
    }
    let (in_x, in_y) = (&in_x[..n], &in_y[..n]);
    // A convex clip of n vertices yields at most 2n (one crossing per edge
    // plus the vertex): the writes stay in bounds.
    let (out_x, out_y) = (&mut out_x[..2 * n], &mut out_y[..2 * n]);
    let mut m = 0;
    let (mut p1x, mut p1y) = (in_x[n - 1], in_y[n - 1]);
    let mut d1 = a * p1x + b * p1y + c;
    for (&p2x, &p2y) in in_x.iter().zip(in_y) {
        let d2 = a * p2x + b * p2y + c;
        let (in1, in2) = (d1 >= -1e-12, d2 >= -1e-12);
        if in1 != in2 {
            let dx = p2x - p1x;
            let dy = p2y - p1y;
            let denom = a * dx + b * dy;
            if denom.abs() > 1e-14 {
                let t = -d1 / denom;
                out_x[m] = p1x + t * dx;
                out_y[m] = p1y + t * dy;
                m += 1;
            }
        }
        if in2 {
            out_x[m] = p2x;
            out_y[m] = p2y;
            m += 1;
        }
        p1x = p2x;
        p1y = p2y;
        d1 = d2;
    }
    m
}

/// Clip the polygon in (in_x, in_y)[0..n) to the side of the vertical line
/// x = xc given by `keep_right` (x ≥ xc, else x ≤ xc) into (out_x, out_y);
/// returns the vertex count. The vertical case of `clip_halfplane_into`,
/// with the same arithmetic for the sides and the crossings.
fn clip_vertical_into(
    in_x: &[f64],
    in_y: &[f64],
    n: usize,
    xc: f64,
    keep_right: bool,
    out_x: &mut [f64],
    out_y: &mut [f64],
) -> usize {
    let (in_x, in_y) = (&in_x[..n], &in_y[..n]);
    let (out_x, out_y) = (&mut out_x[..2 * n], &mut out_y[..2 * n]);
    let side = |x: f64| if keep_right { x - xc } else { xc - x };
    let mut m = 0;
    let (mut p1x, mut p1y) = match n {
        0 => return 0,
        _ => (in_x[n - 1], in_y[n - 1]),
    };
    let mut in1 = side(p1x) >= -1e-12;
    for (&p2x, &p2y) in in_x.iter().zip(in_y) {
        let in2 = side(p2x) >= -1e-12;
        if in1 != in2 {
            let dx = p2x - p1x;
            if dx.abs() > 1e-14 {
                // t as `clip_halfplane_into` computes it, so that the
                // crossing is the same point to the last bit.
                let t = (xc - p1x) / dx;
                out_x[m] = p1x + t * dx;
                out_y[m] = p1y + t * (p2y - p1y);
                m += 1;
            }
        }
        if in2 {
            out_x[m] = p2x;
            out_y[m] = p2y;
            m += 1;
        }
        p1x = p2x;
        p1y = p2y;
        in1 = in2;
    }
    m
}

/// Σ (y_i + y_{i+1})·cross_i / 6 of a polygon: its area times its centroid's
/// y (signs as its orientation).
fn polygon_moment_y_n(x: &[f64], y: &[f64], n: usize) -> f64 {
    if n < 3 {
        return 0.0;
    }
    let mut m = 0.0;
    let mut a = 0.0;
    for i in 0..n {
        let j = if i + 1 == n { 0 } else { i + 1 };
        let cross = x[i] * y[j] - x[j] * y[i];
        a += cross;
        m += (y[i] + y[j]) * cross;
    }
    if a == 0.0 {
        0.0
    } else {
        (m / 6.0) * js::math::sign(a)
    }
}

/// Shoelace area of the first `n` vertices (as `calculate_polygon_area`).
fn polygon_area_n(x: &[f64], y: &[f64], n: usize) -> f64 {
    if n < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    for i in 0..n {
        let j = if i + 1 == n { 0 } else { i + 1 };
        area += x[i] * y[j];
        area -= x[j] * y[i];
    }
    area.abs() / 2.0
}

/// Ray-casting point test on the polygon shifted by (−sx, −sy), the same
/// arithmetic as `is_point_in_polygon` on the shifted arrays.
#[allow(clippy::too_many_arguments)]
fn point_in_shifted_polygon(
    px: f64,
    py: f64,
    poly_x: &[f64],
    poly_y: &[f64],
    n: usize,
    sx: f64,
    sy: f64,
) -> bool {
    let mut inside = false;
    for i in 0..n {
        let j = if i + 1 == n { 0 } else { i + 1 };
        let xi = poly_x[i] - sx;
        let yi = poly_y[i] - sy;
        let xj = poly_x[j] - sx;
        let yj = poly_y[j] - sy;
        if (yi > py) != (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-15) + xi {
            inside = !inside;
        }
    }
    inside
}

/// Water at a slice base: the water line's elevation at the slice centre and
/// the head factor h (TypeScript's `{ yMean, h }`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Water {
    pub y_mean: f64,
    pub h: f64,
}

/// Per-material water: when given, pore pressure comes from the water line
/// of the base material (overriding `water_y_mean` / `water_h`). May fail
/// with `WATER_LINE_GAP`.
pub type WaterForMaterial<'a> = dyn Fn(MaterialId) -> Result<Option<Water>> + 'a;
/// Water line of a material at the slice edges [y at x0, y at x1], for
/// materials with a saturated unit weight (None: no water there).
pub type WaterForWeight<'a> = dyn Fn(MaterialId) -> Option<[f64; 2]> + 'a;

/// The context of `create_slice` besides the slice's own numbers: the slope's
/// material table and regions and the functions TypeScript passes as
/// optional closures.
#[derive(Clone, Copy)]
pub struct SliceEnv<'a> {
    /// The material table the regions' `MaterialId`s index.
    pub materials: &'a [Material],
    pub material_geometries: &'a [GeometryWithMaterial],
    /// Per-material water (`waterForMaterial`).
    pub water_for_material: Option<&'a WaterForMaterial<'a>>,
    /// Base of a non-circular surface (straight within the slice); then
    /// (cx, cy) is the axis point for moment equilibrium and `radius` unused.
    pub base: Option<&'a (dyn Fn(f64) -> f64 + 'a)>,
    /// Water line of a material at the slice edges (`waterForWeight`).
    pub water_for_weight: Option<&'a WaterForWeight<'a>>,
    /// Pore pressure at a point, replacing the water lines' (a waternet,
    /// model/waternet.rs).
    pub pore_pressure_at: Option<&'a (dyn Fn(f64, f64) -> f64 + 'a)>,
}

/// The numbers of one slice for `create_slice` (TypeScript's positional
/// arguments).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SliceInput {
    pub x0: f64,
    pub x1: f64,
    pub y0_top: f64,
    pub y1_top: f64,
    pub cx: f64,
    pub cy: f64,
    pub radius: f64,
    pub udl_force: f64,
    pub ll_force: f64,
    pub water_y_mean: Option<f64>,
    pub water_h: Option<f64>,
}

fn is_rock(m: &MaterialModel) -> bool {
    matches!(
        m,
        MaterialModel::Impenetrable(_) | MaterialModel::HighStrength(_)
    )
}

/// Create a single Slice from its geometric parameters (None: invalid).
pub fn create_slice(
    p: &SliceInput,
    env: &SliceEnv,
    scratch: &mut SliceScratch,
) -> Result<Option<Slice>> {
    let SliceInput {
        x0,
        x1,
        y0_top,
        y1_top,
        cx,
        cy,
        radius,
        udl_force,
        ll_force,
        water_y_mean,
        water_h,
    } = *p;
    let materials = env.materials;
    let material_geometries = env.material_geometries;
    let base = env.base;

    let x = (x0 + x1) / 2.0;
    let dx = cx - x;
    let y_top = (y0_top + y1_top) / 2.0;
    let width = (x0 - x1).abs();

    let y0_bottom = match base {
        Some(f) => f(x0),
        None => get_circle_y_coordinate_at_x(cx, cy, radius, x0),
    };
    let y1_bottom = match base {
        Some(f) => f(x1),
        None => get_circle_y_coordinate_at_x(cx, cy, radius, x1),
    };
    // A straight base: a non-circular surface, or a circle under the chord
    // experiment switch (SliceBase::Chord: the chord's middle is the base
    // point, its inclination α and its length the base's).
    let straight = base.is_some() || slice_base() != SliceBase::Arc;
    let y_bottom = if straight {
        (y0_bottom + y1_bottom) / 2.0
    } else {
        get_circle_y_coordinate_at_x(cx, cy, radius, x)
    };

    if y_bottom > y_top {
        return Ok(None); // Invalid: bottom above top
    }

    let height = (y_top - y_bottom).abs();
    let e = cy - (y_top + y_bottom) / 2.0;

    // Alpha angle: positive where the base descends towards +x (the
    // sliding direction). On a circle the tangent at the middle of the
    // slice's arc (θ the angle of a point from the downward vertical through
    // the centre, x = cx + R sin θ; α = −θ), which with the arc length below
    // is the slice's base as the circle has it.
    let theta =
        |xx: f64| js::math::asin(js::math::max(-1.0, js::math::min(1.0, (xx - cx) / radius)));
    let th0 = if straight { 0.0 } else { theta(x0) };
    let th1 = if straight { 0.0 } else { theta(x1) };
    let alpha = if straight {
        js::math::atan((y0_bottom - y1_bottom) / width)
    } else {
        -(th0 + th1) / 2.0
    };

    // Moment arms about the centre / axis point. The base shear resists
    // with arm R; the normal force has arm `normalArm` (0 on a circle,
    // where it passes through the centre).
    let mut shear_arm = radius;
    let mut normal_arm = 0.0;
    if base.is_some() {
        let bx = x - cx;
        let by = y_bottom - cy;
        shear_arm = -(bx * js::math::sin(alpha) + by * js::math::cos(alpha));
        normal_arm = bx * js::math::cos(alpha) - by * js::math::sin(alpha);
    }

    // Base length: on a circle the arc length R·|θ1 − θ0|, with α at the
    // middle of the arc and the weight under the arc (below), so that base,
    // inclination and weight are the circle's own; a straight base b/cos α.
    // (Before 2026-11: α the tangent at the x-midpoint with b/cos α, which
    // under-credited cohesion on a steep slice, by 0.3 % of the resisting
    // moment on an undrained clay with a steep crest, partly offset by the
    // weight under one arc node. With the steep ends cut (get_slices), the
    // error against 4000 slices is 0.013 % on average, 0.16 % at most.)
    let base_length = if straight {
        width / js::math::cos(alpha)
    } else {
        radius * (th1 - th0).abs()
    };

    // Pore water pressure
    let mut u = 0.0;
    if let (Some(wy), Some(wh)) = (water_y_mean, water_h) {
        u = js::math::max(wy - y_bottom, 0.0) * WATER_UNIT_WEIGHT * wh;
    }

    // ── Material intersection and weight calculation ─────────────
    // Build the clipping polygon for material intersection
    // geometry_for_area: [(x0, 10000), (x1, 10000), (x1, y1_bottom), (xm, ym_bottom), (x0, y0_bottom)]
    // The top at y = 10000 is a fixed ceiling: material above it is not
    // counted, so model elevations must stay below 10000 m.
    // On a circle the base follows the arc with a node every ≤ 1° (an even
    // number of segments up to 32), so that the weight is that under the
    // arc. One node is always the base point (x, yBottom): the base material
    // is looked up just above it, and a chord there would lie above the arc.
    let arc_segments = if straight {
        2.0
    } else {
        js::math::min(
            32.0,
            2.0 * js::math::max(1.0, ((th1 - th0).abs() / (PI / 90.0)).ceil()),
        )
    };
    // (Array.from({ length: NaN }) is empty)
    let arc_nodes = arc_segments - 1.0;
    let mut clip_poly = [[0.0f64; 2]; MAX_ARC_SEGMENTS + 3];
    let mut np = 0;
    let mut push = |pt: [f64; 2]| {
        clip_poly[np] = pt;
        np += 1;
    };
    push([x0, 10000.0]);
    push([x1, 10000.0]);
    push([x1, y1_bottom]);
    if arc_nodes == 1.0 {
        push([x, y_bottom]);
    } else if arc_nodes >= 1.0 {
        let count = arc_nodes as usize;
        for k in 0..count {
            let kk = (k + 1) as f64;
            if 2.0 * kk == arc_segments {
                push([x, y_bottom]);
            } else {
                let xx = x1 - (kk / arc_segments) * (x1 - x0);
                push([xx, get_circle_y_coordinate_at_x(cx, cy, radius, xx)]);
            }
        }
    }
    push([x0, y0_bottom]);
    let clip_poly = &clip_poly[..np];

    // Compute edge coefficients for the slip-surface edges (from index 2 on),
    // relative to a local origin (ox, oy) near the slice: with real-world
    // coordinates (eastings ~1e6 and elevations ~1e3) the constant term x·y
    // of global coefficients lost the base by more than `lift` below, and the
    // slice got the wrong base material. The origin is a multiple of 4096 so
    // that models near the global origin are computed exactly as before.
    let ox = js::math::round(x / LOCAL_ORIGIN_GRID) * LOCAL_ORIGIN_GRID;
    let oy = js::math::round(y_bottom / LOCAL_ORIGIN_GRID) * LOCAL_ORIGIN_GRID;
    let mut edge_coeffs = [[0.0f64; 3]; MAX_ARC_SEGMENTS + 1];
    let mut ne = 0;
    for i in 2..clip_poly.len() - 1 {
        let p1 = [clip_poly[i][0] - ox, clip_poly[i][1] - oy];
        let p2 = [clip_poly[i + 1][0] - ox, clip_poly[i + 1][1] - oy];
        let a = p2[1] - p1[1];
        let b = -(p2[0] - p1[0]);
        let c = p2[0] * p1[1] - p2[1] * p1[0];
        edge_coeffs[ne] = [a, b, c];
        ne += 1;
    }
    let edge_coeffs = &edge_coeffs[..ne];

    let lift = 1e-6 * js::math::max(1.0, y_top - y_bottom);
    let mut base_material: Option<MaterialId> = None;
    // Base material found inside its fragment (not the fallback below).
    let mut base_inside = false;
    let mut first_intersected: Option<MaterialId> = None;
    let mut total_weight = 0.0;
    let mut total_area = 0.0;
    // the weight of the fills raising the pore pressure (B-bar) in the slice
    let mut fill_weight = 0.0;
    // Σ γ·A·ȳ (local y), for the centre of gravity
    let mut weight_moment_y = 0.0;

    for m in material_geometries {
        // Fast X-bounds check
        if let (Some(x_max), Some(x_min)) = (m.x_max, m.x_min) {
            if x_max < x0 || x_min > x1 {
                continue;
            }
        }
        let material = &materials[m.material.0 as usize];

        // Step 1: Vertical clip (global coordinates), as clip_polygon_vertical.
        let n_in = m.px.len();
        scratch.ensure(2 * n_in + 8);
        let mut n = clip_vertical_into(
            &m.px,
            &m.py,
            n_in,
            x0,
            true,
            &mut scratch.ax,
            &mut scratch.ay,
        );
        if n > 0 {
            n = clip_vertical_into(
                &scratch.ax,
                &scratch.ay,
                n,
                x1,
                false,
                &mut scratch.bx,
                &mut scratch.by,
            );
        }
        if n < 3 {
            continue;
        }

        // Step 2: Clip by slip-surface edges (in local coordinates)
        for i in 0..n {
            scratch.bx[i] -= ox;
            scratch.by[i] -= oy;
        }
        // Ping-pong between the buffers: the result ends in (bx, by).
        let mut valid = true;
        for &[a, b, c] in edge_coeffs {
            // A non-convex region can gain vertices at each arc edge.
            scratch.ensure(2 * n);
            n = clip_halfplane_into(
                &scratch.bx,
                &scratch.by,
                n,
                a,
                b,
                c,
                &mut scratch.ax,
                &mut scratch.ay,
            );
            std::mem::swap(&mut scratch.ax, &mut scratch.bx);
            std::mem::swap(&mut scratch.ay, &mut scratch.by);
            if n < 3 {
                valid = false;
                break;
            }
        }
        if !valid {
            continue;
        }
        if first_intersected.is_none() {
            first_intersected = Some(m.material);
        }

        // Calculate area and weight
        let area = polygon_area_n(&scratch.bx, &scratch.by, n);
        total_area += area;
        let mut gamma = material.unit_weight();
        if let MaterialModel::SpatialMohrCoulomb(_) = &*material.model {
            // The fragment in global coordinates, only for a spatially varying
            // unit weight (its centroid).
            scratch.gx.clear();
            scratch.gy.clear();
            for i in 0..n {
                scratch.gx.push(scratch.bx[i] + ox);
                scratch.gy.push(scratch.by[i] + oy);
            }
            gamma = fragment_unit_weight(material, &scratch.gx, &scratch.gy, area);
        }
        total_weight += area * gamma;
        weight_moment_y += gamma * polygon_moment_y_n(&scratch.bx, &scratch.by, n);
        if material.model.base().b_bar_load == Some(true) {
            fill_weight += area * gamma;
        }
        let gamma_sat = material.model.base().unit_weight_sat;
        if let (Some(gamma_sat), Some(water_for_weight)) = (gamma_sat, env.water_for_weight) {
            if gamma_sat != gamma {
                // The part of the fragment below the material's water line
                // (straight across the slice) weighs γsat instead of γ.
                if let Some(w) = water_for_weight(m.material) {
                    let s = (w[1] - w[0]) / (x1 - x0);
                    scratch.ensure(2 * n);
                    let nb = clip_halfplane_into(
                        &scratch.bx,
                        &scratch.by,
                        n,
                        s,
                        -1.0,
                        w[0] - oy - s * (x0 - ox),
                        &mut scratch.ax,
                        &mut scratch.ay,
                    );
                    if nb >= 3 {
                        total_weight +=
                            polygon_area_n(&scratch.ax, &scratch.ay, nb) * (gamma_sat - gamma);
                        weight_moment_y +=
                            (gamma_sat - gamma) * polygon_moment_y_n(&scratch.ax, &scratch.ay, nb);
                    }
                }
            }
        }

        // Check if this material is at the base of the slice
        // Test in coordinates local to the slice base: with real-world
        // eastings (~1e5..1e7) a fixed 1e-10 offset is below the floating
        // point resolution and the base material was missed.
        if point_in_shifted_polygon(
            0.0,
            lift,
            &scratch.bx,
            &scratch.by,
            n,
            x - ox,
            y_bottom - oy,
        ) {
            base_material = Some(m.material);
            base_inside = true;
        }
    }

    // A base exactly on a layer boundary (a polyline run along it, a circle
    // grazing it at the slice centre): the point just above the base lies in
    // the upper material, which a surface 1 mm lower would not see at all.
    // Soil on soil: the base takes the weaker of the two, the limit a surface
    // just inside the weaker layer approaches, so a surface along the top or
    // the bottom of a weak layer is analysed in the weak layer. The strengths
    // are compared at the slice's normal stress by the ordinary method of
    // slices, σ′ = W cos²α / b − u. Not when the lower material is bedrock
    // or high-strength: a surface on the rock head runs in the soil above it,
    // so a circle tangent to the rock stays analysable instead of being
    // rejected as entering the rock.
    let mut lift_below = false;
    if let (true, Some(above)) = (base_inside, base_material) {
        let holds_below = |g: &GeometryWithMaterial| {
            (match (g.x_min, g.x_max) {
                (Some(x_min), Some(x_max)) => x >= x_min && x <= x_max,
                _ => true,
            }) && point_in_shifted_polygon(0.0, -lift, &g.px, &g.py, g.px.len(), x, y_bottom)
        };
        if !material_geometries
            .iter()
            .any(|g| g.material == above && holds_below(g))
        {
            let below = material_geometries
                .iter()
                .find(|g| g.material != above && holds_below(g))
                .map(|g| g.material);
            if let Some(below) = below {
                if !is_rock(&materials[below.0 as usize].model) {
                    let sigma = (total_weight / width) * js::math::pow(js::math::cos(alpha), 2.0);
                    let strength_at = |mat: MaterialId, y_probe: f64| -> Result<f64> {
                        let model = &*materials[mat.0 as usize].model;
                        if is_rock(model) {
                            return Ok(f64::INFINITY);
                        }
                        let y_lt = if needs_layer_top(model) {
                            material_layer_top_at(material_geometries, mat, x, y_probe)
                        } else {
                            None
                        };
                        let w = match env.water_for_material {
                            Some(f) => f(mat)?,
                            None => match (water_y_mean, water_h) {
                                (Some(y_mean), Some(h)) => Some(Water { y_mean, h }),
                                _ => None,
                            },
                        };
                        let uu = match w {
                            Some(w) => {
                                js::math::max(w.y_mean - y_bottom, 0.0) * WATER_UNIT_WEIGHT * w.h
                            }
                            None => 0.0,
                        };
                        let st = resolve_strength(
                            model,
                            &StrengthContext {
                                y_bottom,
                                x,
                                y_ground: y_top,
                                y_layer_top: y_lt,
                                alpha,
                                suction: Some(base_suction(model, w, y_bottom)),
                                effective_vertical_stress: Some(
                                    (total_weight + udl_force + ll_force) / width - uu,
                                ),
                            },
                        )?;
                        let drained = st.cohesion
                            + js::math::max(0.0, sigma - uu)
                                * js::math::tan((st.friction_angle * PI) / 180.0);
                        Ok(if st.is_combined == Some(true) {
                            js::math::min(drained, st.cohesion_undrained)
                        } else {
                            drained
                        })
                    };
                    if strength_at(below, y_bottom - lift)? < strength_at(above, y_bottom + lift)? {
                        base_material = Some(below);
                        lift_below = true;
                    }
                }
            }
        }
    }

    // Fallback: use first intersected material if base not found
    if base_material.is_none() {
        base_material = first_intersected;
    }

    let Some(base_material) = base_material else {
        return Ok(None); // No material → invalid slice
    };
    let base_model = &materials[base_material.0 as usize].model;

    let mut base_water: Option<Water> = match (water_y_mean, water_h) {
        (Some(y_mean), Some(h)) => Some(Water { y_mean, h }),
        _ => None,
    };
    if let Some(f) = env.water_for_material {
        base_water = f(base_material)?;
        u = match base_water {
            Some(w) => js::math::max(w.y_mean - y_bottom, 0.0) * WATER_UNIT_WEIGHT * w.h,
            None => 0.0,
        };
    }
    // A waternet gives the pore pressure (the water lines still the phreatic level).
    if let Some(f) = env.pore_pressure_at {
        u = f(x, y_bottom);
    }
    // The pore pressure from the water alone, before B-bar and rᵤ add theirs
    // (the excess pore pressure under loads only acts below the water).
    let u_water = u;
    // Excess pore pressure from the fill above (B-bar).
    if let Some(b_bar) = base_model.base().b_bar {
        if b_bar != 0.0 && fill_weight > 0.0 {
            u += (b_bar * fill_weight) / width;
        }
    }
    // Pore pressure ratio: rᵤ times the soil above the base.
    if let Some(ru) = base_model.base().ru {
        if ru != 0.0 {
            u += (ru * total_weight) / width;
        }
    }
    let suction = base_suction(base_model, base_water, y_bottom);

    // Top of the base material's layer, for depth measured from it: searched
    // in the full material regions just above the base centre.
    let mut y_layer_top: Option<f64> = None;
    if base_inside && needs_layer_top(base_model) {
        y_layer_top = material_layer_top_at(
            material_geometries,
            base_material,
            x,
            y_bottom + if lift_below { -lift } else { lift },
        );
    }

    // The strength above the material's water line (or everywhere when it
    // has none), when it has its own.
    let above_water = base_model
        .base()
        .above_water
        .as_deref()
        .filter(|_| match base_water {
            None => true,
            Some(w) => y_bottom > w.y_mean,
        });
    let strength_model: &MaterialModel = above_water.unwrap_or(base_model);

    // Resolve strength via the material model plugin system
    let strength = resolve_strength(
        strength_model,
        &StrengthContext {
            y_bottom,
            x,
            y_ground: y_top,
            y_layer_top,
            alpha,
            suction: Some(suction),
            // SHANSEP: the overburden on the base (free water above the ground is
            // added with its load, refresh_shansep)
            effective_vertical_stress: Some((total_weight + udl_force + ll_force) / width - u),
        },
    )?;

    let cohesion = strength.cohesion;
    let cohesion_undrained = strength.cohesion_undrained;
    let friction_angle = strength.friction_angle;
    let phi = (friction_angle * PI) / 180.0;

    Ok(Some(Slice {
        x,
        x_left: x0,
        x_right: x1,
        y0_top,
        y1_top,
        y_top,
        y0_bottom,
        y1_bottom,
        y_bottom,
        width,
        height,
        area: total_area,
        alpha,
        base_length,
        weight: total_weight,
        y_centroid: if total_weight > 0.0 {
            Some(oy + weight_moment_y / total_weight)
        } else {
            None
        },
        dx,
        e,
        r: shear_arm,
        normal_arm: Some(normal_arm),
        circular: Some(base.is_none()),
        udl: udl_force,
        ll: ll_force,
        is_valid: true,
        base_material: Some(base_material),
        // (only for an aboveWater model; rare, so the copy into an Arc)
        strength_model: above_water.map(|m| Arc::new(m.clone())),
        cohesion,
        cohesion_undrained,
        cohesion_undrained_part: strength.cohesion_undrained_part,
        suction: if suction > 0.0 { Some(suction) } else { None },
        suction_strength: strength.suction_strength,
        friction_angle,
        phi,
        u,
        u_water: if u != u_water { Some(u_water) } else { None },
        water_load: None,
        h_force: None,
        extra_moment: None,
        reinforcement_active: None,
        reinforcement_passive: None,
        reinforcement_forces: None,
        undrained_governs: None,
        is_combined: strength.is_combined,
        hoek_brown: strength.hoek_brown,
        shear_normal: strength.shear_normal,
        skip_surface: strength.skip_surface,
        impenetrable: strength.impenetrable,
    }))
}

/// Matric suction at a slice base (kPa, ≥ 0) in a material with φb
/// (`UnsaturatedStrength`): the negative pore pressure above its water line,
/// −u = γw·(y_base − y_line)·h, with the same head factor h as the positive
/// pore pressure below the line (1 with vertical head, cos²θ with the
/// phreatic correction). 0 below the line, without a water line, or for a
/// material without φb.
fn base_suction(model: &MaterialModel, water: Option<Water>, y_bottom: f64) -> f64 {
    let Some(water) = water else {
        return 0.0;
    };
    if !(suction_angle(model) > 0.0) {
        return 0.0;
    }
    js::math::max(y_bottom - water.y_mean, 0.0) * WATER_UNIT_WEIGHT * water.h
}

// ── Water at a slice ──────────────────────────────────────────────

/// A water line that does not reach a slice. Water lines are continued
/// horizontally to the model edges (as is common practice), so this does not
/// happen for a line set on the slope; should it, the surface is invalid (as
/// commercial programs give no FOS where the water table does not span the
/// slip surface) instead of silently getting no pore pressure there.
pub const WATER_LINE_GAP: &str = "The water table does not span the slip surface.";

/// Water elevation at the slice midpoint and the head correction factor
/// cos²θ for an inclined water line, or None without a line (no pore
/// pressure). Fails when the line does not reach the slice.
fn water_at_slice(
    line: Option<&Polyline>,
    x_left: f64,
    x_right: f64,
    x_mid: f64,
    vertical_head: bool,
) -> Result<Option<Water>> {
    let Some(line) = line else {
        return Ok(None);
    };
    let wy1 = line_y_from(line, x_left, Side::Right);
    let wy2 = line_y_from(line, x_right, Side::Left);
    let wy_mid = get_y_at_x(&line.x, &line.y, x_mid);
    if !wy1.is_finite() || !wy2.is_finite() || !wy_mid.is_finite() {
        return Err(EngineError::new(WATER_LINE_GAP));
    }
    Ok(Some(Water {
        y_mean: wy_mid,
        h: head_factor(line, wy1, wy2, x_left, x_right, vertical_head),
    }))
}

/// Factor h on the vertical head over a slice base, u = γw·(yw − yb)·h:
/// cos²θ with θ the inclination of the water line across the slice (the
/// equipotentials of seepage parallel to a straight phreatic surface are
/// normal to it, Duncan & Wright 2014, ch. 6), or 1 with vertical head.
/// Also 1 where the line has a vertical segment inside the slice: a step in
/// the line is a wall or a sheet pile between two water levels, not a
/// seepage gradient, and the secant across it is no flow line. (Water-line
/// vertices are slice edges, so this is only a safeguard.)
pub fn head_factor(
    line: &Polyline,
    wy_left: f64,
    wy_right: f64,
    x_left: f64,
    x_right: f64,
    vertical_head: bool,
) -> f64 {
    if vertical_head || wy_left == wy_right {
        return 1.0;
    }
    for k in 1..line.x.len() {
        let xs = line.x[k];
        if xs == line.x[k - 1] && line.y[k] != line.y[k - 1] && xs > x_left && xs < x_right {
            return 1.0;
        }
    }
    js::math::pow(
        js::math::cos(js::math::atan((wy_right - wy_left) / (x_right - x_left))),
        2.0,
    )
}

fn line_y_from(line: &Polyline, x: f64, side: Side) -> f64 {
    polyline_y_from(&line.x, &line.y, x, side)
}

/// Water line that gives the free water standing on the ground at x: the
/// line governing pore pressure in the material just below the ground
/// there (its own line, else the main line), or None without water. x must
/// not lie on a vertical face of the ground.
///
/// External water is a load on the ground plus hydrostatic pore pressure
/// below it, and the two must come from the same water level, else the
/// base carries the pore pressure of a pond whose weight is missing (or the
/// reverse) and the FOS is wrong by about the whole water load (Duncan &
/// Wright 2014, ch. 6). The water at the ground surface is the water of
/// the surface material, so that material's line decides both.
fn free_water_line_at(slope: &Slope, x: f64) -> Option<&Polyline> {
    if !slope.has_material_water_tables() {
        return if slope.has_water_table() {
            slope.water_rl_xy()
        } else {
            None
        };
    }
    let surf = slope.surface_line_xy();
    let y_ground = match surf {
        Some(s) => get_y_at_x(&s.x, &s.y, x),
        None => f64::NAN,
    };
    let mut material: Option<MaterialId> = None;
    if let (Some(surf), true) = (surf, y_ground.is_finite()) {
        let span = (surf.x[surf.x.len() - 1] - surf.x[0]).abs();
        let y = y_ground - 1e-6 * js::math::max(1.0, span);
        material = slope
            .material_geometries()
            .iter()
            .find(|g| is_point_in_polygon(x, y, &g.px, &g.py))
            .map(|g| g.material);
    }
    slope.get_water_line_for_material(material)
}

/// y values of a line at the slice edges, each from the slice's own side,
/// computed once per line (TypeScript's Map caches keyed by the line).
struct EdgeYsCache<'a> {
    entries: Vec<(*const Polyline, Vec<f64>, Vec<f64>)>,
    slices_x: &'a [f64],
}

impl<'a> EdgeYsCache<'a> {
    fn new(slices_x: &'a [f64]) -> Self {
        EdgeYsCache {
            entries: Vec::new(),
            slices_x,
        }
    }

    /// (y from the right at each left edge, y from the left at each right edge).
    fn get(&mut self, line: &Polyline) -> (&[f64], &[f64]) {
        let key = line as *const Polyline;
        let i = match self.entries.iter().position(|e| e.0 == key) {
            Some(i) => i,
            None => {
                let n = self.slices_x.len();
                let left: Vec<f64> = self.slices_x[..n - 1]
                    .iter()
                    .map(|&x| line_y_from(line, x, Side::Right))
                    .collect();
                let right: Vec<f64> = self.slices_x[1..]
                    .iter()
                    .map(|&x| line_y_from(line, x, Side::Left))
                    .collect();
                self.entries.push((key, left, right));
                self.entries.len() - 1
            }
        };
        let e = &self.entries[i];
        (&e.1, &e.2)
    }
}

// ── getSlices ─────────────────────────────────────────────────────

/// The x ranges of a composite circle along the floor, and the floor.
struct Floor<'a> {
    floor: Option<&'a crate::model::composite::CompositeFloor>,
    parts: Vec<[f64; 2]>,
}

impl Floor<'_> {
    fn on(&self, x: f64) -> bool {
        self.parts.iter().any(|&[a, b]| x > a && x < b)
    }
}

/// Divide a failure surface into vertical slices.
///
/// `entry_x` / `x1`: entry and exit x; (cx, cy, radius) the circle. A
/// non-circular surface is the polyline `points` from entry to exit (x
/// increasing); (cx, cy) is then the axis point and `radius` is unused.
/// Returns the valid slices (empty: no admissible surface).
#[allow(clippy::too_many_arguments)]
pub fn get_slices(
    slope: &Slope,
    entry_x: f64,
    x1: f64,
    cx: f64,
    cy: f64,
    radius: f64,
    points: Option<&[Pt]>,
    scratch: &mut SliceScratch,
) -> Result<Vec<Slice>> {
    if entry_x >= x1 {
        return Err(EngineError::new("x0 must be less than x1"));
    }

    let Some(surf_xy) = slope.surface_line_xy() else {
        return Err(EngineError::new("Surface line not defined"));
    };
    let poly: Option<&[Pt]> = points.filter(|p| p.len() >= 2);
    let arc_y = |x: f64| get_circle_y_coordinate_at_x(cx, cy, radius, x);

    // Composite circle: where the circle goes below the floor (the top of
    // impenetrable material, and the base of the model with compositeBase)
    // the surface follows the floor (model/composite.rs). `floor.parts` are
    // the x ranges along the floor; empty: a plain circle.
    let mut floor = Floor {
        floor: if poly.is_none() && slope.composite_surfaces() {
            slope.composite_floor()
        } else {
            None
        },
        parts: Vec::new(),
    };
    if let Some(fl) = floor.floor {
        let fx: Vec<f64> = fl.pts.iter().map(|p| p[0]).collect();
        let fy: Vec<f64> = fl.pts.iter().map(|p| p[1]).collect();
        let mut cuts: Vec<f64> = get_circle_line_intersections(cx, cy, radius, &fx, &fy)
            .into_iter()
            .map(|[ix, _]| ix)
            .filter(|&ix| ix > entry_x && ix < x1)
            .collect();
        js::array::sort_by(&mut cuts, |a, b| a - b);
        let mut ends = Vec::with_capacity(cuts.len() + 2);
        ends.push(entry_x);
        ends.extend_from_slice(&cuts);
        ends.push(x1);
        // A circle that dips below the floor by less than this (a circle
        // tangent to it, to rounding) stays a circle; the checks below that
        // reject a base outside the model lift by more.
        let dip_tol = floor_dip_tolerance(slope.model_height());
        let x_tol = 1e-9 * js::math::max(1.0, radius);
        for k in 0..ends.len() - 1 {
            let a = ends[k];
            let b = ends[k + 1];
            if b - a <= x_tol {
                continue;
            }
            let m = (a + b) / 2.0;
            if floor_y_at(fl, m, Side::Left) > arc_y(m) + dip_tol {
                match floor.parts.last_mut() {
                    Some(last) if (last[1] - a).abs() <= x_tol => last[1] = b,
                    _ => floor.parts.push([a, b]),
                }
            }
        }
        if !floor.parts.is_empty() {
            // Not admissible, so not analysed: a surface that would rise
            // vertically against the motion (where the floor steps up towards
            // the exit; the soil below the step's top would have to move into
            // it), or that runs along the floor up to the ground (rock at the
            // surface).
            let step_tol = 1e-4 * js::math::max(1.0, slope.model_height());
            for &[a, b] in &floor.parts {
                // Through the bare base of the model (not followed): outside it.
                if fl
                    .bare
                    .iter()
                    .any(|&[u, v]| js::math::min(b, v) - js::math::max(a, u) > x_tol)
                {
                    return Ok(Vec::new());
                }
                let into = floor_y_at(fl, a, Side::Right)
                    - if a > entry_x {
                        js::math::min(arc_y(a), floor_y_at(fl, a, Side::Left))
                    } else {
                        arc_y(a)
                    };
                if a > entry_x && into > step_tol {
                    return Ok(Vec::new());
                }
                for &[px, py] in &fl.pts {
                    if px > a
                        && px < b
                        && floor_y_at(fl, px, Side::Right) - floor_y_at(fl, px, Side::Left)
                            > step_tol
                    {
                        return Ok(Vec::new());
                    }
                    // (the ends excepted: exiting where the floor meets the ground is no outcrop)
                    if px > a && px < b && py >= get_y_at_x(&surf_xy.x, &surf_xy.y, px) - step_tol {
                        return Ok(Vec::new());
                    }
                }
            }
        }
    }
    let floor = floor;
    let base_y = |x: f64| -> f64 {
        if let Some(poly) = poly {
            polyline_y_at(poly, x)
        } else if !floor.parts.is_empty() && floor.on(x) {
            floor_y_at(
                floor.floor.expect("floor parts need a floor"),
                x,
                Side::Left,
            )
        } else {
            arc_y(x)
        }
    };

    // A tension crack cuts the surface off where it reaches the crack depth
    // on the upslope side; a surface that never gets that deep has no
    // sliding mass below the crack zone.
    // With the automatic depth the crack is where the surface is as deep as
    // the Rankine depth of the soil there, so re-slicing from the crack finds
    // the same crack.
    let mut x0 = entry_x;
    let mut crack_depth = 0.0;
    if slope.tension_crack_auto() {
        let depth_at = |x: f64| rankine_crack_depth(slope, x);
        if depth_at(entry_x)? > 0.0 || depth_at(x1)? > 0.0 {
            let Some(xc) = find_crack_x(surf_xy, entry_x, x1, base_y, depth_at)? else {
                return Ok(Vec::new());
            };
            x0 = xc;
            crack_depth = depth_at(xc)?;
        }
    } else if slope.tension_crack_depth() > 0.0 {
        crack_depth = slope.tension_crack_depth();
        let Some(xc) = find_crack_x(surf_xy, entry_x, x1, base_y, |_| Ok(crack_depth))? else {
            return Ok(Vec::new());
        };
        x0 = xc;
    }
    // A crack at a limiting base inclination: the steeper part from the
    // entry is cut off; the crack further from the entry governs.
    if slope.tension_crack_angle() > 0.0 {
        let Some(xa) =
            find_angle_crack_x(x0, x1, base_y, (slope.tension_crack_angle() * PI) / 180.0)
        else {
            return Ok(Vec::new());
        };
        if xa > x0 {
            x0 = xa;
            crack_depth = js::math::max(0.0, get_y_at_x(&surf_xy.x, &surf_xy.y, xa) - base_y(xa));
        }
    }

    let dist = x1 - x0;
    let b = dist / slope.slice_count();
    // (a Set; the sort and the filter below make duplicates irrelevant: a
    // stable sort keeps the first of equal values, which the Set keeps)
    let mut all_slices: Vec<f64> = vec![x0, x1];

    // A polyline's kinks must be slice boundaries (straight bases), also
    // with fixed slices; on a composite circle the ends of the parts along
    // the floor and the floor's kinks there.
    if let Some(poly) = poly {
        for &[px, _] in poly {
            if px > x0 && px < x1 {
                all_slices.push(px);
            }
        }
    }
    for &[a, bb] in &floor.parts {
        for x in [a, bb] {
            if x > x0 && x < x1 {
                all_slices.push(x);
            }
        }
        for &[px, _] in &floor.floor.expect("floor parts need a floor").pts {
            if px > a && px < bb && px > x0 && px < x1 {
                all_slices.push(px);
            }
        }
    }
    if let Some(fixed) = slope.fixed_slices() {
        for &fx in fixed {
            if fx > x0 && fx < x1 {
                all_slices.push(fx);
            }
        }
    }
    // Geometry-critical points, also with fixed slices: the fixed
    // boundaries are added to them, so that a slice still has one material
    // and a straight water line along its base.
    {
        let radius_sq = js::math::pow(radius, 2.0);
        let floor_followed = !floor.parts.is_empty();
        for mg in slope.material_geometries() {
            // Polygon corner points within the sliding mass
            for i in 0..mg.px.len() {
                if mg.px[i] <= x0 || mg.px[i] >= x1 {
                    continue;
                }
                let inside = if poly.is_some() || floor.on(mg.px[i]) {
                    mg.py[i] >= base_y(mg.px[i]) - 1e-9
                } else {
                    js::math::pow(mg.px[i] - cx, 2.0) + js::math::pow(mg.py[i] - cy, 2.0)
                        <= radius_sq + 1e-9
                };
                if inside {
                    all_slices.push(mg.px[i]);
                }
            }
            // Surface-polygon edge intersections
            let intersections: Vec<f64> = if let Some(poly) = poly {
                polyline_crossings_x(poly, &mg.px, &mg.py, true)
            } else {
                let mut v: Vec<f64> = get_circle_line_intersections(cx, cy, radius, &mg.px, &mg.py)
                    .into_iter()
                    .map(|[ix, _]| ix)
                    .filter(|&ix| !floor.on(ix))
                    .collect();
                if floor_followed {
                    let fl = floor.floor.expect("floor parts need a floor");
                    v.extend(
                        polyline_crossings_x(&fl.pts, &mg.px, &mg.py, true)
                            .into_iter()
                            .filter(|&ix| floor.on(ix)),
                    );
                }
                v
            };
            for ix in intersections {
                if ix > x0 && ix < x1 {
                    all_slices.push(ix);
                }
            }
        }

        // Concentrated and edge loads: a line load gets its own thin slice so
        // its moment arm is exact, and UDL ends become slice boundaries.
        const LINE_LOAD_HALF_WIDTH: f64 = 0.01;
        for ll in slope.line_loads() {
            for x in [ll.x - LINE_LOAD_HALF_WIDTH, ll.x + LINE_LOAD_HALF_WIDTH] {
                if x > x0 && x < x1 {
                    all_slices.push(x);
                }
            }
        }
        for udl in slope.udls() {
            for x in [udl.x1, udl.x2] {
                if x > x0 && x < x1 {
                    all_slices.push(x);
                }
            }
        }

        // Water table intersections (every line, so per-material lines too)
        for water_xy in slope.all_water_lines() {
            let water_intersections: Vec<f64> = if let Some(poly) = poly {
                polyline_crossings_x(poly, &water_xy.x, &water_xy.y, false)
            } else {
                let mut v: Vec<f64> =
                    get_circle_line_intersections(cx, cy, radius, &water_xy.x, &water_xy.y)
                        .into_iter()
                        .map(|[ix, _]| ix)
                        .filter(|&ix| !floor.on(ix))
                        .collect();
                if floor_followed {
                    let fl = floor.floor.expect("floor parts need a floor");
                    v.extend(
                        polyline_crossings_x(&fl.pts, &water_xy.x, &water_xy.y, false)
                            .into_iter()
                            .filter(|&ix| floor.on(ix)),
                    );
                }
                v
            };
            for ix in water_intersections {
                if ix > x0 && ix < x1 {
                    all_slices.push(ix);
                }
            }
            // The line's own kinks above the slip surface: between slice edges
            // the line is then straight, so the pore pressure at the slice centre
            // is the slice's mean, the γsat part and the free water on the ground
            // are exact, and a vertical step (a wall, a sheet pile) lies on a
            // slice edge instead of being read as a steep line across a slice.
            // A vertex on a straight run (or an end continuing horizontally)
            // changes nothing and is left out.
            let wx = &water_xy.x;
            let wy = &water_xy.y;
            let nw = wx.len();
            for k in 0..nw {
                let vx = wx[k];
                if !(vx > x0 && vx < x1) || wy[k] < base_y(vx) - 1e-9 {
                    continue;
                }
                // Neighbours, past repeated points.
                let mut p = k as isize - 1;
                while p >= 0 && wx[p as usize] == vx && wy[p as usize] == wy[k] {
                    p -= 1;
                }
                let mut q = k + 1;
                while q < nw && wx[q] == vx && wy[q] == wy[k] {
                    q += 1;
                }
                let (ax, ay) = if p >= 0 {
                    (vx - wx[p as usize], wy[k] - wy[p as usize])
                } else {
                    (1.0, 0.0)
                };
                let (bx, by) = if q < nw {
                    (wx[q] - vx, wy[q] - wy[k])
                } else {
                    (1.0, 0.0)
                };
                if (ax * by - ay * bx).abs()
                    > 1e-12 * js::math::hypot(&[ax, ay]) * js::math::hypot(&[bx, by])
                {
                    all_slices.push(vx);
                }
            }
        }
    }

    // Sort and deduplicate (remove points too close together). (A Set
    // stores -0 as +0.)
    for v in all_slices.iter_mut() {
        *v += 0.0;
    }
    js::array::sort_by(&mut all_slices, |a, b| a - b);
    let all_slices_arr: Vec<f64> = (0..all_slices.len())
        .filter(|&i| i == 0 || all_slices[i] - all_slices[i - 1] > SLICE_DEDUP_TOLERANCE)
        .map(|i| all_slices[i])
        .collect();

    // Subdivide large intervals
    let mut final_x = all_slices_arr.clone();
    let diffs: Vec<f64> = (0..all_slices_arr.len().saturating_sub(1))
        .map(|i| all_slices_arr[i + 1] - all_slices_arr[i])
        .collect();
    let num_geom_slices = diffs.len() as f64;

    let large_indices: Vec<usize> = (0..diffs.len()).filter(|&i| diffs[i] > 1.5 * b).collect();
    let num_large = large_indices.len() as f64;
    let num_small = num_geom_slices - num_large;

    let target_from_large = js::math::max(num_large, slope.slice_count() - num_small);
    let large_sum = js::array::sum(large_indices.iter().map(|&i| diffs[i]));

    if target_from_large > 0.0 && large_sum > 0.0 {
        // At most the width up to which an interval counts as small: once the
        // short intervals (a densely digitised water line, many layer edges)
        // use up the slice count, a long interval is still cut to about the
        // nominal width instead of staying one wide slice.
        let new_b = js::math::min(large_sum / target_from_large, 1.5 * b);
        for &i in &large_indices {
            let d = diffs[i];
            let n = js::math::round(d / new_b);
            if n > 1.0 {
                let mut j = 1.0;
                while j < n {
                    final_x.push(all_slices_arr[i] + (j * d) / n);
                    j += 1.0;
                }
            }
        }
    }

    js::array::sort_by(&mut final_x, |a, b| a - b);
    // On a circle, an end where the arc turns steep (towards a vertical
    // tangent) is cut so that no slice spans more arc than twice a nominal
    // slice at the bottom of the circle (2b/R), nor more than 2°: one base
    // inclination per slice cannot follow an arc that turns 20–30° within
    // it, while the middle of the circle keeps the nominal width. Against
    // 4000 slices on the 150 fixed-circle checks of the verification
    // (2026-11) this took the largest error from 0.87 % (V068, a vertical
    // tangent at the crest) to 0.16 %, with 3 % more slices; 65 or 80
    // even slices left 0.53 % and 0.35 %.
    if poly.is_none() && slice_base() != SliceBase::ChordEven {
        let max_arc = js::math::max(MAX_SLICE_ARC, (2.0 * b) / radius);
        let theta =
            |x: f64| js::math::asin(js::math::max(-1.0, js::math::min(1.0, (x - cx) / radius)));
        let mut i = final_x.len() as isize - 2;
        while i >= 0 {
            let iu = i as usize;
            let t0 = theta(final_x[iu]);
            let t1 = theta(final_x[iu + 1]);
            let k = ((t1 - t0) / max_arc - 1e-9).ceil();
            if k > 1.0 {
                // j = 1, 2, … below k, inserted in place (no vector per arc)
                final_x.splice(
                    iu + 1..iu + 1,
                    (1..k as usize)
                        .map(|j| cx + radius * js::math::sin(t0 + ((t1 - t0) * j as f64) / k)),
                );
            }
            i -= 1;
        }
    }
    let slices_x = final_x;
    let n_slices = slices_x.len() - 1;
    let b_array: Vec<f64> = (0..n_slices)
        .map(|i| slices_x[i + 1] - slices_x[i])
        .collect();
    let sx_array: Vec<f64> = (0..n_slices)
        .map(|i| (slices_x[i] + slices_x[i + 1]) / 2.0)
        .collect();

    // A slice whose base lies below the ground but outside the model (below
    // its base) has no soil to take its strength from: the surface is not
    // admissible. The slices are cut at every crossing with the material
    // regions, so a base is wholly inside or wholly outside, and its centre
    // decides. A base above the ground (where a circle leaves the soil
    // through a face and re-enters it below) is left to the slices.
    let base_lift = 1e-6 * js::math::max(1.0, slope.model_height());
    for &sx in &sx_array {
        let y = base_y(sx);
        if y < slope.get_external_y_intersection(sx)? - base_lift
            && !slope.is_inside_external_boundary(sx, y + base_lift)
        {
            return Ok(Vec::new());
        }
    }

    // Batch compute loads
    let udl_data: Vec<[f64; 3]> = slope
        .udls()
        .iter()
        .map(|u| [u.x1, u.x2, u.magnitude])
        .collect();
    // (the vertical part of an inclined line load; its horizontal part below)
    let ll_data: Vec<[f64; 2]> = slope
        .line_loads()
        .iter()
        .map(|ll| {
            [
                ll.x,
                if ll.angle != 0.0 {
                    ll.magnitude * js::math::cos((ll.angle * PI) / 180.0)
                } else {
                    ll.magnitude
                },
            ]
        })
        .collect();
    let (udl_forces, ll_forces) = calculate_all_loads(&b_array, &sx_array, &udl_data, &ll_data);
    let factors = slope.partial_factors();
    let load_factor = factors.map(|f| f.variable_load).unwrap_or(1.0);
    let kh = slope.seismic_horizontal();
    let kv = slope.seismic_vertical();
    let waternet = slope.waternet();
    let earlier = slope.earlier_stage();
    let normal_udls: Vec<&Udl> = slope
        .udls()
        .iter()
        .filter(|u| u.direction == UdlDirection::Normal)
        .collect();
    let excess_udls: Vec<&Udl> = slope
        .udls()
        .iter()
        .filter(|u| !u.excess_pore_pressure.is_empty())
        .collect();

    // Surface y at each slice edge, taken from the slice's own side: at a
    // vertical face the averaged value would put the top below the base and
    // the slice next to the face would be dropped.
    let surface_y_from = |x: f64, side: Side| line_y_from(surf_xy, x, side);
    let y_tops_l: Vec<f64> = slices_x[..n_slices]
        .iter()
        .map(|&x| surface_y_from(x, Side::Right))
        .collect();
    let y_tops_r: Vec<f64> = slices_x[1..]
        .iter()
        .map(|&x| surface_y_from(x, Side::Left))
        .collect();

    // Water table y-values
    // At the slice edges from the slice's own side, so that a vertical step
    // in the line (e.g. at a wall) does not leak into the next slice.
    let main_line = if slope.has_water_table() {
        slope.water_rl_xy()
    } else {
        None
    };
    let mut main_water: Option<(Vec<f64>, Vec<f64>, Vec<f64>)> = None;
    if let Some(w) = main_line {
        main_water = Some((
            slices_x[..n_slices]
                .iter()
                .map(|&x| line_y_from(w, x, Side::Right))
                .collect(),
            slices_x[1..]
                .iter()
                .map(|&x| line_y_from(w, x, Side::Left))
                .collect(),
            get_y_at_x_many(&w.x, &w.y, &sx_array),
        ));
    }

    // Free water on the ground: the line of the surface material of each
    // slice (free_water_line_at), at the slice edges from the slice's side.
    let free_lines: Vec<Option<&Polyline>> = sx_array
        .iter()
        .map(|&x| free_water_line_at(slope, x))
        .collect();
    let mut free_ys = EdgeYsCache::new(&slices_x);
    let mut free_y_l = vec![f64::NAN; n_slices];
    let mut free_y_r = vec![f64::NAN; n_slices];
    for (i, line) in free_lines.iter().enumerate() {
        if let Some(line) = line {
            let (l, r) = free_ys.get(line);
            free_y_l[i] = l[i];
            free_y_r[i] = r[i];
        }
    }
    let has_free_water = free_lines.iter().any(|l| l.is_some());

    // A non-circular surface must stay below the ground between entry and
    // exit; a segment cutting through the air is no slip surface.
    if poly.is_some() {
        let tol = 1e-6 * js::math::max(1.0, x1 - x0);
        for i in 0..n_slices {
            if base_y(slices_x[i]) > y_tops_l[i] + tol
                || base_y(slices_x[i + 1]) > y_tops_r[i] + tol
            {
                return Ok(Vec::new());
            }
        }
    }

    // A slice along the floor of a composite circle has a straight base
    // between the floor's heights at its edges (from its own side of a step
    // in the floor), analysed about the centre like a polyline's.
    let floor_base = |i: usize| -> Option<[f64; 4]> {
        if floor.parts.is_empty() || !floor.on(sx_array[i]) {
            return None;
        }
        let fl = floor.floor.expect("floor parts need a floor");
        let a = slices_x[i];
        let bb = slices_x[i + 1];
        Some([
            a,
            bb,
            floor_y_at(fl, a, Side::Right),
            floor_y_at(fl, bb, Side::Left),
        ])
    };

    // Create slices
    let mut results: Vec<Slice> = Vec::with_capacity(n_slices);
    let vertical_head = slope.pore_pressure_head() == PorePressureHead::Vertical;
    let has_sat_weight = slope.material_geometries().iter().any(|g| {
        slope
            .material(g.material)
            .model
            .base()
            .unit_weight_sat
            .is_some()
    });
    // Water y at the slice edges, once per water line (for γsat).
    let water_ys = std::cell::RefCell::new(EdgeYsCache::new(&slices_x));
    let poly_base = |x: f64| base_y(x);
    let waternet_fn = waternet.map(|wn| move |x: f64, y: f64| waternet_pore_pressure(wn, x, y));
    let materials = slope.materials();
    for i in 0..n_slices {
        let mut water_y_mean: Option<f64> = None;
        let mut water_h: Option<f64> = None;

        if let (Some(line), Some((wl, wr, wm))) = (main_line, &main_water) {
            let wy1 = wl[i];
            let wy2 = wr[i];
            let wy_mid = wm[i];
            // Use midpoint water elevation for pore-pressure head so visual checks at slice
            // center align with the computed U value.
            if !wy1.is_finite() || !wy2.is_finite() || !wy_mid.is_finite() {
                return Err(EngineError::new(WATER_LINE_GAP));
            }
            water_y_mean = Some(wy_mid);
            water_h = Some(head_factor(
                line,
                wy1,
                wy2,
                slices_x[i],
                slices_x[i + 1],
                vertical_head,
            ));
        }

        let water_for_material = |material: MaterialId| -> Result<Option<Water>> {
            water_at_slice(
                slope.get_water_line_for_material(Some(material)),
                slices_x[i],
                slices_x[i + 1],
                sx_array[i],
                vertical_head,
            )
        };
        let water_for_weight = |material: MaterialId| -> Option<[f64; 2]> {
            let line = slope.get_water_line_for_material(Some(material))?;
            let mut cache = water_ys.borrow_mut();
            let (l, r) = cache.get(line);
            let w0 = l[i];
            let w1 = r[i];
            if w0.is_finite() && w1.is_finite() {
                Some([w0, w1])
            } else {
                None
            }
        };
        let floor_line = floor_base(i);
        let floor_fn =
            floor_line.map(|[a, bb, ya, yb]| move |x: f64| ya + ((yb - ya) * (x - a)) / (bb - a));
        let base: Option<&dyn Fn(f64) -> f64> = if poly.is_some() {
            Some(&poly_base)
        } else {
            floor_fn.as_ref().map(|f| f as &dyn Fn(f64) -> f64)
        };
        let env = SliceEnv {
            materials,
            material_geometries: slope.material_geometries(),
            water_for_material: if slope.has_material_water_tables() {
                Some(&water_for_material)
            } else {
                None
            },
            base,
            water_for_weight: if has_sat_weight {
                Some(&water_for_weight)
            } else {
                None
            },
            pore_pressure_at: waternet_fn.as_ref().map(|f| f as &dyn Fn(f64, f64) -> f64),
        };
        let s = create_slice(
            &SliceInput {
                x0: slices_x[i],
                x1: slices_x[i + 1],
                y0_top: y_tops_l[i],
                y1_top: y_tops_r[i],
                cx,
                cy,
                radius,
                udl_force: udl_forces[i] * load_factor,
                ll_force: ll_forces[i] * load_factor,
                water_y_mean,
                water_h,
            },
            &env,
            scratch,
        )?;

        if let Some(mut s) = s {
            if !s.is_valid {
                continue;
            }
            if free_lines[i].is_some() {
                apply_free_water(&mut s, free_y_l[i], free_y_r[i], cy);
            }
            let excess = if !excess_udls.is_empty() {
                load_excess_pore_pressure(&s, materials, &excess_udls, load_factor)
            } else {
                0.0
            };
            if excess > 0.0 {
                s.u += excess;
            }
            if free_lines[i].is_some() || earlier.is_some() || excess > 0.0 {
                refresh_shansep(&mut s, materials, earlier, excess > 0.0)?;
            }
            if let Some(f) = factors {
                apply_material_factors(&mut s, materials, f);
            }
            if !normal_udls.is_empty() {
                apply_normal_loads(&mut s, &normal_udls, load_factor, cy);
            }
            if kh != 0.0 || kv != 0.0 {
                apply_seismic(&mut s, kh, kv, cy);
            }
            for ll in slope.line_loads() {
                // the horizontal part of an inclined line load, on the slice it
                // acts on (at a slice edge the first; at the ends of the mass, on
                // a wall face, the end slice), at the load point or the ground
                if ll.angle == 0.0 || ll.x < s.x_left || ll.x > s.x_right {
                    continue;
                }
                if ll.x == s.x_left && results.last().is_some_and(|r| r.x_right == ll.x) {
                    continue;
                }
                let h = ll.magnitude * js::math::sin((ll.angle * PI) / 180.0) * load_factor;
                let yg = ll.y.unwrap_or_else(|| {
                    s.y0_top + ((s.y1_top - s.y0_top) * (ll.x - s.x_left)) / (s.x_right - s.x_left)
                });
                s.h_force = Some(s.h_force.unwrap_or(0.0) + h);
                s.extra_moment = Some(s.extra_moment.unwrap_or(0.0) + h * (cy - yg));
            }
            results.push(s);
        }
    }

    // Free water against a vertical face of the ground (a wall, a quay): the
    // slice tops never include the face, so its horizontal pressure is
    // applied here, toward the higher side, like the inclined-face thrust
    // in apply_free_water.
    if has_free_water && !results.is_empty() {
        let tol = 1e-6 * js::math::max(1.0, x1 - x0);
        // Water just outside an end of the mass (the surface material there).
        let outside_y = |x: f64, side: Side| -> f64 {
            let line =
                free_water_line_at(slope, if side == Side::Left { x - tol } else { x + tol });
            match line {
                Some(line) => line_y_from(line, x, side),
                None => f64::NAN,
            }
        };
        for k in 0..=n_slices {
            // Ground on each side of the boundary; outside the mass at its ends.
            let y_l = if k > 0 {
                y_tops_r[k - 1]
            } else {
                surface_y_from(x0, Side::Left)
            };
            let y_r = if k < n_slices {
                y_tops_l[k]
            } else {
                surface_y_from(x1, Side::Right)
            };
            if !y_l.is_finite() || !y_r.is_finite() || (y_l - y_r).abs() <= tol {
                continue;
            }
            let high_left = y_l > y_r;
            // The face belongs to the sliding mass only where the mass is the
            // higher side (at the ends, the single slice there).
            if (k == 0 && high_left) || (k == n_slices && !high_left) {
                continue;
            }
            // Only the part of the face above the slip surface bounds the mass:
            // a surface leaving through the face (above its foot) must not get
            // the thrust on the face below it.
            let y_lo = js::math::max(js::math::min(y_l, y_r), base_y(slices_x[k]));
            let y_hi = js::math::max(y_l, y_r);
            if y_hi - y_lo <= tol {
                continue;
            }
            // Water on the low side, read from that side (the line of the
            // surface material there).
            let wy = if high_left {
                if k < n_slices {
                    free_y_l[k]
                } else {
                    outside_y(x1, Side::Right)
                }
            } else if k > 0 {
                free_y_r[k - 1]
            } else {
                outside_y(x0, Side::Left)
            };
            if !wy.is_finite() || wy <= y_lo {
                continue;
            }
            let h1 = wy - y_lo;
            let h2 = js::math::max(wy - y_hi, 0.0);
            let force = (WATER_UNIT_WEIGHT * (h1 * h1 - h2 * h2)) / 2.0;
            // Centroid of the trapezoidal pressure between yLo and min(wy, yHi).
            let d = js::math::min(wy, y_hi) - y_lo;
            let yc = y_lo + (d * (h1 + 2.0 * h2)) / (3.0 * (h1 + h2));
            let fx = if high_left { -force } else { force };
            let x_face = slices_x[k];
            // The slice on the low side carries the force.
            let target = results
                .iter()
                .position(|s| {
                    ((if high_left { s.x_left } else { s.x_right }) - x_face).abs()
                        <= SLICE_DEDUP_TOLERANCE
                })
                .or_else(|| {
                    results.iter().position(|s| {
                        ((if high_left { s.x_right } else { s.x_left }) - x_face).abs()
                            <= SLICE_DEDUP_TOLERANCE
                    })
                });
            let Some(target) = target else {
                continue;
            };
            let t = &mut results[target];
            t.h_force = Some(t.h_force.unwrap_or(0.0) + fx);
            t.extra_moment = Some(t.extra_moment.unwrap_or(0.0) + fx * (cy - yc));
        }
    }

    // Water in the crack pushes the sliding mass downslope (+x): resultant
    // γw·hw²/2 at hw/3 above the crack bottom.
    let hw = crack_depth * slope.tension_crack_water();
    if crack_depth > 0.0 && hw > 0.0 && !results.is_empty() {
        // The force acts on the slice at the crack face; if that slice was
        // dropped as degenerate, the surface is not a valid cracked mass.
        let first = &mut results[0];
        if (first.x_left - x0).abs() > SLICE_DEDUP_TOLERANCE {
            return Ok(Vec::new());
        }
        let y_crack_bottom = first.y0_bottom;
        let force = 0.5 * WATER_UNIT_WEIGHT * hw * hw;
        first.h_force = Some(first.h_force.unwrap_or(0.0) + force);
        first.extra_moment =
            Some(first.extra_moment.unwrap_or(0.0) + force * (cy - (y_crack_bottom + hw / 3.0)));
    }

    apply_reinforcement(slope, &mut results, cx, cy)?;

    Ok(results)
}

/// Pseudostatic seismic load on a slice: kh·W horizontally in the sliding
/// direction at its centre of gravity, kv·W vertically (positive downward)
/// at its centre line, as a load on the slice (with the surface loads).
fn apply_seismic(s: &mut Slice, kh: f64, kv: f64, cy: f64) {
    let w = s.weight;
    if kh != 0.0 {
        let yc = s.y_centroid.unwrap_or((s.y_top + s.y_bottom) / 2.0);
        s.h_force = Some(s.h_force.unwrap_or(0.0) + kh * w);
        s.extra_moment = Some(s.extra_moment.unwrap_or(0.0) + kh * w * (cy - yc));
    }
    if kv != 0.0 {
        s.udl += kv * w;
    }
}

/// The strength model at a slice's base: its own (`strength_model`, an
/// `aboveWater` model) or its base material's.
pub(crate) fn base_model<'a>(s: &'a Slice, materials: &'a [Material]) -> Option<&'a MaterialModel> {
    match &s.strength_model {
        Some(m) => Some(&**m),
        None => s.base_material.map(|id| &*materials[id.0 as usize].model),
    }
}

/// JavaScript truthiness of an optional number.
fn truthy(v: Option<f64>) -> bool {
    matches!(v, Some(v) if v != 0.0 && !v.is_nan())
}

/// A SHANSEP base with free water standing on the slice: its strength from
/// the overburden with the water's weight (create_slice had the soil and the
/// loads only).
fn refresh_shansep(
    s: &mut Slice,
    materials: &[Material],
    earlier: Option<&Slope>,
    pore_pressure_changed: bool,
) -> Result<()> {
    let Some(MaterialModel::Shansep(m)) = base_model(s, materials) else {
        return Ok(());
    };
    let from_earlier = earlier.is_some() && m.yield_from_earlier_stage == Some(true);
    if !truthy(s.water_load) && !from_earlier && !pore_pressure_changed {
        return Ok(());
    }
    let sv = (s.weight + s.udl + s.ll + s.water_load.unwrap_or(0.0)) / s.width - s.u;
    let st = shansep_strength_at(m, s, sv, earlier)?;
    s.cohesion = st.cohesion;
    s.cohesion_undrained = st.cohesion_undrained;
    Ok(())
}

/// The characteristic strength of a SHANSEP base at the effective vertical
/// stress sv (`s` gives x, y_bottom, y_top and alpha). With
/// `yieldFromEarlierStage` and an earlier stage, the yield stress is the
/// earlier stage's effective vertical stress at the base (with its
/// distributed loads) plus `pop`, OCR at least 1.
pub fn shansep_strength_at(
    m: &ShansepModel,
    s: &Slice,
    sv: f64,
    earlier: Option<&Slope>,
) -> Result<ResolvedStrength> {
    let ctx = StrengthContext {
        y_bottom: s.y_bottom,
        x: s.x,
        y_ground: s.y_top,
        y_layer_top: None,
        alpha: s.alpha,
        suction: None,
        effective_vertical_stress: Some(sv),
    };
    match earlier {
        // the yield stress the soil kept from the earlier stage, OCR at least 1
        Some(earlier) if m.yield_from_earlier_stage == Some(true) => {
            let model = ShansepModel {
                pop: None,
                yield_stress: Some(js::math::max(
                    effective_vertical_stress_with_loads(earlier, s.x, s.y_bottom)
                        + m.pop.unwrap_or(0.0),
                    sv,
                )),
                ..m.clone()
            };
            resolve_strength(&MaterialModel::Shansep(model), &ctx)
        }
        _ => resolve_strength(&MaterialModel::Shansep(m.clone()), &ctx),
    }
}

/// Excess pore pressure at the slice base from loads not yet consolidated
/// in its material: ratio × the mean load over the slice width. Only below
/// the water (a base with pore pressure from the water lines or the
/// waternet, not from rᵤ or B-bar alone); above it the soil is not
/// saturated and the load is carried by the soil skeleton.
fn load_excess_pore_pressure(
    s: &Slice,
    materials: &[Material],
    udls: &[&Udl],
    load_factor: f64,
) -> f64 {
    let Some(id) = s.base_material else {
        return 0.0;
    };
    let name = &materials[id.0 as usize].name;
    if !(s.width > 0.0) || !(s.u_water.unwrap_or(s.u) > 0.0) {
        return 0.0;
    }
    let mut u = 0.0;
    for l in udls {
        let Some(e) = l.excess_pore_pressure.iter().find(|q| &q.material == name) else {
            continue;
        };
        let overlap = js::math::min(l.x2, s.x_right) - js::math::max(l.x1, s.x_left);
        if overlap > 0.0 {
            u += (e.ratio * l.magnitude * load_factor * overlap) / s.width;
        }
    }
    u
}

/// The strength fields of a slice as a resolved strength (what
/// `design_strength` reads of TypeScript's slice).
pub(crate) fn slice_strength(s: &Slice) -> ResolvedStrength {
    ResolvedStrength {
        cohesion: s.cohesion,
        friction_angle: s.friction_angle,
        cohesion_undrained: s.cohesion_undrained,
        cohesion_undrained_part: s.cohesion_undrained_part,
        suction_strength: s.suction_strength,
        is_combined: s.is_combined,
        ..Default::default()
    }
}

/// Design strength of the slice base: each characteristic parameter divided
/// by its own partial factor (design_strength).
fn apply_material_factors(s: &mut Slice, materials: &[Material], f: &PartialFactors) {
    let kind = base_model(s, materials).map(|m| m.kind());
    if kind == Some("high-strength") || kind == Some("impenetrable") {
        return;
    }
    let d = design_strength(kind, &slice_strength(s), Some(f));
    s.cohesion = d.cohesion;
    s.cohesion_undrained = d.cohesion_undrained;
    if let Some(ss) = s.suction_strength.as_mut() {
        *ss /= f.cohesion;
    }
    if d.undrained {
        return;
    }
    s.phi = js::math::atan(d.tan_phi);
    s.friction_angle = (s.phi * 180.0) / PI;
}

/// Rankine depth of a tension crack at x: where the active earth pressure
/// of the soil just below the ground, σa = (γz + q)·Ka − 2c√Ka, is zero.
/// z = 2c/(γ√Ka) − q/γ, Ka = tan²(45° − φ/2); for undrained strength
/// (φ = 0) z = 2cu/γ − q/γ. Strength as in the analysis (design values with
/// partial factors), q the (factored) distributed load and any free water
/// standing on the ground at x. A combined material uses its drained c′,
/// which is what governs near the surface.
pub fn rankine_crack_depth(slope: &Slope, x: f64) -> Result<f64> {
    let Some(surf) = slope.surface_line_xy() else {
        return Ok(0.0);
    };
    let y_ground = get_y_at_x(&surf.x, &surf.y, x);
    if !y_ground.is_finite() {
        return Ok(0.0);
    }
    let y = y_ground - 1e-3;
    let Some(geo) = slope
        .material_geometries()
        .iter()
        .find(|g| is_point_in_polygon(x, y, &g.px, &g.py))
    else {
        return Ok(0.0);
    };
    let material = slope.material(geo.material);
    let model = &*material.model;
    if is_rock(model) {
        return Ok(0.0);
    }
    let y_layer_top = if needs_layer_top(model) {
        material_layer_top_at(slope.material_geometries(), geo.material, x, y)
    } else {
        None
    };
    let strength = resolve_strength(
        model,
        &StrengthContext {
            y_bottom: y,
            x,
            y_ground,
            y_layer_top,
            alpha: 0.0,
            suction: None,
            effective_vertical_stress: None,
        },
    )?;
    let f = slope.partial_factors();
    let d = design_strength(Some(model.kind()), &strength, f);
    let cd = d.cohesion;
    let tan_phi = d.tan_phi;
    // Hoek–Brown rock: the crack opens where the rock mass's small tensile
    // strength s σci/mb is exceeded, not that of the tangent at zero stress
    // (c/tan φ, many times larger)
    let c = match &strength.hoek_brown {
        Some(hb) => js::math::min(cd, ((hb.s * hb.ucs) / hb.mb) * tan_phi),
        None => cd,
    };
    let gamma = resolve_unit_weight(model, material.unit_weight(), x, y);
    if !(c > 0.0) || !(gamma > 0.0) {
        return Ok(0.0);
    }
    let phi = js::math::atan(tan_phi);
    let sqrt_ka = js::math::tan(PI / 4.0 - phi / 2.0);
    let load_factor = f.map(|f| f.variable_load).unwrap_or(1.0);
    let mut q = 0.0;
    for u in slope.udls() {
        if x >= js::math::min(u.x1, u.x2) && x <= js::math::max(u.x1, u.x2) {
            q += u.magnitude * load_factor;
        }
    }
    // Free water standing on the ground is a surcharge too (a clipped line
    // never rises above the ground): the line of the material at the ground,
    // as in get_slices (free_water_line_at).
    if let Some(water) = slope.get_water_line_for_material(Some(geo.material)) {
        let wy = get_y_at_x(&water.x, &water.y, x);
        if wy.is_finite() && wy > y_ground {
            q += WATER_UNIT_WEIGHT * (wy - y_ground);
        }
    }
    Ok(js::math::max(
        0.0,
        (2.0 * c) / (gamma * sqrt_ka) - q / gamma,
    ))
}

/// x of a tension crack at a limiting base inclination: the first point
/// from the entry where the slip surface is no steeper than `angle` (rad,
/// measured from the horizontal, descending in the sliding direction +x);
/// `x_entry` itself when the surface starts no steeper; None when the
/// surface never flattens to it before the exit.
pub fn find_angle_crack_x(
    x_entry: f64,
    x_exit: f64,
    base_y: impl Fn(f64) -> f64,
    angle: f64,
) -> Option<f64> {
    let span = x_exit - x_entry;
    let h = js::math::max(1e-9, span * 1e-6);
    // inclination at x from the slope just after x (a polyline's kink belongs to the next segment)
    let steeper = |x: f64| {
        let d = js::math::min(h, x_exit - x);
        if d > 0.0 {
            js::math::atan(-(base_y(x + d) - base_y(x)) / d) - angle
        } else {
            -1.0
        }
    };
    if steeper(x_entry) <= 0.0 {
        return Some(x_entry);
    }
    let steps = 400;
    let mut prev = x_entry;
    for k in 1..=steps {
        let x = x_entry + (span * k as f64) / steps as f64;
        if x >= x_exit {
            break;
        }
        if steeper(x) <= 0.0 {
            let mut lo = prev;
            let mut hi = x;
            for _ in 0..50 {
                let mid = (lo + hi) / 2.0;
                if steeper(mid) <= 0.0 {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            return Some(hi);
        }
        prev = x;
    }
    None
}

/// x of the tension crack: the first point from the entry where the slip
/// surface lies `depth_at(x)` below the ground, or None if it never does.
/// (`depth_at` is fallible: the automatic depth resolves strengths.)
pub fn find_crack_x(
    surf: &Polyline,
    x_entry: f64,
    x_exit: f64,
    base_y: impl Fn(f64) -> f64,
    depth_at: impl Fn(f64) -> Result<f64>,
) -> Result<Option<f64>> {
    // Surface depth beyond the crack depth at x (≥ 0: deep enough).
    let below =
        |x: f64| -> Result<f64> { Ok(get_y_at_x(&surf.x, &surf.y, x) - base_y(x) - depth_at(x)?) };
    let steps = 200;
    let mut prev = x_entry;
    for k in 1..=steps {
        let x = x_entry + ((x_exit - x_entry) * k as f64) / steps as f64;
        if below(x)? >= 0.0 {
            let mut lo = prev;
            let mut hi = x;
            for _ in 0..50 {
                let mid = (lo + hi) / 2.0;
                if below(mid)? >= 0.0 {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            return Ok(if hi < x_exit { Some(hi) } else { None });
        }
        prev = x;
    }
    Ok(None)
}

/// Water standing above the ground (a water line above the surface, e.g. a
/// submerged slope or a lake at the toe) presses on the slice top: its
/// weight acts as a vertical load and, on an inclined surface, it pushes
/// horizontally. Without this the base carried the full pore pressure of
/// the water depth but nothing balanced it, and a fully submerged slope
/// gave about half its FOS. Commercial programs apply this automatically.
///
/// The pressure γw·g(x), with g the water depth above the surface, is
/// integrated over the wet part of the slice top: vertical load ∫p dx,
/// horizontal force ∫p dy = slope·∫p dx, and their moment about the centre.
fn apply_free_water(s: &mut Slice, wy_left: f64, wy_right: f64, cy: f64) {
    if !wy_left.is_finite() || !wy_right.is_finite() {
        return;
    }
    let g0 = wy_left - s.y0_top;
    let g1 = wy_right - s.y1_top;
    if g0 <= 0.0 && g1 <= 0.0 {
        return;
    }
    let b = s.x_right - s.x_left;
    if b <= 0.0 {
        return;
    }
    // Wet part of the slice top as fractions of its width.
    let mut ta = 0.0;
    let mut tb = 1.0;
    if g0 <= 0.0 {
        ta = g0 / (g0 - g1);
    }
    if g1 <= 0.0 {
        tb = g0 / (g0 - g1);
    }
    let cx = s.x + s.dx;
    let surface_slope = (s.y1_top - s.y0_top) / b;
    let depth = |t: f64| js::math::max(g0 + (g1 - g0) * t, 0.0);
    let x_at = |t: f64| s.x_left + b * t;
    let y_at = |t: f64| s.y0_top + (s.y1_top - s.y0_top) * t;
    // Moment of the pressure per unit x: downward part at arm (cx − x),
    // horizontal part at arm (cy − y). Quadratic in t, so Simpson is exact.
    let moment_density = |t: f64| depth(t) * (cx - x_at(t) + surface_slope * (cy - y_at(t)));
    let tm = (ta + tb) / 2.0;
    let len = (tb - ta) * b;
    let load = WATER_UNIT_WEIGHT * len * ((depth(ta) + depth(tb)) / 2.0);
    let moment = (WATER_UNIT_WEIGHT
        * len
        * (moment_density(ta) + 4.0 * moment_density(tm) + moment_density(tb)))
        / 6.0;
    s.water_load = Some(s.water_load.unwrap_or(0.0) + load);
    s.h_force = Some(s.h_force.unwrap_or(0.0) + surface_slope * load);
    // The solvers already take the vertical load at the slice centre.
    s.extra_moment = Some(s.extra_moment.unwrap_or(0.0) + moment - load * s.dx);
}

/// The horizontal part of distributed loads acting normal to the ground
/// (`Udl.direction` "normal"): over the loaded part of the slice top a
/// pressure p normal to a surface of slope dy/dx gives p·dx vertically (the
/// load the slice already carries, at its centre) and p·dy horizontally,
/// pointing into the ground; applied like the free water's thrust
/// (`apply_free_water`): `h_force` in +x (the sliding direction) and its
/// moment about the centre at the height of the loaded part's middle.
fn apply_normal_loads(s: &mut Slice, udls: &[&Udl], load_factor: f64, cy: f64) {
    let b = s.x_right - s.x_left;
    if b <= 0.0 {
        return;
    }
    let slope = (s.y1_top - s.y0_top) / b;
    if slope == 0.0 {
        return;
    }
    for u in udls {
        let a = js::math::max(s.x_left, u.x1);
        let c = js::math::min(s.x_right, u.x2);
        if c <= a {
            continue;
        }
        let fx = slope * u.magnitude * load_factor * (c - a);
        let yc = s.y0_top + slope * ((a + c) / 2.0 - s.x_left);
        s.h_force = Some(s.h_force.unwrap_or(0.0) + fx);
        s.extra_moment = Some(s.extra_moment.unwrap_or(0.0) + fx * (cy - yc));
    }
}

/// Unit weight of a clipped material fragment: the material's γ, or for a
/// spatially varying model the γ interpolated at the fragment centroid.
fn fragment_unit_weight(material: &Material, px: &[f64], py: &[f64], area: f64) -> f64 {
    if !matches!(&*material.model, MaterialModel::SpatialMohrCoulomb(_)) || area <= 0.0 {
        return material.unit_weight();
    }
    let mut a2 = 0.0;
    let mut cx = 0.0;
    let mut cy = 0.0;
    let n = px.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let cross = px[j] * py[i] - px[i] * py[j];
        a2 += cross;
        cx += (px[j] + px[i]) * cross;
        cy += (py[j] + py[i]) * cross;
        j = i;
    }
    if a2.abs() < 1e-12 {
        return material.unit_weight();
    }
    resolve_unit_weight(
        &material.model,
        material.unit_weight(),
        cx / (3.0 * a2),
        cy / (3.0 * a2),
    )
}
