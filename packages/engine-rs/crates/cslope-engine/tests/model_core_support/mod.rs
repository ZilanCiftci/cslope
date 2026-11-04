//! Shared code of the model core tests: the Slope snapshot (every getter and
//! derived value, as JSON), a JSON comparison with a relative tolerance on
//! numbers, and model builders.
#![allow(dead_code, clippy::disallowed_methods)]

use cslope_engine::model::composite::{circle_below_bare_base, composite_floor, floor_y_at};
use cslope_engine::model::geometry_ops::{Polyline, Side};
use cslope_engine::model::reinforcement::{
    effective_vertical_stress, effective_vertical_stress_with_loads, envelope_at, pile_force,
    pile_force_direction, pullout_beyond, vertical_stress,
};
use cslope_engine::model::search::{plane_key, select_entry_exit};
use cslope_engine::model::slope::{SearchPlane, Slope};
use cslope_engine::model::surface::circle_leaves_model;
use cslope_engine::types::Material;
use serde_json::{json, Map, Value};

/// A number as write.ts encodes it (non-finite as strings).
pub fn n(x: f64) -> Value {
    if x.is_nan() {
        json!("NaN")
    } else if x == f64::INFINITY {
        json!("Infinity")
    } else if x == f64::NEG_INFINITY {
        json!("-Infinity")
    } else {
        json!(x)
    }
}

pub fn ns(xs: &[f64]) -> Value {
    Value::Array(xs.iter().map(|&x| n(x)).collect())
}

pub fn pt(p: [f64; 2]) -> Value {
    json!([n(p[0]), n(p[1])])
}

pub fn pts(ps: &[[f64; 2]]) -> Value {
    Value::Array(ps.iter().map(|&p| pt(p)).collect())
}

pub fn line(l: Option<&Polyline>) -> Value {
    match l {
        Some(l) => json!({ "x": ns(&l.x), "y": ns(&l.y) }),
        None => Value::Null,
    }
}

pub fn opt(v: Option<Value>) -> Value {
    v.unwrap_or(Value::Null)
}

/// `{ ok }` or `{ error }` of a fallible call.
pub fn attempt<T>(r: cslope_engine::error::Result<T>, f: impl FnOnce(T) -> Value) -> Value {
    match r {
        Ok(v) => json!({ "ok": f(v) }),
        Err(e) => json!({ "error": e.message }),
    }
}

fn mat(m: &Material) -> Value {
    json!({ "name": m.name, "color": m.color, "model": serde_json::to_value(&*m.model).unwrap() })
}

/// Inserts the key unless the value is None (TypeScript's undefined fields
/// are left out of the JSON).
fn put(o: &mut Map<String, Value>, k: &str, v: Option<Value>) {
    if let Some(v) = v {
        o.insert(k.to_string(), v);
    }
}

pub fn plane_json(p: &SearchPlane) -> Value {
    let mut o = Map::new();
    o.insert("key".into(), json!(plane_key(p)));
    o.insert("lc".into(), pt(p.lc));
    o.insert("rc".into(), pt(p.rc));
    o.insert("cx".into(), n(p.cx));
    o.insert("cy".into(), n(p.cy));
    o.insert("radius".into(), n(p.radius));
    o.insert("fos".into(), p.fos.map_or(Value::Null, n));
    put(&mut o, "tangentTo", p.tangent_to.map(|t| json!(t)));
    put(&mut o, "unchecked", p.unchecked.map(|t| json!(t)));
    put(&mut o, "points", p.points.as_ref().map(|v| pts(v)));
    Value::Object(o)
}

