//! Reliability (model/reliability.rs): reliability-edge.test.ts ported
//! (fixed circles, fast), and serial = rayon for Monte Carlo and the Taylor
//! series. (The differential tests against the TypeScript engine's fixtures were removed with it at the cutover, PORTING.md.)
#![allow(clippy::disallowed_methods)]

mod common;
mod solvers_support;

use cslope_engine::api::ctx::{ProgressEvent, RunCtx};
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::reliability::{
    analyse_reliability, lognormal_beta, normal_cdf, reliability_surface_to_model_space,
    CriticalSurface, RandomVariable, ReliabilityOptions, ReliabilityResult,
};
use cslope_engine::model::slope::AnalysisOptionsPatch;
use cslope_engine::types::SlopeDefinition;
use serde_json::{json, Value};
use std::ops::ControlFlow;

fn def_of(v: &Value) -> SlopeDefinition {
    serde_json::from_value(v.clone()).unwrap()
}

fn run(def: &Value, options: &Value, vars: Value, ro: Value) -> Result<ReliabilityResult, String> {
    run_ctx(def, options, vars, ro, &mut RunCtx::default())
}

fn run_ctx(
    def: &Value,
    options: &Value,
    vars: Value,
    ro: Value,
    ctx: &mut RunCtx,
) -> Result<ReliabilityResult, String> {
    let d = def_of(def);
    let o: AnalysisOptionsPatch = serde_json::from_value(options.clone()).unwrap();
    let v: Vec<RandomVariable> = serde_json::from_value(vars).unwrap();
    let r: ReliabilityOptions = serde_json::from_value(ro).unwrap();
    analyse_reliability(&d, &o, &v, &r, ctx).map_err(|e| e.message)
}

// ── reliability-edge.test.ts ──────────────────────────────────────

fn options() -> Value {
    json!({ "slices": 30, "tolerance": 1e-8, "maxIterations": 100, "method": "Bishop" })
}

fn slope(top: Value, bottom: Option<Value>) -> Value {
    let mut def = json!({
        "coordinates": [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]],
        "materials": [{ "name": "Top", "unitWeight": top["unitWeight"], "cohesion": 0, "frictionAngle": 0, "model": top }],
        "customSearchPlanes": [{ "cx": 22, "cy": 18, "radius": 18.5 }],
        "customPlanesOnly": true,
    });
    if let Some(b) = bottom {
        def["materials"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "name": "Bottom", "unitWeight": b["unitWeight"], "cohesion": 0, "frictionAngle": 0, "model": b }));
        def["materialBoundaries"] =
            json!([{ "coordinates": [[0, 4], [40, 4]], "materialName": "Bottom" }]);
        def["regionAssignments"] = json!([
            { "point": [1, 7], "materialName": "Top" },
            { "point": [1, -5], "materialName": "Bottom" },
        ]);
    }
    def
}

fn su(s: f64) -> Value {
    json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": s })
}

fn clay() -> Value {
    slope(su(40.0), None)
}

fn sv(extra: Value) -> Value {
    let mut v = json!({ "material": 0, "field": "undrainedShearStrength", "sd": 8 });
    for (k, x) in extra.as_object().unwrap() {
        v[k] = x.clone();
    }
    v
}

fn close(a: f64, b: f64, digits: i32) -> bool {
    (a - b).abs() < 10f64.powi(-digits) / 2.0
}

#[test]
fn input_checks() {
    let err = |vars: Value, ro: Value| run(&clay(), &options(), vars, ro).unwrap_err();
    assert!(err(json!([]), json!({ "method": "taylor" })).contains("at least one random variable"));
    assert!(err(
        json!([sv(json!({ "sd": -1 }))]),
        json!({ "method": "taylor" })
    )
    .contains("≥ 0"));
    assert!(err(
        json!([sv(json!({ "sd": "NaN" }))]),
        json!({ "method": "taylor" })
    )
    .contains("≥ 0"));
    assert!(err(
        json!([sv(json!({ "material": 3 }))]),
        json!({ "method": "taylor" })
    )
    .contains("no material 4"));
    let mut missing = clay();
    missing["customSearchPlanes"] = json!([{ "cx": 22, "cy": 60, "radius": 5 }]);
    assert!(run(
        &missing,
        &options(),
        json!([sv(json!({}))]),
        json!({ "method": "taylor" })
    )
    .unwrap_err()
    .contains("No valid slip surface"));
}

