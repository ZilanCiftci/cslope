//! Exports of the limit equilibrium model (TypeScript `src/model`): the
//! functions that take a `Slope` (by handle, [`crate::api::slope`]),
//! slices and search planes. A function that changes the slices it is given
//! (TypeScript's solvers write `undrainedGoverns`, Hoek–Brown parameters,
//! reinforcement forces) returns `{ result, slices }`, and the facade writes
//! the slices back onto the caller's objects.

use crate::api::slope::{
    insert_slope, plane_in, with_slope, with_slope_mut, EnvelopeDto, FloorDto, MaterialWire,
    PileProfileDto, SliceDto,
};
use crate::api::wire::{self, planes_from_js};
use crate::convert::{from_js, to_js};
use crate::errors::IntoJsResult;
use cslope_engine::model::block_search::best_distinct;
use cslope_engine::model::build_slope::build_slope as engine_build_slope;
use cslope_engine::model::composite as comp;
use cslope_engine::model::drawdown::{
    apply_rapid_drawdown, drawdown_strength as engine_drawdown_strength,
};
use cslope_engine::model::geometry_ops::Polyline;
use cslope_engine::model::reinforcement as reinf;
use cslope_engine::model::result_warnings as warn;
use cslope_engine::model::search;
use cslope_engine::model::sgi3d::sgi3d_factor_of_safety as engine_sgi3d;
use cslope_engine::model::slices::{self, SliceScratch};
use cslope_engine::model::solvers::{self, EvalScratch, MpSolver};
use cslope_engine::model::surface;
use cslope_engine::model::surface_slide;
use cslope_engine::types::{
    GeometryWithMaterial, Material, MaterialId, Pile, Reinforcement, Sgi3dOptions, Slice,
    SlopeDefinition,
};
use js_sys::Function;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

type JsResult<T> = Result<T, JsValue>;
type Pt = [f64; 2];

fn slices_arg(v: JsValue) -> JsResult<Vec<Slice>> {
    wire::slices_from_js(v)
}

/// `{ result, slices }`: a result and the slices as the call left them.
pub fn with_slices<T: Serialize>(result: T, slices: &[Slice]) -> JsResult<JsValue> {
    result_with_slices(&to_js(&result)?, slices)
}

/// `{ result, slices }` of a result already in JavaScript.
pub fn result_with_slices(result: &JsValue, slices: &[Slice]) -> JsResult<JsValue> {
    let out = js_sys::Object::new();
    js_sys::Reflect::set(&out, &"result".into(), result)?;
    js_sys::Reflect::set(&out, &"slices".into(), &wire::slices_to_js(slices)?)?;
    Ok(out.into())
}

/// Calls a JavaScript function; its exception becomes the error.
pub fn call(f: &Function, args: &[JsValue]) -> JsResult<JsValue> {
    let a = js_sys::Array::new();
    for v in args {
        a.push(v);
    }
    f.apply(&JsValue::NULL, &a)
}

/// The JavaScript exception as an engine error (its message), to pass
/// through an engine callback.
pub fn js_to_engine(e: JsValue) -> cslope_engine::error::EngineError {
    let message = js_sys::Reflect::get(&e, &JsValue::from_str("message"))
        .ok()
        .and_then(|m| m.as_string())
        .or_else(|| e.as_string())
        .unwrap_or_else(|| "JavaScript error".to_string());
    cslope_engine::error::EngineError::new(message)
}

// ── build-slope ──────────────────────────────────────────────────

#[wasm_bindgen]
pub fn build_slope(def: JsValue) -> JsResult<u32> {
    let def: SlopeDefinition = from_js(def, "slope definition")?;
    insert_slope(engine_build_slope(&def).js()?)
}

// ── slices ───────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn get_slices(
    handle: u32,
    entry_x: f64,
    x1: f64,
    cx: f64,
    cy: f64,
    radius: f64,
    points: JsValue,
) -> JsResult<JsValue> {
    let points: Option<Vec<Pt>> = from_js(points, "points")?;
    let s = with_slope(handle, |s| {
        let mut scratch = SliceScratch::new();
        slices::get_slices(
            s,
            entry_x,
            x1,
            cx,
            cy,
            radius,
            points.as_deref(),
            &mut scratch,
        )
    })?
    .js()?;
    wire::slices_to_js(&s)
}

