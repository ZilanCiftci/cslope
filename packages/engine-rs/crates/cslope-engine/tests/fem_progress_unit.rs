//! The stages the app's finite element analysis reports to its progress
//! (`ProgressEvent::FemStage`): in order, and without changing the result.

use cslope_engine::api::ctx::{FemStage, ProgressEvent, RunCtx};
use cslope_engine::error::ErrorKind;
use cslope_engine::fem::summary::run_fem_summary_with_bounds;
use cslope_engine::types::{FemAnalysisSettings, FlowRule, SlopeDefinition};
use serde_json::json;
use std::ops::ControlFlow;

fn definition() -> SlopeDefinition {
    serde_json::from_value(json!({
        "coordinates": [[0, 0], [0, 10], [10, 10], [15, 5], [30, 5], [30, 0]],
        "materials": [{ "name": "Clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 20 } }],
    }))
    .unwrap()
}

fn settings() -> FemAnalysisSettings {
    let mut s = cslope_engine::types::default_fem_settings();
    s.enabled = true;
    s.flow_rule = FlowRule::NonAssociated;
    s.element_size = Some(3.0);
    s.refinement_levels = 0.0;
    s.tension_cutoff = false;
    s.limit_analysis = Some(true);
    s
}

#[derive(Debug, PartialEq)]
enum Seen {
    Stage(FemStage),
    Trial,
    Level,
}

#[test]
fn reports_the_stages_in_order_without_changing_the_result() {
    let mut seen: Vec<Seen> = Vec::new();
    let mut progress = |e: ProgressEvent| {
        seen.push(match e {
            ProgressEvent::FemStage(s) => Seen::Stage(s),
            ProgressEvent::FemTrial(_) => Seen::Trial,
            ProgressEvent::Bounds(_) => Seen::Level,
            _ => return ControlFlow::Continue(()),
        });
        ControlFlow::Continue(())
    };
    let with = run_fem_summary_with_bounds(
        &definition(),
        &settings(),
        &mut RunCtx {
            progress: Some(&mut progress),
            ..RunCtx::default()
        },
    )
    .unwrap();
    let without =
        run_fem_summary_with_bounds(&definition(), &settings(), &mut RunCtx::default()).unwrap();
    assert_eq!(with.factor_of_safety, without.factor_of_safety);
    let (wb, nb) = (with.bounds.unwrap(), without.bounds.unwrap());
    assert_eq!((wb.lower, wb.upper), (nb.lower, nb.upper));
    assert_eq!(wb.davis, nb.davis);

    // the mesh, then the strength reduction's trials on the first mesh
    assert_eq!(seen[0], Seen::Stage(FemStage::Mesh));
    assert_eq!(
        seen[1],
        Seen::Stage(FemStage::StrengthReduction { mesh: 0, meshes: 1 })
    );
    assert_eq!(seen[2], Seen::Trial);
    // each bound's search announced before its level is reported, the
    // associated bounds before Davis B's
    let stages: Vec<FemStage> = seen
        .iter()
        .filter_map(|s| match s {
            Seen::Stage(s) => Some(*s),
            _ => None,
        })
        .collect();
    let first_bound = stages
        .iter()
        .position(|s| matches!(s, FemStage::UpperBound { .. }))
        .unwrap();
    assert_eq!(
        stages[first_bound],
        FemStage::UpperBound {
            mesh: 0,
            meshes: 4,
            davis: false
        }
    );
    assert_eq!(
        stages[first_bound + 1],
        FemStage::LowerBound {
            mesh: 0,
            meshes: 4,
            davis: false
        }
    );
    let first_davis = stages
        .iter()
        .position(|s| matches!(s, FemStage::UpperBound { davis: true, .. }))
        .unwrap();
    assert!(first_davis > first_bound + 1);
    assert!(stages[first_davis..].iter().all(|s| matches!(
        s,
        FemStage::UpperBound { davis: true, .. } | FemStage::LowerBound { davis: true, .. }
    )));
    let levels = seen.iter().filter(|s| **s == Seen::Level).count();
    let bound_stages = stages.len() - first_bound;
    assert_eq!(bound_stages, 2 * levels);
    // JSON as the app reads it
    assert_eq!(
        serde_json::to_value(stages[first_bound + 1]).unwrap(),
        json!({ "stage": "lowerBound", "mesh": 0, "meshes": 4, "davis": false })
    );
    assert_eq!(
        serde_json::to_value(FemStage::Mesh).unwrap(),
        json!({ "stage": "mesh" })
    );
}

#[test]
fn a_stage_callback_that_breaks_cancels_the_run() {
    let mut progress = |e: ProgressEvent| match e {
        ProgressEvent::FemStage(FemStage::UpperBound { .. }) => ControlFlow::Break(()),
        _ => ControlFlow::Continue(()),
    };
    let r = run_fem_summary_with_bounds(
        &definition(),
        &settings(),
        &mut RunCtx {
            progress: Some(&mut progress),
            ..RunCtx::default()
        },
    );
    assert_eq!(r.unwrap_err().kind, ErrorKind::Cancelled);
}
