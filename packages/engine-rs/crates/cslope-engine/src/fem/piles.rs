//! Port of packages/engine/src/fem/piles.ts.
//!
//! Pile rows in the strength reduction: an embedded beam row.
//!
//! Method: each pile is a line of two-node Euler–Bernoulli frame elements
//! (axial and bending stiffness per metre of slope, EA/s and EI/s for piles
//! at spacing s) on beam nodes with a rotation, placed at the soil nodes
//! along the pile (the mesh has the pile as a constraint line). Each beam
//! node is joined to its soil node by a lateral and an axial spring,
//! elastic–perfectly plastic, so that the soil can flow between the piles
//! (the embedded beam row: Sluis, Besseling & Stuurwold 2014, Numerical
//! Methods in Geotechnical Engineering, 431–436; the pile–soil springs of
//! the p–y method). The springs are bars of bars.rs that act in both
//! directions.
//!
//! Limits per pile and metre of pile, reduced with the soil's strength
//! (c/F, tan φ/F):
//! - lateral: p_u = 9 c d + 3 (Kp − Ka) σ′v d, the ultimate lateral
//!   resistance of Broms (1964, J. Soil Mech. Found. Div. 90(SM2), 27–63,
//!   and (SM3), 123–156) for cohesive and cohesionless soil, summed for c–φ
//!   soil, with the net passive pressure Kp − Ka (implementation choice:
//!   Broms' 3 Kp would leave 3 σ′v d of support at φ = 0 and as F grows); a
//!   continuous wall (`wall`, or spacing ≤ width) lets no soil through and
//!   its lateral springs do not yield;
//! - axial: skin friction t = π d (c + K0 σ′v tan φ), K0 = 1 − sin φ (two
//!   faces per metre of a wall).
//!
//! Implementation choices (not from the literature): the springs' stiffness
//! is 10 times the soil's Young's modulus per metre of tributary length
//! (stiff against the soil, soft enough for the conditioning); σ′v is the
//! unit weight of the soil at the node times its depth below the ground less
//! the pore pressure; the strength is that of the first element at the node
//! (rigid material: no yield); EI and EA of a solid circular section of
//! concrete (E = 30 GPa) unless given (for a wall a plate of thickness d per
//! metre); the piles stay elastic, their largest
//! moment and shear compared with the capacities afterwards; piles without a
//! diameter (a given force only) are left out.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::error::Result;
use crate::fem::model::{gauss_unit_weight, polyline_y};
use crate::fem::sparse::SparseCholesky;
use crate::js;
use crate::model::geometry_ops::Polyline;
use crate::model::slope::Slope;
use crate::types::Material;
use serde::Serialize;
use std::f64::consts::PI;

/// Young's modulus of a pile without given stiffness (kPa): concrete.
pub const PILE_DEFAULT_E: f64 = 3e7;
/// Spring stiffness per metre of tributary length, as a multiple of the soil's Young's modulus.
const SPRING_FACTOR: f64 = 10.0;
/// Capacity of a spring that does not yield (kN).
pub const NO_YIELD: f64 = 1e12;

/// `FePiles` (`EMPTY_PILES` is the default).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FePiles {
    /// Beam elements: two global nodes each.
    pub count: usize,
    pub nodes: Vec<usize>,
    /// Per beam: direction cosines, length, EA and EI per metre of slope, source pile.
    pub c: Vec<f64>,
    pub s: Vec<f64>,
    pub length: Vec<f64>,
    pub ea: Vec<f64>,
    pub ei: Vec<f64>,
    pub source: Vec<usize>,
    /// Rotation equation of each global node (−1: none, a soil node or fixed).
    pub rot_eq: Vec<i64>,
}

