//! Port of packages/engine/src/model/sgi3d.ts
//!
//! 3D effects of a temporary slope after SGI's guidance (Vägledning 8,
//! Temporära slänter, 2024, section 2.1): the critical stretch of length L
//! is bounded by two plane end faces, whose undrained shear strength adds
//! resisting moment to the 2D slip surface.
//!
//!   F_P = (M_R L + 2 Σ A C c_u) / (M_E L) = F_2D + 2 Σ A C c_u / (M_E L)          (2-2)
//!   F_3D = F_2D + 0.75 (F_P − F_2D)                     infinitely overstrong     (2-3)
//!   F_3D = F_2D + (1 − F_2D,krit,min / F_2D,överstark,min) 0.75 (F_P − F_2D)  finite (2-4)
//!
//! M_E is the driving moment of the surface about its centre, M_R = F_2D M_E,
//! and Σ A C c_u the end face's moment: its area of cohesive soil times the
//! lever arm and the undrained shear strength, here ∫ c_u r dA over the face
//! (r the distance to the centre), so that c_u varying with depth and a
//! layered face need no sectors. Only cohesive soil counts in the end faces:
//! the undrained materials (φ = 0) and the undrained branch c_u of a
//! combined material (clay in a combined analysis), not friction soil, and not the materials
//! given in `excludeMaterials` (a fissured dry crust, for example). The 3D
//! factor is the smallest over the analysed circular surfaces, as the
//! surface of the smallest F_3D is generally shallower than the critical 2D
//! one (guidance, section 2.1.2). The sliding mass is the soil inside the
//! circle between its entry (or its tension crack) and its exit, as the
//! slices take it. M_E is the soil's (total) weight and the loads: forces of
//! reinforcement, piles and water in a crack or above the ground are not in
//! it, and the result warns when the model has them.

use crate::error::{EngineError, Result};
use crate::js;
use crate::math::interpolation::get_y_at_x;
use crate::math::polygon::is_point_in_polygon;
use crate::model::geometry_ops::material_layer_top_at;
use crate::model::reinforcement::effective_vertical_stress;
use crate::model::slope::{SearchPlane, Slope};
use crate::types::loads::UdlDirection;
use crate::types::material_models::MaterialModel;
use crate::types::sgi3d::{
    Sgi3dEquation, Sgi3dOptions, Sgi3dResult, Sgi3dResultOptions, Sgi3dSurface,
};
use crate::types::strength::{
    design_strength, needs_layer_top, resolve_strength, resolve_unit_weight, StrengthContext,
};
use std::f64::consts::PI;

/// The sliding mass of a surface: the soil inside its circle between where
/// it enters (or its tension crack) and where it leaves the ground, as the
/// slices take it (not where the circle dips into the ground again beyond).
fn span(p: &SearchPlane) -> [f64; 2] {
    [
        js::math::max(p.lc[0], p.crack.map_or(f64::NEG_INFINITY, |c| c[0])),
        p.rc[0],
    ]
}

