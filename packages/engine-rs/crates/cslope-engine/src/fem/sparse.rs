//! Port of packages/engine/src/fem/sparse.ts.
//!
//! Sparse symmetric positive definite systems: nested dissection ordering
//! and sparse Cholesky factorisation.
//!
//! The nodes are ordered by geometric nested dissection (George 1973, SIAM
//! J. Numer. Anal. 10, 345–363; George & Liu, Computer Solution of Large
//! Sparse Positive Definite Systems, 1981, ch. 8): the mesh is split at the
//! median of its longer extent, the nodes of one half that touch the other
//! form the separator and are numbered last, and both halves are split in
//! turn. On a two-dimensional mesh the factor then holds O(n log n) entries
//! instead of the O(n^1.5) of a banded (envelope) ordering, and the
//! substitutions, which the viscoplastic iteration repeats thousands of
//! times, cost in proportion.
//!
//! The factorisation is the up-looking (row) Cholesky of Davis, Direct
//! Methods for Sparse Linear Systems, SIAM 2006, ch. 4: the elimination
//! tree gives the pattern of each row of L, computed once (symbolic
//! analysis) and shared by every matrix of the same pattern.
//!
//! The separator of a split is the minimum vertex cover of the bipartite
//! graph of the edges that cross it (König's theorem; the vertex separator
//! from an edge separator of Pothen, Simon & Liou 1990, SIAM J. Matrix Anal.
//! Appl. 11(3), 430–452), found by a maximum matching with augmenting paths
//! (Kuhn 1955, Nav. Res. Logist. Q. 2, 83–97).
//!
//! A matrix with an upper triangle of its own (`unsymmetric`, the tangent
//! of non-associated plasticity) is factorised A = L U without pivoting on
//! the same symbolic structure (the pattern of A is symmetric, so U has the
//! pattern of Lᵀ): row k of L and column k of U are the two triangular
//! solves of the up-looking method (Davis 2006, § 6.1 for the left-looking
//! form of the same recurrence).
//!
//! Implementation choices: both coordinate directions are tried and the
//! smaller separator kept, and parts of at most 8 nodes are not split
//! (measured 2026-10-29 on V055, V056, V063, V068: 30 % fewer entries in L
//! and half the work of the factorisation of the earlier choice, the longer
//! extent, the smaller boundary layer and parts of 32 nodes).
//!
//! Rust notes: the symbolic factorisation is shared through an `Arc`
//! (`empty_copy`); the work arrays of `factor`, which TypeScript keeps on
//! the shared symbolic object, are allocated per factorisation. The
//! augmenting path search of the matching is iterative (an explicit stack
//! in the order of the TypeScript recursion), so that a long path cannot
//! overflow the WebAssembly stack.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::error::{EngineError, Result};
use crate::js;
use std::sync::Arc;

/// Size below which a part is not split further.
const LEAF: usize = 8;

/// The halves of a split and the separator between them.
struct Split {
    left: Vec<usize>,
    right: Vec<usize>,
    sep: Vec<usize>,
}

/// Nested dissection order of the nodes of a graph with node coordinates.
/// Returns `perm[k]` = node placed k-th.
pub fn nested_dissection(x: &[f64], y: &[f64], adj: &[Vec<usize>]) -> Vec<usize> {
    let n = adj.len();
    let mut nd = Dissection {
        adj,
        out: Vec::with_capacity(n),
        label: vec![0; n],
        local: vec![-1; n],
        stamp: 0,
    };
    let all: Vec<usize> = (0..n).collect();
    nd.split(&all, x, y);
    nd.out
}

struct Dissection<'a> {
    adj: &'a [Vec<usize>],
    out: Vec<usize>,
    label: Vec<i32>,
    local: Vec<i32>,
    stamp: i32,
}

