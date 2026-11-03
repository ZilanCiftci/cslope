//! The testing build's dispatcher (feature `testing`, ARCHITECTURE.md §3.3):
//! `__test_call(name, args)` runs an internal engine function that the
//! TypeScript unit tests import but the product API does not export.
//!
//! `name` is `"<TypeScript module path>::<TypeScript name>"`, for example
//! `"math/interpolation::interpolateIDW"`; `args` is the argument list as
//! a JavaScript array, every parameter present (the facade passes
//! `undefined` for an omitted optional one). Handles of engine objects will
//! appear in `args` as `{ $slope: h }`. Arguments and results use the same
//! serde conventions as the product API ([`crate::convert`]).

use crate::api::geometry::{material_layer_top_at, GeometryDto, SideDto};
use crate::convert::{from_js, to_js};
use crate::errors::{js_error, IntoJsResult};
use cslope_engine::math::{self, SpatialDataPoint};
use cslope_engine::model::geometry_ops as g;
use cslope_engine::types::{self as t, PartialFactors, ResolvedStrength};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

type JsResult<T> = Result<T, JsValue>;

/// Every name `__test_call` dispatches (the facade's test checks that each
/// shim wrapper names one of these).
pub const TEST_FUNCTIONS: &[&str] = &[
    "math/interpolation::interpolateIDW",
    "math/interpolation::interpolateNearest",
    "math/spline::cubicSpline",
    "math/spline::evalSpline",
    "types/strength::designStrength",
    "types/strength::shansepSu",
    "types/strength::shearNormalAt",
    "model/geometry-ops::polylineYAtX",
    "model/geometry-ops::polylineYAtSide",
    "model/geometry-ops::polylineYFrom",
    "model/geometry-ops::clipLineToSurface",
    "model/geometry-ops::splitPolygonByPolylineDetailed",
    "model/geometry-ops::materialLayerTopAt",
    "model/geometry-ops::keyholeRing",
    "model/geometry-ops::polygonizeRegionsDetailed",
];

#[derive(Deserialize)]
struct SpatialDto {
    x: f64,
    y: f64,
    values: Vec<f64>,
}

fn spatial(points: Vec<SpatialDto>) -> Vec<SpatialDataPoint> {
    points
        .into_iter()
        .map(|p| SpatialDataPoint {
            x: p.x,
            y: p.y,
            values: p.values,
        })
        .collect()
}

#[derive(Deserialize, Serialize)]
struct SplineDto {
    x: Vec<f64>,
    y: Vec<f64>,
    m: Vec<f64>,
}

#[derive(Serialize)]
struct SplineValueDto {
    value: f64,
    slope: f64,
}

/// The fields of `ResolvedStrength` `designStrength` reads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StrengthDto {
    cohesion: f64,
    friction_angle: f64,
    cohesion_undrained: f64,
    #[serde(default)]
    is_combined: Option<bool>,
    #[serde(default)]
    cohesion_undrained_part: Option<f64>,
    #[serde(default)]
    suction_strength: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShansepContextDto {
    y_bottom: f64,
    y_ground: f64,
    #[serde(default)]
    effective_vertical_stress: Option<f64>,
}

#[derive(Deserialize)]
struct ShearNormalDto {
    points: Vec<[f64; 2]>,
    #[serde(default)]
    spline: Option<t::TableSpline>,
}

fn args<T: DeserializeOwned>(value: JsValue, name: &str) -> JsResult<T> {
    from_js(value, &format!("{name} arguments"))
}