pub fn snap(slope: &Slope, depth: usize) -> Value {
    let geoms = slope.material_geometries();
    let (bx, by) = slope.external_boundary_xy();
    let min = |v: &[f64]| {
        v.iter()
            .fold(f64::INFINITY, |m, &x| cslope_engine::js::math::min(m, x))
    };
    let max = |v: &[f64]| {
        v.iter().fold(f64::NEG_INFINITY, |m, &x| {
            cslope_engine::js::math::max(m, x)
        })
    };
    let (x0, x1, y0, y1) = (min(bx), max(bx), min(by), max(by));
    let xs: Vec<f64> = (0..9).map(|i| x0 + ((x1 - x0) * i as f64) / 8.0).collect();
    let mut probe = Vec::new();
    for i in 0..=6 {
        for j in 0..=6 {
            let x = x0 + ((x1 - x0) * (i as f64 + 0.37)) / 7.0;
            let y = y0 + ((y1 - y0) * (j as f64 + 0.21)) / 7.0;
            probe.push(json!({
                "x": n(x), "y": n(y),
                "inside": slope.is_inside_external_boundary(x, y),
                "evs": n(effective_vertical_stress(slope, x, y)),
                "evsl": n(effective_vertical_stress_with_loads(slope, x, y)),
                "total": n(vertical_stress(slope, x, y, false)),
            }));
        }
    }
    let envelopes: Vec<Value> = slope
        .reinforcement_envelopes()
        .iter()
        .map(|e| {
            let mut o = Map::new();
            o.insert("length".into(), n(e.length));
            o.insert("s".into(), ns(&e.s));
            o.insert("fromEnd1".into(), ns(&e.from_end1));
            o.insert("tensile".into(), n(e.tensile));
            o.insert("end1".into(), n(e.end1));
            o.insert("end2".into(), n(e.end2));
            o.insert("anchored".into(), json!(e.anchored));
            put(&mut o, "development", e.development.map(|d| ns(&d)));
            let at: Vec<Value> = [-0.1, 0.0, 0.05, 0.25, 0.5, 0.75, 0.99, 1.0, 1.2]
                .iter()
                .map(|t| {
                    json!([
                        n(envelope_at(e, t * e.length)),
                        n(pullout_beyond(e, t * e.length))
                    ])
                })
                .collect();
            o.insert("at".into(), Value::Array(at));
            Value::Object(o)
        })
        .collect();
    let profiles = attempt(slope.pile_profiles(), |p| {
        Value::Array(
            p.iter()
                .map(|p| match p {
                    Some(p) => json!({ "z": ns(&p.z), "F": ns(&p.f), "Q": ns(&p.q) }),
                    None => Value::Null,
                })
                .collect(),
        )
    });
    let pile_forces = match slope.pile_profiles() {
        Ok(profiles) => Value::Array(
            slope
                .piles()
                .iter()
                .enumerate()
                .map(|(k, p)| {
                    Value::Array(
                        [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]
                            .iter()
                            .map(|t| {
                                let r = pile_force(
                                    slope,
                                    p,
                                    p.x1 + t * (p.x2 - p.x1),
                                    p.y1 + t * (p.y2 - p.y1),
                                    profiles[k].as_ref(),
                                );
                                json!([
                                    n(r.per_pile),
                                    n(r.per_metre),
                                    r.governs.as_str(),
                                    n(r.resultant_above)
                                ])
                            })
                            .collect(),
                    )
                })
                .collect(),
        ),
        Err(_) => Value::Null,
    };
    let circles = [
        ((x0 + x1) / 2.0, y1 + (y1 - y0), 1.6 * (y1 - y0)),
        (x0 + 0.4 * (x1 - x0), y1 + 0.5 * (y1 - y0), y1 - y0),
        (x0 + 0.6 * (x1 - x0), y1, 0.5 * (y1 - y0)),
    ];
    let floor = slope.composite_floor();
    let floor_json = |f: Option<&cslope_engine::model::composite::CompositeFloor>| match f {
        Some(f) => {
            json!({ "pts": pts(&f.pts), "bare": Value::Array(f.bare.iter().map(|b| ns(b)).collect()) })
        }
        None => Value::Null,
    };
    let o = slope;
    let options = json!({
        "sliceCount": n(o.slice_count()), "iterations": n(o.iterations()), "tolerance": n(o.tolerance()),
        "refinedIterations": n(o.refined_iterations()), "maxIterations": n(o.max_iterations()),
        "method": o.method().as_str(), "limits": ns(&o.limits()), "searchLimits": ns(&o.search_limits()),
        "minFailureDistance": n(o.min_failure_distance()), "fixedSlices": opt(o.fixed_slices().map(ns)),
        "customPlanesOnly": o.custom_planes_only(), "janbuCorrection": o.janbu_correction(),
        "porePressureHead": serde_json::to_value(o.pore_pressure_head()).unwrap(),
        "tensionCrackDepth": n(o.tension_crack_depth()), "tensionCrackWater": n(o.tension_crack_water()),
        "tensionCrackAngle": n(o.tension_crack_angle()), "tensionCrackAuto": o.tension_crack_auto(),
        "compositeSurfaces": o.composite_surfaces(), "compositeBase": o.composite_base(),
        "seismicHorizontal": n(o.seismic_horizontal()), "seismicVertical": n(o.seismic_vertical()),
        "partialFactors": serde_json::to_value(o.partial_factors()).unwrap(),
        "nonCircularOptimization": o.non_circular_optimization(),
        "searchMethod": serde_json::to_value(o.search_method()).unwrap(),
        "blockActiveAngle": opt(o.block_active_angle().map(|a| ns(&a))),
        "blockPassiveAngle": opt(o.block_passive_angle().map(|a| ns(&a))),
        "blockSearchObjects": Value::Array(o.block_search_objects().iter().map(|b| pts(b)).collect()),
        "minSlipArea": n(o.min_slip_area()), "groundRelief": n(o.ground_relief()), "modelArea": n(o.model_area()),
        "modelHeight": n(o.model_height()), "minSlipDepth": n(o.min_slip_depth()),
        "intersliceFunction": serde_json::to_value(o.interslice_function()).unwrap(),
        "intersliceDataPoints": pts(&o.interslice_data_points()), "mirrored": o.mirrored(),
        "splitFailureCount": o.split_failure_count(), "splitFailed": o.split_failed(),
        "danglingBoundaries": serde_json::to_value(o.dangling_boundaries()).unwrap(),
    });
    json!({
        "geometries": Value::Array(geoms.iter().map(|g| {
            let mut o = Map::new();
            o.insert("px".into(), ns(&g.px));
            o.insert("py".into(), ns(&g.py));
            o.insert("material".into(), mat(slope.material(g.material)));
            put(&mut o, "xMin", g.x_min.map(n));
            put(&mut o, "xMax", g.x_max.map(n));
            put(&mut o, "yMax", g.y_max.map(n));
            Value::Object(o)
        }).collect()),
        "externalBoundary": json!({ "x": ns(bx), "y": ns(by) }),
        "surface": line(slope.surface_line_xy()),
        "water": line(slope.water_rl_xy()),
        "hasWaterTable": slope.has_water_table(),
        "hasMaterialWaterTables": slope.has_material_water_tables(),
        "allWaterLines": Value::Array(slope.all_water_lines().into_iter().map(|l| line(Some(l))).collect()),
        "waterPerGeometry": Value::Array(geoms.iter().map(|g| line(slope.get_water_line_for_material(Some(g.material)))).collect()),
        "waterNoMaterial": line(slope.get_water_line_for_material(None)),
        "udls": Value::Array(slope.udls().iter().map(|u| json!({
            "magnitude": n(u.magnitude), "x1": n(u.x1), "x2": n(u.x2), "length": n(u.length), "color": u.color,
            "direction": serde_json::to_value(u.direction).unwrap(),
            "excessPorePressure": serde_json::to_value(&u.excess_pore_pressure).unwrap(),
        })).collect()),
        "lineLoads": Value::Array(slope.line_loads().iter().map(|l| {
            let mut o = Map::new();
            o.insert("magnitude".into(), n(l.magnitude));
            o.insert("x".into(), n(l.x));
            o.insert("angle".into(), n(l.angle));
            put(&mut o, "y", l.y.map(n));
            o.insert("color".into(), json!(l.color));
            Value::Object(o)
        }).collect()),
        "reinforcements": serde_json::to_value(slope.reinforcements()).unwrap(),
        "piles": serde_json::to_value(slope.piles()).unwrap(),
        "envelopes": envelopes,
        "profiles": profiles,
        "pileForces": pile_forces,
        "pileDirections": Value::Array(slope.piles().iter().map(|p| json!([
            ns(&pile_force_direction(p, 0.8, -0.6)), ns(&pile_force_direction(p, 0.6, 0.8)), ns(&pile_force_direction(p, 1.0, 0.0))
        ])).collect()),
        "options": options,
        "compositeFloor": floor_json(floor),
        "floorFollowingBase": floor_json(composite_floor(bx, by, geoms, slope.materials(), true).as_ref()),
        "floorY": match floor {
            Some(f) => Value::Array(xs.iter().map(|&x| json!([n(floor_y_at(f, x, Side::Left)), n(floor_y_at(f, x, Side::Right))])).collect()),
            None => Value::Null,
        },
        "toModelX": Value::Array(xs.iter().map(|&x| attempt(slope.to_model_x(x), n)).collect()),
        "individualPlanes": Value::Array(slope.individual_planes().iter().map(plane_json).collect()),
        "waternet": opt(slope.waternet().map(|w| serde_json::to_value(w).unwrap())),
        "probe": probe,
        "ground": Value::Array(xs.iter().map(|&x| n(slope.get_external_y_intersection(x).unwrap())).collect()),
        "waterY": Value::Array(xs.iter().map(|&x| attempt(slope.get_water_y_intersection(x), n)).collect()),
        "circles": Value::Array(circles.iter().map(|&(cx, cy, r)| json!({
            "crossings": pts(&slope.get_circle_external_intersection(cx, cy, r).unwrap()),
            "ends": match select_entry_exit(slope, cx, cy, r).unwrap() { Some((a, b)) => json!([pt(a), pt(b)]), None => Value::Null },
            "leaves": circle_leaves_model(slope, cx, cy, r, cx - r, cx + r),
            "bare": opt(floor.map(|f| json!(circle_below_bare_base(f, cx, cy, r, cx - r, cx + r, 1e-6)))),
        })).collect()),
        "earlierStage": match slope.earlier_stage() { Some(s) if depth < 2 => snap(s, depth + 1), _ => Value::Null },
        "drawdownBefore": match slope.drawdown_before() { Some(s) if depth < 2 => snap(s, depth + 1), _ => Value::Null },
    })
}

