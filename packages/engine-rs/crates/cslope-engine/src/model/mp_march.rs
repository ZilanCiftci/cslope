//! Port of packages/engine/src/model/mp-march.ts
//!
//! Morgenstern–Price / Spencer solved as a root-finding problem.
//!
//! An experimental solver kept beside `analyse_morgenstern_price` so that the
//! two can be compared before one replaces the other. Same slice physics as
//! the iterative solver (`solve_slice_normal`, the same strength, water,
//! reinforcement and load terms), a different numerical method:
//!
//! - For a trial (F, λ) the slices are marched once from left to right. The
//!   march gives every base normal and interslice force directly, so there
//!   is no fixed-point iteration on F or N. The march returns the two
//!   residuals the method must close: force, g_f = D_f − R_f/F (horizontal
//!   equilibrium of the whole mass), and moment, g_m = D_m − R_m/F (moment
//!   equilibrium about the circle centre, or the axis point of a polyline).
//! - F_f(λ): the F that closes force equilibrium at a given λ, found as the
//!   root of g_f in F within the pole-free band (every slice's denominator
//!   positive, i.e. m_α with the interslice inclination included keeps its
//!   sign; outside it a base normal has reversed). The force residual is
//!   monotonic in F there.
//! - h(λ) = g_m(F_f(λ), λ): the moment residual evaluated at the force-
//!   equilibrium F, one smooth scalar function of λ whose zeros are the
//!   solutions. Working through F_f keeps the search off the moment-only
//!   curve F_m(λ), which has spurious branches (F → 0). h is scanned on a λ
//!   grid, every sign change between two defined neighbours is bracketed,
//!   and each root is refined with Brent's method.
//! - A two-dimensional Newton iteration on (F, λ) from (F_Bishop, 0) is the
//!   fast path; the λ scan is the reference and the fallback.
//!
//! Sources: Fredlund (1984) recommends Newton–Raphson on (F, λ); the
//! F_f/F_m crossing is Fredlund & Krahn (1977); the pole-free band is
//! Morgenstern & Price's (1965) positivity rule in slice form, the form an
//! open implementation (Jones 2026) uses. Selection among several roots is
//! left to the caller (`RootRule`); the roots are all reported.

use crate::error::Result;
use crate::js;
use crate::model::slope::Slope;
use crate::model::solvers::{analyse_ordinary, solve_slice_normal, MpOutcome, SliceArrays};
use crate::types::geometry::Slice;
use std::f64::consts::PI;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::RwLock;

/// One march over the slices at a trial (F, λ).
#[derive(Debug, Clone, PartialEq)]
pub struct March {
    /// Force residual D_f − R_f/F (kN/m); zero at force equilibrium.
    pub gf: f64,
    /// Moment residual D_m − R_m/F (kN·m/m); zero at moment equilibrium.
    pub gm: f64,
    /// Scale of the force terms, |D_f| + |R_f/F|, for relative tests.
    pub f_scale: f64,
    /// Scale of the moment terms.
    pub m_scale: f64,
    /// Effective base normal force per slice (kN/m).
    pub n: Vec<f64>,
    /// Interslice normal force on the right of each slice (solver sign).
    pub e: Vec<f64>,
    /// Interslice shear force on the right of each slice.
    pub x: Vec<f64>,
    /// Smallest slice denominator; > 0 means every slice is inside the band.
    pub min_denom: f64,
    /// Slices whose denominator is ≤ 0.
    pub out_of_band: usize,
    /// Slices with N < 0.
    pub negative_n: usize,
    /// Largest interslice resultant over the total vertical load.
    pub max_z_over_load: f64,
    /// Whether the combined-method slices ended on the undrained strength.
    pub undrained: Vec<u8>,
}

