//! Port of packages/engine/src/fem/lower-bound.ts.
//!
//! Lower bound limit analysis by finite elements and conic programming
//! (Sloan 1988, IJNAMG 12, 61–77; Lyamin & Sloan 2002, IJNME 55, 573–611;
//! Makrodimopoulos & Martin 2006, IJNME 66(4), 604–634).
//!
//! The stresses vary linearly over three-node triangles whose nodes are not
//! shared, so that every interior edge can carry a statically admissible
//! stress discontinuity (continuous normal and shear traction). Each
//! element is in equilibrium with its weight and the pore pressure
//! gradient, the ground surface carries its loads, and every node meets the
//! Mohr–Coulomb criterion, in plane strain the second-order cone
//! 2c cos φ − sin φ (σ′x + σ′y) ≥ ‖(σ′x − σ′y, 2τxy)‖, so that the stress
//! field is admissible and the load factor a strict lower bound for the
//! mesh. Stresses are effective, tension positive; σ = σ′ − u m. The cones
//! are solved exactly by Clarabel (conic.rs). (The TypeScript engine can
//! also solve the p-sided polygon inscribed in the criterion, Sloan 1988, by
//! HiGHS; that is not ported: `bound_solver: "highs"` is solved by Clarabel,
//! see PORTING.md, Decisions.)
//!
//! The program maximises a load factor λ on every load (weight, pore
//! pressure and surface loads). The factor of safety on strength is the
//! reduction F at which λ(F) = 1: for φ = 0 everywhere λ(F) = λ(F0)·F0/F, so
//! F = λ(F0)·F0 from one program at the first reduction tried F0 (1 by
//! default); otherwise F is found by the secant method on
//! log λ (Kim, Salgado & Lee 2002, J. Geotech. Geoenviron. Eng. 128(7),
//! 546–557, fig. 3: iterate until the reference load is carried).
//!
//! Implementation choices (not from the literature): p = 24 sides; the
//! secant method on log λ with trials tol/2 below its root, safeguarded by
//! bisection of the bracket between the largest F that carries the loads
//! and the smallest that does not, returning the largest evaluated F with
//! λ(F) ≥ 1 once it lies within 0.002 of the root or of the bracket's other
//! end (only such an F is a lower bound); fans of elements spanning at
//! most 30° within an element size of each corner and load's end of the
//! ground surface (lower_bound_problem); the load factor on every load, weight
//! included, as the strength reduction applies; a line load spread over the
//! two surface edges at its point; the stresses scaled by γ H (the largest
//! unit weight times the model's height) for Clarabel.
//!
//! Rust notes: time is read only through the run's clock (`RunCtx.clock`,
//! TypeScript's `performance.now`); the run's cancellation is checked before
//! each program.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

use crate::api::ctx::RunCtx;
use crate::error::Result;
use crate::fem::conic::{
    affine, solve_clarabel, Cone, ConicProgram, ConicSolution, ConicStatus, Polygon,
    ProgramBuilder, Sense,
};
use crate::fem::limit_common::{
    mean_unit_weight, pore_pressure_at, reduced_strength, strength_at, surface_line_loads,
    InsertionMap, LineLoadMap, StrengthRule,
};
use crate::fem::model::{build_fe_model, ignored_input_warnings, polyline_y, FeModelOptions};
use crate::js;
use crate::model::geometry_ops::Polyline;
use crate::model::slope::Slope;
use crate::types::WATER_UNIT_WEIGHT;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

/// Sectors per element at a singular point of the ground surface (see `lower_bound_problem`).
const FAN_SECTORS: usize = 4;
/// Largest angle an element near a singular point of the ground surface spans as seen from it (see `lower_bound_problem`).
const FAN_ANGLE: f64 = (30.0 * PI) / 180.0;
/// Reach of the fans of elements around the singular points, in element sizes (the model's size field there; see `lower_bound_problem`).
const FAN_RADIUS: f64 = 1.0;
/// Rounds of bisection at most for the fans of elements (see `lower_bound_problem`).
const FAN_PASSES: usize = 10;

/// The solver of the bounds' programs (`boundSolver`). Both are solved by
/// Clarabel: HiGHS is not ported (PORTING.md, Decisions), and "highs" is
/// kept so that such options still read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BoundSolver {
    #[default]
    Clarabel,
    Highs,
}

/// `LowerBoundOptions` (and `UpperBoundOptions`, the same fields).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LowerBoundOptions {
    #[serde(flatten)]
    pub model: FeModelOptions,
    /// The solver: "clarabel" (default) the yield criterion exactly as a
    /// second-order cone; "highs" (the TypeScript engine's inscribed or
    /// circumscribed polygon as a linear program) is solved by Clarabel too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bound_solver: Option<BoundSolver>,
    /// The reduced strength: c/F and tan φ/F ("associated", default), or
    /// Davis B's for the elements' dilation angles ("davis-b",
    /// limit_common.rs), the associated material that stands for
    /// non-associated flow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strength_rule: Option<StrengthRule>,
    /// Sides of the yield polygon (HiGHS only; not read by Clarabel); default 24.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub sides: Option<f64>,
    /// Rankine tension cut-off σ₁′ ≤ 0; default false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tension_cutoff: Option<bool>,
    /// Tolerance on F; default 0.002.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub f_tolerance: Option<f64>,
    /// Time limit per program (s); default 300.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub time_limit: Option<f64>,
    /// Time limit of the whole search (s): no program starts after it, and the bound stays the best certified so far; default none.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub total_time_limit: Option<f64>,
    /// First reduction tried, e.g. a coarser mesh's bound; default 1.
    #[serde(
        default,
        rename = "startF",
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub start_f: Option<f64>,
}

/// One program of a bound's search: λ(F) and its run time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BoundTrial {
    #[serde(rename = "F")]
    pub f: f64,
    pub lambda: f64,
    pub seconds: f64,
}

/// `LowerBoundResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LowerBoundResult {
    /// Lower bound on the factor of safety.
    pub factor_of_safety: f64,
    /// The load factors λ(F) of the programs solved.
    pub trials: Vec<BoundTrial>,
    pub elements: usize,
    /// Size of the program: variables and constraints.
    pub variables: usize,
    pub constraints: usize,
    pub warnings: Vec<String>,
}

/// Solve a bound's program (TypeScript's `boundSolver`): Clarabel, whatever
/// the option says (see `BoundSolver`); `sides` is the HiGHS polygon's.
pub fn bound_solve(prog: &ConicProgram, _sides: f64, time_limit: f64) -> ConicSolution {
    solve_clarabel(prog, time_limit)
}

