//! Port of packages/engine/src/fem/upper-bound.ts.
//!
//! Upper bound limit analysis by finite elements and conic programming
//! (Sloan & Kleeman 1995, Comput. Methods Appl. Mech. Eng. 127, 293–314;
//! Lyamin & Sloan 2002, IJNAMG 26, 181–216; Makrodimopoulos & Martin 2007,
//! IJNAMG 31(6), 835–865).
//!
//! The velocities vary linearly over three-node triangles whose nodes are not
//! shared, so that every edge can carry a velocity discontinuity. In each
//! element the constant plastic strain rate follows the associated flow rule
//! of the Mohr–Coulomb criterion, in plane strain ε̇x + ε̇y = sin φ z with
//! z ≥ ‖(ε̇x − ε̇y, γ̇xy)‖ (a second-order cone), and dissipates c cos φ z per
//! unit area, solved exactly by Clarabel (conic.rs; the TypeScript engine's
//! HiGHS alternative, the circumscribed polygon of Sloan & Kleeman 1995, is
//! not ported: PORTING.md, Decisions). Along a discontinuity the tangential
//! jump is Δu_t = u⁺ − u⁻ and the normal jump Δu_n = (u⁺ + u⁻) tan φ (u⁺, u⁻ ≥
//! 0, at both ends of the edge), dissipating c (u⁺ + u⁻) per unit length.
//! The power the loads do on any such velocity field over the dissipation
//! bounds the load factor from above for the mesh.
//!
//! Pore pressures: the power of the total stresses is that of the effective
//! stresses less ∫ p ε̇_v dV and ∫ p Δu_n dS on the discontinuities, so the
//! pore pressure does that power as a load (Kim, Salgado & Yu 1999, J.
//! Geotech. Geoenviron. Eng. 125(9), 811–820), besides the weight at the
//! saturated unit weight and the water ponded on the ground.
//!
//! The program minimises the dissipation with the power of all loads
//! (weight, pore pressure, surface loads) equal to one: the minimum is an
//! upper bound λ on the load factor. The factor of safety on strength is
//! the reduction F at which λ(F) = 1 (as for the lower bound, lower_bound.rs):
//! F = λ(1) when φ = 0 everywhere, otherwise a secant search on log λ
//! against log F from `start_f`, and the smallest evaluated F with λ(F) ≤ 1
//! is the bound (a mechanism fails the slope there).
//!
//! Supports as in the strength reduction model (model.rs): the vertical
//! sides are smooth rollers (no normal velocity), the base is rigid, and
//! the soil may slip along it through a discontinuity of the soil's
//! strength.
//!
//! Implementation choices (not from the literature): p = 24 sides for
//! HiGHS; for Clarabel the velocities scaled so that the load power's
//! largest coefficient is one; the strength of an element at its centroid;
//! a discontinuity between two materials takes the lesser cohesion and
//! friction angle of the two (a slip band in the weaker soil); rigid
//! materials do not deform, and no discontinuity runs between two rigid
//! elements; a combined material (the lesser of the drained and undrained
//! strength) flows on both cones and its discontinuities on both criteria;
//! with the tension cut-off σ₁′ ≤ 0 the elements flow on its cone too and
//! the discontinuities may open without dissipation; the secant search as
//! the lower bound's, mirrored.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

use crate::api::ctx::RunCtx;
use crate::error::{EngineError, Result};
use crate::fem::conic::{affine, ConicProgram, ConicStatus, Polygon, ProgramBuilder};
use crate::fem::limit_common::{
    mean_unit_weight, pore_pressure_at, reduced_strength, strength_at, surface_line_loads,
    InsertionMap, StrengthRule,
};
use crate::fem::lower_bound::{BoundSearch, BoundTrial, LowerBoundOptions};
use crate::fem::model::{build_fe_model, ignored_input_warnings, polyline_y};
use crate::js;
use crate::model::geometry_ops::Polyline;
use crate::model::slope::Slope;
use crate::types::WATER_UNIT_WEIGHT;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;

/// `UpperBoundOptions`: the lower bound's fields (lower_bound.rs).
pub type UpperBoundOptions = LowerBoundOptions;

/// The mesh and, at the bound, the velocity of each element corner (x, y), scaled to a largest speed of 1: the mechanism.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Mechanism {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub el: Vec<usize>,
    pub velocity: Vec<f64>,
}

/// `UpperBoundResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpperBoundResult {
    /// Upper bound on the factor of safety.
    pub factor_of_safety: f64,
    /// The load factors λ(F) of the programs solved.
    pub trials: Vec<BoundTrial>,
    pub elements: usize,
    pub variables: usize,
    pub constraints: usize,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mechanism: Option<Mechanism>,
}

/// The upper bound mesh: the model's nodes and the corners of its elements.
#[derive(Debug, Clone, PartialEq)]
pub struct UbMesh {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub el: Vec<usize>,
}

/// One end of a discontinuity: the tangential and normal jump as terms on
/// the velocity columns, and the strength.
#[derive(Debug, Clone)]
struct DiscEnd {
    jt: Vec<(usize, f64)>,
    jn: Vec<(usize, f64)>,
    tie: bool,
    c: f64,
    phi: f64,
    psi: f64,
    cu: f64,
    l: f64,
    e: usize,
    e2: Option<usize>,
}

