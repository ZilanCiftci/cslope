//! fem/sparse.rs: the TypeScript unit tests (fem/model.test.ts,
//! "SparseCholesky"), ported. (The differential tests against the TypeScript engine's fixtures were removed with it at the cutover, PORTING.md.)
#![allow(clippy::needless_range_loop)]

mod common;

use cslope_engine::js::math as jsm;

use cslope_engine::fem::sparse::{nested_dissection, SparseCholesky};

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
