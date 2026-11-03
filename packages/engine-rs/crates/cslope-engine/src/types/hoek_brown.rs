//! Port of packages/engine/src/types/hoek-brown.ts
//!
//! The generalised Hoek–Brown criterion for rock masses (Hoek, Carranza-
//! Torres & Corkum 2002, Proc. NARMS-TAC, 267–273):
//!
//!   σ1′ = σ3′ + σci (mb σ3′/σci + s)^a,  compression positive,
//!   mb = mi exp((GSI − 100)/(28 − 14D)),  s = exp((GSI − 100)/(9 − 3D)),
//!   a = 1/2 + (e^(−GSI/15) − e^(−20/3))/6,
//!
//! and its instantaneous Mohr–Coulomb parameters: the tangent to the Mohr
//! envelope at a normal stress, from the slope k = dσ1/dσ3 = 1 + a mb
//! (mb σ3/σci + s)^(a−1) of the principal stress envelope (Balmer 1952,
//! Proc. ASTM 52, 1260–1271; Hoek et al. 2002, eq. 4–5):
//!
//!   σn = (σ1 + σ3)/2 − (σ1 − σ3)/2 · (k − 1)/(k + 1),
//!   τ = (σ1 − σ3) √k/(k + 1),  sin φi = (k − 1)/(k + 1),  ci = τ − σn tan φi.
//!
//! Implementation choices (not from the literature): in tension (σ3 < 0,
//! or σn below its value at σ3 = 0) the tangent at σ3 = 0 is used: towards
//! the tensile strength σt = −s σci/mb the envelope turns vertical (φi →
//! 90°), and that tangent as a Mohr–Coulomb material would have an
//! unbounded compressive strength; σn is inverted by bisection on σ3 ≥ 0
//! with an upper bound doubled until it is passed.

use crate::js;
use crate::types::material_models::HoekBrownModel;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoekBrownParameters {
    /// Uniaxial compressive strength of the intact rock σci (kPa).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub ucs: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub mb: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub s: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub a: f64,
}

/// Instantaneous Mohr–Coulomb parameters: c (kPa) and φ (°).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CohesionFriction {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cohesion: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub friction_angle: f64,
}

/// mb, s and a of the generalised criterion from GSI, mi and the disturbance D (default 0).
pub fn hoek_brown_parameters(ucs: f64, gsi: f64, mi: f64, disturbance: f64) -> HoekBrownParameters {
    let d = disturbance;
    HoekBrownParameters {
        ucs,
        mb: mi * js::math::exp((gsi - 100.0) / (28.0 - 14.0 * d)),
        s: js::math::exp((gsi - 100.0) / (9.0 - 3.0 * d)),
        a: 0.5 + (js::math::exp(-gsi / 15.0) - js::math::exp(-20.0 / 3.0)) / 6.0,
    }
}

/// mb, s and a of a material: given directly, or from GSI, mi and D.
pub fn hoek_brown_of(model: &HoekBrownModel) -> HoekBrownParameters {
    if let (Some(mb), Some(s)) = (model.mb, model.s) {
        return HoekBrownParameters {
            ucs: model.ucs,
            mb,
            s,
            a: model.a.unwrap_or(0.5),
        };
    }
    hoek_brown_parameters(
        model.ucs,
        model.gsi,
        model.mi,
        model.disturbance.unwrap_or(0.0),
    )
}

/// The envelope at σ3 (compression positive): σn, τ and the slope k.
struct Envelope {
    sn: f64,
    tau: f64,
    k: f64,
}

fn at_sigma3(p: &HoekBrownParameters, s3: f64) -> Envelope {
    let base = js::math::max(1e-12, (p.mb * s3) / p.ucs + p.s);
    let s1 = s3 + p.ucs * js::math::pow(base, p.a);
    let k = 1.0 + p.a * p.mb * js::math::pow(base, p.a - 1.0);
    Envelope {
        sn: (s1 + s3) / 2.0 - ((s1 - s3) / 2.0) * ((k - 1.0) / (k + 1.0)),
        tau: ((s1 - s3) * k.sqrt()) / (k + 1.0),
        k,
    }
}

const MAX_PHI: f64 = (89.9 * std::f64::consts::PI) / 180.0;

/// Instantaneous c (kPa) and φ (°) of the envelope at σ3 (compression positive).
pub fn instantaneous_at_sigma3(p: &HoekBrownParameters, s3: f64) -> CohesionFriction {
    let e = at_sigma3(p, js::math::max(s3, 0.0));
    let phi = js::math::min(MAX_PHI, js::math::asin((e.k - 1.0) / (e.k + 1.0)));
    CohesionFriction {
        cohesion: js::math::max(0.0, e.tau - e.sn * js::math::tan(phi)),
        friction_angle: (phi * 180.0) / std::f64::consts::PI,
    }
}

/// Instantaneous c (kPa) and φ (°) of the envelope at the normal stress σn (compression positive).
pub fn instantaneous_at_normal_stress(p: &HoekBrownParameters, sn: f64) -> CohesionFriction {
    let mut lo = 0.0;
    if !(sn > at_sigma3(p, lo).sn) {
        return instantaneous_at_sigma3(p, lo);
    }
    let mut hi = js::math::max(1.0, sn.abs());
    while at_sigma3(p, hi).sn < sn {
        hi *= 2.0;
    }
    let mut k = 0;
    while k < 100 && hi - lo > 1e-10 * (1.0 + hi.abs()) {
        let m = (lo + hi) / 2.0;
        if at_sigma3(p, m).sn < sn {
            lo = m;
        } else {
            hi = m;
        }
        k += 1;
    }
    instantaneous_at_sigma3(p, (lo + hi) / 2.0)
}