/// The columns of the flow rule and the discontinuities, the same at every F (−1: none).
#[derive(Debug, Clone)]
struct Layout {
    s: Vec<i64>,
    t: Vec<i64>,
    dp: Vec<i64>,
    dm: Vec<i64>,
    tp: Vec<i64>,
    tm: Vec<i64>,
}

/// The upper bound problem of a slope (`UbProblem`).
#[derive(Debug, Clone)]
pub struct UbProblem {
    ne: usize,
    el_b: Vec<[f64; 3]>,
    el_c: Vec<[f64; 3]>,
    rigid: Vec<bool>,
    e_c: Vec<f64>,
    e_phi: Vec<f64>,
    e_cu: Vec<f64>,
    psi: Vec<f64>,
    ends: Vec<DiscEnd>,
    side_cols: Vec<usize>,
    power: Vec<(usize, f64)>,
    v_scale: f64,
    s_scale: f64,
    cutoff: bool,
    rule: StrengthRule,
    layout: OnceLock<Layout>,
    /// The model's ground surface edges (a, middle, b per edge).
    pub(crate) surface_edges: Vec<usize>,
    /// Sides of the yield polygon when solved as an LP by HiGHS.
    pub sides: f64,
    pub all_undrained: bool,
    /// Whether any soil has cohesion.
    pub cohesive: bool,
    pub elements: usize,
    pub variables: usize,
    pub constraints: usize,
    pub warnings: Vec<String>,
    pub mesh: UbMesh,
}

/// Columns of the velocities of element e's corner k.
fn vu(e: usize, k: usize) -> usize {
    2 * (3 * e + k)
}
fn vv(e: usize, k: usize) -> usize {
    2 * (3 * e + k) + 1
}