impl Dissection<'_> {
    // Split `nodes` at the median of coordinate c: the two halves and a
    // vertex separator between them, the minimum vertex cover of the
    // bipartite graph of the edges that cross the split.
    fn try_split(&mut self, nodes: &[usize], c: &[f64]) -> Split {
        let mut sorted = nodes.to_vec();
        // (c[a] − c[b] || a − b: a zero or NaN difference falls back to the index)
        js::array::sort_by(&mut sorted, |&a, &b| {
            let d = c[a] - c[b];
            if d != 0.0 && !d.is_nan() {
                d
            } else {
                a as f64 - b as f64
            }
        });
        let mid = sorted.len() >> 1;
        let left = sorted[..mid].to_vec();
        let right = sorted[mid..].to_vec();
        self.stamp += 1;
        let l_l = self.stamp;
        self.stamp += 1;
        let l_r = self.stamp;
        for &v in &left {
            self.label[v] = l_l;
        }
        for &v in &right {
            self.label[v] = l_r;
        }
        let b_l: Vec<usize> = left
            .iter()
            .copied()
            .filter(|&v| self.adj[v].iter().any(|&w| self.label[w] == l_r))
            .collect();
        let b_r: Vec<usize> = right
            .iter()
            .copied()
            .filter(|&v| self.adj[v].iter().any(|&w| self.label[w] == l_l))
            .collect();
        let sep = self.minimum_cover(&b_l, &b_r, l_r);
        Split { left, right, sep }
    }

    // König's theorem: a maximum matching of the crossing edges (augmenting
    // paths), then the cover (L \ Z) ∪ (R ∩ Z), Z the vertices reachable
    // from unmatched left vertices by alternating paths.
    fn minimum_cover(&mut self, b_l: &[usize], b_r: &[usize], l_r: i32) -> Vec<usize> {
        for (j, &v) in b_r.iter().enumerate() {
            self.local[v] = j as i32;
        }
        let nbr: Vec<Vec<usize>> = b_l
            .iter()
            .map(|&v| {
                let mut r = Vec::new();
                for &w in &self.adj[v] {
                    if self.label[w] == l_r && self.local[w] >= 0 {
                        r.push(self.local[w] as usize);
                    }
                }
                r
            })
            .collect();
        let mut match_r = vec![-1i64; b_r.len()];
        let mut match_l = vec![-1i64; b_l.len()];
        let mut seen = vec![-1i64; b_r.len()];
        // Augmenting path from left vertex `root` (depth first, the order of
        // the recursive search): a stack of (u, next neighbour to try).
        let mut stack: Vec<(usize, usize)> = Vec::new();
        for root in 0..b_l.len() {
            let round = root as i64;
            stack.clear();
            stack.push((root, 0));
            'search: while let Some(&mut (u, ref mut pos)) = stack.last_mut() {
                while *pos < nbr[u].len() {
                    let j = nbr[u][*pos];
                    *pos += 1;
                    if seen[j] == round {
                        continue;
                    }
                    seen[j] = round;
                    if match_r[j] < 0 {
                        // The path ends: match every vertex on it, innermost first.
                        match_r[j] = u as i64;
                        match_l[u] = j as i64;
                        stack.pop();
                        while let Some((u2, pos2)) = stack.pop() {
                            let j2 = nbr[u2][pos2 - 1];
                            match_r[j2] = u2 as i64;
                            match_l[u2] = j2 as i64;
                        }
                        break 'search;
                    }
                    stack.push((match_r[j] as usize, 0));
                    continue 'search;
                }
                stack.pop();
            }
        }
        let mut z_l = vec![false; b_l.len()];
        let mut z_r = vec![false; b_r.len()];
        let mut st: Vec<usize> = Vec::new();
        for i in 0..b_l.len() {
            if match_l[i] < 0 {
                z_l[i] = true;
                st.push(i);
            }
        }
        while let Some(u) = st.pop() {
            for &j in &nbr[u] {
                if z_r[j] {
                    continue;
                }
                z_r[j] = true;
                let m = match_r[j];
                if m >= 0 && !z_l[m as usize] {
                    z_l[m as usize] = true;
                    st.push(m as usize);
                }
            }
        }
        for &v in b_r {
            self.local[v] = -1;
        }
        let mut cover = Vec::new();
        for (i, &v) in b_l.iter().enumerate() {
            if !z_l[i] {
                cover.push(v);
            }
        }
        for (j, &v) in b_r.iter().enumerate() {
            if z_r[j] {
                cover.push(v);
            }
        }
        cover
    }

    fn split(&mut self, nodes: &[usize], x: &[f64], y: &[f64]) {
        if nodes.len() <= LEAF {
            self.out.extend_from_slice(nodes);
            return;
        }
        let mut best: Option<Split> = None;
        for c in [x, y] {
            let r = self.try_split(nodes, c);
            if best.as_ref().is_none_or(|b| r.sep.len() < b.sep.len()) {
                best = Some(r);
            }
        }
        let Split { left, right, sep } = best.expect("a split was tried");
        self.stamp += 1;
        let l_s = self.stamp;
        for &v in &sep {
            self.label[v] = l_s;
        }
        let a: Vec<usize> = left
            .iter()
            .copied()
            .filter(|&v| self.label[v] != l_s)
            .collect();
        let b: Vec<usize> = right
            .iter()
            .copied()
            .filter(|&v| self.label[v] != l_s)
            .collect();
        if a.len() == nodes.len() || b.len() == nodes.len() {
            self.out.extend_from_slice(nodes);
            return;
        }
        self.split(&a, x, y);
        self.split(&b, x, y);
        self.out.extend_from_slice(&sep);
    }
}