/// Spring bars to append to the reinforcement bars (bars.rs layout).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PileSprings {
    pub nodes: Vec<usize>,
    pub gp: Vec<f64>,
    pub stiffness: Vec<f64>,
    /// Per Gauss point: capacity kind (1 lateral, 2 axial; 0 fixed) and its terms.
    pub kind: Vec<u8>,
    pub cap_c: Vec<f64>,
    pub cap_sv: Vec<f64>,
    pub cap_tan: Vec<f64>,
    pub fixed_cap: Vec<f64>,
}

/// What `build_piles` reads of the model under construction (TypeScript's
/// `PileInput`; its `unitWeight` and `groundY` closures are
/// `gauss_unit_weight` with `seepage_flow`, and the ground line or `ymax`).
pub struct PileInput<'a> {
    pub slope: &'a Slope,
    pub x: &'a [f64],
    pub y: &'a [f64],
    pub el: &'a [usize],
    pub ne: usize,
    pub eq: &'a [i64],
    pub neq: usize,
    pub span: f64,
    pub materials: &'a [Material],
    pub el_material: &'a [usize],
    pub el_elastic: &'a [bool],
    pub gp_c: &'a [f64],
    pub gp_phi: &'a [f64],
    pub gp_u: &'a [f64],
    pub max_soil_e: f64,
    pub water_lines: &'a [Option<&'a Polyline>],
    /// Whether the pore pressures come from a seepage solution with flow.
    pub seepage_flow: bool,
    /// The slope's ground line (None: the ground is at `ymax`).
    pub surface: Option<&'a Polyline>,
    pub ymax: f64,
}

/// Result of `build_piles`.
#[derive(Debug, Clone)]
pub struct BuiltPiles {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub eq: Vec<i64>,
    pub neq: usize,
    pub piles: FePiles,
    pub springs: PileSprings,
    pub warnings: Vec<String>,
}

