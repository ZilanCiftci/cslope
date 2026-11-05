//! Limit analysis as a verification check of the finite element problems.
//!
//! For every problem of the verification with a finite element setup
//! (golden/verification.json `fem`, verification/fem-cases.ts) the lower
//! and upper bounds of limit analysis (lower_bound.rs, upper_bound.rs) are
//! computed on the setup's model (pore pressures, tension cut-off) at the
//! default element size, and with them the strength reduction factor on the
//! same mesh, without refinement. What theory requires of them (rigid
//! perfectly plastic Mohr–Coulomb material; Drucker, Prager & Greenberg
//! 1952; Radenkovic 1961, as in Salençon, Calcul à la rupture, 1983):
//!
//! - `order`: lower ≤ upper with the associated strength (c/F, tan φ/F),
//!   and the lower bound with Davis B's strength for the setup's dilation
//!   angle ψ below the associated lower bound. With ψ = 0 Davis B's
//!   material at F is Radenkovic's (c cos φ, tan φ* = sin φ of the reduced
//!   material), whose collapse load is a lower bound for the
//!   non-associated material; the associated upper bound is an upper bound
//!   for it (Radenkovic's first theorem). So the factor of safety of a
//!   non-associated material lies in [Davis B lower, associated upper].
//! - `reference`: a published value that is itself an associated
//!   rigid-plastic result (kind "theory": an exact solution; "bounds": a
//!   pair of rigorous bounds) is bracketed: an exact value lies in
//!   [lower, upper], and published bounds overlap ours. Published numerical
//!   values (finite element or finite difference strength reduction, with
//!   their own mesh, flow rule and failure criterion) are not bounded by
//!   theory and are only listed.
//! - `srm`: the strength reduction factor (the setup's flow rule) lies in
//!   the bracket: [lower, upper] for associated flow, [Davis B lower,
//!   upper] otherwise, within the search's resolution on F (0.005) only.
//!   The displacement method is not a bound, so a factor outside the
//!   bracket is possible on a coarse mesh (locking above, a premature
//!   non-convergence below), but each one is a finding: listed in
//!   tests/bounds_allowlist.toml with its cause, or a failure.
//!
//! A violation that is not in the allowlist fails the test, and an
//! allowlist entry that no longer applies fails it too. The bounds are
//! rigorous only to the conic solver's accuracy: `order` and `reference`
//! allow 1e-4 relative, not more.
//!
//! The problems run on all cores; the whole set takes tens of minutes in
//! release (40 on four busy cores, V012's bounds on 6600 elements alone 35),
//! so that test is #[ignore]d (`cargo test --release --all-features --test
//! verification_bounds -- --ignored --nocapture`, which prints the table),
//! as the slow tests of fem_analysis_unit.rs; `bounds_of_the_exact_and_
//! bounded_references` runs three of the four problems with a rigid-plastic
//! reference (see RIGID_PLASTIC_REFERENCES) in the default run, about a
//! minute.
//!
//! Findings of the full set (2026-11-04, 35 problems): no `order` or
//! `reference` violation; Kim et al.'s bounds (V002, V068) overlap ours and
//! Prandtl's exact F = 1 (V018, V077) lies in the bracket. Published
//! numerical values outside the bracket (noted, not checked): V039 1.26
//! and V056 0.6 (the disputed value) above the associated upper bound,
//! V067 1.41 below Radenkovic's lower bound. The strength reduction
//! factors outside it are in tests/bounds_allowlist.toml.
#![allow(clippy::disallowed_methods)]

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::fem::analysis::{analyze_fem, FemAnalysisOptions};
use cslope_engine::fem::lower_bound::{lower_bound, LowerBoundOptions};
use cslope_engine::fem::upper_bound::upper_bound;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::slope::Slope;
use cslope_engine::types::SlopeDefinition;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// Relative accuracy of the bounds (the conic solver's), for `order` and `reference`.
const BOUND_ACCURACY: f64 = 1e-4;
/// Resolution of the strength reduction's search on F (its `fTolerance`).
const SRM_RESOLUTION: f64 = 0.005;
/// Tolerance on F of the bounds' searches.
const BOUND_F_TOLERANCE: f64 = 0.002;

