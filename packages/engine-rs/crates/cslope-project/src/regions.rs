//! The material of each region written out (issue #85): the app runs a
//! model where a region has no assignment (it takes the first material),
//! which `validate_definition` reports as an error for a hand-written
//! definition (`unassigned-region`, `missing-region-assignments`). For
//! `cslope export`, [`assign_unassigned_regions`] adds the assignment the
//! engine applies implicitly, so the document states what the app runs and
//! passes validation. Not used by `model_to_definition` (the app's
//! definition, held to the app by the golden corpus).
//!
//! The regions are the validation's: the outline cut by the boundaries
//! (`polygonize_regions_detailed`, each face as one ring with its holes);
//! a region is assigned when the first region containing an assignment's
//! point is it. The implicit material is the engine's (`build_slope`):
//! the outline's material, the first one, in every region no assignment
//! names; without any assignments, the legacy rule puts
//! `topRegionMaterialName` above the first boundary, which is left alone
//! (no change) when it names another material.

use cslope_engine::math::polygon::is_point_in_polygon;
use cslope_engine::model::geometry_ops::{keyhole_ring, polygonize_regions_detailed};
use cslope_engine::types::{RegionAssignment, SlopeDefinition};

type Pt = [f64; 2];

fn in_polygon(p: Pt, ring: &[Pt]) -> bool {
    let xs: Vec<f64> = ring.iter().map(|c| c[0]).collect();
    let ys: Vec<f64> = ring.iter().map(|c| c[1]).collect();
    is_point_in_polygon(p[0], p[1], &xs, &ys)
}

