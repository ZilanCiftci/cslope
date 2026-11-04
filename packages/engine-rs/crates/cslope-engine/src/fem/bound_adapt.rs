//! Port of packages/engine/src/fem/bound-adapt.ts.
//!
//! Mesh refinement on the gap between the lower and the upper bound of limit
//! analysis.
//!
//! Method and sources:
//! - For a statically admissible stress field σ (in equilibrium with λ_L
//!   times the loads, inside the yield criterion) and a kinematically
//!   admissible velocity field u (load power P(u) = 1, dissipation D(u) =
//!   λ_U) on the same mesh, the virtual work equation gives
//!   λ_U − λ_L = Σ_e [D_e(u) − ∫_e σ:ε̇(u) dA] + Σ_edges [D_edge(u) −
//!   ∫ t·[u] ds], every term non-negative (the stress lies inside the
//!   criterion whose support function is the dissipation): the bound gap
//!   splits into element contributions, which are refined where they are
//!   largest (Ciria, Peraire & Bonet 2008, IJNME 75(8), 899–944; Muñoz,
//!   Bonet, Huerta & Peraire 2009, IJNME 77(4), 471–501; Lyamin, Sloan,
//!   Krabbenhøft & Hjiaj 2005, IJNME 63(14), 1961–1974, with the
//!   dissipation alone).
//! - The bounds are those of lower_bound.rs and upper_bound.rs on the mesh
//!   of the strength reduction model; marking by Dörfler's bulk criterion
//!   (adapt.rs).
//!
//! Implementation choices (not from the literature): the gap is split at
//! the upper bound's F (where λ_U ≤ 1 and λ_L < 1, both finite with
//! cohesion); an edge's contribution goes half to each element beside it,
//! a base edge's to its element; the lower bound's sub-elements (split at
//! traction boundaries, fans at corners and loads' ends) count in the
//! element they lie in. With a water table the two programs' terms for the
//! saturated weight and the pore pressure are not identical element by
//! element (the lower bound's sub-elements, whose new nodes take the pore
//! pressure there), and the contributions sum to the gap to a few per cent
//! (3.8 % on a 10 m slope of 2.5 m elements, with the fans of elements at
//! its corners). An edge the lower bound bisected (its fans of elements,
//! possibly more than once) is integrated over its parts. Where the lower
//! bound program has no finite optimum (a cohesionless soil makes λ 0 or
//! unbounded) the dissipation alone is the indicator. The loop stops when
//! the gap is below `gap_tolerance` of the mean bound or after `levels`
//! refinements; each level's searches start from the last level's bounds.
//! θ = 0.6: on V013a (from 226 elements) three levels to 620 elements
//! bracket F in 1.124–1.213 (gap 7.6 %), where a uniform mesh of 1120
//! elements gives 1.120–1.247 (10.7 %); θ = 0.3 refined too little (344
//! elements after three levels, gap 11 %). The meshes are not nested, so a
//! bound can be worse on a finer one: the best of the levels is kept.
//! Speed (implementation choices): the levels before the last search to a
//! tolerance of 0.02 on F (COARSE_TOLERANCE), the last to `f_tolerance`;
//! each level's searches start at the last level's bounds; elements are not
//! refined below a quarter of the first mesh's smallest size
//! (MIN_SIZE_RATIO). With Clarabel on the cones three levels on V013a's
//! default mesh, 1366 to 2859 elements, take 56 s and give 1.135–1.177.
//!
//! Rust notes: time only through the run's clock; `onLevel` is the run's
//! progress (`ProgressEvent::Bounds`, `Break` cancels); a cancelled run is
//! an error, where any other failure of a bound is a warning as in
//! TypeScript.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::api::ctx::{ProgressEvent, RunCtx};
use crate::error::{EngineError, ErrorKind, Result};
use crate::fem::adapt::{dorfler_mark, refined_size_field};
use crate::fem::conic::ConicStatus;
use crate::fem::limit_common::InsertionMap;
use crate::fem::lower_bound::{bound_solve, lower_bound, lower_bound_problem, LowerBoundOptions};
use crate::fem::model::{build_fe_model, ignored_input_warnings, PorePressureSource, SizeField};
use crate::fem::upper_bound::{upper_bound, upper_bound_problem};
use crate::js;
use crate::model::slope::Slope;
use crate::model::surface_slide::{frictional_surface_slide, surface_slide_message};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// Tolerance on F of the levels before the last (they only steer the mesh).
const COARSE_TOLERANCE: f64 = 0.02;
/// The refinement does not make elements smaller than the first mesh's smallest over this.
const MIN_SIZE_RATIO: f64 = 4.0;

