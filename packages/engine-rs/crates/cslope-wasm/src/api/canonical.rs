//! Exports of `cslope_engine::model::canonical` (TypeScript
//! `src/model/canonical.ts`): orientation and mirroring.

use crate::convert::{from_js, to_js};
use crate::errors::IntoJsResult;
use cslope_engine::model::canonical as c;
use cslope_engine::types::{AnalysisLimits, AnalysisResult, SlopeDefinition};
use wasm_bindgen::prelude::*;

type JsResult<T> = Result<T, JsValue>;

fn points(value: JsValue) -> JsResult<Vec<[f64; 2]>> {
    from_js(value, "points")
}

fn definition(value: JsValue) -> JsResult<SlopeDefinition> {
    from_js(value, "slope definition")
}

#[wasm_bindgen]
pub fn mirror_x(x: f64, x_min: f64, x_max: f64) -> f64 {
    c::mirror_x(x, x_min, x_max)
}

#[wasm_bindgen]
pub fn mirror_point(x: f64, y: f64, x_min: f64, x_max: f64) -> Vec<f64> {
    c::mirror_point([x, y], x_min, x_max).to_vec()
}

#[wasm_bindgen]
pub fn mirror_points(pts: JsValue, x_min: f64, x_max: f64) -> JsResult<JsValue> {
    to_js(&c::mirror_points(&points(pts)?, x_min, x_max))
}

#[wasm_bindgen]
pub fn get_domain_x(coordinates: JsValue) -> JsResult<Vec<f64>> {
    Ok(c::get_domain_x(&points(coordinates)?).to_vec())
}

#[wasm_bindgen]
pub fn infer_orientation_from_coordinates(coordinates: JsValue) -> JsResult<JsValue> {
    to_js(&c::infer_orientation_from_coordinates(&points(
        coordinates,
    )?))
}

/// `orientation`: "ltr", "rtl" or undefined (inferred).
#[wasm_bindgen]
pub fn resolve_orientation(orientation: JsValue, coordinates: JsValue) -> JsResult<JsValue> {
    let o: Option<c::SlopeOrientation> = from_js(orientation, "orientation")?;
    to_js(&c::resolve_orientation(o, &points(coordinates)?))
}

#[wasm_bindgen]
pub fn mirror_limits(limits: JsValue, x_min: f64, x_max: f64) -> JsResult<JsValue> {
    let l: AnalysisLimits = from_js(limits, "analysis limits")?;
    to_js(&c::mirror_limits(&l, x_min, x_max))
}

/// `mirror_range`: [xMin, xMax] or undefined (the definition's own).
#[wasm_bindgen]
pub fn to_canonical_slope_definition(def: JsValue, mirror_range: JsValue) -> JsResult<JsValue> {
    let range: Option<[f64; 2]> = from_js(mirror_range, "mirror range")?;
    to_js(&c::to_canonical_slope_definition(&definition(def)?, range).js()?)
}

#[wasm_bindgen]
pub fn opposite_direction_definition(def: JsValue) -> JsResult<JsValue> {
    to_js(&c::opposite_direction_definition(&definition(def)?).js()?)
}

#[wasm_bindgen]
pub fn map_analysis_result_to_model_space(result: JsValue, def: JsValue) -> JsResult<JsValue> {
    let r: AnalysisResult = from_js(result, "analysis result")?;
    to_js(&c::map_analysis_result_to_model_space(
        &r,
        &definition(def)?,
    ))
}
