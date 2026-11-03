//! Port of packages/engine/src/types/validation.ts
//!
//! Material model validation.
//!
//! Returns a list of human-readable error strings. An empty list
//! means the model is valid. This is the single source of truth for
//! model validation — used by both the engine (`buildSlope()`) and the
//! desktop UI (inline error display).
//!
//! The shape checks of TypeScript (a list that is not an array, a point
//! with the wrong number of values, an optional number that is not a
//! number) are made by deserialization here: such JSON does not
//! deserialize into a `MaterialModel`.

use crate::types::material_models::{
    is_combined_depth_model, supports_anisotropy, supports_suction_strength, DepthReference,
    MaterialModel,
};

/// Validate a `MaterialModel` and return any errors found (empty: valid).
pub fn validate_material_model(model: &MaterialModel) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();
    let base = model.base();

    // ── Common: unitWeight must be positive ──────────────────────
    if !base.unit_weight.is_finite() || base.unit_weight <= 0.0 {
        errors.push("Unit weight (γ) must be a positive number.".into());
    } else if base.unit_weight > 500.0 {
        errors.push("Unit weight (γ) must be at most 500 kN/m³.".into());
    }
    if let Some(sat) = base.unit_weight_sat {
        if !sat.is_finite() || sat <= 0.0 || sat > 500.0 {
            errors.push(
                "Saturated unit weight (γsat) must be a positive number up to 500 kN/m³.".into(),
            );
        }
    }
    if let Some(ru) = base.ru {
        if !(ru.is_finite() && ru >= 0.0 && ru < 1.0) {
            errors.push("The pore pressure ratio rᵤ must be at least 0 and below 1.".into());
        }
    }
    if let Some(b_bar) = base.b_bar {
        if !(b_bar.is_finite() && b_bar >= 0.0 && b_bar <= 1.5) {
            errors.push("B̄ must be between 0 and 1.5.".into());
        }
    }
    if let Some(above) = &base.above_water {
        if above.base().above_water.is_some() {
            errors.push("The strength above the water line cannot itself have one.".into());
        } else {
            for e in validate_material_model(above) {
                errors.push(format!("Above the water line: {e}"));
            }
        }
    }

    // Optional numeric fields must be finite when given: NaN would silently
    // turn into zero strength further on.
    let optional: Vec<(Option<f64>, &str)> = match model {
        MaterialModel::MohrCoulomb(m) => vec![
            (
                m.cohesion_ref_depth,
                "The reference elevation of the cohesion",
            ),
            (
                m.cohesion_rate_of_change,
                "The rate of change of the cohesion",
            ),
            (m.cohesion_undrained, "The undrained shear strength (Su)"),
            (m.c_factor, "The c-factor"),
        ],
        MaterialModel::Undrained(m) => vec![
            (m.su_ref_depth, "The reference elevation of Su"),
            (m.su_rate_of_change, "The rate of change of Su"),
        ],
        MaterialModel::LimeCementColumns(m) => vec![
            (m.su_ref_depth, "The reference elevation of Su"),
            (m.su_rate_of_change, "The rate of change of Su"),
        ],
        _ => vec![],
    };
    for (v, label) in optional {
        if let Some(v) = v {
            if !v.is_finite() {
                errors.push(format!("{label} must be a finite number."));
            }
        }
    }

    match model {
        MaterialModel::MohrCoulomb(m) => {
            if !m.cohesion.is_finite() || m.cohesion < 0.0 {
                errors.push("Cohesion (c) must be ≥ 0.".into());
            }
            if let Some(d) = &m.drawdown_strength {
                if !(d.cohesion.is_finite() && d.cohesion >= 0.0) {
                    errors.push("Drawdown cohesion (cR) must be ≥ 0.".into());
                }
                if !(d.friction_angle.is_finite()
                    && d.friction_angle >= 0.0
                    && d.friction_angle < 90.0)
                {
                    errors.push("Drawdown friction angle (φR) must be 0–90°.".into());
                }
            }
            if !m.friction_angle.is_finite() || m.friction_angle < 0.0 {
                errors.push("Friction angle (φ) must be ≥ 0.".into());
            } else if m.friction_angle >= 90.0 {
                errors.push("Friction angle (φ) must be less than 90°.".into());
            }
            if m.c_factor.is_some_and(|c| c < 0.0) {
                errors.push("The c-factor must be ≥ 0.".into());
            }
            if m.cohesion == 0.0
                && m.friction_angle == 0.0
                && !(m.cohesion_rate_of_change.unwrap_or(0.0) > 0.0)
            {
                errors.push(
                    "Both c and φ are zero — the material has no strength. Set at least one."
                        .into(),
                );
            }
            if m.c_factor.is_some_and(|c| c > 0.0) {
                // Combined method — needs its own Su (it fell back to c′ silently).
                if !m
                    .cohesion_undrained
                    .is_some_and(|cu| cu.is_finite() && cu >= 0.0)
                {
                    errors.push("Undrained cohesion (Su) must be ≥ 0 for combined method.".into());
                }
            }
        }

        MaterialModel::Undrained(m) => {
            if !m.undrained_shear_strength.is_finite() || m.undrained_shear_strength < 0.0 {
                errors.push("Undrained shear strength (Su) must be ≥ 0.".into());
            }
            validate_cutoff(&mut errors, m.su_max);
        }

        MaterialModel::HighStrength(_) => {
            // Only unitWeight is needed — no additional validation
        }

        MaterialModel::Impenetrable(_) => {
            // Only unitWeight is needed — no additional validation
        }

        MaterialModel::SpatialMohrCoulomb(m) => {
            if m.data_points.is_empty() {
                errors.push("Spatial Mohr-Coulomb requires at least 1 data point.".into());
            } else {
                for (i, pt) in m.data_points.iter().enumerate() {
                    if !pt.iter().all(|v| v.is_finite()) {
                        errors.push(format!(
                            "Data point {}: all values must be finite numbers.",
                            i + 1
                        ));
                    }
                    if pt[2] < 0.0 {
                        errors.push(format!("Data point {}: cohesion (c) must be ≥ 0.", i + 1));
                    }
                    if pt[3] < 0.0 {
                        errors.push(format!(
                            "Data point {}: friction angle (φ) must be ≥ 0.",
                            i + 1
                        ));
                    }
                    if pt[4] <= 0.0 {
                        errors.push(format!(
                            "Data point {}: unit weight (γ) must be > 0.",
                            i + 1
                        ));
                    }
                }
            }
        }

        MaterialModel::AnisotropicFunction(m) => {
            if !m.cohesion.is_finite() || m.cohesion < 0.0 {
                errors.push("Base cohesion (c) must be ≥ 0.".into());
            }
            if !m.friction_angle.is_finite() || m.friction_angle < 0.0 {
                errors.push("Base friction angle (φ) must be ≥ 0.".into());
            } else if m.friction_angle >= 90.0 {
                errors.push("Base friction angle (φ) must be less than 90°.".into());
            }
            validate_modifier(
                &mut errors,
                &m.modifier_function,
                "Anisotropic modifier function",
            );
        }

        MaterialModel::StrengthFromDepth(m) => {
            if !m.su_ref.is_finite() || m.su_ref < 0.0 {
                errors.push("The reference Su must be ≥ 0.".into());
            }
            if !m.depth_ref.is_finite() {
                errors.push("The reference depth must be a finite number.".into());
            }
            if !m.rate.is_finite() {
                errors.push("Rate of change must be a finite number.".into());
            }
            if matches!(m.depth_reference, Some(DepthReference::Other(_))) {
                errors.push("Depth reference must be \"ground\" or \"layer-top\".".into());
            }
            validate_cutoff(&mut errors, m.su_max);
            if m.drained_cohesion.is_none() != m.drained_friction_angle.is_none() {
                errors.push("A combined S = f(depth) needs both the drained c′ and φ′.".into());
            }
            if m.drained_cohesion
                .is_some_and(|c| !(c.is_finite() && c >= 0.0))
            {
                errors.push("Drained cohesion (c′) must be ≥ 0.".into());
            }
            if m.drained_cohesion_rate.is_some_and(|r| !r.is_finite()) {
                errors.push("Rate of change of c′ must be a finite number.".into());
            }
            if m.drained_friction_angle
                .is_some_and(|p| !(p.is_finite() && p >= 0.0 && p < 90.0))
            {
                errors.push("Drained friction angle (φ′) must be ≥ 0 and less than 90°.".into());
            }
        }

        MaterialModel::HoekBrown(m) => {
            if !m.ucs.is_finite() || m.ucs <= 0.0 {
                errors.push("σci must be > 0.".into());
            }
            if m.mb.is_some() || m.s.is_some() {
                // the criterion's own parameters, given directly
                if !m.mb.is_some_and(|mb| mb.is_finite() && mb > 0.0) {
                    errors.push("mb must be > 0.".into());
                }
                if !m.s.is_some_and(|s| s.is_finite() && s >= 0.0 && s <= 1.0) {
                    errors.push("s must be between 0 and 1.".into());
                }
                if m.a.is_some_and(|a| !(a.is_finite() && a > 0.0 && a <= 1.0)) {
                    errors.push("a must be between 0 and 1.".into());
                }
            } else {
                if !m.gsi.is_finite() || m.gsi < 0.0 || m.gsi > 100.0 {
                    errors.push("GSI must be between 0 and 100.".into());
                }
                if !m.mi.is_finite() || m.mi <= 0.0 {
                    errors.push("mi must be > 0.".into());
                }
                if m.disturbance
                    .is_some_and(|d| !(d.is_finite() && d >= 0.0 && d <= 1.0))
                {
                    errors.push("Disturbance factor D must be between 0 and 1.".into());
                }
            }
        }

        MaterialModel::LimeCementColumns(m) => {
            if !m.soil_su.is_finite() || m.soil_su < 0.0 {
                errors.push("Soil Su between the columns must be ≥ 0.".into());
            }
            if !m.column_su.is_finite() || m.column_su < 0.0 {
                errors.push("Column Su must be ≥ 0.".into());
            }
            if !m.area_ratio.is_finite() || m.area_ratio < 0.0 || m.area_ratio > 1.0 {
                errors.push("Area ratio must be between 0 and 1.".into());
            }
            if m.su_ref_depth.is_some_and(|v| !v.is_finite()) {
                errors.push("Reference level must be a finite number.".into());
            }
            if m.su_rate_of_change.is_some_and(|v| !v.is_finite()) {
                errors.push("Rate of change must be a finite number.".into());
            }
            if m.column_cohesion.is_none() != m.column_friction_angle.is_none() {
                errors.push(
                    "Give both the drained column cohesion and friction angle, or neither.".into(),
                );
            } else if let Some(c) = m.column_cohesion {
                if !c.is_finite() || c < 0.0 {
                    errors.push("Drained column cohesion must be ≥ 0.".into());
                }
                if !m
                    .column_friction_angle
                    .is_some_and(|p| p.is_finite() && p >= 0.0 && p < 90.0)
                {
                    errors.push("Drained column friction angle must be 0–90°.".into());
                }
            }
            validate_cutoff(&mut errors, m.su_max);
        }

        MaterialModel::ShearNormal(m) => {
            let pts = &m.points;
            if pts.len() < 2 || !pts.iter().all(|p| p.iter().all(|v| v.is_finite())) {
                errors.push(
                    "The shear-normal function needs at least two finite [σn, τ] points.".into(),
                );
            } else {
                if pts.windows(2).any(|w| !(w[1][0] > w[0][0])) {
                    errors.push(
                        "The shear-normal points must be sorted by increasing normal stress."
                            .into(),
                    );
                }
                if pts.iter().any(|p| p[1] < 0.0) {
                    errors.push(
                        "The shear strengths of the shear-normal function must be ≥ 0.".into(),
                    );
                }
            }
        }

        MaterialModel::Shansep(m) => {
            if !(m.ratio.is_finite() && m.ratio >= 0.0) {
                errors.push("SHANSEP ratio S must be ≥ 0.".into());
            }
            if m.exponent.is_some_and(|v| !v.is_finite()) {
                errors.push("SHANSEP exponent m must be a finite number.".into());
            }
            if m.ocr.is_some_and(|v| !(v.is_finite() && v > 0.0)) {
                errors.push("OCR must be > 0.".into());
            }
            if m.pop.is_some_and(|v| !(v.is_finite() && v >= 0.0)) {
                errors.push("POP must be ≥ 0.".into());
            }
            if m.yield_stress.is_some_and(|v| !(v.is_finite() && v >= 0.0)) {
                errors.push("The yield stress must be ≥ 0.".into());
            }
            if m.pop.is_some() && m.yield_stress.is_some() {
                errors.push("Give either POP or the yield stress, not both.".into());
            }
            if m.su_min.is_some_and(|v| !(v.is_finite() && v >= 0.0)) {
                errors.push("Minimum Su must be ≥ 0.".into());
            }
            let mut table = |pts: &Option<Vec<[f64; 2]>>, what: &str| {
                let Some(pts) = pts else { return };
                if pts.is_empty() || !pts.iter().all(|p| p.iter().all(|v| v.is_finite())) {
                    errors.push(format!("{what} must be a list of finite [x, y] points."));
                } else if pts.windows(2).any(|w| !(w[1][0] > w[0][0])) {
                    errors.push(format!("{what} must be sorted by increasing x."));
                }
            };
            table(&m.ocr_by_elevation, "OCR against elevation");
            table(&m.su_by_stress, "Su against σ′v");
        }

        MaterialModel::StrengthFromDatum(m) => {
            if !m.su_ref.is_finite() || m.su_ref < 0.0 {
                errors.push("The reference Su must be ≥ 0.".into());
            }
            if !m.y_ref.is_finite() {
                errors.push("The reference elevation must be a finite number.".into());
            }
            if !m.rate.is_finite() {
                errors.push("Rate of change must be a finite number.".into());
            }
            validate_cutoff(&mut errors, m.su_max);
        }

        MaterialModel::Unknown(m) => {
            errors.push(format!("Unknown material model kind \"{}\".", m.kind));
        }
    }

    // anisotropy: not set or empty is isotropic
    if supports_anisotropy(model.kind()) {
        if let Some(anisotropy) = model.anisotropy() {
            if !anisotropy.is_empty() {
                validate_modifier(&mut errors, anisotropy, "Anisotropy");
            }
        }
    }
    validate_suction(&mut errors, model);
    errors
}