/// Marches performed since the process started (for cost measurements;
/// TypeScript's `marchCounter.count`).
pub static MARCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Same per-slice equations as the iterative solvers, evaluated once.
pub fn march(p: &SliceArrays, lambda: f64, f: f64) -> March {
    MARCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let n = p.len();
    let mut nv = vec![0.0; n];
    let mut ev = vec![0.0; n];
    let mut xv = vec![0.0; n];
    let mut undrained = vec![0u8; n];
    let k_p = if f > 0.0 { 1.0 / f } else { 1.0 };
    let mut e_left = 0.0;
    let mut x_left = 0.0;
    let mut m_push = 0.0;
    let mut m_res = 0.0;
    let mut passive_moment = 0.0;
    let mut f_push = 0.0;
    let mut f_res = 0.0;
    let mut passive_force = 0.0;
    let mut min_denom = f64::INFINITY;
    let mut out_of_band = 0;
    let mut negative_n = 0;
    let mut max_z = 0.0;
    let mut load = 0.0;

    for i in 0..n {
        let w = p.weights[i] + p.udls[i] + p.lls[i] + p.active_v[i] + p.passive_v[i] * k_p;
        let h = p.h_forces[i] + p.active_h[i] + p.passive_h[i] * k_p;
        let c = p.cohesions[i];
        let bl = p.base_lengths[i];
        let u = p.us[i];
        let cu = p.cohesion_undraineds[i];
        let tan_phi = p.tan_phis[i];
        let cos_a = p.cos_as[i];
        let sin_a = p.sin_as[i];
        let sf = lambda * p.funcs[i];

        let mut tan_used = tan_phi;
        let [mut ni, mut e_right, mut x_right] = solve_slice_normal(
            w,
            x_left,
            e_left - h,
            c * bl - u * bl * tan_phi,
            tan_phi,
            cos_a,
            sin_a,
            sf,
            f,
        );
        let mut shear = c * bl + (ni - u * bl) * tan_phi;
        // Combined method: where the undrained strength governs, the slice is
        // in equilibrium with that shear (as in the iterative solvers).
        if p.material_codes[i] == 1 && !(shear >= 0.0 && shear <= cu * bl) {
            [ni, e_right, x_right] =
                solve_slice_normal(w, x_left, e_left - h, cu * bl, 0.0, cos_a, sin_a, sf, f);
            shear = cu * bl;
            tan_used = 0.0;
            undrained[i] = 1;
        }
        // The denominator of the slice's normal force: m_α with the interslice
        // inclination included. Zero is a pole of the march.
        let denom = cos_a + (sin_a * tan_used) / f - ((tan_used * cos_a) / f - sin_a) * sf;
        if denom < min_denom {
            min_denom = denom;
        }
        if denom <= 0.0 {
            out_of_band += 1;
        }
        if ni < 0.0 {
            negative_n += 1;
        }

        m_res += shear * p.shear_arms[i];
        m_push += (w - p.passive_v[i] * k_p) * p.dxs[i]
            + p.extra_moments[i]
            + p.active_m[i]
            + ni * p.normal_arms[i];
        passive_moment += p.passive_v[i] * p.dxs[i] + p.passive_m[i];
        f_res += shear * cos_a;
        f_push += ni * sin_a + h - p.passive_h[i] * k_p;
        passive_force += p.passive_h[i];

        nv[i] = ni;
        ev[i] = e_right;
        xv[i] = x_right;
        let z = js::math::hypot(&[e_right, x_right]);
        if z > max_z {
            max_z = z;
        }
        load += (p.weights[i] + p.udls[i] + p.lls[i]).abs();
        e_left = e_right;
        x_left = x_right;
    }
    m_res -= passive_moment;
    f_res -= passive_force;
    March {
        gf: f_push - f_res / f,
        gm: m_push - m_res / f,
        f_scale: f_push.abs() + (f_res / f).abs(),
        m_scale: m_push.abs() + (m_res / f).abs(),
        n: nv,
        e: ev,
        x: xv,
        min_denom,
        out_of_band,
        negative_n,
        max_z_over_load: if load > 0.0 { max_z / load } else { 0.0 },
        undrained,
    }
}