/// Beam nodes, beam elements and springs of the slope's piles (those with a
/// diameter). Returns the coordinates and equation numbers extended with the
/// beam nodes (2 per node, then a rotation equation each).
pub fn build_piles(input: &PileInput) -> BuiltPiles {
    let (slope, el, ne, span) = (input.slope, input.el, input.ne, input.span);
    let mut neq = input.neq as i64;
    let mut warnings = Vec::new();
    let mut springs = PileSprings::default();
    let mut xs = input.x.to_vec();
    let mut ys = input.y.to_vec();
    let mut eqs = input.eq.to_vec();
    let mut rot: Vec<i64> = vec![-1; xs.len()];
    let (mut bn, mut bc, mut bs, mut bl, mut bea, mut bei, mut bsrc) = (
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    );
    let tol = 1e-6 * span;
    let ground_y = |px: f64| match input.surface {
        Some(s) => polyline_y(s, px),
        None => input.ymax,
    };
    // Element at each soil node (for its strength and pore pressure).
    let mut node_element: Vec<i64> = vec![-1; input.x.len()];
    for e in 0..ne {
        for k in 0..6 {
            if node_element[el[6 * e + k]] < 0 {
                node_element[el[6 * e + k]] = e as i64;
            }
        }
    }
    for (pi, p) in slope.piles().iter().enumerate() {
        let d = match p.diameter {
            Some(d) if d > 0.0 => d,
            _ => {
                warnings.push(format!(
                    "Pile {} has no diameter and is not included in the finite element analysis.",
                    pi + 1
                ));
                continue;
            }
        };
        let l = js::math::hypot(&[p.x2 - p.x1, p.y2 - p.y1]);
        if !(l > 0.0) {
            continue;
        }
        let c = (p.x2 - p.x1) / l;
        let s = (p.y2 - p.y1) / l;
        let station = |n: usize| (input.x[n] - p.x1) * c + (input.y[n] - p.y1) * s;
        let on_line = |n: usize| {
            let t = station(n);
            t >= -tol
                && t <= l + tol
                && (-(input.x[n] - p.x1) * s + (input.y[n] - p.y1) * c).abs() <= tol
        };
        let mut soil: Vec<usize> = Vec::new();
        for n in 0..input.x.len() {
            if node_element[n] >= 0 && on_line(n) {
                soil.push(n);
            }
        }
        js::array::sort_by(&mut soil, |&a, &b| station(a) - station(b));
        if soil.len() < 2 {
            warnings.push(format!(
                "Pile {} lies outside the mesh and is not included in the finite element analysis.",
                pi + 1
            ));
            continue;
        }
        let spacing = match p.spacing {
            Some(sp) if sp > 0.0 => sp,
            _ => 1.0,
        };
        let e_mod = PILE_DEFAULT_E;
        let wall = p.wall.unwrap_or(spacing <= d); // a continuous wall: no soil flows through
                                                   // defaults: a solid circle of diameter d per pile, or a plate of thickness d per metre for a wall
        let ea = p.axial_stiffness.unwrap_or(if wall {
            e_mod * d * spacing
        } else {
            (e_mod * PI * d * d) / 4.0
        }) / spacing;
        let ei = p.bending_stiffness.unwrap_or(if wall {
            (e_mod * js::math::pow(d, 3.0) * spacing) / 12.0
        } else {
            (e_mod * PI * js::math::pow(d, 4.0)) / 64.0
        }) / spacing;
        // beam nodes at the soil nodes
        let beam: Vec<usize> = soil
            .iter()
            .map(|&n| {
                let g = xs.len();
                xs.push(input.x[n]);
                ys.push(input.y[n]);
                eqs.push(neq);
                eqs.push(neq + 1);
                rot.push(neq + 2);
                neq += 3;
                g
            })
            .collect();
        for k in 0..beam.len() - 1 {
            let len = station(soil[k + 1]) - station(soil[k]);
            bn.push(beam[k]);
            bn.push(beam[k + 1]);
            bc.push(c);
            bs.push(s);
            bl.push(len);
            bea.push(ea);
            bei.push(ei);
            bsrc.push(pi);
        }
        // springs, with the tributary length of each node
        for (k, &n) in soil.iter().enumerate() {
            let prev = if k > 0 {
                station(n) - station(soil[k - 1])
            } else {
                0.0
            };
            let next = if k + 1 < soil.len() {
                station(soil[k + 1]) - station(n)
            } else {
                0.0
            };
            let trib = (prev + next) / 2.0;
            if !(trib > 0.0) {
                continue;
            }
            let e = node_element[n] as usize;
            let mi = input.el_material[e];
            let m = &input.materials[mi];
            // strength and pore pressure of the element at the node (its Gauss points' mean)
            let (mut cc, mut phi, mut u) = (0.0, 0.0, 0.0);
            for g in 0..3 {
                cc += input.gp_c[3 * e + g] / 3.0;
                phi += input.gp_phi[3 * e + g] / 3.0;
                u += input.gp_u[3 * e + g] / 3.0;
            }
            let depth = js::math::max(0.0, ground_y(input.x[n]) - input.y[n]);
            let sv = js::math::max(
                0.0,
                gauss_unit_weight(
                    m,
                    input.water_lines[mi],
                    input.seepage_flow,
                    u,
                    input.x[n],
                    input.y[n],
                ) * depth
                    - u,
            );
            let rigid = input.el_elastic[e];
            let k0 = SPRING_FACTOR * input.max_soil_e * trib;
            for (kind, nx, ny) in [(1u8, -s, c), (2u8, c, s)] {
                springs.nodes.extend_from_slice(&[n, n, beam[k]]);
                springs.stiffness.push(k0);
                for _ in 0..2 {
                    springs
                        .gp
                        .extend_from_slice(&[-nx, -ny, 0.0, 0.0, nx, ny, 0.5]);
                    let lateral = kind == 1;
                    let no_yield = rigid || (lateral && wall);
                    springs.kind.push(if no_yield { 0 } else { kind });
                    springs.fixed_cap.push(NO_YIELD);
                    // per metre of slope: per pile × trib / spacing
                    // axial: the pile's circumference, or both faces of a wall per metre
                    let perimeter = if wall { 2.0 * spacing } else { PI * d };
                    springs.cap_c.push(if lateral {
                        (9.0 * cc * d * trib) / spacing
                    } else {
                        (perimeter * cc * trib) / spacing
                    });
                    springs.cap_sv.push(if lateral {
                        (3.0 * sv * d * trib) / spacing
                    } else {
                        (perimeter * (1.0 - js::math::sin(phi)) * sv * trib) / spacing
                    });
                    springs.cap_tan.push(js::math::tan(phi));
                }
            }
        }
    }
    BuiltPiles {
        x: xs,
        y: ys,
        eq: eqs,
        neq: neq as usize,
        piles: FePiles {
            count: bsrc.len(),
            nodes: bn,
            c: bc,
            s: bs,
            length: bl,
            ea: bea,
            ei: bei,
            source: bsrc,
            rot_eq: rot,
        },
        springs,
        warnings,
    }
}