/// The lower bound mesh: corner coordinates and three nodes per element,
/// and the strength reduction model's element each lies in (`parent`; the
/// model's corner nodes keep their numbers). The stresses of element e at
/// its corner k are the program's columns 9e + 3k + 0, 1, 2: σ′x, σ′y, τxy.
/// `split`: the edges bisected for the fans ((a, b) with a < b) and the
/// node at their middle, in the order bisected.
#[derive(Debug, Clone, PartialEq)]
pub struct LbMesh {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub el: Vec<usize>,
    pub parent: Vec<usize>,
    pub split: Vec<((usize, usize), usize)>,
    pub(crate) split_index: HashMap<(usize, usize), usize>,
}

impl LbMesh {
    /// The node at the middle of a bisected edge (a < b).
    pub fn split_at(&self, a: usize, b: usize) -> Option<usize> {
        self.split_index.get(&(a, b)).copied()
    }
}

/// The lower bound problem of a slope (`LbProblem`): the parts that do not depend on F.
#[derive(Debug, Clone)]
pub struct LbProblem {
    fixed: ConicProgram,
    elastic: Vec<bool>,
    n_c: Vec<f64>,
    n_phi: Vec<f64>,
    n_cu: Vec<f64>,
    /// The dilation angle of each element (its parent's).
    psi: Vec<f64>,
    cutoff: bool,
    rule: StrengthRule,
    /// Sides of the yield polygon when solved as an LP by HiGHS.
    pub sides: f64,
    pub all_undrained: bool,
    pub elements: usize,
    pub variables: usize,
    pub constraints: usize,
    pub warnings: Vec<String>,
    pub mesh: LbMesh,
}

/// Columns of the stresses of element e at its corner k.
fn v(e: usize, k: usize, comp: usize) -> usize {
    9 * e + 3 * k + comp
}

impl LbProblem {
    /// The program at a reduction F (conic.rs): maximise λ.
    pub fn program(&self, f: f64) -> ConicProgram {
        let mut prog = self.fixed.clone();
        prog.cones = self.yield_cones(f);
        prog
    }

    /// Yield cones per corner (F-dependent): 2c cos φ − sin φ (σx + σy) ≥ ‖(σx − σy, 2τ)‖;
    /// the undrained cap 2cu ≥ ‖(σx − σy, 2τ)‖; the tension cut-off −(σx + σy)/2 ≥ ‖((σx − σy)/2, τ)‖.
    fn yield_cones(&self, f: f64) -> Vec<Cone> {
        let mut out = Vec::new();
        let ne = self.elements;
        for e in 0..ne {
            if self.elastic[e] {
                continue;
            }
            for k in 0..3 {
                let i = 3 * e + k;
                let (sx, sy, txy) = (v(e, k, 0), v(e, k, 1), v(e, k, 2));
                let (c_f, phi_f) =
                    reduced_strength(self.n_c[i], self.n_phi[i], self.psi[e], f, self.rule);
                let sp = js::math::sin(phi_f);
                let dev1 = affine(&[(sx, 1.0), (sy, -1.0)], 0.0);
                let dev2 = affine(&[(txy, 2.0)], 0.0);
                out.push(Cone {
                    t: affine(&[(sx, -sp), (sy, -sp)], 2.0 * c_f * js::math::cos(phi_f)),
                    u1: dev1.clone(),
                    u2: dev2.clone(),
                    polygon: Polygon::Facets,
                });
                if self.n_cu[i].is_finite() {
                    out.push(Cone {
                        t: affine(&[], (2.0 * self.n_cu[i]) / f),
                        u1: dev1.clone(),
                        u2: dev2.clone(),
                        polygon: Polygon::Facets,
                    });
                }
                if self.cutoff {
                    out.push(Cone {
                        t: affine(&[(sx, -0.5), (sy, -0.5)], 0.0),
                        u1: affine(&[(sx, 0.5), (sy, -0.5)], 0.0),
                        u2: affine(&[(txy, 1.0)], 0.0),
                        polygon: Polygon::Facets,
                    });
                }
            }
        }
        out
    }
}

fn key_of(a: usize, b: usize) -> (usize, usize) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

/// The vertical load per horizontal metre on surface edge `s` of `surf` at
/// its node `node`: the line loads' strip loads, linear along the model's
/// edge it lies on, and the strip loads covering the edge's middle.
fn surface_load(
    slope: &Slope,
    surf: &[[usize; 4]],
    line_q: &LineLoadMap,
    xs: &[f64],
    n_key: usize,
    load_factor: f64,
    s: usize,
    node: usize,
) -> f64 {
    let [a, b, aa, bb] = surf[s];
    let key = if aa < bb {
        aa * n_key + bb
    } else {
        bb * n_key + aa
    };
    let qa = line_q.get(&(key, aa)).copied().unwrap_or(0.0);
    let qb = line_q.get(&(key, bb)).copied().unwrap_or(0.0);
    let t = if xs[bb] == xs[aa] {
        0.0
    } else {
        (xs[node] - xs[aa]) / (xs[bb] - xs[aa])
    };
    let mut q = qa + t * (qb - qa);
    let mx = (xs[a] + xs[b]) / 2.0;
    for udl in slope.udls() {
        if mx >= udl.x1 && mx <= udl.x2 {
            q += udl.magnitude * load_factor;
        }
    }
    q
}

/// Normal stress terms σ′n on a plane of normal (nx, ny), weighted by w.
fn sn(e: usize, k: usize, nx: f64, ny: f64, w: f64) -> [(usize, f64); 3] {
    [
        (v(e, k, 0), w * nx * nx),
        (v(e, k, 1), w * ny * ny),
        (v(e, k, 2), w * 2.0 * nx * ny),
    ]
}

/// Shear stress terms τ on a plane of normal (nx, ny), weighted by w.
fn ts(e: usize, k: usize, nx: f64, ny: f64, w: f64) -> [(usize, f64); 3] {
    [
        (v(e, k, 0), -w * nx * ny),
        (v(e, k, 1), w * nx * ny),
        (v(e, k, 2), w * (nx * nx - ny * ny)),
    ]
}

