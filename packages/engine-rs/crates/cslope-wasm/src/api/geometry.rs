//! Exports of `cslope_engine::model::geometry_ops` (TypeScript
//! `src/model/geometry-ops.ts`) and `model::waternet`.

use crate::convert::{from_js, to_js};
use crate::errors::{js_error, IntoJsResult};
use crate::registry::Registry;
use cslope_engine::model::geometry_ops as g;
use cslope_engine::model::waternet::{waternet_pore_pressure, Waternet};
use cslope_engine::types::MaterialId;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

type JsResult<T> = Result<T, JsValue>;

fn lines(value: JsValue) -> JsResult<Vec<Vec<g::Pt>>> {
    from_js(value, "lines")
}

#[wasm_bindgen]
pub fn line_segment_intersection(
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    x3: f64,
    y3: f64,
    x4: f64,
    y4: f64,
) -> Option<Vec<f64>> {
    g::line_segment_intersection(x1, y1, x2, y2, x3, y3, x4, y4).map(|p| p.to_vec())
}

#[wasm_bindgen]
pub fn get_surface_line(px: &[f64], py: &[f64]) -> JsResult<JsValue> {
    to_js(&g::get_surface_line(px, py).js()?)
}

#[wasm_bindgen]
pub fn split_polygon_by_polyline(
    px: &[f64],
    py: &[f64],
    lx: &[f64],
    ly: &[f64],
) -> JsResult<JsValue> {
    to_js(&g::split_polygon_by_polyline(px, py, lx, ly).js()?)
}

#[wasm_bindgen]
pub fn polygonize_regions(px: &[f64], py: &[f64], lines_js: JsValue) -> JsResult<JsValue> {
    to_js(&g::polygonize_regions(px, py, &lines(lines_js)?).js()?)
}

/// The bounds `createGeometryWithMaterial` caches: [xMin, xMax, yMax], or
/// empty without points.
#[wasm_bindgen]
pub fn geometry_bounds(px: &[f64], py: &[f64]) -> Vec<f64> {
    let gm = g::create_geometry_with_material(px, py, MaterialId(0), true);
    match (gm.x_min, gm.x_max, gm.y_max) {
        (Some(a), Some(b), Some(c)) => vec![a, b, c],
        _ => Vec::new(),
    }
}

/// "left" or "right".
#[derive(Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum SideDto {
    Left,
    Right,
}

impl From<SideDto> for g::Side {
    fn from(s: SideDto) -> Self {
        match s {
            SideDto::Left => g::Side::Left,
            SideDto::Right => g::Side::Right,
        }
    }
}

// ── waternet (a handle: TypeScript caches the compiled lines per object) ──

thread_local! {
    static WATERNETS: RefCell<Registry<Waternet>> = const { RefCell::new(Registry::new()) };
}

fn handle_error(e: crate::registry::HandleError) -> JsValue {
    js_error(&e.to_string())
}

/// Stores a waternet; the facade keeps the handle per waternet object (as
/// TypeScript's WeakMap cache) and frees it with a FinalizationRegistry.
#[wasm_bindgen]
pub fn waternet_new(waternet: JsValue) -> JsResult<u32> {
    let wn: Waternet = from_js(waternet, "waternet")?;
    WATERNETS.with(|r| r.borrow_mut().insert(wn).map_err(handle_error))
}

#[wasm_bindgen]
pub fn waternet_free(handle: u32) -> bool {
    WATERNETS.with(|r| r.borrow_mut().remove(handle))
}

/// Live waternet handles (for the facade's leak test).
#[wasm_bindgen]
pub fn waternet_count() -> usize {
    WATERNETS.with(|r| r.borrow().len())
}

#[wasm_bindgen]
pub fn waternet_pore_pressure_at(handle: u32, x: f64, z: f64) -> JsResult<f64> {
    WATERNETS.with(|r| {
        let r = r.borrow();
        let wn = r.get(handle).map_err(handle_error)?;
        Ok(waternet_pore_pressure(wn, x, z))
    })
}