/// The problems with a published value that is an associated rigid-plastic
/// result and fast bounds, run by default: V018 and V077 exact (Prandtl),
/// V068 bounds. V002's (bounds) lower bound alone takes minutes; it runs in
/// the full set.
const RIGID_PLASTIC_REFERENCES: [&str; 3] = ["V018", "V068", "V077"];

struct Case {
    id: String,
    definition: Value,
    fem: Value,
}

/// The results of one problem.
struct Outcome {
    flow_rule: String,
    lower: f64,
    upper: f64,
    /// Davis B lower bound (flow rules other than associated).
    davis_lower: Option<f64>,
    srm: f64,
    elements: usize,
    seconds: f64,
    /// Run time of the lower, upper, Davis B lower bound and the strength reduction (s).
    parts: [f64; 4],
    error: Option<String>,
}

fn cases() -> Vec<Case> {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../golden/verification.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let v: Value = serde_json::from_str(&text).expect("golden JSON");
    v["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c.get("fem").is_some())
        .map(|c| Case {
            id: c["id"].as_str().unwrap().to_string(),
            definition: c["definition"].clone(),
            fem: c["fem"].clone(),
        })
        .collect()
}

fn slope_of(def: &Value) -> Slope {
    let def: SlopeDefinition = serde_json::from_value(def.clone()).expect("a slope definition");
    let canonical = to_canonical_slope_definition(&def, None).expect("canonical");
    build_slope(&canonical).expect("build_slope")
}

/// The model options of a setup (FeModelOptions' JSON), as runFemVerification passes them.
fn model_options(fem: &Value) -> Map<String, Value> {
    let mut o = Map::new();
    for k in [
        "materialParameters",
        "porePressure",
        "elementSize",
        "reinforcementStiffness",
        "reduceReinforcement",
    ] {
        if let Some(v) = fem.get(k) {
            o.insert(k.to_string(), v.clone());
        }
    }
    o
}

fn run_case(c: &Case) -> Outcome {
    let t0 = Instant::now();
    let flow_rule = c.fem["flowRule"].as_str().unwrap_or("davis-b").to_string();
    let r = (|| {
        let slope = slope_of(&c.definition);
        let mut ctx = RunCtx::default();
        let mut bound = model_options(&c.fem);
        bound.insert(
            "tensionCutoff".into(),
            json!(c.fem["tensionCutoff"].as_bool().unwrap_or(false)),
        );
        bound.insert("fTolerance".into(), json!(BOUND_F_TOLERANCE));
        let assoc: LowerBoundOptions =
            serde_json::from_value(Value::Object(bound.clone())).expect("bound options");
        let mut parts = [0.0; 4];
        let mut lap = Instant::now();
        let mut split = |i: usize| {
            parts[i] = lap.elapsed().as_secs_f64();
            lap = Instant::now();
        };
        let lower = lower_bound(&slope, &assoc, &mut ctx)?;
        split(0);
        let upper = upper_bound(&slope, &assoc, &mut ctx)?;
        split(1);
        let davis_lower = if flow_rule == "associated" {
            None
        } else {
            let mut o = bound.clone();
            o.insert("strengthRule".into(), json!("davis-b"));
            o.insert("startF".into(), json!(lower.factor_of_safety));
            let davis: LowerBoundOptions =
                serde_json::from_value(Value::Object(o)).expect("bound options");
            Some(lower_bound(&slope, &davis, &mut ctx)?.factor_of_safety)
        };
        split(2);
        let mut srm = model_options(&c.fem);
        srm.insert("flowRule".into(), json!(flow_rule));
        if let Some(t) = c.fem.get("tensionCutoff") {
            srm.insert("tensionCutoff".into(), t.clone());
        }
        srm.insert("fTolerance".into(), json!(SRM_RESOLUTION));
        let srm: FemAnalysisOptions =
            serde_json::from_value(Value::Object(srm)).expect("FemAnalysisOptions");
        let fe = analyze_fem(&slope, &srm, &mut ctx)?;
        split(3);
        Ok::<_, cslope_engine::error::EngineError>(Outcome {
            flow_rule: flow_rule.clone(),
            lower: lower.factor_of_safety,
            upper: upper.factor_of_safety,
            davis_lower,
            srm: fe.factor_of_safety,
            elements: lower.elements,
            seconds: 0.0,
            parts,
            error: None,
        })
    })();
    let seconds = t0.elapsed().as_secs_f64();
    match r {
        Ok(r) => Outcome { seconds, ..r },
        Err(e) => Outcome {
            flow_rule,
            lower: f64::NAN,
            upper: f64::NAN,
            davis_lower: None,
            srm: f64::NAN,
            elements: 0,
            seconds,
            parts: [0.0; 4],
            error: Some(e.message),
        },
    }
}

fn run_all(cases: &[Case]) -> BTreeMap<String, Outcome> {
    let next = AtomicUsize::new(0);
    let out = Mutex::new(BTreeMap::new());
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    std::thread::scope(|scope| {
        for _ in 0..threads.min(cases.len()) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(c) = cases.get(i) else { break };
                let r = run_case(c);
                out.lock().unwrap().insert(c.id.clone(), r);
            });
        }
    });
    out.into_inner().unwrap()
}

