//! The slice base of a circle (see PORTING.md "Slice base of a circle"):
//! the straight chord between the slice's two base points, with the base
//! shear's moment arm the perpendicular distance from the centre to the
//! chord, R·cos(Δθ/2), and the normal force's arm 0 (Fredlund & Krahn
//! 1977). Checked on Low (1989)'s published circle (V068), whose entry is
//! nearly vertical.
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

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
fn a_circle_s_slices_stand_on_chords_with_the_shear_arm_to_the_chord() {
    let (fos, slope) = run_verification(v068(), "Bishop", json!({}));
    assert!(fos.is_some());
    let plane = &slope.search()[0];
    let (cx, cy, radius) = (plane.cx, plane.cy, plane.radius);
    let slices = plane.slices.as_ref().unwrap();
    assert!(!slices.is_empty());
    for s in slices {
        // The chord: its length, its middle and its inclination.
        let (x0, x1) = (s.x_left, s.x_right);
        let (y0, y1) = (s.y0_bottom, s.y1_bottom);
        let chord = ((x1 - x0).powi(2) + (y1 - y0).powi(2)).sqrt();
        assert!(
            rel(s.base_length, chord) < 1e-12,
            "base length is the chord"
        );
        assert!((s.y_bottom - (y0 + y1) / 2.0).abs() < 1e-12);
        assert!((s.alpha - ((y0 - y1) / (x1 - x0)).atan()).abs() < 1e-12);
        // Both ends lie on the circle.
        assert!(rel(((x0 - cx).powi(2) + (y0 - cy).powi(2)).sqrt(), radius) < 1e-9);
        assert!(rel(((x1 - cx).powi(2) + (y1 - cy).powi(2)).sqrt(), radius) < 1e-9);
        // The shear arm: the perpendicular distance from the centre to the
        // chord, sqrt(R² − (chord/2)²) = R·cos(Δθ/2), below R.
        let to_chord = (radius * radius - chord * chord / 4.0).sqrt();
        assert!(
            rel(s.r, to_chord) < 1e-9,
            "arm {} to chord {}",
            s.r,
            to_chord
        );
        assert!(s.r < radius);
        assert_eq!(s.normal_arm, Some(0.0));
        assert_eq!(s.circular, Some(true));
    }
}