/// Brent's method on [a, b] with fa·fb < 0.
#[allow(clippy::too_many_arguments)]
fn brent(
    mut f: impl FnMut(f64) -> f64,
    mut a: f64,
    mut b: f64,
    mut fa: f64,
    mut fb: f64,
    xtol: f64,
    max_iter: u32,
) -> f64 {
    let mut c = a;
    let mut fc = fa;
    let mut d = b - a;
    let mut e = d;
    for _ in 0..max_iter {
        if fb * fc > 0.0 {
            c = a;
            fc = fa;
            d = b - a;
            e = d;
        }
        if fc.abs() < fb.abs() {
            a = b;
            b = c;
            c = a;
            fa = fb;
            fb = fc;
            fc = fa;
        }
        let tol = 2.0 * f64::EPSILON * b.abs() + xtol / 2.0;
        let m = (c - b) / 2.0;
        if m.abs() <= tol || fb == 0.0 {
            return b;
        }
        if e.abs() >= tol && fa.abs() > fb.abs() {
            let s = fb / fa;
            let mut pp;
            let mut q;
            if a == c {
                pp = 2.0 * m * s;
                q = 1.0 - s;
            } else {
                let qq = fa / fc;
                let r = fb / fc;
                pp = s * (2.0 * m * qq * (qq - r) - (b - a) * (r - 1.0));
                q = (qq - 1.0) * (r - 1.0) * (s - 1.0);
            }
            if pp > 0.0 {
                q = -q;
            } else {
                pp = -pp;
            }
            if 2.0 * pp < js::math::min(3.0 * m * q - (tol * q).abs(), (e * q).abs()) {
                e = d;
                d = pp / q;
            } else {
                d = m;
                e = m;
            }
        } else {
            d = m;
            e = m;
        }
        a = b;
        fa = fb;
        b += if d.abs() > tol {
            d
        } else if m > 0.0 {
            tol
        } else {
            -tol
        };
        fb = f(b);
    }
    b
}

/// Smallest slice denominator (m_α with the interslice inclination included)
/// a root may have. Near zero the base normal force of that slice tends to
/// infinity and the factor of safety is meaningless (Whitman & Bailey 1967,
/// Ching & Fredlund 1983); 0.2 is the limit commonly quoted from Whitman &
/// Bailey. On the verification set every root that agrees with the
/// published value has a minimum denominator ≥ 0.22, and every spurious
/// root the search otherwise reaches has ≤ 0.06.
pub const MIN_DENOMINATOR: f64 = 0.2;

/// Limits on the interslice force inclination θ = atan(λ f), from the Corps
/// of Engineers manual of Edris & Wright (1987, vol. I para. 107): the
/// solution is terminated when θ is less than −10° or steeper than +80° for
/// a left-facing slope. λ is the scale of f(x), so with f = 1 (Spencer)
/// λ = tan θ. (TypeScript computes them with Math.tan at module load.)
pub static LAMBDA_MIN: std::sync::LazyLock<f64> =
    std::sync::LazyLock::new(|| js::math::tan((-10.0 * PI) / 180.0));
pub static LAMBDA_MAX: std::sync::LazyLock<f64> =
    std::sync::LazyLock::new(|| js::math::tan((80.0 * PI) / 180.0));

/// F is not allowed below 0.10 (Edris & Wright 1987, vol. I para. 104).
const F_MIN: f64 = 0.1;
const F_MAX: f64 = 50.0;
const F_GRID: usize = 24;
const F_TOL: f64 = 1e-7;

/// Residual of force equilibrium at F, or NaN outside the band.
fn gf_in_band(p: &SliceArrays, lambda: f64, f: f64) -> f64 {
    let m = march(p, lambda, f);
    if m.out_of_band > 0 || !m.gf.is_finite() {
        f64::NAN
    } else {
        m.gf
    }
}

/// The pole-free band in F at a given λ, in closed form: each slice's
/// denominator is a + b/F with a = cos α + λf sin α and b = tan φ (sin α −
/// λf cos α), positive for F on one side of its pole −b/a. Combined-method
/// slices, whose tan φ depends on the solution, are left out; the march
/// still checks every slice. Returns [lo, hi] within [F_MIN, F_MAX], empty
/// (lo ≥ hi) when no F keeps every denominator positive.
pub fn force_band(p: &SliceArrays, lambda: f64) -> [f64; 2] {
    let mut lo = F_MIN;
    let mut hi = F_MAX;
    let mut i = 0;
    while i < p.len() && lo < hi {
        if p.material_codes[i] == 1 {
            i += 1;
            continue;
        }
        let sf = lambda * p.funcs[i];
        let cos_a = p.cos_as[i];
        let sin_a = p.sin_as[i];
        let a = cos_a + sf * sin_a;
        let b = p.tan_phis[i] * (sin_a - sf * cos_a);
        if a > 0.0 {
            if b < 0.0 {
                lo = js::math::max(lo, -b / a);
            }
        } else if a < 0.0 {
            if b > 0.0 {
                hi = js::math::min(hi, -b / a);
            } else {
                return [1.0, 0.0];
            }
        } else if b <= 0.0 {
            return [1.0, 0.0];
        }
        i += 1;
    }
    [lo, hi]
}

