//! The `Slope` behind a handle (TypeScript `src/model/slope.ts`,
//! ARCHITECTURE.md §3.3): the facade's `Slope` class holds the handle and
//! reads and changes the engine's slope through these exports.
//!
//! - Values cross as copies (snapshot semantics). Materials cross as their
//!   index in the slope's table (`MaterialId`); the facade maps an index to
//!   its JavaScript `Material` object with the table (`slope_get(h,
//!   "materials")`, whose entries carry the facade's key of the object).
//! - A material given by JavaScript crosses as `{ key, name, color, model }`
//!   ([`MaterialWire`]); the key finds the table entry of the same object.
//! - Slices and search planes cross as [`SliceDto`] and [`PlaneDto`].
//! - Every mutable access bumps a stamp ([`slope_stamp`]), on which the
//!   facade keys its caches.
//! - Other export modules (the FE facade included) reach a slope with
//!   [`with_slope`] and [`with_slope_mut`].

use crate::convert::{from_js, to_js};
use crate::errors::{js_error, IntoJsResult};
use crate::registry::{HandleError, Registry};
use cslope_engine::model::composite::CompositeFloor;
use cslope_engine::model::reinforcement::{PileProfile, ReinforcementEnvelope};
use cslope_engine::model::slope::{AnalysisLimitsPatch, AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::model::waternet::Waternet;
use cslope_engine::types::{
    self as t, GeometryWithMaterial, HoekBrownParameters, Material, MaterialId, MaterialModel,
    Pile, Reinforcement, ReinforcementForce, ShearNormalModel, Slice, WaterTableInput,
};
use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

type JsResult<T> = Result<T, JsValue>;
type Pt = [f64; 2];

// ── the registry ─────────────────────────────────────────────────

thread_local! {
    static SLOPES: RefCell<Registry<Slope>> = const { RefCell::new(Registry::new()) };
    static STAMPS: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
    static CLOCK: Cell<u64> = const { Cell::new(0) };
}

/// The message of a call on a slope that a running analysis has taken.
pub const IN_USE: &str = "The slope is in use by a running analysis.";

fn handle_error(e: HandleError) -> JsValue {
    match e {
        HandleError::InUse => js_error(IN_USE),
        e => js_error(&e.to_string()),
    }
}

fn index(handle: u32) -> usize {
    (handle & ((1 << 20) - 1)) as usize
}

/// Marks the slope as changed (its stamp gets a new value).
pub fn touch(handle: u32) {
    let now = CLOCK.with(|c| {
        c.set(c.get() + 1);
        c.get()
    });
    STAMPS.with(|s| {
        let mut s = s.borrow_mut();
        let i = index(handle);
        if s.len() <= i {
            s.resize(i + 1, 0);
        }
        s[i] = now;
    });
}

/// The registry, mutably; while a [`with_slope`] call runs JavaScript
/// (an evaluate callback) it is borrowed, and a change is refused.
fn slopes_mut<R>(f: impl FnOnce(&mut Registry<Slope>) -> Result<R, HandleError>) -> JsResult<R> {
    SLOPES.with(|r| match r.try_borrow_mut() {
        Ok(mut r) => f(&mut r).map_err(handle_error),
        Err(_) => Err(js_error(IN_USE)),
    })
}

/// Stores a slope; returns its handle.
pub fn insert_slope(slope: Slope) -> JsResult<u32> {
    let h = slopes_mut(|r| r.insert(slope))?;
    touch(h);
    Ok(h)
}

/// Takes a slope out of the registry (freeing its handle).
pub fn remove_slope(handle: u32) -> JsResult<Slope> {
    slopes_mut(|r| {
        let s = r.take(handle)?;
        r.remove(handle);
        Ok(s)
    })
}

/// Runs `f` on the slope of `handle`. The registry stays borrowed while it
/// runs: `f` may call JavaScript that reads slopes, but not change one.
pub fn with_slope<R>(handle: u32, f: impl FnOnce(&Slope) -> R) -> JsResult<R> {
    SLOPES.with(|r| {
        let r = r.try_borrow().map_err(|_| js_error(IN_USE))?;
        let s = r.get(handle).map_err(handle_error)?;
        Ok(f(s))
    })
}

/// Runs `f` on the slope of `handle`, taken out of the registry while it
/// runs: `f` may call JavaScript (progress callbacks); a call on the same
/// handle meanwhile gets [`IN_USE`].
pub fn with_slope_mut<R>(handle: u32, f: impl FnOnce(&mut Slope) -> R) -> JsResult<R> {
    let mut slope = slopes_mut(|r| r.take(handle))?;
    let version = slope.version();
    // (a panic aborts: the slot is never left taken in a live instance)
    let out = f(&mut slope);
    // A call that changed nothing the slope's getters show (a material
    // added to the table only) keeps the facade's cached values.
    let changed = slope.version() != version;
    SLOPES.with(|r| r.borrow_mut().put_back(handle, slope));
    if changed {
        touch(handle);
    }
    Ok(out)
}

#[wasm_bindgen]
pub fn slope_new() -> JsResult<u32> {
    insert_slope(Slope::new())
}

#[wasm_bindgen]
pub fn slope_free(handle: u32) -> bool {
    // (while the registry is borrowed by a running call, the slope stays:
    // the finaliser of a later collection is not called again)
    SLICES_DROPPED.with(|d| d.borrow_mut().remove(&handle));
    SLOPES.with(|r| {
        r.try_borrow_mut()
            .map(|mut r| r.remove(handle))
            .unwrap_or(false)
    })
}

/// Live slope handles (for the facade's leak test).
#[wasm_bindgen]
pub fn slope_count() -> usize {
    SLOPES.with(|r| r.borrow().len())
}

/// A copy of the slope under a new handle.
#[wasm_bindgen]
pub fn slope_clone(handle: u32) -> JsResult<u32> {
    let copy = with_slope(handle, |s| s.clone())?;
    insert_slope(copy)
}

/// Changes with every mutable access to the slope (the facade's cache key).
#[wasm_bindgen]
pub fn slope_stamp(handle: u32) -> JsResult<f64> {
    with_slope(handle, |_| ())?;
    Ok(stamp(handle) as f64)
}

fn stamp(handle: u32) -> u64 {
    STAMPS.with(|s| s.borrow().get(index(handle)).copied().unwrap_or(0))
}

thread_local! {
    /// The slopes whose analysis kept the critical slices only, with the
    /// stamp after it: until the slope changes, a plane without slices was
    /// evaluated and gets its slices by evaluating it again.
    static SLICES_DROPPED: RefCell<std::collections::HashMap<u32, u64>> = RefCell::new(std::collections::HashMap::new());
}

/// Notes that the analysis just run on the slope kept the critical slices
/// only (`SliceRetention::Critical`): a slope of thousands of surfaces with
/// all their slices took about 180 MB of WebAssembly memory, held until
/// JavaScript collects the facade's object, and the memory never shrinks.
pub fn mark_slices_dropped(handle: u32) {
    let now = stamp(handle);
    SLICES_DROPPED.with(|d| d.borrow_mut().insert(handle, now));
}

/// Whether the planes of the slope without slices had them dropped.
pub fn slices_dropped(handle: u32) -> bool {
    let now = stamp(handle);
    SLICES_DROPPED.with(|d| d.borrow().get(&handle) == Some(&now))
}

/// The slices of plane `index` of the slope's `list` ("search" or
/// "individualPlanes"): its own, or, if the analysis dropped them, the
/// plane evaluated again (the same surface gives the same slices).
#[wasm_bindgen]
pub fn slope_plane_slices(handle: u32, list: &str, index: u32) -> JsResult<JsValue> {
    let dropped = slices_dropped(handle);
    let slices = with_slope(handle, |s| -> JsResult<Option<Vec<Slice>>> {
        let planes = if list == "search" {
            s.search()
        } else {
            s.individual_planes()
        };
        let Some(p) = planes.get(index as usize) else {
            return Ok(None);
        };
        if p.slices.is_some() || !dropped {
            return Ok(p.slices.clone());
        }
        let mut copy = p.clone();
        cslope_engine::model::solvers::evaluate_planes(s, std::slice::from_mut(&mut copy)).js()?;
        Ok(copy.slices)
    })??;
    match slices {
        Some(s) => crate::api::wire::slices_to_js(&s),
        None => Ok(JsValue::NULL),
    }
}

/// A copy of a child slope ("earlierStage", "drawdownBefore") under a new
/// handle, or `undefined`.
#[wasm_bindgen]
pub fn slope_child(handle: u32, which: &str) -> JsResult<Option<u32>> {
    let child = with_slope(handle, |s| {
        match which {
            "earlierStage" => s.earlier_stage(),
            _ => s.drawdown_before(),
        }
        .cloned()
    })?;
    child.map(insert_slope).transpose()
}

// ── materials ────────────────────────────────────────────────────

/// A JavaScript `Material`: its facade key and data.
#[derive(Deserialize, Clone)]
pub struct MaterialWire {
    #[serde(default)]
    pub key: Option<u32>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
    pub model: Arc<MaterialModel>,
}

impl From<MaterialWire> for Material {
    fn from(w: MaterialWire) -> Material {
        Material {
            name: w.name,
            color: w.color,
            model: w.model,
            external_key: w.key,
        }
    }
}

/// The table entry of a material given by JavaScript (inserted if new).
pub fn material_id(slope: &mut Slope, m: MaterialWire) -> MaterialId {
    slope.insert_material(m.into())
}

#[derive(Serialize)]
struct MaterialEntryDto<'a> {
    key: Option<u32>,
    name: &'a str,
    color: &'a str,
    model: &'a MaterialModel,
}

