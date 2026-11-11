//! Port of packages/engine/src/fem/limit-common.ts.
//!
//! Data shared by the lower and upper bound limit analyses (lower_bound.rs,
//! upper_bound.rs): the strength, pore pressure and unit weight of the
//! strength reduction model (model.rs) at points of a limit analysis mesh,
//! and the line loads spread over the ground surface.

use crate::error::Result;
use crate::fem::model::{gauss_unit_weight, polyline_y, FeModel};
use crate::fem::srm::davis_b;
use crate::js;
use crate::model::geometry_ops::{material_layer_top_at, Polyline};
use crate::model::slope::Slope;
use crate::types::{design_strength, needs_layer_top, Material, MaterialId, StrengthContext};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::f64::consts::PI;
use std::sync::LazyLock;

/// Centroids of the 16 sub-triangles of a 4 × 4 subdivision, in area coordinates (r, s).
pub static WEIGHT_POINTS: LazyLock<Vec<[f64; 2]>> = LazyLock::new(|| {
    let mut out = Vec::with_capacity(16);
    for i in 0..4 {
        let mut j = 0;
        while i + j < 4 {
            let (fi, fj) = (i as f64, j as f64);
            out.push([(fi + 1.0 / 3.0) / 4.0, (fj + 1.0 / 3.0) / 4.0]);
            if i + j < 3 {
                out.push([(fi + 2.0 / 3.0) / 4.0, (fj + 2.0 / 3.0) / 4.0]);
            }
            j += 1;
        }
    }
    out
});

/// The reduced strength of the bounds (`strengthRule`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StrengthRule {
    /// c/F and tan φ/F.
    #[default]
    Associated,
    /// Both divided by Davis B's q_B(F, φ, ψ).
    DavisB,
}

/// Design strength at a point (`strengthAt`): `phi` in radians (0 when
/// undrained); `cu` the undrained cap of a combined material, Infinity
/// where there is none.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PointStrength {
    pub c: f64,
    pub phi: f64,
    pub cu: f64,
}

/// Design strength of material `m` (the slope's material `id`) at (px, py),
/// as in the strength reduction model (model.rs): depth from the layer top,
/// partial factors applied.
pub fn strength_at(
    slope: &Slope,
    m: &Material,
    id: MaterialId,
    surface: &Polyline,
    px: f64,
    py: f64,
) -> Result<PointStrength> {
    let y_ground = polyline_y(surface, px);
    let y_layer_top = if needs_layer_top(&m.model) {
        Some(material_layer_top_at(slope.material_geometries(), id, px, py).unwrap_or(y_ground))
    } else {
        None
    };
    let s = m.get_strength(&StrengthContext {
        y_bottom: py,
        x: px,
        y_ground,
        y_layer_top,
        alpha: 0.0,
        suction: None,
        effective_vertical_stress: None,
    })?;
    let factors = slope.partial_factors();
    let d = design_strength(Some(m.model.kind()), &s, factors);
    Ok(PointStrength {
        c: js::math::max(0.0, d.cohesion),
        phi: if d.undrained {
            0.0
        } else if factors.is_some() {
            js::math::atan(d.tan_phi)
        } else {
            (s.friction_angle * PI) / 180.0
        },
        cu: if s.is_combined == Some(true) && !d.undrained {
            js::math::max(0.0, d.cohesion_undrained)
        } else {
            f64::INFINITY
        },
    })
}

/// Pore pressure at (x, y): from the seepage heads at node n when the model has them, else from the water line; `gw` the unit weight of water.
pub fn pore_pressure_at(
    head: Option<&[f64]>,
    n: usize,
    water_line: Option<&Polyline>,
    x: f64,
    y: f64,
    gw: f64,
) -> f64 {
    if let Some(head) = head {
        return if head[n].is_finite() {
            js::math::max(0.0, gw * (head[n] - y))
        } else {
            0.0
        };
    }
    if let Some(wl) = water_line {
        let yw = polyline_y(wl, x);
        return if yw.is_finite() {
            js::math::max(0.0, gw * (yw - y))
        } else {
            0.0
        };
    }
    0.0
}

/// Mean unit weight over the triangle (γsat below the water as in the
/// deformation analysis), by the midpoint rule on 16 equal sub-triangles, so
/// that an element cut by the water table carries close to its true weight
/// (the deformation analysis' three Gauss points weigh it in thirds).
/// `u` the pore pressures at the three corners.
pub fn mean_unit_weight(
    m: &Material,
    water_line: Option<&Polyline>,
    seepage: bool,
    xs: &[f64; 3],
    ys: &[f64; 3],
    u: &[f64; 3],
) -> f64 {
    let mut gamma = 0.0;
    let n = WEIGHT_POINTS.len() as f64;
    for &[r, s2] in WEIGHT_POINTS.iter() {
        let t = 1.0 - r - s2;
        let gx = t * xs[0] + r * xs[1] + s2 * xs[2];
        let gy = t * ys[0] + r * ys[1] + s2 * ys[2];
        gamma += gauss_unit_weight(
            m,
            water_line,
            seepage,
            t * u[0] + r * u[1] + s2 * u[2],
            gx,
            gy,
        ) / n;
    }
    gamma
}

/// The line loads' strip loads (`surfaceLineLoads`): the vertical load per
/// horizontal metre at each end of the surface edges they act on, keyed by
/// (edge key, node) (TypeScript's `${edgeKey(a, b)}:${node}`).
pub type LineLoadMap = HashMap<(usize, usize), f64>;

