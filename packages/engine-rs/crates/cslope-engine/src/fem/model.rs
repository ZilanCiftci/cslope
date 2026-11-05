//! Port of packages/engine/src/fem/model.ts.
//!
//! Finite element model of a slope: T6 mesh, materials, supports and loads.
//!
//! Method and sources:
//! - The domain is the slope's external boundary, meshed with the material
//!   boundaries as constraints so that every element lies in one material
//!   (mesh.rs), with six-node triangles (elements.rs).
//! - Supports as in Griffiths & Lane (1999, Géotechnique 49(3), 387–403):
//!   the base is fixed, the vertical sides are on rollers, and the ground
//!   surface is free.
//! - Gravity is applied in one increment with the total unit weight
//!   (Griffiths & Lane 1999); E = 10⁵ kPa and ν = 0.3 are their nominal
//!   values, which barely affect F.
//! - Effective stress: the pore pressures enter as the equivalent nodal load
//!   ∫ Bᵀ m u dA, m = (1, 1, 0) in the plane, so that the yield
//!   criterion sees the effective stress (Terzaghi's principle; Potts &
//!   Zdravković, Finite Element Analysis in Geotechnical Engineering:
//!   Theory, Thomas Telford 1999). Pore pressure is hydrostatic below the water line of each
//!   element's material, u = γw (y_w − y) ≥ 0, or comes from seepage.rs.
//! - Strength at each Gauss point as the slices take it: depth from the top
//!   of the material's layer where the model needs it, design values with
//!   the partial factors (EN 1997-1 Annex A, `design_strength`), and for a
//!   combined material the lesser of the drained and the undrained strength,
//!   a Tresca cap (σ₁ − σ₃)/2 ≤ cu on Mohr–Coulomb. Variable loads take γQ.
//!   A material with φb adds the suction strength min(s, s_max)·tan φb to
//!   c′, with the matric suction s = γw (y − y_w) above its water line
//!   (vertical head), or from the negative pore pressure of the seepage.
//! - Surface loads: ponded water as a normal pressure, strip loads (kPa per
//!   horizontal metre) and line loads (kN/m) as vertical tractions,
//!   integrated with the quadratic edge shape functions.
//! - Reinforcement: three-node bar (truss) elements along the element edges
//!   on each reinforcement line, sharing the soil's nodes (perfect bond),
//!   elastic–perfectly plastic in tension (bars.rs).
//! - Equations in nested dissection order, factorised by sparse Cholesky
//!   (sparse.rs).
//!
//! Implementation choices (not from the literature), with their reasons:
//! - Element size: a twentieth of the model height by default, and at most
//!   half the local thickness of a thin layer (polygon_thickness_samples), so that every
//!   layer is crossed by at least two elements.
//! - Boundary edges: an edge whose midpoint lies on the ground surface is
//!   free; a non-surface edge with |Δx| ≤ 10⁻³ |Δy| is a vertical side
//!   (roller); every other non-surface edge is fixed.
//! - High-strength and impenetrable materials are elastic, 100 times as
//!   stiff as the stiffest soil, and 10⁻⁴ as permeable as the least
//!   permeable soil, unless parameters are given for them by name: stiff
//!   enough not to deform the soil around them, soft enough not to spoil
//!   the conditioning of the stiffness matrix.
//!
//! Rust notes (ARCHITECTURE.md §2.2): the size field, a closure in
//! TypeScript, is data (`SizeField`); the per-model `WeakMap` caches of
//! newton.ts and srm.ts (element equations, scatter positions) are lazy
//! `OnceLock` fields of `FeModel`. Equation numbers are `i64` (−1: fixed),
//! as the sparse matrix's groups.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

use crate::error::{EngineError, Result};
use crate::fem::elements::{gauss_data, shape_t6, stiffness_t6, GAUSS_T6, GP_STRIDE};
use crate::fem::mesh::{mesh_domain, point_in_polygon, MeshInput, TriMesh};
use crate::fem::piles::{beam_dofs, build_piles, frame_stiffness, FePiles, PileInput, PileSprings};
use crate::fem::seepage::{solve_seepage, SeepageMesh, SeepageResult};
use crate::fem::sparse::{nested_dissection, node_graph, SparseCholesky};
use crate::js;
use crate::math::interpolation::get_y_at_x;
use crate::model::geometry_ops::{material_layer_top_at, Polyline};
use crate::model::reinforcement::envelope_at;
use crate::model::slope::Slope;
use crate::types::{
    design_strength, instantaneous_at_sigma3, needs_layer_top, resolve_unit_weight, suction_angle,
    suction_strength, HoekBrownParameters, Material, MaterialId, PartialFactors, Reinforcement,
    ReinforcementApplication, ReinforcementPullout, ResolvedStrength, StrengthContext,
    UdlDirection, WATER_UNIT_WEIGHT,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::f64::consts::PI;
use std::sync::{Arc, OnceLock};

/// Elastic and flow parameters of a material in the finite element analysis.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeMaterialParameters {
    /// Young's modulus E (kPa); default 1·10⁵.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youngs_modulus: Option<f64>,
    /// Poisson's ratio ν; default 0.3.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poissons_ratio: Option<f64>,
    /// Dilation angle ψ (°); default 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dilation_angle: Option<f64>,
    /// Permeability k (m/s) for steady seepage; default 10⁻⁶ for a soil and
    /// 10⁻⁴ of the least permeable soil for a rigid material (only ratios matter).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permeability: Option<f64>,
    /// van Genuchten α (1/m) for the unsaturated permeability; default 3.6 (loam, Carsel & Parrish 1988).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub van_genuchten_alpha: Option<f64>,
    /// van Genuchten n; default 1.56 (loam, Carsel & Parrish 1988).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub van_genuchten_n: Option<f64>,
}

/// Pore pressures of the finite element model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PorePressureSource {
    WaterTable,
    Seepage,
}

/// One sample of a polygon's local thickness (`polygon_thickness_samples`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ThicknessSample {
    pub x: f64,
    pub y: f64,
    pub t: f64,
}

/// The default size field of `build_fe_model`: the target size h0, at most
/// half the thickness of a thin layer (the TypeScript closure `size`).
#[derive(Debug, Clone, PartialEq)]
pub struct LayerSizeField {
    h0: f64,
    /// Per material polygon, its thin samples (t/2 < h0).
    thin: Vec<Vec<ThicknessSample>>,
    /// Per material polygon: x min, x max, y min, y max.
    boxes: Vec<[f64; 4]>,
    polys: Vec<Vec<[f64; 2]>>,
    min: f64,
}

impl LayerSizeField {
    fn region_at_fast(&self, px: f64, py: f64) -> i64 {
        region_at_fast(&self.boxes, &self.polys, px, py)
    }

    fn layer_size_at(&self, k: usize, px: f64, py: f64) -> f64 {
        let h0 = self.h0;
        let mut size = h0;
        for q in &self.thin[k] {
            let dx = px - q.x;
            let dy = py - q.y;
            let d = (dx * dx + dy * dy).sqrt();
            size = js::math::min(
                size,
                js::math::max(q.t / 2.0, h0 / 8.0) + 0.5 * js::math::max(0.0, d - q.t),
            );
        }
        size
    }

    fn at(&self, px: f64, py: f64) -> f64 {
        let k = self.region_at_fast(px, py);
        if k >= 0 {
            self.layer_size_at(k as usize, px, py)
        } else {
            self.h0
        }
    }
}

/// The element size as a function of position (TypeScript's
/// `((x, y) => number) & { min?: number }`, ARCHITECTURE.md §2.2): data, so
/// that it can be kept, passed on and evaluated anywhere.
#[derive(Debug, Clone, PartialEq)]
pub enum SizeField {
    /// The default of `build_fe_model` (layers and thin parts).
    Layers(LayerSizeField),
    /// From adaptive refinement (adapt.rs, `refined_size_field`).
    Refined(crate::fem::adapt::RefinedSizeField),
    /// Another field times a factor (summary.ts's coarsening of the bound
    /// meshes): min is (inner.min ?? 0) · factor.
    Scaled { inner: Arc<SizeField>, factor: f64 },
    /// The same size everywhere (tests' `() => h`; bound-adapt.ts's `() => NaN`).
    Constant { value: f64, min: Option<f64> },
}

impl SizeField {
    /// The size at (x, y).
    pub fn at(&self, x: f64, y: f64) -> f64 {
        match self {
            SizeField::Layers(f) => f.at(x, y),
            SizeField::Refined(f) => f.at(x, y),
            SizeField::Scaled { inner, factor } => factor * inner.at(x, y),
            SizeField::Constant { value, .. } => *value,
        }
    }

    /// Its smallest value, when known (`min`).
    pub fn min(&self) -> Option<f64> {
        match self {
            SizeField::Layers(f) => Some(f.min),
            SizeField::Refined(f) => Some(f.min()),
            SizeField::Scaled { inner, factor } => Some(inner.min().unwrap_or(0.0) * factor),
            SizeField::Constant { min, .. } => *min,
        }
    }
}

