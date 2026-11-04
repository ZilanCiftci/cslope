//! Shared code of the slice and solver tests: slices and planes as the JSON
//! the TypeScript fixtures wrote, and a comparison that records
//! the largest relative difference per category.
#![allow(dead_code, clippy::disallowed_methods)]

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::slope::{AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::types::{MaterialModel, Slice, SlopeDefinition};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

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

pub fn on(x: Option<f64>) -> Value {
    x.map_or(Value::Null, n)
}

pub fn pt(p: [f64; 2]) -> Value {
    json!([n(p[0]), n(p[1])])
}

pub fn as_num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(x) => x.as_f64(),
        Value::String(s) if s == "NaN" => Some(f64::NAN),
        Value::String(s) if s == "Infinity" => Some(f64::INFINITY),
        Value::String(s) if s == "-Infinity" => Some(f64::NEG_INFINITY),
        _ => None,
    }
}

pub fn num(v: &Value) -> f64 {
    as_num(v).unwrap_or_else(|| panic!("not a number: {v}"))
}

pub fn pt_of(v: &Value) -> [f64; 2] {
    [num(&v[0]), num(&v[1])]
}

fn put(o: &mut Map<String, Value>, k: &str, v: Option<Value>) {
    if let Some(v) = v {
        o.insert(k.to_string(), v);
    }
}

/// A slice as the fixture writes it (`{ ...s, baseMaterial: name }`).
pub fn slice_json(s: &Slice, slope: &Slope) -> Value {
    let mut o = Map::new();
    for (k, v) in [
        ("x", s.x),
        ("xLeft", s.x_left),
        ("xRight", s.x_right),
        ("y0Top", s.y0_top),
        ("y1Top", s.y1_top),
        ("yTop", s.y_top),
        ("y0Bottom", s.y0_bottom),
        ("y1Bottom", s.y1_bottom),
        ("yBottom", s.y_bottom),
        ("width", s.width),
        ("height", s.height),
        ("area", s.area),
        ("alpha", s.alpha),
        ("baseLength", s.base_length),
        ("weight", s.weight),
        ("dx", s.dx),
        ("e", s.e),
        ("R", s.r),
        ("udl", s.udl),
        ("ll", s.ll),
        ("cohesion", s.cohesion),
        ("cohesionUndrained", s.cohesion_undrained),
        ("frictionAngle", s.friction_angle),
        ("phi", s.phi),
        ("U", s.u),
    ] {
        o.insert(k.into(), n(v));
    }
    for (k, v) in [
        ("yCentroid", s.y_centroid),
        ("normalArm", s.normal_arm),
        ("cohesionUndrainedPart", s.cohesion_undrained_part),
        ("suction", s.suction),
        ("suctionStrength", s.suction_strength),
        ("uWater", s.u_water),
        ("waterLoad", s.water_load),
        ("hForce", s.h_force),
        ("extraMoment", s.extra_moment),
    ] {
        put(&mut o, k, v.map(n));
    }
    for (k, v) in [
        ("circular", s.circular),
        ("isCombined", s.is_combined),
        ("skipSurface", s.skip_surface),
        ("impenetrable", s.impenetrable),
        ("undrainedGoverns", s.undrained_governs),
    ] {
        put(&mut o, k, v.map(|b| json!(b)));
    }
    o.insert("isValid".into(), json!(s.is_valid));
    put(
        &mut o,
        "baseMaterial",
        s.base_material
            .map(|id| json!(slope.material(id).name.clone())),
    );
    put(
        &mut o,
        "strengthModel",
        s.strength_model
            .as_ref()
            .map(|m| serde_json::to_value(&**m).unwrap()),
    );
    put(
        &mut o,
        "hoekBrown",
        s.hoek_brown.map(|h| serde_json::to_value(h).unwrap()),
    );
    put(
        &mut o,
        "shearNormal",
        s.shear_normal
            .as_ref()
            .map(|m| serde_json::to_value(MaterialModel::ShearNormal((**m).clone())).unwrap()),
    );
    let arr = |a: [f64; 3]| json!([n(a[0]), n(a[1]), n(a[2])]);
    put(
        &mut o,
        "reinforcementActive",
        s.reinforcement_active.map(arr),
    );
    put(
        &mut o,
        "reinforcementPassive",
        s.reinforcement_passive.map(arr),
    );
    put(
        &mut o,
        "reinforcementForces",
        s.reinforcement_forces
            .as_ref()
            .map(|f| serde_json::to_value(f).unwrap()),
    );
    Value::Object(o)
}

/// The plane of the fixture (planeJson: geometry and flags).
pub fn plane_of(v: &Value) -> SearchPlane {
    SearchPlane {
        lc: pt_of(&v["lc"]),
        rc: pt_of(&v["rc"]),
        cx: num(&v["cx"]),
        cy: num(&v["cy"]),
        radius: num(&v["radius"]),
        unchecked: v.get("unchecked").map(|t| t.as_bool().unwrap()),
        optimised: v.get("optimised").map(|t| t.as_bool().unwrap()),
        points: v
            .get("points")
            .map(|p| p.as_array().unwrap().iter().map(pt_of).collect()),
        ..Default::default()
    }
}

/// buildSlope(def) then updateAnalysisOptions(options).
pub fn build(def: &Value, options: &Value) -> cslope_engine::error::Result<Slope> {
    let def: SlopeDefinition = serde_json::from_value(def.clone()).expect("a slope definition");
    let mut slope = build_slope(&def)?;
    let patch: AnalysisOptionsPatch =
        serde_json::from_value(options.clone()).expect("analysis options");
    slope.update_analysis_options(&patch)?;
    Ok(slope)
}

