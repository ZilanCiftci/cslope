//! fem/sparse.rs: differential tests against fixtures/fem-leaves/sparse-*.json
//! (the matrices factorised in real runs: V055's elastic stiffness, V099's
//! seepage), and the TypeScript unit tests (fem/model.test.ts,
//! "SparseCholesky").
#![allow(clippy::needless_range_loop)]

mod common;

use cslope_engine::js::math as jsm;

use common::{load, num};
use cslope_engine::fem::sparse::{nested_dissection, node_graph, SparseCholesky};
use serde_json::Value;
use std::time::Instant;

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
fn i64s(v: &Value) -> Vec<i64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_i64().unwrap())
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

fn check_case(name: &str) {
    let fx: Value = load("fem-leaves", &format!("sparse-{name}"));
    let (x, y) = (f64s(&fx["x"]), f64s(&fx["y"]));
    let el = usizes(&fx["el"]);
    let ne = fx["ne"].as_u64().unwrap() as usize;
    let adj = node_graph(&el, ne, x.len());
    let eadj: Vec<Vec<usize>> = fx["adj"].as_array().unwrap().iter().map(usizes).collect();
    assert_eq!(adj, eadj, "{name}: node graph");
    let t0 = Instant::now();
    let perm = nested_dissection(&x, &y, &adj);
    let t_nd = t0.elapsed();
    assert_eq!(perm, usizes(&fx["perm"]), "{name}: nested dissection order");
    eprintln!(
        "{name}: nested dissection of {} nodes: {:.1} ms",
        x.len(),
        t_nd.as_secs_f64() * 1e3
    );

    let mut first: Option<SparseCholesky> = None;
    for (mi, m) in fx["matrices"].as_array().unwrap().iter().enumerate() {
        let n = m["n"].as_u64().unwrap() as usize;
        let size = m["size"].as_u64().unwrap() as usize;
        let groups = i64s(&m["groups"]);
        let t0 = Instant::now();
        let mut k = SparseCholesky::from_groups(n, &groups, size);
        let t_sym = t0.elapsed();
        assert_eq!(
            k.row_ptr(),
            usizes(&m["rowPtr"]).as_slice(),
            "{name} {mi}: rowPtr"
        );
        assert_eq!(
            k.row_cols(),
            usizes(&m["rowCols"]).as_slice(),
            "{name} {mi}: rowCols"
        );
        assert_eq!(k.l_ptr(), usizes(&m["lp"]).as_slice(), "{name} {mi}: Lp");
        assert_eq!(k.l_rows(), usizes(&m["li"]).as_slice(), "{name} {mi}: Li");
        assert_eq!(
            k.etree(),
            i64s(&m["parent"]).as_slice(),
            "{name} {mi}: parent"
        );
        let f = &m["factor"];
        if f.is_null() {
            continue;
        }
        k.values = f64s(&f["values"]);
        let t0 = Instant::now();
        let r = k.factor();
        let t_num = t0.elapsed();
        match f["error"].as_str() {
            Some(msg) => {
                assert_eq!(r.unwrap_err().message, msg);
                continue;
            }
            None => r.unwrap(),
        }
        assert_values(k.l_values(), &f64s(&f["lx"]), &format!("{name} {mi}: L"));
        let mut t_solve = 0.0;
        for (si, s) in f["solves"].as_array().unwrap().iter().enumerate() {
            let mut b = f64s(&s["b"]);
            let t0 = Instant::now();
            k.solve(&mut b);
            t_solve = t0.elapsed().as_secs_f64();
            assert_values(&b, &f64s(&s["x"]), &format!("{name} {mi}: solve {si}"));
        }
        eprintln!(
            "{name} matrix {mi}: n = {n}, nnz(L) = {}: symbolic {:.1} ms, factor {:.1} ms, solve {:.2} ms",
            k.l_rows().len(),
            t_sym.as_secs_f64() * 1e3,
            t_num.as_secs_f64() * 1e3,
            t_solve * 1e3
        );
        if first.is_none() {
            first = Some(k);
        }
    }

    // Timing (information): medians of repeated factorisations and solves of
    // the first matrix, against the TypeScript engine's on the same machine.
    if let (Some(k), Some(bench)) = (first.as_ref(), fx.get("bench").filter(|b| !b.is_null())) {
        let mut k = k.clone();
        let median = |f: &mut dyn FnMut(), reps: usize| {
            let mut t: Vec<f64> = (0..reps)
                .map(|_| {
                    let t0 = Instant::now();
                    f();
                    t0.elapsed().as_secs_f64() * 1e3
                })
                .collect();
            t.sort_by(|a, b| a.partial_cmp(b).unwrap());
            t[reps >> 1]
        };
        let factor_ms = median(&mut || k.factor().unwrap(), 7);
        let b: Vec<f64> = (0..k.n).map(|i| jsm::cos(0.1 * i as f64)).collect();
        let solve_ms = median(
            &mut || {
                let mut x = b.clone();
                k.solve(&mut x);
            },
            21,
        );
        eprintln!(
            "{name} benchmark, n = {}: factor {factor_ms:.2} ms (TypeScript {:.2} ms), solve {solve_ms:.3} ms (TypeScript {:.3} ms)",
            k.n,
            num(&bench["factorMs"]),
            num(&bench["solveMs"])
        );
    }

    // LU of an unsymmetric matrix of the first pattern.
    let lu = &fx["lu"];
    if !lu.is_null() {
        let mut k = first.expect("a factorised matrix").empty_copy(true);
        k.values = f64s(&lu["values"]);
        k.upper = Some(f64s(&lu["upper"]));
        k.factor().unwrap();
        assert_values(k.l_values(), &f64s(&lu["lx"]), &format!("{name} LU: L"));
        assert_values(
            k.u_values().unwrap(),
            &f64s(&lu["ux"]),
            &format!("{name} LU: U"),
        );
        let mut b = f64s(&lu["b"]);
        k.solve(&mut b);
        assert_values(&b, &f64s(&lu["x"]), &format!("{name} LU: solve"));
    }
}