#[test]
fn invalid_correlations_and_a_matrix_not_positive_definite() {
    let two = slope(su(40.0), Some(su(50.0)));
    let v = json!([sv(json!({})), { "material": 1, "field": "undrainedShearStrength", "sd": 5 }]);
    for c in [
        json!({ "a": 0, "b": 0, "rho": 0.5 }),
        json!({ "a": 0, "b": 2, "rho": 0.5 }),
        json!({ "a": -1, "b": 1, "rho": 0.5 }),
        json!({ "a": 0, "b": 1, "rho": 1 }),
        json!({ "a": 0, "b": 1, "rho": "NaN" }),
    ] {
        let e = run(
            &two,
            &options(),
            v.clone(),
            json!({ "method": "taylor", "correlations": [c] }),
        )
        .unwrap_err();
        assert!(e.contains("|ρ| < 1"), "{e}");
    }
    let mut three = v.as_array().unwrap().clone();
    three.push(json!({ "material": 0, "field": "unitWeight", "sd": 1 }));
    let e = run(
        &two,
        &options(),
        Value::Array(three),
        json!({ "method": "monte-carlo", "samples": 10, "correlations": [
            { "a": 0, "b": 1, "rho": 0.9 }, { "a": 0, "b": 2, "rho": 0.9 }, { "a": 1, "b": 2, "rho": -0.9 }] }),
    )
    .unwrap_err();
    assert!(e.contains("not positive definite"));
}

#[test]
fn sigma_zero_taylor_and_monte_carlo() {
    let r = run(
        &clay(),
        &options(),
        json!([sv(json!({ "sd": 0 }))]),
        json!({ "method": "taylor", "search": false }),
    )
    .unwrap();
    assert_eq!(r.sd_fos, 0.0);
    assert_eq!(r.cov, 0.0);
    assert!(close(r.terms.as_ref().unwrap()[0].f_plus, r.fos, 12));
    assert_eq!(r.beta_lognormal, f64::INFINITY);
    assert_eq!(r.beta_normal, f64::INFINITY);
    assert_eq!(r.pf_lognormal, 0.0);
    let weak = run(
        &slope(su(10.0), None),
        &options(),
        json!([sv(json!({ "sd": 0 }))]),
        json!({ "method": "taylor", "search": false }),
    )
    .unwrap();
    assert!(weak.fos < 1.0);
    assert_eq!(weak.beta_normal, f64::NEG_INFINITY);
    assert_eq!(weak.beta_lognormal, f64::NEG_INFINITY);
    assert_eq!(weak.pf_lognormal, 1.0);
    let m = run(
        &clay(),
        &options(),
        json!([sv(json!({ "sd": 0 }))]),
        json!({ "method": "monte-carlo", "samples": 12 }),
    )
    .unwrap();
    let samples = m.samples.as_ref().unwrap();
    assert_eq!(samples.len(), 12);
    for &f in samples {
        assert!(close(f, m.fos, 9));
    }
    assert!(close(m.sd_fos, 0.0, 9));
    assert_eq!(m.pf, Some(0.0));
    assert_eq!(m.failed, 0);
}

#[test]
fn monte_carlo_sampling_count_progress_and_seed() {
    let a = run(
        &clay(),
        &options(),
        json!([sv(json!({}))]),
        json!({ "method": "monte-carlo", "samples": 3, "seed": 5 }),
    )
    .unwrap();
    assert_eq!(a.samples.as_ref().unwrap().len(), 10);
    let mut progress: Vec<f64> = Vec::new();
    let mut on = |e: ProgressEvent| {
        if let ProgressEvent::Reliability(p) = e {
            progress.push(p);
        }
        ControlFlow::Continue(())
    };
    let mut ctx = RunCtx {
        progress: Some(&mut on),
        ..RunCtx::default()
    };
    let b = run_ctx(
        &clay(),
        &options(),
        json!([sv(json!({}))]),
        json!({ "method": "monte-carlo", "samples": 100, "seed": 5 }),
        &mut ctx,
    )
    .unwrap();
    assert_eq!(
        &b.samples.as_ref().unwrap()[..10],
        &a.samples.as_ref().unwrap()[..]
    );
    assert_eq!(progress, vec![0.5, 1.0]);
    let c = run(
        &clay(),
        &options(),
        json!([sv(json!({}))]),
        json!({ "method": "monte-carlo", "samples": 10, "seed": 6 }),
    )
    .unwrap();
    assert_ne!(c.samples, a.samples);
}