/// Made-up factors of safety for the refined and local generation (as the
/// exporter's `fakeFos`: a hash of the plane's key).
pub fn fake_fos(key: &str, salt: u64) -> f64 {
    let mut h = salt;
    for c in key.encode_utf16() {
        h = (h * 31 + c as u64) % 1_000_003;
    }
    1.0 + (h % 997) as f64 / 997.0
}

fn num_of(v: &Value) -> f64 {
    as_num(v).expect("a number")
}

fn pt_of(v: &Value) -> [f64; 2] {
    [num_of(&v[0]), num_of(&v[1])]
}

/// A plane of the fixture (planeJson).
pub fn plane_of(v: &Value) -> SearchPlane {
    SearchPlane {
        lc: pt_of(&v["lc"]),
        rc: pt_of(&v["rc"]),
        cx: num_of(&v["cx"]),
        cy: num_of(&v["cy"]),
        radius: num_of(&v["radius"]),
        fos: v.get("fos").and_then(as_num),
        tangent_to: v.get("tangentTo").map(|t| t.as_u64().unwrap() as usize),
        unchecked: v.get("unchecked").map(|t| t.as_bool().unwrap()),
        points: v
            .get("points")
            .map(|p| p.as_array().unwrap().iter().map(pt_of).collect()),
        ..Default::default()
    }
}

