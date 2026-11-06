//! Exports of `cslope_engine::types` (TypeScript `src/types`): materials,
//! loads, strength, Hoek–Brown, validation, partial factors, defaults and
//! constants.

use crate::convert::{from_js, to_js};
use crate::errors::IntoJsResult;
use cslope_engine::types::{self as t, constants as c};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

type JsResult<T> = Result<T, JsValue>;

// ── Material, Udl, LineLoad (normalised by the engine) ──────────

/// `MaterialParams` as TypeScript gives it (the engine type has no serde).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaterialParamsDto {
    #[serde(default)]
    unit_weight: Option<f64>,
    #[serde(default)]
    friction_angle: Option<f64>,
    #[serde(default)]
    cohesion: Option<f64>,
    #[serde(default)]
    cohesion_ref_depth: Option<f64>,
    #[serde(default)]
    cohesion_rate_of_change: Option<f64>,
    #[serde(default)]
    cohesion_undrained: Option<f64>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    c_factor: Option<f64>,
    #[serde(default)]
    model: Option<t::MaterialModel>,
}

/// `new Material(params)`: `{ name, color, model }`, or the constructor's
/// RangeError.
#[wasm_bindgen]
pub fn material_new(params: JsValue) -> JsResult<JsValue> {
    let p: MaterialParamsDto = if params.is_undefined() || params.is_null() {
        MaterialParamsDto {
            unit_weight: None,
            friction_angle: None,
            cohesion: None,
            cohesion_ref_depth: None,
            cohesion_rate_of_change: None,
            cohesion_undrained: None,
            name: None,
            color: None,
            c_factor: None,
            model: None,
        }
    } else {
        from_js(params, "material")?
    };
    let m = t::Material::new(t::MaterialParams {
        unit_weight: p.unit_weight,
        friction_angle: p.friction_angle,
        cohesion: p.cohesion,
        cohesion_ref_depth: p.cohesion_ref_depth,
        cohesion_rate_of_change: p.cohesion_rate_of_change,
        cohesion_undrained: p.cohesion_undrained,
        name: p.name,
        color: p.color,
        c_factor: p.c_factor,
        model: p.model,
    })
    .js()?;
    to_js(&m)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UdlParamsDto {
    magnitude: f64,
    x1: f64,
    x2: f64,
    #[serde(default)]
    color: Option<String>,
    /// Any value; only "normal" counts (TypeScript's `=== "normal"`).
    #[serde(default)]
    direction: Option<String>,
    #[serde(default)]
    excess_pore_pressure: Option<Vec<t::UdlExcessPorePressure>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UdlDto {
    magnitude: f64,
    x1: f64,
    x2: f64,
    length: f64,
    color: String,
    direction: t::UdlDirection,
    excess_pore_pressure: Vec<t::UdlExcessPorePressure>,
}

/// `new Udl(params)`: the normalised fields.
#[wasm_bindgen]
pub fn udl_new(params: JsValue) -> JsResult<JsValue> {
    let p: UdlParamsDto = from_js(params, "UDL")?;
    let u = t::Udl::new(t::UdlParams {
        magnitude: p.magnitude,
        x1: p.x1,
        x2: p.x2,
        color: p.color,
        direction: (p.direction.as_deref() == Some("normal")).then_some(t::UdlDirection::Normal),
        excess_pore_pressure: p.excess_pore_pressure,
    });
    to_js(&UdlDto {
        magnitude: u.magnitude,
        x1: u.x1,
        x2: u.x2,
        length: u.length,
        color: u.color,
        direction: u.direction,
        excess_pore_pressure: u.excess_pore_pressure,
    })
}

#[derive(Deserialize)]
struct LineLoadParamsDto {
    magnitude: f64,
    x: f64,
    #[serde(default)]
    angle: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Serialize)]
struct LineLoadDto {
    magnitude: f64,
    x: f64,
    angle: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
    color: String,
}

/// `new LineLoad(params)`: the normalised fields (`y` left out when unset).
#[wasm_bindgen]
pub fn line_load_new(params: JsValue) -> JsResult<JsValue> {
    let p: LineLoadParamsDto = from_js(params, "line load")?;
    let l = t::LineLoad::new(t::LineLoadParams {
        magnitude: p.magnitude,
        x: p.x,
        angle: p.angle,
        y: p.y,
        color: p.color,
    });
    to_js(&LineLoadDto {
        magnitude: l.magnitude,
        x: l.x,
        angle: l.angle,
        y: l.y,
        color: l.color,
    })
}

// ── material models ──────────────────────────────────────────────

fn model(value: JsValue) -> JsResult<t::MaterialModel> {
    from_js(value, "material model")
}

#[wasm_bindgen]
pub fn validate_material_model(model_js: JsValue) -> JsResult<Vec<String>> {
    // (TypeScript's TypeError on `aboveWater: null` and the like: a TypeError)
    t::try_validate_material_model(&model(model_js)?).js()
}

#[wasm_bindgen]
pub fn is_combined_depth_model(model_js: JsValue) -> JsResult<bool> {
    Ok(t::is_combined_depth_model(&model(model_js)?))
}

#[wasm_bindgen]
pub fn supports_anisotropy(kind: &str) -> bool {
    t::supports_anisotropy(kind)
}

#[wasm_bindgen]
pub fn supports_suction_strength(kind: &str) -> bool {
    t::supports_suction_strength(kind)
}

#[wasm_bindgen]
pub fn suction_angle(model_js: JsValue) -> JsResult<f64> {
    Ok(t::suction_angle(&model(model_js)?))
}

/// `MATERIAL_MODEL_LABELS` as [kind, label] pairs.
#[wasm_bindgen]
pub fn material_model_labels() -> JsResult<JsValue> {
    to_js(&t::MATERIAL_MODEL_LABELS)
}

/// The definition's material model (`materialModelOf`).
#[wasm_bindgen]
pub fn material_model_of(material: JsValue) -> JsResult<JsValue> {
    let m: t::SlopeMaterialDefinition = from_js(material, "material")?;
    to_js(&t::material_model_of(&m).js()?)
}

/// The definition's material with its model and without the flat fields
/// (`withMaterialModel`).
#[wasm_bindgen]
pub fn with_material_model(material: JsValue) -> JsResult<JsValue> {
    let m: t::SlopeMaterialDefinition = from_js(material, "material")?;
    to_js(&t::with_material_model(&m).js()?)
}

// ── Hoek–Brown ───────────────────────────────────────────────────

#[wasm_bindgen]
pub fn hoek_brown_parameters(ucs: f64, gsi: f64, mi: f64, disturbance: f64) -> JsResult<JsValue> {
    to_js(&t::hoek_brown_parameters(ucs, gsi, mi, disturbance))
}

/// `hoekBrownOf(model)`: `model` needs only the Hoek–Brown fields.
#[wasm_bindgen]
pub fn hoek_brown_of(model_js: JsValue) -> JsResult<JsValue> {
    let m: t::HoekBrownModel = from_js(model_js, "Hoek-Brown model")?;
    to_js(&t::hoek_brown_of(&m))
}

#[wasm_bindgen]
pub fn instantaneous_at_sigma3(p: JsValue, s3: f64) -> JsResult<JsValue> {
    let p: t::HoekBrownParameters = from_js(p, "Hoek-Brown parameters")?;
    to_js(&t::instantaneous_at_sigma3(&p, s3))
}

#[wasm_bindgen]
pub fn instantaneous_at_normal_stress(p: JsValue, sn: f64) -> JsResult<JsValue> {
    let p: t::HoekBrownParameters = from_js(p, "Hoek-Brown parameters")?;
    to_js(&t::instantaneous_at_normal_stress(&p, sn))
}

// ── strength ─────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn resolve_strength(model_js: JsValue, context: JsValue) -> JsResult<JsValue> {
    let m = model(model_js)?;
    let ctx: t::StrengthContext = from_js(context, "strength context")?;
    to_js(&t::resolve_strength(&m, &ctx).js()?)
}