#[wasm_bindgen]
pub fn rankine_crack_depth(handle: u32, x: f64) -> JsResult<f64> {
    with_slope(handle, |s| slices::rankine_crack_depth(s, x))?.js()
}

#[wasm_bindgen]
pub fn head_factor(
    line: JsValue,
    wy_left: f64,
    wy_right: f64,
    x_left: f64,
    x_right: f64,
    vertical_head: bool,
) -> JsResult<f64> {
    let line: Polyline = from_js(line, "line")?;
    Ok(slices::head_factor(
        &line,
        wy_left,
        wy_right,
        x_left,
        x_right,
        vertical_head,
    ))
}

/// A JavaScript `(x) => y` as a Rust function (NaN where it throws or
/// returns no number; the first exception is kept in `error`).
fn js_fn1<'a>(f: &'a Function, error: &'a RefCell<Option<JsValue>>) -> impl Fn(f64) -> f64 + 'a {
    move |x| match f.call1(&JsValue::NULL, &JsValue::from_f64(x)) {
        Ok(v) => v.as_f64().unwrap_or(f64::NAN),
        Err(e) => {
            error.borrow_mut().get_or_insert(e);
            f64::NAN
        }
    }
}

#[wasm_bindgen]
pub fn find_angle_crack_x(
    x_entry: f64,
    x_exit: f64,
    base_y: &Function,
    angle: f64,
) -> JsResult<Option<f64>> {
    let error = RefCell::new(None);
    let r = slices::find_angle_crack_x(x_entry, x_exit, js_fn1(base_y, &error), angle);
    match error.into_inner() {
        Some(e) => Err(e),
        None => Ok(r),
    }
}

#[wasm_bindgen]
pub fn find_crack_x(
    surf: JsValue,
    x_entry: f64,
    x_exit: f64,
    base_y: &Function,
    depth_at: &Function,
) -> JsResult<Option<f64>> {
    let surf: Polyline = from_js(surf, "surface line")?;
    let error = RefCell::new(None);
    let depth = |x: f64| -> cslope_engine::error::Result<f64> {
        let v = depth_at
            .call1(&JsValue::NULL, &JsValue::from_f64(x))
            .map_err(js_to_engine)?;
        Ok(v.as_f64().unwrap_or(f64::NAN))
    };
    let r = slices::find_crack_x(&surf, x_entry, x_exit, js_fn1(base_y, &error), depth).js()?;
    match error.into_inner() {
        Some(e) => Err(e),
        None => Ok(r),
    }
}

// ── solvers ──────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn set_morgenstern_price_solver(solver: &str) {
    solvers::set_morgenstern_price_solver(if solver == "march" {
        MpSolver::March
    } else {
        MpSolver::Iterative
    });
}

#[wasm_bindgen]
pub fn get_morgenstern_price_solver() -> String {
    match solvers::get_morgenstern_price_solver() {
        MpSolver::March => "march",
        MpSolver::Iterative => "iterative",
    }
    .to_string()
}

#[wasm_bindgen]
pub fn analyse_ordinary(handle: u32, slices: JsValue) -> JsResult<Option<f64>> {
    let s = slices_arg(slices)?;
    with_slope(handle, |slope| solvers::analyse_ordinary(slope, &s))
}

#[wasm_bindgen]
pub fn analyse_bishop(handle: u32, slices: JsValue, fs: Option<f64>) -> JsResult<JsValue> {
    let mut s = slices_arg(slices)?;
    let r = with_slope(handle, |slope| solvers::analyse_bishop(slope, &mut s, fs))?;
    with_slices(r, &s)
}

#[wasm_bindgen]
pub fn analyse_janbu(handle: u32, slices: JsValue, fs: Option<f64>) -> JsResult<JsValue> {
    let mut s = slices_arg(slices)?;
    let r = with_slope(handle, |slope| solvers::analyse_janbu(slope, &mut s, fs))?;
    with_slices(r, &s)
}