/// F_f(λ) and how many roots the scan found in the band (normally one).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ForceRoot {
    pub f: f64,
    pub count: usize,
}

/// F_f(λ): the F closing force equilibrium at λ, inside the pole-free band.
/// Secant from the seed first; a bracketed scan of F when that fails.
/// Returns None when no such F exists (a hole in h(λ)).
pub fn solve_force_f(p: &SliceArrays, lambda: f64, seed: f64) -> Option<ForceRoot> {
    let [lo, hi] = force_band(p, lambda);
    if !(hi > lo) {
        return None;
    }
    // Keep clear of the poles at the ends of the band.
    let margin = 1e-6 * (hi - lo);
    let lo2 = lo + margin;
    let hi2 = hi - margin;
    let inside = |f: f64| f > lo2 && f < hi2;
    // Secant from the seed, moved into the band.
    let mut a = js::math::min(js::math::max(seed, lo2), hi2);
    let mut b = if inside(a * 1.05) { a * 1.05 } else { a * 0.95 };
    let mut fa = gf_in_band(p, lambda, a);
    let mut fb = gf_in_band(p, lambda, b);
    let mut iter = 0;
    while iter < 40 && fa.is_finite() && fb.is_finite() {
        if fb == fa {
            break;
        }
        let c = b - (fb * (b - a)) / (fb - fa);
        if !inside(c) {
            break;
        }
        a = b;
        fa = fb;
        b = c;
        fb = gf_in_band(p, lambda, b);
        if (b - a).abs() < F_TOL && fb.is_finite() {
            let m = march(p, lambda, b);
            if m.gf.abs() <= 1e-6 * m.f_scale {
                return Some(ForceRoot { f: b, count: 1 });
            }
            break;
        }
        iter += 1;
    }
    // Bracketed scan: geometric F grid over the band.
    let mut roots: Vec<f64> = Vec::new();
    let mut prev_f = lo2;
    let mut prev_g = gf_in_band(p, lambda, prev_f);
    let ratio = js::math::pow(hi2 / lo2, 1.0 / (F_GRID as f64 - 1.0));
    for k in 1..F_GRID {
        let f = if k == F_GRID - 1 {
            hi2
        } else {
            lo2 * js::math::pow(ratio, k as f64)
        };
        let g = gf_in_band(p, lambda, f);
        if prev_g.is_finite() && g.is_finite() && prev_g * g <= 0.0 {
            let r = if prev_g == 0.0 {
                prev_f
            } else {
                brent(
                    |x| gf_in_band(p, lambda, x),
                    prev_f,
                    f,
                    prev_g,
                    g,
                    F_TOL,
                    100,
                )
            };
            if r.is_finite() && gf_in_band(p, lambda, r).is_finite() {
                roots.push(r);
            }
        }
        prev_f = f;
        prev_g = g;
    }
    if roots.is_empty() {
        return None;
    }
    // Normally one root; with several, the one nearest the seed.
    js::array::sort_by(&mut roots, |x, y| {
        js::math::log(x / seed).abs() - js::math::log(y / seed).abs()
    });
    Some(ForceRoot {
        f: roots[0],
        count: roots.len(),
    })
}

/// A root of h(λ).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MpRoot {
    pub lambda: f64,
    pub f: f64,
    /// Slices with a negative base normal force.
    pub negative_n: usize,
    /// Largest interslice resultant over the total vertical load.
    pub max_z_over_load: f64,
    pub min_denom: f64,
}

/// Which root to report when several exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RootRule {
    #[default]
    NearestZero,
    Largest,
    Smallest,
}

/// Options of the march solver.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct MpMarchOptions {
    /// λ is scanned on [lambda_min, lambda_max] (defaults LAMBDA_MIN, LAMBDA_MAX).
    pub lambda_max: Option<f64>,
    pub lambda_min: Option<f64>,
    /// Scan step in λ.
    pub lambda_step: Option<f64>,
    /// Which root to report when several exist.
    pub rule: Option<RootRule>,
    /// Skip the 2-D Newton fast path (scan only).
    pub scan_only: Option<bool>,
    /// Roots with a smaller slice denominator are rejected (MIN_DENOMINATOR).
    pub min_denominator: Option<f64>,
}

