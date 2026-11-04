//! Port of packages/engine/src/fem/adapt.ts.
//!
//! A posteriori error estimation and mesh refinement.
//!
//! Method and sources:
//! - Error indicator of Zienkiewicz & Zhu (1987, IJNME 24(2), 337–357): the
//!   finite element stresses are compared with a recovered, continuous
//!   stress field σ*, here the area-weighted nodal average of the element
//!   stresses interpolated linearly over each element, and
//!   η_e² = ∫_e (σ* − σ_h)ᵀ C (σ* − σ_h) dA with C the elastic compliance.
//! - Dissipation indicator (the default in analysis.ts): the plastic
//!   dissipation per element, after the dissipation-based adaptivity of
//!   finite element limit analysis (Lyamin, Sloan, Krabbenhøft & Hjiaj
//!   2005, IJNME 63(14), 1961–1974; Ciria, Peraire & Bonet 2008, IJNME
//!   75(8), 899–944).
//! - Marking by Dörfler's bulk criterion (Dörfler 1996, SIAM J. Numer.
//!   Anal. 33(3), 1106–1124): the smallest set of elements whose indicators
//!   sum to a fraction θ of the total.
//!
//! Implementation choices (not from the literature): C approximated by
//! 1/E; the dissipation taken from the accumulated viscoplastic strain at
//! the factor of safety (the limit analysis papers use the dissipation of
//! the collapse mechanism); marked elements get half their size in the
//! next mesh, through a size field on the old mesh; θ = 0.3 in analysis.ts.
//!
//! Rust note: the refined size field, a closure over the old mesh in
//! TypeScript, is the data `RefinedSizeField` (a `SizeField` variant).

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::fem::elements::GP_STRIDE;
use crate::fem::model::{FeModel, SizeField};
use crate::js;
use std::sync::Arc;

/// Squared error indicator per element from Gauss point stresses (4 per point).
pub fn zz_indicator(model: &FeModel, stress: &[f64]) -> Vec<f64> {
    let (el, ne, nc, gp) = (
        &model.el,
        model.element_count,
        model.corner_count,
        &model.gp,
    );
    let mut nodal = vec![0.0f64; 4 * nc];
    let mut weight = vec![0.0f64; nc];
    let mut area = vec![0.0f64; ne];
    for e in 0..ne {
        let mut a = 0.0;
        let mut mean = [0.0f64; 4];
        for g in 0..3 {
            let w = gp[(3 * e + g) * GP_STRIDE + 12];
            a += w;
            for k in 0..4 {
                mean[k] += stress[4 * (3 * e + g) + k] * w;
            }
        }
        area[e] = a;
        for c in 0..3 {
            let n = el[6 * e + c];
            weight[n] += a;
            for k in 0..4 {
                nodal[4 * n + k] += mean[k];
            }
        }
    }
    for n in 0..nc {
        if weight[n] > 0.0 {
            for k in 0..4 {
                nodal[4 * n + k] /= weight[n];
            }
        }
    }
    // Area coordinates of the three Gauss points (L1, L2, L3).
    let l = [
        [2.0 / 3.0, 1.0 / 6.0, 1.0 / 6.0],
        [1.0 / 6.0, 2.0 / 3.0, 1.0 / 6.0],
        [1.0 / 6.0, 1.0 / 6.0, 2.0 / 3.0],
    ];
    let mut eta2 = vec![0.0f64; ne];
    for e in 0..ne {
        let inv = 1.0 / model.el_e[e];
        let mut s = 0.0;
        for g in 0..3 {
            let w = gp[(3 * e + g) * GP_STRIDE + 12];
            for k in 0..4 {
                let mut rec = 0.0;
                for c in 0..3 {
                    rec += l[g][c] * nodal[4 * el[6 * e + c] + k];
                }
                let d = rec - stress[4 * (3 * e + g) + k];
                s += (if k == 2 { 2.0 } else { 1.0 }) * d * d * inv * w;
            }
        }
        eta2[e] = s;
    }
    eta2
}

