//! Slices and search planes across the boundary in bulk (not a port).
//!
//! An analysis has thousands of planes with tens of slices each: as one
//! JavaScript object per slice made field by field through serde, reading
//! `slope.search` cost five times the analysis. Here the numbers of all
//! slices travel as one `Float64Array` (`SLICE_STRIDE` per slice, the
//! layout below, which `packages/engine/src/facade/wire.ts` mirrors), and
//! the rare structured fields (reinforcement, Hoek–Brown, strength models)
//! as a sparse list. Planes carry their own fields by serde, with the
//! number of their slices (`sliceCount`, absent for `slices: null`).
//!
//! Slice layout: the 25 numbers of `NUMBERS`, `isValid` (0/1), the base
//! material's table index (−1: none), a bit mask of the optional fields
//! present, then the 14 optional values of `OPTIONAL` (booleans as 0/1).
//! A field a partial slice from JavaScript leaves out is NaN (TypeScript's
//! `undefined` in arithmetic), a flag false.

use crate::convert::{from_js, to_js};
use cslope_engine::model::slope::SearchPlane;
use cslope_engine::types::{
    HoekBrownParameters, MaterialId, MaterialModel, ReinforcementForce, ShearNormalModel, Slice,
};
use js_sys::{Float64Array, Object, Reflect};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use wasm_bindgen::{JsCast, JsValue};

type JsResult<T> = Result<T, JsValue>;
type Pt = [f64; 2];

/// Numbers per slice.
pub const SLICE_STRIDE: usize = 25 + 3 + 14;