/// The result of the march solver.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MpMarchResult {
    /// Roots of h(λ) found by the scan that clear the denominator limit, by λ.
    pub roots: Vec<MpRoot>,
    /// Roots on a pole (denominator below the limit): not solutions.
    pub rejected: Vec<MpRoot>,
    /// The 2-D Newton solution, or None when it failed.
    pub newton: Option<MpRoot>,
    /// The reported root per `rule`, or None when there is none.
    pub chosen: Option<MpRoot>,
    /// λ points where F_f(λ) had no solution in the band.
    pub holes: usize,
    /// λ points where the force residual had more than one root in the band.
    pub multi_ff: usize,
    /// Marches performed.
    pub evaluations: usize,
}

/// Two-dimensional Newton on (F, λ) with scaled residuals and backtracking.
fn newton2d(p: &SliceArrays, f0: f64, lambda0: f64) -> Option<MpRoot> {
    let m0 = march(p, lambda0, f0);
    if !m0.gf.is_finite() || !m0.gm.is_finite() {
        return None;
    }
    // (`m0.fScale || 1`: 0 and NaN give 1)
    let sf = if m0.f_scale != 0.0 && !m0.f_scale.is_nan() {
        m0.f_scale
    } else {
        1.0
    };
    let sm = if m0.m_scale != 0.0 && !m0.m_scale.is_nan() {
        m0.m_scale
    } else {
        1.0
    };
    let res = |f: f64, l: f64| -> Option<[f64; 2]> {
        if !(f > F_MIN && f < F_MAX) {
            return None;
        }
        let m = march(p, l, f);
        if !m.gf.is_finite() || !m.gm.is_finite() {
            return None;
        }
        Some([m.gf / sf, m.gm / sm])
    };
    let mut f = f0;
    let mut l = lambda0;
    let mut r = res(f, l)?;
    for _ in 0..60 {
        let norm = js::math::hypot(&[r[0], r[1]]);
        if norm < 1e-9 {
            break;
        }
        let d_f = 1e-6 * js::math::max(1.0, f);
        let dl = 1e-6;
        let r_f = res(f + d_f, l)?;
        let rl = res(f, l + dl)?;
        let j00 = (r_f[0] - r[0]) / d_f;
        let j01 = (rl[0] - r[0]) / dl;
        let j10 = (r_f[1] - r[1]) / d_f;
        let j11 = (rl[1] - r[1]) / dl;
        let det = j00 * j11 - j01 * j10;
        if !det.is_finite() || det.abs() < 1e-300 {
            return None;
        }
        let step_f = (-r[0] * j11 + r[1] * j01) / det;
        let step_l = (-r[1] * j00 + r[0] * j10) / det;
        let mut t = 1.0;
        let mut next: Option<[f64; 2]> = None;
        for _ in 0..20 {
            next = res(f + t * step_f, l + t * step_l);
            if let Some(nx) = next {
                if js::math::hypot(&[nx[0], nx[1]]) < norm {
                    break;
                }
            }
            next = None;
            t /= 2.0;
        }
        let nx = next?;
        f += t * step_f;
        l += t * step_l;
        r = nx;
        if (t * step_f).abs() < F_TOL && (t * step_l).abs() < 1e-9 {
            break;
        }
    }
    let m = march(p, l, f);
    if js::math::hypot(&[r[0], r[1]]) > 1e-7 || m.out_of_band > 0 {
        return None;
    }
    Some(MpRoot {
        lambda: l,
        f,
        negative_n: m.negative_n,
        max_z_over_load: m.max_z_over_load,
        min_denom: m.min_denom,
    })
}

/// A point of the λ grid: F_f(λ) (None: a hole) and h(λ).
struct GridPoint {
    l: f64,
    f: Option<f64>,
    h: f64,
}

