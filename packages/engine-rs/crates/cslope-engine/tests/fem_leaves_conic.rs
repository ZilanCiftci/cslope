//! fem/conic.rs: differential tests against fixtures/fem-leaves/conic-*.json:
//! small programs built by ProgramBuilder (every status), and the lower and
//! upper bound programs of verification problems with the TypeScript engine's
//! Clarabel (the same crate version compiled to WebAssembly) solutions.
#![allow(clippy::needless_range_loop)]

mod common;

use cslope_engine::js::math as jsm;

use common::{load, num};
use cslope_engine::fem::conic::{
    affine, solve_clarabel, ConicProgram, ConicStatus, Polygon, ProgramBuilder, Sense,
};
use serde_json::Value;
use std::time::Instant;

fn f64s(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(num).collect()
}

fn status_of(v: &Value) -> ConicStatus {
    serde_json::from_value(v.clone()).unwrap()
}

/// The small programs of the fixture script, built the same way.
fn small_program(name: &str) -> ConicProgram {
    let mut pb = ProgramBuilder::new();
    let socp = |pb: &mut ProgramBuilder| {
        let sx = pb.col("sx", false, 10.0);
        let sy = pb.col("sy", false, 10.0);
        let txy = pb.col("txy", false, 1.0);
        let lam = pb.col("lam", true, 1.0);
        pb.sense = Sense::Max;
        pb.add_objective(lam, 1.0);
        pb.add_objective(lam, 0.5);
        pb.add_objective(sx, 0.0);
        pb.eq(&[(sx, 1.0), (sy, 1.0), (sx, 0.0), (lam, -1.0)], 0.0);
        pb.eq(&[(txy, 1.0), (txy, -0.25), (lam, -0.5)], 0.1);
        pb.cone(
            affine(&[(sx, -0.5), (sy, -0.5)], 2.0),
            affine(&[(sx, 1.0), (sy, -1.0), (sx, 0.5), (sx, -0.5)], 0.0),
            affine(&[(txy, 2.0)], 0.0),
            Polygon::Facets,
        );
        pb.cone(
            affine(&[], 3.0),
            affine(&[(sx, 0.5)], 0.0),
            affine(&[(sy, 0.5)], 0.0),
            Polygon::Vertices,
        );
        assert_eq!(pb.col("sx", false, 1.0), sx);
        assert!(pb.has("lam") && !pb.has("nope"));
    };
    match name {
        "socp" => socp(&mut pb),
        "socp min" => {
            socp(&mut pb);
            pb.sense = Sense::Min;
        }
        "lp" => {
            let a = pb.col("a", true, 1.0);
            let b = pb.col("b", true, 100.0);
            pb.add_objective(a, 1.0);
            pb.add_objective(b, 2.0);
            pb.eq(&[(a, 1.0), (b, 1.0)], 3.0);
        }
        "infeasible" => {
            let a = pb.col("a", true, 1.0);
            pb.add_objective(a, 1.0);
            pb.eq(&[(a, 1.0)], -1.0);
        }
        "unbounded" => {
            let a = pb.col("a", false, 1.0);
            let b = pb.col("b", true, 1.0);
            pb.add_objective(a, 1.0);
            pb.eq(&[(a, 1.0), (b, 1.0)], 0.0);
        }
        "no objective" => {
            let a = pb.col("a", false, 1.0);
            let b = pb.col("b", false, 1.0);
            pb.eq(&[(a, 2.0), (b, -1.0)], 1.0);
            pb.cone(
                affine(&[(a, 1.0)], 1.0),
                affine(&[(b, 1.0)], 0.0),
                affine(&[], 0.5),
                Polygon::Facets,
            );
        }
        _ => panic!("unknown small program {name}"),
    }
    pb.build()
}

/// Differences between the Rust and TypeScript solutions.
#[derive(Default, Debug)]
struct Diff {
    objective_rel: f64,
    x_rel: f64,
    z_rel: f64,
}

fn max_rel(a: &[f64], b: &[f64]) -> f64 {
    assert_eq!(a.len(), b.len());
    let scale = jsm::max(b.iter().fold(0.0f64, |m, v| jsm::max(m, v.abs())), 1e-300);
    a.iter()
        .zip(b)
        .fold(0.0f64, |m, (p, q)| jsm::max(m, (p - q).abs()))
        / scale
}

