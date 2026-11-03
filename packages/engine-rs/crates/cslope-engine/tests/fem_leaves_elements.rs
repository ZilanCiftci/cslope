//! fem/elements.rs and fem/anderson.rs: differential tests against
//! fixtures/fem-leaves/{elements,anderson}.json, and the TypeScript unit
//! tests of anderson.ts (fem/anderson.test.ts).
#![allow(clippy::needless_range_loop)]

mod common;

use cslope_engine::js::math as jsm;

use common::{load, num};
use cslope_engine::fem::anderson::Anderson;
use cslope_engine::fem::elements::{
    gauss_data, lame, shape_deriv_t6, shape_t6, stiffness_t6, GAUSS_T6, GP_STRIDE,
};
use serde_json::Value;

fn f64s(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(num).collect()
}
fn usizes(v: &Value) -> Vec<usize> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_u64().unwrap() as usize)
        .collect()
}

/// Agreement to 1e-9 relative (PORTING.md tolerance for the FE leaves'
/// values), with an absolute floor of 1e-9 of the array's largest finite
/// value for entries near zero. (Measured: equal, bit for bit.)
#[track_caller]
fn assert_values(a: &[f64], b: &[f64], what: &str) {
    assert_eq!(a.len(), b.len(), "{what}: length");
    let scale = b
        .iter()
        .filter(|v| v.is_finite())
        .fold(0.0f64, |m, v| jsm::max(m, v.abs()));
    for i in 0..a.len() {
        let tol = 1e-9 * jsm::max(jsm::max(a[i].abs(), b[i].abs()), scale);
        let ok = a[i] == b[i] || (a[i].is_nan() && b[i].is_nan()) || (a[i] - b[i]).abs() <= tol;
        assert!(ok, "{what}[{i}]: {} vs {}", a[i], b[i]);
    }
}

#[test]
fn shape_functions_and_derivatives() {
    let fx: Value = load("fem-leaves", "elements");
    assert_eq!(fx["gpStride"].as_u64().unwrap() as usize, GP_STRIDE);
    for (i, s) in fx["shapes"].as_array().unwrap().iter().enumerate() {
        let (xi, eta) = (num(&s["xi"]), num(&s["eta"]));
        let mut n = [0.0; 6];
        let mut d = [0.0; 12];
        shape_t6(xi, eta, &mut n);
        shape_deriv_t6(xi, eta, &mut d);
        assert_values(&n, &f64s(&s["n"]), &format!("N at point {i}"));
        assert_values(&d, &f64s(&s["d"]), &format!("dN at point {i}"));
    }
}

#[test]
fn gauss_data_stiffness_and_lame() {
    let fx: Value = load("fem-leaves", "elements");
    let (x, y) = (f64s(&fx["x"]), f64s(&fx["y"]));
    let el = usizes(&fx["el"]);
    let ne = fx["ne"].as_u64().unwrap() as usize;
    let gp = gauss_data(&x, &y, &el, ne).unwrap();
    assert_values(&gp, &f64s(&fx["gauss"]), "Gauss data");
    let mut ke = vec![0.0; 144];
    for s in fx["stiffness"].as_array().unwrap() {
        let e = s["e"].as_u64().unwrap() as usize;
        stiffness_t6(&gp, e, num(&s["E"]), num(&s["nu"]), &mut ke);
        assert_values(&ke, &f64s(&s["ke"]), &format!("Ke of element {e}"));
    }
    for l in fx["lames"].as_array().unwrap() {
        let r = lame(num(&l["E"]), num(&l["nu"]));
        assert_values(
            &[r.lambda, r.mu],
            &[num(&l["lambda"]), num(&l["mu"])],
            "Lamé",
        );
    }
    let bad = usizes(&fx["bad"]["el"]);
    assert_eq!(
        gauss_data(&x, &y, &bad, 2).unwrap_err().message,
        fx["bad"]["error"].as_str().unwrap()
    );
}

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

#[test]
fn anderson_steps() {
    let cases: Vec<Value> = load("fem-leaves", "anderson");
    for c in &cases {
        let name = c["name"].as_str().unwrap();
        let (n, m, r0) = (
            c["n"].as_u64().unwrap() as usize,
            c["m"].as_u64().unwrap() as usize,
            c["residualStart"].as_u64().unwrap() as usize,
        );
        let mut aa = Anderson::new(n, m, r0);
        for (k, s) in c["steps"].as_array().unwrap().iter().enumerate() {
            if s["reset"].as_bool().unwrap() {
                aa.reset();
            }
            let x = f64s(&s["x"]);
            let mut g = f64s(&s["g"]);
            aa.step(&x, &mut g);
            assert_values(&g, &f64s(&s["out"]), &format!("{name}: step {k}"));
        }
    }
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
