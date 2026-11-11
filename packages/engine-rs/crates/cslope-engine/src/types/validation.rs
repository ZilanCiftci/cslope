//! Port of packages/engine/src/types/validation.ts
//!
//! Material model validation.
//!
//! Returns a list of human-readable error strings. An empty list
//! means the model is valid. This is the single source of truth for
//! model validation — used by both the engine (`buildSlope()`) and the
//! desktop UI (inline error display).
//!
//! Two forms of the same checks: on a typed `MaterialModel`
//! (`validate_material_model`), and on the JSON of a model the engine's
//! types cannot hold (`validate_material_model_json`: TypeScript's shape
//! checks, a list that is not an array, a point with the wrong number of
//! values, a value that is not a number, `null`, read with JavaScript's
//! rules). `MaterialModel::from_json` keeps such JSON (`UnknownModel.raw`),
//! so the messages are TypeScript's for any JSON.

use crate::error::Result;
use crate::types::json::{js_array, js_get, js_is_finite, js_number, js_to_number, js_to_string};
use crate::types::material_models::{
    is_combined_depth_model, supports_anisotropy, supports_suction_strength, DepthReference,
    MaterialModel, UnknownModel,
};
use serde_json::Value;

/// Validate a `MaterialModel` and return any errors found (empty: valid).
/// TypeScript's TypeError on a model kept as JSON (`aboveWater: null`) is
/// returned as its message; `try_validate_material_model` returns it as an
/// error.
pub fn validate_material_model(model: &MaterialModel) -> Vec<String> {
    try_validate_material_model(model).unwrap_or_else(|e| vec![e.message])
}

/// `validateMaterialModel`, with TypeScript's TypeError (reading a field of
/// `null` in a model kept as JSON) as an error.
///
/// One message is the port's own: a model of a known kind that passes
/// these checks but has a value the engine's types cannot hold (a field
/// validation does not check, of another type: `interpolation: 5`), which
/// TypeScript would analyse as it reads it.
pub fn try_validate_material_model(model: &MaterialModel) -> Result<Vec<String>> {
    if let MaterialModel::Unknown(m @ UnknownModel { raw: Some(raw), .. }) = model {
        let mut errors = validate_material_model_json(raw)?;
        if errors.is_empty() && m.is_malformed() {
            errors.push(format!(
                "The {} model has a value of a type the engine does not read.",
                m.kind
            ));
        }
        return Ok(errors);
    }
    Ok(validate_typed(model))
}

