//! The native verification runner and the golden results.
//!
//! Every analysis of the verification checks (golden/verification.json: the
//! problems of verification/problems.ts with each check's options as
//! verificationOptions merges them, written by tools/golden.ts) runs
//! natively, as `runVerification` does: build_slope(to_canonical_slope_
//! definition(def)), update_analysis_options, analyse_slope.
//!
//! - `verification_checks_pass`: every check (the non-circular
//!   optimisation and the block search included) agrees with its published
//!   value within its tolerance (verification/tolerance.ts `agrees`); a
//!   check marked pending waits for an engine change and is reported, not
//!   failed.
//! - `searches_match_golden`: against the golden results, those of the
//!   engine the app ships (WebAssembly), the minimum F within 1e-6
//!   relative, the critical surface the same (its key) and the counts of
//!   surfaces equal (a generation near-tie may add or drop one surface in
//!   2000). A search that takes another branch on a near-tie may differ by
//!   up to 1e-4 only when listed in tests/allowlist.toml with the cause
//!   (PORTING.md tolerance policy).
//!
//! The analyses run once, shared by both tests, on all cores (one analysis
//! per thread; each analysis itself serial, or with rayon under
//! `--features rayon`). Run with `--release --nocapture` for the summary.
#![allow(clippy::field_reassign_with_default)] // RunCtx is built per feature, then its retention set
#![allow(clippy::disallowed_methods)]

use cslope_engine::api::ctx::{RunCtx, SliceRetention};
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::search::plane_key;
use cslope_engine::model::slope::AnalysisOptionsPatch;
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::SlopeDefinition;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

/// One native analysis: the minimum, the critical surface's key and the counts.
struct Run {
    fos: Option<f64>,
    critical: Option<String>,
    planes: usize,
    valid: usize,
    error: Option<String>,
    ms: f64,
}

/// An analysis to run: the definition as given, and the merged options.
struct Job {
    key: String,
    definition: Value,
    options: Value,
}

fn analysis_key(id: &str, options: &Value) -> String {
    format!("{id}|{options}")
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(f64::NAN)
}

fn run_one(job: &Job) -> Run {
    let t0 = Instant::now();
    let r = (|| {
        let def: SlopeDefinition =
            serde_json::from_value(job.definition.clone()).expect("a slope definition");
        let canonical = to_canonical_slope_definition(&def, None)?;
        let mut slope = build_slope(&canonical)?;
        let patch: AnalysisOptionsPatch =
            serde_json::from_value(job.options.clone()).expect("analysis options");
        slope.update_analysis_options(&patch)?;
        #[cfg(feature = "rayon")]
        let evaluator = cslope_engine::api::ctx::Rayon::default();
        #[cfg(feature = "rayon")]
        let mut ctx = RunCtx::with_evaluator(&evaluator);
        #[cfg(not(feature = "rayon"))]
        let mut ctx = RunCtx::default();
        // only the critical surface keeps its slices (the product path)
        ctx.retention = SliceRetention::Critical;
        let fos = analyse_slope(&mut slope, &mut ctx)?;
        let search = slope.search();
        Ok::<_, cslope_engine::error::EngineError>(Run {
            fos,
            critical: search.iter().find(|p| p.fos.is_some()).map(plane_key),
            planes: search.len(),
            valid: search.iter().filter(|p| p.fos.is_some()).count(),
            error: None,
            ms: 0.0,
        })
    })();
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    match r {
        Ok(run) => Run { ms, ..run },
        Err(e) => Run {
            fos: None,
            critical: None,
            planes: 0,
            valid: 0,
            error: Some(e.message),
            ms,
        },
    }
}

/// golden/verification.json: the problems with their checks, and the golden results.
struct Data {
    cases: Vec<Value>,
    searches: Vec<Value>,
}

fn data() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(|| {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../golden/verification.json");
        let text =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let mut v: Value = serde_json::from_str(&text).expect("golden JSON");
        Data {
            cases: serde_json::from_value(v["cases"].take()).unwrap(),
            searches: serde_json::from_value(v["searches"].take()).unwrap(),
        }
    })
}