/// Adjacency of the nodes of a T6 mesh (nodes of a common element), each
/// node's neighbours in the order first met (the insertion order of the
/// TypeScript `Set`).
pub fn node_graph(el: &[usize], ne: usize, nn: usize) -> Vec<Vec<usize>> {
    let mut nbr: Vec<Vec<usize>> = vec![Vec::new(); nn];
    for e in 0..ne {
        for a in 0..6 {
            for b in 0..6 {
                if a != b {
                    let list = &mut nbr[el[6 * e + a]];
                    let w = el[6 * e + b];
                    if !list.contains(&w) {
                        list.push(w);
                    }
                }
            }
        }
    }
    nbr
}

/// Pattern and symbolic factorisation, shared by matrices of the same structure.
#[derive(Debug)]
struct Symbolic {
    n: usize,
    /// Lower triangle of A by rows: columns row_cols[row_ptr[i] … row_ptr[i+1]) ascending, the diagonal last.
    row_ptr: Vec<usize>,
    row_cols: Vec<usize>,
    /// L by columns: rows li[lp[j] … lp[j+1]) ascending, the diagonal first.
    lp: Vec<usize>,
    li: Vec<usize>,
    /// Parent in the elimination tree, −1 at a root.
    parent: Vec<i64>,
}

/// A sparse symmetric (or structurally symmetric) matrix and its factors.
#[derive(Debug, Clone)]
pub struct SparseCholesky {
    pub n: usize,
    /// Values of the lower triangle of A, in the order of the row pattern.
    pub values: Vec<f64>,
    /// Index of the diagonal of each row in `values`.
    pub diag: Vec<usize>,
    sym: Arc<Symbolic>,
    lx: Vec<f64>,
    /// Unsymmetric matrices: A(j, i) above the diagonal at the position of
    /// A(i, j) (i > j) in `values`; None for a symmetric matrix.
    pub upper: Option<Vec<f64>>,
    /// U of A = L U by rows, in the layout of lx (U(j, j) first, then U(j, li[p])).
    ux: Option<Vec<f64>>,
    pub factored: bool,
}