/// Whether `p` lies on the ring's edges (within `tol`), as the validation tests it.
fn on_ring(p: Pt, ring: &[Pt], tol: f64) -> bool {
    (0..ring.len()).any(|i| {
        let a = ring[i];
        let b = ring[(i + 1) % ring.len()];
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len2 = dx * dx + dy * dy;
        let t = if len2 > 0.0 {
            (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let (qx, qy) = (a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
        (qx * qx + qy * qy).sqrt() <= tol
    })
}

/// The regions of a definition as the validation computes them, or None
/// when the boundaries cannot be split.
fn regions(def: &SlopeDefinition) -> Option<Vec<Vec<Pt>>> {
    let boundaries = def.material_boundaries.as_deref().unwrap_or(&[]);
    if boundaries.is_empty() {
        return Some(vec![def.coordinates.clone()]);
    }
    let px: Vec<f64> = def.coordinates.iter().map(|p| p[0]).collect();
    let py: Vec<f64> = def.coordinates.iter().map(|p| p[1]).collect();
    let lines: Vec<Vec<Pt>> = boundaries.iter().map(|b| b.coordinates.clone()).collect();
    match polygonize_regions_detailed(&px, &py, &lines) {
        Ok(split) if !split.failed => Some(
            split
                .faces
                .iter()
                .map(|f| keyhole_ring(&f.outer, &f.holes))
                .collect(),
        ),
        _ => None,
    }
}

/// The first region that contains `p`.
fn region_of(p: Pt, regions: &[Vec<Pt>]) -> Option<usize> {
    regions.iter().position(|r| in_polygon(p, r))
}

/// The index of the region of `def` (the outline cut by its boundaries, as
/// the validation splits it) that holds `p`, or None when no region does or
/// the boundaries cannot be split. For assigning a material to a region
/// (the Python `Model.assign` replaces the region's earlier assignment).
pub fn region_index(def: &SlopeDefinition, p: Pt) -> Option<usize> {
    region_of(p, &regions(def)?)
}

/// A point strictly inside region `r`: on a horizontal line between two
/// vertex levels (widest gaps first), the middle of the widest stretch
/// inside the ring; accepted when `r` is the first region containing it
/// and it lies on no region's edge.
pub fn interior_point(r: usize, regions: &[Vec<Pt>], tol: f64) -> Option<Pt> {
    let ring = &regions[r];
    let mut ys: Vec<f64> = ring.iter().map(|p| p[1]).collect();
    ys.sort_by(f64::total_cmp);
    ys.dedup();
    let mut levels: Vec<(f64, f64)> = ys
        .windows(2)
        .map(|w| (w[1] - w[0], (w[0] + w[1]) / 2.0))
        .collect();
    levels.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (_, y) in levels {
        let mut xs: Vec<f64> = (0..ring.len())
            .filter_map(|i| {
                let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
                ((a[1] > y) != (b[1] > y))
                    .then(|| a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
            })
            .collect();
        xs.sort_by(f64::total_cmp);
        let mut spans: Vec<(f64, f64)> = xs
            .chunks_exact(2)
            .map(|c| (c[1] - c[0], (c[0] + c[1]) / 2.0))
            .collect();
        spans.sort_by(|a, b| b.0.total_cmp(&a.0));
        for (width, x) in spans {
            if width <= 2.0 * tol {
                continue;
            }
            let p = [x, y];
            if region_of(p, regions) == Some(r) && !regions.iter().any(|q| on_ring(p, q, tol)) {
                return Some(p);
            }
        }
    }
    None
}

/// Adds to `def.regionAssignments` the material the engine gives each
/// region no assignment names (see the module docs); returns how many it
/// added. A definition it cannot read this way (no materials, boundaries
/// that do not split, legacy boundary names, another top-region material)
/// is left as it is.
pub fn assign_unassigned_regions(def: &mut SlopeDefinition) -> usize {
    let Some(first) = def.materials.first().map(|m| m.name.clone()) else {
        return 0;
    };
    let assignments = def.region_assignments.clone().unwrap_or_default();
    let boundaries = def.material_boundaries.as_deref().unwrap_or(&[]);
    if assignments.is_empty() {
        let legacy = boundaries.iter().any(|b| !b.material_name.is_empty());
        let other_top = def
            .top_region_material_name
            .as_ref()
            .is_some_and(|t| *t != first)
            && !boundaries.is_empty();
        if legacy || other_top {
            return 0;
        }
    }
    let Some(regions) = regions(def) else {
        return 0;
    };
    if assignments.is_empty() && regions.len() == 1 && def.materials.len() == 1 {
        // one region, one material: nothing to say
        return 0;
    }
    let xs = def.coordinates.iter().map(|p| p[0]);
    let x_min = xs.clone().fold(f64::INFINITY, cslope_engine::js::math::min);
    let x_max = xs.fold(f64::NEG_INFINITY, cslope_engine::js::math::max);
    let tol = 1e-6 * (1.0 + (x_max - x_min).abs());
    let mut owned = vec![false; regions.len()];
    for a in &assignments {
        let r = region_of(a.point, &regions).or_else(|| {
            // on an edge: the validation counts it for the region when it names the first material
            (a.material_name == first)
                .then(|| regions.iter().position(|q| on_ring(a.point, q, tol)))
                .flatten()
        });
        if let Some(r) = r {
            owned[r] = true;
        }
    }
    let mut added = Vec::new();
    for (r, o) in owned.iter().enumerate() {
        if !o {
            if let Some(point) = interior_point(r, &regions, tol) {
                added.push(RegionAssignment {
                    point,
                    material_name: first.clone(),
                });
            }
        }
    }
    let n = added.len();
    if n > 0 {
        let mut all = assignments;
        all.extend(added);
        def.region_assignments = Some(all);
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use cslope_engine::types::MaterialBoundary;

    #[test]
    fn region_index_tells_the_regions_apart() {
        let mut def: SlopeDefinition = serde_json::from_value(serde_json::json!({
            "coordinates": [[0, 0], [0, 10], [20, 10], [20, 0]],
            "materials": [{"name": "A", "model": {"kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30}}],
        }))
        .unwrap();
        assert_eq!(region_index(&def, [5.0, 5.0]), Some(0));
        assert_eq!(region_index(&def, [50.0, 5.0]), None);
        def.material_boundaries = Some(vec![MaterialBoundary {
            coordinates: vec![[0.0, 5.0], [20.0, 5.0]],
            material_name: String::new(),
        }]);
        let above = region_index(&def, [5.0, 8.0]);
        let below = region_index(&def, [5.0, 2.0]);
        assert!(above.is_some() && below.is_some() && above != below);
        assert_eq!(region_index(&def, [15.0, 9.0]), above);
    }
}
