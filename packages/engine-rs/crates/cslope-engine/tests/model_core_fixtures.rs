//! Differential tests of the model core (slope, composite, surface,
//! reinforcement, search generation, build_slope) against the fixtures of
//! tools/fixtures/model-core.fixture.ts: for every verification problem,
//! reliability case and app example, as given and mirrored, with the options
//! of each verification check and composite variants, the Slope snapshot
//! (every getter and derived value) must agree within 1e-9 relative
//! (PORTING.md tolerance policy for intermediate values), and so must the
//! generated plane lists (keys, order, values), except planes decided by a
//! near-tie (see `plane_lists_match_typescript`).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::types::SlopeDefinition;
use model_core_support::{
    compare, compare_planes, first_pass, later_passes, plane_json, planes_from, snap,
    surface_probe, Stats,
};
use serde_json::Value;

const REL: f64 = 1e-9;

#[derive(serde::Deserialize)]
struct IndexEntry {
    id: String,
}

/// Every variant of every definition: (what, case, built slope or error).
fn for_each_case(mut f: impl FnMut(&str, &Value, Option<Slope>)) {
    let index: Vec<IndexEntry> = common::load("model-core", "index");
    for entry in &index {
        let cases: serde_json::Map<String, Value> =
            common::load("model-core", &format!("def-{}", entry.id));
        for (name, case) in &cases {
            let what = format!("{}/{}", entry.id, name);
            let def: SlopeDefinition = serde_json::from_value(case["definition"].clone())
                .unwrap_or_else(|e| panic!("{what}: definition: {e}"));
            let options: Option<AnalysisOptionsPatch> = case.get("options").map(|o| {
                serde_json::from_value(o.clone()).unwrap_or_else(|e| panic!("{what}: options: {e}"))
            });
            let built = build_slope(&def).and_then(|mut s| {
                if let Some(o) = &options {
                    s.update_analysis_options(o)?;
                }
                Ok(s)
            });
            match (built, case.get("error")) {
                (Err(e), Some(Value::String(msg))) => {
                    assert_eq!(&e.message, msg, "{what}");
                    f(&what, case, None);
                }
                (Err(e), _) => panic!("{what}: Rust fails ({}) where TypeScript builds", e.message),
                (Ok(_), Some(msg)) => panic!("{what}: Rust builds where TypeScript fails ({msg})"),
                (Ok(s), None) => f(&what, case, Some(s)),
            }
        }
    }
}

fn report(what: &str, stats: &Stats) {
    eprintln!(
        "{what}: {} numbers, {} not bit-identical, max rel {:e} at {}",
        stats.numbers, stats.differing, stats.max_rel, stats.max_rel_at
    );
}

fn merge(total: &mut Stats, s: Stats) {
    total.numbers += s.numbers;
    total.differing += s.differing;
    if s.max_rel > total.max_rel {
        total.max_rel = s.max_rel;
        total.max_rel_at = s.max_rel_at;
    }
    total.errors.extend(s.errors);
}

/// Every getter and derived value of the slope (the SlopeSnapshot), for
/// every variant, and the surface functions on polylines from the planes.
#[test]
fn slope_snapshots_match_typescript() {
    let mut total = Stats::default();
    let mut variants = 0;
    let mut errors = 0;
    for_each_case(|what, case, slope| {
        variants += 1;
        let Some(slope) = slope else {
            errors += 1;
            return;
        };
        let mut stats = Stats::default();
        compare(
            &snap(&slope, 0),
            &case["snapshot"],
            &format!("{what}.snapshot"),
            REL,
            &mut stats,
        );
        if let Some(planes) = case.get("planes") {
            let ts_planes = planes_from(planes);
            compare(
                &surface_probe(&slope, &ts_planes),
                &case["surface"],
                &format!("{what}.surface"),
                REL,
                &mut stats,
            );
        }
        merge(&mut total, stats);
    });
    report(
        &format!("snapshots ({variants} variants, {errors} build errors)"),
        &total,
    );
    assert!(
        total.errors.is_empty(),
        "{} differences:\n{}",
        total.errors.len(),
        total.errors[..total.errors.len().min(40)].join("\n")
    );
}

