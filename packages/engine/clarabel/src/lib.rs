//! Clarabel (Goulart & Chen 2024, arXiv:2405.12762) for WebAssembly with a C
//! ABI, for the limit analysis bounds (src/fem/conic.ts): minimise qᵀx subject
//! to Ax + s = b, s in a product of cones, A in compressed sparse columns. The
//! cones come as (kind, dimension) pairs: 0 zero, 1 nonnegative, 2 second order.
use clarabel::algebra::*;
use clarabel::solver::*;

#[no_mangle]
pub extern "C" fn alloc_f64(n: usize) -> *mut f64 {
    let mut v = vec![0.0f64; n];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn alloc_u32(n: usize) -> *mut u32 {
    let mut v = vec![0u32; n];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `p` must come from `alloc_f64(n)`.
#[no_mangle]
pub unsafe extern "C" fn free_f64(p: *mut f64, n: usize) {
    drop(Vec::from_raw_parts(p, n, n));
}

/// # Safety
/// `p` must come from `alloc_u32(n)`.
#[no_mangle]
pub unsafe extern "C" fn free_u32(p: *mut u32, n: usize) {
    drop(Vec::from_raw_parts(p, n, n));
}

/// Solve; returns Clarabel's SolverStatus as a number and writes x (n values),
/// the objective, the iteration count and the dual z (m values) to `out`
/// (n + 2 + m values).
///
/// # Safety
/// The pointers must hold the stated number of values.
#[no_mangle]
pub unsafe extern "C" fn solve(
    n: usize, m: usize, q: *const f64,
    colptr: *const u32, rowval: *const u32, nzval: *const f64, nnz: usize,
    b: *const f64, cones: *const u32, ncones: usize,
    max_iter: u32, time_limit: f64, static_reg: f64, out: *mut f64,
) -> u32 {
    let q = std::slice::from_raw_parts(q, n).to_vec();
    let b = std::slice::from_raw_parts(b, m).to_vec();
    let colptr: Vec<usize> = std::slice::from_raw_parts(colptr, n + 1).iter().map(|&v| v as usize).collect();
    let rowval: Vec<usize> = std::slice::from_raw_parts(rowval, nnz).iter().map(|&v| v as usize).collect();
    let nzval = std::slice::from_raw_parts(nzval, nnz).to_vec();
    let a = CscMatrix::new(m, n, colptr, rowval, nzval);
    let p = CscMatrix::zeros((n, n));
    let cs = std::slice::from_raw_parts(cones, 2 * ncones);
    let k: Vec<SupportedConeT<f64>> = (0..ncones)
        .map(|i| {
            let d = cs[2 * i + 1] as usize;
            match cs[2 * i] {
                0 => ZeroConeT(d),
                1 => NonnegativeConeT(d),
                _ => SecondOrderConeT(d),
            }
        })
        .collect();
    let settings = DefaultSettingsBuilder::default()
        .verbose(false)
        .max_iter(max_iter)
        .time_limit(time_limit)
        .static_regularization_constant(static_reg)
        .build()
        .unwrap();
    let mut solver = match DefaultSolver::new(&p, &q, &a, &b, &k, settings) {
        Ok(s) => s,
        Err(_) => return 99,
    };
    solver.solve();
    let out = std::slice::from_raw_parts_mut(out, n + 2 + m);
    out[..n].copy_from_slice(&solver.solution.x);
    out[n] = solver.solution.obj_val;
    out[n + 1] = solver.solution.iterations as f64;
    out[n + 2..].copy_from_slice(&solver.solution.z);
    solver.solution.status as u32
}