#[test]
fn sparse_v055_elastic_stiffness() {
    check_case("V055");
}

#[test]
fn sparse_v099_seepage() {
    check_case("V099");
}

/// `add` on an unsymmetric matrix adds to both triangles, and positions match the pattern.
#[test]
fn add_and_index_of() {
    let groups: Vec<i64> = vec![0, 1, 2, -1, 2, 3];
    let k = SparseCholesky::from_groups(4, &groups, 3);
    let mut u = k.empty_copy(true);
    u.add(2, 1, 0.5).unwrap();
    u.add(1, 1, 2.0).unwrap();
    let p = u.index_of(1, 2).unwrap();
    assert_eq!(p, u.index_of(2, 1).unwrap());
    assert_eq!(u.values[p], 0.5);
    assert_eq!(u.upper.as_ref().unwrap()[p], 0.5);
    let d = u.index_of(1, 1).unwrap();
    assert_eq!(d, u.diag[1]);
    assert_eq!(u.upper.as_ref().unwrap()[d], 0.0);
    assert_eq!(
        u.index_of(3, 0).unwrap_err().message,
        "entry (3, 0) is outside the matrix pattern"
    );
    assert_eq!(
        u.add(0, 3, 1.0).unwrap_err().message,
        "entry (3, 0) is outside the matrix pattern"
    );
}