/// Runs the internal function `name` on `args` (see the module docs).
#[wasm_bindgen]
pub fn __test_call(name: &str, a: JsValue) -> JsResult<JsValue> {
    match name {
        "math/interpolation::interpolateIDW" => {
            let (p, qx, qy, power, eps): (Vec<SpatialDto>, f64, f64, Option<f64>, Option<f64>) =
                args(a, name)?;
            to_js(&math::interpolate_idw(
                &spatial(p),
                qx,
                qy,
                power.unwrap_or(2.0),
                eps.unwrap_or(1e-10),
            ))
        }
        "math/interpolation::interpolateNearest" => {
            let (p, qx, qy): (Vec<SpatialDto>, f64, f64) = args(a, name)?;
            to_js(&math::interpolate_nearest(&spatial(p), qx, qy))
        }
        "math/spline::cubicSpline" => {
            let (p, slopes): (Vec<[f64; 2]>, Option<[Option<f64>; 2]>) = args(a, name)?;
            let s = math::cubic_spline(&p, slopes.unwrap_or([None, None]));
            to_js(&SplineDto {
                x: s.x,
                y: s.y,
                m: s.m,
            })
        }
        "math/spline::evalSpline" => {
            let (s, x): (SplineDto, f64) = args(a, name)?;
            let v = math::eval_spline(
                &math::CubicSpline {
                    x: s.x,
                    y: s.y,
                    m: s.m,
                },
                x,
            );
            to_js(&SplineValueDto {
                value: v.value,
                slope: v.slope,
            })
        }
        "types/strength::designStrength" => {
            let (kind, st, f): (Option<String>, StrengthDto, Option<PartialFactors>) =
                args(a, name)?;
            let st = ResolvedStrength {
                cohesion: st.cohesion,
                friction_angle: st.friction_angle,
                cohesion_undrained: st.cohesion_undrained,
                is_combined: st.is_combined,
                cohesion_undrained_part: st.cohesion_undrained_part,
                suction_strength: st.suction_strength,
                ..Default::default()
            };
            to_js(&t::design_strength(kind.as_deref(), &st, f.as_ref()))
        }
        "types/strength::shansepSu" => {
            let (m, ctx): (t::ShansepModel, ShansepContextDto) = args(a, name)?;
            Ok(JsValue::from_f64(t::shansep_su(
                &m,
                ctx.y_bottom,
                ctx.y_ground,
                ctx.effective_vertical_stress,
            )))
        }
        "types/strength::shearNormalAt" => {
            let (m, sn): (ShearNormalDto, f64) = args(a, name)?;
            to_js(&t::shear_normal_at(&m.points, m.spline.as_ref(), sn))
        }
        "model/geometry-ops::polylineYAtX" => {
            let (lx, ly, x): (Vec<f64>, Vec<f64>, f64) = args(a, name)?;
            Ok(match g::polyline_y_at_x(&lx, &ly, x) {
                Some(y) => JsValue::from_f64(y),
                None => JsValue::UNDEFINED,
            })
        }
        "model/geometry-ops::polylineYAtSide" => {
            let (px, py, x, side): (Vec<f64>, Vec<f64>, f64, SideDto) = args(a, name)?;
            Ok(JsValue::from_f64(g::polyline_y_at_side(
                &px,
                &py,
                x,
                side.into(),
            )))
        }
        "model/geometry-ops::polylineYFrom" => {
            let (px, py, x, side): (Vec<f64>, Vec<f64>, f64, SideDto) = args(a, name)?;
            Ok(JsValue::from_f64(g::polyline_y_from(
                &px,
                &py,
                x,
                side.into(),
            )))
        }
        "model/geometry-ops::clipLineToSurface" => {
            let (wx, wy, sx, sy): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) = args(a, name)?;
            to_js(&g::clip_line_to_surface(&wx, &wy, &sx, &sy))
        }
        "model/geometry-ops::splitPolygonByPolylineDetailed" => {
            let (px, py, lx, ly): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) = args(a, name)?;
            to_js(&g::split_polygon_by_polyline_detailed(&px, &py, &lx, &ly).js()?)
        }
        "model/geometry-ops::materialLayerTopAt" => {
            let (geos, material, x, y): (Vec<GeometryDto>, u32, f64, f64) = args(a, name)?;
            to_js(&material_layer_top_at(geos, material, x, y))
        }
        "model/geometry-ops::keyholeRing" => {
            let (outer, holes): (Vec<g::Pt>, Vec<Vec<g::Pt>>) = args(a, name)?;
            to_js(&g::keyhole_ring(&outer, &holes))
        }
        "model/geometry-ops::polygonizeRegionsDetailed" => {
            let (px, py, lines): (Vec<f64>, Vec<f64>, Vec<Vec<g::Pt>>) = args(a, name)?;
            to_js(&g::polygonize_regions_detailed(&px, &py, &lines).js()?)
        }
        _ => Err(js_error(&format!(
            "__test_call: no internal function \"{name}\" in the testing build"
        ))),
    }
}

/// The names `__test_call` dispatches.
#[wasm_bindgen]
pub fn __test_functions() -> Vec<String> {
    TEST_FUNCTIONS.iter().map(|s| s.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::TEST_FUNCTIONS;

    #[test]
    fn names_are_unique_and_qualified() {
        let mut seen = std::collections::HashSet::new();
        for n in TEST_FUNCTIONS {
            assert!(seen.insert(*n), "duplicate {n}");
            let (module, name) = n.split_once("::").expect("module::name");
            assert!(!module.is_empty() && !name.is_empty());
        }
        // every name has an arm in __test_call
        let src = include_str!("testing.rs");
        for n in TEST_FUNCTIONS {
            assert!(src.contains(&format!("\"{n}\" =>")), "no arm for {n}");
        }
    }
}