/// verification/cases.ts `verificationOptions`: the method, the
/// verification search settings (and the longer search for non-circular
/// optimisation), then the check's own options.
pub fn verification_options(method: &str, options: Value) -> Value {
    let mut o = json!({ "method": method, "slices": 50, "iterations": 1000, "refinedIterations": 1000, "tolerance": 0.001 });
    if options["nonCircularOptimization"] == json!(true) {
        for (k, v) in [("iterations", 4000), ("refinedIterations", 2000)] {
            o[k] = json!(v);
        }
        o["tolerance"] = json!(0.001);
    }
    if let Value::Object(m) = options {
        for (k, v) in m {
            o[k] = v;
        }
    }
    o
}

/// verification/cases.ts `runVerification`: the minimum F and the analysed
/// slope of a definition (canonicalised here) by the method with the
/// verification options.
pub fn run_verification(def: Value, method: &str, options: Value) -> (Option<f64>, Slope) {
    let def: SlopeDefinition = serde_json::from_value(def).expect("a slope definition");
    let canonical =
        cslope_engine::model::canonical::to_canonical_slope_definition(&def, None).unwrap();
    let mut slope = build_slope(&canonical).unwrap();
    let patch: AnalysisOptionsPatch =
        serde_json::from_value(verification_options(method, options)).expect("analysis options");
    slope.update_analysis_options(&patch).unwrap();
    let fos = cslope_engine::model::solvers::analyse_slope(
        &mut slope,
        &mut cslope_engine::api::ctx::RunCtx::default(),
    )
    .unwrap();
    (fos, slope)
}

/// The largest relative difference and the failures, per category.
#[derive(Default, Debug)]
pub struct Diffs {
    pub categories: BTreeMap<String, Category>,
}

#[derive(Default, Debug, Clone)]
pub struct Category {
    pub numbers: usize,
    pub differing: usize,
    pub max_rel: f64,
    pub max_at: String,
    pub failures: Vec<String>,
    pub failure_count: usize,
}

impl Diffs {
    /// Compares `rust` with `ts` (same structure; strings and booleans exact;
    /// numbers within `rel` of max(|a|, |b|, `floor`)) under `category`.
    pub fn compare(
        &mut self,
        category: &str,
        rust: &Value,
        ts: &Value,
        path: &str,
        rel: f64,
        floor: f64,
    ) {
        let c = self.categories.entry(category.to_string()).or_default();
        compare_into(c, rust, ts, path, rel, floor);
    }

    pub fn fail(&mut self, category: &str, msg: String) {
        let c = self.categories.entry(category.to_string()).or_default();
        c.failure_count += 1;
        if c.failures.len() < 40 {
            c.failures.push(msg);
        }
    }

    /// Counts a case that is not a failure (a note in the report).
    pub fn fail_quiet(&mut self, category: &str) {
        self.categories
            .entry(category.to_string())
            .or_default()
            .numbers += 1;
    }

    /// The summary (printed with --nocapture) and whether every category passed.
    pub fn report(&self) -> (String, bool) {
        let mut out = String::new();
        let mut ok = true;
        for (k, c) in &self.categories {
            out.push_str(&format!(
                "{k}: {} numbers, {} differing, max rel {:.3e} {}; {} failures\n",
                c.numbers, c.differing, c.max_rel, c.max_at, c.failure_count
            ));
            for f in &c.failures {
                out.push_str(&format!("    {f}\n"));
            }
            ok &= c.failure_count == 0;
        }
        (out, ok)
    }
}

fn compare_into(c: &mut Category, rust: &Value, ts: &Value, path: &str, rel: f64, floor: f64) {
    let fail = |c: &mut Category, msg: String| {
        c.failure_count += 1;
        if c.failures.len() < 40 {
            c.failures.push(format!("{path}: {msg}"));
        }
    };
    match (as_num(rust), as_num(ts)) {
        (Some(a), Some(b)) => {
            c.numbers += 1;
            if a.is_nan() || b.is_nan() {
                if !(a.is_nan() && b.is_nan()) {
                    fail(c, format!("{a} vs {b}"));
                }
                return;
            }
            if a == b {
                return;
            }
            c.differing += 1;
            let d = (a - b).abs();
            let m = a.abs().max(b.abs()).max(floor);
            let r = d / m;
            if r > c.max_rel {
                c.max_rel = r;
                c.max_at = format!("{path}: {a} vs {b}");
            }
            if r > rel {
                fail(c, format!("{a} vs {b} (rel {r:e})"));
            }
            return;
        }
        (None, None) => {}
        _ => {
            fail(c, format!("{rust} vs {ts}"));
            return;
        }
    }
    match (rust, ts) {
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                fail(c, format!("length {} vs {}", a.len(), b.len()));
            }
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                compare_into(c, x, y, &format!("{path}[{i}]"), rel, floor);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            // An optional number set on one side only, at rounding level on
            // it (|v| ≤ 1e-12, e.g. free water 1e-16 deep where a water
            // line meets the ground), is the other side's absent value.
            let negligible = |v: &Value| as_num(v).is_some_and(|x| x.abs() <= 1e-12);
            for (k, x) in a {
                match b.get(k) {
                    Some(y) => compare_into(c, x, y, &format!("{path}.{k}"), rel, floor),
                    None if negligible(x) => c.numbers += 1,
                    None => fail(c, format!("{k} only in Rust: {x}")),
                }
            }
            for (k, y) in b {
                if !a.contains_key(k) && !negligible(y) {
                    fail(c, format!("{k} only in TypeScript: {y}"));
                }
            }
        }
        (a, b) => {
            if a != b {
                fail(c, format!("{a} vs {b}"));
            }
        }
    }
}