fn ranked(planes: &[SearchPlane], salt: u64, offset: f64) -> Vec<SearchPlane> {
    planes
        .iter()
        .map(|p| SearchPlane {
            fos: Some(offset + fake_fos(&plane_key(p), salt)),
            ..p.clone()
        })
        .collect()
}

/// Planes of a key-aligned comparison (`compare_planes`).
#[derive(Default, Debug)]
pub struct PlaneMatch {
    /// Planes only one engine generated (a near-tie decided by rounding).
    pub only_rust: Vec<Value>,
    pub only_ts: Vec<Value>,
    /// Planes with equal keys whose values differ by more than `rel` (but
    /// within `near_tie_rel`): bisection results at a tangency.
    pub near_tie_values: Vec<String>,
    /// Those planes, (Rust, TypeScript).
    pub near_tie_planes: Vec<(Value, Value)>,
    /// The same plane (all values within `rel`) with another key: a value
    /// on a rounding half of the key (`Math.round` of x.5 decided by the
    /// last bit).
    pub key_ties: Vec<String>,
}

/// The plane without its key, for comparing planes whose keys differ.
fn without_key(v: &Value) -> Value {
    let mut v = v.clone();
    v.as_object_mut().unwrap().remove("key");
    v
}

/// Key-aligned comparison of two plane lists (a near-tie decided by rounding
/// adds, drops or moves a plane; the lists are aligned again after it).
/// Planes with equal keys are compared within `rel`, or else, counted as a
/// near-tie value, within `near_tie_rel`.
pub fn compare_planes(
    rust: &Value,
    ts: &Value,
    path: &str,
    rel: f64,
    near_tie_rel: f64,
    stats: &mut Stats,
) -> PlaneMatch {
    let a = rust.as_array().unwrap();
    let b = ts.as_array().unwrap();
    let key = |v: &Value| v["key"].as_str().unwrap().to_string();
    let (mut i, mut j) = (0, 0);
    let mut m = PlaneMatch::default();
    while i < a.len() && j < b.len() {
        if key(&a[i]) == key(&b[j]) {
            let mut strict = Stats::default();
            let at = format!("{path}[{j}]");
            compare(&a[i], &b[j], &at, rel, &mut strict);
            if strict.errors.is_empty() {
                stats.numbers += strict.numbers;
                stats.differing += strict.differing;
                if strict.max_rel > stats.max_rel {
                    stats.max_rel = strict.max_rel;
                    stats.max_rel_at = strict.max_rel_at;
                }
            } else {
                m.near_tie_values
                    .push(format!("{at}: {}", strict.errors.join("; ")));
                m.near_tie_planes.push((a[i].clone(), b[j].clone()));
                // only a circle tangent to a material interface is a near-tie
                if b[j].get("tangentTo").is_none() || a[i].get("tangentTo").is_none() {
                    stats.errors.push(format!(
                        "{at}: values differ on a plane not tangent to an interface: {}",
                        strict.errors.join("; ")
                    ));
                }
                // relative to the circle's size
                let radius = as_num(&b[j]["radius"]).unwrap_or(1.0);
                let mut loose = Stats::default();
                compare_scaled(
                    &a[i],
                    &b[j],
                    &at,
                    near_tie_rel,
                    cslope_engine::js::math::max(1.0, radius),
                    &mut loose,
                );
                stats.errors.extend(loose.errors);
            }
            i += 1;
            j += 1;
            continue;
        }
        // the nearest point where the lists agree again
        let mut found = None;
        'search: for d in 1..64 {
            for k in 0..=d {
                let (ia, jb) = (i + k, j + d - k);
                if ia < a.len() && jb < b.len() && key(&a[ia]) == key(&b[jb]) {
                    found = Some((ia, jb));
                    break 'search;
                }
            }
        }
        let (ia, jb) = found.unwrap_or((a.len(), b.len()));
        // the same planes with keys rounded the other way at a half
        let same = ia - i == jb - j
            && (0..ia - i).all(|k| {
                let mut st = Stats::default();
                compare(
                    &without_key(&a[i + k]),
                    &without_key(&b[j + k]),
                    path,
                    rel,
                    &mut st,
                );
                st.errors.is_empty()
            });
        if same {
            for k in 0..ia - i {
                m.key_ties.push(format!(
                    "{path}[{}]: {} vs {}",
                    j + k,
                    key(&a[i + k]),
                    key(&b[j + k])
                ));
            }
        } else {
            m.only_rust.extend(a[i..ia].iter().cloned());
            m.only_ts.extend(b[j..jb].iter().cloned());
        }
        i = ia;
        j = jb;
    }
    m.only_rust.extend(a[i..].iter().cloned());
    m.only_ts.extend(b[j..].iter().cloned());
    m
}