// fem/model.test.ts: "solves a positive definite system on a grid in nested dissection order"
#[test]
fn solves_a_positive_definite_system_on_a_grid_in_nested_dissection_order() {
    // 2 unknowns per node of a 9 × 7 grid, coupled within each cell's 4 nodes.
    let (nx, ny) = (9usize, 7usize);
    let nn = nx * ny;
    let x: Vec<f64> = (0..nn).map(|i| (i % nx) as f64).collect();
    let y: Vec<f64> = (0..nn).map(|i| (i / nx) as f64).collect();
    let mut cells: Vec<usize> = Vec::new();
    for j in 0..ny - 1 {
        for i in 0..nx - 1 {
            cells.extend_from_slice(&[
                j * nx + i,
                j * nx + i + 1,
                (j + 1) * nx + i + 1,
                (j + 1) * nx + i,
            ]);
        }
    }
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); nn];
    for c in (0..cells.len()).step_by(4) {
        for a in 0..4 {
            for b in 0..4 {
                if a != b && !adj[cells[c + a]].contains(&cells[c + b]) {
                    adj[cells[c + a]].push(cells[c + b]);
                }
            }
        }
    }
    let perm = nested_dissection(&x, &y, &adj);
    let mut sorted = perm.clone();
    sorted.sort();
    assert_eq!(sorted, (0..nn).collect::<Vec<_>>());
    let mut pos = vec![0usize; nn];
    for (k, &v) in perm.iter().enumerate() {
        pos[v] = k;
    }
    let n = 2 * nn;
    let mut groups = vec![0i64; 2 * cells.len()];
    for (k, &v) in cells.iter().enumerate() {
        groups[2 * k] = 2 * pos[v] as i64;
        groups[2 * k + 1] = 2 * pos[v] as i64 + 1;
    }
    let mut k = SparseCholesky::from_groups(n, &groups, 8);
    // dense reference: diagonally dominant within the pattern
    let mut dense = vec![vec![0.0f64; n]; n];
    for c in (0..groups.len()).step_by(8) {
        for a in 0..8 {
            for b in 0..8 {
                let (i, j) = (groups[c + a] as usize, groups[c + b] as usize);
                dense[i][j] += if i == j {
                    10.0
                } else {
                    -0.1 - ((i + 2 * j + i * j) % 3) as f64 * 0.05
                };
            }
        }
    }
    for i in 0..n {
        for j in 0..i {
            let v = (dense[i][j] + dense[j][i]) / 2.0;
            dense[i][j] = v;
            dense[j][i] = v;
        }
    }
    for i in 0..n {
        for j in 0..=i {
            if dense[i][j] != 0.0 {
                k.add(i, j, dense[i][j]).unwrap();
            }
        }
    }
    k.factor().unwrap();
    let x_true: Vec<f64> = (0..n).map(|i| jsm::sin(i as f64)).collect();
    let mut b = vec![0.0; n];
    for i in 0..n {
        for j in 0..n {
            b[i] += dense[i][j] * x_true[j];
        }
    }
    k.solve(&mut b);
    for i in 0..n {
        assert!(
            (b[i] - x_true[i]).abs() < 5e-11,
            "{i}: {} vs {}",
            b[i],
            x_true[i]
        );
    }
    // a copy shares the pattern and starts from zero
    let mut k2 = k.empty_copy(false);
    assert!(k2.values.iter().all(|&v| v == 0.0));
    let err = k2.factor().unwrap_err();
    assert!(err.message.contains("not positive definite"), "{err}");
    assert!(!k2.factored);
}

// fem/model.test.ts: "solves an unsymmetric system with the same pattern by LU"
#[test]
fn solves_an_unsymmetric_system_with_the_same_pattern_by_lu() {
    let (nx, ny) = (7usize, 5usize);
    let nn = nx * ny;
    let mut groups: Vec<i64> = Vec::new();
    for j in 0..ny - 1 {
        for i in 0..nx - 1 {
            groups.extend(
                [
                    j * nx + i,
                    j * nx + i + 1,
                    (j + 1) * nx + i + 1,
                    (j + 1) * nx + i,
                ]
                .map(|v| v as i64),
            );
        }
    }
    let mut k = SparseCholesky::from_groups(nn, &groups, 4).empty_copy(true);
    let mut dense = vec![vec![0.0f64; nn]; nn];
    for c in (0..groups.len()).step_by(4) {
        for a in 0..4 {
            for b in 0..4 {
                let (i, j) = (groups[c + a] as usize, groups[c + b] as usize);
                dense[i][j] += if i == j {
                    4.0
                } else {
                    -0.3 + 0.2 * jsm::sin((3 * i + j) as f64)
                };
            }
        }
    }
    // entries below the diagonal in `values`, above it in `upper` at the lower entry's position
    for i in 0..nn {
        for j in 0..nn {
            if dense[i][j] == 0.0 {
                continue;
            }
            let p = k.index_of(i, j).unwrap();
            if j <= i {
                k.values[p] += dense[i][j];
            } else {
                k.upper.as_mut().unwrap()[p] += dense[i][j];
            }
        }
    }
    // `add` is a symmetric contribution: both triangles
    k.add(3, 2, 0.5).unwrap();
    dense[3][2] += 0.5;
    dense[2][3] += 0.5;
    k.factor().unwrap();
    let x_true: Vec<f64> = (0..nn).map(|i| jsm::cos(i as f64)).collect();
    let mut b = vec![0.0; nn];
    for i in 0..nn {
        for j in 0..nn {
            b[i] += dense[i][j] * x_true[j];
        }
    }
    k.solve(&mut b);
    for i in 0..nn {
        assert!(
            (b[i] - x_true[i]).abs() < 5e-11,
            "{i}: {} vs {}",
            b[i],
            x_true[i]
        );
    }
}

#[test]
fn zero_pivot_of_lu() {
    let groups: Vec<i64> = vec![0, 1];
    let mut k = SparseCholesky::from_groups(2, &groups, 2).empty_copy(true);
    k.add(0, 0, 1.0).unwrap();
    k.add(1, 0, 1.0).unwrap();
    k.add(1, 1, 1.0).unwrap();
    assert_eq!(k.factor().unwrap_err().message, "zero pivot at equation 1");
    assert!(!k.factored);
}
