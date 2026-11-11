//! Port of packages/engine/src/model/drawdown.ts
//!
//! Rapid drawdown by the three-stage procedure of Duncan, Wright & Wong
//! (1990; Duncan, Wright & Brandon 2014, ch. 9):
//!
//! 1. Before drawdown, with drained strengths and the pore pressures (and
//!    the reservoir on the slope) of the full reservoir: the consolidation
//!    stresses σ′fc and τfc on each slice base.
//! 2. After drawdown, the materials with a drawdown (R) envelope take the
//!    undrained strength τff at their consolidation stresses, interpolated
//!    by the consolidation ratio Kc between isotropic consolidation (Kc = 1,
//!    from the R envelope) and consolidation at failure (Kc = Kf, the
//!    effective envelope).
//! 3. Where the drained strength with the pore pressures after drawdown is
//!    lower than τff (dilating soil), the drained strength is used.
//!
//! The slope's own water is the state after drawdown; `Slope.drawdown_before`
//! is the same model with the water before it.

use crate::error::Result;
use crate::js;
use crate::model::slices::{base_model, get_slices, shansep_strength_at};
use crate::model::slope::{SearchPlane, Slope};
use crate::model::solvers::{
    analyse_bishop_with, analyse_janbu_with, analyse_morgenstern_price_with,
    solved_effective_normals_with, EvalScratch, SliceArrays,
};
use crate::types::analysis::AnalysisMethod;
use crate::types::geometry::Slice;
use crate::types::material::Material;
use crate::types::material_models::MaterialModel;
use crate::types::strength::{design_strength, resolve_strength, StrengthContext};
use std::f64::consts::PI;

/// The R envelope (cohesion, friction angle) and the drained c, φ at the base.
struct REnvelope {
    cohesion: f64,
    friction_angle: f64,
    c: f64,
    phi: f64,
}

/// The drawdown (R) envelope of a slice's base material and its
/// characteristic drained strength there (c′ as resolved at the base, so a
/// cohesion varying with depth counts), if it has an envelope.
fn r_envelope(s: &Slice, materials: &[Material]) -> Result<Option<REnvelope>> {
    let Some(m @ MaterialModel::MohrCoulomb(mc)) = base_model(s, materials) else {
        return Ok(None);
    };
    let Some(env) = &mc.drawdown_strength else {
        return Ok(None);
    };
    let st = resolve_strength(
        m,
        &StrengthContext {
            y_bottom: s.y_bottom,
            x: s.x,
            y_ground: s.y_top,
            y_layer_top: None,
            alpha: s.alpha,
            suction: None,
            effective_vertical_stress: None,
        },
    )?;
    Ok(Some(REnvelope {
        cohesion: env.cohesion,
        friction_angle: env.friction_angle,
        c: st.cohesion,
        phi: st.friction_angle,
    }))
}

/// F and the effective normal forces of the slices by the slope's method;
/// None without a converged solution.
fn solve(
    slope: &Slope,
    slices: &mut [Slice],
    p: &mut SliceArrays,
) -> Result<Option<(f64, Vec<f64>)>> {
    let fos: Option<f64>;
    let converged: bool;
    let mut lff: Option<Vec<[f64; 4]>> = None;
    match slope.method() {
        AnalysisMethod::Bishop => {
            let r = analyse_bishop_with(slope, slices, None, p);
            fos = r.0;
            converged = r.3;
        }
        AnalysisMethod::Janbu => {
            let r = analyse_janbu_with(slope, slices, None, p);
            fos = r.0;
            converged = r.3;
        }
        AnalysisMethod::MorgensternPrice => {
            let r = analyse_morgenstern_price_with(slope, slices, p)?;
            fos = r.fos;
            lff = r.lff_array;
            converged = r.converged || r.closest_pair == Some(true);
        }
    }
    let Some(fos) = fos else {
        return Ok(None);
    };
    if !(fos > 0.0) || !converged {
        return Ok(None);
    }
    Ok(solved_effective_normals_with(slope, slices, fos, lff.as_deref(), p).map(|n| (fos, n)))
}

/// Undrained strength after drawdown at the consolidation stresses σ′fc,
/// τfc on the base (Duncan, Wright & Wong 1990): c′, φ′ the effective
/// envelope, (cR, φR) the R envelope. Kc is the principal stress ratio at
/// consolidation, Kf = (σ′fc + c′cos φ′)(1 + sin φ′) / ((σ′fc − c′cos φ′)
/// (1 − sin φ′)) the ratio at failure on the effective envelope; τff is
/// interpolated by Kc between the envelope at Kc = 1 (from the R envelope)
/// and at Kc = Kf (the effective envelope).
///
/// The Kc = 1 envelope follows Duncan, Wright & Brandon (2014, ch. 9,
/// Eqs. 9.6–9.7), with the R envelope drawn tangent to the Mohr circles
/// and τff = ½(σ1f − σ3f)·cos φ′ (Eq. 9.5):
/// d = cR·cos φR·cos φ′ / (1 − sin φR),
/// tan ψ = sin φR·cos φ′ / (1 − sin φR).
pub fn drawdown_strength(
    sfc: f64,
    tfc: f64,
    c: f64,
    phi_deg: f64,
    c_r: f64,
    phi_r_deg: f64,
) -> f64 {
    let phi = (phi_deg * PI) / 180.0;
    let phi_r = (phi_r_deg * PI) / 180.0;
    let sn = js::math::max(0.0, sfc);
    // Kc = 1: the R envelope expressed against σ′fc (Duncan, Wright &
    // Brandon 2014, Eqs. 9.6–9.7)
    let d1 = (c_r * js::math::cos(phi_r) * js::math::cos(phi)) / (1.0 - js::math::sin(phi_r));
    let tan1 = (js::math::sin(phi_r) * js::math::cos(phi)) / (1.0 - js::math::sin(phi_r));
    let tau1 = d1 + sn * tan1;
    // Kc = Kf: the effective envelope
    let tau_kf = c + sn * js::math::tan(phi);
    let s1 = sfc + (tfc * (js::math::sin(phi) + 1.0)) / js::math::cos(phi);
    let s3 = sfc + (tfc * (js::math::sin(phi) - 1.0)) / js::math::cos(phi);
    let cc = c * js::math::cos(phi);
    let kf = if sfc > cc {
        ((sfc + cc) * (1.0 + js::math::sin(phi))) / ((sfc - cc) * (1.0 - js::math::sin(phi)))
    } else {
        f64::INFINITY
    };
    if !(s3 > 0.0) || !kf.is_finite() {
        return js::math::min(tau1, tau_kf);
    }
    let kc = js::math::min(js::math::max(s1 / s3, 1.0), kf);
    ((kf - kc) * tau1 + (kc - 1.0) * tau_kf) / (kf - 1.0)
}

