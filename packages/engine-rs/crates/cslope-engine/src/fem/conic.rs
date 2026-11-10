//! Port of packages/engine/src/fem/conic.ts.
//!
//! The programs of the limit analysis bounds (lower-bound.ts, upper-bound.ts)
//! as second-order cone programs, and their solver.
//!
//! A program has linear equalities, nonnegative and free variables, a linear
//! objective and three-dimensional second-order cones t ≥ ‖(u₁, u₂)‖ on affine
//! expressions t, u₁, u₂ of the variables: in plane strain the Mohr–Coulomb
//! criterion is such a cone in the stresses and its flow rule one in the
//! strain rates (Makrodimopoulos & Martin 2006, IJNME 66(4), 604–634, and
//! 2007, IJNAMG 31(6), 835–865; Krabbenhøft, Lyamin & Sloan 2007, Int. J.
//! Solids Struct. 44(5), 1533–1549).
//!
//! - Clarabel (Goulart & Chen 2024, arXiv:2405.12762), an interior point
//!   method for conic programs, solves the cones exactly; here the `clarabel`
//!   crate itself (the TypeScript engine runs the same crate, version 0.11.1,
//!   compiled to WebAssembly: packages/engine/clarabel). The variables are
//!   scaled by `scale` (their expected magnitude) and the objective by its
//!   largest coefficient before solving: the solver's tolerances are
//!   absolute, and in imperial units (γ = 120 pcf, c = 600 psf) the
//!   unscaled programs reported "solved" at a wrong optimum (a prototype on
//!   V046a gave 0.864 for both bounds against 1.32–1.34 scaled). Its
//!   "almost" statuses (reduced tolerances, about 1e-4) count as solved or
//!   infeasible: far below the tolerance on F. A numerical failure is solved
//!   again with more static regularisation within the time left.
//! - HiGHS (the TypeScript engine's alternative, which solves the linear
//!   program in which each cone is replaced by the polygon inscribed in it
//!   with p sides, Sloan 1988; Sloan & Kleeman 1995) is not ported: every
//!   program goes to Clarabel (see PORTING.md, Decisions). The cones keep
//!   their `polygon` kind, which only the HiGHS formulation reads.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::js;
use clarabel::algebra::CscMatrix;
use clarabel::solver::{
    DefaultSettingsBuilder, DefaultSolver, IPSolver, SolverStatus, SupportedConeT,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// An affine expression Σ vals·x[cols] + c.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Affine {
    pub cols: Vec<usize>,
    pub vals: Vec<f64>,
    /// Constant term.
    pub c: f64,
}

/// Objective sense.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Sense {
    #[default]
    Min,
    Max,
}

/// The polygon by which the HiGHS formulation replaces a cone (not used by Clarabel).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Polygon {
    Facets,
    Vertices,
}

/// A cone (t, u₁, u₂): t ≥ ‖(u₁, u₂)‖.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cone {
    pub t: Affine,
    pub u1: Affine,
    pub u2: Affine,
    pub polygon: Polygon,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConicProgram {
    /// Column names (for the solution by name).
    pub names: Vec<String>,
    /// Nonnegative columns (the others are free).
    pub nonneg: Vec<bool>,
    /// Expected magnitude of each column (scaling for Clarabel); 1 by default.
    pub scale: Vec<f64>,
    pub sense: Sense,
    /// Objective coefficients by column.
    pub objective: Vec<f64>,
    /// Equalities Σ vals·x[cols] = rhs.
    pub eq_cols: Vec<Vec<usize>>,
    pub eq_vals: Vec<Vec<f64>>,
    pub eq_rhs: Vec<f64>,
    /// Cones (t, u₁, u₂): t ≥ ‖(u₁, u₂)‖.
    pub cones: Vec<Cone>,
}