#[wasm_bindgen]
pub fn suction_strength(model_js: JsValue, suction: f64) -> JsResult<f64> {
    Ok(t::suction_strength(&model(model_js)?, suction))
}

#[wasm_bindgen]
pub fn resolve_unit_weight(model_js: JsValue, fallback: f64, x: f64, y: f64) -> JsResult<f64> {
    Ok(t::resolve_unit_weight(&model(model_js)?, fallback, x, y))
}

#[wasm_bindgen]
pub fn needs_layer_top(model_js: JsValue) -> JsResult<bool> {
    Ok(t::needs_layer_top(&model(model_js)?))
}

/// `points`: [x, y][].
#[wasm_bindgen]
pub fn interpolate_function(points: JsValue, x: f64) -> JsResult<f64> {
    let points: Vec<[f64; 2]> = from_js(points, "points")?;
    Ok(t::interpolate_function(&points, x))
}

// ── partial factors, defaults, constants ─────────────────────────

/// `SwedishFactorBasis` with the safety class as any value: TypeScript
/// rejects a class that is not the number 1, 2 or 3 with its own message,
/// which the engine gives for class 0.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FactorBasisDto {
    safety_class: AnyNumber,
    eta_cu: f64,
    eta_drained: f64,
    variable_load_base: f64,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum AnyNumber {
    Number(f64),
    Other(serde::de::IgnoredAny),
}