impl SparseCholesky {
    fn with_symbolic(sym: Arc<Symbolic>, unsymmetric: bool) -> Self {
        let n = sym.n;
        let nv = sym.row_cols.len();
        let nl = sym.li.len();
        let diag = (0..n).map(|i| sym.row_ptr[i + 1] - 1).collect();
        SparseCholesky {
            n,
            values: vec![0.0; nv],
            diag,
            lx: vec![0.0; nl],
            upper: if unsymmetric {
                Some(vec![0.0; nv])
            } else {
                None
            },
            ux: if unsymmetric {
                Some(vec![0.0; nl])
            } else {
                None
            },
            factored: false,
            sym,
        }
    }

    /// Matrix of n equations whose nonzeros are the couplings within each
    /// group of `size` equations in `groups` (an element's degrees of
    /// freedom; −1 entries are skipped). Equations should already be in a
    /// fill-reducing order.
    pub fn from_groups(n: usize, groups: &[i64], size: usize) -> SparseCholesky {
        // Row patterns of the lower triangle.
        let mut rows: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut g = 0;
        while g < groups.len() {
            for a in 0..size {
                let i = groups[g + a];
                if i < 0 {
                    continue;
                }
                for b in 0..size {
                    let j = groups[g + b];
                    if j >= 0 && j <= i {
                        rows[i as usize].push(j as usize);
                    }
                }
            }
            g += size;
        }
        let mut row_ptr = vec![0usize; n + 1];
        for i in 0..n {
            rows[i].push(i);
            // (Int32Array.prototype.sort: numeric)
            rows[i].sort();
            rows[i].dedup();
            row_ptr[i + 1] = row_ptr[i] + rows[i].len();
        }
        let mut row_cols = Vec::with_capacity(row_ptr[n]);
        for r in &rows {
            row_cols.extend_from_slice(r);
        }
        drop(rows);

        // Elimination tree (Davis 2006, ch. 4).
        let mut parent = vec![-1i64; n];
        let mut ancestor = vec![-1i64; n];
        for k in 0..n {
            for &col in &row_cols[row_ptr[k]..row_ptr[k + 1] - 1] {
                let mut i = col as i64;
                while i != -1 && (i as usize) < k {
                    let next = ancestor[i as usize];
                    ancestor[i as usize] = k as i64;
                    if next == -1 {
                        parent[i as usize] = k as i64;
                    }
                    i = next;
                }
            }
        }
        // Column counts and row patterns of L from the row subtrees.
        let mut count = vec![1usize; n];
        let mut mark = vec![-1i64; n];
        let mut stack = vec![0usize; n];
        let reach =
            |k: usize, mark: &mut [i64], stack: &mut [usize], visit: &mut dyn FnMut(usize)| {
                mark[k] = k as i64;
                for &col in &row_cols[row_ptr[k]..row_ptr[k + 1] - 1] {
                    let mut len = 0;
                    let mut i = col;
                    while mark[i] != k as i64 {
                        stack[len] = i;
                        len += 1;
                        mark[i] = k as i64;
                        i = parent[i] as usize;
                    }
                    while len > 0 {
                        len -= 1;
                        visit(stack[len]);
                    }
                }
            };
        for k in 0..n {
            reach(k, &mut mark, &mut stack, &mut |i| count[i] += 1);
        }
        let mut lp = vec![0usize; n + 1];
        for j in 0..n {
            lp[j + 1] = lp[j] + count[j];
        }
        // Diagonal first, then row k of every column in the pattern of row k:
        // taking k in increasing order sorts each column.
        let mut li = vec![0usize; lp[n]];
        let mut next = vec![0usize; n];
        for j in 0..n {
            li[lp[j]] = j;
            next[j] = lp[j] + 1;
        }
        mark.fill(-1);
        for k in 0..n {
            reach(k, &mut mark, &mut stack, &mut |i| {
                li[next[i]] = k;
                next[i] += 1;
            });
        }
        let sym = Symbolic {
            n,
            row_ptr,
            row_cols,
            lp,
            li,
            parent,
        };
        SparseCholesky::with_symbolic(Arc::new(sym), false)
    }