/// Line loads as strip loads on the ground surface: a concentrated load has
/// no bounded traction, so each is spread as uniform strip loads over the
/// two surface edges meeting at its point (a mesh vertex, model.rs), in
/// inverse proportion to their horizontal lengths, which keeps its resultant
/// and its point of action. Where only one edge with a horizontal extent
/// meets the point (at the end of the surface or the top of a vertical face)
/// the load is spread over it linearly from 2P/d at the point to 0, its
/// resultant d/3 from the point. Variable loads take the partial factor γQ,
/// as in the slices.
pub fn surface_line_loads(
    slope: &Slope,
    model: &FeModel,
    edge_key: &dyn Fn(usize, usize) -> usize,
    warnings: &mut Vec<String>,
) -> LineLoadMap {
    let (x, y) = (&model.x, &model.y);
    let mut line_q: LineLoadMap = HashMap::new();
    let mut add_q = |edge: usize, node: usize, q: f64| {
        let e = line_q.entry((edge, node)).or_insert(0.0);
        *e += q;
    };
    let load_factor = slope.partial_factors().map_or(1.0, |f| f.variable_load);
    let se = &model.surface_edges;
    for ll in slope.line_loads() {
        let mut v: i64 = -1;
        let mut s = 0;
        while s < se.len() {
            for node in [se[s], se[s + 2]] {
                if (x[node] - ll.x).abs() <= 1e-9 * (1.0 + ll.x.abs())
                    && (v < 0 || y[node] > y[v as usize])
                {
                    v = node as i64;
                }
            }
            s += 3;
        }
        if v < 0 {
            warnings.push(format!(
                "A line load at x = {} is not on the mesh's ground surface and is not included.",
                js::num::to_string(ll.x)
            ));
            continue;
        }
        let v = v as usize;
        // edge key, horizontal length, the other node
        let mut adj: Vec<(usize, f64, usize)> = Vec::new();
        let mut s = 0;
        while s < se.len() {
            let (a, b) = (se[s], se[s + 2]);
            if (a == v || b == v) && (x[b] - x[a]).abs() > 0.0 {
                adj.push((
                    edge_key(a, b),
                    (x[b] - x[a]).abs(),
                    if a == v { b } else { a },
                ));
            }
            s += 3;
        }
        let p = ll.magnitude * load_factor;
        if adj.len() == 1 {
            let (k1, d1, o1) = adj[0];
            add_q(k1, v, (2.0 * p) / d1);
            add_q(k1, o1, 0.0);
            warnings.push(format!(
                "The line load at x = {} is spread over one element edge; its point of action moves {} m into the slope.",
                js::num::to_string(ll.x),
                js::num::to_fixed(d1 / 3.0, 2)
            ));
        } else if adj.len() >= 2 {
            let (k1, d1, o1) = adj[0];
            let (k2, d2, o2) = adj[1];
            // P1 = P d2/(d1 + d2) on edge 1 and P2 = P d1/(d1 + d2) on edge 2: P1 d1/2 = P2 d2/2.
            let q1 = (p * d2) / (d1 + d2) / d1;
            let q2 = (p * d1) / (d1 + d2) / d2;
            add_q(k1, v, q1);
            add_q(k1, o1, q1);
            add_q(k2, v, q2);
            add_q(k2, o2, q2);
        }
    }
    line_q
}

/// The strength at a reduction F: c/F and tan φ/F (associated flow in the
/// reduced material), or with "davis-b" both divided by Davis B's
/// q_B(F, φ, ψ) instead (srm.rs; Davis 1968, as modified for strength
/// reduction by Tschuchnigg, Schweiger & Sloan 2015): the associated
/// material that stands for flow with the dilation angle ψ. φ, ψ in
/// radians; φ = 0 (undrained) gives c/F either way. Returns (c, φ).
pub fn reduced_strength(c: f64, phi: f64, psi: f64, f: f64, rule: StrengthRule) -> (f64, f64) {
    let q = if rule == StrengthRule::DavisB && phi > 0.0 {
        davis_b(f, phi, js::math::min(psi, phi))
    } else {
        f
    };
    (c / q, js::math::atan(js::math::tan(phi) / q))
}

/// A JavaScript `Map` with integer keys: iteration in insertion order, a
/// key set again keeps its place, a deleted key leaves the order.
#[derive(Debug, Clone)]
pub(crate) struct InsertionMap<V> {
    slots: Vec<Option<(usize, V)>>,
    index: HashMap<usize, usize>,
}

impl<V> InsertionMap<V> {
    pub(crate) fn new() -> Self {
        InsertionMap {
            slots: Vec::new(),
            index: HashMap::new(),
        }
    }

    pub(crate) fn get(&self, key: usize) -> Option<&V> {
        self.index
            .get(&key)
            .and_then(|&i| self.slots[i].as_ref().map(|(_, v)| v))
    }

    pub(crate) fn get_mut(&mut self, key: usize) -> Option<&mut V> {
        match self.index.get(&key) {
            Some(&i) => self.slots[i].as_mut().map(|(_, v)| v),
            None => None,
        }
    }

    pub(crate) fn set(&mut self, key: usize, value: V) {
        match self.index.get(&key) {
            Some(&i) => self.slots[i] = Some((key, value)),
            None => {
                self.index.insert(key, self.slots.len());
                self.slots.push(Some((key, value)));
            }
        }
    }

    pub(crate) fn delete(&mut self, key: usize) {
        if let Some(i) = self.index.remove(&key) {
            self.slots[i] = None;
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.index.len()
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (usize, &V)> {
        self.slots.iter().flatten().map(|(k, v)| (*k, v))
    }
}