// ── Comparison ────────────────────────────────────────────────────

/// Largest differences seen in a comparison.
#[derive(Default, Debug)]
pub struct Stats {
    pub numbers: usize,
    pub differing: usize,
    pub max_rel: f64,
    pub max_rel_at: String,
    pub errors: Vec<String>,
}

fn as_num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(x) => x.as_f64(),
        Value::String(s) if s == "NaN" => Some(f64::NAN),
        Value::String(s) if s == "Infinity" => Some(f64::INFINITY),
        Value::String(s) if s == "-Infinity" => Some(f64::NEG_INFINITY),
        _ => None,
    }
}

/// Compares `rust` with `ts`: same structure, strings and booleans exact,
/// numbers within `rel` of max(|a|, |b|, 1) (lengths in metres, so 1e-9 m
/// next to 0). Differences go to `stats.errors` (the first 20).
pub fn compare(rust: &Value, ts: &Value, path: &str, rel: f64, stats: &mut Stats) {
    compare_scaled(rust, ts, path, rel, 1.0, stats)
}

/// `compare` with tolerance `rel` × max(|a|, |b|, `floor`).
pub fn compare_scaled(
    rust: &Value,
    ts: &Value,
    path: &str,
    rel: f64,
    floor: f64,
    stats: &mut Stats,
) {
    let fail = |msg: String, stats: &mut Stats| {
        if stats.errors.len() < 20 {
            stats.errors.push(format!("{path}: {msg}"));
        }
    };
    match (as_num(rust), as_num(ts)) {
        (Some(a), Some(b)) => {
            stats.numbers += 1;
            if a.is_nan() || b.is_nan() {
                if !(a.is_nan() && b.is_nan()) {
                    fail(format!("{a} vs {b}"), stats);
                }
                return;
            }
            if a == b {
                return;
            }
            stats.differing += 1;
            let d = (a - b).abs();
            let m =
                cslope_engine::js::math::max(cslope_engine::js::math::max(a.abs(), b.abs()), floor);
            let r = d / m;
            if r > stats.max_rel {
                stats.max_rel = r;
                stats.max_rel_at = format!("{path}: {a} vs {b}");
            }
            if r > rel {
                fail(format!("{a} vs {b} (rel {r:e})"), stats);
            }
            return;
        }
        (None, None) => {}
        _ => {
            fail(format!("{rust} vs {ts}"), stats);
            return;
        }
    }
    match (rust, ts) {
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                fail(format!("length {} vs {}", a.len(), b.len()), stats);
            }
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                compare_scaled(x, y, &format!("{path}[{i}]"), rel, floor, stats);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            for (k, x) in a {
                match b.get(k) {
                    Some(y) => compare_scaled(x, y, &format!("{path}.{k}"), rel, floor, stats),
                    None => fail(format!("{k} only in Rust: {x}"), stats),
                }
            }
            for (k, y) in b {
                if !a.contains_key(k) {
                    fail(format!("{k} only in TypeScript: {y}"), stats);
                }
            }
        }
        (a, b) => {
            if a != b {
                fail(format!("{a} vs {b}"), stats);
            }
        }
    }
}