/// tests/bounds_allowlist.toml: `[[violation]]` entries with `key`
/// ("problem|check") and `reason` (a subset of TOML read by hand, as
/// tests/allowlist.toml).
fn allowlist() -> BTreeMap<String, String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/bounds_allowlist.toml");
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut out = BTreeMap::new();
    let mut key: Option<String> = None;
    let mut reason = String::new();
    let mut flush = |key: &mut Option<String>, reason: &str| {
        if let Some(k) = key.take() {
            assert!(!reason.is_empty(), "bounds allowlist {k}: no reason");
            out.insert(k, reason.to_string());
        }
    };
    for line in text.lines() {
        let line = line.trim();
        if line == "[[violation]]" {
            flush(&mut key, &reason);
            reason.clear();
        } else if let Some(v) = line.strip_prefix("key = ") {
            key = Some(serde_json::from_str::<String>(v).expect("a TOML basic string"));
        } else if let Some(v) = line.strip_prefix("reason = ") {
            reason = serde_json::from_str::<String>(v).expect("a TOML basic string");
        }
    }
    flush(&mut key, &reason);
    out
}

/// The violations of a problem's results, keyed "problem|check", with what was found.
fn violations(c: &Case, r: &Outcome) -> Vec<(String, String)> {
    let id = &c.id;
    let mut out = Vec::new();
    if let Some(e) = &r.error {
        out.push((format!("{id}|error"), e.clone()));
        return out;
    }
    let below = |a: f64, b: f64| a <= b * (1.0 + BOUND_ACCURACY);
    if !(below(r.lower, r.upper)) {
        out.push((
            format!("{id}|order"),
            format!("lower {:.4} above upper {:.4}", r.lower, r.upper),
        ));
    }
    if let Some(d) = r.davis_lower {
        if !below(d, r.lower) {
            out.push((
                format!("{id}|order"),
                format!(
                    "Davis B lower {d:.4} above the associated lower {:.4}",
                    r.lower
                ),
            ));
        }
    }
    for reference in c.fem["references"].as_array().unwrap() {
        let value = reference["value"].as_f64().unwrap();
        match reference["kind"].as_str().unwrap() {
            "theory" if !(below(r.lower, value) && below(value, r.upper)) => out.push((
                format!("{id}|reference"),
                format!(
                    "exact {value} of {} outside [{:.4}, {:.4}]",
                    reference["source"], r.lower, r.upper
                ),
            )),
            "bounds" => {
                let up = reference["upper"].as_f64().unwrap_or(value);
                if !(below(r.lower, up) && below(value, r.upper)) {
                    out.push((
                        format!("{id}|reference"),
                        format!(
                            "bounds [{value}, {up}] of {} do not overlap [{:.4}, {:.4}]",
                            reference["source"], r.lower, r.upper
                        ),
                    ));
                }
            }
            _ => {}
        }
    }
    let lo = r.davis_lower.unwrap_or(r.lower);
    if !(r.srm >= lo - SRM_RESOLUTION && r.srm <= r.upper + SRM_RESOLUTION) {
        out.push((
            format!("{id}|srm"),
            format!(
                "strength reduction ({}) {:.4} outside [{lo:.4}, {:.4}]",
                r.flow_rule, r.srm, r.upper
            ),
        ));
    }
    out
}

