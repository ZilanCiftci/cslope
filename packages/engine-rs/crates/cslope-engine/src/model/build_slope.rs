//! Port of packages/engine/src/model/build-slope.ts
//!
//! Build a Slope model from a serialized SlopeDefinition DTO.
//!
//! Used by the Web Worker to reconstruct the model from UI data,
//! and also available for testing without worker context.

use crate::error::{EngineError, Result};
use crate::js;
use crate::model::search::add_single_circular_plane;
use crate::model::slope::{AnalysisLimitsPatch, Pt, SearchPlane, Slope};
use crate::model::surface::{default_axis_point, fit_polyline_to_ground, is_admissible_polyline};
use crate::model::waternet::{HeadLine, ReferenceLine, Waternet};
use crate::types::analysis::{CustomPlaneKind, CustomPlaneRef, SurfaceRejection, WaterTableInput};
use crate::types::loads::{LineLoad, LineLoadParams, Udl, UdlParams};
use crate::types::material::{Material, MaterialId, MaterialParams};
use crate::types::slope_definition::{
    material_model_of, SlopeDefinition, WaterTableDefinition, WaterTableMode, WaterTableValue,
};
use crate::types::validation::try_validate_material_model;

/// Compute the midpoint along a polyline at half of its total arc length.
/// The result always lies ON the polyline and is robust for any number of
/// vertices — including 2-point boundaries where the old vertex-index
/// approach would pick an endpoint that might lie outside the slope.
fn polyline_midpoint(coords: &[Pt]) -> Pt {
    if coords.len() == 1 {
        return coords[0];
    }

    // Compute cumulative segment lengths
    let mut total_len = 0.0;
    let mut seg_lens: Vec<f64> = Vec::new();
    for i in 1..coords.len() {
        let dx = coords[i][0] - coords[i - 1][0];
        let dy = coords[i][1] - coords[i - 1][1];
        let len = (dx * dx + dy * dy).sqrt();
        seg_lens.push(len);
        total_len += len;
    }

    // Walk along the polyline to the half-length point
    let half_len = total_len / 2.0;
    let mut accum = 0.0;
    for (i, &seg) in seg_lens.iter().enumerate() {
        if accum + seg >= half_len {
            let t = (half_len - accum) / seg;
            return [
                coords[i][0] + t * (coords[i + 1][0] - coords[i][0]),
                coords[i][1] + t * (coords[i + 1][1] - coords[i][1]),
            ];
        }
        accum += seg;
    }

    // Fallback: return last point (TypeScript returns undefined for no points)
    coords[coords.len() - 1]
}

/// `materialsByName.get(name)` (the last material of a name wins, as `Map.set`).
fn by_name(materials: &[(String, MaterialId)], name: &str) -> Option<MaterialId> {
    materials
        .iter()
        .rev()
        .find(|(n, _)| n == name)
        .map(|(_, id)| *id)
}

