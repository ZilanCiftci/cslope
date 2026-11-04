//! Port of packages/engine/src/fem/transfer.ts.
//!
//! Transfer of a converged state to a refined mesh of the same slope, as the
//! starting state of the strength reduction there (analysis.ts).
//!
//! The displacements are interpolated at the new nodes with the old
//! element's quadratic shape functions; the plastic strains and stresses of
//! a new Gauss point are those of the nearest Gauss point of the old element
//! that contains it (Peric, Hochard, Dutko & Owen 1996, Comput. Methods Appl.
//! Mech. Eng. 137, 331–344, transfer of the internal variables by the
//! Gauss points). The state is not in equilibrium on the new mesh: it only
//! starts the iteration, and each trial is decided there as before.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::fem::elements::shape_t6;
use crate::fem::model::FeModel;
use crate::fem::srm::SrmState;
use crate::js;

/// The old elements on a bucket grid of their boxes (`locator`'s closure state).
struct Locator<'a> {
    m: &'a FeModel,
    x0: f64,
    y0: f64,
    dx: f64,
    dy: f64,
    nb: usize,
    cells: Vec<Vec<usize>>,
}

/// `Math.min(nb − 1, Math.max(0, Math.floor((v − v0) / d)))` as an index
/// (a NaN coordinate, which TypeScript would fail on, takes cell 0).
fn cell(v: f64, v0: f64, d: f64, nb: usize) -> usize {
    let c = js::math::min((nb - 1) as f64, js::math::max(0.0, ((v - v0) / d).floor()));
    if c.is_nan() {
        0
    } else {
        c as usize
    }
}

/// `||` on a number: the value unless it is 0 or NaN.
fn or_one(v: f64) -> f64 {
    if v == 0.0 || v.is_nan() {
        1.0
    } else {
        v
    }
}

impl<'a> Locator<'a> {
    fn new(m: &'a FeModel) -> Self {
        let (x, y, el, ne) = (&m.x, &m.y, &m.el, m.element_count);
        let (mut x0, mut x1, mut y0, mut y1) = (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        );
        for i in 0..m.corner_count {
            x0 = js::math::min(x0, x[i]);
            x1 = js::math::max(x1, x[i]);
            y0 = js::math::min(y0, y[i]);
            y1 = js::math::max(y1, y[i]);
        }
        let nb = js::math::max(1.0, (ne as f64).sqrt().ceil()) as usize;
        let dx = or_one((x1 - x0) / nb as f64);
        let dy = or_one((y1 - y0) / nb as f64);
        let mut cells: Vec<Vec<usize>> = vec![Vec::new(); nb * nb];
        for e in 0..ne {
            let (a, b, c) = (el[6 * e], el[6 * e + 1], el[6 * e + 2]);
            let i0 = cell(js::math::min(js::math::min(x[a], x[b]), x[c]), x0, dx, nb);
            let i1 = cell(js::math::max(js::math::max(x[a], x[b]), x[c]), x0, dx, nb);
            let j0 = cell(js::math::min(js::math::min(y[a], y[b]), y[c]), y0, dy, nb);
            let j1 = cell(js::math::max(js::math::max(y[a], y[b]), y[c]), y0, dy, nb);
            for i in i0..=i1 {
                for j in j0..=j1 {
                    cells[j * nb + i].push(e);
                }
            }
        }
        Locator {
            m,
            x0,
            y0,
            dx,
            dy,
            nb,
            cells,
        }
    }

    fn local(&self, e: usize, px: f64, py: f64) -> (f64, f64) {
        let (x, y, el) = (&self.m.x, &self.m.y, &self.m.el);
        let (a, b, c) = (el[6 * e], el[6 * e + 1], el[6 * e + 2]);
        let ax = x[b] - x[a];
        let ay = y[b] - y[a];
        let bx = x[c] - x[a];
        let by = y[c] - y[a];
        let det = ax * by - ay * bx;
        let qx = px - x[a];
        let qy = py - y[a];
        ((qx * by - qy * bx) / det, (ax * qy - ay * qx) / det)
    }

    /// The old element containing (px, py) and its local coordinates (ξ, η).
    fn find(&self, px: f64, py: f64) -> Option<(usize, f64, f64)> {
        // the element whose local coordinates are least outside it (a point on
        // an edge, or just off the outline by rounding, still finds one)
        let mut best: i64 = -1;
        let mut best_out = f64::INFINITY;
        let (mut bxi, mut beta) = (0.0, 0.0);
        let ci =
            cell(py, self.y0, self.dy, self.nb) * self.nb + cell(px, self.x0, self.dx, self.nb);
        for &e in &self.cells[ci] {
            let (xi, eta) = self.local(e, px, py);
            let out = js::math::max(js::math::max(js::math::max(0.0, -xi), -eta), xi + eta - 1.0);
            if out < best_out {
                best_out = out;
                best = e as i64;
                bxi = xi;
                beta = eta;
                if out == 0.0 {
                    break;
                }
            }
        }
        if best >= 0 && best_out < 1e-6 {
            Some((best as usize, bxi, beta))
        } else {
            None
        }
    }
}

/// The converged `state` of `from` as a starting state on the mesh of `to`; None where a point of `to` lies outside `from`.
pub fn transfer_state(from: &FeModel, state: &SrmState, to: &FeModel) -> Option<SrmState> {
    let find = Locator::new(from);
    let mut nsh = [0.0f64; 6];
    let mut u = vec![0.0f64; to.eq_count];
    for n in 0..to.node_count {
        let ix = to.eq[2 * n];
        let iy = to.eq[2 * n + 1];
        if ix < 0 && iy < 0 {
            continue;
        }
        let (e, xi, eta) = find.find(to.x[n], to.y[n])?;
        shape_t6(xi, eta, &mut nsh);
        let (mut ux, mut uy) = (0.0, 0.0);
        for k in 0..6 {
            let node = from.el[6 * e + k];
            let qx = from.eq[2 * node];
            let qy = from.eq[2 * node + 1];
            if qx >= 0 {
                ux += nsh[k] * state.u[qx as usize];
            }
            if qy >= 0 {
                uy += nsh[k] * state.u[qy as usize];
            }
        }
        if ix >= 0 {
            u[ix as usize] = ux;
        }
        if iy >= 0 {
            u[iy as usize] = uy;
        }
    }
    let ngp = 3 * to.element_count;
    let mut evp = vec![0.0f64; 4 * ngp];
    let mut stress = vec![0.0f64; 4 * ngp];
    for g in 0..ngp {
        let (px, py) = (to.gp_x[g], to.gp_y[g]);
        let (e, _, _) = find.find(px, py)?;
        let mut src = 3 * e;
        let mut d = f64::INFINITY;
        for k in 0..3 {
            let s = 3 * e + k;
            let dd = js::math::pow(from.gp_x[s] - px, 2.0) + js::math::pow(from.gp_y[s] - py, 2.0);
            if dd < d {
                d = dd;
                src = s;
            }
        }
        for c in 0..4 {
            evp[4 * g + c] = state.evp[4 * src + c];
            stress[4 * g + c] = state.stress[4 * src + c];
        }
    }
    Some(SrmState {
        u,
        evp,
        body_loads: vec![0.0; to.eq_count],
        stress,
        bar_ep: Vec::new(),
    })
}