    /// A zero matrix with the same pattern (and symbolic factorisation), with its own upper triangle if `unsymmetric`.
    pub fn empty_copy(&self, unsymmetric: bool) -> SparseCholesky {
        SparseCholesky::with_symbolic(Arc::clone(&self.sym), unsymmetric)
    }

    /// Add v to entries (i, j) and (j, i) (once on the diagonal): a symmetric contribution.
    pub fn add(&mut self, i: usize, j: usize, v: f64) -> Result<()> {
        let p = self.index_of(i, j)?;
        self.values[p] += v;
        if let Some(upper) = self.upper.as_mut() {
            if i != j {
                upper[p] += v;
            }
        }
        Ok(())
    }

    /// Position of entry (i, j) (or (j, i)) in `values`; an error outside the pattern.
    pub fn index_of(&self, i: usize, j: usize) -> Result<usize> {
        let (i, j) = if j > i { (j, i) } else { (i, j) };
        let row_ptr = &self.sym.row_ptr;
        let row_cols = &self.sym.row_cols;
        if i >= self.n {
            return Err(EngineError::new(format!(
                "entry ({i}, {j}) is outside the matrix pattern"
            )));
        }
        let mut lo = row_ptr[i];
        let mut hi = row_ptr[i + 1] - 1;
        while lo < hi {
            let mid = (lo + hi) >> 1;
            if row_cols[mid] < j {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if row_cols[lo] != j {
            return Err(EngineError::new(format!(
                "entry ({i}, {j}) is outside the matrix pattern"
            )));
        }
        Ok(lo)
    }

    /// Cholesky factorisation A = L Lᵀ (L U for an unsymmetric matrix). An
    /// error if A is not positive definite (has a zero pivot).
    pub fn factor(&mut self) -> Result<()> {
        // (false until it completes: a failed factorisation leaves none to reuse)
        self.factored = false;
        if self.upper.is_some() {
            return self.factor_lu();
        }
        let sym = &*self.sym;
        let n = sym.n;
        let (row_ptr, row_cols, lp, li, parent) =
            (&sym.row_ptr, &sym.row_cols, &sym.lp, &sym.li, &sym.parent);
        let a = &self.values;
        let lx = &mut self.lx;
        let mut x = vec![0.0f64; n];
        let mut next: Vec<usize> = (0..n).map(|j| lp[j] + 1).collect();
        let mut mark = vec![-1i64; n];
        let mut stack = vec![0usize; n];
        let mut pattern = vec![0usize; n];
        for k in 0..n {
            // Pattern of row k of L in topological order, and A(k, 0…k) scattered into x.
            let mut top = n;
            mark[k] = k as i64;
            for p in row_ptr[k]..row_ptr[k + 1] - 1 {
                let mut i = row_cols[p];
                let mut len = 0;
                x[i] = a[p];
                while mark[i] != k as i64 {
                    stack[len] = i;
                    len += 1;
                    mark[i] = k as i64;
                    i = parent[i] as usize;
                }
                while len > 0 {
                    top -= 1;
                    len -= 1;
                    pattern[top] = stack[len];
                }
            }
            let mut d = a[row_ptr[k + 1] - 1];
            while top < n {
                let i = pattern[top];
                let lki = x[i] / lx[lp[i]];
                x[i] = 0.0;
                let end = next[i];
                for p in lp[i] + 1..end {
                    x[li[p]] -= lx[p] * lki;
                }
                d -= lki * lki;
                lx[next[i]] = lki;
                next[i] += 1;
                top += 1;
            }
            // (!(d > 0): NaN fails too)
            if d.is_nan() || d <= 0.0 {
                return Err(EngineError::new(format!(
                    "stiffness matrix not positive definite at equation {k}"
                )));
            }
            lx[lp[k]] = d.sqrt();
        }
        self.factored = true;
        Ok(())
    }

    /// A = L U without pivoting, L unit lower triangular. For row k, with the
    /// pattern of row k of L (the reach of A(k, 0…k−1) in the elimination
    /// tree, which is also the pattern of column k of U), in topological order:
    /// L(k, i) = x_i / U(i, i), x_r −= L(k, i)·U(i, r); U(i, k) = y_i,
    /// y_r −= L(r, i)·U(i, k); then U(k, k) = A(k, k) − Σ L(k, i)·U(i, k).
    fn factor_lu(&mut self) -> Result<()> {
        let sym = &*self.sym;
        let n = sym.n;
        let (row_ptr, row_cols, lp, li, parent) =
            (&sym.row_ptr, &sym.row_cols, &sym.lp, &sym.li, &sym.parent);
        let a = &self.values;
        let au = self.upper.as_ref().expect("unsymmetric matrix");
        let lx = &mut self.lx;
        let ux = self.ux.as_mut().expect("unsymmetric matrix");
        let mut x = vec![0.0f64; n];
        let mut y = vec![0.0f64; n];
        let mut next = vec![0usize; n];
        for j in 0..n {
            next[j] = lp[j] + 1;
            lx[lp[j]] = 1.0;
        }
        let mut mark = vec![-1i64; n];
        let mut stack = vec![0usize; n];
        let mut pattern = vec![0usize; n];
        for k in 0..n {
            let mut top = n;
            mark[k] = k as i64;
            for p in row_ptr[k]..row_ptr[k + 1] - 1 {
                let mut i = row_cols[p];
                let mut len = 0;
                x[i] = a[p];
                y[i] = au[p];
                while mark[i] != k as i64 {
                    stack[len] = i;
                    len += 1;
                    mark[i] = k as i64;
                    i = parent[i] as usize;
                }
                while len > 0 {
                    top -= 1;
                    len -= 1;
                    pattern[top] = stack[len];
                }
            }
            let akk = a[row_ptr[k + 1] - 1];
            let mut d = akk;
            while top < n {
                let i = pattern[top];
                let lki = x[i] / ux[lp[i]];
                let uik = y[i];
                x[i] = 0.0;
                y[i] = 0.0;
                let end = next[i];
                for p in lp[i] + 1..end {
                    let r = li[p];
                    x[r] -= ux[p] * lki;
                    y[r] -= lx[p] * uik;
                }
                d -= lki * uik;
                lx[end] = lki;
                ux[end] = uik;
                next[i] += 1;
                top += 1;
            }
            // (!(|d| > 1e-12 |akk|): NaN fails too)
            let ok = d.abs() > 1e-12 * akk.abs();
            if !ok {
                return Err(EngineError::new(format!("zero pivot at equation {k}")));
            }
            ux[lp[k]] = d;
        }
        self.factored = true;
        Ok(())
    }

    /// Solve A x = b in place (after `factor`).
    pub fn solve(&self, b: &mut [f64]) {
        let sym = &*self.sym;
        let n = sym.n;
        let (lp, li) = (&sym.lp, &sym.li);
        let lx = &self.lx;
        if let Some(ux) = self.ux.as_ref() {
            for j in 0..n {
                let bj = b[j];
                if bj != 0.0 {
                    for p in lp[j] + 1..lp[j + 1] {
                        b[li[p]] -= lx[p] * bj;
                    }
                }
            }
            for j in (0..n).rev() {
                let mut s = b[j];
                for p in lp[j] + 1..lp[j + 1] {
                    s -= ux[p] * b[li[p]];
                }
                b[j] = s / ux[lp[j]];
            }
            return;
        }
        for j in 0..n {
            b[j] /= lx[lp[j]];
            let bj = b[j];
            if bj != 0.0 {
                for p in lp[j] + 1..lp[j + 1] {
                    b[li[p]] -= lx[p] * bj;
                }
            }
        }
        for j in (0..n).rev() {
            let mut s = b[j];
            for p in lp[j] + 1..lp[j + 1] {
                s -= lx[p] * b[li[p]];
            }
            b[j] = s / lx[lp[j]];
        }
    }
}