/// `BoundGap`.
#[derive(Debug, Clone, PartialEq)]
pub struct BoundGap {
    /// Contribution of each element of the model's mesh to λ_U − λ_L.
    pub eta: Vec<f64>,
    /// λ of the two programs at F.
    pub lambda_lower: f64,
    pub lambda_upper: f64,
    /// Whether the stress field entered (otherwise eta is the dissipation alone).
    pub with_stress: bool,
}

/// The bound gap at the reduction F split per element of the mesh that
/// `build_fe_model(slope, options)` makes (see the header); None when the
/// upper bound program has no optimum at F.
pub fn bound_gap_indicator(
    slope: &Slope,
    options: &LowerBoundOptions,
    f: f64,
) -> Result<Option<BoundGap>> {
    let tl = options.time_limit.unwrap_or(300.0);
    let ub = upper_bound_problem(slope, options)?;
    // without cohesion nothing dissipates at the bounds' F: no gap to split
    if !ub.cohesive {
        return Ok(Some(BoundGap {
            eta: vec![0.0; ub.elements],
            lambda_lower: f64::NAN,
            lambda_upper: 0.0,
            with_stress: false,
        }));
    }
    let ru = bound_solve(&ub.program(f), ub.sides, tl);
    if ru.status != ConicStatus::Optimal {
        return Ok(None);
    }
    let cu = &ru.x;
    let mut eta = ub.element_dissipation(f, cu);
    let (x, y, el) = (&ub.mesh.x, &ub.mesh.y, &ub.mesh.el);
    let ne = eta.len();
    let lb = lower_bound_problem(slope, options)?;
    let rl = bound_solve(&lb.program(f), lb.sides, tl);
    if rl.status != ConicStatus::Optimal {
        return Ok(Some(BoundGap {
            eta,
            lambda_lower: f64::NAN,
            lambda_upper: ru.objective,
            with_stress: false,
        }));
    }
    let cl = &rl.x;
    let vel = |e: usize, k: usize| -> [f64; 2] { [cu[2 * (3 * e + k)], cu[2 * (3 * e + k) + 1]] };

    // strain rate of each upper bound element (constant), engineering shear
    let mut rate = vec![0.0f64; 3 * ne];
    for e in 0..ne {
        let n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
        let b = [y[n[1]] - y[n[2]], y[n[2]] - y[n[0]], y[n[0]] - y[n[1]]];
        let c = [x[n[2]] - x[n[1]], x[n[0]] - x[n[2]], x[n[1]] - x[n[0]]];
        let a2 = b[0] * c[1] - b[1] * c[0];
        let (mut ex, mut ey, mut g) = (0.0, 0.0, 0.0);
        for k in 0..3 {
            let [u, v] = vel(e, k);
            ex += b[k] * u;
            ey += c[k] * v;
            g += c[k] * u + b[k] * v;
        }
        rate[3 * e] = ex / a2;
        rate[3 * e + 1] = ey / a2;
        rate[3 * e + 2] = g / a2;
    }

    // ∫ σ:ε̇ over each element, from the lower bound's sub-elements in it
    let (lx, ly, lel, parent) = (&lb.mesh.x, &lb.mesh.y, &lb.mesh.el, &lb.mesh.parent);
    let sig = |t: usize, k: usize, comp: usize| cl[9 * t + 3 * k + comp];
    let nt = parent.len();
    // the sub-element and its corners at the ends of each of its edges, by the element e it lies in
    let mut side_of: HashMap<(usize, usize, usize), (usize, usize, usize)> = HashMap::new();
    for t in 0..nt {
        let e = parent[t];
        let n = [lel[3 * t], lel[3 * t + 1], lel[3 * t + 2]];
        let a2 = (lx[n[1]] - lx[n[0]]) * (ly[n[2]] - ly[n[0]])
            - (lx[n[2]] - lx[n[0]]) * (ly[n[1]] - ly[n[0]]);
        let area = a2.abs() / 2.0;
        let mut w = 0.0;
        for k in 0..3 {
            w += sig(t, k, 0) * rate[3 * e]
                + sig(t, k, 1) * rate[3 * e + 1]
                + sig(t, k, 2) * rate[3 * e + 2];
        }
        eta[e] -= (area * w) / 3.0;
        for k in 0..3 {
            side_of.insert((e, n[k], n[(k + 1) % 3]), (t, k, (k + 1) % 3));
        }
    }

    // ∫ t·[u] over the edges, t = σn outward of e, [u] = u(other side) − u(e)
    let nc = x.len();
    let key = |a: usize, b: usize| if a < b { a * nc + b } else { b * nc + a };
    let mut owners: InsertionMap<Vec<(usize, usize)>> = InsertionMap::new();
    for e in 0..ne {
        for k in 0..3 {
            let kk = key(el[3 * e + k], el[3 * e + (k + 1) % 3]);
            match owners.get_mut(kk) {
                Some(list) => list.push((e, k)),
                None => owners.set(kk, vec![(e, k)]),
            }
        }
    }
    // (the model's surface edges: TypeScript builds the same model again for them)
    let mut surface: std::collections::HashSet<usize> = std::collections::HashSet::new();
    let se = &ub.surface_edges;
    let mut s = 0;
    while s < se.len() {
        surface.insert(key(se[s], se[s + 2]));
        s += 3;
    }
    for (kk, list) in owners.iter() {
        if surface.contains(&kk) {
            continue;
        }
        let (e, k) = list[0];
        let a = el[3 * e + k];
        let b = el[3 * e + (k + 1) % 3];
        if list.len() == 1 && (x[b] - x[a]).abs() <= 1e-3 * (y[b] - y[a]).abs() {
            continue; // smooth side
        }
        let l = js::math::hypot(&[x[b] - x[a], y[b] - y[a]]);
        // normal outward of e: away from its centroid
        let mut nx = (y[b] - y[a]) / l;
        let mut ny = -(x[b] - x[a]) / l;
        let cx = (x[el[3 * e]] + x[el[3 * e + 1]] + x[el[3 * e + 2]]) / 3.0;
        let cy = (y[el[3 * e]] + y[el[3 * e + 1]] + y[el[3 * e + 2]]) / 3.0;
        if nx * ((x[a] + x[b]) / 2.0 - cx) + ny * ((y[a] + y[b]) / 2.0 - cy) < 0.0 {
            nx = -nx;
            ny = -ny;
        }
        let corner_of = |ee: usize, node: usize| -> usize {
            for q in 0..3 {
                if el[3 * ee + q] == node {
                    return q;
                }
            }
            usize::MAX
        };
        let other = if list.len() > 1 {
            Some(list[1].0)
        } else {
            None
        };
        let jump = |node: usize| -> [f64; 2] {
            let [u, v] = vel(e, corner_of(e, node));
            match other {
                None => [-u, -v],
                Some(o) => {
                    let [u2, v2] = vel(o, corner_of(o, node));
                    [u2 - u, v2 - v]
                }
            }
        };
        // over a segment (p, q) of the edge, with the jumps there (linear along
        // the edge), through the halves of an edge bisected for a fan, recursively
        #[allow(clippy::too_many_arguments)]
        fn segment(
            p: usize,
            q: usize,
            dp: [f64; 2],
            dq: [f64; 2],
            e: usize,
            n: [f64; 2],
            side_of: &HashMap<(usize, usize, usize), (usize, usize, usize)>,
            lb: &crate::fem::lower_bound::LbProblem,
            cl: &[f64],
        ) -> f64 {
            let side = side_of.get(&(e, p, q)).or_else(|| side_of.get(&(e, q, p)));
            let Some(&(t, k0, k1)) = side else {
                let Some(m) = lb.mesh.split_at(p.min(q), p.max(q)) else {
                    return 0.0;
                };
                let dm = [(dp[0] + dq[0]) / 2.0, (dp[1] + dq[1]) / 2.0];
                return segment(p, m, dp, dm, e, n, side_of, lb, cl)
                    + segment(m, q, dm, dq, e, n, side_of, lb, cl);
            };
            let (lx, ly, lel) = (&lb.mesh.x, &lb.mesh.y, &lb.mesh.el);
            let sig = |t: usize, k: usize, comp: usize| cl[9 * t + 3 * k + comp];
            let kp = if lel[3 * t + k0] == p { k0 } else { k1 };
            let kq = if kp == k0 { k1 } else { k0 };
            let [nx, ny] = n;
            let trac = |kc: usize| -> [f64; 2] {
                [
                    sig(t, kc, 0) * nx + sig(t, kc, 2) * ny,
                    sig(t, kc, 2) * nx + sig(t, kc, 1) * ny,
                ]
            };
            let tp = trac(kp);
            let tq = trac(kq);
            let dot = |p: [f64; 2], q: [f64; 2]| p[0] * q[0] + p[1] * q[1];
            let ls = js::math::hypot(&[lx[q] - lx[p], ly[q] - ly[p]]);
            (ls / 6.0) * (2.0 * dot(tp, dp) + dot(tp, dq) + dot(tq, dp) + 2.0 * dot(tq, dq))
        }
        let work = segment(a, b, jump(a), jump(b), e, [nx, ny], &side_of, &lb, cl);
        match other {
            None => eta[e] -= work,
            Some(o) => {
                eta[e] -= work / 2.0;
                eta[o] -= work / 2.0;
            }
        }
    }
    Ok(Some(BoundGap {
        eta,
        lambda_lower: rl.objective,
        lambda_upper: ru.objective,
        with_stress: true,
    }))
}