/// Solve M-P on prepared slice arrays. `f0` seeds F_f (e.g. the Ordinary F).
pub fn solve_morgenstern_price_march(
    p: &SliceArrays,
    f0: f64,
    options: &MpMarchOptions,
) -> MpMarchResult {
    let lambda_max = options.lambda_max.unwrap_or(*LAMBDA_MAX);
    let lambda_min = options.lambda_min.unwrap_or(*LAMBDA_MIN);
    let step = options.lambda_step.unwrap_or(0.1);
    let rule = options.rule.unwrap_or_default();
    let min_denom = options.min_denominator.unwrap_or(MIN_DENOMINATOR);
    let mut evaluations = 0;
    let mut ff = |l: f64, seed: f64| {
        evaluations += 1;
        solve_force_f(p, l, seed)
    };

    let mut holes = 0;
    let mut multi_ff = 0;
    // h(λ) on the grid, from 0 outwards so each F_f is seeded by its neighbour.
    let mut side = |sign: f64, ff: &mut dyn FnMut(f64, f64) -> Option<ForceRoot>| {
        let mut seed = f0;
        let mut pts: Vec<GridPoint> = Vec::new();
        let mut k: f64 = if sign > 0.0 { 0.0 } else { 1.0 };
        loop {
            let mut l = sign * k * step;
            if sign > 0.0 && l > lambda_max + 1e-12 {
                break;
            }
            if sign < 0.0 && l < lambda_min - 1e-12 {
                // One point at the limit itself, so a root just inside it is bracketed.
                if pts.last().is_some_and(|q| q.l > lambda_min + 1e-12) {
                    l = lambda_min;
                } else {
                    break;
                }
            }
            k += 1.0;
            let Some(r) = ff(l, seed) else {
                holes += 1;
                pts.push(GridPoint {
                    l,
                    f: None,
                    h: f64::NAN,
                });
                continue;
            };
            if r.count > 1 {
                multi_ff += 1;
            }
            seed = r.f;
            pts.push(GridPoint {
                l,
                f: Some(r.f),
                h: march(p, l, r.f).gm,
            });
        }
        pts
    };
    let mut grid: Vec<GridPoint> = side(-1.0, &mut ff);
    grid.reverse();
    let right = side(1.0, &mut ff);
    grid.extend(right);

    let mut roots: Vec<MpRoot> = Vec::new();
    let mut rejected: Vec<MpRoot> = Vec::new();
    for i in 1..grid.len() {
        let (a, b) = (&grid[i - 1], &grid[i]);
        let (Some(af), Some(_)) = (a.f, b.f) else {
            continue;
        };
        if !a.h.is_finite() || !b.h.is_finite() {
            continue;
        }
        if a.h * b.h > 0.0 {
            continue;
        }
        let mut seed = af;
        let l = if a.h == 0.0 {
            a.l
        } else {
            brent(
                |l: f64| match ff(l, seed) {
                    None => f64::NAN,
                    Some(r) => {
                        seed = r.f;
                        march(p, l, r.f).gm
                    }
                },
                a.l,
                b.l,
                a.h,
                b.h,
                1e-6,
                100,
            )
        };
        let Some(r) = ff(l, seed) else {
            continue;
        };
        let m = march(p, l, r.f);
        if !m.gm.is_finite() {
            continue;
        }
        let root = MpRoot {
            lambda: l,
            f: r.f,
            negative_n: m.negative_n,
            max_z_over_load: m.max_z_over_load,
            min_denom: m.min_denom,
        };
        if m.min_denom >= min_denom {
            roots.push(root);
        } else {
            rejected.push(root);
        }
    }

    let mut newton = if options.scan_only == Some(true) {
        None
    } else {
        newton2d(p, f0, 0.0)
    };
    if let Some(nw) = newton {
        if nw.min_denom < min_denom || nw.lambda < lambda_min || nw.lambda > lambda_max {
            newton = None;
        }
    }

    let mut chosen: Option<MpRoot> = None;
    if !roots.is_empty() {
        let key = |r: &MpRoot| match rule {
            RootRule::NearestZero => r.lambda.abs(),
            RootRule::Largest => -r.f,
            RootRule::Smallest => r.f,
        };
        let mut best = roots[0];
        for r in &roots {
            if key(r) < key(&best) {
                best = *r;
            }
        }
        chosen = Some(best);
    }
    MpMarchResult {
        roots,
        rejected,
        newton,
        chosen,
        holes,
        multi_ff,
        evaluations,
    }
}