#[test]
fn monte_carlo_truncation_clamping_and_failures() {
    let r = run(
        &clay(),
        &options(),
        json!([sv(json!({ "sd": 30, "min": 35, "max": 45 }))]),
        json!({ "method": "monte-carlo", "samples": 60 }),
    )
    .unwrap();
    let per_su = r.fos / 40.0;
    for &f in r.samples.as_ref().unwrap() {
        assert!(f >= per_su * 35.0 - 1e-9 && f <= per_su * 45.0 + 1e-9);
    }
    // Bounds far out in the tail: every sample is clamped to min.
    let r = run(
        &clay(),
        &options(),
        json!([sv(json!({ "sd": 1, "min": 80, "max": 90 }))]),
        json!({ "method": "monte-carlo", "samples": 10 }),
    )
    .unwrap();
    for &f in r.samples.as_ref().unwrap() {
        assert!(close(f, (r.fos / 40.0) * 80.0, 6));
    }
    let r = run(
        &slope(su(5.0), None),
        &options(),
        json!([sv(json!({ "sd": 20 }))]),
        json!({ "method": "monte-carlo", "samples": 80 }),
    )
    .unwrap();
    for &f in r.samples.as_ref().unwrap() {
        assert!(f >= 0.0);
    }
    let e = run(
        &clay(),
        &options(),
        json!([sv(json!({ "sd": 1, "min": -1e6, "max": -1 }))]),
        json!({ "method": "monte-carlo", "samples": 10 }),
    )
    .unwrap_err();
    assert!(
        e.starts_with("Too few Monte Carlo samples gave an F: 0 of 10 (at least 2 are needed)."),
        "{e}"
    );
    assert!(!e.contains("FOS"), "{e}");
}

#[test]
fn lognormal_samples_and_mean_zero_as_normal() {
    let logn = run(
        &clay(),
        &options(),
        json!([sv(json!({ "sd": 40, "distribution": "lognormal" }))]),
        json!({ "method": "monte-carlo", "samples": 100 }),
    )
    .unwrap();
    for &f in logn.samples.as_ref().unwrap() {
        assert!(f > 0.0);
    }
    assert!(logn.mean_fos / logn.fos > 0.75 && logn.mean_fos / logn.fos < 1.25);
    let rising = slope(
        json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 40, "suRateOfChange": 0, "suRefDepth": 10 }),
        None,
    );
    let v =
        json!({ "material": 0, "field": "suRateOfChange", "sd": 0.5, "distribution": "lognormal" });
    let r = run(
        &rising,
        &options(),
        json!([v]),
        json!({ "method": "monte-carlo", "samples": 60, "seed": 3 }),
    )
    .unwrap();
    let mut vn = v;
    vn["distribution"] = json!("normal");
    let normal = run(
        &rising,
        &options(),
        json!([vn]),
        json!({ "method": "monte-carlo", "samples": 60, "seed": 3 }),
    )
    .unwrap();
    assert_eq!(r.samples, normal.samples);
    assert!(r.samples.as_ref().unwrap().iter().any(|&f| f < r.fos));
    assert!(r.samples.as_ref().unwrap().iter().any(|&f| f > r.fos));
}