#[wasm_bindgen]
pub fn janbu_correction_factor(slices: JsValue) -> JsResult<f64> {
    Ok(solvers::janbu_correction_factor(&slices_arg(slices)?))
}

#[wasm_bindgen]
pub fn solve_slice_normal(
    w: f64,
    x_left: f64,
    e_left: f64,
    eff_c: f64,
    tan_phi: f64,
    cos_a: f64,
    sin_a: f64,
    shear_factor: f64,
    fos: f64,
) -> Vec<f64> {
    solvers::solve_slice_normal(
        w,
        x_left,
        e_left,
        eff_c,
        tan_phi,
        cos_a,
        sin_a,
        shear_factor,
        fos,
    )
    .to_vec()
}

#[wasm_bindgen]
pub fn solved_effective_normals(
    handle: u32,
    slices: JsValue,
    fos: f64,
    lff_array: JsValue,
) -> JsResult<JsValue> {
    let mut s = slices_arg(slices)?;
    let lff: Option<Vec<[f64; 4]>> = from_js(lff_array, "lffArray")?;
    let r = with_slope(handle, |slope| {
        solvers::solved_effective_normals(slope, &mut s, fos, lff.as_deref())
    })?;
    with_slices(r, &s)
}

/// TypeScript's tuple `[fos, lffArray, pushing, resisting, converged,
/// equilibriumGap?, closestPair?]` (the last two only when set).
pub fn mp_tuple(o: &solvers::MpOutcome) -> JsResult<JsValue> {
    let a = js_sys::Array::new();
    a.push(&to_js(&o.fos)?);
    a.push(&to_js(&o.lff_array)?);
    a.push(&to_js(&o.pushing)?);
    a.push(&to_js(&o.resisting)?);
    a.push(&JsValue::from_bool(o.converged));
    if o.equilibrium_gap.is_some() || o.closest_pair.is_some() {
        a.push(&to_js(&o.equilibrium_gap)?);
    }
    if let Some(c) = o.closest_pair {
        a.push(&JsValue::from_bool(c));
    }
    Ok(a.into())
}

#[wasm_bindgen]
pub fn analyse_morgenstern_price(handle: u32, slices: JsValue) -> JsResult<JsValue> {
    let mut s = slices_arg(slices)?;
    let r = with_slope(handle, |slope| {
        solvers::analyse_morgenstern_price(slope, &mut s)
    })?
    .js()?;
    result_with_slices(&mp_tuple(&r)?, &s)
}

/// `analyseSlope(slope)`: the minimum FOS (the results set on the slope).
#[wasm_bindgen]
pub fn analyse_slope(handle: u32) -> JsResult<Option<f64>> {
    // The critical slices only (the others on request: mark_slices_dropped).
    let mut ctx = cslope_engine::api::ctx::RunCtx {
        retention: cslope_engine::api::ctx::SliceRetention::Critical,
        ..Default::default()
    };
    let fos = with_slope_mut(handle, |s| solvers::analyse_slope(s, &mut ctx))?.js()?;
    crate::api::slope::mark_slices_dropped(handle);
    Ok(fos)
}

#[wasm_bindgen]
pub fn restore_critical_slices(handle: u32) -> JsResult<()> {
    with_slope_mut(handle, solvers::restore_critical_slices)?.js()
}

/// `evaluatePlanes(slope, planes)`: the planes as evaluated (the facade
/// writes them back onto the caller's objects).
#[wasm_bindgen]
pub fn evaluate_planes(handle: u32, planes: JsValue) -> JsResult<JsValue> {
    let mut p = planes_from_js(planes)?;
    with_slope(handle, |s| solvers::evaluate_planes(s, &mut p))?.js()?;
    wire::planes_to_js(&p)
}

/// The fields `sliceVerticalLoad` and `sliceDrivingMoment` read (a
/// partial slice: absent numbers read as NaN, as `undefined` in
/// TypeScript's arithmetic, and absent optional ones as unset).
fn slice_part(v: JsValue) -> JsResult<Slice> {
    Ok(from_js::<SliceDto>(v, "slice")?.into())
}