// ── Helpers of the ported unit tests ──────────────────────────────

/// A definition from JSON (as the TypeScript tests write them).
pub fn def(v: Value) -> cslope_engine::types::SlopeDefinition {
    serde_json::from_value(v).expect("a slope definition")
}

/// A material model from JSON.
pub fn model(v: Value) -> cslope_engine::types::MaterialModel {
    serde_json::from_value(v).expect("a material model")
}

/// verification/cases.ts `mc`.
pub fn mc(c: f64, phi: f64, gamma: f64) -> Value {
    json!({ "kind": "mohr-coulomb", "unitWeight": gamma, "cohesion": c, "frictionAngle": phi })
}

/// verification/cases.ts `su`.
pub fn su(s: f64, gamma: f64) -> Value {
    json!({ "kind": "undrained", "unitWeight": gamma, "undrainedShearStrength": s, "suRefDepth": 0, "suRateOfChange": 0 })
}

/// verification/cases.ts `layered`: a slope from a ground line, a base
/// elevation and horizontal layers (name, top y or None for the top layer,
/// model), merged with `extra`.
pub fn layered(
    ground: &[[f64; 2]],
    base_y: f64,
    layers: &[(&str, Option<f64>, Value)],
    extra: Value,
) -> Value {
    let ground_y = |x: f64| {
        for w in ground.windows(2) {
            let ([a, ay], [b, by]) = (w[0], w[1]);
            if x >= a && x <= b && b > a {
                return ay + ((x - a) / (b - a)) * (by - ay);
            }
        }
        f64::NEG_INFINITY
    };
    let xs: Vec<f64> = ground.iter().map(|p| p[0]).collect();
    let x0 = xs.iter().cloned().fold(f64::INFINITY, f64::min);
    let x1 = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let assignments: Vec<Value> = layers
        .iter()
        .enumerate()
        .map(|(i, (name, top, _))| {
            let bottom = if i + 1 < layers.len() {
                layers[i + 1].1.unwrap()
            } else {
                base_y
            };
            let y = match top {
                None => bottom + 0.05,
                Some(t) => (t + bottom) / 2.0,
            };
            let mut x = x0;
            for k in 2..=200 {
                let xx = x0 + ((x1 - x0) * k as f64) / 200.0;
                if ground_y(xx) > y + 0.01 {
                    x = xx;
                    break;
                }
            }
            json!({ "point": [x, y], "materialName": name })
        })
        .collect();
    let mut coords = vec![json!([x0, base_y])];
    coords.extend(ground.iter().map(|p| json!(p)));
    coords.push(json!([x1, base_y]));
    let mut out = json!({
        "coordinates": coords,
        "materials": layers.iter().map(|(name, _, m)| json!({
            "name": name, "unitWeight": m["unitWeight"], "frictionAngle": 0, "cohesion": 0, "model": m,
        })).collect::<Vec<_>>(),
        "materialBoundaries": layers[1..].iter().map(|(_, top, _)| json!({
            "coordinates": [[x0 - 1.0, top.unwrap()], [x1 + 1.0, top.unwrap()]], "materialName": "",
        })).collect::<Vec<_>>(),
        "regionAssignments": assignments,
    });
    if let Value::Object(extra) = extra {
        for (k, v) in extra {
            out[k] = v;
        }
    }
    out
}

