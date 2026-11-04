//! Port of packages/engine/src/fem/seepage.ts.
//!
//! Steady seepage by finite elements on the slope's mesh, for pore pressures
//! from flow instead of a drawn water line.
//!
//! Head h on the six-node triangles, ∇·(k ∇h) = 0 (Galerkin finite
//! elements). Boundary conditions:
//!  - on the ground surface where the water table is at or above the ground
//!    (a reservoir, ponded water, the water level at a downstream toe): the
//!    head of the water there, h = y_w, imposed by a large number on the
//!    diagonal (penalty), as Bathe & Khoshgoftaar (1979) impose prescribed
//!    heads;
//!  - elsewhere on the ground surface: a seepage face, h = y, at the nodes
//!    where water leaves the soil, and no flow at the others. The face is
//!    found by switching nodes between the two conditions until neither
//!    inequality is violated (h ≤ y on the no-flow part, outflow on the
//!    face): Neuman & Witherspoon 1970, Water Resour. Res. 6(3), 889–897;
//!    Cooley 1983, Water Resour. Res. 19(5), 1271–1285;
//!  - vertical sides of the model: the head of the water table, h = y_w,
//!    below it (far-field hydrostatic water, so that a water table drawn
//!    below the ground is held at the model's edges), no flow above it;
//!  - base: no flow.
//!
//! Free surface on a fixed mesh: the permeability depends on the pressure
//! head ψ = h − y (Bathe & Khoshgoftaar 1979, Int. J. Numer. Anal. Meth.
//! Geomech. 3(1), 13–22), full where ψ ≥ 0 and, above the phreatic surface,
//! k·k_r(ψ) with the relative permeability of van Genuchten (1980, Soil Sci.
//! Soc. Am. J. 44(5), 892–898) and Mualem (1976, Water Resour. Res. 12(3),
//! 513–522): S_e = [1 + (α|ψ|)ⁿ]^(−m), m = 1 − 1/n,
//! k_r = S_e^½ [1 − (1 − S_e^(1/m))^m]². The default α = 3.6 m⁻¹ and
//! n = 1.56 are the class averages for loam of Carsel & Parrish (1988,
//! Water Resour. Res. 24(5), 755–769). The nonlinear problem is solved by
//! Picard iteration on the permeability with Aitken's dynamic
//! under-relaxation (see below). Pore pressure is u = γw (h − y) ≥ 0;
//! suction is not used for strength (χ = 0).
//!
//! Implementation choices (not from the literature): k_r is bounded below
//! by 10⁻⁶ to keep the system well conditioned; at most 80 iterations;
//! convergence when the unrelaxed change of the heads is below 0.1 % of
//! the range of heads and elevations; a corner node of the seepage face is
//! judged by its flow with half of each adjacent face edge's midside flow
//! (lumped), because the consistent flows of a six-node edge can show
//! inflow at a corner under outflow from the whole edge.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::error::Result;
use crate::fem::elements::{shape_t6, GAUSS_T6, GP_STRIDE};
use crate::fem::model::polyline_y;
use crate::fem::sparse::{nested_dissection, node_graph, SparseCholesky};
use crate::js;
use crate::model::slope::Slope;
use crate::types::WATER_UNIT_WEIGHT;
use serde::Serialize;

/// The mesh and flow parameters of a seepage problem (`SeepageMesh`).
pub struct SeepageMesh<'a> {
    pub x: &'a [f64],
    pub y: &'a [f64],
    pub node_count: usize,
    pub el: &'a [usize],
    pub element_count: usize,
    pub gp: &'a [f64],
    /// Surface edges, 3 nodes each (end, middle, end).
    pub surface_edges: &'a [usize],
    /// Nodes on the vertical sides of the model.
    pub side_nodes: &'a [usize],
    /// Permeability per element (m/s).
    pub permeability: &'a [f64],
    /// van Genuchten α (1/m) and n per element.
    pub vg_alpha: &'a [f64],
    pub vg_n: &'a [f64],
}

/// `SeepageResult`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeepageResult {
    /// Total head per node (m).
    pub head: Vec<f64>,
    pub iterations: usize,
    pub converged: bool,
    /// Nodes on a seepage face at the end.
    pub seepage_face_nodes: usize,
    /// False when no head is prescribed anywhere: no flow is computed and `head` is the water table.
    pub flow: bool,
}

/// Lower bound of the relative permeability (implementation choice).
const MIN_RELATIVE_PERMEABILITY: f64 = 1e-6;

/// Relative permeability of van Genuchten (1980) and Mualem (1976) at pressure head ψ (m).
pub fn van_genuchten_mualem(psi: f64, alpha: f64, n: f64) -> f64 {
    if psi >= 0.0 {
        return 1.0;
    }
    let m = 1.0 - 1.0 / n;
    let se = js::math::pow(1.0 + js::math::pow(alpha * -psi, n), -m);
    let kr = se.sqrt()
        * js::math::pow(
            1.0 - js::math::pow(1.0 - js::math::pow(se, 1.0 / m), m),
            2.0,
        );
    js::math::max(MIN_RELATIVE_PERMEABILITY, kr)
}