/// Capacity of a pile spring at reduction F (kind 1 lateral, 2 axial).
pub fn spring_capacity(kind: u8, cap_c: f64, cap_sv: f64, tan_phi: f64, f: f64) -> f64 {
    let tan_f = tan_phi / f;
    if kind == 1 {
        // the net passive pressure Kp − Ka: zero without friction, so that the
        // support vanishes with the soil's strength
        let sin_f = js::math::sin(js::math::atan(tan_f));
        let kp = (1.0 + sin_f) / (1.0 - sin_f);
        return cap_c / f + cap_sv * (kp - 1.0 / kp);
    }
    cap_c / f + cap_sv * tan_f
}

/// Global stiffness (6 × 6, dofs u1 v1 θ1 u2 v2 θ2) of a frame element into `k`.
pub fn frame_stiffness(c: f64, s: f64, l: f64, ea: f64, ei: f64, k: &mut [f64]) {
    let a = ea / l;
    let b = (12.0 * ei) / js::math::pow(l, 3.0);
    let q = (6.0 * ei) / js::math::pow(l, 2.0);
    let r = (4.0 * ei) / l;
    let h = (2.0 * ei) / l;
    // local stiffness (axial along the beam, transverse, rotation)
    #[rustfmt::skip]
    let kl = [
        a, 0.0, 0.0, -a, 0.0, 0.0,
        0.0, b, q, 0.0, -b, q,
        0.0, q, r, 0.0, -q, h,
        -a, 0.0, 0.0, a, 0.0, 0.0,
        0.0, -b, -q, 0.0, b, -q,
        0.0, q, h, 0.0, -q, r,
    ];
    // T: local = T global
    let mut t = [0.0f64; 36];
    for o in [0usize, 3] {
        t[o * 6 + o] = c;
        t[o * 6 + o + 1] = s;
        t[(o + 1) * 6 + o] = -s;
        t[(o + 1) * 6 + o + 1] = c;
        t[(o + 2) * 6 + o + 2] = 1.0;
    }
    for i in 0..6 {
        for j in 0..6 {
            let mut v = 0.0;
            for m in 0..6 {
                if t[m * 6 + i] == 0.0 {
                    continue;
                }
                for n in 0..6 {
                    v += t[m * 6 + i] * kl[m * 6 + n] * t[n * 6 + j];
                }
            }
            k[i * 6 + j] = v;
        }
    }
}

/// Equations of a beam's six dofs.
pub fn beam_dofs(eq: &[i64], piles: &FePiles, b: usize, out: &mut [i64]) {
    let n1 = piles.nodes[2 * b];
    let n2 = piles.nodes[2 * b + 1];
    out[0] = eq[2 * n1];
    out[1] = eq[2 * n1 + 1];
    out[2] = piles.rot_eq[n1];
    out[3] = eq[2 * n2];
    out[4] = eq[2 * n2 + 1];
    out[5] = piles.rot_eq[n2];
}