/// Every analysis, run once (keyed by `analysis_key`).
fn runs() -> &'static BTreeMap<String, Run> {
    static RUNS: OnceLock<BTreeMap<String, Run>> = OnceLock::new();
    RUNS.get_or_init(|| {
        let d = data();
        let mut jobs: Vec<Job> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for c in &d.cases {
            for k in c["checks"].as_array().unwrap() {
                let key = analysis_key(c["id"].as_str().unwrap(), &k["options"]);
                if seen.insert(key.clone()) {
                    jobs.push(Job {
                        key,
                        definition: c["definition"].clone(),
                        options: k["options"].clone(),
                    });
                }
            }
        }
        let next = AtomicUsize::new(0);
        let out = Mutex::new(BTreeMap::new());
        let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
        std::thread::scope(|scope| {
            for _ in 0..threads {
                scope.spawn(|| loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(job) = jobs.get(i) else { break };
                    let r = run_one(job);
                    out.lock().unwrap().insert(job.key.clone(), r);
                });
            }
        });
        out.into_inner().unwrap()
    })
}

/// verification/tolerance.ts `agrees`.
fn agrees(published: f64, tolerance: f64, fos: f64) -> bool {
    (fos - published).abs() / published.abs() <= tolerance + 1e-9
}

#[test]
fn verification_checks_pass() {
    let d = data();
    let runs = runs();
    let (mut passed, mut pending_failed, mut pending_passed) = (0, 0, 0);
    let mut failures: Vec<String> = Vec::new();
    for c in &d.cases {
        let id = c["id"].as_str().unwrap();
        for k in c["checks"].as_array().unwrap() {
            let label = format!(
                "{id} {}: {} {} ({})",
                c["title"].as_str().unwrap(),
                k["label"].as_str().unwrap(),
                k["published"],
                k["publishedBy"].as_str().unwrap()
            );
            let run = &runs[&analysis_key(id, &k["options"])];
            let published = num(&k["published"]);
            let tolerance = num(&k["tolerance"]);
            let ok = run.fos.is_some_and(|f| agrees(published, tolerance, f));
            let pending = k.get("pending").is_some();
            match (ok, pending) {
                (true, false) => passed += 1,
                (true, true) => pending_passed += 1,
                (false, true) => pending_failed += 1,
                (false, false) => failures.push(format!(
                    "{label}: F = {:?}{} (tolerance {:.2} %)",
                    run.fos,
                    run.error
                        .as_ref()
                        .map_or(String::new(), |e| format!(", error {e}")),
                    tolerance * 100.0
                )),
            }
        }
    }
    println!(
        "verification: {passed} checks pass, {} fail; pending (waiting for an engine change): {pending_failed} fail, {pending_passed} pass",
        failures.len(),
    );
    assert!(
        failures.is_empty(),
        "verification checks that fail natively:\n{}",
        failures.join("\n")
    );
    assert!(passed > 300, "too few checks ran: {passed}");
}

/// tests/allowlist.toml: `[[search]]` entries with `key`, `max_rel` and
/// `reason` (a subset of TOML read by hand: no TOML dependency).
fn allowlist() -> BTreeMap<String, (f64, String)> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/allowlist.toml");
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut out = BTreeMap::new();
    let mut key: Option<String> = None;
    let mut max_rel = 0.0;
    let mut reason = String::new();
    let mut flush = |key: &mut Option<String>, max_rel: f64, reason: &str| {
        if let Some(k) = key.take() {
            assert!(
                max_rel <= 1e-4,
                "allowlist {k}: max_rel above 1e-4 is a bug, not a tie"
            );
            assert!(!reason.is_empty(), "allowlist {k}: no reason");
            out.insert(k, (max_rel, reason.to_string()));
        }
    };
    for line in text.lines() {
        let line = line.trim();
        if line == "[[search]]" {
            flush(&mut key, max_rel, &reason);
            max_rel = 0.0;
            reason.clear();
        } else if let Some(v) = line.strip_prefix("key = ") {
            key = Some(serde_json::from_str::<String>(v).expect("a TOML basic string"));
        } else if let Some(v) = line.strip_prefix("max_rel = ") {
            max_rel = v.parse().expect("a number");
        } else if let Some(v) = line.strip_prefix("reason = ") {
            reason = serde_json::from_str::<String>(v).expect("a TOML basic string");
        }
    }
    flush(&mut key, max_rel, &reason);
    out
}