#[wasm_bindgen]
pub fn slope_add_material(handle: u32, m: JsValue) -> JsResult<()> {
    let m: MaterialWire = from_js(m, "material")?;
    with_slope_mut(handle, |s| {
        s.add_material(m.into());
    })
}

#[wasm_bindgen]
pub fn slope_assign_material(handle: u32, coord: JsValue, m: JsValue) -> JsResult<()> {
    let coord: Pt = from_js(coord, "coordinate")?;
    let m: MaterialWire = from_js(m, "material")?;
    with_slope_mut(handle, |s| {
        let id = material_id(s, m);
        s.assign_material(coord, id)
    })?
    .js()
}

/// The table index of a material (inserted if new).
#[wasm_bindgen]
pub fn slope_material_index(handle: u32, m: JsValue) -> JsResult<u32> {
    let m: MaterialWire = from_js(m, "material")?;
    with_slope_mut(handle, |s| material_id(s, m).0)
}

/// Gives table entry `index` the key of the JavaScript object made for it.
#[wasm_bindgen]
pub fn slope_set_material_key(handle: u32, index: u32, key: u32) -> JsResult<()> {
    // (no stamp: the slope's state does not change)
    slopes_mut(|r| {
        let s = r.get_mut(handle)?;
        if (index as usize) < s.materials().len() {
            s.set_material_external_key(MaterialId(index), key);
        }
        Ok(())
    })
}