/// property-helpers.ts `rng` (mulberry32).
pub fn rng(seed: u32) -> impl FnMut() -> f64 {
    let mut a = seed;
    move || {
        a = a.wrapping_add(0x6d2b_79f5);
        let mut t = a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }
}

/// property-helpers.ts `uniform`.
pub fn uniform(r: &mut impl FnMut() -> f64, lo: f64, hi: f64) -> f64 {
    lo + (hi - lo) * r()
}

/// A slope with one Mohr-Coulomb material (`new Material({...})`, added
/// before the boundary).
pub fn slope_with(
    boundary: &[[f64; 2]],
    name: &str,
    unit_weight: f64,
    cohesion: f64,
    friction_angle: f64,
) -> Slope {
    let mut s = Slope::new();
    s.add_material(
        Material::new(cslope_engine::types::MaterialParams {
            name: Some(name.into()),
            unit_weight: Some(unit_weight),
            cohesion: Some(cohesion),
            friction_angle: Some(friction_angle),
            ..Default::default()
        })
        .unwrap(),
    );
    s.set_external_boundary(boundary).unwrap();
    s
}

/// A material from a model.
pub fn material(name: &str, m: Value) -> Material {
    Material::new(cslope_engine::types::MaterialParams {
        name: Some(name.into()),
        model: Some(model(m)),
        ..Default::default()
    })
    .unwrap()
}

/// vitest `toBeCloseTo(b, digits)`: |a − b| < 10^−digits / 2.
#[track_caller]
pub fn close(a: f64, b: f64, digits: i32) {
    assert!(
        (a - b).abs() < 10f64.powi(-digits) / 2.0,
        "{a} vs {b} ({digits} digits)"
    );
}

/// The canonical definition of a verification problem
/// (golden/verification.json, `toCanonicalSlopeDefinition` applied, so
/// build it directly).
pub fn problem(id: &str) -> cslope_engine::types::SlopeDefinition {
    let cases: Vec<Value> = crate::common::verification_cases();
    let c = cases.iter().find(|c| c["id"] == id).expect("the problem");
    cslope_engine::model::canonical::to_canonical_slope_definition(
        &def(c["definition"].clone()),
        None,
    )
    .expect("canonical")
}