/// Assemble the lower bound problem of a slope (the parts that do not depend on F).
pub fn lower_bound_problem(slope: &Slope, options: &LowerBoundOptions) -> Result<LbProblem> {
    let model = build_fe_model(slope, &options.model)?;
    let materials = &model.materials;
    let mut xs: Vec<f64> = model.x.clone();
    let mut ys: Vec<f64> = model.y.clone();
    // Seepage heads at the nodes, interpolated linearly to the nodes added below
    // (bisection, centroid splits, fans): the model has them at its own only.
    let head0: Option<&Vec<f64>> = model.seepage.as_ref().filter(|s| s.flow).map(|s| &s.head);
    let mut hs: Vec<f64> = head0.cloned().unwrap_or_default();
    let has_head = head0.is_some();
    // (addNode: the head is computed only with seepage)
    fn add_node(
        xs: &mut Vec<f64>,
        ys: &mut Vec<f64>,
        hs: &mut Vec<f64>,
        has_head: bool,
        px: f64,
        py: f64,
        h: impl FnOnce(&[f64]) -> f64,
    ) -> usize {
        xs.push(px);
        ys.push(py);
        if has_head {
            let hv = h(hs.as_slice());
            hs.push(hv);
        }
        xs.len() - 1
    }
    // corner nodes, the model's element
    let mut tris: Vec<[usize; 3]> = Vec::with_capacity(model.element_count);
    let mut meta: Vec<usize> = Vec::with_capacity(model.element_count);
    for e in 0..model.element_count {
        tris.push([model.el[6 * e], model.el[6 * e + 1], model.el[6 * e + 2]]);
        meta.push(e);
    }
    // The ground surface edges of the lower bound mesh, each with the model's
    // surface edge it lies on (whose line loads it carries): the model's,
    // bisected below.
    let mut surf: Vec<[usize; 4]> = Vec::new();
    let mut s = 0;
    while s < model.surface_edges.len() {
        let (a, b) = (model.surface_edges[s], model.surface_edges[s + 2]);
        surf.push([a, b, a, b]);
        s += 3;
    }
    let mut surface_key: HashSet<(usize, usize)> = HashSet::new();
    for &[a, b, _, _] in &surf {
        surface_key.insert(key_of(a, b));
    }
    // Corners of the ground surface (crest, toe, its ends at the sides): any
    // kink, even a slight one (not only a round-off one, 10⁻⁹ rad), and a
    // point where a material boundary meets it (on V052a's crest the stress
    // locked where the core, c′ = 85 kPa, meets a cohesionless transition).
    // (Maps and Sets in insertion order)
    let mut surf_nbr: Vec<(usize, Vec<usize>)> = Vec::new();
    let mut surf_nbr_at: HashMap<usize, usize> = HashMap::new();
    for &[a, b, _, _] in &surf {
        for (n, o) in [(a, b), (b, a)] {
            match surf_nbr_at.get(&n) {
                Some(&i) => surf_nbr[i].1.push(o),
                None => {
                    surf_nbr_at.insert(n, surf_nbr.len());
                    surf_nbr.push((n, vec![o]));
                }
            }
        }
    }
    let mut corner: Vec<usize> = Vec::new();
    let mut corner_set: HashSet<usize> = HashSet::new();
    let mut add_corner = |corner: &mut Vec<usize>, n: usize| {
        if corner_set.insert(n) {
            corner.push(n);
        }
    };
    // and where a material boundary meets the ground: the materials of the surface edges at each node
    let mut surf_mats: Vec<(usize, Vec<usize>)> = Vec::new();
    let mut surf_mats_at: HashMap<usize, usize> = HashMap::new();
    for (i, t) in tris.iter().enumerate() {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            if !surface_key.contains(&key_of(a, b)) {
                continue;
            }
            let mat = model.el_material[meta[i]];
            for n in [a, b] {
                let slot = match surf_mats_at.get(&n) {
                    Some(&j) => j,
                    None => {
                        surf_mats_at.insert(n, surf_mats.len());
                        surf_mats.push((n, Vec::new()));
                        surf_mats.len() - 1
                    }
                };
                if !surf_mats[slot].1.contains(&mat) {
                    surf_mats[slot].1.push(mat);
                }
            }
        }
    }
    for (v, mats) in &surf_mats {
        if mats.len() > 1 {
            add_corner(&mut corner, *v);
        }
    }
    for (v, nb) in &surf_nbr {
        let v = *v;
        if nb.len() != 2 {
            add_corner(&mut corner, v);
            continue;
        }
        let ax = xs[nb[0]] - xs[v];
        let ay = ys[nb[0]] - ys[v];
        let bx = xs[nb[1]] - xs[v];
        let by = ys[nb[1]] - ys[v];
        if (ax * by - ay * bx).abs() > 1e-9 * ((ax * ax + ay * ay) * (bx * bx + by * by)).sqrt() {
            add_corner(&mut corner, v);
        }
    }
    // Line loads as strip loads (limit_common.rs) on the model's surface
    // edges, keyed by node pairs; variable loads take γQ.
    let load_factor = slope.partial_factors().map_or(1.0, |f| f.variable_load);
    let mut warnings: Vec<String> = ignored_input_warnings(slope);
    let n_key = xs.len(); // key multiplier of the model's node pairs (the model's nodes keep their numbers)
    let line_q = surface_line_loads(
        slope,
        &model,
        &|a, b| if a < b { a * n_key + b } else { b * n_key + a },
        &mut warnings,
    );
    // Singular points of the ground surface's tractions (Sloan 1988, fans of
    // discontinuities at singular points; Lyamin & Sloan 2002): besides the
    // corners, the nodes where the prescribed load jumps, the ends of the
    // strip loads (the edges of a footing in Prandtl's solution) and of the
    // line loads' strips. The stress there is not one value: each element at
    // the node has its own, and the jump in the load must be carried by the
    // discontinuities between them. With two elements at a load's end, one
    // on each side, the normal and shear traction continuous across their
    // common edge at that node demand q n_y = 0, so that unless that edge is
    // vertical no stress field carries any load (λ = 0 at every F: a strip
    // load ending on an embankment's flat crest, the edge from its end
    // inclined 3.4° from the vertical); with three, one sector between them,
    // the load was carried only at λ = 0.37 even as F fell to 0.05, the
    // tension apex c′ cot φ′ of the sectors not falling with F (a load
    // ending 5 cm from the crest corner of a fill of c′ = 2 kPa, φ′ = 33°,
    // with a 45° face below; the same with loads a few millimetres from such
    // corners).
    // A load ending at a corner was carried, as the corners had fans; the
    // loads' ends get the corners' fans of elements below.
    {
        let mut qs: HashMap<usize, f64> = HashMap::new();
        for (s, &[a, b, _, _]) in surf.iter().enumerate() {
            for n in [a, b] {
                let q = surface_load(slope, &surf, &line_q, &xs, n_key, load_factor, s, n);
                match qs.get(&n) {
                    None => {
                        qs.insert(n, q);
                    }
                    Some(&q0) => {
                        if (q - q0).abs() > 1e-9 * (1.0 + q.abs() + q0.abs()) {
                            add_corner(&mut corner, n);
                        }
                    }
                }
            }
        }
    }
    // Fans of elements at the singular points (Sloan 1988, fans of
    // discontinuities at singular points; Lyamin & Sloan 2002): the elements
    // within FAN_RADIUS element sizes of a corner or a load's end are bisected
    // until each spans at most FAN_ANGLE as seen from it, one at the point by
    // its edge opposite the point, any other by its edge that spans the
    // widest angle; the element on the edge's other side is bisected with
    // it, a surface edge into two on the same model edge. Bisection only adds
    // discontinuities, so that the stress fields of the coarser mesh stay
    // admissible and λ does not fall. Near a singular point the stress varies
    // with the angle around it (Prandtl's fan at a footing's edge, at the
    // crest of a loaded face), at every distance from it, so that a fan needs
    // elements around the point out to the size of the mechanism, not only at
    // the point: on a weightless 45° wedge of c′ = 10 kPa, φ′ = 30° loaded on
    // its crest to Prandtl's c′ N_c with a fan of π/4 (F = 1, elements of
    // 1 m), F was 0.89 with four elements at the corner (their opposite edges
    // bisected, as before) and four sectors in each (below), 0.89 with twelve
    // sectors, 0.93 with fans of elements of at most 30° within an element
    // size, 0.95 with 20° and 0.98 with 15° and no limit on the reach. On the
    // embankment above, the strip load at the crest corner, 2 mm and 5 cm
    // from it gave 0.91, 0.87 and no bound before, now 1.13, 1.13 and 1.10
    // (upper bound 1.21; with 20°, 1.14–1.15 at 1.3 times the elements).
    // Implementation choices: FAN_ANGLE, FAN_RADIUS and at most FAN_PASSES
    // rounds of bisection, from these trials. (At least four elements at a
    // crest or a peak are needed anyway: with two, each a single linear field
    // with no stress on its surface edge, no such pair carried the weight of a
    // cohesionless soil; on a peak of φ′ = 45° under 27° faces λ was 0.09 at
    // F = 1.2, where the slope stands.)
    let mut split_edges: Vec<((usize, usize), usize)> = Vec::new();
    let mut split_index: HashMap<(usize, usize), usize> = HashMap::new();
    let singular: Vec<usize> = corner.clone();
    let reach: Vec<f64> = singular
        .iter()
        .map(|&v| FAN_RADIUS * model.size_field.at(xs[v], ys[v]))
        .collect();
    let span_at = |xs: &[f64], ys: &[f64], v: usize, a: usize, b: usize| -> f64 {
        let ax = xs[a] - xs[v];
        let ay = ys[a] - ys[v];
        let bx = xs[b] - xs[v];
        let by = ys[b] - ys[v];
        js::math::atan2(ax * by - ay * bx, ax * bx + ay * by).abs()
    };
    for _pass in 0..FAN_PASSES {
        let mut marked: HashSet<(usize, usize)> = HashSet::new();
        for t in &tris {
            for (j, &v) in singular.iter().enumerate() {
                let k = t.iter().position(|&n| n == v);
                let mut widest = 0.0;
                let mut ea: i64 = -1;
                let mut eb: i64 = -1;
                if let Some(k) = k {
                    ea = t[(k + 1) % 3] as i64;
                    eb = t[(k + 2) % 3] as i64;
                    widest = span_at(&xs, &ys, v, ea as usize, eb as usize);
                } else {
                    let mut near = f64::INFINITY;
                    for &n in t {
                        near =
                            js::math::min(near, js::math::hypot(&[xs[n] - xs[v], ys[n] - ys[v]]));
                    }
                    if near > reach[j] {
                        continue;
                    }
                    for i in 0..3 {
                        let (a, b) = (t[i], t[(i + 1) % 3]);
                        let w = span_at(&xs, &ys, v, a, b);
                        if w > widest {
                            widest = w;
                            ea = a as i64;
                            eb = b as i64;
                        }
                    }
                }
                if widest > FAN_ANGLE {
                    marked.insert(key_of(ea as usize, eb as usize));
                }
            }
        }
        if marked.is_empty() {
            break;
        }
        let mut mid = |xs: &mut Vec<f64>,
                       ys: &mut Vec<f64>,
                       hs: &mut Vec<f64>,
                       a: usize,
                       b: usize|
         -> usize {
            let key = key_of(a, b);
            if let Some(&m) = split_index.get(&key) {
                return m;
            }
            let m = add_node(
                xs,
                ys,
                hs,
                has_head,
                (xs[a] + xs[b]) / 2.0,
                (ys[a] + ys[b]) / 2.0,
                |hs| (hs[a] + hs[b]) / 2.0,
            );
            split_index.insert(key, m);
            split_edges.push((key, m));
            m
        };
        // a bisected surface edge: its halves on the same model edge
        for i in (0..surf.len()).rev() {
            let [a, b, aa, bb] = surf[i];
            if !marked.contains(&key_of(a, b)) {
                continue;
            }
            let m = mid(&mut xs, &mut ys, &mut hs, a, b);
            surf.splice(i..i + 1, [[a, m, aa, bb], [m, b, aa, bb]]);
            surface_key.remove(&key_of(a, b));
            surface_key.insert(key_of(a, m));
            surface_key.insert(key_of(m, b));
        }
        let mut out: Vec<[usize; 3]> = Vec::new();
        let mut out_meta: Vec<usize> = Vec::new();
        // (the recursion of `split` with an explicit stack, in its order)
        for (i, t) in tris.iter().enumerate() {
            let e = meta[i];
            let mut stack: Vec<[usize; 3]> = vec![*t];
            while let Some(t) = stack.pop() {
                let mut done = true;
                for k in 0..3 {
                    let (a, b, c) = (t[k], t[(k + 1) % 3], t[(k + 2) % 3]);
                    if marked.contains(&key_of(a, b)) {
                        let m = mid(&mut xs, &mut ys, &mut hs, a, b);
                        // split([a, m, c]) first, then split([m, b, c])
                        stack.push([m, b, c]);
                        stack.push([a, m, c]);
                        done = false;
                        break;
                    }
                }
                if done {
                    out.push(t);
                    out_meta.push(e);
                }
            }
        }
        tris = out;
        meta = out_meta;
    }
    // The elements: those, except that one with two edges carrying a traction
    // condition (the free ground surface, or a vertical side, which carries no
    // shear) is split at its centroid into three. A linear stress field with
    // both conditions leaves too little freedom: with no cohesion, a surface
    // edge holds no stress at its nodes, and in an element that also has a
    // side edge equilibrium then demands uniaxial vertical compression under
    // an inclined surface, which a frictional soil cannot carry, or zero
    // stress with two surface edges.
    let mut edge_use: HashMap<(usize, usize), usize> = HashMap::new();
    for t in &tris {
        for k in 0..3 {
            *edge_use.entry(key_of(t[k], t[(k + 1) % 3])).or_insert(0) += 1;
        }
    }
    let mut el_list: Vec<usize> = Vec::new();
    let mut mat_list: Vec<usize> = Vec::new();
    let mut elastic_list: Vec<bool> = Vec::new();
    let mut parent_list: Vec<usize> = Vec::new();
    for (i, cn) in tris.iter().enumerate() {
        let e = meta[i];
        let mut traction = 0;
        for k in 0..3 {
            let (a, b) = (cn[k], cn[(k + 1) % 3]);
            let key = key_of(a, b);
            let side = edge_use.get(&key) == Some(&1)
                && (xs[b] - xs[a]).abs() <= 1e-3 * (ys[b] - ys[a]).abs();
            if surface_key.contains(&key) || side {
                traction += 1;
            }
        }
        let mut parts: Vec<[usize; 3]> = vec![*cn];
        if traction >= 2 {
            let (c0, c1, c2) = (cn[0], cn[1], cn[2]);
            let gx = (xs[c0] + xs[c1] + xs[c2]) / 3.0;
            let gy = (ys[c0] + ys[c1] + ys[c2]) / 3.0;
            let g = add_node(&mut xs, &mut ys, &mut hs, has_head, gx, gy, |hs| {
                (hs[c0] + hs[c1] + hs[c2]) / 3.0
            });
            parts[0] = [c0, c1, g];
            parts.push([c1, c2, g]);
            parts.push([c2, c0, g]);
        }
        for t in parts {
            el_list.extend_from_slice(&t);
            mat_list.push(model.el_material[e]);
            elastic_list.push(model.el_elastic[e]);
            parent_list.push(e);
        }
    }
    // Fans at the singular points: the stress there is singular in direction,
    // and a lower bound needs several stress sectors meeting at the point
    // (Sloan 1988, fans of discontinuities at singular points). Each element
    // at a corner or a load's end is divided into FAN_SECTORS sectors from the
    // point by points halfway towards the opposite edge, so that no new node
    // lies on an edge shared with another element.
    let mut fanned: Vec<usize> = Vec::new();
    let mut fan_mat: Vec<usize> = Vec::new();
    let mut fan_elastic: Vec<bool> = Vec::new();
    let mut fan_parent: Vec<usize> = Vec::new();
    for t in 0..mat_list.len() {
        let tri = [el_list[3 * t], el_list[3 * t + 1], el_list[3 * t + 2]];
        let kv = tri.iter().position(|n| corner_set.contains(n));
        let mut out: Vec<[usize; 3]> = Vec::new();
        match kv {
            None => out.push(tri),
            Some(kv) => {
                let (v, a, b) = (tri[kv], tri[(kv + 1) % 3], tri[(kv + 2) % 3]);
                let mut pts: Vec<usize> = Vec::new();
                for j in 1..FAN_SECTORS {
                    let fj = j as f64 / FAN_SECTORS as f64;
                    let qx = xs[a] + fj * (xs[b] - xs[a]);
                    let qy = ys[a] + fj * (ys[b] - ys[a]);
                    let w = fj;
                    let (px, py) = ((xs[v] + qx) / 2.0, (ys[v] + qy) / 2.0);
                    let p = add_node(&mut xs, &mut ys, &mut hs, has_head, px, py, |hs| {
                        (hs[v] + hs[a] + w * (hs[b] - hs[a])) / 2.0
                    });
                    pts.push(p);
                }
                let mut ring = vec![a];
                ring.extend_from_slice(&pts);
                ring.push(b);
                for j in 0..ring.len() - 1 {
                    out.push([v, ring[j], ring[j + 1]]);
                }
                // the strip between the opposite edge and the inner points
                out.push([a, b, pts[pts.len() - 1]]);
                for j in (1..pts.len()).rev() {
                    out.push([a, pts[j], pts[j - 1]]);
                }
            }
        }
        for o in out {
            fanned.extend_from_slice(&o);
            fan_mat.push(mat_list[t]);
            fan_elastic.push(elastic_list[t]);
            fan_parent.push(parent_list[t]);
        }
    }
    let x = xs;
    let y = ys;
    let el = fanned;
    let el_material = fan_mat;
    let el_elastic = fan_elastic;
    let ne = el_material.len();
    let p = options.sides.unwrap_or(24.0);
    let cutoff = options.tension_cutoff.unwrap_or(false);
    let mut x_lo = f64::INFINITY;
    let mut x_hi = f64::NEG_INFINITY;
    let mut y_hi = f64::NEG_INFINITY;
    for n in 0..x.len() {
        x_lo = js::math::min(x_lo, x[n]);
        x_hi = js::math::max(x_hi, x[n]);
        y_hi = js::math::max(y_hi, y[n]);
    }
    let default_surface = Polyline {
        x: vec![x_lo, x_hi],
        y: vec![y_hi, y_hi],
    };
    let surface: &Polyline = slope.surface_line_xy().unwrap_or(&default_surface);
    let water_lines: Vec<Option<&Polyline>> = model
        .material_ids
        .iter()
        .map(|&m| slope.get_water_line_for_material(Some(m)))
        .collect();
    // (the bars also hold the piles' springs, source −1)
    if model.bars.source.iter().any(|&k| k >= 0) {
        warnings.push("Reinforcement is not included in the lower bound analysis.".to_string());
    }
    if !slope.piles().is_empty() {
        warnings.push("Piles are not included in the lower bound analysis.".to_string());
    }
    let head: Option<&[f64]> = if has_head { Some(&hs) } else { None };

    // Nodal data per element corner: pore pressure and strength.
    let mut n_u = vec![0.0f64; 3 * ne];
    let mut n_c = vec![0.0f64; 3 * ne];
    let mut n_phi = vec![0.0f64; 3 * ne];
    // Undrained cap of a combined material (Infinity where there is none).
    let mut n_cu = vec![f64::INFINITY; 3 * ne];
    let mut all_undrained = true;
    for e in 0..ne {
        let mi = el_material[e];
        let m = &materials[mi];
        let wl = water_lines[mi];
        for k in 0..3 {
            let n = el[3 * e + k];
            let i = 3 * e + k;
            n_u[i] = pore_pressure_at(head, n, wl, x[n], y[n]);
            if el_elastic[e] {
                continue;
            }
            // Strength just inside the element (a node on a boundary takes this element's material).
            let cx = (x[el[3 * e]] + x[el[3 * e + 1]] + x[el[3 * e + 2]]) / 3.0;
            let cy = (y[el[3 * e]] + y[el[3 * e + 1]] + y[el[3 * e + 2]]) / 3.0;
            let px = x[n] + 1e-6 * (cx - x[n]);
            let py = y[n] + 1e-6 * (cy - y[n]);
            let st = strength_at(slope, m, model.material_ids[mi], surface, px, py)?;
            n_c[i] = st.c;
            n_phi[i] = st.phi;
            n_cu[i] = st.cu;
            if n_phi[i] > 0.0 {
                all_undrained = false;
            }
        }
    }

    // Columns: the stresses s(9e + 3k + comp) (σ′x, σ′y, τxy at corner k of
    // element e), free, scaled by γ H; then the load factor λ ≥ 0.
    let mut g_max = 0.0;
    let mut y_lo = f64::INFINITY;
    for m in materials {
        g_max = js::math::max(
            js::math::max(g_max, m.unit_weight()),
            m.model.base().unit_weight_sat.unwrap_or(0.0),
        );
    }
    for n in 0..x.len() {
        y_lo = js::math::min(y_lo, y[n]);
    }
    let stress_scale = js::math::max(g_max, WATER_UNIT_WEIGHT) * js::math::max(y_hi - y_lo, 1e-9);
    let mut pb = ProgramBuilder::new();
    for i in 0..9 * ne {
        pb.col(&format!("s{i}"), false, stress_scale);
    }
    let lam = pb.col("lam", true, 1.0);
    pb.sense = Sense::Max;
    pb.add_objective(lam, 1.0);

    // F-independent rows: equilibrium, discontinuities, boundary tractions.
    for e in 0..ne {
        let n = [el[3 * e], el[3 * e + 1], el[3 * e + 2]];
        let b = [y[n[1]] - y[n[2]], y[n[2]] - y[n[0]], y[n[0]] - y[n[1]]];
        let c = [x[n[2]] - x[n[1]], x[n[0]] - x[n[2]], x[n[1]] - x[n[0]]];
        let area2 = b[0] * c[1] - b[1] * c[0];
        // Weight: the mean unit weight over the element (limit_common.rs).
        let gamma = mean_unit_weight(
            &materials[el_material[e]],
            water_lines[el_material[e]],
            has_head,
            &[x[n[0]], x[n[1]], x[n[2]]],
            &[y[n[0]], y[n[1]], y[n[2]]],
            &[n_u[3 * e], n_u[3 * e + 1], n_u[3 * e + 2]],
        );
        let mut ux = 0.0;
        let mut uy = 0.0;
        for k in 0..3 {
            ux += b[k] * n_u[3 * e + k];
            uy += c[k] * n_u[3 * e + k];
        }
        // Σ b σx + c τ − λ Σ b u = 0
        let mut r1: Vec<(usize, f64)> = Vec::with_capacity(7);
        let mut r2: Vec<(usize, f64)> = Vec::with_capacity(7);
        for k in 0..3 {
            r1.push((v(e, k, 0), b[k]));
            r1.push((v(e, k, 2), c[k]));
            r2.push((v(e, k, 2), b[k]));
            r2.push((v(e, k, 1), c[k]));
        }
        r1.push((lam, -ux));
        r2.push((lam, -(uy + area2 * gamma)));
        pb.eq(&r1, 0.0);
        pb.eq(&r2, 0.0);
    }
    // Edges: find each edge's elements by corner pair.
    let nc = x.len(); // key multiplier for node pairs
    let mut edge_owner: InsertionMap<(usize, usize)> = InsertionMap::new();
    // the ground surface edges, by their index in `surf`
    let mut surface_set: HashMap<usize, usize> = HashMap::new();
    for (s, &[a, b, _, _]) in surf.iter().enumerate() {
        surface_set.insert(if a < b { a * nc + b } else { b * nc + a }, s);
    }
    let mut row: Vec<(usize, f64)> = Vec::with_capacity(7);
    for e in 0..ne {
        for k in 0..3 {
            let a = el[3 * e + k];
            let b = el[3 * e + (k + 1) % 3];
            let key = if a < b { a * nc + b } else { b * nc + a };
            let len = js::math::hypot(&[x[b] - x[a], y[b] - y[a]]);
            let nx = (y[b] - y[a]) / len;
            let ny = -(x[b] - x[a]) / len; // outward for this element
            if let Some(&(e2, k2)) = edge_owner.get(key) {
                // continuity of total normal and shear traction at both ends
                let a2 = el[3 * e2 + k2];
                for (kk, node) in [(k, a), ((k + 1) % 3, b)] {
                    let kk2 = if node == a2 { k2 } else { (k2 + 1) % 3 };
                    let du = n_u[3 * e + kk] - n_u[3 * e2 + kk2];
                    // σ′n(e) − λ u(e) = σ′n(e2) − λ u(e2)
                    row.clear();
                    row.extend_from_slice(&sn(e, kk, nx, ny, 1.0));
                    row.extend_from_slice(&sn(e2, kk2, nx, ny, -1.0));
                    row.push((lam, -du));
                    pb.eq(&row, 0.0);
                    row.clear();
                    row.extend_from_slice(&ts(e, kk, nx, ny, 1.0));
                    row.extend_from_slice(&ts(e2, kk2, nx, ny, -1.0));
                    pb.eq(&row, 0.0);
                }
                edge_owner.delete(key);
            } else {
                edge_owner.set(key, (e, k));
            }
        }
    }
    // Remaining edges are on the boundary. The supports are those of the
    // strength reduction model (model.rs): a vertical side is a smooth roller,
    // so it carries no shear; the base is fixed and carries any traction.
    for (key, &(e, k)) in edge_owner.iter() {
        if surface_set.contains_key(&key) {
            continue;
        }
        let a = el[3 * e + k];
        let b = el[3 * e + (k + 1) % 3];
        if (x[b] - x[a]).abs() > 1e-3 * (y[b] - y[a]).abs() {
            continue;
        }
        let len = js::math::hypot(&[x[b] - x[a], y[b] - y[a]]);
        let nx = (y[b] - y[a]) / len;
        let ny = -(x[b] - x[a]) / len;
        for kk in [k, (k + 1) % 3] {
            pb.eq(&ts(e, kk, nx, ny, 1.0), 0.0);
        }
    }
    // On the ground surface the traction is prescribed.
    for (key, &(e, k)) in edge_owner.iter() {
        let Some(&s) = surface_set.get(&key) else {
            continue;
        };
        let a = el[3 * e + k];
        let b = el[3 * e + (k + 1) % 3];
        // Ponded water: the line of the element's material, as model.rs; with
        // seepage the water table that drives the flow.
        let pond_line = if has_head {
            slope.water_rl_xy()
        } else {
            water_lines[el_material[e]]
        };
        let len = js::math::hypot(&[x[b] - x[a], y[b] - y[a]]);
        let nx = (y[b] - y[a]) / len;
        let ny = -(x[b] - x[a]) / len;
        for (kk, node) in [(k, a), ((k + 1) % 3, b)] {
            // loads: ponded water (normal pressure) and strip loads (vertical, per horizontal metre)
            let mut pw = 0.0;
            if let Some(pl) = pond_line {
                let yw = polyline_y(pl, x[node]);
                pw = if yw.is_finite() {
                    WATER_UNIT_WEIGHT * js::math::max(0.0, yw - y[node])
                } else {
                    0.0
                };
            }
            // A strip load acts on the edges whose middle it covers: the node at its
            // end carries it on one side and not on the other (nodes are not shared).
            let q = surface_load(slope, &surf, &line_q, &x, n_key, load_factor, s, node);
            // traction vector t = −pw n + (0, −q |n_y|); σn,total = t·n, τ = t·s with s = (−ny, nx)
            let tx = -pw * nx;
            let ty = -pw * ny - q * ny.abs();
            let tn = tx * nx + ty * ny;
            let tt = -tx * ny + ty * nx;
            // σ′n − λ u = λ tn ; τ = λ ts
            row.clear();
            row.extend_from_slice(&sn(e, kk, nx, ny, 1.0));
            row.push((lam, -(n_u[3 * e + kk] + tn)));
            pb.eq(&row, 0.0);
            row.clear();
            row.extend_from_slice(&ts(e, kk, nx, ny, 1.0));
            row.push((lam, -tt));
            pb.eq(&row, 0.0);
        }
    }
    let fixed = pb.build();

    let mut cone_count = 0;
    for e in 0..ne {
        if el_elastic[e] {
            continue;
        }
        cone_count += 3 * if cutoff { 2 } else { 1 };
        for k in 0..3 {
            if n_cu[3 * e + k].is_finite() {
                cone_count += 1;
            }
        }
    }
    let psi: Vec<f64> = fan_parent.iter().map(|&pe| model.el_psi[pe]).collect();
    let constraints = fixed.eq_rhs.len() + cone_count;
    Ok(LbProblem {
        fixed,
        elastic: el_elastic,
        n_c,
        n_phi,
        n_cu,
        psi,
        cutoff,
        rule: options.strength_rule.unwrap_or_default(),
        sides: p,
        all_undrained,
        elements: ne,
        variables: 9 * ne + 1,
        constraints,
        warnings,
        mesh: LbMesh {
            x,
            y,
            el,
            parent: fan_parent,
            split: split_edges,
            split_index,
        },
    })
}