fn check(cases: &[Case]) {
    let results = run_all(cases);
    let allow = allowlist();
    let mut failures = Vec::new();
    let mut used = Vec::new();
    println!(
        "{:<6} {:<15} {:>6} {:>8} {:>8} {:>8} {:>8}  {:<28} {:>6}  lower/upper/Davis/SRM s",
        "", "flow rule", "elems", "Davis lb", "lower", "upper", "SRM", "published", "s"
    );
    for c in cases {
        let r = &results[&c.id];
        let published: Vec<String> = c.fem["references"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let v = p["value"].as_f64().unwrap();
                match p["upper"].as_f64() {
                    Some(u) => format!("{v}-{u} ({})", p["kind"].as_str().unwrap()),
                    None => format!("{v} ({})", p["kind"].as_str().unwrap()),
                }
            })
            .collect();
        println!(
            "{:<6} {:<15} {:>6} {:>8} {:>8.4} {:>8.4} {:>8.4}  {:<28} {:>6.1}  {:.0}/{:.0}/{:.0}/{:.0}",
            c.id,
            r.flow_rule,
            r.elements,
            r.davis_lower.map_or("-".into(), |d| format!("{d:.4}")),
            r.lower,
            r.upper,
            r.srm,
            published.join(", "),
            r.seconds,
            r.parts[0],
            r.parts[1],
            r.parts[2],
            r.parts[3]
        );
        // Published numerical values are not bounded by theory; those outside
        // the bracket are noted (a finite element value above the associated
        // upper bound, or below Radenkovic's lower bound, is too high or too
        // low for its own material by at least that much).
        let lo = r.davis_lower.unwrap_or(r.lower);
        for p in c.fem["references"].as_array().unwrap() {
            let v = p["value"].as_f64().unwrap();
            if p["kind"] == "numerical" && (v < lo || v > r.upper) {
                println!(
                    "  note: published {v} of {} outside [{lo:.4}, {:.4}]{}",
                    p["source"],
                    r.upper,
                    if p.get("disputed").is_some() {
                        " (disputed)"
                    } else {
                        ""
                    }
                );
            }
        }
        for (key, what) in violations(c, r) {
            if let Some(reason) = allow.get(&key) {
                println!("  allowlisted {key}: {what} ({reason})");
                used.push(key);
            } else {
                failures.push(format!("{key}: {what}"));
            }
        }
    }
    // An entry for a problem that ran must still be needed.
    for k in allow.keys() {
        let id = k.split('|').next().unwrap();
        if cases.iter().any(|c| c.id == id) && !used.contains(k) {
            failures.push(format!(
                "bounds allowlist entry {k} not needed any more: remove it"
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "limit analysis checks that fail:\n{}",
        failures.join("\n")
    );
}

#[test]
fn bounds_of_the_exact_and_bounded_references() {
    let cases: Vec<Case> = cases()
        .into_iter()
        .filter(|c| RIGID_PLASTIC_REFERENCES.contains(&c.id.as_str()))
        .collect();
    assert_eq!(cases.len(), RIGID_PLASTIC_REFERENCES.len());
    check(&cases);
}

#[test]
#[ignore]
fn bounds_of_every_finite_element_problem() {
    let cases = cases();
    assert!(cases.len() >= 35, "too few problems: {}", cases.len());
    check(&cases);
}