fn compare(what: &str, rust: &cslope_engine::fem::conic::ConicSolution, ts: &Value) -> Diff {
    assert_eq!(rust.status, status_of(&ts["status"]), "{what}: status");
    assert_eq!(
        rust.detail,
        ts["detail"].as_str().unwrap(),
        "{what}: detail"
    );
    let obj = num(&ts["objective"]);
    let objective_rel = if obj.is_nan() {
        assert!(
            rust.objective.is_nan(),
            "{what}: objective {} vs NaN",
            rust.objective
        );
        0.0
    } else {
        (rust.objective - obj).abs() / jsm::max(obj.abs(), 1e-12)
    };
    Diff {
        objective_rel,
        x_rel: max_rel(&rust.x, &f64s(&ts["x"])),
        z_rel: max_rel(rust.z.as_ref().unwrap(), &f64s(&ts["z"])),
    }
}

#[test]
fn small_programs_build_and_solve_as_in_typescript() {
    let cases: Vec<Value> = load("fem-leaves", "conic-small");
    for c in &cases {
        let name = c["name"].as_str().unwrap();
        let prog = small_program(name);
        let expected: ConicProgram = serde_json::from_value(c["program"].clone()).unwrap();
        assert_eq!(prog, expected, "{name}: program");
        let sol = solve_clarabel(&prog, 300.0);
        let d = compare(name, &sol, &c["solution"]);
        eprintln!(
            "conic-small {name}: {} {}: {d:?}",
            sol.detail, sol.objective
        );
        assert!(
            d.objective_rel <= 1e-9 && d.x_rel <= 1e-9 && d.z_rel <= 1e-9,
            "{name}: {d:?}"
        );
    }
}

#[test]
fn affine_sums_columns_and_drops_zeros() {
    let a = affine(&[(3, 1.0), (1, 2.0), (3, -1.0), (2, 0.0), (1, 0.5)], 4.0);
    assert_eq!(a.cols, vec![1]);
    assert_eq!(a.vals, vec![2.5]);
    assert_eq!(a.c, 4.0);
    let b = affine(&[(5, f64::NAN), (0, -0.0)], 0.0);
    assert_eq!(b.cols, vec![5]);
    assert!(b.vals[0].is_nan());
}

fn bound_programs(id: &str) {
    let cases: Vec<Value> = load("fem-leaves", &format!("conic-{id}"));
    let mut worst = Diff::default();
    for c in &cases {
        let what = format!(
            "{id} {} bound, F = {}",
            c["bound"].as_str().unwrap(),
            num(&c["F"])
        );
        let prog: ConicProgram = serde_json::from_value(c["program"].clone()).unwrap();
        let t0 = Instant::now();
        let sol = solve_clarabel(&prog, num(&c["timeLimit"]));
        let secs = t0.elapsed().as_secs_f64();
        let d = compare(&what, &sol, &c["solution"]);
        eprintln!(
            "{what}: {} columns, {} cones: {} {:.12} | objective rel {:.1e}, x rel {:.1e}, z rel {:.1e} | Rust {secs:.2} s, TypeScript (WebAssembly) {:.2} s",
            prog.names.len(),
            prog.cones.len(),
            sol.detail,
            sol.objective,
            d.objective_rel,
            d.x_rel,
            d.z_rel,
            num(&c["seconds"])
        );
        // The same Clarabel version and arithmetic: agreement far inside the
        // solver's tolerances (1e-8; "almost" statuses 1e-4). (Measured: bit
        // for bit, V067's lower bound programs included, which end in
        // NumericalError and are solved again with static regularisation 1e-6.)
        assert!(
            d.objective_rel <= 1e-8 && d.x_rel <= 1e-6 && d.z_rel <= 1e-6,
            "{what}: {d:?}"
        );
        worst.objective_rel = jsm::max(worst.objective_rel, d.objective_rel);
        worst.x_rel = jsm::max(worst.x_rel, d.x_rel);
        worst.z_rel = jsm::max(worst.z_rel, d.z_rel);
    }
    eprintln!("{id}: largest differences {worst:?}");
}

#[test]
fn bound_programs_v055() {
    bound_programs("V055");
}

#[test]
fn bound_programs_v046a() {
    bound_programs("V046a");
}

#[test]
fn bound_programs_v067() {
    bound_programs("V067");
}