/// The time and the programs of one bound's search (`lambdaAt`'s closure state).
pub(crate) struct BoundSearch<'o> {
    options: &'o LowerBoundOptions,
    search_start: f64,
    out_of_time: bool,
    pub(crate) trials: Vec<BoundTrial>,
    pub(crate) warnings: Vec<String>,
}

impl<'o> BoundSearch<'o> {
    pub(crate) fn new(options: &'o LowerBoundOptions, warnings: Vec<String>, ctx: &RunCtx) -> Self {
        BoundSearch {
            options,
            search_start: ctx.clock.now_ms(),
            out_of_time: false,
            trials: Vec::new(),
            warnings,
        }
    }

    /// Solve the program at F within the time left (None: the search's time
    /// limit is reached, a warning given once).
    pub(crate) fn solve(
        &mut self,
        ctx: &RunCtx,
        f: f64,
        program: impl FnOnce(f64) -> ConicProgram,
        sides: f64,
    ) -> Result<Option<(ConicSolution, f64)>> {
        ctx.check_cancelled()?;
        let t0 = ctx.clock.now_ms();
        let remaining = self.options.total_time_limit.unwrap_or(f64::INFINITY)
            - (t0 - self.search_start) / 1000.0;
        if remaining <= 0.0 {
            if !self.out_of_time {
                self.warnings.push(format!(
                    "The search stopped at its time limit of {} s.",
                    self.options
                        .total_time_limit
                        .map_or("undefined".to_string(), js::num::to_string)
                ));
            }
            self.out_of_time = true;
            return Ok(None);
        }
        let r = bound_solve(
            &program(f),
            sides,
            js::math::min(self.options.time_limit.unwrap_or(300.0), remaining),
        );
        Ok(Some((r, t0)))
    }

