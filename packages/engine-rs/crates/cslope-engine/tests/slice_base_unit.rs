//! The experiment switch for the slice base of a circle (not a port: see
//! PORTING.md "Slice base of a circle"): the default is the arc-consistent
//! base; `SliceBase::Chord` gives the conventional straight chord, and
//! `SliceBase::ChordEven` the chord without the steep ends of the circle
//! cut into narrower slices. Checked on Low (1989)'s published circle
//! (V068), whose entry is nearly vertical.
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::model::slices::{slice_base, with_slice_base, SliceBase};
use serde_json::{json, Value};
use solvers_support::run_verification;

fn v068() -> Value {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../golden/verification.json");
    let golden: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    golden["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "V068")
        .expect("V068 in the golden file")["definition"]
        .clone()
}

fn rel(a: f64, b: f64) -> f64 {
    ((a - b) / b).abs()
}

#[test]
fn chord_base_changes_a_known_value_and_the_default_is_the_arc() {
    assert_eq!(
        slice_base(),
        SliceBase::Arc,
        "the default (no CSLOPE_SLICE_BASE in the test environment)"
    );
    let (arc, slope) = run_verification(v068(), "Bishop", json!({}));
    let arc = arc.unwrap();
    // Every slice of the circle: the arc is longer than the chord, and the
    // base point (the arc at the slice's middle) lies below the chord.
    let plane = &slope.search()[0];
    for s in plane.slices.as_ref().unwrap() {
        let chord = s.width / s.alpha.cos();
        assert!(
            s.base_length > chord,
            "arc {} > chord {}",
            s.base_length,
            chord
        );
        assert!(s.y_bottom < (s.y0_bottom + s.y1_bottom) / 2.0);
    }
    let (chord, slope) = with_slice_base(SliceBase::Chord, || {
        run_verification(v068(), "Bishop", json!({}))
    });
    let chord = chord.unwrap();
    let plane = &slope.search()[0];
    for s in plane.slices.as_ref().unwrap() {
        assert!(rel(s.base_length, s.width / s.alpha.cos()) < 1e-12);
        assert!((s.y_bottom - (s.y0_bottom + s.y1_bottom) / 2.0).abs() < 1e-12);
    }
    let (even, slope) = with_slice_base(SliceBase::ChordEven, || {
        run_verification(v068(), "Bishop", json!({}))
    });
    let even = even.unwrap();
    let n_even = slope.search()[0].slices.as_ref().unwrap().len();
    assert_eq!(slice_base(), SliceBase::Arc, "the override is undone");
    // Measured 2026-11-04 (the arc value is the golden one): the chord
    // moves F by -0.004 % here; the steep end slices matter far more.
    assert!(rel(arc, 1.142_858_9) < 1e-6, "arc {arc}");
    assert!(rel(chord, 1.142_808_9) < 1e-6, "chord {chord}");
    assert!(rel(even, 1.163_118_9) < 1e-6, "chord-even {even}");
    assert_eq!(n_even, 50, "the nominal slices only, no steep ends cut");
}