#[wasm_bindgen]
pub fn slice_vertical_load(s: JsValue) -> JsResult<f64> {
    Ok(solvers::slice_vertical_load(&slice_part(s)?))
}

#[wasm_bindgen]
pub fn slice_driving_moment(s: JsValue) -> JsResult<f64> {
    Ok(solvers::slice_driving_moment(&slice_part(s)?))
}

// ── search ───────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn plane_key(plane: JsValue) -> JsResult<String> {
    Ok(search::plane_key(&plane_in(plane)?))
}

#[wasm_bindgen]
pub fn select_entry_exit(handle: u32, cx: f64, cy: f64, radius: f64) -> JsResult<JsValue> {
    let r = with_slope(handle, |s| search::select_entry_exit(s, cx, cy, radius))?.js()?;
    to_js(&r)
}

#[wasm_bindgen]
pub fn is_plane_within_external_boundary(
    handle: u32,
    plane: JsValue,
    as_circle: bool,
) -> JsResult<bool> {
    let p = plane_in(plane)?;
    with_slope(handle, |s| {
        search::is_plane_within_external_boundary(s, &p, as_circle)
    })
}

#[wasm_bindgen]
pub fn generate_planes(
    handle: u32,
    lc: JsValue,
    rc: JsValue,
    num_circles: f64,
) -> JsResult<JsValue> {
    let lc: Pt = from_js(lc, "lc")?;
    let rc: Pt = from_js(rc, "rc")?;
    let p = with_slope(handle, |s| search::generate_planes(s, lc, rc, num_circles))?.js()?;
    wire::planes_to_js(&p)
}

#[wasm_bindgen]
pub fn set_entry_exit_planes(handle: u32) -> JsResult<()> {
    with_slope_mut(handle, search::set_entry_exit_planes)?.js()
}

#[wasm_bindgen]
pub fn add_single_entry_exit_plane(
    handle: u32,
    lc_x: f64,
    rc_x: f64,
    num_circles: f64,
) -> JsResult<()> {
    with_slope_mut(handle, |s| {
        search::add_single_entry_exit_plane(s, lc_x, rc_x, num_circles)
    })?
    .js()
}

#[wasm_bindgen]
pub fn add_single_circular_plane(handle: u32, cx: f64, cy: f64, radius: f64) -> JsResult<()> {
    with_slope_mut(handle, |s| {
        search::add_single_circular_plane(s, cx, cy, radius)
    })?
    .js()
}

// ── surface ──────────────────────────────────────────────────────

fn pts(v: JsValue) -> JsResult<Vec<Pt>> {
    from_js(v, "points")
}

#[wasm_bindgen]
pub fn polyline_y_at(points: JsValue, x: f64) -> JsResult<f64> {
    Ok(surface::polyline_y_at(&pts(points)?, x))
}

#[wasm_bindgen]
pub fn polyline_crossings_x(
    points: JsValue,
    px: &[f64],
    py: &[f64],
    closed: bool,
) -> JsResult<Vec<f64>> {
    Ok(surface::polyline_crossings_x(&pts(points)?, px, py, closed))
}

#[wasm_bindgen]
pub fn default_axis_point(points: JsValue) -> JsResult<Vec<f64>> {
    Ok(surface::default_axis_point(&pts(points)?).to_vec())
}

#[wasm_bindgen]
pub fn fit_polyline_to_ground(handle: u32, input: JsValue) -> JsResult<JsValue> {
    let p = pts(input)?;
    to_js(&with_slope(handle, |s| {
        surface::fit_polyline_to_ground(s, &p)
    })?)
}

#[wasm_bindgen]
pub fn is_admissible_polyline(
    handle: u32,
    points: JsValue,
    concavity_tol_deg: f64,
) -> JsResult<bool> {
    let p = pts(points)?;
    with_slope(handle, |s| {
        surface::is_admissible_polyline(s, &p, concavity_tol_deg)
    })
}