/// `materialsChanged()` after models were changed in place: the facade
/// passes the current models of the materials JavaScript knows.
#[wasm_bindgen]
pub fn slope_materials_changed(handle: u32, materials: JsValue) -> JsResult<()> {
    let ms: Vec<MaterialWire> = from_js(materials, "materials")?;
    with_slope_mut(handle, |s| {
        for m in ms {
            let Some(key) = m.key else { continue };
            if let Some(i) = s
                .materials()
                .iter()
                .position(|x| x.external_key == Some(key))
            {
                s.set_material_model(MaterialId(i as u32), m.model);
            }
        }
        s.materials_changed();
    })
}

#[wasm_bindgen]
pub fn slope_assign_material_water_table(handle: u32, m: JsValue, id: JsValue) -> JsResult<()> {
    let m: MaterialWire = from_js(m, "material")?;
    let id: Option<String> = from_js(id, "water table id")?;
    with_slope_mut(handle, |s| {
        let mid = material_id(s, m);
        s.assign_material_water_table(mid, id.as_deref());
    })
}

#[wasm_bindgen]
pub fn slope_water_line_for_material(handle: u32, m: JsValue) -> JsResult<JsValue> {
    let m: Option<MaterialWire> = from_js(m, "material")?;
    let (default, line) = with_slope_mut(handle, |s| {
        let id = m.map(|m| material_id(s, m));
        let line = s.get_water_line_for_material(id);
        let default = match (line, s.water_rl_xy()) {
            (Some(a), Some(b)) => std::ptr::eq(a, b),
            _ => false,
        };
        (default, line.cloned())
    })?;
    // (the default line by name, so that the facade gives back its own
    // object of `waterRLXY`)
    to_js(&WaterLineOut { default, line })
}

#[derive(Serialize)]
struct WaterLineOut {
    default: bool,
    line: Option<cslope_engine::model::geometry_ops::Polyline>,
}

// ── slices and planes ────────────────────────────────────────────

/// A `Slice` as TypeScript's object, its material as a table index. A
/// number a partial slice leaves out reads as NaN (TypeScript's
/// `undefined` in arithmetic), a flag as false.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct SliceDto {
    pub x: f64,
    pub x_left: f64,
    pub x_right: f64,
    pub y0_top: f64,
    pub y1_top: f64,
    pub y_top: f64,
    pub y0_bottom: f64,
    pub y1_bottom: f64,
    pub y_bottom: f64,
    pub width: f64,
    pub height: f64,
    pub area: f64,
    pub alpha: f64,
    pub base_length: f64,
    pub weight: f64,
    pub dx: f64,
    pub e: f64,
    #[serde(rename = "R")]
    pub r: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normal_arm: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub circular: Option<bool>,
    pub udl: f64,
    pub ll: f64,
    pub is_valid: bool,
    /// The table index (out); in: the index, set by the facade.
    #[serde(default)]
    pub base_material: Option<u32>,
    pub cohesion: f64,
    pub cohesion_undrained: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cohesion_undrained_part: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suction: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suction_strength: Option<f64>,
    pub friction_angle: f64,
    pub phi: f64,
    #[serde(rename = "U")]
    pub u: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub u_water: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub water_load: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h_force: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_moment: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcement_active: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcement_passive: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcement_forces: Option<Vec<ReinforcementForce>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undrained_governs: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_combined: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hoek_brown: Option<HoekBrownParameters>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strength_model: Option<Arc<MaterialModel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y_centroid: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shear_normal: Option<Arc<ShearNormalModel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_surface: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impenetrable: Option<bool>,
}

impl Default for SliceDto {
    fn default() -> SliceDto {
        let n = f64::NAN;
        SliceDto {
            x: n,
            x_left: n,
            x_right: n,
            y0_top: n,
            y1_top: n,
            y_top: n,
            y0_bottom: n,
            y1_bottom: n,
            y_bottom: n,
            width: n,
            height: n,
            area: n,
            alpha: n,
            base_length: n,
            weight: n,
            dx: n,
            e: n,
            r: n,
            normal_arm: None,
            circular: None,
            udl: n,
            ll: n,
            is_valid: false,
            base_material: None,
            cohesion: n,
            cohesion_undrained: n,
            cohesion_undrained_part: None,
            suction: None,
            suction_strength: None,
            friction_angle: n,
            phi: n,
            u: n,
            u_water: None,
            water_load: None,
            h_force: None,
            extra_moment: None,
            reinforcement_active: None,
            reinforcement_passive: None,
            reinforcement_forces: None,
            undrained_governs: None,
            is_combined: None,
            hoek_brown: None,
            strength_model: None,
            y_centroid: None,
            shear_normal: None,
            skip_surface: None,
            impenetrable: None,
        }
    }
}

