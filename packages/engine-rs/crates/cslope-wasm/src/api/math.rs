//! Exports of `cslope_engine::math` (TypeScript `src/math`).

use crate::convert::{from_js, to_js};
use crate::errors::IntoJsResult;
use cslope_engine::math;
use cslope_engine::types::IntersliceFunctionType;
use wasm_bindgen::prelude::*;

type JsResult<T> = Result<T, JsValue>;

// ── polygon ──────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn calculate_polygon_area(x: &[f64], y: &[f64]) -> f64 {
    math::calculate_polygon_area(x, y)
}

#[wasm_bindgen]
pub fn is_point_in_polygon(px: f64, py: f64, poly_x: &[f64], poly_y: &[f64]) -> bool {
    math::is_point_in_polygon(px, py, poly_x, poly_y)
}

#[wasm_bindgen]
pub fn clip_polygon_halfplane(px: &[f64], py: &[f64], a: f64, b: f64, c: f64) -> JsResult<JsValue> {
    to_js(&math::clip_polygon_halfplane(px, py, a, b, c))
}

#[wasm_bindgen]
pub fn clip_polygon_vertical(
    poly_x: &[f64],
    poly_y: &[f64],
    x_min: f64,
    x_max: f64,
) -> JsResult<JsValue> {
    to_js(&math::clip_polygon_vertical(poly_x, poly_y, x_min, x_max))
}

// ── circle ───────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn get_circle_y_coordinate_at_x(cx: f64, cy: f64, radius: f64, x: f64) -> f64 {
    math::get_circle_y_coordinate_at_x(cx, cy, radius, x)
}

#[wasm_bindgen]
pub fn get_circle_line_intersections(
    cx: f64,
    cy: f64,
    r: f64,
    px: &[f64],
    py: &[f64],
) -> JsResult<JsValue> {
    to_js(&math::get_circle_line_intersections(cx, cy, r, px, py))
}

#[wasm_bindgen]
pub fn circle_radius_from_abcd(c_to_e: f64, c: f64) -> Option<f64> {
    math::circle_radius_from_abcd(c_to_e, c)
}

#[wasm_bindgen]
pub fn circle_centre(beta: f64, ix: f64, iy: f64, chord_to_centre: f64) -> Vec<f64> {
    math::circle_centre(beta, [ix, iy], chord_to_centre).to_vec()
}

/// `num_points`: TypeScript's count (a number); below 2 gives one point.
#[wasm_bindgen]
pub fn generate_circle_coordinates(
    cx: f64,
    cy: f64,
    radius: f64,
    num_points: f64,
) -> JsResult<JsValue> {
    let n = if num_points >= 2.0 {
        num_points.ceil() as usize
    } else {
        0
    };
    to_js(&math::generate_circle_coordinates(cx, cy, radius, n))
}

// ── interpolation ────────────────────────────────────────────────

#[wasm_bindgen]
pub fn get_y_at_x(poly_x: &[f64], poly_y: &[f64], x: f64) -> f64 {
    math::get_y_at_x(poly_x, poly_y, x)
}

#[wasm_bindgen]
pub fn get_y_at_x_many(poly_x: &[f64], poly_y: &[f64], x_values: &[f64]) -> Vec<f64> {
    math::get_y_at_x_many(poly_x, poly_y, x_values)
}

#[wasm_bindgen]
pub fn get_y_at_x_strict(line_x: &[f64], line_y: &[f64], x: f64) -> JsResult<f64> {
    math::get_y_at_x_strict((line_x, line_y), x).js()
}

#[wasm_bindgen]
pub fn get_line_between_points(
    line_x: &[f64],
    line_y: &[f64],
    x1: f64,
    x2: f64,
) -> JsResult<JsValue> {
    to_js(&math::get_line_between_points((line_x, line_y), x1, x2).js()?)
}

// ── loads ────────────────────────────────────────────────────────

/// `udls`: [x1, x2, magnitude][]; `line_loads`: [x, magnitude][].
#[wasm_bindgen]
pub fn calculate_all_loads(
    widths: &[f64],
    center_xs: &[f64],
    udls: JsValue,
    line_loads: JsValue,
) -> JsResult<JsValue> {
    let udls: Vec<[f64; 3]> = from_js(udls, "udls")?;
    let line_loads: Vec<[f64; 2]> = from_js(line_loads, "line loads")?;
    to_js(&math::calculate_all_loads(
        widths,
        center_xs,
        &udls,
        &line_loads,
    ))
}

// ── helpers ──────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn constant_interslice(x: f64, x_start: f64, x_end: f64) -> f64 {
    math::constant_interslice(x, x_start, x_end)
}

#[wasm_bindgen]
pub fn halfsine(x: f64, x_start: f64, x_end: f64) -> f64 {
    math::halfsine(x, x_start, x_end)
}

#[wasm_bindgen]
pub fn clipped_sine(x: f64, x_start: f64, x_end: f64) -> f64 {
    math::clipped_sine(x, x_start, x_end)
}

#[wasm_bindgen]
pub fn trapezoidal(x: f64, x_start: f64, x_end: f64) -> f64 {
    math::trapezoidal(x, x_start, x_end)
}

/// `points`: [x, f][].
#[wasm_bindgen]
pub fn data_point_specified(x: f64, x_start: f64, x_end: f64, points: JsValue) -> JsResult<f64> {
    let points: Vec<[f64; 2]> = from_js(points, "points")?;
    Ok(math::data_point_specified(x, x_start, x_end, &points))
}

/// `kind`: an interslice function name or undefined; an unknown name is
/// the half-sine, as TypeScript's `default:` branch.
#[wasm_bindgen]
pub fn get_interslice_function_value(
    kind: JsValue,
    x: f64,
    x_start: f64,
    x_end: f64,
    points: JsValue,
) -> JsResult<f64> {
    let kind: Option<IntersliceFunctionType> = from_js(kind, "interslice function").ok().flatten();
    let points: Vec<[f64; 2]> = if points.is_undefined() {
        Vec::new()
    } else {
        from_js(points, "points")?
    };
    Ok(math::get_interslice_function_value(
        kind, x, x_start, x_end, &points,
    ))
}

#[wasm_bindgen]
pub fn mid_coord(x1: f64, y1: f64, x2: f64, y2: f64) -> Vec<f64> {
    math::mid_coord([x1, y1], [x2, y2]).to_vec()
}

#[wasm_bindgen]
pub fn dist_points(x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    math::dist_points([x1, y1], [x2, y2])
}

/// `lff_array`: [lambda, FS, FS_force][].
#[wasm_bindgen]
pub fn extrapolate_lambda(lff_array: JsValue) -> JsResult<Vec<f64>> {
    let lff: Vec<[f64; 3]> = from_js(lff_array, "lffArray")?;
    Ok(math::extrapolate_lambda(&lff).js()?.to_vec())
}

#[wasm_bindgen]
pub fn get_precision(n: f64) -> usize {
    math::get_precision(n)
}