/// The structured fields of one slice (absent ones left out).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SliceExtras {
    #[serde(skip_serializing_if = "Option::is_none")]
    reinforcement_active: Option<[f64; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reinforcement_passive: Option<[f64; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reinforcement_forces: Option<Vec<ReinforcementForce>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hoek_brown: Option<HoekBrownParameters>,
    #[serde(skip_serializing_if = "Option::is_none")]
    strength_model: Option<Arc<MaterialModel>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    shear_normal: Option<Arc<ShearNormalModel>>,
}

impl SliceExtras {
    fn of(s: &Slice) -> Option<SliceExtras> {
        let e = SliceExtras {
            reinforcement_active: s.reinforcement_active,
            reinforcement_passive: s.reinforcement_passive,
            reinforcement_forces: s.reinforcement_forces.clone(),
            hoek_brown: s.hoek_brown,
            strength_model: s.strength_model.clone(),
            shear_normal: s.shear_normal.clone(),
        };
        let any = e.reinforcement_active.is_some()
            || e.reinforcement_passive.is_some()
            || e.reinforcement_forces.is_some()
            || e.hoek_brown.is_some()
            || e.strength_model.is_some()
            || e.shear_normal.is_some();
        any.then_some(e)
    }
}

fn b(v: bool) -> f64 {
    if v {
        1.0
    } else {
        0.0
    }
}

fn push_slice(out: &mut Vec<f64>, s: &Slice) {
    out.extend_from_slice(&[
        s.x,
        s.x_left,
        s.x_right,
        s.y0_top,
        s.y1_top,
        s.y_top,
        s.y0_bottom,
        s.y1_bottom,
        s.y_bottom,
        s.width,
        s.height,
        s.area,
        s.alpha,
        s.base_length,
        s.weight,
        s.dx,
        s.e,
        s.r,
        s.udl,
        s.ll,
        s.cohesion,
        s.cohesion_undrained,
        s.friction_angle,
        s.phi,
        s.u,
        b(s.is_valid),
        s.base_material.map_or(-1.0, |m| m.0 as f64),
    ]);
    let nums = [
        s.normal_arm,
        s.cohesion_undrained_part,
        s.suction,
        s.suction_strength,
        s.u_water,
        s.water_load,
        s.h_force,
        s.extra_moment,
        s.y_centroid,
    ];
    let flags = [
        s.circular,
        s.undrained_governs,
        s.is_combined,
        s.skip_surface,
        s.impenetrable,
    ];
    let mut mask = 0u32;
    for (i, v) in nums.iter().enumerate() {
        if v.is_some() {
            mask |= 1 << i;
        }
    }
    for (i, v) in flags.iter().enumerate() {
        if v.is_some() {
            mask |= 1 << (nums.len() + i);
        }
    }
    out.push(mask as f64);
    out.extend(nums.iter().map(|v| v.unwrap_or(0.0)));
    out.extend(flags.iter().map(|v| v.map_or(0.0, b)));
}

fn read_slice(d: &[f64], extras: Option<SliceExtras>) -> Slice {
    let mask = d[27] as u32;
    let opt = |i: usize| (mask & (1 << i) != 0).then_some(d[28 + i]);
    let flag = |i: usize| (mask & (1 << (9 + i)) != 0).then_some(d[37 + i] != 0.0);
    let e = extras.unwrap_or_default();
    Slice {
        x: d[0],
        x_left: d[1],
        x_right: d[2],
        y0_top: d[3],
        y1_top: d[4],
        y_top: d[5],
        y0_bottom: d[6],
        y1_bottom: d[7],
        y_bottom: d[8],
        width: d[9],
        height: d[10],
        area: d[11],
        alpha: d[12],
        base_length: d[13],
        weight: d[14],
        dx: d[15],
        e: d[16],
        r: d[17],
        udl: d[18],
        ll: d[19],
        cohesion: d[20],
        cohesion_undrained: d[21],
        friction_angle: d[22],
        phi: d[23],
        u: d[24],
        is_valid: d[25] != 0.0,
        base_material: (d[26] >= 0.0).then(|| MaterialId(d[26] as u32)),
        normal_arm: opt(0),
        cohesion_undrained_part: opt(1),
        suction: opt(2),
        suction_strength: opt(3),
        u_water: opt(4),
        water_load: opt(5),
        h_force: opt(6),
        extra_moment: opt(7),
        y_centroid: opt(8),
        circular: flag(0),
        undrained_governs: flag(1),
        is_combined: flag(2),
        skip_surface: flag(3),
        impenetrable: flag(4),
        reinforcement_active: e.reinforcement_active,
        reinforcement_passive: e.reinforcement_passive,
        reinforcement_forces: e.reinforcement_forces,
        hoek_brown: e.hoek_brown,
        strength_model: e.strength_model,
        shear_normal: e.shear_normal,
    }
}

/// Packs slices onto `data` and `extras` (the index counts across calls).
fn pack_into(slices: &[Slice], data: &mut Vec<f64>, extras: &mut Vec<(u32, SliceExtras)>) {
    for s in slices {
        let i = (data.len() / SLICE_STRIDE) as u32;
        push_slice(data, s);
        if let Some(e) = SliceExtras::of(s) {
            extras.push((i, e));
        }
    }
}

fn set(o: &Object, k: &str, v: &JsValue) -> JsResult<()> {
    Reflect::set(o, &JsValue::from_str(k), v).map(|_| ())
}

fn get(o: &JsValue, k: &str) -> JsResult<JsValue> {
    Reflect::get(o, &JsValue::from_str(k))
}

/// `{ data, extras }` of slices.
pub fn slices_to_js(slices: &[Slice]) -> JsResult<JsValue> {
    let mut data = Vec::with_capacity(slices.len() * SLICE_STRIDE);
    let mut extras = Vec::new();
    pack_into(slices, &mut data, &mut extras);
    let o = Object::new();
    set(&o, "data", &Float64Array::from(&data[..]).into())?;
    set(&o, "extras", &to_js(&extras)?)?;
    Ok(o.into())
}

fn unpack(v: &JsValue, what: &str) -> JsResult<Vec<Slice>> {
    let data: Float64Array = get(v, "data")?
        .dyn_into()
        .map_err(|_| crate::errors::type_error(&format!("{what}: no slice data")))?;
    let data = data.to_vec();
    let extras: Vec<(u32, SliceExtras)> = from_js(get(v, "extras")?, what)?;
    let n = data.len() / SLICE_STRIDE;
    let mut extras = extras.into_iter().peekable();
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let e = match extras.peek() {
            Some((k, _)) if *k as usize == i => extras.next().map(|(_, e)| e),
            _ => None,
        };
        out.push(read_slice(
            &data[i * SLICE_STRIDE..(i + 1) * SLICE_STRIDE],
            e,
        ));
    }
    Ok(out)
}