#[wasm_bindgen]
pub fn boundary_corner_in_mass(handle: u32, x0: f64, x1: f64, base_y: &Function) -> JsResult<bool> {
    let error = RefCell::new(None);
    let r = with_slope(handle, |s| {
        surface::boundary_corner_in_mass(s, x0, x1, js_fn1(base_y, &error))
    })?;
    match error.into_inner() {
        Some(e) => Err(e),
        None => Ok(r),
    }
}

#[wasm_bindgen]
pub fn circle_leaves_model(
    handle: u32,
    cx: f64,
    cy: f64,
    radius: f64,
    x0: f64,
    x1: f64,
) -> JsResult<bool> {
    with_slope(handle, |s| {
        surface::circle_leaves_model(s, cx, cy, radius, x0, x1)
    })
}

#[wasm_bindgen]
pub fn circle_to_polyline(
    cx: f64,
    cy: f64,
    radius: f64,
    lc: JsValue,
    rc: JsValue,
    vertices: f64,
) -> JsResult<JsValue> {
    let lc: Pt = from_js(lc, "lc")?;
    let rc: Pt = from_js(rc, "rc")?;
    to_js(&surface::circle_to_polyline(
        cx,
        cy,
        radius,
        lc,
        rc,
        vertices as usize,
    ))
}

// ── composite ────────────────────────────────────────────────────

/// Geometries whose materials are indices into `materials` (the facade
/// numbers the distinct `Material` objects).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeometryInDto {
    px: Vec<f64>,
    py: Vec<f64>,
    material: u32,
    #[serde(default)]
    x_min: Option<f64>,
    #[serde(default)]
    x_max: Option<f64>,
    #[serde(default)]
    y_max: Option<f64>,
}

#[derive(Deserialize)]
struct XyIn {
    x: Vec<f64>,
    y: Vec<f64>,
}

#[wasm_bindgen]
pub fn composite_floor(
    boundary: JsValue,
    geometries: JsValue,
    materials: JsValue,
    follow_base: bool,
) -> JsResult<JsValue> {
    let b: XyIn = from_js(boundary, "boundary")?;
    let g: Vec<GeometryInDto> = from_js(geometries, "geometries")?;
    let m: Vec<MaterialWire> = from_js(materials, "materials")?;
    let geos: Vec<GeometryWithMaterial> = g
        .into_iter()
        .map(|d| GeometryWithMaterial {
            px: d.px,
            py: d.py,
            material: MaterialId(d.material),
            x_min: d.x_min,
            x_max: d.x_max,
            y_max: d.y_max,
        })
        .collect();
    let mats: Vec<Material> = m.into_iter().map(Into::into).collect();
    let f = comp::composite_floor(&b.x, &b.y, &geos, &mats, follow_base);
    to_js(&f.as_ref().map(FloorDto::from))
}

#[wasm_bindgen]
pub fn floor_dip_tolerance(model_height: f64) -> f64 {
    comp::floor_dip_tolerance(model_height)
}

#[wasm_bindgen]
pub fn circle_below_bare_base(
    floor: JsValue,
    cx: f64,
    cy: f64,
    radius: f64,
    x0: f64,
    x1: f64,
    tol: f64,
) -> JsResult<bool> {
    let f: comp::CompositeFloor = from_js::<FloorDto>(floor, "floor")?.into();
    Ok(comp::circle_below_bare_base(
        &f, cx, cy, radius, x0, x1, tol,
    ))
}

#[wasm_bindgen]
pub fn floor_y_at(floor: JsValue, x: f64, side: JsValue) -> JsResult<f64> {
    let f: comp::CompositeFloor = from_js::<FloorDto>(floor, "floor")?.into();
    let side: Option<crate::api::geometry::SideDto> = from_js(side, "side")?;
    Ok(comp::floor_y_at(
        &f,
        x,
        side.unwrap_or(crate::api::geometry::SideDto::Left).into(),
    ))
}

// ── reinforcement ────────────────────────────────────────────────