/// Internal forces of the (elastic) piles added to `fint`, and their stiffness to `k` when given.
pub fn beam_internal(
    eq: &[i64],
    piles: &FePiles,
    u: &[f64],
    fint: &mut [f64],
    mut k: Option<&mut SparseCholesky>,
) -> Result<()> {
    let mut bk = [0.0f64; 36];
    let mut bd = [0i64; 6];
    for b in 0..piles.count {
        frame_stiffness(
            piles.c[b],
            piles.s[b],
            piles.length[b],
            piles.ea[b],
            piles.ei[b],
            &mut bk,
        );
        beam_dofs(eq, piles, b, &mut bd);
        for i in 0..6 {
            if bd[i] < 0 {
                continue;
            }
            let mut f = 0.0;
            for j in 0..6 {
                if bd[j] >= 0 {
                    f += bk[i * 6 + j] * u[bd[j] as usize];
                }
            }
            fint[bd[i] as usize] += f;
            if let Some(k) = k.as_deref_mut() {
                for j in 0..=i {
                    if bd[j] >= 0 {
                        k.add(bd[i] as usize, bd[j] as usize, bk[i * 6 + j])?;
                    }
                }
            }
        }
    }
    Ok(())
}

/// Largest forces of one pile (`pileForces`' values).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
pub struct PileForces {
    pub axial: f64,
    pub shear: f64,
    pub moment: f64,
}

/// Largest axial force, shear force and bending moment of each pile (per
/// pile: per metre of slope × spacing) from the displacements, in the order
/// the piles are first met (TypeScript's `Map`).
pub fn pile_forces(
    eq: &[i64],
    piles: &FePiles,
    u: &[f64],
    spacing: impl Fn(usize) -> f64,
) -> Vec<(usize, PileForces)> {
    let mut out: Vec<(usize, PileForces)> = Vec::new();
    let mut ul = [0.0f64; 6];
    let mut bd = [0i64; 6];
    for b in 0..piles.count {
        beam_dofs(eq, piles, b, &mut bd);
        let (c, s, l, ea, ei) = (
            piles.c[b],
            piles.s[b],
            piles.length[b],
            piles.ea[b],
            piles.ei[b],
        );
        let g = |i: usize| if bd[i] >= 0 { u[bd[i] as usize] } else { 0.0 };
        // local displacements
        ul[0] = c * g(0) + s * g(1);
        ul[1] = -s * g(0) + c * g(1);
        ul[2] = g(2);
        ul[3] = c * g(3) + s * g(4);
        ul[4] = -s * g(3) + c * g(4);
        ul[5] = g(5);
        let axial = (ea / l) * (ul[3] - ul[0]);
        let shear = ((12.0 * ei) / js::math::pow(l, 3.0)) * (ul[1] - ul[4])
            + ((6.0 * ei) / js::math::pow(l, 2.0)) * (ul[2] + ul[5]);
        let m1 = ((6.0 * ei) / js::math::pow(l, 2.0)) * (ul[1] - ul[4])
            + (ei / l) * (4.0 * ul[2] + 2.0 * ul[5]);
        let m2 = ((6.0 * ei) / js::math::pow(l, 2.0)) * (ul[1] - ul[4])
            + (ei / l) * (2.0 * ul[2] + 4.0 * ul[5]);
        let src = piles.source[b];
        let sp = spacing(src);
        let slot = match out.iter().position(|(k, _)| *k == src) {
            Some(i) => i,
            None => {
                out.push((src, PileForces::default()));
                out.len() - 1
            }
        };
        let prev = out[slot].1;
        out[slot].1 = PileForces {
            axial: js::math::max(prev.axial, axial.abs() * sp),
            shear: js::math::max(prev.shear, shear.abs() * sp),
            moment: js::math::max(js::math::max(prev.moment, m1.abs() * sp), m2.abs() * sp),
        };
    }
    out
}