#[wasm_bindgen]
pub fn swedish_partial_factors(basis: JsValue) -> JsResult<JsValue> {
    let b: FactorBasisDto = from_js(basis, "factor basis")?;
    let safety_class = match b.safety_class {
        AnyNumber::Number(n) if n == 1.0 || n == 2.0 || n == 3.0 => n as u8,
        _ => 0,
    };
    to_js(
        &t::swedish_partial_factors(&t::SwedishFactorBasis {
            safety_class,
            eta_cu: b.eta_cu,
            eta_drained: b.eta_drained,
            variable_load_base: b.variable_load_base,
        })
        .js()?,
    )
}

#[wasm_bindgen]
pub fn default_analysis_options() -> JsResult<JsValue> {
    to_js(&t::default_analysis_options())
}

#[wasm_bindgen]
pub fn default_fem_settings() -> JsResult<JsValue> {
    to_js(&t::default_fem_settings())
}

/// The engine's constants, under their TypeScript names. The facade keeps
/// them as TypeScript values (they are read at module load, before the
/// engine is initialised); its consistency test compares them with these.
#[derive(Serialize)]
#[allow(non_snake_case)]
struct Constants {
    DEFAULT_SLICES: f64,
    DEFAULT_ITERATIONS: f64,
    FOS_TOLERANCE: f64,
    MAX_FOS_ITERATIONS: f64,
    DEFAULT_METHOD: t::AnalysisMethod,
    FOS_LIMIT: f64,
    MP_OUTER_ITERATIONS: f64,
    MP_LAMBDA_STEP_LIMIT: f64,
    MP_MAX_EXTRAPOLATION_ITERS: f64,
    MALPHA_ZERO_GUARD: f64,
    MATERIAL_EPSILON: f64,
    POLYGON_INTERSECTION_TOLERANCE: f64,
    SLICE_DEDUP_TOLERANCE: f64,
    WATER_UNIT_WEIGHT: f64,
    SLICES_RANGE: RangeDto,
    ITERATIONS_RANGE: RangeDto,
    REFINED_ITERATIONS_RANGE: RangeDto,
    UNIT_WEIGHT_RANGE: RangeDto,
    FRICTION_ANGLE_RANGE: RangeDto,
    EC7_DA3_FACTORS: t::PartialFactors,
    SAFETY_CLASS_GAMMA_D: Vec<(u8, f64)>,
    MATERIAL_COLORS: Vec<&'static str>,
}

#[derive(Serialize)]
struct RangeDto {
    min: f64,
    max: f64,
}

fn range(r: c::Range) -> RangeDto {
    RangeDto {
        min: r.min,
        max: r.max,
    }
}

#[wasm_bindgen]
pub fn engine_constants() -> JsResult<JsValue> {
    to_js(&Constants {
        DEFAULT_SLICES: c::DEFAULT_SLICES,
        DEFAULT_ITERATIONS: c::DEFAULT_ITERATIONS,
        FOS_TOLERANCE: c::FOS_TOLERANCE,
        MAX_FOS_ITERATIONS: c::MAX_FOS_ITERATIONS,
        DEFAULT_METHOD: c::DEFAULT_METHOD,
        FOS_LIMIT: c::FOS_LIMIT,
        MP_OUTER_ITERATIONS: c::MP_OUTER_ITERATIONS,
        MP_LAMBDA_STEP_LIMIT: c::MP_LAMBDA_STEP_LIMIT,
        MP_MAX_EXTRAPOLATION_ITERS: c::MP_MAX_EXTRAPOLATION_ITERS,
        MALPHA_ZERO_GUARD: c::MALPHA_ZERO_GUARD,
        MATERIAL_EPSILON: c::MATERIAL_EPSILON,
        POLYGON_INTERSECTION_TOLERANCE: c::POLYGON_INTERSECTION_TOLERANCE,
        SLICE_DEDUP_TOLERANCE: c::SLICE_DEDUP_TOLERANCE,
        WATER_UNIT_WEIGHT: c::WATER_UNIT_WEIGHT,
        SLICES_RANGE: range(c::SLICES_RANGE),
        ITERATIONS_RANGE: range(c::ITERATIONS_RANGE),
        REFINED_ITERATIONS_RANGE: range(c::REFINED_ITERATIONS_RANGE),
        UNIT_WEIGHT_RANGE: range(c::UNIT_WEIGHT_RANGE),
        FRICTION_ANGLE_RANGE: range(c::FRICTION_ANGLE_RANGE),
        EC7_DA3_FACTORS: t::EC7_DA3_FACTORS,
        SAFETY_CLASS_GAMMA_D: t::SAFETY_CLASS_GAMMA_D.to_vec(),
        MATERIAL_COLORS: cslope_engine::math::MATERIAL_COLORS.to_vec(),
    })
}