/// `AdaptiveBoundsOptions`: the bounds' options and the refinement's.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveBoundsOptions {
    #[serde(flatten)]
    pub bounds: LowerBoundOptions,
    /// Refinements at most; default 3.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub levels: Option<f64>,
    /// Dörfler fraction of the gap marked per refinement; default 0.6.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub theta: Option<f64>,
    /// Time budget of the whole analysis, every level (s): each search and
    /// program gets at most what is left of it, and a refinement is not
    /// started when four times the last level's time is not left (the gap's
    /// two programs and the searches on a larger mesh); default none.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub refinement_time_limit: Option<f64>,
    /// Stop when (upper − lower) / mean is below this; default 0.03.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub gap_tolerance: Option<f64>,
}

/// `AdaptiveBoundsLevel`: the bounds of one level (NaN where not found).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AdaptiveBoundsLevel {
    pub elements: usize,
    pub lower: f64,
    pub upper: f64,
    pub seconds: f64,
}

/// `AdaptiveBoundsResult`.
#[derive(Debug, Clone, PartialEq)]
pub struct AdaptiveBoundsResult {
    pub lower: f64,
    pub upper: f64,
    pub levels: Vec<AdaptiveBoundsLevel>,
    /// The size field of the last mesh.
    pub size_field: Arc<SizeField>,
    pub warnings: Vec<String>,
}

