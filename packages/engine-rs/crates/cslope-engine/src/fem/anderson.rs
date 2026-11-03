//! Port of packages/engine/src/fem/anderson.ts.
//!
//! Anderson acceleration of a fixed-point iteration x ← G(x) (Anderson 1965,
//! J. ACM 12(4), 547–560; Walker & Ni 2011, SIAM J. Numer. Anal. 49(4),
//! 1715–1735, "Type II" with the residual f = G(x) − x): the next iterate
//! is G(x_k) − Σ γ_j ΔG_j, with γ minimising ‖f_k − Σ γ_j Δf_j‖ over the
//! last m differences.
//!
//! Implementation choices (not from the literature): the least squares
//! problem by its normal equations with a relative Tikhonov term of 10⁻¹⁰
//! on the trace, the Gram matrix of the differences kept and updated by one
//! row per iteration; the residual may be measured on a part of the vector
//! (`residual_start`): the viscoplastic iteration mixes its plastic strains
//! and body loads with the same coefficients and measures the residual on
//! the body loads (forces, one unit).

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use std::collections::VecDeque;

#[derive(Debug, Clone)]
pub struct Anderson {
    d_g: VecDeque<Vec<f64>>,
    d_f: VecDeque<Vec<f64>>,
    gram: VecDeque<VecDeque<f64>>,
    prev_g: Option<Vec<f64>>,
    prev_f: Option<Vec<f64>>,
    n: usize,
    m: usize,
    residual_start: usize,
}

impl Anderson {
    /// `n` unknowns, `m` differences kept, the residual measured from `residual_start` on (TypeScript default 0).
    pub fn new(n: usize, m: usize, residual_start: usize) -> Self {
        Anderson {
            d_g: VecDeque::new(),
            d_f: VecDeque::new(),
            gram: VecDeque::new(),
            prev_g: None,
            prev_f: None,
            n,
            m,
            residual_start,
        }
    }

    /// Forget the history (e.g. after the problem changed).
    pub fn reset(&mut self) {
        self.d_g.clear();
        self.d_f.clear();
        self.gram.clear();
        self.prev_g = None;
        self.prev_f = None;
    }

    /// One step: `x` the iterate that went in, `g` = G(x) that came out; `g`
    /// is overwritten by the accelerated next iterate.
    pub fn step(&mut self, x: &[f64], g: &mut [f64]) {
        let (n, m, r0) = (self.n, self.m, self.residual_start);
        let nr = n - r0;
        let f: Vec<f64> = (0..nr).map(|i| g[r0 + i] - x[r0 + i]).collect();
        let g_copy: Vec<f64> = g[..n].to_vec();
        if let (Some(prev_g), Some(prev_f)) = (self.prev_g.as_ref(), self.prev_f.as_ref()) {
            let dg: Vec<f64> = (0..n).map(|i| g_copy[i] - prev_g[i]).collect();
            let df: Vec<f64> = (0..nr).map(|i| f[i] - prev_f[i]).collect();
            if self.d_f.len() == m {
                self.d_g.pop_front();
                self.d_f.pop_front();
                self.gram.pop_front();
                for row in self.gram.iter_mut() {
                    row.pop_front();
                }
            }
            let mut row: VecDeque<f64> = VecDeque::with_capacity(self.d_f.len() + 1);
            for other in &self.d_f {
                let mut s = 0.0;
                for i in 0..nr {
                    s += df[i] * other[i];
                }
                row.push_back(s);
            }
            let mut self_dot = 0.0;
            for i in 0..nr {
                self_dot += df[i] * df[i];
            }
            for (k, gr) in self.gram.iter_mut().enumerate() {
                gr.push_back(row[k]);
            }
            row.push_back(self_dot);
            self.gram.push_back(row);
            self.d_g.push_back(dg);
            self.d_f.push_back(df);
        }
        self.prev_g = Some(g_copy);
        let k = self.d_f.len();
        if k == 0 {
            self.prev_f = Some(f);
            return;
        }
        let mut a = vec![0.0f64; k * k];
        let mut b = vec![0.0f64; k];
        let mut tr = 0.0;
        for ai in 0..k {
            for c in 0..k {
                a[ai * k + c] = self.gram[ai][c];
            }
            tr += a[ai * k + ai];
            let mut s = 0.0;
            let d = &self.d_f[ai];
            for i in 0..nr {
                s += d[i] * f[i];
            }
            b[ai] = s;
        }
        self.prev_f = Some(f);
        // (!(tr > 0): NaN returns too)
        if tr.is_nan() || tr <= 0.0 {
            return;
        }
        for ai in 0..k {
            a[ai * k + ai] += 1e-10 * tr;
        }
        if !solve(k, &mut a, &mut b) {
            return;
        }
        for ai in 0..k {
            let ga = b[ai];
            let d = &self.d_g[ai];
            if ga != 0.0 {
                for i in 0..n {
                    g[i] -= ga * d[i];
                }
            }
        }
    }
}

/// Gaussian elimination with partial pivoting in place; false if singular.
fn solve(n: usize, a: &mut [f64], b: &mut [f64]) -> bool {
    for c in 0..n {
        let mut p = c;
        for r in c + 1..n {
            if a[r * n + c].abs() > a[p * n + c].abs() {
                p = r;
            }
        }
        // (!(|a| > 0) in TypeScript: NaN is singular too)
        let piv = a[p * n + c].abs();
        if piv.is_nan() || piv <= 0.0 {
            return false;
        }
        if p != c {
            for q in 0..n {
                a.swap(c * n + q, p * n + q);
            }
            b.swap(c, p);
        }
        for r in c + 1..n {
            let f = a[r * n + c] / a[c * n + c];
            if f == 0.0 {
                continue;
            }
            for q in c..n {
                a[r * n + q] -= f * a[c * n + q];
            }
            b[r] -= f * b[c];
        }
    }
    for c in (0..n).rev() {
        let mut v = b[c];
        for q in c + 1..n {
            v -= a[c * n + q] * b[q];
        }
        b[c] = v / a[c * n + c];
    }
    true
}