/// Build a program: columns by name, equalities, cones.
#[derive(Debug, Clone, Default)]
pub struct ProgramBuilder {
    pub names: Vec<String>,
    nonneg_list: Vec<bool>,
    scale_list: Vec<f64>,
    index: HashMap<String, usize>,
    pub objective: HashMap<usize, f64>,
    pub eq_cols: Vec<Vec<usize>>,
    pub eq_vals: Vec<Vec<f64>>,
    pub eq_rhs: Vec<f64>,
    pub cones: Vec<Cone>,
    pub sense: Sense,
}

impl ProgramBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// The column of `name`, added (free, or nonnegative) on first use
    /// (TypeScript defaults: `nonneg` false, `scale` 1).
    pub fn col(&mut self, name: &str, nonneg: bool, scale: f64) -> usize {
        if let Some(&j) = self.index.get(name) {
            return j;
        }
        let j = self.names.len();
        self.names.push(name.to_string());
        self.nonneg_list.push(nonneg);
        self.scale_list.push(scale);
        self.index.insert(name.to_string(), j);
        j
    }

    pub fn has(&self, name: &str) -> bool {
        self.index.contains_key(name)
    }

    /// Σ terms = rhs (terms as (column, coefficient), zero coefficients dropped; TypeScript default rhs 0).
    pub fn eq(&mut self, terms: &[(usize, f64)], rhs: f64) -> usize {
        let Affine { cols, vals, .. } = affine(terms, 0.0);
        self.eq_cols.push(cols);
        self.eq_vals.push(vals);
        self.eq_rhs.push(rhs);
        self.eq_rhs.len() - 1
    }

    pub fn cone(&mut self, t: Affine, u1: Affine, u2: Affine, polygon: Polygon) {
        self.cones.push(Cone { t, u1, u2, polygon });
    }

    pub fn add_objective(&mut self, j: usize, a: f64) {
        if a != 0.0 {
            *self.objective.entry(j).or_insert(0.0) += a;
        }
    }

    pub fn build(&self) -> ConicProgram {
        let n = self.names.len();
        let mut objective = vec![0.0; n];
        for (&j, &a) in &self.objective {
            objective[j] = a;
        }
        ConicProgram {
            names: self.names.clone(),
            nonneg: self.nonneg_list.clone(),
            scale: self.scale_list.clone(),
            sense: self.sense,
            objective,
            eq_cols: self.eq_cols.clone(),
            eq_vals: self.eq_vals.clone(),
            eq_rhs: self.eq_rhs.clone(),
            cones: self.cones.clone(),
        }
    }
}

