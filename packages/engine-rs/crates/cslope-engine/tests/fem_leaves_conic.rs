//! fem/conic.rs: unit tests of the program builder.
//! (The differential tests against the TypeScript engine's fixtures were removed with it at the cutover, PORTING.md.)
#![allow(clippy::needless_range_loop)]

mod common;

use cslope_engine::fem::conic::affine;

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