/// Newton first, then a short scan of the λ between the lower limit and
/// Newton's root: Newton from (F₀, 0) can land on the farther of two roots
/// (V033, V094 in the verification set), and the reported root is the one
/// nearest λ = 0. The full scan runs only when Newton fails. The full scan
/// is the reference; `solve_morgenstern_price_march` runs it always.
pub fn solve_morgenstern_price_fast(
    p: &SliceArrays,
    f0: f64,
    options: &MpMarchOptions,
) -> MpMarchResult {
    let min_denom = options.min_denominator.unwrap_or(MIN_DENOMINATOR);
    let lambda_min = options.lambda_min.unwrap_or(*LAMBDA_MIN);
    let lambda_max = options.lambda_max.unwrap_or(*LAMBDA_MAX);
    let newton = if options.scan_only == Some(true) {
        None
    } else {
        newton2d(p, f0, 0.0)
    };
    if let Some(nw) = newton {
        if nw.min_denom >= min_denom && nw.lambda >= lambda_min && nw.lambda <= lambda_max {
            // Any root nearer λ = 0 lies in [lambdaMin, |λ_N|] on either side.
            let near = nw.lambda.abs();
            let r = solve_morgenstern_price_march(
                p,
                f0,
                &MpMarchOptions {
                    scan_only: Some(true),
                    lambda_min: Some(js::math::max(lambda_min, -near)),
                    lambda_max: Some(js::math::min(lambda_max, near)),
                    ..*options
                },
            );
            let mut roots: Vec<MpRoot> = r
                .roots
                .iter()
                .filter(|x| (x.lambda - nw.lambda).abs() > 1e-4)
                .copied()
                .collect();
            roots.push(nw);
            js::array::sort_by(&mut roots, |a, b| a.lambda - b.lambda);
            let mut chosen = nw;
            for x in &roots {
                if x.lambda.abs() < chosen.lambda.abs() {
                    chosen = *x;
                }
            }
            return MpMarchResult {
                roots,
                rejected: r.rejected,
                newton: Some(nw),
                chosen: Some(chosen),
                holes: r.holes,
                multi_ff: r.multi_ff,
                evaluations: r.evaluations,
            };
        }
    }
    solve_morgenstern_price_march(
        p,
        f0,
        &MpMarchOptions {
            scan_only: Some(true),
            ..*options
        },
    )
}

/// Options `analyse_morgenstern_price_march` runs with; set by comparison
/// scripts (TypeScript's module global).
static SEARCH_OPTIONS: RwLock<MpMarchOptions> = RwLock::new(MpMarchOptions {
    lambda_max: None,
    lambda_min: None,
    lambda_step: None,
    rule: None,
    scan_only: None,
    min_denominator: None,
});

pub fn set_march_search_options(options: MpMarchOptions) {
    *SEARCH_OPTIONS.write().unwrap_or_else(|e| e.into_inner()) = options;
}

/// Drop-in counterpart of `analyse_morgenstern_price`: the same slices and
/// slope options, the march solver. The reported root follows `rule`.
/// `options`: None for those set with `set_march_search_options`.
pub fn analyse_morgenstern_price_march(
    slope: &Slope,
    slices: &mut [Slice],
    options: Option<&MpMarchOptions>,
) -> Result<MpOutcome> {
    let options = match options {
        Some(o) => *o,
        None => *SEARCH_OPTIONS.read().unwrap_or_else(|e| e.into_inner()),
    };
    let Some(f0) = analyse_ordinary(slope, slices) else {
        return Ok(MpOutcome {
            converged: true,
            ..Default::default()
        });
    };
    let points = slope.interslice_data_points();
    let props = crate::model::solvers::get_slice_property_arrays(
        slices,
        slices[0].x_left,
        slices[slices.len() - 1].x_right,
        slope.interslice_function(),
        &points,
    );
    let r = solve_morgenstern_price_fast(&props, f0, &options);
    let lff: Vec<[f64; 4]> = r.roots.iter().map(|x| [x.lambda, x.f, x.f, 0.0]).collect();
    let Some(chosen) = r.chosen else {
        return Ok(MpOutcome {
            lff_array: Some(lff),
            ..Default::default()
        });
    };
    // Leave the undrained flags as the chosen root set them.
    let m = march(&props, chosen.lambda, chosen.f);
    for (i, s) in slices.iter_mut().enumerate() {
        if props.material_codes[i] == 1 {
            s.undrained_governs = Some(m.undrained[i] == 1);
        }
    }
    Ok(MpOutcome {
        fos: Some(chosen.f),
        lff_array: Some(lff),
        pushing: None,
        resisting: None,
        converged: true,
        equilibrium_gap: None,
        closest_pair: None,
    })
}