#[test]
fn searches_match_golden() {
    let d = data();
    let runs = runs();
    let allow = allowlist();
    let mut failures: Vec<String> = Vec::new();
    let mut used_allow: Vec<String> = Vec::new();
    let (mut compared, mut near_tie_counts) = (0, 0);
    let mut max_rel: f64 = 0.0;
    let mut max_at = String::new();
    let mut total_ms = 0.0;
    for s in &d.searches {
        let key = s["key"].as_str().unwrap().to_string();
        let run = &runs[&analysis_key(s["id"].as_str().unwrap(), &s["options"])];
        total_ms += run.ms;
        if let Some(err) = s.get("error") {
            if run.error.as_deref() != err.as_str() {
                failures.push(format!("{key}: error {:?} vs {err}", run.error));
            }
            continue;
        }
        if let Some(e) = &run.error {
            failures.push(format!("{key}: native error {e}"));
            continue;
        }
        compared += 1;
        let golden = s["fos"].as_f64();
        let rel = match (run.fos, golden) {
            (Some(a), Some(b)) => (a - b).abs() / b.abs().max(1e-300),
            (None, None) => 0.0,
            _ => f64::INFINITY,
        };
        if rel > max_rel {
            max_rel = rel;
            max_at = format!("{key}: {:?} vs {:?}", run.fos, golden);
        }
        // An allowlisted search took another branch on a near-tie: only its
        // minimum is compared, within the listed bound (at most 1e-4).
        if let Some((max, _)) = allow.get(&key) {
            let same = rel <= 1e-6
                && run.critical.as_deref() == s["critical"].as_str()
                && Some(run.planes as u64) == s["planes"].as_u64()
                && Some(run.valid as u64) == s["valid"].as_u64();
            if !same {
                used_allow.push(key.clone());
            }
            if rel.is_nan() || rel > max.max(1e-6) {
                failures.push(format!(
                    "{key} (allowlisted to {max:e}): F {:?} vs {:?} (rel {rel:e})",
                    run.fos, golden
                ));
            }
            continue;
        }
        if rel.is_nan() || rel > 1e-6 {
            failures.push(format!(
                "{key}: F {:?} vs {:?} (rel {rel:e})",
                run.fos, golden
            ));
            continue;
        }
        if run.critical.as_deref() != s["critical"].as_str() {
            failures.push(format!(
                "{key}: critical surface {:?} vs {}",
                run.critical, s["critical"]
            ));
        }
        for (what, a, b) in [
            ("planes", run.planes, &s["planes"]),
            ("valid", run.valid, &s["valid"]),
        ] {
            let b = b.as_u64().unwrap() as usize;
            if a != b {
                if a.abs_diff(b) > (b / 2000).max(1) {
                    failures.push(format!("{key}: {what} {a} vs {b}"));
                } else {
                    near_tie_counts += 1;
                }
            }
        }
    }
    println!(
        "{compared} searches against the golden results: minimum F, largest relative difference {max_rel:.3e} ({max_at}); allowlisted: {used_allow:?}; counts within a near-tie: {near_tie_counts}; native time {:.1} s (sum, {} threads)",
        total_ms / 1000.0,
        std::thread::available_parallelism().map_or(1, |n| n.get()),
    );
    for k in allow.keys() {
        assert!(
            used_allow.contains(k),
            "allowlist entry {k} not needed any more: remove it"
        );
    }
    assert!(compared > 300, "too few searches compared: {compared}");
    assert!(
        failures.is_empty(),
        "searches that differ from the golden results:\n{}",
        failures.join("\n")
    );
}