/// `FeModelOptions`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeModelOptions {
    /// Target element size (m); default: domain height / 20.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_size: Option<f64>,
    /// Size field overriding `element_size`, e.g. from error estimation.
    #[serde(skip)]
    pub size_field: Option<Arc<SizeField>>,
    /// Parameters per material name; "*" for every material not named.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_parameters: Option<BTreeMap<String, FeMaterialParameters>>,
    /// Smallest triangle angle (°); default 25.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_angle: Option<f64>,
    /// Vertex cap of the mesh; default 60 000.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_vertices: Option<usize>,
    /// Axial stiffness EA of reinforcement (kN per metre of slope). It sets how
    /// much the soil must strain before the reinforcement carries its capacity:
    /// the default, 10⁶, mobilises the full capacity before the soil fails, as
    /// limit equilibrium assumes; a product's own stiffness (a geosynthetic's J,
    /// often 500–5000 kN/m) gives strain compatibility, and with it a factor
    /// that can be much lower.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcement_stiffness: Option<f64>,
    /// Divide the capacity of passive reinforcement by F, as the limit
    /// equilibrium solvers do (default true); false reduces only the soil's
    /// strength, as a strength reduction program usually does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduce_reinforcement: Option<bool>,
    /// Pore pressures: "water-table" (default), hydrostatic below each
    /// material's water line; "seepage", from steady seepage on the mesh
    /// (seepage.rs) with the water table as reservoir and tail water where it
    /// lies at or above the ground.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pore_pressure: Option<PorePressureSource>,
    /// Materials not yet built (staged construction, initial_stress.rs): their
    /// elements are weightless and elastic with SOFT_FACTOR of the softest
    /// soil's stiffness, carry no pore pressure term and no surface load, so
    /// that they follow the active soil without loading or stiffening it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inactive_materials: Option<Vec<String>>,
    /// Leave the reinforcement out (the construction stages before the last, initial_stress.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub without_reinforcement: Option<bool>,
}

pub const DEFAULT_REINFORCEMENT_STIFFNESS: f64 = 1e6;

/// Unit weight at a Gauss point as the slices take it: γsat below the
/// material's water line (or where seepage gives a pore pressure) where
/// given, a spatial model's interpolated γ elsewhere.
pub fn gauss_unit_weight(
    m: &Material,
    water_line: Option<&Polyline>,
    seepage: bool,
    u: f64,
    gx: f64,
    gy: f64,
) -> f64 {
    let below = if seepage {
        u > 0.0
    } else if let Some(wl) = water_line {
        gy < polyline_y(wl, gx)
    } else {
        false
    };
    match m.model.base().unit_weight_sat {
        Some(sat) if below => sat,
        _ => resolve_unit_weight(&m.model, m.unit_weight(), gx, gy),
    }
}

pub const DEFAULT_YOUNGS_MODULUS: f64 = 1e5;
pub const DEFAULT_PERMEABILITY: f64 = 1e-6;
/// Permeability of a rigid material (unless given by name) relative to the least permeable soil.
const RIGID_PERMEABILITY_FACTOR: f64 = 1e-4;
pub const DEFAULT_POISSONS_RATIO: f64 = 0.3;
/// Stiffness of high-strength and impenetrable materials relative to the stiffest soil.
const RIGID_FACTOR: f64 = 100.0;
/// Stiffness of an inactive (not yet built) material relative to the softest soil.
const SOFT_FACTOR: f64 = 1e-6;

/// The finite element model (`FeModel`).
#[derive(Debug, Clone)]
pub struct FeModel {
    /// Node coordinates (corner nodes first, then midside nodes, then pile beam nodes).
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub node_count: usize,
    /// Corner node count (the vertices of the triangulation).
    pub corner_count: usize,
    /// Element connectivity, 6 nodes per element.
    pub el: Vec<usize>,
    pub element_count: usize,
    /// Materials used by the elements (copies of the slope's) and the index of each element's.
    pub materials: Vec<Material>,
    /// The slope's id of each of `materials`.
    pub material_ids: Vec<MaterialId>,
    pub el_material: Vec<usize>,
    /// Per element: E, ν, ψ (rad) and behaviour (true: elastic).
    pub el_e: Vec<f64>,
    pub el_nu: Vec<f64>,
    pub el_psi: Vec<f64>,
    pub el_elastic: Vec<bool>,
    /// Gauss point data (see `gauss_data`) and coordinates, 3 per element.
    pub gp: Vec<f64>,
    pub gp_x: Vec<f64>,
    pub gp_y: Vec<f64>,
    /// Strength at each Gauss point: c (kPa) and φ (rad).
    pub gp_c: Vec<f64>,
    /// Undrained strength cap per Gauss point (kPa) of a combined material,
    /// whose strength is the lesser of the drained and the undrained one
    /// (a Tresca limit on the Mohr–Coulomb one); Infinity elsewhere.
    pub gp_cu: Vec<f64>,
    pub gp_phi: Vec<f64>,
    /// Pore pressure at each Gauss point (kPa, compression positive).
    pub gp_u: Vec<f64>,
    /// Equation number of each dof (2 per node, x then y), −1 if fixed.
    pub eq: Vec<i64>,
    pub eq_count: usize,
    /// Factorised stiffness matrix.
    pub k: SparseCholesky,
    /// External load vector per equation (gravity, surface loads, pore pressure
    /// term), less the internal forces ∫ Bᵀ σ₀ of the initial stresses when
    /// there are any (`with_initial_stress`).
    pub f: Vec<f64>,
    /// Initial effective stress per Gauss point (σx, σy, τxy, σz), added to D(ε − εp); None: none.
    pub stress0: Option<Vec<f64>>,
    /// Norm of the external loads, the scale of the convergence tests (‖f‖ without initial stresses).
    pub load_norm: f64,
    /// Per element: true where the material is not yet built (`inactive_materials`).
    pub el_inactive: Vec<bool>,
    /// Surface edges (3 nodes each: end, midside, end), for plotting and loads.
    pub surface_edges: Vec<usize>,
    /// The triangulation the mesh was made from.
    pub triangulation: TriMesh,
    /// The target element size the mesh was made with (m).
    pub size_field: Arc<SizeField>,
    /// The seepage solution, when the pore pressures come from it.
    pub seepage: Option<SeepageResult>,
    /// Hoek–Brown rock: its parameters per Gauss point (index, in Gauss point
    /// order), whose c and φ follow the stress (`set_hoek_brown_strength`).
    pub gp_hoek_brown: Vec<(usize, HoekBrownParameters)>,
    /// The partial factors of the strength (design values).
    pub partial_factors: Option<PartialFactors>,
    /// gp_c and gp_phi as built (from the elastic stress), to go back to.
    pub gp_c0: Vec<f64>,
    pub gp_phi0: Vec<f64>,
    /// Pile rows as beams on springs to the soil (piles.rs).
    pub piles: FePiles,
    /// Notes on what the model leaves out.
    pub warnings: Vec<String>,
    /// Reinforcement as three-node bars along element edges (bonded to the
    /// soil): nodes (end, middle, end) per bar, and per bar Gauss point (two
    /// per bar) the strain–displacement row (6 numbers: x and y of each node),
    /// the weight × length, the tensile capacity per metre of slope (from the
    /// capacity envelope, so pullout is included) and whether it is passive
    /// (divided by F, as the limit equilibrium solvers do).
    pub bars: FeBars,
    /// Element dof → equation table (srm.ts `elementEquations`, a WeakMap cache there).
    pub(crate) element_eqs: OnceLock<Vec<i64>>,
    /// Matrix positions of each element's lower-triangle entries (newton.ts `scatterIndex`).
    pub(crate) scatter: OnceLock<Vec<i64>>,
}

/// `FeBars`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FeBars {
    pub count: usize,
    pub nodes: Vec<usize>,
    /// Reinforcement index of each bar (−1: a pile spring).
    pub source: Vec<i64>,
    /// Per Gauss point (2 per bar): B (6), weight (1).
    pub gp: Vec<f64>,
    pub capacity: Vec<f64>,
    pub passive: Vec<bool>,
    /// EA per bar (kN per metre of slope).
    pub stiffness: Vec<f64>,
    /// Initial plastic strain per bar Gauss point: −P/EA in a prestressed free length (force P), 0 elsewhere.
    pub ep0: Vec<f64>,
    /// Per bar: true for a pile spring, which acts in tension and compression (|N| ≤ capacity).
    pub both_ways: Vec<bool>,
    /// Per bar Gauss point: 0 for the capacity in `capacity` (divided by F if
    /// passive), 1 or 2 for a pile spring's lateral or axial limit from
    /// cap_c, cap_sv and cap_tan (piles.rs, `spring_capacity`).
    pub cap_kind: Vec<u8>,
    pub cap_c: Vec<f64>,
    pub cap_sv: Vec<f64>,
    pub cap_tan: Vec<f64>,
}

/// The bars with the piles' springs appended (piles.rs).
fn with_springs(mut bars: FeBars, sp: Option<PileSprings>) -> FeBars {
    let Some(sp) = sp else { return bars };
    if sp.stiffness.is_empty() {
        return bars;
    }
    let n = sp.stiffness.len();
    bars.count += n;
    bars.nodes.extend_from_slice(&sp.nodes);
    bars.source.extend(std::iter::repeat_n(-1, n));
    bars.gp.extend_from_slice(&sp.gp);
    bars.capacity.extend_from_slice(&sp.fixed_cap);
    bars.passive.extend(std::iter::repeat_n(false, n));
    bars.stiffness.extend_from_slice(&sp.stiffness);
    bars.ep0.extend(std::iter::repeat_n(0.0, 2 * n));
    bars.both_ways.extend(std::iter::repeat_n(true, n));
    bars.cap_kind.extend_from_slice(&sp.kind);
    bars.cap_c.extend_from_slice(&sp.cap_c);
    bars.cap_sv.extend_from_slice(&sp.cap_sv);
    bars.cap_tan.extend_from_slice(&sp.cap_tan);
    bars
}