impl From<&Slice> for SliceDto {
    fn from(s: &Slice) -> SliceDto {
        SliceDto {
            x: s.x,
            x_left: s.x_left,
            x_right: s.x_right,
            y0_top: s.y0_top,
            y1_top: s.y1_top,
            y_top: s.y_top,
            y0_bottom: s.y0_bottom,
            y1_bottom: s.y1_bottom,
            y_bottom: s.y_bottom,
            width: s.width,
            height: s.height,
            area: s.area,
            alpha: s.alpha,
            base_length: s.base_length,
            weight: s.weight,
            dx: s.dx,
            e: s.e,
            r: s.r,
            normal_arm: s.normal_arm,
            circular: s.circular,
            udl: s.udl,
            ll: s.ll,
            is_valid: s.is_valid,
            base_material: s.base_material.map(|m| m.0),
            cohesion: s.cohesion,
            cohesion_undrained: s.cohesion_undrained,
            cohesion_undrained_part: s.cohesion_undrained_part,
            suction: s.suction,
            suction_strength: s.suction_strength,
            friction_angle: s.friction_angle,
            phi: s.phi,
            u: s.u,
            u_water: s.u_water,
            water_load: s.water_load,
            h_force: s.h_force,
            extra_moment: s.extra_moment,
            reinforcement_active: s.reinforcement_active,
            reinforcement_passive: s.reinforcement_passive,
            reinforcement_forces: s.reinforcement_forces.clone(),
            undrained_governs: s.undrained_governs,
            is_combined: s.is_combined,
            hoek_brown: s.hoek_brown,
            strength_model: s.strength_model.clone(),
            y_centroid: s.y_centroid,
            shear_normal: s.shear_normal.clone(),
            skip_surface: s.skip_surface,
            impenetrable: s.impenetrable,
        }
    }
}

impl From<SliceDto> for Slice {
    fn from(s: SliceDto) -> Slice {
        Slice {
            x: s.x,
            x_left: s.x_left,
            x_right: s.x_right,
            y0_top: s.y0_top,
            y1_top: s.y1_top,
            y_top: s.y_top,
            y0_bottom: s.y0_bottom,
            y1_bottom: s.y1_bottom,
            y_bottom: s.y_bottom,
            width: s.width,
            height: s.height,
            area: s.area,
            alpha: s.alpha,
            base_length: s.base_length,
            weight: s.weight,
            dx: s.dx,
            e: s.e,
            r: s.r,
            normal_arm: s.normal_arm,
            circular: s.circular,
            udl: s.udl,
            ll: s.ll,
            is_valid: s.is_valid,
            base_material: s.base_material.map(MaterialId),
            cohesion: s.cohesion,
            cohesion_undrained: s.cohesion_undrained,
            cohesion_undrained_part: s.cohesion_undrained_part,
            suction: s.suction,
            suction_strength: s.suction_strength,
            friction_angle: s.friction_angle,
            phi: s.phi,
            u: s.u,
            u_water: s.u_water,
            water_load: s.water_load,
            h_force: s.h_force,
            extra_moment: s.extra_moment,
            reinforcement_active: s.reinforcement_active,
            reinforcement_passive: s.reinforcement_passive,
            reinforcement_forces: s.reinforcement_forces,
            undrained_governs: s.undrained_governs,
            is_combined: s.is_combined,
            hoek_brown: s.hoek_brown,
            strength_model: s.strength_model,
            y_centroid: s.y_centroid,
            shear_normal: s.shear_normal,
            skip_surface: s.skip_surface,
            impenetrable: s.impenetrable,
        }
    }
}

pub fn slices_out(slices: &[Slice]) -> Vec<SliceDto> {
    slices.iter().map(SliceDto::from).collect()
}

pub fn slices_in(slices: Vec<SliceDto>) -> Vec<Slice> {
    slices.into_iter().map(Slice::from).collect()
}

/// A `SearchPlane` as TypeScript's object (`fos` and `slices` always
/// present, `null` when unset).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaneDto {
    pub lc: Pt,
    pub rc: Pt,
    pub cx: f64,
    pub cy: f64,
    pub radius: f64,
    #[serde(default)]
    pub fos: Option<f64>,
    #[serde(default)]
    pub slices: Option<Vec<SliceDto>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unchecked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lff_array: Option<Vec<[f64; 4]>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub converged: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closest_pair: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equilibrium_gap: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optimised: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Pt>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crack: Option<Pt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composite: Option<Vec<Pt>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tangent_to: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub below_min_size: Option<bool>,
}

impl PlaneDto {
    pub fn out(p: &SearchPlane, with_slices: bool) -> PlaneDto {
        PlaneDto {
            lc: p.lc,
            rc: p.rc,
            cx: p.cx,
            cy: p.cy,
            radius: p.radius,
            fos: p.fos,
            slices: if with_slices {
                p.slices.as_deref().map(slices_out)
            } else {
                None
            },
            unchecked: p.unchecked,
            lff_array: p.lff_array.clone(),
            converged: p.converged,
            closest_pair: p.closest_pair,
            equilibrium_gap: p.equilibrium_gap,
            optimised: p.optimised,
            points: p.points.clone(),
            crack: p.crack,
            composite: p.composite.clone(),
            tangent_to: p.tangent_to.map(|v| v as f64),
            below_min_size: p.below_min_size,
        }
    }
}