/// Slices from `{ data, extras }`.
pub fn slices_from_js(v: JsValue) -> JsResult<Vec<Slice>> {
    unpack(&v, "slices")
}

/// A plane's own fields (its slices: their number, absent for none).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaneMeta {
    pub lc: Pt,
    pub rc: Pt,
    pub cx: f64,
    pub cy: f64,
    pub radius: f64,
    #[serde(default)]
    pub fos: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slice_count: Option<u32>,
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
    /// Out only: the analysis dropped the slices, which the facade gets on
    /// request (`slope_plane_slices`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lazy_slices: Option<bool>,
}

fn meta(p: &SearchPlane) -> PlaneMeta {
    PlaneMeta {
        lc: p.lc,
        rc: p.rc,
        cx: p.cx,
        cy: p.cy,
        radius: p.radius,
        fos: p.fos,
        slice_count: p.slices.as_ref().map(|s| s.len() as u32),
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
        lazy_slices: None,
    }
}

/// `{ planes, slices: { data, extras } }` of planes.
pub fn planes_to_js(planes: &[SearchPlane]) -> JsResult<JsValue> {
    planes_to_js_lazy(planes, false)
}

/// `planes_to_js`, the planes without slices marked `lazySlices` when the
/// analysis dropped them.
pub fn planes_to_js_lazy(planes: &[SearchPlane], dropped: bool) -> JsResult<JsValue> {
    let mut data = Vec::new();
    let mut extras = Vec::new();
    for p in planes {
        if let Some(s) = &p.slices {
            pack_into(s, &mut data, &mut extras);
        }
    }
    let metas: Vec<PlaneMeta> = planes
        .iter()
        .map(|p| PlaneMeta {
            lazy_slices: (dropped && p.slices.is_none()).then_some(true),
            ..meta(p)
        })
        .collect();
    let slices = Object::new();
    set(&slices, "data", &Float64Array::from(&data[..]).into())?;
    set(&slices, "extras", &to_js(&extras)?)?;
    let o = Object::new();
    set(&o, "planes", &to_js(&metas)?)?;
    set(&o, "slices", &slices.into())?;
    Ok(o.into())
}

/// Planes from `{ planes, slices }`.
pub fn planes_from_js(v: JsValue) -> JsResult<Vec<SearchPlane>> {
    let metas: Vec<PlaneMeta> = from_js(get(&v, "planes")?, "search planes")?;
    let mut slices = unpack(&get(&v, "slices")?, "search planes")?.into_iter();
    Ok(metas
        .into_iter()
        .map(|m| SearchPlane {
            lc: m.lc,
            rc: m.rc,
            cx: m.cx,
            cy: m.cy,
            radius: m.radius,
            fos: m.fos,
            slices: m
                .slice_count
                .map(|n| slices.by_ref().take(n as usize).collect()),
            unchecked: m.unchecked,
            lff_array: m.lff_array,
            converged: m.converged,
            closest_pair: m.closest_pair,
            equilibrium_gap: m.equilibrium_gap,
            optimised: m.optimised,
            points: m.points,
            crack: m.crack,
            composite: m.composite,
            tangent_to: m.tangent_to.map(|v| v as usize),
            below_min_size: m.below_min_size,
        })
        .collect())
}