/// Stages 1–3 on the slices of a surface after drawdown: sets the strength
/// of the bases in materials with a drawdown envelope (undrained, or
/// drained where lower), as design values with the partial factors (γcu on
/// the undrained strength). A SHANSEP base keeps the strength of its
/// effective stress before drawdown (it does not drain). Returns false
/// when the stage before drawdown has no solution (the surface then has no
/// factor of safety).
pub fn apply_rapid_drawdown(
    slope: &Slope,
    slices: &mut [Slice],
    plane: &SearchPlane,
    scratch: &mut EvalScratch,
) -> Result<bool> {
    let Some(before) = slope.drawdown_before() else {
        return Ok(true);
    };
    let materials = slope.materials();
    let mut any = false;
    for s in slices.iter() {
        if r_envelope(s, materials)?.is_some()
            || matches!(base_model(s, materials), Some(MaterialModel::Shansep(_)))
        {
            any = true;
            break;
        }
    }
    if !any {
        return Ok(true);
    }
    let mut sb = get_slices(
        before,
        plane.lc[0],
        plane.rc[0],
        plane.cx,
        plane.cy,
        plane.radius,
        plane.points.as_deref(),
        &mut scratch.slices,
    )?;
    if sb.is_empty() {
        return Ok(false);
    }
    let factors = slope.partial_factors();
    let at = |sb: &[Slice], x: f64| {
        let mut j = 0;
        while j < sb.len() - 1 && sb[j].x_right < x {
            j += 1;
        }
        j
    };
    // undrained SHANSEP: the effective vertical stress before drawdown, as
    // the slices take it (b.U includes the excess pore pressure under loads;
    // the slope before drawdown has no seismic load), and the yield stress
    // from the earlier stage of the slope after drawdown (the slope before
    // drawdown has none)
    for s in slices.iter_mut() {
        let Some(MaterialModel::Shansep(m)) = base_model(s, materials) else {
            continue;
        };
        let b = &sb[at(&sb, s.x)];
        let sv = (b.weight + b.udl + b.ll + b.water_load.unwrap_or(0.0)) / b.width - b.u;
        let st = shansep_strength_at(m, s, sv, slope.earlier_stage())?;
        let d = design_strength(Some("shansep"), &st, factors);
        s.cohesion = d.cohesion;
        s.cohesion_undrained = d.cohesion_undrained;
    }
    let mut envelopes: Vec<Option<REnvelope>> = Vec::with_capacity(slices.len());
    for s in slices.iter() {
        envelopes.push(r_envelope(s, materials)?);
    }
    if envelopes.iter().all(|e| e.is_none()) {
        return Ok(true);
    }
    let Some((fos1, normals1)) = solve(before, &mut sb, &mut scratch.arrays)? else {
        return Ok(false);
    };
    // the design drained strength of each base, for stage 3
    let mut drained_of: Vec<Option<(f64, f64)>> = vec![None; slices.len()];
    let mut tff: Vec<Option<f64>> = vec![None; slices.len()];
    for (i, s) in slices.iter_mut().enumerate() {
        let Some(r) = &envelopes[i] else {
            continue;
        };
        let j = at(&sb, s.x);
        let b = &sb[j];
        let sfc = normals1[j] / b.base_length;
        let tfc = (b.cohesion + js::math::max(0.0, sfc) * js::math::tan(b.phi)) / fos1;
        drained_of[i] = Some((s.cohesion, js::math::tan(s.phi)));
        let t = drawdown_strength(sfc, tfc, r.c, r.phi, r.cohesion, r.friction_angle)
            / factors.map(|f| f.cu).unwrap_or(1.0);
        tff[i] = Some(t);
        s.cohesion = t;
        s.cohesion_undrained = t;
        s.phi = 0.0;
        s.friction_angle = 0.0;
    }
    // stage 3: the drained strength after drawdown where it is lower
    let Some((_, normals2)) = solve(slope, slices, &mut scratch.arrays)? else {
        return Ok(true);
    };
    for (i, s) in slices.iter_mut().enumerate() {
        let (Some(t), Some((dc, dtan))) = (tff[i], drained_of[i]) else {
            continue;
        };
        let sn = normals2[i] / s.base_length;
        if dc + js::math::max(0.0, sn) * dtan < t {
            s.cohesion = dc;
            s.cohesion_undrained = dc;
            s.phi = js::math::atan(dtan);
            s.friction_angle = (s.phi * 180.0) / PI;
        }
    }
    Ok(true)
}