/// The checks on a typed model.
fn validate_typed(model: &MaterialModel) -> Vec<String> {
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

// ── The same checks on JSON, with JavaScript's rules ──────────────

/// `validateMaterialModel` on the JSON of a model (non-finite numbers as
/// `JsJson` encodes them), line by line as validation.ts reads it: a field
/// that is absent is `undefined`; `Number.isFinite` takes numbers only;
/// comparisons convert with `ToNumber`; `===` compares without
/// conversion. Reading a field of `null` (`aboveWater: null`) is
/// TypeScript's TypeError.
pub fn validate_material_model_json(model: &Value) -> Result<Vec<String>> {
    let mut errors: Vec<String> = Vec::new();
    let m = Some(model);
    let get = |k: &str| js_get(m, k);
    let num = |v: Option<&Value>| js_to_number(v);
    let fin = |v: Option<&Value>| js_is_finite(v);

    // ── Common: unitWeight must be positive ──────────────────────
    let uw = get("unitWeight")?;
    if !fin(uw) || num(uw) <= 0.0 {
        errors.push("Unit weight (γ) must be a positive number.".into());
    } else if num(uw) > 500.0 {
        errors.push("Unit weight (γ) must be at most 500 kN/m³.".into());
    }
    let sat = get("unitWeightSat")?;
    if sat.is_some() && (!fin(sat) || num(sat) <= 0.0 || num(sat) > 500.0) {
        errors
            .push("Saturated unit weight (γsat) must be a positive number up to 500 kN/m³.".into());
    }
    let ru = get("ru")?;
    if ru.is_some() && !(fin(ru) && num(ru) >= 0.0 && num(ru) < 1.0) {
        errors.push("The pore pressure ratio rᵤ must be at least 0 and below 1.".into());
    }
    let b_bar = get("bBar")?;
    if b_bar.is_some() && !(fin(b_bar) && num(b_bar) >= 0.0 && num(b_bar) <= 1.5) {
        errors.push("B̄ must be between 0 and 1.5.".into());
    }
    if let Some(above) = get("aboveWater")? {
        if js_get(Some(above), "aboveWater")?.is_some() {
            errors.push("The strength above the water line cannot itself have one.".into());
        } else {
            for e in validate_material_model_json(above)? {
                errors.push(format!("Above the water line: {e}"));
            }
        }
    }

    // Optional numeric fields must be finite when given: NaN would silently
    // turn into zero strength further on.
    for (field, label) in [
        (
            "cohesionRefDepth",
            "The reference elevation of the cohesion",
        ),
        ("cohesionRateOfChange", "The rate of change of the cohesion"),
        ("cohesionUndrained", "The undrained shear strength (Su)"),
        ("cFactor", "The c-factor"),
        ("suRefDepth", "The reference elevation of Su"),
        ("suRateOfChange", "The rate of change of Su"),
    ] {
        let v = get(field)?;
        if v.is_some() && !fin(v) {
            errors.push(format!("{label} must be a finite number."));
        }
    }

    // `model.kind`, compared with `===`
    let kind_value = get("kind")?;
    let kind = match kind_value {
        Some(Value::String(s)) if js_number(kind_value).is_none() => Some(s.as_str()),
        _ => None,
    };
    let is_zero = |v: Option<&Value>| js_number(v) == Some(0.0);
    match kind {
        Some("mohr-coulomb") => {
            let c = get("cohesion")?;
            if !fin(c) || num(c) < 0.0 {
                errors.push("Cohesion (c) must be ≥ 0.".into());
            }
            if let Some(d) = get("drawdownStrength")? {
                let (dc, dphi) = (
                    js_get(Some(d), "cohesion")?,
                    js_get(Some(d), "frictionAngle")?,
                );
                if !(fin(dc) && num(dc) >= 0.0) {
                    errors.push("Drawdown cohesion (cR) must be ≥ 0.".into());
                }
                if !(fin(dphi) && num(dphi) >= 0.0 && num(dphi) < 90.0) {
                    errors.push("Drawdown friction angle (φR) must be 0–90°.".into());
                }
            }
            let phi = get("frictionAngle")?;
            if !fin(phi) || num(phi) < 0.0 {
                errors.push("Friction angle (φ) must be ≥ 0.".into());
            } else if num(phi) >= 90.0 {
                errors.push("Friction angle (φ) must be less than 90°.".into());
            }
            let c_factor = get("cFactor")?;
            if c_factor.is_some() && num(c_factor) < 0.0 {
                errors.push("The c-factor must be ≥ 0.".into());
            }
            // (model.cohesionRateOfChange ?? 0) > 0
            let rate = get("cohesionRateOfChange")?.filter(|v| !v.is_null());
            if is_zero(c) && is_zero(phi) && !(rate.map_or(0.0, |r| num(Some(r))) > 0.0) {
                errors.push(
                    "Both c and φ are zero — the material has no strength. Set at least one."
                        .into(),
                );
            }
            if c_factor.is_some() && num(c_factor) > 0.0 {
                // Combined method — needs its own Su (it fell back to c′ silently).
                let su = get("cohesionUndrained")?;
                if su.is_none() || !fin(su) || num(su) < 0.0 {
                    errors.push("Undrained cohesion (Su) must be ≥ 0 for combined method.".into());
                }
            }
        }

        Some("undrained") => {
            let su = get("undrainedShearStrength")?;
            if !fin(su) || num(su) < 0.0 {
                errors.push("Undrained shear strength (Su) must be ≥ 0.".into());
            }
            validate_cutoff_json(&mut errors, get("suMax")?);
        }

        Some("high-strength") | Some("impenetrable") => {
            // Only unitWeight is needed — no additional validation
        }

        Some("spatial-mohr-coulomb") => match js_array(get("dataPoints")?) {
            Some(points) if !points.is_empty() => {
                for (i, pt) in points.iter().enumerate() {
                    let Some(pt) = js_array(Some(pt)).filter(|p| p.len() == 5) else {
                        errors.push(format!(
                            "Data point {}: must have 5 values [x, y, c, φ, γ].",
                            i + 1
                        ));
                        continue;
                    };
                    if !pt.iter().all(|v| fin(Some(v))) {
                        errors.push(format!(
                            "Data point {}: all values must be finite numbers.",
                            i + 1
                        ));
                    }
                    if num(Some(&pt[2])) < 0.0 {
                        errors.push(format!("Data point {}: cohesion (c) must be ≥ 0.", i + 1));
                    }
                    if num(Some(&pt[3])) < 0.0 {
                        errors.push(format!(
                            "Data point {}: friction angle (φ) must be ≥ 0.",
                            i + 1
                        ));
                    }
                    if num(Some(&pt[4])) <= 0.0 {
                        errors.push(format!(
                            "Data point {}: unit weight (γ) must be > 0.",
                            i + 1
                        ));
                    }
                }
            }
            _ => errors.push("Spatial Mohr-Coulomb requires at least 1 data point.".into()),
        },

        Some("anisotropic-function") => {
            let c = get("cohesion")?;
            if !fin(c) || num(c) < 0.0 {
                errors.push("Base cohesion (c) must be ≥ 0.".into());
            }
            let phi = get("frictionAngle")?;
            if !fin(phi) || num(phi) < 0.0 {
                errors.push("Base friction angle (φ) must be ≥ 0.".into());
            } else if num(phi) >= 90.0 {
                errors.push("Base friction angle (φ) must be less than 90°.".into());
            }
            validate_modifier_json(
                &mut errors,
                get("modifierFunction")?,
                "Anisotropic modifier function",
            );
        }

        Some("s-f-depth") => {
            let su_ref = get("suRef")?;
            if !fin(su_ref) || num(su_ref) < 0.0 {
                errors.push("The reference Su must be ≥ 0.".into());
            }
            if !fin(get("depthRef")?) {
                errors.push("The reference depth must be a finite number.".into());
            }
            if !fin(get("rate")?) {
                errors.push("Rate of change must be a finite number.".into());
            }
            let depth_reference = get("depthReference")?;
            let is_str = |s: &str| matches!(depth_reference, Some(Value::String(v)) if v == s);
            if depth_reference.is_some() && !is_str("ground") && !is_str("layer-top") {
                errors.push("Depth reference must be \"ground\" or \"layer-top\".".into());
            }
            validate_cutoff_json(&mut errors, get("suMax")?);
            let (dc, dphi) = (get("drainedCohesion")?, get("drainedFrictionAngle")?);
            if dc.is_none() != dphi.is_none() {
                errors.push("A combined S = f(depth) needs both the drained c′ and φ′.".into());
            }
            if dc.is_some() && !(fin(dc) && num(dc) >= 0.0) {
                errors.push("Drained cohesion (c′) must be ≥ 0.".into());
            }
            let rate = get("drainedCohesionRate")?;
            if rate.is_some() && !fin(rate) {
                errors.push("Rate of change of c′ must be a finite number.".into());
            }
            if dphi.is_some() && !(fin(dphi) && num(dphi) >= 0.0 && num(dphi) < 90.0) {
                errors.push("Drained friction angle (φ′) must be ≥ 0 and less than 90°.".into());
            }
        }

        Some("hoek-brown") => {
            let ucs = get("ucs")?;
            if !fin(ucs) || num(ucs) <= 0.0 {
                errors.push("σci must be > 0.".into());
            }
            let (mb, s) = (get("mb")?, get("s")?);
            if mb.is_some() || s.is_some() {
                // the criterion's own parameters, given directly
                if !fin(mb) || !(num(mb) > 0.0) {
                    errors.push("mb must be > 0.".into());
                }
                if !fin(s) || !(num(s) >= 0.0 && num(s) <= 1.0) {
                    errors.push("s must be between 0 and 1.".into());
                }
                let a = get("a")?;
                if a.is_some() && !(fin(a) && num(a) > 0.0 && num(a) <= 1.0) {
                    errors.push("a must be between 0 and 1.".into());
                }
            } else {
                let gsi = get("gsi")?;
                if !fin(gsi) || num(gsi) < 0.0 || num(gsi) > 100.0 {
                    errors.push("GSI must be between 0 and 100.".into());
                }
                let mi = get("mi")?;
                if !fin(mi) || num(mi) <= 0.0 {
                    errors.push("mi must be > 0.".into());
                }
                let d = get("disturbance")?;
                if d.is_some() && !(fin(d) && num(d) >= 0.0 && num(d) <= 1.0) {
                    errors.push("Disturbance factor D must be between 0 and 1.".into());
                }
            }
        }

        Some("lime-cement-columns") => {
            let soil = get("soilSu")?;
            if !fin(soil) || num(soil) < 0.0 {
                errors.push("Soil Su between the columns must be ≥ 0.".into());
            }
            let column = get("columnSu")?;
            if !fin(column) || num(column) < 0.0 {
                errors.push("Column Su must be ≥ 0.".into());
            }
            let ratio = get("areaRatio")?;
            if !fin(ratio) || num(ratio) < 0.0 || num(ratio) > 1.0 {
                errors.push("Area ratio must be between 0 and 1.".into());
            }
            let ref_depth = get("suRefDepth")?;
            if ref_depth.is_some() && !fin(ref_depth) {
                errors.push("Reference level must be a finite number.".into());
            }
            let rate = get("suRateOfChange")?;
            if rate.is_some() && !fin(rate) {
                errors.push("Rate of change must be a finite number.".into());
            }
            let (cc, cphi) = (get("columnCohesion")?, get("columnFrictionAngle")?);
            if cc.is_none() != cphi.is_none() {
                errors.push(
                    "Give both the drained column cohesion and friction angle, or neither.".into(),
                );
            } else if cc.is_some() {
                if !fin(cc) || num(cc) < 0.0 {
                    errors.push("Drained column cohesion must be ≥ 0.".into());
                }
                if !(fin(cphi) && num(cphi) >= 0.0 && num(cphi) < 90.0) {
                    errors.push("Drained column friction angle must be 0–90°.".into());
                }
            }
            validate_cutoff_json(&mut errors, get("suMax")?);
        }

        Some("shear-normal") => {
            let pts = js_array(get("points")?)
                .filter(|pts| pts.len() >= 2 && pts.iter().all(|p| is_finite_pair(Some(p))));
            match pts {
                None => errors.push(
                    "The shear-normal function needs at least two finite [σn, τ] points.".into(),
                ),
                Some(pts) => {
                    let x = |i: usize| num(Some(&pts[i][0]));
                    if (1..pts.len()).any(|i| !(x(i) > x(i - 1))) {
                        errors.push(
                            "The shear-normal points must be sorted by increasing normal stress."
                                .into(),
                        );
                    }
                    if pts.iter().any(|p| num(Some(&p[1])) < 0.0) {
                        errors.push(
                            "The shear strengths of the shear-normal function must be ≥ 0.".into(),
                        );
                    }
                }
            }
        }

        Some("shansep") => {
            let ratio = get("ratio")?;
            if !(fin(ratio) && num(ratio) >= 0.0) {
                errors.push("SHANSEP ratio S must be ≥ 0.".into());
            }
            let exponent = get("exponent")?;
            if exponent.is_some() && !fin(exponent) {
                errors.push("SHANSEP exponent m must be a finite number.".into());
            }
            let ocr = get("ocr")?;
            if ocr.is_some() && !(fin(ocr) && num(ocr) > 0.0) {
                errors.push("OCR must be > 0.".into());
            }
            let pop = get("pop")?;
            if pop.is_some() && !(fin(pop) && num(pop) >= 0.0) {
                errors.push("POP must be ≥ 0.".into());
            }
            let yield_stress = get("yieldStress")?;
            if yield_stress.is_some() && !(fin(yield_stress) && num(yield_stress) >= 0.0) {
                errors.push("The yield stress must be ≥ 0.".into());
            }
            if pop.is_some() && yield_stress.is_some() {
                errors.push("Give either POP or the yield stress, not both.".into());
            }
            let su_min = get("suMin")?;
            if su_min.is_some() && !(fin(su_min) && num(su_min) >= 0.0) {
                errors.push("Minimum Su must be ≥ 0.".into());
            }
            let mut table = |pts: Option<&Value>, what: &str| {
                let Some(pts) = pts else { return };
                match js_array(Some(pts))
                    .filter(|p| !p.is_empty() && p.iter().all(|p| is_finite_pair(Some(p))))
                {
                    None => errors.push(format!("{what} must be a list of finite [x, y] points.")),
                    Some(pts) => {
                        let x = |i: usize| num(Some(&pts[i][0]));
                        if (1..pts.len()).any(|i| !(x(i) > x(i - 1))) {
                            errors.push(format!("{what} must be sorted by increasing x."));
                        }
                    }
                }
            };
            table(get("ocrByElevation")?, "OCR against elevation");
            table(get("suByStress")?, "Su against σ′v");
        }

        Some("s-f-datum") => {
            let su_ref = get("suRef")?;
            if !fin(su_ref) || num(su_ref) < 0.0 {
                errors.push("The reference Su must be ≥ 0.".into());
            }
            if !fin(get("yRef")?) {
                errors.push("The reference elevation must be a finite number.".into());
            }
            if !fin(get("rate")?) {
                errors.push("Rate of change must be a finite number.".into());
            }
            validate_cutoff_json(&mut errors, get("suMax")?);
        }

        _ => {
            errors.push(format!(
                "Unknown material model kind \"{}\".",
                js_to_string(kind_value)
            ));
        }
    }

    // anisotropy: not set or empty is isotropic
    // (`"anisotropy" in model && model.anisotropy !== undefined`: present)
    if kind.is_some_and(supports_anisotropy) {
        if let Some(anisotropy) = get("anisotropy")? {
            match js_array(Some(anisotropy)) {
                None => errors.push("Anisotropy must be a list of [α°, factor] points.".into()),
                Some(a) if !a.is_empty() => {
                    validate_modifier_json(&mut errors, Some(anisotropy), "Anisotropy");
                }
                Some(_) => {}
            }
        }
    }
    validate_suction_json(&mut errors, model, kind)?;
    Ok(errors)
}

/// `Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)`.
fn is_finite_pair(p: Option<&Value>) -> bool {
    js_array(p).is_some_and(|p| p.len() == 2 && p.iter().all(|v| js_is_finite(Some(v))))
}

/// `validateSuction` on JSON.
fn validate_suction_json(
    errors: &mut Vec<String>,
    model: &Value,
    kind: Option<&str>,
) -> Result<()> {
    let m = Some(model);
    let (phi_b, max_suction) = (js_get(m, "phiB")?, js_get(m, "maxSuction")?);
    if phi_b.is_none() && max_suction.is_none() {
        return Ok(());
    }
    let phi_b_num = js_number(phi_b);
    if phi_b.is_some() && !phi_b_num.is_some_and(|p| p.is_finite() && p >= 0.0 && p < 90.0) {
        errors.push("φb must be ≥ 0 and less than 90°.".into());
    }
    if max_suction.is_some() && !js_number(max_suction).is_some_and(|m| m.is_finite() && m > 0.0) {
        errors.push("The maximum suction must be a positive number.".into());
    }
    if phi_b_num.is_some_and(|p| p > 0.0) {
        if !kind.is_some_and(supports_suction_strength) {
            errors.push(
                "φb (strength from suction) is only taken by Mohr-Coulomb, the anisotropic function and a combined S = f(depth)."
                    .into(),
            );
        } else if kind == Some("s-f-depth")
            && !(js_get(m, "drainedCohesion")?.is_some()
                && js_get(m, "drainedFrictionAngle")?.is_some())
        {
            errors.push("φb (strength from suction) needs the drained branch of a combined S = f(depth) analysis.".into());
        }
    }
    Ok(())
}

/// `validateModifier` on JSON.
fn validate_modifier_json(errors: &mut Vec<String>, f: Option<&Value>, what: &str) {
    let Some(points) = js_array(f).filter(|f| f.len() >= 2) else {
        errors.push(format!("{what} requires at least 2 data points."));
        return;
    };
    for (i, pt) in points.iter().enumerate() {
        match js_array(Some(pt)).filter(|p| p.len() == 2) {
            None => errors.push(format!(
                "Modifier point {}: must have 2 values [α°, factor].",
                i + 1
            )),
            Some(p) if !p.iter().all(|v| js_is_finite(Some(v))) => errors.push(format!(
                "Modifier point {}: all values must be finite numbers.",
                i + 1
            )),
            Some(p) if js_to_number(Some(&p[1])) < 0.0 => {
                errors.push(format!("Modifier point {}: factor must be ≥ 0.", i + 1));
            }
            Some(_) => {}
        }
    }
}

/// `validateCutoff` on JSON.
fn validate_cutoff_json(errors: &mut Vec<String>, su_max: Option<&Value>) {
    if su_max.is_some() && (!js_is_finite(su_max) || js_to_number(su_max) <= 0.0) {
        errors.push("The strength cutoff must be a positive number.".into());
    }
}