fn edge(dx: f64, dy: f64) -> f64 {
    (dx * dx + dy * dy).sqrt()
}

/// Dörfler marking: the elements with the largest indicators that carry a
/// fraction θ of the total (TypeScript default θ = 0.5).
pub fn dorfler_mark(eta2: &[f64], theta: f64) -> Vec<bool> {
    let mut order: Vec<usize> = (0..eta2.len()).collect();
    js::array::sort_by(&mut order, |&a, &b| eta2[b] - eta2[a]);
    let mut total = 0.0;
    for &v in eta2 {
        total += v;
    }
    let mut marked = vec![false; eta2.len()];
    let mut acc = 0.0;
    for &e in &order {
        if acc >= theta * total {
            break;
        }
        marked[e] = true;
        acc += eta2[e];
    }
    marked
}

/// The size field of `refined_size_field`: the old mesh's corners, a target
/// size per old element and a bucket grid of the elements' boxes.
#[derive(Debug, Clone, PartialEq)]
pub struct RefinedSizeField {
    /// Corner coordinates of the old mesh and its triangles (3 corners each).
    x: Vec<f64>,
    y: Vec<f64>,
    tri: Vec<usize>,
    size: Vec<f64>,
    xmin: f64,
    ymin: f64,
    dx: f64,
    dy: f64,
    nb: usize,
    buckets: Vec<Vec<usize>>,
    fallback: f64,
    smallest: f64,
}

/// `Math.min(nb − 1, Math.max(0, Math.floor((v − v0) / d)))` as an index
/// (a NaN coordinate, which TypeScript would fail on, takes cell 0).
fn cell_index(v: f64, v0: f64, d: f64, nb: usize) -> usize {
    let c = js::math::min((nb - 1) as f64, js::math::max(0.0, ((v - v0) / d).floor()));
    if c.is_nan() {
        0
    } else {
        c as usize
    }
}

impl RefinedSizeField {
    fn cell(&self, px: f64, py: f64) -> (usize, usize) {
        (
            cell_index(px, self.xmin, self.dx, self.nb),
            cell_index(py, self.ymin, self.dy, self.nb),
        )
    }

    /// The size at a point.
    pub fn at(&self, px: f64, py: f64) -> f64 {
        let (x, y) = (&self.x, &self.y);
        let (i, j) = self.cell(px, py);
        let mut best = self.fallback;
        let mut best_d = f64::INFINITY;
        for &e in &self.buckets[j * self.nb + i] {
            let (a, b, c) = (self.tri[3 * e], self.tri[3 * e + 1], self.tri[3 * e + 2]);
            let d = (y[b] - y[c]) * (x[a] - x[c]) + (x[c] - x[b]) * (y[a] - y[c]);
            let l1 = ((y[b] - y[c]) * (px - x[c]) + (x[c] - x[b]) * (py - y[c])) / d;
            let l2 = ((y[c] - y[a]) * (px - x[c]) + (x[a] - x[c]) * (py - y[c])) / d;
            let l3 = 1.0 - l1 - l2;
            let out = -js::math::min(js::math::min(l1, l2), l3);
            if out <= 1e-9 {
                return self.size[e];
            }
            if out < best_d {
                best_d = out;
                best = self.size[e];
            }
        }
        best
    }

    /// The smallest size (`min`).
    pub fn min(&self) -> f64 {
        self.smallest
    }
}