#[test]
fn correlation_narrows_or_widens_the_spread() {
    let two = slope(su(40.0), Some(su(40.0)));
    let v = json!([sv(json!({})), { "material": 1, "field": "undrainedShearStrength", "sd": 8 }]);
    let m = |c: Value| {
        run(
            &two,
            &options(),
            v.clone(),
            json!({ "method": "monte-carlo", "samples": 200, "seed": 9, "correlations": c }),
        )
        .unwrap()
    };
    let indep = m(json!([]));
    let neg = m(json!([{ "a": 0, "b": 1, "rho": -0.9 }]));
    let pos = m(json!([{ "a": 0, "b": 1, "rho": 0.9 }]));
    assert!(neg.sd_fos < indep.sd_fos);
    assert!(pos.sd_fos > indep.sd_fos);
    let t = run(&two, &options(), v, json!({ "method": "taylor", "search": false, "correlations": [{ "a": 0, "b": 1, "rho": -0.5 }] })).unwrap();
    let h: Vec<f64> = t
        .terms
        .as_ref()
        .unwrap()
        .iter()
        .map(|x| (x.f_plus - x.f_minus) / 2.0)
        .collect();
    assert!(close(
        t.sd_fos,
        (h[0] * h[0] + h[1] * h[1] - h[0] * h[1]).sqrt(),
        9
    ));
}

#[test]
fn unit_weight_and_gamma_sat() {
    let gv = |sd: f64| json!([{ "material": 0, "field": "unitWeight", "sd": sd }]);
    let taylor = json!({ "method": "taylor", "search": false });
    let r = run(&clay(), &options(), gv(2.0), taylor.clone()).unwrap();
    assert!(close(
        r.terms.as_ref().unwrap()[0].f_plus,
        (r.fos * 18.0) / 20.0,
        6
    ));
    assert!(close(
        r.terms.as_ref().unwrap()[0].f_minus,
        (r.fos * 18.0) / 16.0,
        6
    ));
    let mc = |c: f64, phi: f64, gamma: f64, sat: Option<f64>| {
        let mut m = json!({ "kind": "mohr-coulomb", "unitWeight": gamma, "cohesion": c, "frictionAngle": phi });
        if let Some(s) = sat {
            m["unitWeightSat"] = json!(s);
        }
        m
    };
    let mut wet = slope(mc(5.0, 30.0, 18.0, Some(20.0)), None);
    wet["waterTable"] = json!({ "mode": "height", "value": 3 });
    let mut same_sat = slope(mc(5.0, 30.0, 20.0, None), None);
    same_sat["waterTable"] = json!({ "mode": "height", "value": 3 });
    let shifted = run(&wet, &options(), gv(2.0), taylor.clone()).unwrap();
    let plain = run(&same_sat, &options(), gv(0.0), taylor.clone()).unwrap();
    assert!(!close(
        shifted.terms.as_ref().unwrap()[0].f_plus,
        plain.fos,
        4
    ));
    let mc_wet = run(
        &wet,
        &options(),
        gv(0.0),
        json!({ "method": "monte-carlo", "samples": 10 }),
    )
    .unwrap();
    assert!(close(mc_wet.mean_fos, shifted.fos, 9));
    // a material without a model: the flat unit weight is the variable
    let mut flat = clay();
    flat["materials"] =
        json!([{ "name": "Top", "unitWeight": 18, "cohesion": 30, "frictionAngle": 0 }]);
    let r = run(&flat, &options(), gv(2.0), taylor).unwrap();
    assert_eq!(r.terms.as_ref().unwrap()[0].mean, 18.0);
    assert!(r.terms.as_ref().unwrap()[0].f_plus < r.fos);
}