/// Reconstruct a Slope model from a serialized SlopeDefinition DTO.
pub fn build_slope(def: &SlopeDefinition) -> Result<Slope> {
    let mut slope = Slope::new();

    // Materials — build Material instances first so we can assign the first
    // one to the external boundary (set_external_boundary uses materials[0]).
    // (TypeScript's check that `materials` is an array is serde's here; an
    // absent list is empty.)
    let mut materials_by_name: Vec<(String, MaterialId)> = Vec::new();
    if def.materials.is_empty() {
        return Err(EngineError::new("The model needs at least one material."));
    }
    for m in &def.materials {
        let model = material_model_of(m)?;

        // Validate the model before constructing the Material.
        let validation_errors = try_validate_material_model(&model)?;
        if !validation_errors.is_empty() {
            return Err(EngineError::new(format!(
                "Material \"{}\" has invalid model:\n  – {}",
                m.name,
                validation_errors.join("\n  – ")
            )));
        }

        let mat = Material::new(MaterialParams {
            name: Some(m.name.clone()),
            color: m.color.clone(),
            model: Some(model),
            ..Default::default()
        })?;
        let id = slope.insert_material(mat);
        materials_by_name.push((m.name.clone(), id));
    }

    // External boundary — assign the first defined material so it isn't the
    // placeholder default Material (c=2, phi=35).
    if let Some(first_mat) = by_name(&materials_by_name, &def.materials[0].name) {
        slope.register_material(first_mat);
    }
    slope.set_external_boundary(&def.coordinates)?;
    // A canonical definition of a right-to-left slope is mirrored model
    // space; options given in model space (interslice data points) follow.
    slope.set_mirrored(def.orientation == Some(crate::model::canonical::SlopeOrientation::Rtl));

    // Material boundaries — split the geometry first, then assign materials
    let has_region_assignments = def
        .region_assignments
        .as_ref()
        .is_some_and(|r| !r.is_empty());
    if let Some(boundaries) = def.material_boundaries.as_ref().filter(|b| !b.is_empty()) {
        // Cut the slope by all boundaries at once, exactly as the canvas
        // computes its regions (order independent, no re-splitting). Lines
        // with fewer than two points are skipped there; all are passed so that
        // slope.dangling_boundaries indexes def.material_boundaries.
        let lines: Vec<Vec<Pt>> = boundaries.iter().map(|b| b.coordinates.clone()).collect();
        slope.set_material_boundaries(&lines)?;

        if !has_region_assignments {
            // Legacy boundary-name assignment (materialBoundaries carry materialName)
            for b in boundaries {
                if let Some(mat) = by_name(&materials_by_name, &b.material_name) {
                    if b.coordinates.len() >= 2 {
                        let mid = polyline_midpoint(&b.coordinates);
                        slope.assign_material([mid[0], mid[1] - 0.01], mat)?;
                    }
                }
            }

            let top_mat_name = def
                .top_region_material_name
                .clone()
                .unwrap_or_else(|| def.materials[0].name.clone());
            if let Some(top_mat) = by_name(&materials_by_name, &top_mat_name) {
                let first_b = &boundaries[0];
                // (TypeScript's midpoint of a boundary without points is
                // undefined, and reading it throws)
                if first_b.coordinates.is_empty() {
                    return Err(EngineError::new(
                        "Cannot read properties of undefined (reading '0')",
                    ));
                }
                let mid = polyline_midpoint(&first_b.coordinates);
                slope.assign_material([mid[0], mid[1] + 0.01], top_mat)?;
            }
        }
    }

    // Point-based assignment: each entry maps a representative point to a
    // material, assigned to whichever region contains the point. This also
    // applies to a model without interior boundaries (a single region).
    // When several points fall in the same region the FIRST one wins (same
    // rule as the desktop canvas), so apply them in reverse order.
    if let Some(assignments) = def.region_assignments.as_ref().filter(|r| !r.is_empty()) {
        for ra in assignments.iter().rev() {
            // An unknown name left the region with the first material.
            let Some(mat) = by_name(&materials_by_name, &ra.material_name) else {
                return Err(EngineError::new(format!(
                    "Region assigned to an unknown material \"{}\".",
                    ra.material_name
                )));
            };
            slope.assign_material(ra.point, mat)?;
        }
    }

    // Water table
    if let Some(WaterTableDefinition {
        mode,
        value,
        follow_boundary,
    }) = &def.water_table
    {
        let follow_boundary = *follow_boundary;
        match (mode, value) {
            (WaterTableMode::Height, WaterTableValue::Level(v)) => {
                slope.set_water_table(&WaterTableInput::Height {
                    height: *v,
                    follow_boundary,
                })?;
            }
            (WaterTableMode::Depth, WaterTableValue::Level(v)) => {
                slope.set_water_table(&WaterTableInput::Depth {
                    depth: *v,
                    follow_boundary,
                })?;
            }
            (WaterTableMode::Custom, WaterTableValue::Points(points)) => {
                slope.set_water_table(&WaterTableInput::Custom {
                    coordinates: points.clone(),
                    follow_boundary,
                })?;
            }
            // `Array.isArray(wt.value)`: a list that is not of [x, y] points
            // goes to setWaterTable too, which reads x and y of each entry
            // (an entry that is not a pair of finite numbers fails its check)
            (WaterTableMode::Custom, WaterTableValue::Other(serde_json::Value::Array(list))) => {
                use crate::types::json::{js_array, js_number};
                let coordinates = list
                    .iter()
                    .map(|c| {
                        let at = |i: usize| {
                            js_array(Some(c))
                                .and_then(|c| js_number(c.get(i)))
                                .unwrap_or(f64::NAN)
                        };
                        [at(0), at(1)]
                    })
                    .collect();
                slope.set_water_table(&WaterTableInput::Custom {
                    coordinates,
                    follow_boundary,
                })?;
            }
            // another mode, or a value that does not fit the mode: no water table
            _ => {}
        }
    }

    // Per-material water tables
    if let Some(tables) = def.water_tables.as_ref().filter(|t| !t.is_empty()) {
        for wt in tables {
            slope.set_water_table_by_id(
                &wt.id,
                &wt.coordinates,
                wt.follow_boundary.unwrap_or(true),
            )?;
        }
        for m in &def.materials {
            if let (Some(mat), Some(id)) = (by_name(&materials_by_name, &m.name), &m.water_table_id)
            {
                slope.assign_material_water_table(mat, id.as_deref());
            }
        }
    }

    // UDLs
    if let Some(udls) = &def.udls {
        for (i, u) in udls.iter().enumerate() {
            for e in u.excess_pore_pressure.iter().flatten() {
                if !(e.ratio.is_finite() && e.ratio >= 0.0 && e.ratio <= 1.0) {
                    return Err(EngineError::new(format!(
                        "Distributed load {}: the part of the load carried by excess pore pressure in \"{}\" must be between 0 and 1.",
                        i + 1,
                        e.material
                    )));
                }
            }
        }
        slope.set_udls(
            udls.iter()
                .map(|u| {
                    Udl::new(UdlParams {
                        magnitude: u.magnitude,
                        x1: u.x1,
                        x2: u.x2,
                        color: None,
                        direction: u.direction,
                        excess_pore_pressure: u.excess_pore_pressure.clone(),
                    })
                })
                .collect(),
        );
    }

    // Line loads
    if let Some(lls) = &def.line_loads {
        slope.set_line_loads(
            lls.iter()
                .map(|ll| {
                    LineLoad::new(LineLoadParams {
                        magnitude: ll.magnitude,
                        x: ll.x,
                        // `...(ll.angle ? { angle } : {})`: 0 and NaN are left out
                        angle: ll.angle.filter(|a| *a != 0.0 && !a.is_nan()),
                        y: ll.y,
                        color: None,
                    })
                })
                .collect(),
        );
    }

    // Reinforcement
    if let Some(r) = def.reinforcements.as_ref().filter(|r| !r.is_empty()) {
        slope.set_reinforcements(r)?;
    }

    if let Some(p) = def.piles.as_ref().filter(|p| !p.is_empty()) {
        slope.set_piles(p)?;
    }

    // Analysis limits
    if let Some(limits) = &def.analysis_limits {
        slope.set_analysis_limits(&AnalysisLimitsPatch::from(limits));
    }

    // Custom search planes
    // Each plane added is marked with its place in the definition, and one
    // that gives no surface is recorded with the reason, for the result.
    if let Some(planes) = &def.custom_search_planes {
        for (index, p) in planes.iter().enumerate() {
            if ![p.cx, p.cy, p.radius].iter().all(|v| v.is_finite()) || p.radius <= 0.0 {
                return Err(EngineError::new(format!(
                    "Custom search circle ({}, {}, R {}) needs a finite centre and a positive radius.",
                    js::num::to_string(p.cx),
                    js::num::to_string(p.cy),
                    js::num::to_string(p.radius)
                )));
            }
            let custom = CustomPlaneRef {
                kind: CustomPlaneKind::Circle,
                index,
            };
            let before = slope.individual_planes().len();
            add_single_circular_plane(&mut slope, p.cx, p.cy, p.radius)?;
            if slope.individual_planes().len() > before {
                slope.mark_last_individual_plane(custom);
            } else {
                slope.add_custom_plane_rejection(custom, SurfaceRejection::NoGroundCrossing);
            }
        }
    }

    if let Some(objects) = def.block_search_objects.as_ref().filter(|o| !o.is_empty()) {
        let points: Vec<Vec<Pt>> = objects.iter().map(|o| o.points.clone()).collect();
        slope.set_block_search_objects(&points)?;
    }

    // Custom non-circular surfaces
    if let Some(surfaces) = &def.custom_surfaces {
        for (index, surface) in surfaces.iter().enumerate() {
            let custom = CustomPlaneRef {
                kind: CustomPlaneKind::Polyline,
                index,
            };
            // Like a custom circle that misses the ground, a polyline that does
            // not cut through the soil or leaves the model is no surface.
            let fitted = fit_polyline_to_ground(&slope, &surface.points)
                .filter(|points| is_admissible_polyline(&slope, points, f64::INFINITY));
            let Some(points) = fitted else {
                slope.add_custom_plane_rejection(custom, SurfaceRejection::NotThroughSoil);
                continue;
            };
            let [cx, cy] = surface.axis.unwrap_or_else(|| default_axis_point(&points));
            slope.add_individual_planes(vec![SearchPlane {
                lc: points[0],
                rc: points[points.len() - 1],
                cx,
                cy,
                radius: 0.0,
                points: Some(points),
                fos: None,
                slices: None,
                custom_plane: Some(custom),
                ..Default::default()
            }]);
        }
    }

    // Custom-planes-only mode: no search surfaces are generated
    if def.custom_planes_only == Some(true) {
        slope.set_custom_planes_only(true);
    }

    // An earlier stage, for the stress history of SHANSEP materials
    if let Some(earlier) = &def.earlier_stage {
        let stage = build_slope(&SlopeDefinition {
            custom_search_planes: None,
            custom_surfaces: None,
            custom_planes_only: Some(true),
            ..(**earlier).clone()
        })?;
        slope.set_earlier_stage(Some(stage));
    }

    // Pore pressure from head lines and reference lines (x increasing)
    if let Some(wn) = &def.waternet {
        let inc = |pts: &[Pt]| {
            let mut v = pts.to_vec();
            js::array::sort_by(&mut v, |a, b| a[0] - b[0]);
            v
        };
        slope.set_waternet(Some(Waternet::new(
            wn.head_lines
                .iter()
                .map(|h| HeadLine {
                    id: h.id.clone(),
                    points: inc(&h.points),
                })
                .collect(),
            wn.reference_lines
                .iter()
                .map(|r| ReferenceLine {
                    points: inc(&r.points),
                    ..r.clone()
                })
                .collect(),
            wn.phreatic_line_id.clone(),
        )));
    }

    // Rapid drawdown: the same model with the water before drawdown, for
    // all materials (model/drawdown.ts); its options follow the slope's.
    if let Some(rd) = def
        .rapid_drawdown
        .as_ref()
        .filter(|rd| rd.water_before.len() >= 2)
    {
        let before = build_slope(&SlopeDefinition {
            water_table: Some(WaterTableDefinition {
                mode: WaterTableMode::Custom,
                value: WaterTableValue::Points(rd.water_before.clone()),
                follow_boundary: Some(false),
            }),
            water_tables: Some(Vec::new()),
            materials: def
                .materials
                .iter()
                .map(
                    |m| crate::types::slope_definition::SlopeMaterialDefinition {
                        water_table_id: None,
                        ..m.clone()
                    },
                )
                .collect(),
            rapid_drawdown: None,
            // the water before drawdown is waterBefore alone (a waternet would
            // keep the pore pressures after drawdown); the earlier stage only
            // matters for the slope after drawdown (its SHANSEP bases)
            waternet: None,
            earlier_stage: None,
            custom_search_planes: None,
            custom_surfaces: None,
            ..def.clone()
        })?;
        slope.set_drawdown_before(Some(before))?;
    }

    Ok(slope)
}