impl UbProblem {
    /// The program at a reduction F (conic.rs): minimise the dissipation at
    /// unit load power; velocities of corner i in columns 2i, 2i + 1.
    pub fn program(&self, f: f64) -> ConicProgram {
        let ne = self.ne;
        let v_scale = self.v_scale;
        let s_scale = self.s_scale;
        let rule = self.rule;
        let mut pb = ProgramBuilder::new();
        for i in 0..3 * ne {
            pb.col(&format!("u{i}"), false, v_scale);
            pb.col(&format!("v{i}"), false, v_scale);
        }
        let n_ends = self.ends.len();
        let mut lay = Layout {
            s: vec![-1; ne],
            t: vec![-1; ne],
            dp: vec![-1; n_ends],
            dm: vec![-1; n_ends],
            tp: vec![-1; n_ends],
            tm: vec![-1; n_ends],
        };
        // Discontinuities (Sloan & Kleeman 1995): Δu_t = u⁺ − u⁻ (+ the undrained
        // cap's), Δu_n = (u⁺ + u⁻) tan φ_F (+ opening with the cut-off),
        // dissipating c/F (u⁺ + u⁻) L/2 per end.
        for (i, d) in self.ends.iter().enumerate() {
            if d.tie {
                pb.eq(&d.jt, 0.0);
                pb.eq(&d.jn, 0.0);
                continue;
            }
            let up = pb.col(&format!("dp{i}"), true, v_scale);
            let um = pb.col(&format!("dm{i}"), true, v_scale);
            lay.dp[i] = up as i64;
            lay.dm[i] = um as i64;
            let (red_c, red_phi) = reduced_strength(d.c, d.phi, d.psi, f, rule);
            let tan_f = js::math::tan(red_phi);
            let mut jt = d.jt.clone();
            jt.push((up, -1.0));
            jt.push((um, 1.0));
            let mut jn = d.jn.clone();
            jn.push((up, -tan_f));
            jn.push((um, -tan_f));
            pb.add_objective(up, (red_c * d.l) / 2.0);
            pb.add_objective(um, (red_c * d.l) / 2.0);
            if d.cu.is_finite() {
                let tp = pb.col(&format!("tp{i}"), true, v_scale);
                let tm = pb.col(&format!("tm{i}"), true, v_scale);
                lay.tp[i] = tp as i64;
                lay.tm[i] = tm as i64;
                jt.push((tp, -1.0));
                jt.push((tm, 1.0));
                pb.add_objective(tp, ((d.cu / f) * d.l) / 2.0);
                pb.add_objective(tm, ((d.cu / f) * d.l) / 2.0);
            }
            if self.cutoff {
                jn.push((pb.col(&format!("op{i}"), true, v_scale), -1.0));
            }
            pb.eq(&jt, 0.0);
            pb.eq(&jn, 0.0);
        }
        for &j in &self.side_cols {
            pb.eq(&[(j, 1.0)], 0.0);
        }
        // Normalisation: the power of the loads is one.
        pb.eq(&self.power, 1.0);
        // Element flow rule: 2A ε̇ = the sum of the mechanisms' strain rates,
        // each in its cone: Mohr–Coulomb 2A(ε̇x + ε̇y) = 2 sin φ_F S, (2S, d) a
        // cone, dissipating c/F cos φ_F S; the undrained cap no volume change,
        // (2T, d) a cone, dissipating cu/F T; the tension cut-off 2A(ε̇x + ε̇y)
        // = C, (C, d) a cone, no dissipation.
        let mut tr: Vec<(usize, f64)> = Vec::with_capacity(9);
        let mut dev: Vec<(usize, f64)> = Vec::with_capacity(9);
        let mut gxy: Vec<(usize, f64)> = Vec::with_capacity(9);
        for e in 0..ne {
            let (b, c) = (&self.el_b[e], &self.el_c[e]);
            tr.clear();
            dev.clear();
            gxy.clear();
            for k in 0..3 {
                tr.push((vu(e, k), b[k]));
                tr.push((vv(e, k), c[k]));
                dev.push((vu(e, k), b[k]));
                dev.push((vv(e, k), -c[k]));
                gxy.push((vu(e, k), c[k]));
                gxy.push((vv(e, k), b[k]));
            }
            if !self.rigid[e] {
                let (red_c, phi_f) =
                    reduced_strength(self.e_c[e], self.e_phi[e], self.psi[e], f, rule);
                let sp = js::math::sin(phi_f);
                let dc = red_c * js::math::cos(phi_f);
                let s = pb.col(&format!("S{e}"), false, s_scale);
                let d1 = pb.col(&format!("a{e}"), false, s_scale);
                let d2 = pb.col(&format!("b{e}"), false, s_scale);
                lay.s[e] = s as i64;
                tr.push((s, -2.0 * sp));
                dev.push((d1, -1.0));
                gxy.push((d2, -1.0));
                pb.cone(
                    affine(&[(s, 2.0)], 0.0),
                    affine(&[(d1, 1.0)], 0.0),
                    affine(&[(d2, 1.0)], 0.0),
                    Polygon::Vertices,
                );
                pb.add_objective(s, dc);
                if self.e_cu[e].is_finite() {
                    let t = pb.col(&format!("T{e}"), false, s_scale);
                    let b1 = pb.col(&format!("ta{e}"), false, s_scale);
                    let b2 = pb.col(&format!("tb{e}"), false, s_scale);
                    lay.t[e] = t as i64;
                    dev.push((b1, -1.0));
                    gxy.push((b2, -1.0));
                    pb.cone(
                        affine(&[(t, 2.0)], 0.0),
                        affine(&[(b1, 1.0)], 0.0),
                        affine(&[(b2, 1.0)], 0.0),
                        Polygon::Vertices,
                    );
                    pb.add_objective(t, self.e_cu[e] / f);
                }
                if self.cutoff {
                    let cc = pb.col(&format!("C{e}"), false, s_scale);
                    let c1 = pb.col(&format!("ca{e}"), false, s_scale);
                    let c2 = pb.col(&format!("cb{e}"), false, s_scale);
                    tr.push((cc, -1.0));
                    dev.push((c1, -1.0));
                    gxy.push((c2, -1.0));
                    pb.cone(
                        affine(&[(cc, 1.0)], 0.0),
                        affine(&[(c1, 1.0)], 0.0),
                        affine(&[(c2, 1.0)], 0.0),
                        Polygon::Vertices,
                    );
                }
            }
            pb.eq(&tr, 0.0);
            pb.eq(&dev, 0.0);
            pb.eq(&gxy, 0.0);
        }
        let _ = self.layout.set(lay);
        pb.build()
    }

    /// The dissipation of a solution at F per element (the model's), with
    /// each discontinuity's shared equally by the elements on its sides (all
    /// of it by the element on the base).
    pub fn element_dissipation(&self, f: f64, sol: &[f64]) -> Vec<f64> {
        let ne = self.ne;
        let mut out = vec![0.0f64; ne];
        let lay = match self.layout.get() {
            Some(l) => l,
            None => {
                self.program(f);
                self.layout.get().expect("the layout of a program")
            }
        };
        for e in 0..ne {
            if self.rigid[e] {
                continue;
            }
            let (red_c, red_phi) =
                reduced_strength(self.e_c[e], self.e_phi[e], self.psi[e], f, self.rule);
            let dc = red_c * js::math::cos(red_phi);
            if lay.s[e] >= 0 {
                out[e] += dc * sol[lay.s[e] as usize];
            }
            if lay.t[e] >= 0 {
                out[e] += (self.e_cu[e] / f) * sol[lay.t[e] as usize];
            }
        }
        for (i, d) in self.ends.iter().enumerate() {
            if d.tie {
                continue;
            }
            let red_c = reduced_strength(d.c, d.phi, d.psi, f, self.rule).0;
            let mut w = (red_c * d.l) / 2.0 * (sol[lay.dp[i] as usize] + sol[lay.dm[i] as usize]);
            if lay.tp[i] >= 0 {
                w += ((d.cu / f) * d.l) / 2.0 * (sol[lay.tp[i] as usize] + sol[lay.tm[i] as usize]);
            }
            match d.e2 {
                None => out[d.e] += w,
                Some(e2) => {
                    out[d.e] += w / 2.0;
                    out[e2] += w / 2.0;
                }
            }
        }
        out
    }
}