impl From<PlaneDto> for SearchPlane {
    fn from(p: PlaneDto) -> SearchPlane {
        SearchPlane {
            lc: p.lc,
            rc: p.rc,
            cx: p.cx,
            cy: p.cy,
            radius: p.radius,
            fos: p.fos,
            slices: p.slices.map(slices_in),
            unchecked: p.unchecked,
            lff_array: p.lff_array,
            converged: p.converged,
            closest_pair: p.closest_pair,
            equilibrium_gap: p.equilibrium_gap,
            optimised: p.optimised,
            points: p.points,
            crack: p.crack,
            composite: p.composite,
            tangent_to: p.tangent_to.map(|v| v as usize),
            below_min_size: p.below_min_size,
        }
    }
}

pub fn planes_out(planes: &[SearchPlane]) -> Vec<PlaneDto> {
    planes.iter().map(|p| PlaneDto::out(p, true)).collect()
}

pub fn planes_in(planes: Vec<PlaneDto>) -> Vec<SearchPlane> {
    planes.into_iter().map(SearchPlane::from).collect()
}

pub fn plane_in(v: JsValue) -> JsResult<SearchPlane> {
    Ok(from_js::<PlaneDto>(v, "search plane")?.into())
}

pub fn planes_from_js(v: JsValue) -> JsResult<Vec<SearchPlane>> {
    crate::api::wire::planes_from_js(v)
}

// ── other values ─────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeometryOutDto<'a> {
    px: &'a [f64],
    py: &'a [f64],
    material: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    x_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    x_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y_max: Option<f64>,
}

fn geometry_out(g: &GeometryWithMaterial) -> GeometryOutDto<'_> {
    GeometryOutDto {
        px: &g.px,
        py: &g.py,
        material: g.material.0,
        x_min: g.x_min,
        x_max: g.x_max,
        y_max: g.y_max,
    }
}

/// A `Udl` instance's fields (as the facade's class has them).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UdlWire {
    magnitude: f64,
    x1: f64,
    x2: f64,
    length: f64,
    color: String,
    direction: t::UdlDirection,
    #[serde(default)]
    excess_pore_pressure: Vec<t::UdlExcessPorePressure>,
}

impl From<UdlWire> for t::Udl {
    fn from(u: UdlWire) -> t::Udl {
        t::Udl {
            magnitude: u.magnitude,
            x1: u.x1,
            x2: u.x2,
            length: u.length,
            color: u.color,
            direction: u.direction,
            excess_pore_pressure: u.excess_pore_pressure,
        }
    }
}

impl From<&t::Udl> for UdlWire {
    fn from(u: &t::Udl) -> UdlWire {
        UdlWire {
            magnitude: u.magnitude,
            x1: u.x1,
            x2: u.x2,
            length: u.length,
            color: u.color.clone(),
            direction: u.direction,
            excess_pore_pressure: u.excess_pore_pressure.clone(),
        }
    }
}

/// A `LineLoad` instance's fields.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineLoadWire {
    magnitude: f64,
    x: f64,
    angle: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
    color: String,
}

impl From<LineLoadWire> for t::LineLoad {
    fn from(l: LineLoadWire) -> t::LineLoad {
        t::LineLoad {
            magnitude: l.magnitude,
            x: l.x,
            angle: l.angle,
            y: l.y,
            color: l.color,
        }
    }
}

impl From<&t::LineLoad> for LineLoadWire {
    fn from(l: &t::LineLoad) -> LineLoadWire {
        LineLoadWire {
            magnitude: l.magnitude,
            x: l.x,
            angle: l.angle,
            y: l.y,
            color: l.color.clone(),
        }
    }
}

/// A `ReinforcementEnvelope` (the facade makes `s` and `fromEnd1`
/// Float64Arrays).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeDto {
    pub length: f64,
    pub s: Vec<f64>,
    pub from_end1: Vec<f64>,
    pub tensile: f64,
    pub end1: f64,
    pub end2: f64,
    pub anchored: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub development: Option<[f64; 2]>,
}

impl From<&ReinforcementEnvelope> for EnvelopeDto {
    fn from(e: &ReinforcementEnvelope) -> EnvelopeDto {
        EnvelopeDto {
            length: e.length,
            s: e.s.clone(),
            from_end1: e.from_end1.clone(),
            tensile: e.tensile,
            end1: e.end1,
            end2: e.end2,
            anchored: e.anchored,
            development: e.development,
        }
    }
}

impl From<EnvelopeDto> for ReinforcementEnvelope {
    fn from(e: EnvelopeDto) -> ReinforcementEnvelope {
        ReinforcementEnvelope {
            length: e.length,
            s: e.s,
            from_end1: e.from_end1,
            tensile: e.tensile,
            end1: e.end1,
            end2: e.end2,
            anchored: e.anchored,
            development: e.development,
        }
    }
}

/// A `PileProfile` (`z`, `F`, `Q`).
#[derive(Serialize, Deserialize)]
pub struct PileProfileDto {
    pub z: Vec<f64>,
    #[serde(rename = "F")]
    pub f: Vec<f64>,
    #[serde(rename = "Q")]
    pub q: Vec<f64>,
}

impl From<&PileProfile> for PileProfileDto {
    fn from(p: &PileProfile) -> PileProfileDto {
        PileProfileDto {
            z: p.z.clone(),
            f: p.f.clone(),
            q: p.q.clone(),
        }
    }
}