#[wasm_bindgen]
pub fn effective_vertical_stress(handle: u32, x: f64, y: f64) -> JsResult<f64> {
    with_slope(handle, |s| reinf::effective_vertical_stress(s, x, y))
}

#[wasm_bindgen]
pub fn vertical_stress(handle: u32, x: f64, y: f64, effective: bool) -> JsResult<f64> {
    with_slope(handle, |s| reinf::vertical_stress(s, x, y, effective))
}

#[wasm_bindgen]
pub fn effective_vertical_stress_with_loads(handle: u32, x: f64, y: f64) -> JsResult<f64> {
    with_slope(handle, |s| {
        reinf::effective_vertical_stress_with_loads(s, x, y)
    })
}

#[wasm_bindgen]
pub fn build_envelope(handle: u32, r: JsValue) -> JsResult<JsValue> {
    let r: Reinforcement = from_js(r, "reinforcement")?;
    to_js(&EnvelopeDto::from(&with_slope(handle, |s| {
        reinf::build_envelope(s, &r)
    })?))
}

fn envelope(v: JsValue) -> JsResult<reinf::ReinforcementEnvelope> {
    Ok(from_js::<EnvelopeDto>(v, "envelope")?.into())
}

#[wasm_bindgen]
pub fn pullout_beyond(env: JsValue, s: f64) -> JsResult<f64> {
    Ok(reinf::pullout_beyond(&envelope(env)?, s))
}

#[wasm_bindgen]
pub fn envelope_at(env: JsValue, s: f64) -> JsResult<f64> {
    Ok(reinf::envelope_at(&envelope(env)?, s))
}

#[wasm_bindgen]
pub fn apply_reinforcement(handle: u32, slices: JsValue, cx: f64, cy: f64) -> JsResult<JsValue> {
    let mut s = slices_arg(slices)?;
    let r = with_slope(handle, |slope| {
        reinf::apply_reinforcement(slope, &mut s, cx, cy)
    })?
    .js()?;
    with_slices(r, &s)
}

#[wasm_bindgen]
pub fn pile_force_direction(p: JsValue, tx: f64, ty: f64) -> JsResult<Vec<f64>> {
    let p: Pile = from_js(p, "pile")?;
    Ok(reinf::pile_force_direction(&p, tx, ty).to_vec())
}

#[wasm_bindgen]
#[allow(non_snake_case)]
pub fn ito_matsui_coefficients(D1: f64, D: f64, phi_deg: f64) -> Vec<f64> {
    reinf::ito_matsui_coefficients(D1, D, phi_deg).to_vec()
}