/// Assemble the upper bound problem of a slope.
pub fn upper_bound_problem(slope: &Slope, options: &UpperBoundOptions) -> Result<UbProblem> {
    let model = build_fe_model(slope, &options.model)?;
    let materials = &model.materials;
    let (x, y) = (&model.x, &model.y);
    let ne = model.element_count;
    let p = options.sides.unwrap_or(24.0);
    let cutoff = options.tension_cutoff.unwrap_or(false);
    let rule = options.strength_rule.unwrap_or_default();
    let mut warnings: Vec<String> = ignored_input_warnings(slope);
    // (the bars also hold the piles' springs, source −1)
    if model.bars.source.iter().any(|&k| k >= 0) {
        warnings.push("Reinforcement is not included in the upper bound analysis.".to_string());
    }
    if !slope.piles().is_empty() {
        warnings.push("Piles are not included in the upper bound analysis.".to_string());
    }
    let mut el = vec![0usize; 3 * ne];
    for e in 0..ne {
        for k in 0..3 {
            el[3 * e + k] = model.el[6 * e + k];
        }
    }
    let nc = x.len();
    let edge_key = |a: usize, b: usize| if a < b { a * nc + b } else { b * nc + a };

    let mut x_lo = f64::INFINITY;
    let mut x_hi = f64::NEG_INFINITY;
    let mut y_hi = f64::NEG_INFINITY;
    for &n in &el {
        x_lo = js::math::min(x_lo, x[n]);
        x_hi = js::math::max(x_hi, x[n]);
        y_hi = js::math::max(y_hi, y[n]);
    }
    let default_surface = Polyline {
        x: vec![x_lo, x_hi],
        y: vec![y_hi, y_hi],
    };
    let surface: &Polyline = slope.surface_line_xy().unwrap_or(&default_surface);
    let water_lines: Vec<Option<&Polyline>> = model
        .material_ids
        .iter()
        .map(|&m| slope.get_water_line_for_material(Some(m)))
        .collect();
    let head: Option<&[f64]> = model
        .seepage
        .as_ref()
        .filter(|s| s.flow)
        .map(|s| s.head.as_slice());

    // Per element: strength at the centroid, mean unit weight, corner pore pressures.
    let mut e_c = vec![0.0f64; ne];
    let mut e_phi = vec![0.0f64; ne];
    let mut e_cu = vec![f64::INFINITY; ne];
    let mut e_gamma = vec![0.0f64; ne];
    let mut n_u = vec![0.0f64; 3 * ne];
    let rigid = &model.el_elastic;
    let mut all_undrained = true;
    for e in 0..ne {
        let mi = model.el_material[e];
        let m = &materials[mi];
        let wl = water_lines[mi];
        let n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
        for k in 0..3 {
            n_u[3 * e + k] = pore_pressure_at(head, n[k], wl, x[n[k]], y[n[k]]);
        }
        e_gamma[e] = mean_unit_weight(
            m,
            wl,
            head.is_some(),
            &[x[n[0]], x[n[1]], x[n[2]]],
            &[y[n[0]], y[n[1]], y[n[2]]],
            &[n_u[3 * e], n_u[3 * e + 1], n_u[3 * e + 2]],
        );
        if rigid[e] {
            continue;
        }
        let st = strength_at(
            slope,
            m,
            model.material_ids[mi],
            surface,
            (x[n[0]] + x[n[1]] + x[n[2]]) / 3.0,
            (y[n[0]] + y[n[1]] + y[n[2]]) / 3.0,
        )?;
        e_c[e] = st.c;
        e_phi[e] = st.phi;
        e_cu[e] = st.cu;
        if st.phi > 0.0 {
            all_undrained = false;
        }
    }

    // Edges: interior ones (two elements), base and sides, the ground surface.
    let mut surface_set: HashSet<usize> = HashSet::new();
    let mut s = 0;
    while s < model.surface_edges.len() {
        surface_set.insert(edge_key(model.surface_edges[s], model.surface_edges[s + 2]));
        s += 3;
    }
    let mut owner: InsertionMap<(usize, usize)> = InsertionMap::new();
    let mut interior: Vec<(usize, usize, usize, usize)> = Vec::new(); // e, k (edge from corner k to k+1), e2, k2
    for e in 0..ne {
        for k in 0..3 {
            let key = edge_key(el[3 * e + k], el[3 * e + (k + 1) % 3]);
            if let Some(&(oe, ok)) = owner.get(key) {
                interior.push((e, k, oe, ok));
                owner.delete(key);
            } else {
                owner.set(key, (e, k));
            }
        }
    }
    let line_q = surface_line_loads(slope, &model, &edge_key, &mut warnings);
    let load_factor = slope.partial_factors().map_or(1.0, |f| f.variable_load);

    // The power of the loads (F-independent), as coefficients per velocity column (a Map: insertion order).
    let mut power: InsertionMap<f64> = InsertionMap::new();
    let add_p = |power: &mut InsertionMap<f64>, j: usize, a: f64| {
        if a != 0.0 {
            match power.get_mut(j) {
                Some(p) => *p += a,
                None => power.set(j, 0.0 + a),
            }
        }
    };
    let mut el_b: Vec<[f64; 3]> = Vec::with_capacity(ne);
    let mut el_c: Vec<[f64; 3]> = Vec::with_capacity(ne);
    let mut el_area2: Vec<f64> = Vec::with_capacity(ne);
    for e in 0..ne {
        let n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
        let b = [y[n[1]] - y[n[2]], y[n[2]] - y[n[0]], y[n[0]] - y[n[1]]];
        let c = [x[n[2]] - x[n[1]], x[n[0]] - x[n[2]], x[n[1]] - x[n[0]]];
        el_area2.push(b[0] * c[1] - b[1] * c[0]);
        el_b.push(b);
        el_c.push(c);
    }
    let mut size = 0.0;
    for e in 0..ne {
        let (b, c, area2) = (&el_b[e], &el_c[e], el_area2[e]);
        size += (area2.abs() / 2.0).sqrt() / ne as f64;
        let pm = (n_u[3 * e] + n_u[3 * e + 1] + n_u[3 * e + 2]) / 3.0;
        for k in 0..3 {
            // weight: −γ A v̄; pore pressure: ∫ p ε̇_v dA = p̄ (Σ b u + c v)/2
            add_p(
                &mut power,
                vv(e, k),
                (-e_gamma[e] * area2) / 6.0 + (pm * c[k]) / 2.0,
            );
            add_p(&mut power, vu(e, k), (pm * b[k]) / 2.0);
        }
    }
    // ∫ p Δu_n over an edge with p and Δu_n linear: L/6 (2 p_a d_a + p_a d_b + p_b d_a + 2 p_b d_b)
    let pair_weights =
        |l: f64, pa: f64, pb: f64| [(l / 6.0) * (2.0 * pa + pb), (l / 6.0) * (pa + 2.0 * pb)];

    // The discontinuities: per end, the tangential and normal jump as terms on
    // the velocity columns, and the strength (the dilation tan φ_F and the
    // dissipation c/F depend on F, so the rows are made per F).
    let mut ends: Vec<DiscEnd> = Vec::new();
    let mut disc = |power: &mut InsertionMap<f64>,
                    e: usize,
                    k: usize,
                    e2: Option<(usize, usize)>,
                    c: f64,
                    phi: f64,
                    cu: f64,
                    tie: bool,
                    p_side: usize| {
        let a = el[3 * e + k];
        let b = el[3 * e + (k + 1) % 3];
        let l = js::math::hypot(&[x[b] - x[a], y[b] - y[a]]);
        let sx = (x[b] - x[a]) / l;
        let sy = (y[b] - y[a]) / l;
        let nx = sy;
        let ny = -sx; // outward of e (counter-clockwise elements)
                      // pore pressure on the discontinuity: that of the side whose material it lies in
        let corner = |node: usize| -> usize {
            for q in 0..3 {
                if el[3 * p_side + q] == node {
                    return 3 * p_side + q;
                }
            }
            3 * e + k
        };
        let pa = n_u[corner(a)];
        let pbv = n_u[corner(b)];
        let [wa, wb] = pair_weights(l, pa, pbv);
        for (kk, node, w) in [(k, a, wa), ((k + 1) % 3, b, wb)] {
            // Δu = u(e2) − u(e)
            let mut jt: Vec<(usize, f64)> = vec![(vu(e, kk), -sx), (vv(e, kk), -sy)];
            let mut jn: Vec<(usize, f64)> = vec![(vu(e, kk), -nx), (vv(e, kk), -ny)];
            if let Some((e2, k2)) = e2 {
                let kk2 = if el[3 * e2 + k2] == node {
                    k2
                } else {
                    (k2 + 1) % 3
                };
                jt.push((vu(e2, kk2), sx));
                jt.push((vv(e2, kk2), sy));
                jn.push((vu(e2, kk2), nx));
                jn.push((vv(e2, kk2), ny));
                // pore pressure power on the normal jump
                add_p(power, vu(e2, kk2), w * nx);
                add_p(power, vv(e2, kk2), w * ny);
            }
            add_p(power, vu(e, kk), -w * nx);
            add_p(power, vv(e, kk), -w * ny);
            ends.push(DiscEnd {
                jt,
                jn,
                tie,
                c,
                phi,
                psi: model.el_psi[p_side],
                cu,
                l,
                e,
                e2: e2.map(|(e2, _)| e2),
            });
        }
    };

    // Of two soils meeting at an edge, the one with the lower shear strength
    // under the overburden at the edge's middle, c + σ′v tan φ (at most cu),
    // σ′v ≈ γ depth − u (implementation choice: either material gives an
    // upper bound; the weaker one a lower, closer one).
    let weaker_side = |e: usize, k: usize, e2: usize| -> usize {
        let a = el[3 * e + k];
        let b = el[3 * e + (k + 1) % 3];
        let mx = (x[a] + x[b]) / 2.0;
        let my = (y[a] + y[b]) / 2.0;
        let depth = js::math::max(0.0, polyline_y(surface, mx) - my);
        let tau = |s: usize| {
            let u = (n_u[3 * s] + n_u[3 * s + 1] + n_u[3 * s + 2]) / 3.0;
            let sv = js::math::max(0.0, e_gamma[s] * depth - u);
            js::math::min(e_c[s] + sv * js::math::tan(e_phi[s]), e_cu[s])
        };
        if tau(e2) < tau(e) {
            e2
        } else {
            e
        }
    };
    for &(e, k, e2, k2) in &interior {
        let r1 = rigid[e];
        let r2 = rigid[e2];
        if r1 && r2 {
            disc(
                &mut power,
                e,
                k,
                Some((e2, k2)),
                0.0,
                0.0,
                f64::INFINITY,
                true,
                e,
            );
            continue;
        }
        // A slip band lies in one material: the side's whole strength (c, φ, cu),
        // never a mix of the two, which would be weaker than either.
        let side = if r1 {
            e2
        } else if r2 {
            e
        } else {
            weaker_side(e, k, e2)
        };
        disc(
            &mut power,
            e,
            k,
            Some((e2, k2)),
            e_c[side],
            e_phi[side],
            e_cu[side],
            false,
            side,
        );
    }
    let mut side_cols: Vec<usize> = Vec::new();
    for (key, &(e, k)) in owner.iter() {
        let a = el[3 * e + k];
        let b = el[3 * e + (k + 1) % 3];
        if surface_set.contains(&key) {
            // ground surface: ponded water (normal pressure) and strip loads (vertical, per horizontal metre)
            let pond_line = if head.is_some() {
                slope.water_rl_xy()
            } else {
                water_lines[model.el_material[e]]
            };
            let l = js::math::hypot(&[x[b] - x[a], y[b] - y[a]]);
            let nx = (y[b] - y[a]) / l;
            let ny = -(x[b] - x[a]) / l;
            let mx = (x[a] + x[b]) / 2.0;
            let mut t: Vec<[f64; 2]> = Vec::with_capacity(2);
            for node in [a, b] {
                let mut pw = 0.0;
                if let Some(pl) = pond_line {
                    let yw = polyline_y(pl, x[node]);
                    pw = if yw.is_finite() {
                        WATER_UNIT_WEIGHT * js::math::max(0.0, yw - y[node])
                    } else {
                        0.0
                    };
                }
                let mut q = line_q.get(&(key, node)).copied().unwrap_or(0.0);
                for udl in slope.udls() {
                    if mx >= udl.x1 && mx <= udl.x2 {
                        q += udl.magnitude * load_factor;
                    }
                }
                t.push([-pw * nx, -pw * ny - q * ny.abs()]);
            }
            // ∫ t·u over the edge, t and u linear
            let ka = k;
            let kb = (k + 1) % 3;
            add_p(&mut power, vu(e, ka), (l / 6.0) * (2.0 * t[0][0] + t[1][0]));
            add_p(&mut power, vv(e, ka), (l / 6.0) * (2.0 * t[0][1] + t[1][1]));
            add_p(&mut power, vu(e, kb), (l / 6.0) * (t[0][0] + 2.0 * t[1][0]));
            add_p(&mut power, vv(e, kb), (l / 6.0) * (t[0][1] + 2.0 * t[1][1]));
            continue;
        }
        if (x[b] - x[a]).abs() <= 1e-3 * (y[b] - y[a]).abs() {
            // smooth vertical side: no horizontal velocity
            for kk in [k, (k + 1) % 3] {
                side_cols.push(vu(e, kk));
            }
            continue;
        }
        // rigid base: a discontinuity against zero velocity (none for a rigid element)
        disc(
            &mut power, e, k, None, e_c[e], e_phi[e], e_cu[e], rigid[e], e,
        );
    }
    if power.len() == 0 {
        return Err(EngineError::new(
            "The slope carries no load: no upper bound.",
        ));
    }
    // Scales (conic.rs): velocities so that the load power's largest
    // coefficient is one, the flow variables those times the element size.
    let mut p_max = 0.0;
    for (_, &a) in power.iter() {
        p_max = js::math::max(p_max, a.abs());
    }
    let v_scale = 1.0 / p_max;
    let s_scale = v_scale * size;
    let power: Vec<(usize, f64)> = power.iter().map(|(j, &a)| (j, a)).collect();
    let cohesive = e_c.iter().any(|&c| c > 0.0) || e_cu.iter().any(|&c| c.is_finite() && c > 0.0);
    let psi = model.el_psi.clone();
    let mut prob = UbProblem {
        ne,
        el_b,
        el_c,
        rigid: rigid.clone(),
        e_c,
        e_phi,
        e_cu,
        psi,
        ends,
        side_cols,
        power,
        v_scale,
        s_scale,
        cutoff,
        rule,
        layout: OnceLock::new(),
        surface_edges: model.surface_edges.clone(),
        sides: p,
        all_undrained,
        cohesive,
        elements: ne,
        variables: 0,
        constraints: 0,
        warnings,
        mesh: UbMesh {
            x: model.x.clone(),
            y: model.y.clone(),
            el,
        },
    };
    let first = prob.program(1.0);
    prob.variables = first.names.len();
    prob.constraints = first.eq_rhs.len() + first.cones.len();
    Ok(prob)
}