// ── Schema, validation, result summary (issue #55) ──────────────

/// The version of the schemas (the engine's version).
#[wasm_bindgen]
pub fn schema_version() -> String {
    t::schema::SCHEMA_VERSION.to_string()
}

/// Step 2 of the validation in the engine: the JavaScript values read as
/// the engine reads them for an analysis (see `EngineReader`).
struct JsReader {
    definition: JsValue,
    options: JsValue,
}

impl JsReader {
    fn read<T: serde::de::DeserializeOwned>(
        v: &JsValue,
        what: &str,
        prefix: &str,
        issues: &mut Vec<t::validate_definition::Issue>,
    ) -> Option<T> {
        match from_js::<T>(v.clone(), what) {
            Ok(t) => Some(t),
            Err(e) => {
                issues.push(t::validate_definition::Issue {
                    path: prefix.to_string(),
                    code: "invalid-value".into(),
                    message: format!(
                        "The engine cannot read this value: {}",
                        e.as_string().unwrap_or_default()
                    ),
                    severity: t::validate_definition::Severity::Error,
                });
                None
            }
        }
    }
}

impl t::validate_definition::EngineReader for JsReader {
    fn definition(
        &self,
        _: &serde_json::Value,
        prefix: &str,
        issues: &mut Vec<t::validate_definition::Issue>,
    ) -> Option<t::SlopeDefinition> {
        Self::read(&self.definition, "slope definition", prefix, issues)
    }
    fn options(
        &self,
        _: &serde_json::Value,
        prefix: &str,
        issues: &mut Vec<t::validate_definition::Issue>,
    ) -> Option<cslope_engine::model::slope::AnalysisOptionsPatch> {
        Self::read(&self.options, "analysis options", prefix, issues)
    }
}

/// `validate`: the issues of an analysis document or of a definition and
/// its options (`options` undefined or null: none given).
#[wasm_bindgen]
pub fn validate_definition(doc_or_definition: JsValue, options: JsValue) -> JsResult<JsValue> {
    let v: serde_json::Value = from_js(doc_or_definition.clone(), "definition")?;
    let given = !(options.is_undefined() || options.is_null());
    let o: Option<serde_json::Value> = if given {
        Some(from_js(options.clone(), "analysis options")?)
    } else {
        None
    };
    let get = |key: &str| {
        js_sys::Reflect::get(&doc_or_definition, &JsValue::from_str(key))
            .unwrap_or(JsValue::UNDEFINED)
    };
    let reader = if t::validate_definition::is_document(&v) {
        JsReader {
            definition: get("definition"),
            options: if given { options } else { get("options") },
        }
    } else {
        JsReader {
            definition: doc_or_definition,
            options,
        }
    };
    to_js(&t::validate_definition::validate_with(
        &v,
        o.as_ref(),
        &reader,
    ))
}

/// `summarizeResult`: what F is, the method, the critical surface and the
/// warnings of a result run with `options` (merged with the defaults it ran
/// with).
#[wasm_bindgen]
pub fn summarize_result(
    result: JsValue,
    options: JsValue,
    engine_build: &str,
) -> JsResult<JsValue> {
    let r: t::AnalysisResult = from_js(result, "analysis result")?;
    let o: cslope_engine::model::slope::AnalysisOptionsPatch =
        if options.is_undefined() || options.is_null() {
            Default::default()
        } else {
            from_js(options, "analysis options")?
        };
    to_js(&cslope_engine::api::summary::summarize_result(
        &r,
        &o,
        engine_build,
    ))
}

/// The public defaults of Python and the command line (D-23).
#[wasm_bindgen]
pub fn public_default_options() -> JsResult<JsValue> {
    to_js(&t::public_default_options())
}