impl From<PileProfileDto> for PileProfile {
    fn from(p: PileProfileDto) -> PileProfile {
        PileProfile {
            z: p.z,
            f: p.f,
            q: p.q,
        }
    }
}

/// A `CompositeFloor`.
#[derive(Serialize, Deserialize)]
pub struct FloorDto {
    pub pts: Vec<Pt>,
    pub bare: Vec<[f64; 2]>,
}

impl From<&CompositeFloor> for FloorDto {
    fn from(f: &CompositeFloor) -> FloorDto {
        FloorDto {
            pts: f.pts.clone(),
            bare: f.bare.clone(),
        }
    }
}

impl From<FloorDto> for CompositeFloor {
    fn from(f: FloorDto) -> CompositeFloor {
        CompositeFloor {
            pts: f.pts,
            bare: f.bare,
        }
    }
}

#[derive(Serialize)]
struct XyDto<'a> {
    x: &'a [f64],
    y: &'a [f64],
}

// ── getters ──────────────────────────────────────────────────────

/// A property of the slope by its TypeScript getter name.
#[wasm_bindgen]
pub fn slope_get(handle: u32, name: &str) -> JsResult<JsValue> {
    let dropped = slices_dropped(handle);
    // getters that build caches (pile profiles, envelopes, the floor) are
    // computed on the slope itself, as TypeScript's lazy getters
    with_slope(handle, |s| -> JsResult<JsValue> {
        match name {
            "materials" => to_js(
                &s.materials()
                    .iter()
                    .map(|m| MaterialEntryDto {
                        key: m.external_key,
                        name: &m.name,
                        color: &m.color,
                        model: &m.model,
                    })
                    .collect::<Vec<_>>(),
            ),
            "materialGeometries" => to_js(
                &s.material_geometries()
                    .iter()
                    .map(geometry_out)
                    .collect::<Vec<_>>(),
            ),
            "surfaceLineXY" => to_js(&s.surface_line_xy()),
            "externalBoundaryXY" => {
                let (x, y) = s.external_boundary_xy();
                to_js(&XyDto { x, y })
            }
            "waterRLXY" => to_js(&s.water_rl_xy()),
            "hasWaterTable" => Ok(s.has_water_table().into()),
            "hasMaterialWaterTables" => Ok(s.has_material_water_tables().into()),
            "allWaterLines" => to_js(&s.all_water_lines()),
            "udls" => to_js(&s.udls().iter().map(UdlWire::from).collect::<Vec<_>>()),
            "lineLoads" => to_js(
                &s.line_loads()
                    .iter()
                    .map(LineLoadWire::from)
                    .collect::<Vec<_>>(),
            ),
            "reinforcements" => to_js(s.reinforcements()),
            "piles" => to_js(s.piles()),
            "pileProfiles" => {
                let p = s.pile_profiles().js()?;
                to_js(
                    &p.iter()
                        .map(|p| p.as_ref().map(PileProfileDto::from))
                        .collect::<Vec<_>>(),
                )
            }
            "reinforcementEnvelopes" => to_js(
                &s.reinforcement_envelopes()
                    .iter()
                    .map(EnvelopeDto::from)
                    .collect::<Vec<_>>(),
            ),
            "sliceCount" => Ok(s.slice_count().into()),
            "iterations" => Ok(s.iterations().into()),
            "tolerance" => Ok(s.tolerance().into()),
            "refinedIterations" => Ok(s.refined_iterations().into()),
            "maxIterations" => Ok(s.max_iterations().into()),
            "method" => to_js(&s.method()),
            "limits" => to_js(&s.limits()),
            "searchLimits" => to_js(&s.search_limits()),
            "minFailureDistance" => Ok(s.min_failure_distance().into()),
            "fixedSlices" => to_js(&s.fixed_slices()),
            "search" => crate::api::wire::planes_to_js_lazy(s.search(), dropped),
            "individualPlanes" => {
                crate::api::wire::planes_to_js_lazy(s.individual_planes(), dropped)
            }
            "customPlanesOnly" => Ok(s.custom_planes_only().into()),
            "janbuCorrection" => Ok(s.janbu_correction().into()),
            "porePressureHead" => to_js(&s.pore_pressure_head()),
            "tensionCrackDepth" => Ok(s.tension_crack_depth().into()),
            "tensionCrackWater" => Ok(s.tension_crack_water().into()),
            "tensionCrackAngle" => Ok(s.tension_crack_angle().into()),
            "compositeSurfaces" => Ok(s.composite_surfaces().into()),
            "hasEarlierStage" => Ok(s.earlier_stage().is_some().into()),
            "hasDrawdownBefore" => Ok(s.drawdown_before().is_some().into()),
            "waternet" => to_js(&s.waternet()),
            "seismicHorizontal" => Ok(s.seismic_horizontal().into()),
            "seismicVertical" => Ok(s.seismic_vertical().into()),
            "compositeBase" => Ok(s.composite_base().into()),
            "compositeFloor" => to_js(&s.composite_floor().map(FloorDto::from)),
            "tensionCrackAuto" => Ok(s.tension_crack_auto().into()),
            "partialFactors" => to_js(&s.partial_factors()),
            "nonCircularOptimization" => Ok(s.non_circular_optimization().into()),
            "searchMethod" => to_js(&s.search_method()),
            "blockActiveAngle" => to_js(&s.block_active_angle()),
            "blockPassiveAngle" => to_js(&s.block_passive_angle()),
            "blockSearchObjects" => to_js(s.block_search_objects()),
            "minSlipArea" => Ok(s.min_slip_area().into()),
            "groundRelief" => Ok(s.ground_relief().into()),
            "modelArea" => Ok(s.model_area().into()),
            "modelHeight" => Ok(s.model_height().into()),
            "minSlipDepth" => Ok(s.min_slip_depth().into()),
            "intersliceFunction" => to_js(&s.interslice_function()),
            "intersliceDataPoints" => to_js(&s.interslice_data_points()),
            "mirrored" => Ok(s.mirrored().into()),
            "splitFailureCount" => Ok(s.split_failure_count().into()),
            "splitFailed" => Ok(s.split_failed().into()),
            "danglingBoundaries" => to_js(s.dangling_boundaries()),
            "toString" => Ok(s.to_string().into()),
            _ => Err(js_error(&format!("slope_get: no property \"{name}\""))),
        }
    })?
}