#[wasm_bindgen]
pub fn build_pile_profile(handle: u32, p: JsValue) -> JsResult<JsValue> {
    let p: Pile = from_js(p, "pile")?;
    let r = with_slope(handle, |s| reinf::build_pile_profile(s, &p))?.js()?;
    to_js(&r.as_ref().map(PileProfileDto::from))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PileForceDto {
    per_pile: f64,
    per_metre: f64,
    governs: &'static str,
    resultant_above: f64,
}

/// `pileForce(slope, p, x, y, profile?)`: `profile` undefined builds it,
/// null is none.
#[wasm_bindgen]
pub fn pile_force(handle: u32, p: JsValue, x: f64, y: f64, profile: JsValue) -> JsResult<JsValue> {
    let pile: Pile = from_js(p, "pile")?;
    let f = if profile.is_undefined() {
        with_slope(handle, |s| reinf::pile_force_with_profile(s, &pile, x, y))?.js()?
    } else {
        let prof: Option<PileProfileDto> = from_js(profile, "pile profile")?;
        let prof = prof.map(reinf::PileProfile::from);
        with_slope(handle, |s| reinf::pile_force(s, &pile, x, y, prof.as_ref()))?
    };
    to_js(&PileForceDto {
        per_pile: f.per_pile,
        per_metre: f.per_metre,
        governs: f.governs.as_str(),
        resultant_above: f.resultant_above,
    })
}

// ── drawdown, surface slide, warnings, 3D ────────────────────────

#[wasm_bindgen]
pub fn drawdown_strength(
    sfc: f64,
    tfc: f64,
    c: f64,
    phi_deg: f64,
    c_r: f64,
    phi_r_deg: f64,
) -> f64 {
    engine_drawdown_strength(sfc, tfc, c, phi_deg, c_r, phi_r_deg)
}

#[wasm_bindgen]
pub fn apply_rapid_drawdown_to(handle: u32, slices: JsValue, plane: JsValue) -> JsResult<JsValue> {
    let mut s = slices_arg(slices)?;
    let p = plane_in(plane)?;
    let r = with_slope(handle, |slope| {
        apply_rapid_drawdown(slope, &mut s, &p, &mut EvalScratch::new())
    })?
    .js()?;
    with_slices(r, &s)
}

#[wasm_bindgen]
pub fn frictional_surface_slide(handle: u32, sliding_only: bool) -> JsResult<JsValue> {
    to_js(
        &with_slope(handle, |s| {
            surface_slide::frictional_surface_slide(s, sliding_only)
        })?
        .js()?,
    )
}

#[wasm_bindgen]
pub fn surface_slide_message(s: JsValue, f: f64) -> JsResult<String> {
    let s: surface_slide::SurfaceSlide = from_js(s, "surface slide")?;
    Ok(surface_slide::surface_slide_message(&s, f))
}

#[wasm_bindgen]
pub fn entry_inclination(plane: JsValue) -> JsResult<f64> {
    Ok(warn::entry_inclination(&plane_in(plane)?))
}

#[wasm_bindgen]
pub fn steep_entry_message(handle: u32, planes: JsValue) -> JsResult<Option<String>> {
    let p = planes_from_js(planes)?;
    let refs: Vec<&cslope_engine::model::slope::SearchPlane> = p.iter().collect();
    with_slope(handle, |s| warn::steep_entry_message(s, &refs))
}

#[wasm_bindgen]
pub fn steep_entry_tension_message(
    handle: u32,
    plane: JsValue,
    n: f64,
) -> JsResult<Option<String>> {
    let p = plane_in(plane)?;
    with_slope(handle, |s| {
        warn::steep_entry_tension_message(s, &p, n as usize)
    })
}

#[wasm_bindgen]
pub fn dangling_boundary_message(n: f64) -> String {
    warn::dangling_boundary_message(n as usize)
}

#[wasm_bindgen]
pub fn analysis_warnings(handle: u32, effective_normals: JsValue) -> JsResult<JsValue> {
    let n: Option<Vec<f64>> = from_js(effective_normals, "effective normals")?;
    to_js(&with_slope(handle, |s| warn::analysis_warnings(s, n.as_deref()))?.js()?)
}

#[wasm_bindgen]
pub fn shallow_depth_limit(local_relief: f64) -> f64 {
    warn::shallow_depth_limit(local_relief)
}

/// `shallowCohesionlessMessage(slices, fos, relief)`: the slices' materials
/// are indices into `materials`.
#[wasm_bindgen]
pub fn shallow_cohesionless_message(
    slices: JsValue,
    materials: JsValue,
    fos: f64,
    relief: f64,
) -> JsResult<Option<String>> {
    let s = slices_arg(slices)?;
    let m: Vec<MaterialWire> = from_js(materials, "materials")?;
    let mats: Vec<Material> = m.into_iter().map(Into::into).collect();
    Ok(warn::shallow_cohesionless_message(&s, &mats, fos, relief))
}

#[wasm_bindgen]
pub fn sgi3d_factor_of_safety(handle: u32, options: JsValue) -> JsResult<JsValue> {
    let o: Sgi3dOptions = from_js(options, "SGI 3D options")?;
    to_js(&with_slope(handle, |s| engine_sgi3d(s, &o))?.js()?)
}

// ── block search ─────────────────────────────────────────────────

#[wasm_bindgen]
pub fn best_distinct_planes(planes: JsValue, count: f64, span: f64) -> JsResult<JsValue> {
    let p = planes_from_js(planes)?;
    wire::planes_to_js(&best_distinct(&p, count as usize, span))
}