/// An affine expression from terms and a constant (a column's terms summed,
/// zero coefficients dropped; columns in the order first met).
pub fn affine(terms: &[(usize, f64)], c: f64) -> Affine {
    let mut at: HashMap<usize, usize> = HashMap::with_capacity(terms.len());
    let mut sum: Vec<(usize, f64)> = Vec::with_capacity(terms.len());
    for &(j, a) in terms {
        match at.get(&j) {
            Some(&k) => sum[k].1 += a,
            None => {
                at.insert(j, sum.len());
                // ((get ?? 0) + a: the first term is added to 0, which turns −0 into 0)
                sum.push((j, 0.0 + a));
            }
        }
    }
    let mut cols = Vec::with_capacity(sum.len());
    let mut vals = Vec::with_capacity(sum.len());
    for (j, a) in sum {
        if a != 0.0 {
            cols.push(j);
            vals.push(a);
        }
    }
    Affine { cols, vals, c }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConicStatus {
    Optimal,
    Infeasible,
    Unbounded,
    TimeLimit,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConicSolution {
    pub status: ConicStatus,
    /// The solver's own status text.
    pub detail: String,
    pub objective: f64,
    pub x: Vec<f64>,
    /// Clarabel's dual variables of the scaled rows (equalities, nonnegative columns, cones), for diagnosis.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<Vec<f64>>,
}

/// Clarabel's SolverStatus as the TypeScript engine names it (clarabel 0.11, src/solver/core/solver.rs).
fn status_name(s: SolverStatus) -> &'static str {
    match s {
        SolverStatus::Unsolved => "Unsolved",
        SolverStatus::Solved => "Solved",
        SolverStatus::PrimalInfeasible => "PrimalInfeasible",
        SolverStatus::DualInfeasible => "DualInfeasible",
        SolverStatus::AlmostSolved => "AlmostSolved",
        SolverStatus::AlmostPrimalInfeasible => "AlmostPrimalInfeasible",
        SolverStatus::AlmostDualInfeasible => "AlmostDualInfeasible",
        SolverStatus::MaxIterations => "MaxIterations",
        SolverStatus::MaxTime => "MaxTime",
        SolverStatus::NumericalError => "NumericalError",
        SolverStatus::InsufficientProgress => "InsufficientProgress",
        SolverStatus::CallbackTerminated => "CallbackTerminated",
    }
}

/// The outcome of one Clarabel run: status (None: setup error), x, objective, z, solve time (s).
struct Run {
    status: Option<SolverStatus>,
    x: Vec<f64>,
    obj: f64,
    z: Vec<f64>,
    time: f64,
}

/// The standard form minimise qᵀx subject to A x + s = b, s in the cones,
/// as the TypeScript engine's WebAssembly module (packages/engine/clarabel)
/// sets it up and solves it.
#[allow(clippy::too_many_arguments)]
fn clarabel_solve(
    n: usize,
    m: usize,
    q: &[f64],
    a: &CscMatrix<f64>,
    b: &[f64],
    cones: &[SupportedConeT<f64>],
    max_iter: u32,
    time_limit: f64,
    static_reg: f64,
) -> Run {
    let p = CscMatrix::<f64>::zeros((n, n));
    let settings = DefaultSettingsBuilder::default()
        .verbose(false)
        .max_iter(max_iter)
        .time_limit(time_limit)
        .static_regularization_constant(static_reg)
        .build()
        .expect("valid Clarabel settings");
    let Ok(mut solver) = DefaultSolver::new(&p, q, a, b, cones, settings) else {
        // (the module's output buffer stays zero)
        return Run {
            status: None,
            x: vec![0.0; n],
            obj: 0.0,
            z: vec![0.0; m],
            time: 0.0,
        };
    };
    solver.solve();
    let sol = &solver.solution;
    Run {
        status: Some(sol.status),
        x: sol.x.clone(),
        obj: sol.obj_val,
        z: sol.z.clone(),
        time: sol.solve_time,
    }
}

/// Solve the program by Clarabel, scaled (see the header). `time_limit` in seconds.
pub fn solve_clarabel(prog: &ConicProgram, time_limit: f64) -> ConicSolution {
    let n = prog.names.len();
    let s = &prog.scale;
    // objective, minimised, in scaled columns
    let sign = if prog.sense == Sense::Max { -1.0 } else { 1.0 };
    let mut q_max = 0.0;
    for j in 0..n {
        q_max = js::math::max(q_max, (prog.objective[j] * s[j]).abs());
    }
    let qs = if q_max > 0.0 { q_max } else { 1.0 };
    // rows: equalities (zero cone), nonnegative columns, cones (3 rows each); s = b − A x
    let mut rows_of: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut vals_of: Vec<Vec<f64>> = vec![Vec::new(); n];
    let mut b: Vec<f64> = Vec::new();
    let mut m = 0usize;
    let neq = prog.eq_rhs.len();
    for i in 0..neq {
        let cols = &prog.eq_cols[i];
        let vals = &prog.eq_vals[i];
        // each equality divided by its largest scaled coefficient
        let mut rmax = 0.0;
        for k in 0..cols.len() {
            rmax = js::math::max(rmax, (vals[k] * s[cols[k]]).abs());
        }
        let w = if rmax > 0.0 { 1.0 / rmax } else { 1.0 };
        for k in 0..cols.len() {
            rows_of[cols[k]].push(m);
            vals_of[cols[k]].push(vals[k] * s[cols[k]] * w);
        }
        b.push(prog.eq_rhs[i] * w);
        m += 1;
    }
    let mut nn = 0usize;
    for j in 0..n {
        if prog.nonneg[j] {
            rows_of[j].push(m);
            vals_of[j].push(-1.0);
            b.push(0.0);
            m += 1;
            nn += 1;
        }
    }
    for k in &prog.cones {
        // the cone scaled as a whole by its largest coefficient
        let mut cmax = 0.0;
        for a in [&k.t, &k.u1, &k.u2] {
            cmax = js::math::max(cmax, a.c.abs());
            for i in 0..a.cols.len() {
                cmax = js::math::max(cmax, (a.vals[i] * s[a.cols[i]]).abs());
            }
        }
        let w = if cmax > 0.0 { 1.0 / cmax } else { 1.0 };
        for a in [&k.t, &k.u1, &k.u2] {
            for i in 0..a.cols.len() {
                rows_of[a.cols[i]].push(m);
                vals_of[a.cols[i]].push(-a.vals[i] * s[a.cols[i]] * w);
            }
            b.push(a.c * w);
            m += 1;
        }
    }
    // compressed sparse columns (rows ascending within a column)
    let mut colptr = vec![0usize; n + 1];
    let mut nnz = 0;
    for j in 0..n {
        colptr[j] = nnz;
        nnz += rows_of[j].len();
    }
    colptr[n] = nnz;
    let mut rowval = vec![0usize; nnz];
    let mut nzval = vec![0.0f64; nnz];
    for j in 0..n {
        let mut order: Vec<usize> = (0..rows_of[j].len()).collect();
        js::array::sort_by(&mut order, |&p, &q| {
            rows_of[j][p] as f64 - rows_of[j][q] as f64
        });
        for (at, i) in (colptr[j]..).zip(order) {
            rowval[at] = rows_of[j][i];
            nzval[at] = vals_of[j][i];
        }
    }
    let q: Vec<f64> = (0..n)
        .map(|j| (sign * prog.objective[j] * s[j]) / qs)
        .collect();
    let mut cone_list: Vec<SupportedConeT<f64>> = Vec::new();
    if neq > 0 {
        cone_list.push(SupportedConeT::ZeroConeT(neq));
    }
    if nn > 0 {
        cone_list.push(SupportedConeT::NonnegativeConeT(nn));
    }
    for _ in 0..prog.cones.len() {
        cone_list.push(SupportedConeT::SecondOrderConeT(3));
    }
    let a = CscMatrix::new(m, n, colptr, rowval, nzval);

    let mut run = clarabel_solve(
        n,
        m,
        &q,
        &a,
        &b,
        &cone_list,
        400,
        js::math::max(0.1, time_limit),
        1e-8,
    );
    // A numerical failure is solved again with more static regularisation
    // (Clarabel's default 1e-8; 1e-6 solved V067's lower bound, whose rigid
    // elements leave free stresses, where 1e-8 ended in NumericalError).
    // (within what is left of the time limit; the time used is Clarabel's own
    // solve time, setup included, where TypeScript reads the clock around the call)
    let left = time_limit - run.time;
    if matches!(
        run.status,
        Some(SolverStatus::NumericalError | SolverStatus::InsufficientProgress)
    ) && left > 0.1
    {
        run = clarabel_solve(n, m, &q, &a, &b, &cone_list, 400, left, 1e-6);
    }
    let x: Vec<f64> = (0..n).map(|j| run.x[j] * s[j]).collect();
    let detail = match run.status {
        None => "SetupError",
        Some(st) => status_name(st),
    };
    let status = match detail {
        "Solved" | "AlmostSolved" => ConicStatus::Optimal,
        "PrimalInfeasible" | "AlmostPrimalInfeasible" => ConicStatus::Infeasible,
        "DualInfeasible" | "AlmostDualInfeasible" => ConicStatus::Unbounded,
        "MaxTime" => ConicStatus::TimeLimit,
        _ => ConicStatus::Failed,
    };
    ConicSolution {
        status,
        detail: detail.to_string(),
        objective: sign * run.obj * qs,
        x,
        z: Some(run.z),
    }
}