// ── setters and queries ──────────────────────────────────────────

fn pts(v: JsValue, what: &str) -> JsResult<Vec<Pt>> {
    let p: Option<Vec<Pt>> = from_js(v, what)?;
    Ok(p.unwrap_or_default())
}

#[wasm_bindgen]
pub fn slope_set_external_boundary(handle: u32, coordinates: JsValue) -> JsResult<()> {
    let c = pts(coordinates, "coordinates")?;
    with_slope_mut(handle, |s| s.set_external_boundary(&c))?.js()
}

#[wasm_bindgen]
pub fn slope_set_material_boundaries(handle: u32, lines: JsValue) -> JsResult<()> {
    let lines: Vec<Vec<Pt>> = from_js(lines, "boundaries")?;
    with_slope_mut(handle, |s| s.set_material_boundaries(&lines))?.js()
}

#[wasm_bindgen]
pub fn slope_set_material_boundary(handle: u32, coordinates: JsValue) -> JsResult<bool> {
    let c = pts(coordinates, "coordinates")?;
    with_slope_mut(handle, |s| s.set_material_boundary(&c))?.js()
}

#[wasm_bindgen]
pub fn slope_set_water_table(handle: u32, options: JsValue) -> JsResult<()> {
    let o: WaterTableInput = from_js(options, "water table")?;
    with_slope_mut(handle, |s| s.set_water_table(&o))?.js()
}

#[wasm_bindgen]
pub fn slope_set_water_table_by_id(
    handle: u32,
    id: &str,
    coordinates: JsValue,
    follow_boundary: bool,
) -> JsResult<()> {
    let c = pts(coordinates, "coordinates")?;
    with_slope_mut(handle, |s| s.set_water_table_by_id(id, &c, follow_boundary))?.js()
}

#[wasm_bindgen]
pub fn slope_remove_water_table(handle: u32) -> JsResult<()> {
    with_slope_mut(handle, |s| s.remove_water_table())
}

#[wasm_bindgen]
pub fn slope_set_udls(handle: u32, udls: JsValue) -> JsResult<()> {
    let u: Vec<UdlWire> = from_js(udls, "UDLs")?;
    with_slope_mut(handle, |s| {
        s.set_udls(u.into_iter().map(Into::into).collect())
    })
}

#[wasm_bindgen]
pub fn slope_remove_udls(handle: u32) -> JsResult<()> {
    with_slope_mut(handle, |s| s.remove_udls())
}

#[wasm_bindgen]
pub fn slope_set_line_loads(handle: u32, loads: JsValue) -> JsResult<()> {
    let l: Vec<LineLoadWire> = from_js(loads, "line loads")?;
    with_slope_mut(handle, |s| {
        s.set_line_loads(l.into_iter().map(Into::into).collect())
    })
}

#[wasm_bindgen]
pub fn slope_remove_line_loads(handle: u32) -> JsResult<()> {
    with_slope_mut(handle, |s| s.remove_line_loads())
}

#[wasm_bindgen]
pub fn slope_set_reinforcements(handle: u32, r: JsValue) -> JsResult<()> {
    let r: Vec<Reinforcement> = from_js(r, "reinforcements")?;
    with_slope_mut(handle, |s| s.set_reinforcements(&r))?.js()
}

#[wasm_bindgen]
pub fn slope_set_piles(handle: u32, p: JsValue) -> JsResult<()> {
    let p: Vec<Pile> = from_js(p, "piles")?;
    with_slope_mut(handle, |s| s.set_piles(&p))?.js()
}

#[wasm_bindgen]
pub fn slope_update_analysis_options(handle: u32, opts: JsValue) -> JsResult<()> {
    let o: Option<AnalysisOptionsPatch> = from_js(opts, "analysis options")?;
    let o = o.unwrap_or_default();
    with_slope_mut(handle, |s| s.update_analysis_options(&o))?.js()
}

#[wasm_bindgen]
pub fn slope_set_analysis_limits(handle: u32, limits: JsValue) -> JsResult<()> {
    let l: AnalysisLimitsPatch = from_js(limits, "analysis limits")?;
    with_slope_mut(handle, |s| s.set_analysis_limits(&l))
}