/// The part of the segment p1–p2 inside the polygon (its ends on the boundary where they cross it), or None.
fn clip_to_polygon(poly: &[[f64; 2]], x1: f64, y1: f64, x2: f64, y2: f64) -> Option<Vec<[f64; 2]>> {
    let at = |t: f64| -> [f64; 2] { [x1 + t * (x2 - x1), y1 + t * (y2 - y1)] };
    let inside = |t: f64| {
        let [px, py] = at(t);
        point_in_polygon(px, py, poly)
    };
    const SAMPLES: i64 = 200;
    let (mut first, mut last) = (-1i64, -1i64);
    for k in 0..=SAMPLES {
        if inside(k as f64 / SAMPLES as f64) {
            if first < 0 {
                first = k;
            }
            last = k;
        }
    }
    if first < 0 {
        return None;
    }
    // the crossings by bisection between an inside and an outside sample
    let edge = |mut tin: f64, mut tout: f64| {
        for _ in 0..50 {
            let m = (tin + tout) / 2.0;
            if inside(m) {
                tin = m;
            } else {
                tout = m;
            }
        }
        (tin + tout) / 2.0
    };
    let s = SAMPLES as f64;
    let t0 = if first == 0 {
        0.0
    } else {
        edge(first as f64 / s, (first - 1) as f64 / s)
    };
    let t1 = if last == SAMPLES {
        1.0
    } else {
        edge(last as f64 / s, (last + 1) as f64 / s)
    };
    if t1 > t0 {
        Some(vec![at(t0), at(t1)])
    } else {
        None
    }
}

/// Free (unbonded) length of a grouted anchor: its length less the bonded
/// length at end 2, when the pullout is a bond over a bonded length shorter
/// than the element; 0 otherwise.
pub fn free_length(r: &Reinforcement) -> f64 {
    let l = js::math::hypot(&[r.x2 - r.x1, r.y2 - r.y1]);
    let Some(ReinforcementPullout::Bond {
        bonded_length: Some(bl),
        ..
    }) = &r.pullout
    else {
        return 0.0;
    };
    let bl = *bl;
    if !(bl > 0.0) || !(bl < l) {
        return 0.0;
    }
    l - bl
}

/// Per bar Gauss point record: B (6 numbers), weight × length.
pub const BAR_GP_STRIDE: usize = 7;

/// y of a polyline at x, extended horizontally beyond its ends.
pub fn polyline_y(line: &Polyline, x: f64) -> f64 {
    let n = line.x.len();
    if n == 0 {
        return f64::NAN;
    }
    let lo = js::math::min(line.x[0], line.x[n - 1]);
    let hi = js::math::max(line.x[0], line.x[n - 1]);
    if x <= lo {
        return if line.x[0] <= line.x[n - 1] {
            line.y[0]
        } else {
            line.y[n - 1]
        };
    }
    if x >= hi {
        return if line.x[0] <= line.x[n - 1] {
            line.y[n - 1]
        } else {
            line.y[0]
        };
    }
    get_y_at_x(&line.x, &line.y, x)
}

fn dist_to_polyline(px: f64, py: f64, lx: &[f64], ly: &[f64]) -> f64 {
    let mut best = f64::INFINITY;
    let mut i = 0;
    while i + 1 < lx.len() {
        let (ax, ay, bx, by) = (lx[i], ly[i], lx[i + 1], ly[i + 1]);
        let dx = bx - ax;
        let dy = by - ay;
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 0.0 {
            js::math::max(
                0.0,
                js::math::min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2),
            )
        } else {
            0.0
        };
        let ex = px - ax - t * dx;
        let ey = py - ay - t * dy;
        best = js::math::min(best, (ex * ex + ey * ey).sqrt());
        i += 1;
    }
    best
}

fn polygon_area(px: &[f64], py: &[f64]) -> f64 {
    let mut a = 0.0;
    let n = px.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        a += px[j] * py[i] - px[i] * py[j];
        j = i;
    }
    a / 2.0
}

/// Local thickness of a material polygon: from points at a quarter, half and
/// three quarters of each edge a ray is cast along the inward normal to the
/// polygon's opposite side; each sample is that point and the distance.
/// Edges that occur twice in opposite directions (the zero-width bridge
/// that joins a lens to its surrounding ring, geometry_ops.rs) are neither
/// sources nor targets. Used for the thin-layer element size (an
/// implementation choice; 2·area / perimeter overestimates a bent layer and
/// one value for the whole polygon refines a thick body with a thin tail).
pub fn polygon_thickness_samples(px: &[f64], py: &[f64]) -> Vec<ThicknessSample> {
    let n = px.len();
    // inward normal is to the left of a CCW edge
    let sign = if polygon_area(px, py) >= 0.0 {
        1.0
    } else {
        -1.0
    };
    let mut samples = Vec::new();
    let mut span = 0.0;
    for i in 0..n {
        span = js::math::max(
            span,
            js::math::max((px[i] - px[0]).abs(), (py[i] - py[0]).abs()),
        );
    }
    let tol = 1e-9 * span;
    let same = |a: usize, b: usize| (px[a] - px[b]).abs() <= tol && (py[a] - py[b]).abs() <= tol;
    let mut bridge = vec![false; n];
    for i in 0..n {
        let j = (i + 1) % n;
        let mut k = 0;
        while k < n && !bridge[i] {
            let l = (k + 1) % n;
            if k != i && same(i, l) && same(j, k) {
                bridge[i] = true;
            }
            k += 1;
        }
    }
    for i in 0..n {
        if bridge[i] {
            continue;
        }
        let j = (i + 1) % n;
        let ex = px[j] - px[i];
        let ey = py[j] - py[i];
        let len = (ex * ex + ey * ey).sqrt();
        if len <= tol {
            continue;
        }
        let nx = (-ey / len) * sign;
        let ny = (ex / len) * sign;
        for f in [0.25, 0.5, 0.75] {
            let ox = px[i] + f * ex;
            let oy = py[i] + f * ey;
            let mut best = f64::INFINITY;
            for k in 0..n {
                if k == i || bridge[k] {
                    continue;
                }
                let l = (k + 1) % n;
                let sx = px[l] - px[k];
                let sy = py[l] - py[k];
                let den = nx * sy - ny * sx;
                if den == 0.0 {
                    continue;
                }
                let qx = px[k] - ox;
                let qy = py[k] - oy;
                let t = (qx * sy - qy * sx) / den; // distance along the ray
                let u = (qx * ny - qy * nx) / den; // position on edge k
                if t > tol && u >= 0.0 && u <= 1.0 && t < best {
                    best = t;
                }
            }
            if best.is_finite() {
                samples.push(ThicknessSample {
                    x: ox,
                    y: oy,
                    t: best,
                });
            }
        }
    }
    samples
}

/// The boundary with a vertex where a strip load starts or ends and under a
/// line load, so that the load's edge falls on a node: the traction jumps
/// there (exactly representable in the lower bound, whose stress nodes are
/// not shared) and no element edge smears it.
fn with_load_vertices(bnd: Vec<[f64; 2]>, slope: &Slope) -> Vec<[f64; 2]> {
    let Some(surface) = slope.surface_line_xy() else {
        return bnd;
    };
    // (a JavaScript Set: insertion order, SameValueZero)
    let mut xs: Vec<f64> = Vec::new();
    let mut add = |v: f64| {
        if !xs.iter().any(|&w| w == v || (w.is_nan() && v.is_nan())) {
            xs.push(v);
        }
    };
    for q in slope.udls() {
        add(q.x1);
        add(q.x2);
    }
    for l in slope.line_loads() {
        add(l.x);
    }
    let mut out = bnd;
    for &px in &xs {
        let mut best: i64 = -1;
        let mut best_y = f64::NEG_INFINITY;
        for i in 0..out.len() {
            let [ax, ay] = out[i];
            let [bx, by] = out[(i + 1) % out.len()];
            if (bx - ax).abs() < 1e-9
                || px <= js::math::min(ax, bx) + 1e-9
                || px >= js::math::max(ax, bx) - 1e-9
            {
                continue;
            }
            let mx = (ax + bx) / 2.0;
            let my = (ay + by) / 2.0;
            if dist_to_polyline(mx, my, &surface.x, &surface.y) > 1e-6 * (1.0 + mx.abs() + my.abs())
            {
                continue;
            }
            let py = ay + ((px - ax) / (bx - ax)) * (by - ay);
            if py > best_y {
                best_y = py;
                best = i as i64;
            }
        }
        if best >= 0 {
            out.insert(best as usize + 1, [px, best_y]);
        }
    }
    out
}

/// The region (material polygon) containing a point, by bounding box first; −1 if none.
fn region_at_fast(boxes: &[[f64; 4]], polys: &[Vec<[f64; 2]>], px: f64, py: f64) -> i64 {
    for k in 0..polys.len() {
        let b = boxes[k];
        if px < b[0] || px > b[1] || py < b[2] || py > b[3] {
            continue;
        }
        if point_in_polygon(px, py, &polys[k]) {
            return k as i64;
        }
    }
    -1
}

fn is_rigid(m: &Material) -> bool {
    let k = m.model.kind();
    k == "high-strength" || k == "impenetrable"
}