/// Strength from suction (`UnsaturatedStrength`): 0 ≤ φb < 90 and a
/// maximum suction > 0, on a model whose drained strength takes it (an
/// S = f(depth) material only in a combined analysis).
fn validate_suction(errors: &mut Vec<String>, model: &MaterialModel) {
    let base = model.base();
    let (phi_b, max_suction) = (base.phi_b, base.max_suction);
    if phi_b.is_none() && max_suction.is_none() {
        return;
    }
    if phi_b.is_some_and(|p| !(p.is_finite() && p >= 0.0 && p < 90.0)) {
        errors.push("φb must be ≥ 0 and less than 90°.".into());
    }
    if max_suction.is_some_and(|m| !(m.is_finite() && m > 0.0)) {
        errors.push("The maximum suction must be a positive number.".into());
    }
    if phi_b.is_some_and(|p| p > 0.0) {
        if !supports_suction_strength(model.kind()) {
            errors.push(
                "φb (strength from suction) is only taken by Mohr-Coulomb, the anisotropic function and a combined S = f(depth)."
                    .into(),
            );
        } else if model.kind() == "s-f-depth" && !is_combined_depth_model(model) {
            errors.push("φb (strength from suction) needs the drained branch of a combined S = f(depth) analysis.".into());
        }
    }
}

/// A modifier function [[α°, factor], …]: at least two points, finite, factors ≥ 0.
fn validate_modifier(errors: &mut Vec<String>, f: &[[f64; 2]], what: &str) {
    if f.len() < 2 {
        errors.push(format!("{what} requires at least 2 data points."));
        return;
    }
    for (i, pt) in f.iter().enumerate() {
        if !pt.iter().all(|v| v.is_finite()) {
            errors.push(format!(
                "Modifier point {}: all values must be finite numbers.",
                i + 1
            ));
        } else if pt[1] < 0.0 {
            errors.push(format!("Modifier point {}: factor must be ≥ 0.", i + 1));
        }
    }
}

/// Strength cutoff `suMax`: finite and > 0. With a negative rate the cutoff
/// is a floor. It may lie above the reference Su (the profile is highest at
/// its top), so it is not compared with it (TypeScript passes the rate and
/// the reference Su and ignores them); varied values (reliability,
/// sensitivity) must not make a valid model invalid either.
fn validate_cutoff(errors: &mut Vec<String>, su_max: Option<f64>) {
    let Some(su_max) = su_max else { return };
    if !su_max.is_finite() || su_max <= 0.0 {
        errors.push("The strength cutoff must be a positive number.".into());
    }
}
