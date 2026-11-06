//! Port of packages/engine/src/model/canonical.ts
//!
//! Canonical orientation: a right-to-left slope is mirrored in x so that the
//! engine always analyses sliding towards +x, and results are mirrored back.

use crate::error::Result;
use crate::js;
use crate::model::waternet::{HeadLine, ReferenceLine, Waternet};
use crate::types::analysis::{
    AnalysisLimits, AnalysisResult, Crack, CustomSurfaceResult, FemResultSummary, SliceData,
    SlipSurfaceResult,
};
use crate::types::material_models::MaterialModel;
use crate::types::reinforcement::{Pile, Reinforcement, ReinforcementForce};
use crate::types::slope_definition::{
    with_material_model, BlockSearchObject, CustomSearchPlane, CustomSurface, LineLoadDefinition,
    MaterialBoundary, RapidDrawdown, RegionAssignment, SlopeDefinition, SlopeMaterialDefinition,
    UdlDefinition, WaterTableDefinition, WaterTableEntry, WaterTableMode, WaterTableValue,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SlopeOrientation {
    Ltr,
    Rtl,
}

pub fn mirror_x(x: f64, x_min: f64, x_max: f64) -> f64 {
    x_min + x_max - x
}

pub fn mirror_point(point: [f64; 2], x_min: f64, x_max: f64) -> [f64; 2] {
    [mirror_x(point[0], x_min, x_max), point[1]]
}

pub fn mirror_points(points: &[[f64; 2]], x_min: f64, x_max: f64) -> Vec<[f64; 2]> {
    points
        .iter()
        .map(|&point| mirror_point(point, x_min, x_max))
        .collect()
}

/// [min x, max x] of the coordinates ([+∞, −∞] for none).
pub fn get_domain_x(coordinates: &[[f64; 2]]) -> [f64; 2] {
    let xs: Vec<f64> = coordinates.iter().map(|c| c[0]).collect();
    [js::math::min_of(&xs), js::math::max_of(&xs)]
}

fn get_side_crest_y(coordinates: &[[f64; 2]], side_x: f64) -> f64 {
    let tolerance = 1e-9;
    let mut crest_y = f64::NEG_INFINITY;
    for &[x, y] in coordinates {
        if (x - side_x).abs() <= tolerance {
            crest_y = js::math::max(crest_y, y);
        }
    }
    crest_y
}

pub fn infer_orientation_from_coordinates(coordinates: &[[f64; 2]]) -> SlopeOrientation {
    if coordinates.len() < 2 {
        return SlopeOrientation::Ltr;
    }
    let [x_min, x_max] = get_domain_x(coordinates);
    let left_crest_y = get_side_crest_y(coordinates, x_min);
    let right_crest_y = get_side_crest_y(coordinates, x_max);
    if right_crest_y > left_crest_y {
        SlopeOrientation::Rtl
    } else {
        SlopeOrientation::Ltr
    }
}

pub fn resolve_orientation(
    orientation: Option<SlopeOrientation>,
    coordinates: &[[f64; 2]],
) -> SlopeOrientation {
    match orientation {
        Some(o) => o,
        None => infer_orientation_from_coordinates(coordinates),
    }
}

fn mirror_range(left: f64, right: f64, x_min: f64, x_max: f64) -> [f64; 2] {
    let a = mirror_x(left, x_min, x_max);
    let b = mirror_x(right, x_min, x_max);
    [js::math::min(a, b), js::math::max(a, b)]
}

pub fn mirror_limits(limits: &AnalysisLimits, x_min: f64, x_max: f64) -> AnalysisLimits {
    let [entry_left_x, entry_right_x] =
        mirror_range(limits.entry_left_x, limits.entry_right_x, x_min, x_max);
    let [exit_left_x, exit_right_x] =
        mirror_range(limits.exit_left_x, limits.exit_right_x, x_min, x_max);

    AnalysisLimits {
        entry_left_x,
        entry_right_x,
        exit_left_x,
        exit_right_x,
    }
}

/// The definition in canonical orientation (sliding towards +x), every
/// material by its model. `mirror_range`: the mirror axis' x range
/// (default: the definition's own); an earlier stage takes the model's.
pub fn to_canonical_slope_definition(
    slope_definition: &SlopeDefinition,
    mirror_range: Option<[f64; 2]>,
) -> Result<SlopeDefinition> {
    let orientation =
        resolve_orientation(slope_definition.orientation, &slope_definition.coordinates);
    // an earlier stage takes the model's orientation and mirror axis (its
    // own extent may differ: outside it, it gives no stress)
    if let Some(earlier_stage) = &slope_definition.earlier_stage {
        let axis = mirror_range.unwrap_or_else(|| get_domain_x(&slope_definition.coordinates));
        let rest = SlopeDefinition {
            earlier_stage: None,
            orientation: Some(orientation),
            ..slope_definition.clone()
        };
        let stage = SlopeDefinition {
            orientation: Some(orientation),
            ..(**earlier_stage).clone()
        };
        return Ok(SlopeDefinition {
            earlier_stage: Some(Box::new(to_canonical_slope_definition(&stage, Some(axis))?)),
            ..to_canonical_slope_definition(&rest, Some(axis))?
        });
    }

    // Every material by its model (older definitions give flat fields).
    let materials = slope_definition
        .materials
        .iter()
        .map(with_material_model)
        .collect::<Result<Vec<SlopeMaterialDefinition>>>()?;
    if orientation == SlopeOrientation::Ltr {
        return Ok(SlopeDefinition {
            orientation: Some(orientation),
            materials,
            ..slope_definition.clone()
        });
    }

    let [x_min, x_max] =
        mirror_range.unwrap_or_else(|| get_domain_x(&slope_definition.coordinates));
    let d = slope_definition;
    let mx = |x: f64| mirror_x(x, x_min, x_max);
    let mp = |p: &[[f64; 2]]| mirror_points(p, x_min, x_max);

    Ok(SlopeDefinition {
        orientation: Some(orientation),
        coordinates: mp(&d.coordinates),
        // Spatially varying strength is given at model-space points.
        // (also in the strength above the water, a model of its own)
        materials: materials
            .into_iter()
            .map(|m| SlopeMaterialDefinition {
                model: m
                    .model
                    .as_ref()
                    .map(|model| mirror_model(model, x_min, x_max)),
                ..m
            })
            .collect(),
        material_boundaries: d.material_boundaries.as_ref().map(|bs| {
            bs.iter()
                .map(|b| MaterialBoundary {
                    coordinates: mp(&b.coordinates),
                    ..b.clone()
                })
                .collect()
        }),
        water_table: d
            .water_table
            .as_ref()
            .map(|wt| match (&wt.mode, &wt.value) {
                (WaterTableMode::Custom, WaterTableValue::Points(points)) => WaterTableDefinition {
                    value: WaterTableValue::Points(mp(points)),
                    ..wt.clone()
                },
                _ => wt.clone(),
            }),
        water_tables: d.water_tables.as_ref().map(|wts| {
            wts.iter()
                .map(|wt| WaterTableEntry {
                    coordinates: mp(&wt.coordinates),
                    ..wt.clone()
                })
                .collect()
        }),
        waternet: d.waternet.as_ref().map(|wn| {
            Waternet::new(
                wn.head_lines
                    .iter()
                    .map(|h| HeadLine {
                        id: h.id.clone(),
                        points: mp(&h.points),
                    })
                    .collect(),
                wn.reference_lines
                    .iter()
                    .map(|r| ReferenceLine {
                        points: mp(&r.points),
                        ..r.clone()
                    })
                    .collect(),
                wn.phreatic_line_id.clone(),
            )
        }),
        rapid_drawdown: d.rapid_drawdown.as_ref().map(|r| RapidDrawdown {
            water_before: mp(&r.water_before),
        }),
        udls: d.udls.as_ref().map(|udls| {
            udls.iter()
                .map(|udl| {
                    let x1 = mx(udl.x2);
                    let x2 = mx(udl.x1);
                    UdlDefinition {
                        x1: js::math::min(x1, x2),
                        x2: js::math::max(x1, x2),
                        ..udl.clone()
                    }
                })
                .collect()
        }),
        line_loads: d.line_loads.as_ref().map(|lls| {
            lls.iter()
                .map(|ll| LineLoadDefinition {
                    x: mx(ll.x),
                    // `lineLoad.angle ? { angle: -angle } : {}`: 0 and NaN are kept
                    angle: match ll.angle {
                        Some(a) if a != 0.0 && !a.is_nan() => Some(-a),
                        other => other,
                    },
                    ..ll.clone()
                })
                .collect()
        }),
        piles: d.piles.as_ref().map(|ps| {
            ps.iter()
                .map(|p| Pile {
                    x1: mx(p.x1),
                    x2: mx(p.x2),
                    ..p.clone()
                })
                .collect()
        }),
        reinforcements: d.reinforcements.as_ref().map(|rs| {
            rs.iter()
                .map(|r| Reinforcement {
                    x1: mx(r.x1),
                    x2: mx(r.x2),
                    ..r.clone()
                })
                .collect()
        }),
        analysis_limits: d
            .analysis_limits
            .as_ref()
            .map(|l| mirror_limits(l, x_min, x_max)),
        region_assignments: d.region_assignments.as_ref().map(|ras| {
            ras.iter()
                .map(|ra| RegionAssignment {
                    point: [mx(ra.point[0]), ra.point[1]],
                    ..ra.clone()
                })
                .collect()
        }),
        custom_search_planes: d.custom_search_planes.as_ref().map(|ps| {
            ps.iter()
                .map(|p| CustomSearchPlane { cx: mx(p.cx), ..*p })
                .collect()
        }),
        custom_surfaces: d.custom_surfaces.as_ref().map(|ss| {
            ss.iter()
                .map(|s| CustomSurface {
                    points: mp(&s.points),
                    axis: s.axis.map(|a| mirror_point(a, x_min, x_max)),
                })
                .collect()
        }),
        custom_planes_only: d.custom_planes_only,
        block_search_objects: d.block_search_objects.as_ref().map(|os| {
            os.iter()
                .map(|o| BlockSearchObject {
                    points: mp(&o.points),
                })
                .collect()
        }),
        ..d.clone()
    })
}

/// Canonical definition for sliding in the opposite direction to that of
/// `canonical` (itself a canonical definition), without the model's search
/// limits and custom surfaces, which belong to its own direction. Map its
/// results back with the returned definition. The block search objects are
/// kept: they mark where the surface may run, in either direction.
pub fn opposite_direction_definition(canonical: &SlopeDefinition) -> Result<SlopeDefinition> {
    let orientation = resolve_orientation(canonical.orientation, &canonical.coordinates);
    let mirrored = to_canonical_slope_definition(
        &SlopeDefinition {
            orientation: Some(SlopeOrientation::Rtl),
            analysis_limits: None,
            custom_search_planes: None,
            custom_surfaces: None,
            custom_planes_only: Some(false),
            ..canonical.clone()
        },
        None,
    )?;
    Ok(SlopeDefinition {
        orientation: Some(if orientation == SlopeOrientation::Ltr {
            SlopeOrientation::Rtl
        } else {
            SlopeOrientation::Ltr
        }),
        ..mirrored
    })
}

/// A result of the canonical definition in the model's space.
pub fn map_analysis_result_to_model_space(
    analysis_result: &AnalysisResult,
    canonical_slope_definition: &SlopeDefinition,
) -> AnalysisResult {
    let orientation = resolve_orientation(
        canonical_slope_definition.orientation,
        &canonical_slope_definition.coordinates,
    );

    if orientation == SlopeOrientation::Ltr {
        return analysis_result.clone();
    }

    let [x_min, x_max] = get_domain_x(&canonical_slope_definition.coordinates);
    let mx = |x: f64| mirror_x(x, x_min, x_max);
    let mp = |p: [f64; 2]| mirror_point(p, x_min, x_max);
    let r = analysis_result;
    let mirror_surface = |s: &SlipSurfaceResult| SlipSurfaceResult {
        cx: mx(s.cx),
        entry_point: mp(s.entry_point),
        exit_point: mp(s.exit_point),
        points: s
            .points
            .as_ref()
            .map(|ps| ps.iter().map(|&p| mp(p)).collect()),
        ..s.clone()
    };

    AnalysisResult {
        critical_surface: r.critical_surface.as_ref().map(|s| SlipSurfaceResult {
            cx: mx(s.cx),
            entry_point: mp(s.entry_point),
            exit_point: mp(s.exit_point),
            points: s
                .points
                .as_ref()
                .map(|ps| ps.iter().map(|&p| mp(p)).collect()),
            reinforcement_forces: s.reinforcement_forces.as_ref().map(|fs| {
                fs.iter()
                    .map(|f| ReinforcementForce {
                        x: mx(f.x),
                        fx: -f.fx,
                        ..f.clone()
                    })
                    .collect()
            }),
            crack: s.crack.map(|c| Crack { x: mx(c.x), ..c }),
            ..s.clone()
        }),
        all_surfaces: r.all_surfaces.iter().map(mirror_surface).collect(),
        custom_surfaces: r.custom_surfaces.as_ref().map(|cs| {
            cs.iter()
                .map(|c| CustomSurfaceResult {
                    surface: c.surface.as_ref().map(mirror_surface),
                    ..c.clone()
                })
                .collect()
        }),
        critical_slices: r
            .critical_slices
            .iter()
            .map(|slice| {
                let mirrored_left = mx(slice.x_left);
                let mirrored_right = mx(slice.x_right);
                SliceData {
                    x: mx(slice.x),
                    x_left: js::math::min(mirrored_left, mirrored_right),
                    x_right: js::math::max(mirrored_left, mirrored_right),
                    ..slice.clone()
                }
            })
            .collect(),
        fem: r.fem.as_ref().map(|f| mirror_fem_summary(f, x_min, x_max)),
        ..r.clone()
    }
}

/// A finite element summary mirrored in x: the nodes' x, the x component of
/// their displacements, and each element's node order (to keep it
/// counter-clockwise); the per-element fields and the factors are the same.
/// (`run_fem_summary` gives its summary in model space already; this maps
/// a summary that a result in canonical space carries.)
pub fn mirror_fem_summary(fem: &FemResultSummary, x_min: f64, x_max: f64) -> FemResultSummary {
    let mut triangles = fem.triangles.clone();
    for t in triangles.chunks_exact_mut(3) {
        t.swap(1, 2);
    }
    FemResultSummary {
        x: fem.x.iter().map(|&x| mirror_x(x, x_min, x_max)).collect(),
        displacement: fem
            .displacement
            .iter()
            .enumerate()
            .map(|(i, &v)| if i % 2 == 0 { -v } else { v })
            .collect(),
        triangles,
        ..fem.clone()
    }
}

/// A material model with its spatially varying strength points mirrored
/// in x, its strength above the water too (a copy of the model when it
/// has none).
fn mirror_model(model: &MaterialModel, x_min: f64, x_max: f64) -> MaterialModel {
    let mut own = model.clone();
    if let MaterialModel::SpatialMohrCoulomb(m) = &mut own {
        for p in m.data_points.iter_mut() {
            p[0] = mirror_x(p[0], x_min, x_max);
        }
    }
    let above = model
        .above_water()
        .map(|a| Box::new(mirror_model(a, x_min, x_max)));
    own.base_mut().above_water = above;
    own
}