/// A failure of a bound becomes a warning; a cancellation ends the run.
fn caught<T>(r: Result<T>) -> Result<std::result::Result<T, EngineError>> {
    match r {
        Err(e) if e.kind == ErrorKind::Cancelled => Err(e),
        other => Ok(other),
    }
}

/// Lower and upper bounds on meshes refined where the bound gap lies (see the header).
pub fn adaptive_bounds(
    slope: &Slope,
    options: &AdaptiveBoundsOptions,
    ctx: &mut RunCtx,
) -> Result<AdaptiveBoundsResult> {
    let levels = options.levels.unwrap_or(3.0);
    let theta = options.theta.unwrap_or(0.6);
    let tol = options.gap_tolerance.unwrap_or(0.03);
    let start = ctx.clock.now_ms();
    let budget = options.refinement_time_limit.unwrap_or(f64::INFINITY);
    let remaining = |ctx: &RunCtx| budget - (ctx.clock.now_ms() - start) / 1000.0;
    // each search and program within what is left of the budget
    let limited = |o: &LowerBoundOptions, ctx: &RunCtx| -> LowerBoundOptions {
        let mut o = o.clone();
        let left = js::math::max(1.0, remaining(ctx));
        o.total_time_limit = Some(js::math::min(
            o.total_time_limit.unwrap_or(f64::INFINITY),
            left,
        ));
        o.time_limit = Some(js::math::min(o.time_limit.unwrap_or(300.0), left));
        o
    };
    // the inputs the bounds do not take, once (not for each level and bound)
    let ignored = ignored_input_warnings(slope);
    let mut warnings: Vec<String> = ignored.clone();
    let mut out: Vec<AdaptiveBoundsLevel> = Vec::new();
    let mut opts: LowerBoundOptions = options.bounds.clone();
    let mut lower = f64::NAN;
    let mut upper = f64::NAN;
    let mut size_field: Arc<SizeField> = opts.model.size_field.clone().unwrap_or_else(|| {
        Arc::new(SizeField::Constant {
            value: f64::NAN,
            min: None,
        })
    });
    // a face in frictional soil with a lower infinite-slope factor (not with seepage pore pressures)
    let slide = if options.bounds.model.pore_pressure == Some(PorePressureSource::Seepage) {
        None
    } else {
        frictional_surface_slide(slope, false)?
    };
    let result = |lower: f64,
                  upper: f64,
                  out: Vec<AdaptiveBoundsLevel>,
                  size_field: Arc<SizeField>,
                  mut warnings: Vec<String>| {
        if let Some(s) = &slide {
            if s.factor_of_safety < upper {
                warnings.push(surface_slide_message(s, upper));
            }
        }
        Ok(AdaptiveBoundsResult {
            lower,
            upper,
            levels: out,
            size_field,
            warnings,
        })
    };
    // the smallest element size of the first mesh, a quarter of which bounds the refinement
    let mut h0 = f64::INFINITY;
    let coarse_tol = js::math::max(
        options.bounds.f_tolerance.unwrap_or(0.002),
        COARSE_TOLERANCE,
    );
    let mut level: usize = 0;
    loop {
        let t0 = ctx.clock.now_ms();
        // the levels before the last steer the mesh: their searches to a coarser tolerance
        let mut level_opts = opts.clone();
        if (level as f64) < levels {
            level_opts.f_tolerance = Some(coarse_tol);
        }
        // Each bound on its own: a failure of one (or of a refined mesh) keeps
        // what the other levels and bounds found.
        let mut ub_f = f64::NAN;
        let mut lb_f = f64::NAN;
        let mut elements = 0;
        let mut o = level_opts.clone();
        o.start_f = if upper.is_finite() && upper > 0.0 {
            Some(upper)
        } else {
            opts.start_f
        };
        let o = limited(&o, ctx);
        match caught(upper_bound(slope, &o, ctx))? {
            Ok(ubr) => {
                for w in &ubr.warnings {
                    if !ignored.contains(w) {
                        warnings.push(format!("Level {level}, upper bound: {w}"));
                    }
                }
                ub_f = ubr.factor_of_safety;
                elements = ubr.elements;
            }
            Err(e) => warnings.push(format!("Level {level}, upper bound: {}", e.message)),
        }
        let mut o = level_opts.clone();
        o.start_f = if lower.is_finite() && lower > 0.0 {
            Some(lower)
        } else {
            opts.start_f
        };
        let o = limited(&o, ctx);
        match caught(lower_bound(slope, &o, ctx))? {
            Ok(lbr) => {
                for w in &lbr.warnings {
                    if !ignored.contains(w) {
                        warnings.push(format!("Level {level}, lower bound: {w}"));
                    }
                }
                lb_f = lbr.factor_of_safety;
                if elements == 0 {
                    elements = lbr.elements;
                }
            }
            Err(e) => warnings.push(format!("Level {level}, lower bound: {}", e.message)),
        }
        // the remeshed levels are not nested, and a bound on a finer mesh can
        // be worse: the best of the levels is kept
        if ub_f.is_finite() {
            upper = if upper.is_finite() {
                js::math::min(upper, ub_f)
            } else {
                ub_f
            };
        }
        if lb_f.is_finite() {
            lower = if lower.is_finite() {
                js::math::max(lower, lb_f)
            } else {
                lb_f
            };
        }
        out.push(AdaptiveBoundsLevel {
            elements,
            lower: lb_f,
            upper: ub_f,
            seconds: (ctx.clock.now_ms() - t0) / 1000.0,
        });
        ctx.report(ProgressEvent::Bounds(out[out.len() - 1]))?;
        let model = match caught(build_fe_model(slope, &opts.model))? {
            Ok(m) => m,
            Err(e) => {
                warnings.push(format!("Level {level}: {}", e.message));
                return result(lower, upper, out, size_field, warnings);
            }
        };
        size_field = Arc::clone(&model.size_field);
        if level == 0 {
            for e in 0..model.element_count {
                let (a, b, c) = (model.el[6 * e], model.el[6 * e + 1], model.el[6 * e + 2]);
                h0 = js::math::min(
                    h0,
                    model.size_field.at(
                        (model.x[a] + model.x[b] + model.x[c]) / 3.0,
                        (model.y[a] + model.y[b] + model.y[c]) / 3.0,
                    ),
                );
            }
        }
        let done = lower.is_finite()
            && upper.is_finite()
            && (upper - lower) <= tol * (upper + lower) / 2.0;
        if done || (level as f64) >= levels || !(ub_f > 0.0) || !ub_f.is_finite() {
            return result(lower, upper, out, size_field, warnings);
        }
        // the next level: the gap's two programs and the two searches on a
        // larger mesh, about four times this level's searches
        if 4.0 * out[out.len() - 1].seconds > remaining(ctx) {
            warnings.push(format!(
                "The refinement stopped after {level} of {} levels at its time limit of {} s.",
                js::num::to_string(levels),
                options
                    .refinement_time_limit
                    .map_or("undefined".to_string(), js::num::to_string)
            ));
            return result(lower, upper, out, size_field, warnings);
        }
        ctx.check_cancelled()?;
        let gap = match caught(bound_gap_indicator(slope, &limited(&opts, ctx), ub_f))? {
            Ok(g) => g,
            Err(e) => {
                warnings.push(format!("Level {level}, bound gap: {}", e.message));
                return result(lower, upper, out, size_field, warnings);
            }
        };
        let Some(gap) = gap else {
            warnings.push(format!(
                "Level {level}: the upper bound program at F = {} gave no mechanism to refine on.",
                js::num::to_fixed(ub_f, 3)
            ));
            return result(lower, upper, out, size_field, warnings);
        };
        let eta: Vec<f64> = gap.eta.iter().map(|&v| js::math::max(0.0, v)).collect();
        let mut total = 0.0;
        for &v in &eta {
            total += v;
        }
        // a cohesionless soil dissipates nothing at the bounds' F (the
        // programs are homogeneous): there is no gap to refine on
        if !(total > 0.0) {
            warnings.push(format!(
                "Level {level}: the bound gap has no element contributions to refine on (no cohesion)."
            ));
            return result(lower, upper, out, size_field, warnings);
        }
        if !gap.with_stress && level == 0 {
            warnings.push("The lower bound program has no finite optimum at the upper bound's F: refined on the dissipation alone.".to_string());
        }
        opts.model.size_field = Some(refined_size_field(
            &model,
            &dorfler_mark(&eta, theta),
            if h0.is_finite() {
                h0 / MIN_SIZE_RATIO
            } else {
                0.0
            },
        ));
        level += 1;
    }
}