/// The planes `set_entry_exit_planes` generates, and the refined and local
/// planes generated from TypeScript's own first pass (each stage from the
/// same input). Planes with equal keys must agree within 1e-9, in the same
/// order.
///
/// Near-ties (accepted by the integrator, PORTING.md Decisions): std's
/// sin/cos/atan differ from V8's in the last bit for about 3 % of
/// arguments, and two kinds of plane are decided at rounding level:
/// - circles found by bisection to be tangent to a material interface,
///   typically where the interface meets the ground or the model's edge (the
///   decisive dip below the interface is quadratic in the bisection
///   parameter, so 1e-14 of rounding moves the result by about 1e-7
///   relative, and can add or drop the circle). Such a plane may differ by
///   up to 1e-5 relative to its size, or be generated by one engine only;
///   the test asserts that every such plane has `tangentTo`;
/// - key ties: the same circle (all values within 1e-9) whose radius or
///   centre lies on a rounding half of the 4-decimal key (feet converted to
///   metres), rounded either way by the last bit.
///
/// All are counted, listed with MODEL_CORE_VERBOSE set, and must stay below
/// 1 in 2000 planes of each list. The gate on results is the solver phase's:
/// search minima within 1e-6.
#[test]
fn plane_lists_match_typescript() {
    const NEAR_TIE_REL: f64 = 1e-5;
    let mut total = Stats::default();
    // per list: TS planes, only TS, only Rust, near-tie values, key ties
    let mut counts = [[0usize; 5]; 4];
    let mut sets = 0;
    let verbose = std::env::var("MODEL_CORE_VERBOSE").is_ok();
    for_each_case(|what, case, slope| {
        let (Some(mut slope), Some(ts_planes)) = (slope, case.get("planes")) else {
            return;
        };
        sets += 1;
        let mut stats = Stats::default();
        let rust_first = first_pass(&mut slope);
        let rust_first_json = Value::Array(rust_first.iter().map(plane_json).collect());
        let ts_first = planes_from(ts_planes);
        let ts_refined = planes_from(&case["refined"]);
        let later = later_passes(&slope, &ts_first, &ts_refined);
        compare(
            &later["keysAfter"],
            &case["keysAfter"],
            &format!("{what}.keysAfter"),
            0.0,
            &mut stats,
        );
        for (k, key) in ["planes", "refined", "local0", "local2"].iter().enumerate() {
            let rust = if *key == "planes" {
                &rust_first_json
            } else {
                &later[*key]
            };
            let m = compare_planes(
                rust,
                &case[*key],
                &format!("{what}.{key}"),
                REL,
                NEAR_TIE_REL,
                &mut stats,
            );
            counts[k][0] += case[*key].as_array().unwrap().len();
            counts[k][1] += m.only_ts.len();
            counts[k][2] += m.only_rust.len();
            counts[k][3] += m.near_tie_values.len();
            // a plane only one engine generates must be a circle tangent to an interface
            for p in m.only_ts.iter().chain(&m.only_rust) {
                if p.get("tangentTo").is_none() {
                    stats.errors.push(format!(
                        "{what}.{key}: a plane not tangent to an interface in one engine only: {p}"
                    ));
                }
            }
            counts[k][4] += m.key_ties.len();
            if verbose {
                for p in &m.only_ts {
                    eprintln!("{what}.{key} only TS   {p}");
                }
                for p in &m.only_rust {
                    eprintln!("{what}.{key} only Rust {p}");
                }
                for p in &m.near_tie_values {
                    eprintln!("near-tie value {p}");
                }
                for p in &m.key_ties {
                    eprintln!("key tie {p}");
                }
            }
        }
        merge(&mut total, stats);
    });
    report(
        &format!("plane lists ({sets} sets), planes within 1e-9"),
        &total,
    );
    for (k, key) in ["planes", "refined", "local0", "local2"].iter().enumerate() {
        eprintln!(
            "{key}: {} TypeScript planes, {} only in TypeScript, {} only in Rust, {} near-tie values, {} key ties",
            counts[k][0], counts[k][1], counts[k][2], counts[k][3], counts[k][4]
        );
    }
    assert!(
        total.errors.is_empty(),
        "{} differences:\n{}",
        total.errors.len(),
        total.errors[..total.errors.len().min(40)].join("\n")
    );
    for (k, key) in ["planes", "refined", "local0", "local2"].iter().enumerate() {
        let near_ties = counts[k][1] + counts[k][2] + counts[k][3] + counts[k][4];
        assert!(
            near_ties * 2000 <= counts[k][0],
            "{key}: {near_ties} near-tie planes of {}",
            counts[k][0]
        );
    }
}