/// Build the finite element model of a slope and factorise its stiffness.
pub fn build_fe_model(slope: &Slope, options: &FeModelOptions) -> Result<FeModel> {
    let (ext_x, ext_y) = slope.external_boundary_xy();
    let mut bnd: Vec<[f64; 2]> = ext_x.iter().zip(ext_y).map(|(&x, &y)| [x, y]).collect();
    if bnd.len() > 1 {
        let [fx, fy] = bnd[0];
        let [lx, ly] = bnd[bnd.len() - 1];
        if fx == lx && fy == ly {
            bnd.pop();
        }
    }
    {
        let bx: Vec<f64> = bnd.iter().map(|p| p[0]).collect();
        let by: Vec<f64> = bnd.iter().map(|p| p[1]).collect();
        if polygon_area(&bx, &by) < 0.0 {
            bnd.reverse();
        }
    }
    let bnd = with_load_vertices(bnd, slope);
    let (mut xmin, mut xmax, mut ymin, mut ymax) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for &[px, py] in &bnd {
        xmin = js::math::min(xmin, px);
        xmax = js::math::max(xmax, px);
        ymin = js::math::min(ymin, py);
        ymax = js::math::max(ymax, py);
    }
    let span = js::math::max(xmax - xmin, ymax - ymin);
    let geoms = slope.material_geometries();

    // Size field: the target size, at most half the thickness of a thin layer.
    let h0 = options.element_size.unwrap_or((ymax - ymin) / 20.0);
    // Thin parts of each material polygon: samples of its local thickness t
    // where t/2 is below the element size. Near such a sample the size is
    // t/2 (at least h0/8), growing by half the distance beyond t from it, so
    // the refinement stays local and grades into h0.
    let thin: Vec<Vec<ThicknessSample>> = geoms
        .iter()
        .map(|g| {
            polygon_thickness_samples(&g.px, &g.py)
                .into_iter()
                .filter(|q| q.t / 2.0 < h0)
                .collect()
        })
        .collect();
    let mut size_min = h0;
    for samples in &thin {
        for q in samples {
            size_min = js::math::min(size_min, js::math::max(q.t / 2.0, h0 / 8.0));
        }
    }
    let boxes: Vec<[f64; 4]> = geoms
        .iter()
        .map(|g| {
            [
                js::math::min_of(&g.px),
                js::math::max_of(&g.px),
                js::math::min_of(&g.py),
                js::math::max_of(&g.py),
            ]
        })
        .collect();
    let polys: Vec<Vec<[f64; 2]>> = geoms
        .iter()
        .map(|g| g.px.iter().zip(&g.py).map(|(&x, &y)| [x, y]).collect())
        .collect();
    let size: Arc<SizeField> = match &options.size_field {
        Some(f) => Arc::clone(f),
        None => Arc::new(SizeField::Layers(LayerSizeField {
            h0,
            thin,
            boxes: boxes.clone(),
            polys: polys.clone(),
            min: size_min,
        })),
    };

    let mut segments: Vec<Vec<[f64; 2]>> = polys
        .iter()
        .map(|p| {
            let mut s = p.clone();
            if let Some(&first) = p.first() {
                s.push(first);
            }
            s
        })
        .collect();
    // Reinforcement lines are mesh constraints, so that bars lie on element edges.
    // (the construction stages leave out the bars and piles, not their lines:
    // every stage must have the final model's mesh)
    let reinf: Vec<usize> = slope
        .reinforcements()
        .iter()
        .enumerate()
        .filter(|(_, r)| {
            point_in_polygon((r.x1 + r.x2) / 2.0, (r.y1 + r.y2) / 2.0, &bnd)
                && js::math::hypot(&[r.x2 - r.x1, r.y2 - r.y1]) > 0.0
        })
        .map(|(i, _)| i)
        .collect();
    for &ri in &reinf {
        let r = &slope.reinforcements()[ri];
        // a grouted anchor gets a vertex where its bonded length begins (the end of its free bar)
        let f = free_length(r);
        if f > 0.0 {
            let l = js::math::hypot(&[r.x2 - r.x1, r.y2 - r.y1]);
            let xb = r.x1 + ((r.x2 - r.x1) * f) / l;
            let yb = r.y1 + ((r.y2 - r.y1) * f) / l;
            segments.push(vec![[r.x1, r.y1], [xb, yb]]);
            segments.push(vec![[xb, yb], [r.x2, r.y2]]);
        } else {
            segments.push(vec![[r.x1, r.y1], [r.x2, r.y2]]);
        }
    }
    // Piles with a diameter are constraint lines too (piles.rs), clipped to the domain.
    for p in slope.piles() {
        if !matches!(p.diameter, Some(d) if d > 0.0) {
            continue;
        }
        if let Some(seg) = clip_to_polygon(&bnd, p.x1, p.y1, p.x2, p.y2) {
            segments.push(seg);
        }
    }
    let size_fn = |px: f64, py: f64| size.at(px, py);
    let tm = mesh_domain(&MeshInput {
        boundary: bnd.clone(),
        segments,
        size: &size_fn,
        min_angle: options.min_angle,
        min_size: None,
        size_min: if options.size_field.is_some() {
            size.min()
        } else {
            Some(size_min)
        },
        max_vertices: options.max_vertices,
    })?;

    // T6 connectivity: midside nodes numbered after the corners.
    let nc = tm.x.len();
    let mut edge_mid: HashMap<usize, usize> = HashMap::new();
    let mut xs: Vec<f64> = tm.x.clone();
    let mut ys: Vec<f64> = tm.y.clone();
    let ne = tm.count;
    let mut el = vec![0usize; 6 * ne];
    let mut edge_count: HashMap<usize, u32> = HashMap::new();
    let key = |a: usize, b: usize| if a < b { a * nc + b } else { b * nc + a };
    for e in 0..ne {
        let v = [tm.tri[3 * e], tm.tri[3 * e + 1], tm.tri[3 * e + 2]];
        el[6 * e] = v[0];
        el[6 * e + 1] = v[1];
        el[6 * e + 2] = v[2];
        for k in 0..3 {
            let a = v[k];
            let b = v[(k + 1) % 3];
            let kk = key(a, b);
            let m = *edge_mid.entry(kk).or_insert_with(|| {
                let m = xs.len();
                xs.push((tm.x[a] + tm.x[b]) / 2.0);
                ys.push((tm.y[a] + tm.y[b]) / 2.0);
                m
            });
            *edge_count.entry(kk).or_insert(0) += 1;
            el[6 * e + 3 + k] = m;
        }
    }
    let nn = xs.len();
    let mut x = xs;
    let mut y = ys;

    // Materials per element.
    let mut material_ids: Vec<MaterialId> = Vec::new();
    let mut el_material = vec![0usize; ne];
    for e in 0..ne {
        let (a, b, c) = (el[6 * e], el[6 * e + 1], el[6 * e + 2]);
        let cx = (x[a] + x[b] + x[c]) / 3.0;
        let cy = (y[a] + y[b] + y[c]) / 3.0;
        let mut k = region_at_fast(&boxes, &polys, cx, cy);
        if k < 0 {
            // On a boundary within round-off: nearest polygon edge.
            let mut best = f64::INFINITY;
            for (r, g) in geoms.iter().enumerate() {
                let mut gx = g.px.clone();
                let mut gy = g.py.clone();
                if let (Some(&x0), Some(&y0)) = (g.px.first(), g.py.first()) {
                    gx.push(x0);
                    gy.push(y0);
                }
                let d = dist_to_polyline(cx, cy, &gx, &gy);
                if d < best {
                    best = d;
                    k = r as i64;
                }
            }
        }
        if k < 0 {
            // (TypeScript reads geoms[-1].material)
            return Err(EngineError::new(
                "Cannot read properties of undefined (reading 'material')",
            ));
        }
        let m = geoms[k as usize].material;
        let mi = match material_ids.iter().position(|&id| id == m) {
            Some(i) => i,
            None => {
                material_ids.push(m);
                material_ids.len() - 1
            }
        };
        el_material[e] = mi;
    }
    let materials: Vec<Material> = material_ids
        .iter()
        .map(|&id| slope.material(id).clone())
        .collect();

    // Elastic parameters and behaviour per element.
    // "*" stands for the soils; a rigid material takes parameters only by name.
    let empty = FeMaterialParameters::default();
    let params: Vec<FeMaterialParameters> = materials
        .iter()
        .map(|m| {
            let mp = options.material_parameters.as_ref();
            mp.and_then(|p| p.get(&m.name))
                .or_else(|| {
                    if is_rigid(m) {
                        None
                    } else {
                        mp.and_then(|p| p.get("*"))
                    }
                })
                .unwrap_or(&empty)
                .clone()
        })
        .collect();
    // A rigid material is stiffer than the stiffest soil, and nearly impervious.
    let mut max_soil_e = 0.0;
    let mut min_soil_k = f64::INFINITY;
    for (i, m) in materials.iter().enumerate() {
        if is_rigid(m) {
            continue;
        }
        max_soil_e = js::math::max(
            max_soil_e,
            params[i].youngs_modulus.unwrap_or(DEFAULT_YOUNGS_MODULUS),
        );
        min_soil_k = js::math::min(
            min_soil_k,
            params[i].permeability.unwrap_or(DEFAULT_PERMEABILITY),
        );
    }
    if max_soil_e == 0.0 {
        max_soil_e = DEFAULT_YOUNGS_MODULUS;
    }
    if !min_soil_k.is_finite() {
        min_soil_k = DEFAULT_PERMEABILITY;
    }
    let mut el_e = vec![0.0; ne];
    let mut el_nu = vec![0.0; ne];
    let mut el_psi = vec![0.0; ne];
    let mut el_elastic = vec![false; ne];
    let inactive_names: &[String] = options.inactive_materials.as_deref().unwrap_or(&[]);
    let mut el_inactive = vec![false; ne];
    let mut min_soil_e = f64::INFINITY;
    for (i, m) in materials.iter().enumerate() {
        if !is_rigid(m) {
            min_soil_e = js::math::min(
                min_soil_e,
                params[i].youngs_modulus.unwrap_or(DEFAULT_YOUNGS_MODULUS),
            );
        }
    }
    if !min_soil_e.is_finite() {
        min_soil_e = DEFAULT_YOUNGS_MODULUS;
    }
    for e in 0..ne {
        let i = el_material[e];
        let m = &materials[i];
        let p = &params[i];
        let rigid = is_rigid(m);
        el_e[e] = p.youngs_modulus.unwrap_or(if rigid {
            RIGID_FACTOR * max_soil_e
        } else {
            DEFAULT_YOUNGS_MODULUS
        });
        el_nu[e] = p.poissons_ratio.unwrap_or(DEFAULT_POISSONS_RATIO);
        el_psi[e] = (p.dilation_angle.unwrap_or(0.0) * PI) / 180.0;
        el_elastic[e] = rigid;
        if !(el_e[e] > 0.0) || !(el_nu[e] > -1.0 && el_nu[e] < 0.5) {
            return Err(EngineError::range(format!(
                "invalid elastic parameters for material \"{}\"",
                m.name
            )));
        }
        if inactive_names.contains(&m.name) {
            el_inactive[e] = true;
            el_elastic[e] = true;
            el_e[e] = SOFT_FACTOR * min_soil_e;
        }
    }

    // Gauss points: coordinates, strength, pore pressure.
    let gp = gauss_data(&x, &y, &el, ne)?;
    let ngp = 3 * ne;
    let mut gp_x = vec![0.0; ngp];
    let mut gp_y = vec![0.0; ngp];
    let mut gp_c = vec![0.0; ngp];
    let mut gp_phi = vec![0.0; ngp];
    let mut gp_u = vec![0.0; ngp];
    let mut gp_cu = vec![f64::INFINITY; ngp];
    let factors = slope.partial_factors().cloned();
    // Gauss points in Hoek–Brown rock: their strength is set again below from the elastic stress.
    let mut hoek_brown: Vec<(usize, HoekBrownParameters)> = Vec::new();
    let mut nsh = [0.0f64; 6];
    let default_surface = Polyline {
        x: vec![xmin, xmax],
        y: vec![ymax, ymax],
    };
    let surface: &Polyline = slope.surface_line_xy().unwrap_or(&default_surface);
    let water_lines: Vec<Option<&Polyline>> = material_ids
        .iter()
        .map(|&m| slope.get_water_line_for_material(Some(m)))
        .collect();
    // Design suction strength included in gpC (φb), to replace it with that of the seepage.
    let mut gp_suction = vec![0.0; ngp];
    let suction_factor = factors.as_ref().map_or(1.0, |f| f.cohesion);
    for e in 0..ne {
        let mi = el_material[e];
        let m = &materials[mi];
        let wl = water_lines[mi];
        for g in 0..3 {
            shape_t6(GAUSS_T6[g][0], GAUSS_T6[g][1], &mut nsh);
            let mut gx = 0.0;
            let mut gy = 0.0;
            for k in 0..6 {
                gx += nsh[k] * x[el[6 * e + k]];
                gy += nsh[k] * y[el[6 * e + k]];
            }
            let i = 3 * e + g;
            gp_x[i] = gx;
            gp_y[i] = gy;
            if el_elastic[e] {
                gp_c[i] = f64::INFINITY;
                gp_phi[i] = 0.0;
            } else {
                let y_ground = polyline_y(surface, gx);
                // Depth from the top of the material's layer, as the slices take it.
                let y_layer_top = if needs_layer_top(&m.model) {
                    Some(material_layer_top_at(geoms, material_ids[mi], gx, gy).unwrap_or(y_ground))
                } else {
                    None
                };
                // Matric suction above the material's water line, for φb.
                let yw = match wl {
                    Some(wl) if suction_angle(&m.model) > 0.0 => polyline_y(wl, gx),
                    _ => f64::NAN,
                };
                let suction = if yw.is_finite() {
                    js::math::max(0.0, WATER_UNIT_WEIGHT * (gy - yw))
                } else {
                    0.0
                };
                let s = m.get_strength(&StrengthContext {
                    y_bottom: gy,
                    x: gx,
                    y_ground,
                    y_layer_top,
                    alpha: 0.0,
                    suction: Some(suction),
                    effective_vertical_stress: None,
                })?;
                if s.skip_surface == Some(true) {
                    gp_c[i] = f64::INFINITY;
                    gp_phi[i] = 0.0;
                    el_elastic[e] = true;
                } else {
                    // Design strength with the partial factors, as the slices
                    // (design_strength); the factor of safety is then on it.
                    let d = design_strength(Some(m.model.kind()), &s, factors.as_ref());
                    gp_c[i] = js::math::max(0.0, d.cohesion);
                    gp_suction[i] = s.suction_strength.unwrap_or(0.0) / suction_factor;
                    // without factors φ as given, not through atan(tan φ)
                    gp_phi[i] = if d.undrained {
                        0.0
                    } else if factors.is_some() {
                        js::math::atan(d.tan_phi)
                    } else {
                        (s.friction_angle * PI) / 180.0
                    };
                    if s.is_combined == Some(true) && !d.undrained {
                        gp_cu[i] = js::math::max(0.0, d.cohesion_undrained);
                    }
                    if let Some(hb) = s.hoek_brown {
                        hoek_brown.push((i, hb));
                    }
                }
            }
            if let Some(wl) = wl {
                let yw = polyline_y(wl, gx);
                gp_u[i] = if yw.is_finite() {
                    js::math::max(0.0, WATER_UNIT_WEIGHT * (yw - gy))
                } else {
                    0.0
                };
            }
        }
    }

    // Boundary edges: free on the ground surface, rollers on vertical sides, fixed elsewhere.
    let tol_b = 1e-6 * span;
    let mut fix_x = vec![false; nn];
    let mut fix_y = vec![false; nn];
    let mut surf_edges: Vec<usize> = Vec::new();
    let mut surf_edge_element: Vec<usize> = Vec::new();
    // (a Set: insertion order)
    let mut side_nodes: Vec<usize> = Vec::new();
    let mut is_side = vec![false; nn];
    for e in 0..ne {
        for k in 0..3 {
            let a = el[6 * e + k];
            let b = el[6 * e + (k + 1) % 3];
            let m = el[6 * e + 3 + k];
            if edge_count.get(&key(a, b)) != Some(&1) {
                continue;
            }
            let (mx, my) = (x[m], y[m]);
            if dist_to_polyline(mx, my, &surface.x, &surface.y) <= tol_b {
                surf_edges.extend_from_slice(&[a, m, b]);
                surf_edge_element.push(e);
                continue;
            }
            let vertical = (x[b] - x[a]).abs() <= 1e-3 * (y[b] - y[a]).abs();
            for n in [a, m, b] {
                fix_x[n] = true;
                if !vertical {
                    fix_y[n] = true;
                } else if ((x[n] - xmin).abs() <= tol_b || (x[n] - xmax).abs() <= tol_b)
                    && !is_side[n]
                {
                    // the model's sides (outer x-extent), not a vertical step in the base
                    is_side[n] = true;
                    side_nodes.push(n);
                }
            }
        }
    }

    // Pore pressures from steady seepage instead of the water lines.
    let mut seepage: Option<SeepageResult> = None;
    if options.pore_pressure == Some(PorePressureSource::Seepage) {
        let permeability: Vec<f64> = el_material
            .iter()
            .map(|&i| {
                params[i]
                    .permeability
                    .unwrap_or(if is_rigid(&materials[i]) {
                        RIGID_PERMEABILITY_FACTOR * min_soil_k
                    } else {
                        DEFAULT_PERMEABILITY
                    })
            })
            .collect();
        let vg_alpha: Vec<f64> = el_material
            .iter()
            .map(|&i| params[i].van_genuchten_alpha.unwrap_or(3.6))
            .collect();
        let vg_n: Vec<f64> = el_material
            .iter()
            .map(|&i| params[i].van_genuchten_n.unwrap_or(1.56))
            .collect();
        for (i, m) in materials.iter().enumerate() {
            let a = params[i].van_genuchten_alpha.unwrap_or(3.6);
            let n = params[i].van_genuchten_n.unwrap_or(1.56);
            if !(a > 0.0) || !(n > 1.0) {
                return Err(EngineError::range(format!(
                    "invalid van Genuchten parameters for material \"{}\" (α > 0 and n > 1 are required)",
                    m.name
                )));
            }
        }
        let sr = solve_seepage(
            &SeepageMesh {
                x: &x,
                y: &y,
                node_count: nn,
                el: &el,
                element_count: ne,
                gp: &gp,
                surface_edges: &surf_edges,
                side_nodes: &side_nodes,
                permeability: &permeability,
                vg_alpha: &vg_alpha,
                vg_n: &vg_n,
            },
            slope,
            80,
        )?;
        // Without water on the boundary there is no flow, and the pore pressures
        // stay those of each material's water line (computed above).
        if sr.flow {
            let head = &sr.head;
            for e in 0..ne {
                for g in 0..3 {
                    shape_t6(GAUSS_T6[g][0], GAUSS_T6[g][1], &mut nsh);
                    let mut h = 0.0;
                    for k in 0..6 {
                        h += nsh[k] * head[el[6 * e + k]];
                    }
                    let i = 3 * e + g;
                    gp_u[i] = if h.is_finite() {
                        js::math::max(0.0, WATER_UNIT_WEIGHT * (h - gp_y[i]))
                    } else {
                        0.0
                    };
                    // φb: the suction strength from the seepage's negative pore pressure
                    let m = &materials[el_material[e]];
                    if !el_elastic[e] && gp_c[i].is_finite() && suction_angle(&m.model) > 0.0 {
                        let ss = if h.is_finite() {
                            suction_strength(
                                &m.model,
                                js::math::max(0.0, WATER_UNIT_WEIGHT * (gp_y[i] - h)),
                            ) / suction_factor
                        } else {
                            0.0
                        };
                        gp_c[i] = js::math::max(0.0, gp_c[i] - gp_suction[i] + ss);
                        gp_suction[i] = ss;
                    }
                }
            }
        }
        seepage = Some(sr);
    }
    let seepage_flow = seepage.as_ref().is_some_and(|s| s.flow);

    // Equation numbering in nested dissection order of the nodes.
    let order = nested_dissection(&x, &y, &node_graph(&el, ne, nn));
    let mut eq = vec![-1i64; 2 * nn];
    let mut neq: usize = 0;
    for &n in &order {
        if !fix_x[n] {
            eq[2 * n] = neq as i64;
            neq += 1;
        }
        if !fix_y[n] {
            eq[2 * n + 1] = neq as i64;
            neq += 1;
        }
    }
    if neq == 0 {
        return Err(EngineError::new(
            "finite element model has no free degrees of freedom",
        ));
    }

    // Piles: beam nodes (with a rotation) at the soil nodes along each pile, and springs to the soil (piles.rs).
    let mut piles = FePiles::default();
    let mut springs: Option<PileSprings> = None;
    let mut pile_warnings: Vec<String> = Vec::new();
    let mut bar_warnings: Vec<String> = Vec::new();
    let without_reinforcement = options.without_reinforcement == Some(true);
    if !without_reinforcement && !slope.piles().is_empty() {
        let built = build_piles(&PileInput {
            slope,
            x: &x,
            y: &y,
            el: &el,
            ne,
            eq: &eq,
            neq,
            span,
            materials: &materials,
            el_material: &el_material,
            el_elastic: &el_elastic,
            gp_c: &gp_c,
            gp_phi: &gp_phi,
            gp_u: &gp_u,
            max_soil_e,
            water_lines: &water_lines,
            seepage_flow,
            surface: slope.surface_line_xy(),
            ymax,
        });
        x = built.x;
        y = built.y;
        eq = built.eq;
        neq = built.neq;
        piles = built.piles;
        springs = Some(built.springs);
        pile_warnings.extend(built.warnings);
    }

    // Reinforcement bars along the element edges on each line.
    let bars = with_springs(
        build_bars(
            slope,
            if without_reinforcement { &[] } else { &reinf },
            &el,
            ne,
            &x,
            &y,
            span,
            options
                .reinforcement_stiffness
                .unwrap_or(DEFAULT_REINFORCEMENT_STIFFNESS),
            options.reduce_reinforcement.unwrap_or(true),
            &mut bar_warnings,
        ),
        springs,
    );

    // Sparse pattern and assembly.
    let mut all_dofs = vec![0i64; 12 * ne];
    for e in 0..ne {
        for a in 0..6 {
            all_dofs[12 * e + 2 * a] = eq[2 * el[6 * e + a]];
            all_dofs[12 * e + 2 * a + 1] = eq[2 * el[6 * e + a] + 1];
        }
    }
    // The bars' couplings: within an element's except for an anchor's free
    // bar, whose ends share no element (groups padded to 12 with −1).
    let mut groups = vec![-1i64; all_dofs.len() + 12 * (bars.count + piles.count)];
    groups[..all_dofs.len()].copy_from_slice(&all_dofs);
    for b in 0..bars.count {
        for k in 0..3 {
            let n = bars.nodes[3 * b + k];
            let o = all_dofs.len() + 12 * b + 2 * k;
            groups[o] = eq[2 * n];
            groups[o + 1] = eq[2 * n + 1];
        }
    }
    // the piles' beams (six dofs each)
    let mut bd = [0i64; 6];
    for b in 0..piles.count {
        beam_dofs(&eq, &piles, b, &mut bd);
        let o = all_dofs.len() + 12 * (bars.count + b);
        groups[o..o + 6].copy_from_slice(&bd);
    }
    let mut kmat = SparseCholesky::from_groups(neq, &groups, 12);
    let mut ke = [0.0f64; 144];
    for e in 0..ne {
        stiffness_t6(&gp, e, el_e[e], el_nu[e], &mut ke);
        let d = &all_dofs[12 * e..12 * e + 12];
        for a in 0..12 {
            let ia = d[a];
            if ia < 0 {
                continue;
            }
            for b in 0..=a {
                let ib = d[b];
                if ib >= 0 {
                    kmat.add(ia as usize, ib as usize, ke[12 * a + b])?;
                }
            }
        }
    }
    for b in 0..bars.count {
        let mut d = [0i64; 6];
        for k in 0..3 {
            let n = bars.nodes[3 * b + k];
            d[2 * k] = eq[2 * n];
            d[2 * k + 1] = eq[2 * n + 1];
        }
        for g in 0..2 {
            let o = (2 * b + g) * BAR_GP_STRIDE;
            let w = bars.gp[o + 6] * bars.stiffness[b];
            for i in 0..6 {
                if d[i] < 0 {
                    continue;
                }
                for j in 0..=i {
                    if d[j] >= 0 {
                        kmat.add(
                            d[i] as usize,
                            d[j] as usize,
                            w * bars.gp[o + i] * bars.gp[o + j],
                        )?;
                    }
                }
            }
        }
    }
    let mut kb = [0.0f64; 36];
    for b in 0..piles.count {
        frame_stiffness(
            piles.c[b],
            piles.s[b],
            piles.length[b],
            piles.ea[b],
            piles.ei[b],
            &mut kb,
        );
        beam_dofs(&eq, &piles, b, &mut bd);
        for i in 0..6 {
            if bd[i] < 0 {
                continue;
            }
            for j in 0..=i {
                if bd[j] >= 0 {
                    kmat.add(bd[i] as usize, bd[j] as usize, kb[i * 6 + j])?;
                }
            }
        }
    }
    kmat.factor()?;

    // Loads.
    let mut f = vec![0.0f64; neq];
    let add_f = |f: &mut [f64], n: usize, fx: f64, fy: f64| {
        let ix = eq[2 * n];
        let iy = eq[2 * n + 1];
        if ix >= 0 {
            f[ix as usize] += fx;
        }
        if iy >= 0 {
            f[iy as usize] += fy;
        }
    };
    for e in 0..ne {
        if el_inactive[e] {
            continue; // not yet built: no weight, no pore pressure term
        }
        let m = &materials[el_material[e]];
        let wl = water_lines[el_material[e]];
        for g in 0..3 {
            let o = (3 * e + g) * GP_STRIDE;
            let w = gp[o + 12];
            let u = gp_u[3 * e + g];
            let gamma = gauss_unit_weight(m, wl, seepage_flow, u, gp_x[3 * e + g], gp_y[3 * e + g]);
            shape_t6(GAUSS_T6[g][0], GAUSS_T6[g][1], &mut nsh);
            for k in 0..6 {
                // self-weight, and ∫ Bᵀ m u: m = (1, 1, 0) in the plane
                add_f(
                    &mut f,
                    el[6 * e + k],
                    u * gp[o + k] * w,
                    -gamma * nsh[k] * w + u * gp[o + 6 + k] * w,
                );
            }
        }
    }
    // Variable loads (strip and line loads) take the partial factor γQ, as in the slices.
    let load_factor = factors.as_ref().map_or(1.0, |f| f.variable_load);
    // Surface tractions, 4 sub-intervals × 3 Gauss points per edge.
    let gl: [[f64; 2]; 3] = [
        [(1.0 - (3.0f64 / 5.0).sqrt()) / 2.0, 5.0 / 18.0],
        [0.5, 8.0 / 18.0],
        [(1.0 + (3.0f64 / 5.0).sqrt()) / 2.0, 5.0 / 18.0],
    ];
    let mut s = 0;
    while s < surf_edges.len() {
        let (a, m, b) = (surf_edges[s], surf_edges[s + 1], surf_edges[s + 2]);
        let edge_el = surf_edge_element[s / 3];
        s += 3;
        if el_inactive[edge_el] {
            continue; // on a material not yet built
        }
        // Ponded water: the water line of the material below the edge, as the
        // slices take it (freeWaterLineAt in slices.ts); with seepage the water
        // table that drives the flow.
        let ponding = if seepage_flow {
            slope.water_rl_xy()
        } else {
            water_lines[el_material[edge_el]]
        };
        let dx = x[b] - x[a];
        let dy = y[b] - y[a];
        for sub in 0..4 {
            for &[t0, wt] in &gl {
                let t = (sub as f64 + t0) / 4.0;
                let w = wt / 4.0;
                let px = x[a] + t * dx;
                let py = y[a] + t * dy;
                let na = (1.0 - t) * (1.0 - 2.0 * t);
                let nm = 4.0 * t * (1.0 - t);
                let nb = t * (2.0 * t - 1.0);
                let mut tx = 0.0;
                let mut ty = 0.0;
                // ponded water: pressure normal to the surface; outward normal × length = (dy, −dx)
                if let Some(ponding) = ponding {
                    let yw = polyline_y(ponding, px);
                    let p = if yw.is_finite() {
                        WATER_UNIT_WEIGHT * js::math::max(0.0, yw - py)
                    } else {
                        0.0
                    };
                    tx -= p * dy;
                    ty += p * dx;
                }
                // strip loads: vertical, per horizontal metre (downward on a surface traversed right to left);
                // a load normal to the ground as the ponded water, magnitude per metre of ground
                for q in slope.udls() {
                    if px < q.x1 || px > q.x2 {
                        continue;
                    }
                    if q.direction == UdlDirection::Normal {
                        let p = q.magnitude * load_factor;
                        tx -= p * dy;
                        ty += p * dx;
                    } else {
                        ty -= q.magnitude * load_factor * dx.abs();
                    }
                }
                if tx != 0.0 || ty != 0.0 {
                    add_f(&mut f, a, na * tx * w, na * ty * w);
                    add_f(&mut f, m, nm * tx * w, nm * ty * w);
                    add_f(&mut f, b, nb * tx * w, nb * ty * w);
                }
            }
        }
    }
    // Line loads at the surface point with that x (the highest if several).
    for ll in slope.line_loads() {
        let mut best: i64 = -1;
        let mut best_y = f64::NEG_INFINITY;
        let mut bt = 0.0;
        let mut s = 0;
        while s < surf_edges.len() {
            let a = surf_edges[s];
            let b = surf_edges[s + 2];
            let lo = js::math::min(x[a], x[b]);
            let hi = js::math::max(x[a], x[b]);
            if !(ll.x < lo || ll.x > hi || hi - lo < 1e-12) {
                let t = (ll.x - x[a]) / (x[b] - x[a]);
                let py = y[a] + t * (y[b] - y[a]);
                if py > best_y {
                    best_y = py;
                    best = s as i64;
                    bt = t;
                }
            }
            s += 3;
        }
        if best < 0 || el_inactive[surf_edge_element[best as usize / 3]] {
            continue;
        }
        let best = best as usize;
        let (a, m, b) = (surf_edges[best], surf_edges[best + 1], surf_edges[best + 2]);
        let p = ll.magnitude * load_factor;
        add_f(&mut f, a, 0.0, -p * (1.0 - bt) * (1.0 - 2.0 * bt));
        add_f(&mut f, m, 0.0, -p * 4.0 * bt * (1.0 - bt));
        add_f(&mut f, b, 0.0, -p * bt * (2.0 * bt - 1.0));
    }

    // Hoek–Brown rock: the instantaneous Mohr–Coulomb parameters at the
    // minor principal stress σ3 of the elastic gravity solution (the
    // equivalent Mohr–Coulomb material of the strength reduction with
    // Hoek–Brown, after Hammah et al. 2005, with the tangent fixed there).
    if !hoek_brown.is_empty() {
        let mut u = f.clone();
        kmat.solve(&mut u);
        let mut st = vec![0.0; 4 * ngp];
        gauss_strains_of(&el, &eq, &gp, ne, &u, &mut st);
        for &(i, hb) in &hoek_brown {
            let e = i / 3;
            let (young, nu) = (el_e[e], el_nu[e]);
            let lam = (young * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
            let mu = young / (2.0 * (1.0 + nu));
            let (ex, ey, g) = (st[4 * i], st[4 * i + 1], st[4 * i + 2]);
            let tr = ex + ey;
            let sx = lam * tr + 2.0 * mu * ex;
            let sy = lam * tr + 2.0 * mu * ey;
            let txy = mu * g;
            let sz = lam * tr;
            let (c, phi) = hoek_brown_strength(&hb, sx, sy, txy, sz, factors.as_ref());
            gp_c[i] = c;
            gp_phi[i] = phi;
        }
    }

    // as norm2 (newton.rs)
    let mut sum = 0.0;
    for &v in &f {
        sum += v * v;
    }
    let load_norm = sum.sqrt();
    let mut warnings = ignored_input_warnings(slope);
    warnings.extend(bar_warnings);
    warnings.extend(pile_warnings);
    let gp_c0 = gp_c.clone();
    let gp_phi0 = gp_phi.clone();
    Ok(FeModel {
        x,
        y,
        node_count: nn,
        corner_count: nc,
        el,
        element_count: ne,
        materials,
        material_ids,
        el_material,
        el_e,
        el_nu,
        el_psi,
        el_elastic,
        gp,
        gp_x,
        gp_y,
        gp_c,
        gp_cu,
        gp_phi,
        gp_u,
        eq,
        eq_count: neq,
        k: kmat,
        f,
        stress0: None,
        load_norm,
        el_inactive,
        surface_edges: surf_edges,
        triangulation: tm,
        size_field: size,
        seepage,
        gp_hoek_brown: hoek_brown,
        partial_factors: factors,
        gp_c0,
        gp_phi0,
        piles,
        warnings,
        bars,
        element_eqs: OnceLock::new(),
        scatter: OnceLock::new(),
    })
}

/// Inputs of the limit equilibrium analysis that the finite element
/// analyses do not take: one warning for each in the slope, so that the
/// result is not read as including them. Pore pressures come from the
/// materials' water lines (or the seepage), strengths from the materials'
/// own models.
pub fn ignored_input_warnings(slope: &Slope) -> Vec<String> {
    let mut warnings = Vec::new();
    // (a Set of the materials: insertion order)
    let mut materials: Vec<MaterialId> = Vec::new();
    for g in slope.material_geometries() {
        if !materials.contains(&g.material) {
            materials.push(g.material);
        }
    }
    let named = |pred: &dyn Fn(&Material) -> bool| -> String {
        materials
            .iter()
            .map(|&id| slope.material(id))
            .filter(|m| pred(m))
            .map(|m| {
                if m.name.is_empty() {
                    "unnamed".to_string()
                } else {
                    m.name.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    if slope.waternet().is_some() {
        warnings.push("The waternet is not included in the finite element analysis: the pore pressures come from the water tables.".to_string());
    }
    let ru = named(&|m| matches!(m.model.base().ru, Some(v) if v != 0.0));
    if !ru.is_empty() {
        warnings.push(format!(
            "The pore pressure ratio rᵤ is not included in the finite element analysis ({ru})."
        ));
    }
    let b_bar = named(&|m| matches!(m.model.base().b_bar, Some(v) if v != 0.0));
    if !b_bar.is_empty() {
        warnings.push(format!("The excess pore pressure from fill (B̄) is not included in the finite element analysis ({b_bar})."));
    }
    let above = named(&|m| m.model.base().above_water.is_some());
    if !above.is_empty() {
        warnings.push(format!("The strength above the water table is not included in the finite element analysis: the material's own strength is used throughout ({above})."));
    }
    if slope
        .udls()
        .iter()
        .any(|u| !u.excess_pore_pressure.is_empty())
    {
        warnings.push("The excess pore pressure under distributed loads is not included in the finite element analysis.".to_string());
    }
    if slope.earlier_stage().is_some() {
        warnings.push("The earlier stage is not included in the finite element analysis: the yield stress of SHANSEP materials does not come from it.".to_string());
    }
    if slope.drawdown_before().is_some() {
        warnings.push("Rapid drawdown is not included in the finite element analysis: the slope is analyzed with the water after drawdown and the materials' own strengths.".to_string());
    }
    warnings
}

/// Design c (kPa) and φ (rad) of Hoek–Brown rock at a stress (σx, σy, τxy, σz; effective, tension positive).
fn hoek_brown_strength(
    hb: &HoekBrownParameters,
    sx: f64,
    sy: f64,
    txy: f64,
    sz: f64,
    factors: Option<&PartialFactors>,
) -> (f64, f64) {
    let r = js::math::hypot(&[(sx - sy) / 2.0, txy]);
    // σ3 compression positive: minus the largest (tension-positive) principal stress
    let s3 = -js::math::max((sx + sy) / 2.0 + r, sz);
    let inst = instantaneous_at_sigma3(hb, s3);
    let d = design_strength(
        Some("hoek-brown"),
        &ResolvedStrength {
            cohesion: inst.cohesion,
            friction_angle: inst.friction_angle,
            cohesion_undrained: inst.cohesion,
            ..Default::default()
        },
        factors,
    );
    (
        d.cohesion,
        if factors.is_some() {
            js::math::atan(d.tan_phi)
        } else {
            (inst.friction_angle * PI) / 180.0
        },
    )
}

/// Hoek–Brown rock: c and φ at each of its Gauss points set to the
/// instantaneous parameters at the stresses given (a trial's starting
/// state, srm.rs), or back to those of the elastic stress (None): the
/// tangent follows the stress as the strength reduction proceeds (Hammah,
/// Yacoub, Corkum & Curran 2005, Proc. 40th US Rock Mech. Symp., ARMA
/// 05-810).
pub fn set_hoek_brown_strength(model: &mut FeModel, stress: Option<&[f64]>) {
    let factors = model.partial_factors.clone();
    for k in 0..model.gp_hoek_brown.len() {
        let (i, hb) = model.gp_hoek_brown[k];
        match stress {
            None => {
                model.gp_c[i] = model.gp_c0[i];
                model.gp_phi[i] = model.gp_phi0[i];
            }
            Some(stress) => {
                let (c, phi) = hoek_brown_strength(
                    &hb,
                    stress[4 * i],
                    stress[4 * i + 1],
                    stress[4 * i + 2],
                    stress[4 * i + 3],
                    factors.as_ref(),
                );
                model.gp_c[i] = c;
                model.gp_phi[i] = phi;
            }
        }
    }
}

/// The model with initial effective stresses σ₀ per Gauss point (σx, σy,
/// τxy, σz): the stress is σ₀ + D(ε − εp), and the load vector becomes
/// f − ∫ Bᵀ σ₀, the out-of-balance force that the solvers equilibrate
/// (zero for initial stresses in equilibrium with the loads). The
/// displacements are counted from the initial state.
pub fn with_initial_stress(model: &FeModel, stress0: &[f64]) -> FeModel {
    let (el, eq, gp, ne) = (&model.el, &model.eq, &model.gp, model.element_count);
    let mut f = model.f.clone();
    for e in 0..ne {
        for g in 0..3 {
            let i = 3 * e + g;
            let o = i * GP_STRIDE;
            let w = gp[o + 12];
            let s = 4 * i;
            let (sx, sy, txy) = (stress0[s], stress0[s + 1], stress0[s + 2]);
            if sx == 0.0 && sy == 0.0 && txy == 0.0 {
                continue;
            }
            for k in 0..6 {
                let dx = gp[o + k];
                let dy = gp[o + 6 + k];
                let n = el[6 * e + k];
                let ix = eq[2 * n];
                let iy = eq[2 * n + 1];
                if ix >= 0 {
                    f[ix as usize] -= (dx * sx + dy * txy) * w;
                }
                if iy >= 0 {
                    f[iy as usize] -= (dy * sy + dx * txy) * w;
                }
            }
        }
    }
    let mut out = model.clone();
    out.f = f;
    out.stress0 = Some(stress0.to_vec());
    out
}

/// Strains of every Gauss point from a displacement vector (per equation):
/// εx, εy, γxy, εz (= 0 in plane strain), 4 per Gauss point.
pub fn gauss_strains(model: &FeModel, u: &[f64], out: &mut [f64]) {
    gauss_strains_of(&model.el, &model.eq, &model.gp, model.element_count, u, out);
}

fn gauss_strains_of(
    el: &[usize],
    eq: &[i64],
    gp: &[f64],
    element_count: usize,
    u: &[f64],
    out: &mut [f64],
) {
    for e in 0..element_count {
        for g in 0..3 {
            let o = (3 * e + g) * GP_STRIDE;
            let (mut ex, mut ey, mut gxy) = (0.0, 0.0, 0.0);
            for k in 0..6 {
                let n = el[6 * e + k];
                let ix = eq[2 * n];
                let iy = eq[2 * n + 1];
                let ux = if ix >= 0 { u[ix as usize] } else { 0.0 };
                let uy = if iy >= 0 { u[iy as usize] } else { 0.0 };
                ex += gp[o + k] * ux;
                ey += gp[o + 6 + k] * uy;
                gxy += gp[o + 6 + k] * ux + gp[o + k] * uy;
            }
            let i = 4 * (3 * e + g);
            out[i] = ex;
            out[i + 1] = ey;
            out[i + 2] = gxy;
            out[i + 3] = 0.0;
        }
    }
}

/// Elastic solution (`solveElastic`).
#[derive(Debug, Clone, PartialEq)]
pub struct ElasticSolution {
    /// Displacements per equation.
    pub u: Vec<f64>,
    /// Effective stresses (σx, σy, τxy, σz) per Gauss point (of the loads alone: initial stresses are not added).
    pub stress: Vec<f64>,
}

/// Elastic solution: displacements per equation and effective stresses (σx, σy, τxy, σz) per Gauss point (of the loads alone: initial stresses are not added).
pub fn solve_elastic(model: &FeModel) -> ElasticSolution {
    let mut u = model.f.clone();
    model.k.solve(&mut u);
    let ngp = 3 * model.element_count;
    let mut strain = vec![0.0; 4 * ngp];
    gauss_strains(model, &u, &mut strain);
    let mut stress = vec![0.0; 4 * ngp];
    for i in 0..ngp {
        let e = i / 3;
        let (young, nu) = (model.el_e[e], model.el_nu[e]);
        let lam = (young * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
        let mu = young / (2.0 * (1.0 + nu));
        let (ex, ey, g) = (strain[4 * i], strain[4 * i + 1], strain[4 * i + 2]);
        let tr = ex + ey;
        stress[4 * i] = lam * tr + 2.0 * mu * ex;
        stress[4 * i + 1] = lam * tr + 2.0 * mu * ey;
        stress[4 * i + 2] = mu * g;
        stress[4 * i + 3] = lam * tr;
    }
    ElasticSolution { u, stress }
}

impl FeModel {
    /// Element dof → equation table (12 per element, −1 for fixed dofs), built once per model (srm.ts `elementEquations`).
    pub fn element_equations(&self) -> &[i64] {
        self.element_eqs.get_or_init(|| {
            let mut out = vec![0i64; 12 * self.element_count];
            for e in 0..self.element_count {
                for a in 0..6 {
                    let n = self.el[6 * e + a];
                    out[12 * e + 2 * a] = self.eq[2 * n];
                    out[12 * e + 2 * a + 1] = self.eq[2 * n + 1];
                }
            }
            out
        })
    }
}

/// Bars along the mesh edges that lie on the reinforcement lines.
fn build_bars(
    slope: &Slope,
    reinf: &[usize],
    el: &[usize],
    ne: usize,
    x: &[f64],
    y: &[f64],
    span: f64,
    ea: f64,
    reduce: bool,
    warnings: &mut Vec<String>,
) -> FeBars {
    let mut nodes: Vec<usize> = Vec::new();
    let mut source: Vec<i64> = Vec::new();
    let mut gpd: Vec<f64> = Vec::new();
    let mut cap: Vec<f64> = Vec::new();
    let mut passive: Vec<bool> = Vec::new();
    let mut stiff: Vec<f64> = Vec::new();
    let mut ep0: Vec<f64> = Vec::new();
    let all = slope.reinforcements();
    let envelopes = if all.is_empty() {
        &[][..]
    } else {
        slope.reinforcement_envelopes()
    };
    let tol = 1e-6 * span;
    let xi = [-1.0 / 3.0f64.sqrt(), 1.0 / 3.0f64.sqrt()];
    for &k in reinf {
        let r = &all[k];
        let env = envelopes.get(k);
        let l = js::math::hypot(&[r.x2 - r.x1, r.y2 - r.y1]);
        let c = (r.x2 - r.x1) / l;
        let s = (r.y2 - r.y1) / l;
        let station = |px: f64, py: f64| (px - r.x1) * c + (py - r.y1) * s;
        let on_line = |n: usize| {
            let t = station(x[n], y[n]);
            t >= -tol && t <= l + tol && (-(x[n] - r.x1) * s + (y[n] - r.y1) * c).abs() <= tol
        };
        let mut seen: std::collections::HashSet<(usize, usize)> = std::collections::HashSet::new();
        let spacing = match r.spacing {
            Some(sp) if sp > 0.0 => sp,
            _ => 1.0,
        };
        let is_passive = r.application == Some(ReinforcementApplication::Passive) && reduce;
        // A grouted anchor's free length is one bar from the head (or, for a
        // head outside the soil, the first point of the line in it) to the start
        // of the bonded length, joined to the soil only at its ends.
        let mut free = free_length(r);
        let mut head: i64 = -1;
        let mut start: i64 = -1;
        if free > 0.0 {
            let mut first = f64::INFINITY;
            for e in 0..ne {
                for j in 0..3 {
                    let n = el[6 * e + j];
                    if !on_line(n) {
                        continue;
                    }
                    let t = station(x[n], y[n]);
                    if t < first {
                        first = t;
                        head = n as i64;
                    }
                    if (t - free).abs() <= tol {
                        start = n as i64;
                    }
                }
            }
            if start < 0 || head < 0 || !(first < free - tol) {
                warnings.push(format!("The free length of anchor {} could not be placed in the mesh; the anchor is bonded over its length in the finite element analysis.", k + 1));
                free = 0.0;
            }
        }
        for e in 0..ne {
            for j in 0..3 {
                let mut a = el[6 * e + j];
                let mut b = el[6 * e + (j + 1) % 3];
                let m = el[6 * e + 3 + j];
                if !on_line(a) || !on_line(b) {
                    continue;
                }
                let key = if a < b { (a, b) } else { (b, a) };
                if !seen.insert(key) {
                    continue;
                }
                let mut sa = station(x[a], y[a]);
                let mut sb = station(x[b], y[b]);
                if sb < sa {
                    std::mem::swap(&mut a, &mut b);
                    std::mem::swap(&mut sa, &mut sb);
                }
                if free > 0.0 && sb <= free + tol {
                    continue; // in the free length
                }
                let len = sb - sa;
                nodes.extend_from_slice(&[a, m, b]);
                source.push(k as i64);
                stiff.push(ea);
                passive.push(is_passive);
                for &q in &xi {
                    // dN/dξ of the quadratic bar (nodes at ξ = −1, 0, 1); ds = len/2 dξ
                    for v in [q - 0.5, -2.0 * q, q + 0.5] {
                        let v = (2.0 * v) / len;
                        gpd.push(v * c);
                        gpd.push(v * s);
                    }
                    gpd.push(len / 2.0);
                    let st = sa + ((q + 1.0) / 2.0) * len;
                    cap.push(
                        (match env {
                            Some(env) => envelope_at(env, st),
                            None => r.tensile_capacity,
                        }) / spacing,
                    );
                    ep0.push(0.0);
                }
            }
        }
        if free > 0.0 {
            let (head, start) = (head as usize, start as usize);
            let hs = station(x[head], y[head]);
            let lf = free - hs; // the free bar's length in the soil
                                // two-node bar (head, head, start): the middle node carries no strain
            nodes.extend_from_slice(&[head, head, start]);
            source.push(k as i64);
            stiff.push(ea);
            passive.push(is_passive);
            let p = js::math::max(0.0, r.prestress.unwrap_or(0.0)) / spacing;
            for _ in 0..2 {
                gpd.extend_from_slice(&[-c / lf, -s / lf, 0.0, 0.0, c / lf, s / lf, lf / 2.0]);
                cap.push(
                    (match env {
                        Some(env) => envelope_at(env, (hs + free) / 2.0),
                        None => r.tensile_capacity,
                    }) / spacing,
                );
                ep0.push(-p / ea);
            }
        }
    }
    let count = source.len();
    let ncap = cap.len();
    FeBars {
        count,
        nodes,
        source,
        gp: gpd,
        capacity: cap,
        passive,
        stiffness: stiff,
        ep0,
        both_ways: vec![false; count],
        cap_kind: vec![0; ncap],
        cap_c: vec![0.0; ncap],
        cap_sv: vec![0.0; ncap],
        cap_tan: vec![0.0; ncap],
    }
}