#[wasm_bindgen]
pub fn slope_remove_analysis_limits(handle: u32) -> JsResult<()> {
    with_slope_mut(handle, |s| s.remove_analysis_limits())?.js()
}

#[wasm_bindgen]
pub fn slope_add_fixed_slices(handle: u32, x: &[f64]) -> JsResult<()> {
    with_slope_mut(handle, |s| s.add_fixed_slices(x))
}

#[wasm_bindgen]
pub fn slope_remove_individual_planes(handle: u32) -> JsResult<()> {
    with_slope_mut(handle, |s| s.remove_individual_planes())
}

#[wasm_bindgen]
pub fn slope_set_custom_planes_only(handle: u32, value: bool) -> JsResult<()> {
    with_slope_mut(handle, |s| s.set_custom_planes_only(value))
}

#[wasm_bindgen]
pub fn slope_set_mirrored(handle: u32, value: bool) -> JsResult<()> {
    with_slope_mut(handle, |s| s.set_mirrored(value))
}

#[wasm_bindgen]
pub fn slope_set_block_search_objects(handle: u32, objects: JsValue) -> JsResult<()> {
    let o: Vec<Vec<Pt>> = from_js(objects, "block search objects")?;
    with_slope_mut(handle, |s| s.set_block_search_objects(&o))?.js()
}

#[wasm_bindgen]
pub fn slope_set_waternet(handle: u32, wn: JsValue) -> JsResult<()> {
    let wn: Option<Waternet> = from_js(wn, "waternet")?;
    with_slope_mut(handle, |s| s.set_waternet(wn))
}

/// `setEarlierStage`: a copy of `child` (or none).
#[wasm_bindgen]
pub fn slope_set_earlier_stage(handle: u32, child: Option<u32>) -> JsResult<()> {
    let c = child.map(|c| with_slope(c, |s| s.clone())).transpose()?;
    with_slope_mut(handle, |s| s.set_earlier_stage(c))
}

/// `setDrawdownBefore`: a copy of `child` (or none).
#[wasm_bindgen]
pub fn slope_set_drawdown_before(handle: u32, child: Option<u32>) -> JsResult<()> {
    let c = child.map(|c| with_slope(c, |s| s.clone())).transpose()?;
    with_slope_mut(handle, |s| s.set_drawdown_before(c))?.js()
}

#[wasm_bindgen]
pub fn slope_set_search_planes(handle: u32, planes: JsValue) -> JsResult<()> {
    let p = planes_from_js(planes)?;
    with_slope_mut(handle, |s| s.set_search_planes(p))
}

#[wasm_bindgen]
pub fn slope_set_search_results(handle: u32, planes: JsValue) -> JsResult<()> {
    let p = planes_from_js(planes)?;
    with_slope_mut(handle, |s| s.set_search_results(p))
}

#[wasm_bindgen]
pub fn slope_add_individual_planes(handle: u32, planes: JsValue) -> JsResult<()> {
    let p = planes_from_js(planes)?;
    with_slope_mut(handle, |s| s.add_individual_planes(p))
}

#[wasm_bindgen]
pub fn slope_get_external_y_intersection(handle: u32, x: f64) -> JsResult<f64> {
    with_slope(handle, |s| s.get_external_y_intersection(x))?.js()
}

#[wasm_bindgen]
pub fn slope_is_inside_external_boundary(handle: u32, x: f64, y: f64) -> JsResult<bool> {
    with_slope(handle, |s| s.is_inside_external_boundary(x, y))
}

#[wasm_bindgen]
pub fn slope_get_water_y_intersection(handle: u32, x: f64) -> JsResult<f64> {
    with_slope(handle, |s| s.get_water_y_intersection(x))?.js()
}

#[wasm_bindgen]
pub fn slope_get_circle_external_intersection(
    handle: u32,
    cx: f64,
    cy: f64,
    radius: f64,
) -> JsResult<JsValue> {
    to_js(
        &with_slope(handle, |s| {
            s.get_circle_external_intersection(cx, cy, radius)
        })?
        .js()?,
    )
}

#[wasm_bindgen]
pub fn slope_get_min_fos(handle: u32) -> JsResult<f64> {
    with_slope(handle, |s| s.get_min_fos())?.js()
}

#[wasm_bindgen]
pub fn slope_get_max_fos(handle: u32) -> JsResult<f64> {
    with_slope(handle, |s| s.get_max_fos())?.js()
}

#[derive(Serialize)]
struct CircleDto {
    cx: f64,
    cy: f64,
    radius: f64,
}

#[wasm_bindgen]
pub fn slope_get_min_fos_circle(handle: u32) -> JsResult<JsValue> {
    let (cx, cy, radius) = with_slope(handle, |s| s.get_min_fos_circle())?.js()?;
    to_js(&CircleDto { cx, cy, radius })
}

#[derive(Serialize)]
struct EndPointsDto {
    entry: Pt,
    exit: Pt,
}

#[wasm_bindgen]
pub fn slope_get_min_fos_end_points(handle: u32) -> JsResult<JsValue> {
    let (entry, exit) = with_slope(handle, |s| s.get_min_fos_end_points())?.js()?;
    to_js(&EndPointsDto { entry, exit })
}

#[wasm_bindgen]
pub fn slope_to_model_x(handle: u32, x: f64) -> JsResult<f64> {
    with_slope(handle, |s| s.to_model_x(x))?.js()
}
