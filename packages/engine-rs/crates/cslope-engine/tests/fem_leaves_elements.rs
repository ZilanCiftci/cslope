//! fem/elements.rs and fem/anderson.rs: the TypeScript unit tests of
//! anderson.ts (fem/anderson.test.ts), ported.
//! (The differential tests against the TypeScript engine's fixtures were removed with it at the cutover, PORTING.md.)
#![allow(clippy::needless_range_loop)]

mod common;

use cslope_engine::js::math as jsm;

use cslope_engine::fem::anderson::Anderson;
use cslope_engine::fem::elements::GAUSS_T6;

#[test]
fn gauss_rule_integrates_quadratics() {
    // Σ w = 1/2 (reference area); ∫ ξ² = 1/12, ∫ ξη = 1/24
    let (mut w, mut xx, mut xy) = (0.0, 0.0, 0.0);
    for [xi, eta, wt] in GAUSS_T6 {
        w += wt;
        xx += wt * xi * xi;
        xy += wt * xi * eta;
    }
    assert!(
        (w - 0.5).abs() < 1e-15
            && (xx - 1.0 / 12.0).abs() < 1e-15
            && (xy - 1.0 / 24.0).abs() < 1e-15
    );
}

// fem/anderson.test.ts: "accelerates a slowly contracting linear fixed-point iteration"
#[test]
fn accelerates_a_slowly_contracting_linear_fixed_point_iteration() {
    // G(x) = A x + b with a contraction of 0.99 along one direction
    let n = 20;
    let g_of = |x: &[f64]| -> Vec<f64> {
        (0..n)
            .map(|i| (if i == 0 { 0.99 } else { 0.5 }) * x[i] + 1.0)
            .collect()
    };
    let solution = |i: usize| 1.0 / (1.0 - if i == 0 { 0.99 } else { 0.5 });
    let run = |accelerate: bool| -> f64 {
        let mut aa = Anderson::new(n, 5, 0);
        let mut x = vec![0.0; n];
        for k in 1..=2000 {
            let mut g = g_of(&x);
            if accelerate {
                aa.step(&x, &mut g);
            }
            x = g;
            let mut err = 0.0f64;
            for i in 0..n {
                err = jsm::max(err, (x[i] - solution(i)).abs());
            }
            if err < 1e-8 {
                return k as f64;
            }
        }
        f64::INFINITY
    };
    let (plain, fast) = (run(false), run(true));
    assert!(plain > 1500.0, "plain {plain}");
    assert!(fast < 30.0, "accelerated {fast}");
}

// fem/anderson.test.ts: "measures the residual on a part of the vector and mixes all of it"
#[test]
fn measures_the_residual_on_a_part_of_the_vector_and_mixes_all_of_it() {
    // x = (a, b): G(a, b) = (2 b, 0.9 b + 1), the residual on b alone
    let mut aa = Anderson::new(2, 3, 1);
    let mut x = vec![0.0, 0.0];
    for _ in 0..20 {
        let mut g = vec![2.0 * x[1], 0.9 * x[1] + 1.0];
        aa.step(&x, &mut g);
        x = g;
    }
    // toBeCloseTo(10, 6) and toBeCloseTo(20, 4)
    assert!((x[1] - 10.0).abs() < 5e-7, "{}", x[1]);
    assert!((x[0] - 20.0).abs() < 5e-5, "{}", x[0]);
}