/// Size field for the next mesh: the target size the element was made with
/// (the model's size field at its centroid), halved where marked, looked up
/// by point location in the old mesh on a bucket grid. A marked element is
/// also never coarser than half its longest edge. (TypeScript default
/// `min_size` 0.)
pub fn refined_size_field(model: &FeModel, marked: &[bool], min_size: f64) -> Arc<SizeField> {
    let (el, ne, x, y) = (&model.el, model.element_count, &model.x, &model.y);
    let mut size = vec![0.0f64; ne];
    let (mut xmin, mut xmax, mut ymin, mut ymax) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for e in 0..ne {
        let (a, b, c) = (el[6 * e], el[6 * e + 1], el[6 * e + 2]);
        // Unmarked elements keep their target size: their real edges lie below
        // the mesher's split threshold of 1.4 × the target, so a size from the
        // edge lengths would refine them too.
        let target = model
            .size_field
            .at((x[a] + x[b] + x[c]) / 3.0, (y[a] + y[b] + y[c]) / 3.0);
        if marked[e] {
            let h = js::math::max(
                js::math::max(
                    edge(x[a] - x[b], y[a] - y[b]),
                    edge(x[b] - x[c], y[b] - y[c]),
                ),
                edge(x[c] - x[a], y[c] - y[a]),
            );
            size[e] = js::math::max(min_size, js::math::min(target, h) / 2.0);
        } else {
            size[e] = js::math::max(min_size, target);
        }
        for n in [a, b, c] {
            xmin = js::math::min(xmin, x[n]);
            xmax = js::math::max(xmax, x[n]);
            ymin = js::math::min(ymin, y[n]);
            ymax = js::math::max(ymax, y[n]);
        }
    }
    let nb = js::math::max(1.0, (ne as f64 / 4.0).sqrt().ceil()) as usize;
    let or_one = |v: f64| if v == 0.0 || v.is_nan() { 1.0 } else { v };
    let dx = or_one((xmax - xmin) / nb as f64);
    let dy = or_one((ymax - ymin) / nb as f64);
    let mut buckets: Vec<Vec<usize>> = vec![Vec::new(); nb * nb];
    // (the triangles' corners are the first `corner_count` nodes)
    let nc = model.corner_count;
    let tri: Vec<usize> = (0..ne)
        .flat_map(|e| [el[6 * e], el[6 * e + 1], el[6 * e + 2]])
        .collect();
    for e in 0..ne {
        let ns = [tri[3 * e], tri[3 * e + 1], tri[3 * e + 2]];
        let xs = [x[ns[0]], x[ns[1]], x[ns[2]]];
        let ys = [y[ns[0]], y[ns[1]], y[ns[2]]];
        let i0 = cell_index(js::math::min_of(&xs), xmin, dx, nb);
        let j0 = cell_index(js::math::min_of(&ys), ymin, dy, nb);
        let i1 = cell_index(js::math::max_of(&xs), xmin, dx, nb);
        let j1 = cell_index(js::math::max_of(&ys), ymin, dy, nb);
        for i in i0..=i1 {
            for j in j0..=j1 {
                buckets[j * nb + i].push(e);
            }
        }
    }
    let mut fallback = 0.0;
    for &h in &size {
        fallback = js::math::max(fallback, h);
    }
    let mut smallest = f64::INFINITY;
    for &h in &size {
        smallest = js::math::min(smallest, h);
    }
    Arc::new(SizeField::Refined(RefinedSizeField {
        x: x[..nc].to_vec(),
        y: y[..nc].to_vec(),
        tri,
        size,
        xmin,
        ymin,
        dx,
        dy,
        nb,
        buckets,
        fallback,
        smallest,
    }))
}

/// Plastic dissipation per element, ∫_e |σ : ε_vp| dA, from the stresses and
/// accumulated viscoplastic strains at the factor of safety. It concentrates
/// in the failure mechanism, which is where the factor of safety is decided
/// (see the sources in the file header).
pub fn dissipation_indicator(model: &FeModel, stress: &[f64], evp: &[f64]) -> Vec<f64> {
    let mut out = vec![0.0f64; model.element_count];
    for e in 0..model.element_count {
        let mut s = 0.0;
        for g in 0..3 {
            let i = 3 * e + g;
            let o = 4 * i;
            let w = model.gp[i * GP_STRIDE + 12];
            s += (stress[o] * evp[o]
                + stress[o + 1] * evp[o + 1]
                + stress[o + 2] * evp[o + 2]
                + stress[o + 3] * evp[o + 3])
                .abs()
                * w;
        }
        out[e] = s;
    }
    out
}