/// Upper bound on the factor of safety of a slope.
pub fn upper_bound(
    slope: &Slope,
    options: &UpperBoundOptions,
    ctx: &mut RunCtx,
) -> Result<UpperBoundResult> {
    let prob = upper_bound_problem(slope, options)?;
    let mut search = BoundSearch::new(options, prob.warnings.clone(), ctx);
    // the velocities of the optimal programs, by F (a Map)
    let mut velocities: Vec<(f64, Vec<f64>)> = Vec::new();
    let lambda_at =
        |search: &mut BoundSearch, velocities: &mut Vec<(f64, Vec<f64>)>, f: f64| -> Result<f64> {
            let Some((r, t0)) = search.solve(ctx, f, |f| prob.program(f), prob.sides)? else {
                return Ok(f64::NAN);
            };
            // No mechanism with unit load power (infeasible): the loads cannot fail
            // the slope at this reduction, λ unbounded.
            let lambda = match r.status {
                ConicStatus::Optimal => r.objective,
                ConicStatus::Infeasible => f64::INFINITY,
                _ => f64::NAN,
            };
            if r.status != ConicStatus::Optimal && r.status != ConicStatus::Infeasible {
                search.warnings.push(format!(
                    "The program at F = {} ended with status \"{}\".",
                    js::num::to_fixed(f, 3),
                    r.detail
                ));
            }
            if r.status == ConicStatus::Optimal {
                match velocities.iter_mut().find(|(g, _)| *g == f) {
                    Some(slot) => slot.1 = r.x,
                    None => velocities.push((f, r.x)),
                }
            }
            search.record(ctx, f, lambda, t0);
            Ok(lambda)
        };
    let tol = options.f_tolerance.unwrap_or(0.002);
    let result = |search: BoundSearch,
                  f: f64,
                  reason: Option<String>,
                  mechanism: Option<Mechanism>| UpperBoundResult {
        factor_of_safety: f,
        trials: search.trials,
        elements: prob.elements,
        variables: prob.variables,
        constraints: prob.constraints,
        warnings: {
            let mut w = search.warnings;
            w.extend(reason);
            w
        },
        mechanism,
    };
    let mut f0 = options.start_f.unwrap_or(1.0);
    let mut l0 = lambda_at(&mut search, &mut velocities, f0)?;
    let not_solved = |f0: f64| {
        format!(
            "The program at F = {} was not solved.",
            js::num::to_fixed(f0, 3)
        )
    };
    if l0.is_nan() {
        return Ok(result(search, f64::NAN, Some(not_solved(f0)), None));
    }
    // Where no mechanism fits the mesh (a friction angle near the slope's,
    // whose mechanisms reach beyond the model) the program is infeasible;
    // with cohesion λ turns finite at a larger reduction.
    // (Not when φ = 0 everywhere: the constraints do not depend on F.)
    let mut k = 0;
    while k < 12 && l0 == f64::INFINITY && prob.cohesive && !prob.all_undrained {
        f0 *= 1.25;
        l0 = lambda_at(&mut search, &mut velocities, f0)?;
        if l0.is_nan() {
            return Ok(result(search, f64::NAN, Some(not_solved(f0)), None));
        }
        k += 1;
    }
    // A reduction F with λ(F) ≤ 1 has a mechanism whose loads do at least the
    // power the reduced strength dissipates: the slope fails there, F is an
    // upper bound. The result is the smallest such F evaluated.
    let f_result: f64;
    let mut mechanism_f = f64::NAN;
    if prob.all_undrained {
        if l0 == 0.0 {
            return Ok(result(
                search,
                0.0,
                Some("A mechanism without dissipation fails the slope at any reduction.".into()),
                None,
            ));
        }
        if !l0.is_finite() {
            return Ok(result(
                search,
                f64::NAN,
                Some("No mechanism fits the mesh: the linear program is infeasible.".into()),
                None,
            ));
        }
        f_result = l0 * f0; // λ(F) = λ(F0)·F0/F
        mechanism_f = f0; // the same mechanism at every F
    } else if l0 == 0.0 || l0 == f64::INFINITY {
        // Without cohesion the dissipation is homogeneous of degree one in the
        // velocities and does not depend on F's scale; and where no mechanism
        // fits the mesh at all the program is infeasible: λ is 0 (a mechanism
        // fails the slope) or unbounded, and F is found by bisection on failure.
        let fails = |search: &mut BoundSearch,
                     velocities: &mut Vec<(f64, Vec<f64>)>,
                     f: f64|
         -> Result<Option<bool>> {
            let l = lambda_at(search, velocities, f)?;
            Ok(if l.is_nan() { None } else { Some(l <= 1.0) })
        };
        let mut lo = 0.0;
        let mut hi = f64::INFINITY;
        if l0 <= 1.0 {
            hi = f0;
        } else {
            lo = f0;
        }
        let mut k = 0;
        while k < 20 && (lo == 0.0 || hi == f64::INFINITY) {
            let f = if lo == 0.0 { hi / 1.5 } else { lo * 1.5 };
            if f < 0.05 || f > 100.0 {
                break;
            }
            match fails(&mut search, &mut velocities, f)? {
                None => break,
                Some(true) => hi = f,
                Some(false) => lo = f,
            }
            k += 1;
        }
        while hi.is_finite() && lo > 0.0 && hi - lo > tol {
            let f = (lo + hi) / 2.0;
            match fails(&mut search, &mut velocities, f)? {
                None => break,
                Some(true) => hi = f,
                Some(false) => lo = f,
            }
        }
        if !hi.is_finite() {
            return Ok(result(
                search,
                f64::NAN,
                Some("No reduction with a failing mechanism was found.".into()),
                None,
            ));
        }
        if !(lo > 0.0) || hi - lo > tol {
            search.warnings.push(format!(
                "The bisection stopped with F between {} and {}; F is the upper of the two.",
                js::num::to_fixed(lo, 3),
                js::num::to_fixed(hi, 3)
            ));
        }
        f_result = hi;
    } else {
        let mut best = if l0 <= 1.0 { f0 } else { f64::INFINITY };
        let mut stands = if l0 > 1.0 { f0 } else { 0.0 };
        let certify = |best: &mut f64, stands: &mut f64, f: f64, l: f64| {
            if l <= 1.0 {
                *best = js::math::min(*best, f);
            } else {
                *stands = js::math::max(*stands, f);
            }
        };
        // Secant on log λ against log F (λ falls about as a power of F), root
        // where λ = 1; the next trial tol/2 above the secant's root, on the
        // failing side. The second point assumes λ ∝ 1/F², within ±50 %. A
        // trial off the bracket between the largest F that stands and the
        // smallest that fails, or after λ = 0 or ∞, bisects it (as the lower
        // bound's search).
        let mut fa = f0;
        let mut la = l0;
        let mut fb = js::math::min(1.5 * f0, js::math::max(f0 / 1.5, f0 * l0.sqrt()));
        let mut lb = lambda_at(&mut search, &mut velocities, fb)?;
        certify(&mut best, &mut stands, fb, lb);
        let mut reached = false;
        let mut root = f64::NAN;
        let near = |l: f64| l > 0.5 && l < 2.0;
        let mut it = 0;
        while it < 25 && !lb.is_nan() {
            if best.is_finite() && best - stands <= tol {
                reached = true;
                break;
            }
            let mut next = f64::NAN;
            if la > 0.0
                && lb > 0.0
                && la.is_finite()
                && lb.is_finite()
                && (js::math::log(lb) - js::math::log(la)).abs() >= 1e-14
            {
                let ga = js::math::log(la);
                let gb = js::math::log(lb);
                root = js::math::max(
                    0.05,
                    js::math::exp(
                        js::math::log(fb)
                            - (gb * (js::math::log(fb) - js::math::log(fa))) / (gb - ga),
                    ),
                );
                // (the secant's root decides only from trials near λ = 1, not across a jump)
                if best.is_finite() && best <= root + tol && near(la) && near(lb) {
                    reached = true;
                    break;
                }
                next = root + tol / 2.0;
            }
            if !(next > stands && next < best && next >= 0.05 && next <= 100.0) {
                next = if best.is_finite() && stands > 0.0 {
                    (best + stands) / 2.0
                } else if best.is_finite() {
                    best / 1.5
                } else {
                    1.5 * stands
                };
            }
            if next < 0.05 || next > 100.0 {
                break;
            }
            fa = fb;
            la = lb;
            fb = next;
            lb = lambda_at(&mut search, &mut velocities, fb)?;
            certify(&mut best, &mut stands, fb, lb);
            it += 1;
        }
        if !best.is_finite() {
            return Ok(result(
                search,
                f64::NAN,
                Some("No reduction with a failing mechanism was found.".into()),
                None,
            ));
        }
        if !reached {
            search.warnings.push(format!(
                "The search for λ = 1 stopped before converging{}; F is the smallest reduction found to fail.",
                if root.is_finite() {
                    format!(" (estimated root F = {})", js::num::to_fixed(root, 3))
                } else {
                    String::new()
                }
            ));
        }
        f_result = best;
    }
    let at = if mechanism_f.is_nan() {
        f_result
    } else {
        mechanism_f
    };
    let cols = velocities.iter().find(|(g, _)| *g == at).map(|(_, c)| c);
    let mechanism = cols.map(|cols| {
        let n = prob.mesh.el.len();
        let mut velocity = vec![0.0f64; 2 * n];
        let mut vmax = 0.0;
        for i in 0..n {
            velocity[2 * i] = cols[2 * i];
            velocity[2 * i + 1] = cols[2 * i + 1];
            vmax = js::math::max(
                vmax,
                js::math::hypot(&[velocity[2 * i], velocity[2 * i + 1]]),
            );
        }
        if vmax > 0.0 {
            for v in velocity.iter_mut() {
                *v /= vmax;
            }
        }
        Mechanism {
            x: prob.mesh.x.clone(),
            y: prob.mesh.y.clone(),
            el: prob.mesh.el.clone(),
            velocity,
        }
    });
    Ok(result(search, f_result, None, mechanism))
}