#[test]
fn surface_to_model_space() {
    let s = CriticalSurface {
        cx: 22.0,
        cy: 18.0,
        radius: 18.5,
        lc: [5.0, 10.0],
        rc: [30.0, 0.0],
        points: Some(vec![[5.0, 10.0], [30.0, 0.0]]),
    };
    assert_eq!(reliability_surface_to_model_space(&s, &def_of(&clay())), s);
    let mut rtl = clay();
    rtl["orientation"] = json!("rtl");
    let m = reliability_surface_to_model_space(&s, &def_of(&rtl));
    assert_eq!(m.cx, 18.0);
    assert_eq!(m.lc, [35.0, 10.0]);
    assert_eq!(m.points, Some(vec![[35.0, 10.0], [10.0, 0.0]]));
    let none = CriticalSurface { points: None, ..s };
    assert!(reliability_surface_to_model_space(&none, &def_of(&rtl))
        .points
        .is_none());
    // a right-to-left model gives the FOS of its mirror image
    let mut mirrored = clay();
    mirrored["orientation"] = json!("rtl");
    mirrored["coordinates"] = Value::Array(
        clay()["coordinates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| json!([40.0 - p[0].as_f64().unwrap(), p[1]]))
            .collect(),
    );
    mirrored["customSearchPlanes"] = json!([{ "cx": 18, "cy": 18, "radius": 18.5 }]);
    let canonical = to_canonical_slope_definition(&def_of(&mirrored), None).unwrap();
    let ro = json!({ "method": "taylor", "search": false });
    let a = run(&clay(), &options(), json!([sv(json!({}))]), ro.clone()).unwrap();
    let b = run(
        &serde_json::to_value(&canonical).unwrap(),
        &options(),
        json!([sv(json!({}))]),
        ro,
    )
    .unwrap();
    assert!(close(b.fos, a.fos, 9));
    assert!(close(b.sd_fos, a.sd_fos, 9));
}

#[test]
fn agreement_with_the_exact_distribution() {
    let weak = slope(su(30.0), None);
    let v = json!([{ "material": 0, "field": "undrainedShearStrength", "sd": 6 }]);
    let t = run(
        &weak,
        &options(),
        v.clone(),
        json!({ "method": "taylor", "search": false }),
    )
    .unwrap();
    let n: f64 = 400.0;
    let m = run(
        &weak,
        &options(),
        v,
        json!({ "method": "monte-carlo", "samples": n, "seed": 11 }),
    )
    .unwrap();
    let sd_f = t.fos * 0.2;
    assert!(close(t.sd_fos, sd_f, 9));
    assert!((m.mean_fos - t.fos).abs() < (4.0 * sd_f) / n.sqrt());
    assert!(m.sd_fos / sd_f > 0.85 && m.sd_fos / sd_f < 1.15);
    let pf_exact = normal_cdf(-(t.fos - 1.0) / sd_f);
    assert!(
        (m.pf.unwrap() - pf_exact).abs() < 4.0 * ((pf_exact * (1.0 - pf_exact)) / n).sqrt() + 1e-9
    );
    assert!(close(t.beta_normal, (t.fos - 1.0) / sd_f, 9));
}

#[test]
fn normal_distribution_helpers() {
    assert!(close(normal_cdf(0.0), 0.5, 7));
    assert!(close(normal_cdf(1.6449), 0.95, 4));
    assert!(close(normal_cdf(-2.3263), 0.01, 4));
    assert!(close(lognormal_beta(1.5, 0.2), 1.9483, 4));
    assert_eq!(lognormal_beta(1.5, 0.0), f64::INFINITY);
    assert_eq!(lognormal_beta(0.8, 0.0), f64::NEG_INFINITY);
}

// ── against TypeScript ────────────────────────────────────────────

#[cfg(feature = "rayon")]
#[test]
fn serial_and_rayon_give_the_same_reliability_bit_for_bit() {
    use cslope_engine::api::ctx::Rayon;
    let rayon = Rayon::default();
    let two = slope(su(40.0), Some(su(50.0)));
    let v = json!([sv(json!({ "distribution": "lognormal" })), { "material": 1, "field": "undrainedShearStrength", "sd": 5 }]);
    for ro in [
        json!({ "method": "monte-carlo", "samples": 500, "seed": 4, "correlations": [{ "a": 0, "b": 1, "rho": 0.3 }] }),
        json!({ "method": "taylor", "search": false }),
    ] {
        let a = run(&two, &options(), v.clone(), ro.clone()).unwrap();
        let b = run_ctx(
            &two,
            &options(),
            v.clone(),
            ro,
            &mut RunCtx::with_evaluator(&rayon),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }
    // a Taylor series that searches again for each evaluation
    let mut searched = clay();
    searched["customSearchPlanes"] = Value::Null;
    searched["customPlanesOnly"] = json!(false);
    let o = json!({ "slices": 30, "tolerance": 1e-4, "maxIterations": 100, "method": "Bishop", "iterations": 300, "refinedIterations": 100 });
    let a = run(
        &searched,
        &o,
        json!([sv(json!({}))]),
        json!({ "method": "taylor" }),
    )
    .unwrap();
    let b = run_ctx(
        &searched,
        &o,
        json!([sv(json!({}))]),
        json!({ "method": "taylor" }),
        &mut RunCtx::with_evaluator(&rayon),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}