/// Steady head field on a mesh, with the water table of `slope` as reservoir
/// and tail water (TypeScript default `max_iterations` 80).
pub fn solve_seepage(
    mesh: &SeepageMesh,
    slope: &Slope,
    max_iterations: usize,
) -> Result<SeepageResult> {
    let (x, y, nn, el, ne, gp) = (
        mesh.x,
        mesh.y,
        mesh.node_count,
        mesh.el,
        mesh.element_count,
        mesh.gp,
    );
    let water = slope.water_rl_xy();
    // Surface nodes and their water level.
    let mut on_surface = vec![false; nn];
    for &n in mesh.surface_edges {
        on_surface[n] = true;
    }
    let mut fixed_head = vec![f64::NAN; nn];
    let mut y_min = f64::INFINITY;
    let mut y_max = f64::NEG_INFINITY;
    for n in 0..nn {
        y_min = js::math::min(y_min, y[n]);
        y_max = js::math::max(y_max, y[n]);
    }
    let tol = 1e-6 * (1.0 + y_max - y_min);
    for n in 0..nn {
        let Some(water) = water else { continue };
        if !on_surface[n] {
            continue;
        }
        let yw = polyline_y(water, x[n]);
        if yw.is_finite() && yw >= y[n] - tol {
            fixed_head[n] = js::math::max(yw, y[n]);
        }
    }
    if let Some(water) = water {
        for &n in mesh.side_nodes {
            let yw = polyline_y(water, x[n]);
            if yw.is_finite() && yw >= y[n] {
                fixed_head[n] = yw;
            }
        }
    }
    if !fixed_head.iter().any(|v| v.is_finite()) {
        // No water anywhere on the boundary: no flow.
        let head = (0..nn)
            .map(|n| match water {
                Some(water) => polyline_y(water, x[n]),
                None => f64::NEG_INFINITY,
            })
            .collect();
        return Ok(SeepageResult {
            head,
            iterations: 0,
            converged: true,
            seepage_face_nodes: 0,
            flow: false,
        });
    }
    // Corner nodes of surface edges, and the midside node of each, for the
    // lumped flows of the seepage face.
    let mut surface_corner = vec![false; nn];
    let se = mesh.surface_edges;
    let mut k = 0;
    while k < se.len() {
        surface_corner[se[k]] = true;
        surface_corner[se[k + 2]] = true;
        k += 3;
    }
    let mut h_range = f64::NEG_INFINITY;
    for n in 0..nn {
        if fixed_head[n].is_finite() {
            h_range = js::math::max(h_range, fixed_head[n]);
        }
    }
    h_range = js::math::max(h_range, y_max) - y_min;
    // One unknown per node, in nested dissection order.
    let order = nested_dissection(x, y, &node_graph(el, ne, nn));
    let mut eqn = vec![0usize; nn];
    for (i, &n) in order.iter().enumerate() {
        eqn[n] = i;
    }
    let el_eq: Vec<i64> = (0..6 * ne).map(|k| eqn[el[k]] as i64).collect();
    let pattern = SparseCholesky::from_groups(nn, &el_eq, 6);

    // Start from the highest prescribed head everywhere.
    let mut h_max = f64::NEG_INFINITY;
    for n in 0..nn {
        if fixed_head[n].is_finite() {
            h_max = js::math::max(h_max, fixed_head[n]);
        }
    }
    let mut head: Vec<f64> = (0..nn)
        .map(|n| {
            if fixed_head[n].is_finite() {
                fixed_head[n]
            } else {
                h_max
            }
        })
        .collect();
    let mut seep_face = vec![false; nn];
    // Element conductivity matrices of the current iteration (6 × 6 each),
    // for the nodal flows of the seepage face.
    let mut el_k = vec![0.0f64; 36 * ne];
    let mut nsh = [0.0f64; 6];
    let mut converged = false;
    let mut it = 0;
    let mut omega = 1.0;
    let mut prev_r: Option<Vec<f64>> = None;
    while it < max_iterations && !converged {
        let mut kmat = pattern.empty_copy(false);
        el_k.fill(0.0);
        for e in 0..ne {
            for g in 0..3 {
                let o = (3 * e + g) * GP_STRIDE;
                let w = gp[o + 12];
                shape_t6(GAUSS_T6[g][0], GAUSS_T6[g][1], &mut nsh);
                let (mut h, mut yy) = (0.0, 0.0);
                for k in 0..6 {
                    h += nsh[k] * head[el[6 * e + k]];
                    yy += nsh[k] * y[el[6 * e + k]];
                }
                let kr = van_genuchten_mualem(h - yy, mesh.vg_alpha[e], mesh.vg_n[e]);
                let kk = mesh.permeability[e] * kr * w;
                for a in 0..6 {
                    for b in 0..=a {
                        let v = kk * (gp[o + a] * gp[o + b] + gp[o + 6 + a] * gp[o + 6 + b]);
                        kmat.add(eqn[el[6 * e + a]], eqn[el[6 * e + b]], v)?;
                        el_k[36 * e + 6 * a + b] += v;
                        if a != b {
                            el_k[36 * e + 6 * b + a] += v;
                        }
                    }
                }
            }
        }
        // Dirichlet nodes by a penalty on the diagonal (heads are O(10–100) m).
        let mut big = 0.0;
        for i in 0..nn {
            big = js::math::max(big, kmat.values[kmat.diag[i]]);
        }
        big *= 1e10;
        let mut b = vec![0.0f64; nn];
        for n in 0..nn {
            let hf = if fixed_head[n].is_finite() {
                fixed_head[n]
            } else if seep_face[n] {
                y[n]
            } else {
                f64::NAN
            };
            if hf.is_finite() {
                let d = kmat.diag[eqn[n]];
                kmat.values[d] += big;
                b[eqn[n]] = big * hf;
            }
        }
        kmat.factor()?;
        kmat.solve(&mut b);
        let mut rhs: Vec<f64> = (0..nn).map(|n| b[eqn[n]]).collect();
        // Nodal flows K·h: the water a prescribed node supplies (> 0 enters the
        // ground); zero at a free node.
        let mut flow = vec![0.0f64; nn];
        for e in 0..ne {
            for a in 0..6 {
                let mut q = 0.0;
                for c in 0..6 {
                    q += el_k[36 * e + 6 * a + c] * rhs[el[6 * e + c]];
                }
                flow[el[6 * e + a]] += q;
            }
        }
        let mut q_max = 0.0;
        for n in 0..nn {
            if fixed_head[n].is_finite() || seep_face[n] {
                q_max = js::math::max(q_max, flow[n].abs());
            }
        }
        // Seepage face: a free surface node with h > y joins it; a face node that
        // draws water in leaves it (water only leaves the ground there). A
        // corner node is judged by its lumped flow (file header).
        let mut lumped = flow.clone();
        let mut k = 0;
        while k < se.len() {
            let m = se[k + 1];
            lumped[se[k]] += 0.5 * flow[m];
            lumped[se[k + 2]] += 0.5 * flow[m];
            k += 3;
        }
        let mut changed = 0;
        for n in 0..nn {
            if !on_surface[n] || fixed_head[n].is_finite() {
                continue;
            }
            let q = if surface_corner[n] {
                lumped[n]
            } else {
                flow[n]
            };
            if !seep_face[n] && rhs[n] > y[n] + tol {
                seep_face[n] = true;
                changed += 1;
            } else if seep_face[n] && q > 1e-6 * q_max {
                seep_face[n] = false;
                changed += 1;
            }
        }
        // Under-relaxed Picard update with Aitken's dynamic relaxation factor
        // (Irons & Tuck 1969, IJNME 1(3), 275–277; Küttler & Wall 2008, Comput.
        // Mech. 43(1), 61–72): with the residual r_k = h̃_k − h_k of the fixed
        // point, ω_k = −ω_(k−1) r_(k−1)ᵀ(r_k − r_(k−1)) / |r_k − r_(k−1)|².
        // Bounding ω to [0.05, 1] is an implementation choice.
        let mut r = vec![0.0f64; nn];
        let mut max_dh = 0.0;
        for n in 0..nn {
            r[n] = rhs[n] - head[n];
            max_dh = js::math::max(max_dh, r[n].abs());
        }
        if let Some(prev_r) = &prev_r {
            let (mut num, mut den) = (0.0, 0.0);
            for n in 0..nn {
                let d = r[n] - prev_r[n];
                num += prev_r[n] * d;
                den += d * d;
            }
            if den > 0.0 {
                omega = js::math::min(1.0, js::math::max(0.05, (-omega * num) / den));
            }
        }
        for n in 0..nn {
            rhs[n] = head[n] + omega * r[n];
        }
        prev_r = Some(r);
        head = rhs;
        // Converged when the unrelaxed change (the fixed point residual) is
        // below 0.1 % of the range of heads and the seepage face no longer
        // changes; a small relaxation factor does not make the step pass.
        converged = changed == 0 && max_dh < 1e-3 * (1.0 + h_range);
        it += 1;
    }
    let faces = seep_face.iter().filter(|&&v| v).count();
    Ok(SeepageResult {
        head,
        iterations: it,
        converged,
        seepage_face_nodes: faces,
        flow: true,
    })
}

/// Pore pressure (kPa) at a point from nodal heads interpolated in an element.
pub fn pore_pressure_from_head(h: f64, yy: f64) -> f64 {
    js::math::max(0.0, WATER_UNIT_WEIGHT * (h - yy))
}
