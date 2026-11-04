//! Property tests of the run context (ARCHITECTURE.md §6.1, §7): the
//! evaluator, the slice retention, progress and cancellation, reused
//! scratch and a cloned slope never change a result.
//!
//! - serial and rayon evaluation (`--features rayon`) give identical plane
//!   lists, bit for bit;
//! - `SliceRetention::Critical` gives the same planes, and the critical
//!   surface's slices are restored identical;
//! - progress reports the surfaces evaluated; a cancelled run stops with
//!   "The analysis was cancelled.";
//! - evaluate_planes with one scratch for all planes equals one plane at a
//!   time with fresh scratch;
//! - analysing a clone equals analysing the original.
#![allow(clippy::disallowed_methods)]

mod common;
mod solvers_support;

use cslope_engine::api::ctx::{CancelToken, ProgressEvent, RunCtx, SliceRetention};
use cslope_engine::error::ErrorKind;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::slope::{AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::model::solvers::{analyse_slope, evaluate_planes};
use cslope_engine::types::SlopeDefinition;
use serde_json::Value;
use std::ops::ControlFlow;

/// A few verification analyses of different kinds (water, layers, cracks,
/// composite circles, Morgenstern-Price), short searches.
const CASES: [&str; 5] = ["V001", "V025", "V039", "V047b", "V063"];

fn slope_of(id: &str) -> Slope {
    let cases: Vec<Value> = common::verification_cases();
    let c = cases.into_iter().find(|c| c["id"] == id).unwrap();
    let def: SlopeDefinition = serde_json::from_value(c["definition"].clone()).unwrap();
    let mut slope = build_slope(&to_canonical_slope_definition(&def, None).unwrap()).unwrap();
    let mut options = c["checks"][0]["options"].clone();
    options["iterations"] = 300.into();
    options["refinedIterations"] = 200.into();
    slope
        .update_analysis_options(&serde_json::from_value::<AnalysisOptionsPatch>(options).unwrap())
        .unwrap();
    slope
}

/// The planes with the bits of every number (f64 == would let 0 = −0 pass).
fn bits(planes: &[SearchPlane]) -> String {
    format!("{planes:?}")
}

fn run(id: &str, ctx: &mut RunCtx) -> (Option<f64>, Slope) {
    let mut s = slope_of(id);
    let f = analyse_slope(&mut s, ctx).unwrap();
    (f, s)
}

#[cfg(feature = "rayon")]
#[test]
fn serial_and_rayon_give_identical_plane_lists() {
    let rayon = cslope_engine::api::ctx::Rayon::default();
    for id in CASES {
        let (fs, serial) = run(id, &mut RunCtx::default());
        let (fr, par) = run(id, &mut RunCtx::with_evaluator(&rayon));
        assert_eq!(fs.map(f64::to_bits), fr.map(f64::to_bits), "{id}");
        assert_eq!(bits(serial.search()), bits(par.search()), "{id}");
    }
}

#[test]
fn critical_retention_gives_the_same_planes_and_restores_the_critical_slices() {
    for id in CASES {
        let (fa, all) = run(id, &mut RunCtx::default());
        let mut ctx = RunCtx {
            retention: SliceRetention::Critical,
            ..RunCtx::default()
        };
        let (fc, crit) = run(id, &mut ctx);
        assert_eq!(fa.map(f64::to_bits), fc.map(f64::to_bits), "{id}");
        let strip = |p: &SearchPlane| SearchPlane {
            slices: None,
            ..p.clone()
        };
        let a: Vec<SearchPlane> = all.search().iter().map(strip).collect();
        let c: Vec<SearchPlane> = crit.search().iter().map(strip).collect();
        assert_eq!(bits(&a), bits(&c), "{id}");
        let i = all.search().iter().position(|p| p.fos.is_some()).unwrap();
        assert!(
            crit.search()[i].slices.is_some(),
            "{id}: critical slices restored"
        );
        assert_eq!(
            format!("{:?}", all.search()[i].slices),
            format!("{:?}", crit.search()[i].slices),
            "{id}"
        );
        // only the critical surface keeps its slices
        assert_eq!(
            crit.search().iter().filter(|p| p.slices.is_some()).count(),
            1,
            "{id}"
        );
    }
}

#[test]
fn progress_reports_the_surfaces_and_does_not_change_the_result() {
    let (f0, plain) = run("V001", &mut RunCtx::default());
    let mut events: Vec<usize> = Vec::new();
    let mut progress = |e: ProgressEvent| {
        if let ProgressEvent::Search { done, .. } = e {
            events.push(done);
        }
        ControlFlow::Continue(())
    };
    let mut ctx = RunCtx {
        progress: Some(&mut progress),
        ..RunCtx::default()
    };
    let (f1, reported) = run("V001", &mut ctx);
    assert_eq!(f0.map(f64::to_bits), f1.map(f64::to_bits));
    assert_eq!(bits(plain.search()), bits(reported.search()));
    assert!(events.len() > 2);
    assert!(events.windows(2).all(|w| w[0] < w[1]));
    // every evaluated surface is reported (the first pass and the refinement)
    assert!(*events.last().unwrap() >= reported.search().len());
}

#[test]
fn a_cancelled_run_stops_with_the_cancellation_error() {
    let token = CancelToken::new();
    token.cancel();
    let mut ctx = RunCtx {
        cancel: Some(&token),
        ..RunCtx::default()
    };
    let mut s = slope_of("V001");
    let e = analyse_slope(&mut s, &mut ctx).unwrap_err();
    assert_eq!(e.kind, ErrorKind::Cancelled);
    assert_eq!(e.message, "The analysis was cancelled.");
    // a progress callback that breaks cancels too
    let mut stop = |_: ProgressEvent| ControlFlow::Break(());
    let mut ctx = RunCtx {
        progress: Some(&mut stop),
        ..RunCtx::default()
    };
    let mut s = slope_of("V001");
    assert_eq!(
        analyse_slope(&mut s, &mut ctx).unwrap_err().kind,
        ErrorKind::Cancelled
    );
}

#[test]
fn reused_scratch_equals_fresh_scratch() {
    for id in CASES {
        let (_, s) = run(id, &mut RunCtx::default());
        let fresh: Vec<SearchPlane> = s
            .search()
            .iter()
            .take(300)
            .map(|p| SearchPlane {
                fos: None,
                slices: None,
                ..p.clone()
            })
            .collect();
        let mut together = fresh.clone();
        evaluate_planes(&s, &mut together).unwrap();
        let mut one_by_one = fresh;
        for p in one_by_one.iter_mut() {
            evaluate_planes(&s, std::slice::from_mut(p)).unwrap();
        }
        assert_eq!(bits(&together), bits(&one_by_one), "{id}");
    }
}

#[test]
fn analysing_a_clone_equals_analysing_the_original() {
    for id in CASES {
        let mut original = slope_of(id);
        let mut copy = original.clone();
        let f0 = analyse_slope(&mut original, &mut RunCtx::default()).unwrap();
        let f1 = analyse_slope(&mut copy, &mut RunCtx::default()).unwrap();
        assert_eq!(f0.map(f64::to_bits), f1.map(f64::to_bits), "{id}");
        assert_eq!(bits(original.search()), bits(copy.search()), "{id}");
    }
}