    /// Record a trial that started at `t0`.
    pub(crate) fn record(&mut self, ctx: &RunCtx, f: f64, lambda: f64, t0: f64) {
        self.trials.push(BoundTrial {
            f,
            lambda,
            seconds: (ctx.clock.now_ms() - t0) / 1000.0,
        });
    }
}

/// Lower bound on the factor of safety of a slope.
pub fn lower_bound(
    slope: &Slope,
    options: &LowerBoundOptions,
    ctx: &mut RunCtx,
) -> Result<LowerBoundResult> {
    let prob = lower_bound_problem(slope, options)?;
    let mut search = BoundSearch::new(options, prob.warnings.clone(), ctx);
    let lambda_at = |search: &mut BoundSearch, f: f64| -> Result<f64> {
        let Some((r, t0)) = search.solve(ctx, f, |f| prob.program(f), prob.sides)? else {
            return Ok(f64::NAN);
        };
        // Only an optimal program gives a load factor; any other status
        // (time limit, numerical trouble) gives none, and F is not bounded there.
        let lambda = match r.status {
            ConicStatus::Optimal => r.objective,
            ConicStatus::Unbounded => f64::INFINITY,
            _ => f64::NAN,
        };
        if r.status != ConicStatus::Optimal && r.status != ConicStatus::Unbounded {
            search.warnings.push(format!(
                "The program at F = {} ended with status \"{}\".",
                js::num::to_fixed(f, 3),
                r.detail
            ));
        }
        search.record(ctx, f, lambda, t0);
        Ok(lambda)
    };
    let tol = options.f_tolerance.unwrap_or(0.002);
    let f0 = match options.start_f {
        Some(s) if s > 0.0 => s,
        _ => 1.0,
    };
    let l1 = lambda_at(&mut search, f0)?;
    let done = |search: BoundSearch, f: f64, reason: Option<String>| -> LowerBoundResult {
        let mut warnings = search.warnings;
        if let Some(r) = reason {
            warnings.push(r);
        }
        LowerBoundResult {
            factor_of_safety: f,
            trials: search.trials,
            elements: prob.elements,
            variables: prob.variables,
            constraints: prob.constraints,
            warnings,
        }
    };
    if l1.is_nan() {
        let reason = format!(
            "The program at F = {} was not solved.",
            js::num::to_fixed(f0, 3)
        );
        return Ok(done(search, f64::NAN, Some(reason)));
    }
    // A reduction F with λ(F) ≥ 1 carries the loads with the reduced
    // strength in an admissible stress field: F is a lower bound. The result
    // is the largest such F evaluated, never an extrapolation.
    let f_result: f64;
    if prob.all_undrained {
        if !(l1 > 0.0) || !l1.is_finite() {
            return Ok(done(
                search,
                f64::NAN,
                Some("The program has no admissible stress field.".into()),
            ));
        }
        f_result = l1 * f0; // λ(F) = λ(F0)·F0/F, so λ(λ(F0)·F0) = 1 exactly
    } else if l1 == 0.0 || l1 == f64::INFINITY {
        // Without cohesion every constraint is homogeneous in the stresses and
        // λ, so λ is 0 or unbounded: F is found by bisection on whether the
        // loads can be carried (λ(F) ≥ 1).
        let ok = |search: &mut BoundSearch, f: f64| -> Result<Option<bool>> {
            let l = lambda_at(search, f)?;
            Ok(if l.is_nan() { None } else { Some(l >= 1.0) })
        };
        let mut lo = 0.0;
        let mut hi = f64::INFINITY;
        if l1 >= 1.0 {
            lo = f0;
        } else {
            hi = f0;
        }
        let mut k = 0;
        while k < 20 && (lo == 0.0 || hi == f64::INFINITY) {
            let f = if lo == 0.0 { hi / 1.5 } else { lo * 1.5 };
            if f < 0.05 || f > 100.0 {
                break;
            }
            match ok(&mut search, f)? {
                None => break,
                Some(true) => lo = f,
                Some(false) => hi = f,
            }
            k += 1;
        }
        while lo > 0.0 && hi.is_finite() && hi - lo > tol {
            let f = (lo + hi) / 2.0;
            match ok(&mut search, f)? {
                None => break,
                Some(true) => lo = f,
                Some(false) => hi = f,
            }
        }
        if !(lo > 0.0) {
            return Ok(done(
                search,
                f64::NAN,
                Some("No reduction with an admissible stress field carrying the loads was found. Without cohesion the linear stress elements cannot carry the weight at the corners of the ground surface; the lower bound needs some cohesion there.".into()),
            ));
        }
        if !hi.is_finite() || hi - lo > tol {
            search.warnings.push(format!(
                "The bisection stopped with F between {} and {}; F is the lower of the two.",
                js::num::to_fixed(lo, 3),
                if hi.is_finite() {
                    js::num::to_fixed(hi, 3)
                } else {
                    "∞".to_string()
                }
            ));
        }
        f_result = lo;
    } else {
        let mut best = if l1 >= 1.0 { f0 } else { 0.0 };
        let mut failed = if l1 < 1.0 { f0 } else { f64::INFINITY };
        let certify = |best: &mut f64, failed: &mut f64, f: f64, l: f64| {
            if l >= 1.0 {
                *best = js::math::max(*best, f);
            } else {
                *failed = js::math::min(*failed, f);
            }
        };
        // Secant on g(F) = log λ(F), decreasing, root where λ = 1. The next
        // trial is placed tol/2 below the secant's root, so that it lands on
        // the admissible side; the search stops when a certified F lies within
        // tol of the root estimate, or of a reduction that fails. A trial off
        // the bracket between them, or after λ = 0 or ∞ (a cohesionless soil
        // at the ground surface makes λ jump there: on V012 from 1.6 to 0 at
        // its embankment's face, tan φ′/tan β = 0.80), bisects it.
        let mut fa = f0;
        let mut la = l1;
        let mut fb = f0
            * if l1 > 1.0 {
                js::math::min(l1, 1.5)
            } else {
                js::math::max(l1, 0.67)
            };
        let mut lb = lambda_at(&mut search, fb)?;
        certify(&mut best, &mut failed, fb, lb);
        let mut reached = false;
        let mut root = f64::NAN;
        let near = |l: f64| l > 0.5 && l < 2.0;
        let mut it = 0;
        while it < 25 && !lb.is_nan() {
            if best > 0.0 && failed - best <= tol {
                reached = true;
                break;
            }
            let mut next = f64::NAN;
            if la > 0.0
                && lb > 0.0
                && la.is_finite()
                && lb.is_finite()
                && (js::math::log(lb) - js::math::log(la)).abs() >= 1e-14
            {
                root = js::math::max(
                    0.05,
                    fb - (js::math::log(lb) * (fb - fa)) / (js::math::log(lb) - js::math::log(la)),
                );
                // (the secant's root decides only from trials near λ = 1, not across a jump)
                if best > 0.0 && best >= root - tol && near(la) && near(lb) {
                    reached = true;
                    break;
                }
                next = root - tol / 2.0;
            }
            if !(next > best && next < failed && next >= 0.05) {
                next = if best > 0.0 && failed.is_finite() {
                    (best + failed) / 2.0
                } else if best > 0.0 {
                    1.5 * best
                } else {
                    failed / 1.5
                };
            }
            if next < 0.05 || next > 100.0 {
                break;
            }
            fa = fb;
            la = lb;
            fb = next;
            lb = lambda_at(&mut search, fb)?;
            certify(&mut best, &mut failed, fb, lb);
            it += 1;
        }
        if !(best > 0.0) {
            return Ok(done(
                search,
                f64::NAN,
                Some(
                    "No reduction with an admissible stress field carrying the loads was found."
                        .into(),
                ),
            ));
        }
        if !reached {
            search.warnings.push(format!(
                "The search for λ = 1 stopped before converging{}; F is the largest reduction found to carry the loads.",
                if root.is_finite() {
                    format!(" (estimated root F = {})", js::num::to_fixed(root, 3))
                } else {
                    String::new()
                }
            ));
        }
        f_result = best;
    }
    Ok(done(search, f_result, None))
}