/// F_3D of an analysed slope (after `analyse_slope`): the smallest over its
/// circular surfaces with a factor of safety. None when it has none.
/// Strengths and loads are design values when the slope has partial factors;
/// the end faces take the undrained strength without anisotropy (its
/// factor at α = 0, the direct shear strength).
pub fn sgi3d_factor_of_safety(
    slope: &Slope,
    options: &Sgi3dOptions,
) -> Result<Option<Sgi3dResult>> {
    let l = options.length;
    if !(l.is_finite() && l > 0.0) {
        return Err(EngineError::new(
            "The length of the critical stretch must be a positive number",
        ));
    }
    let ov = options.overstrong_f2d;
    if let Some(ov) = ov {
        if !(ov.is_finite() && ov > 0.0) {
            return Err(EngineError::new(
                "F2D of the overstrong stretches must be a positive number",
            ));
        }
    }
    let h = options.cell_size.unwrap_or(0.05);
    if !(h > 0.0) {
        return Err(EngineError::new("The cell size must be positive"));
    }
    // (a Set: in the order first given)
    let mut exclude: Vec<String> = Vec::new();
    for m in options.exclude_materials.iter().flatten() {
        if !exclude.contains(m) {
            exclude.push(m.clone());
        }
    }

    let valid: Vec<&SearchPlane> = slope
        .search()
        .iter()
        .filter(|p| p.fos.is_some_and(f64::is_finite))
        .collect();
    // composite circles (along rock or the model's base) are not circles in 3D either
    let planes: Vec<&SearchPlane> = valid
        .iter()
        .copied()
        .filter(|p| p.radius > 0.0 && p.points.is_none() && p.composite.is_none())
        .collect();
    if planes.is_empty() {
        return Ok(None);
    }
    // F_2D,krit,min: the analysis's smallest F_2D, non-circular surfaces included
    let fos_list: Vec<f64> = valid.iter().map(|p| p.fos.unwrap_or(f64::NAN)).collect();
    let f2d_critical = js::math::min_of(&fos_list);
    let k_finite = match ov {
        None => 1.0,
        Some(ov) => js::math::min(1.0, js::math::max(0.0, 1.0 - f2d_critical / ov)),
    };

    let Some(surf) = slope.surface_line_xy() else {
        return Ok(None);
    };
    // cells over the sliding masses, from the lowest circle bottom up to the ground: unit weight and the end face's c_u
    let (mut x0, mut x1, mut y0) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY);
    for p in &planes {
        let [a, b] = span(p);
        x0 = js::math::min(x0, a);
        x1 = js::math::max(x1, b);
        y0 = js::math::min(y0, p.cy - p.radius);
    }
    let mut y1 = f64::NEG_INFINITY;
    for i in 0..surf.x.len() {
        if surf.x[i] >= x0 - 1.0 && surf.x[i] <= x1 + 1.0 {
            y1 = js::math::max(y1, surf.y[i]);
        }
    }
    y1 = js::math::max(
        js::math::max(y1, get_y_at_x(&surf.x, &surf.y, x0)),
        get_y_at_x(&surf.x, &surf.y, x1),
    );
    // at most about 400 000 cells: coarser for a large model
    let h_used = js::math::max(h, (((x1 - x0) * (y1 - y0)) / 4e5).sqrt());
    let geos = slope.material_geometries();
    let f = slope.partial_factors();
    let (mut cx, mut cy, mut gam, mut cu): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut x = x0 + h_used / 2.0;
    while x < x1 {
        let y_ground = get_y_at_x(&surf.x, &surf.y, x);
        if !y_ground.is_finite() {
            x += h_used;
            continue;
        }
        let mut y = y0 + h_used / 2.0;
        while y < js::math::min(y1, y_ground) {
            let Some(geo) = geos
                .iter()
                .find(|g| is_point_in_polygon(x, y, &g.px, &g.py))
            else {
                y += h_used;
                continue;
            };
            let m = slope.material(geo.material);
            let model: &MaterialModel = &m.model;
            if matches!(
                model,
                MaterialModel::Impenetrable(_) | MaterialModel::HighStrength(_)
            ) {
                y += h_used;
                continue;
            }
            // total unit weight: saturated below the material's water line
            let mut g = resolve_unit_weight(model, m.unit_weight(), x, y);
            if let Some(sat) = model.base().unit_weight_sat {
                let wl = slope.get_water_line_for_material(Some(geo.material));
                let yw = match wl {
                    Some(wl) => get_y_at_x(&wl.x, &wl.y, x),
                    None => f64::NAN,
                };
                if yw.is_finite() && y < yw {
                    g = sat;
                }
            }
            let mut c = 0.0;
            if !exclude.contains(&m.name) {
                let y_layer_top = if needs_layer_top(model) {
                    material_layer_top_at(geos, geo.material, x, y)
                } else {
                    None
                };
                let st = resolve_strength(
                    model,
                    &StrengthContext {
                        y_bottom: y,
                        x,
                        y_ground,
                        y_layer_top,
                        alpha: 0.0,
                        effective_vertical_stress: if model.kind() == "shansep" {
                            Some(effective_vertical_stress(slope, x, y))
                        } else {
                            None
                        },
                        ..Default::default()
                    },
                )?;
                let d = design_strength(Some(model.kind()), &st, f);
                if d.undrained && d.cohesion.is_finite() {
                    c = d.cohesion;
                }
                // combined clay: the end faces of a temporary slope take its undrained strength
                else if st.is_combined == Some(true) && d.cohesion_undrained.is_finite() {
                    c = d.cohesion_undrained;
                }
            }
            cx.push(x);
            cy.push(y);
            gam.push(g);
            cu.push(c);
            y += h_used;
        }
        x += h_used;
    }
    let n = cx.len();
    let d_a = h_used * h_used;
    let qf = f.map_or(1.0, |f| f.variable_load);

    let evaluate = |p: &SearchPlane| -> Result<Option<Sgi3dSurface>> {
        let r2 = p.radius * p.radius;
        let [xa, xb] = span(p);
        let (mut me, mut mc, mut area) = (0.0, 0.0, 0.0);
        for i in 0..n {
            if cx[i] < xa || cx[i] > xb {
                continue;
            }
            let dx = cx[i] - p.cx;
            let dy = cy[i] - p.cy;
            let d2 = dx * dx + dy * dy;
            if d2 >= r2 {
                continue;
            }
            me += gam[i] * dx;
            if cu[i] > 0.0 {
                mc += cu[i] * d2.sqrt();
                area += 1.0;
            }
        }
        me *= d_a;
        mc *= d_a;
        area *= d_a;
        // loads on the ground above the surface
        for u in slope.udls() {
            let k = js::math::max(8.0, ((u.x2 - u.x1) / h_used).ceil());
            let w = (u.x2 - u.x1) / k;
            let mut j = 0.0;
            while j < k {
                let xm = u.x1 + (j + 0.5) * w;
                let dx = xm - p.cx;
                j += 1.0;
                if dx * dx >= r2 || xm < xa || xm > xb {
                    continue;
                }
                let yg = get_y_at_x(&surf.x, &surf.y, xm);
                if p.cy - (r2 - dx * dx).sqrt() < yg {
                    me += u.magnitude * qf * w * dx;
                    // a load normal to the ground: its horizontal part p·dy at the ground
                    if u.direction == UdlDirection::Normal {
                        let sl = (get_y_at_x(&surf.x, &surf.y, xm + w / 2.0)
                            - get_y_at_x(&surf.x, &surf.y, xm - w / 2.0))
                            / w;
                        me -= u.magnitude * qf * w * sl * (p.cy - yg);
                    }
                }
            }
        }
        for ll in slope.line_loads() {
            let dx = ll.x - p.cx;
            if dx * dx < r2
                && ll.x >= xa
                && ll.x <= xb
                && p.cy - (r2 - dx * dx).sqrt() < get_y_at_x(&surf.x, &surf.y, ll.x)
            {
                me += ll.magnitude * js::math::cos((ll.angle * PI) / 180.0) * qf * dx;
            }
        }
        me = me.abs();
        if !(me > 0.0) {
            return Ok(None);
        }
        let f2d = p.fos.unwrap_or(f64::NAN);
        let fp = f2d + (2.0 * mc) / (l * me);
        let f3d = f2d + k_finite * 0.75 * (fp - f2d);
        let (mcx, mcy, mr) = slope.to_model_circle(p)?;
        Ok(Some(Sgi3dSurface {
            cx: mcx,
            cy: mcy,
            radius: mr,
            f2d,
            driving_moment: me,
            end_face_area: area,
            end_face_moment: mc,
            fp,
            f3d,
        }))
    };

    // F_3D ≥ F_2D: once a surface's F_2D is past the smallest F_3D found, none further is lower
    let mut sorted = planes.clone();
    js::array::sort_by(&mut sorted, |a, b| {
        a.fos.unwrap_or(f64::NAN) - b.fos.unwrap_or(f64::NAN)
    });
    let mut best: Option<Sgi3dSurface> = None;
    for p in sorted {
        if let Some(b) = &best {
            if p.fos.unwrap_or(f64::NAN) >= b.f3d {
                break;
            }
        }
        let s = evaluate(p)?;
        if let Some(s) = s {
            if best.as_ref().is_none_or(|b| s.f3d < b.f3d) {
                best = Some(s);
            }
        }
    }
    let Some(best) = best else {
        return Ok(None);
    };
    let mut warnings: Vec<String> = Vec::new();
    if best.f3d > 1.25 * f2d_critical {
        warnings.push("F3D is more than 25 % above the critical F2D: SGI's guidance asks for the 3D factor to be judged with care (section 2.1.2).".to_string());
    }
    if valid
        .iter()
        .any(|p| p.points.is_some() || p.composite.is_some())
    {
        warnings.push("Non-circular and composite surfaces are not included in the 3D factor (their F2D counts as F2D,krit,min).".to_string());
    }
    // what the guidance's M_E (the soil's weight and the loads) leaves out, though the 2D factor has it
    let mut left: Vec<&str> = Vec::new();
    if !slope.reinforcements().is_empty() {
        left.push("reinforcement");
    }
    if !slope.piles().is_empty() {
        left.push("piles");
    }
    if slope.tension_crack_water() > 0.0 && planes.iter().any(|p| p.crack.is_some()) {
        left.push("water in the tension crack");
    }
    if let Some(wl) = slope.water_rl_xy() {
        if wl
            .x
            .iter()
            .enumerate()
            .any(|(i, &x)| x >= x0 && x <= x1 && wl.y[i] > get_y_at_x(&surf.x, &surf.y, x) + 1e-6)
        {
            left.push("free water above the ground");
        }
    }
    if !left.is_empty() {
        warnings.push(format!(
            "The driving moment M_E is the soil's weight and the loads; {} are not in it, though the 2D factor includes them.",
            left.join(", ")
        ));
    }
    let names: Vec<&str> = geos
        .iter()
        .map(|g| slope.material(g.material).name.as_str())
        .collect();
    let unknown: Vec<&str> = exclude
        .iter()
        .map(String::as_str)
        .filter(|n| !names.contains(n))
        .collect();
    if !unknown.is_empty() {
        warnings.push(format!(
            "Not in the model, so not left out of the end faces: {}.",
            unknown.join(", ")
        ));
    }
    Ok(Some(Sgi3dResult {
        factor_of_safety: best.f3d,
        f2d_critical,
        critical: best,
        equation: if ov.is_none() {
            Sgi3dEquation::Eq2_3
        } else {
            Sgi3dEquation::Eq2_4
        },
        options: Sgi3dResultOptions {
            length: l,
            overstrong_f2d: ov,
            exclude_materials: exclude,
        },
        warnings,
    }))
}
