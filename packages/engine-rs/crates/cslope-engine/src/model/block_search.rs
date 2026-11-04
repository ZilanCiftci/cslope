//! Port of packages/engine/src/model/block-search.ts
//!
//! Block search: non-circular trial surfaces through block search objects.
//!
//! Each surface passes through one point of every object, the points
//! ordered by x as the base of the sliding block. From the two ends of the
//! base straight segments rise to the ground: the upslope (active) one at
//! the active angle, the downslope (passive) one at the passive angle. By
//! default these are the Coulomb wedge angles 45° + φ/2 and 45° − φ/2 of
//! the soil the segment cuts (Wright 1988, fig. 6; the block surfaces of
//! Edris & Wright 1987), otherwise drawn from the user's ranges, as
//! commercial block searches do. An object of one point is a fixed point,
//! of two a line (points uniform along it), of three or more a window
//! (points uniform within the polygon).
//!
//! `iterations` surfaces are drawn, then `refinedIterations` more around the
//! best ones in neighbourhoods that shrink level by level (each new point
//! within a fraction of its object's size of the old one). The draws are
//! seeded, so a search is repeatable. Only admissible surfaces are
//! analysed: entry and exit within the search limits, at least the minimum
//! failure distance apart, below the ground, inside the model and concave
//! (the rule of every non-circular surface in cSlope).
//!
//! The generator is a state machine (`BlockSearchSteps`, model/steps.rs).
//! TypeScript's `WeakMap` of genes is a list beside the planes (the genes
//! of `all`, by index); `isBlockSurface` asks the map whether a plane was
//! drawn here, which `BlockSearch::genes` answers by position.

use crate::api::ctx::SearchPhase;
use crate::error::{EngineError, Result};
use crate::js;
use crate::math::polygon::is_point_in_polygon;
use crate::model::optimize::ray_to_ground;
use crate::model::property_helpers::Rng;
use crate::model::reinforcement::effective_vertical_stress;
use crate::model::slope::{SearchPlane, Slope};
use crate::model::steps::{run_steps_sync, BoxedSteps, PlaneSteps, Step};
use crate::model::surface::{default_axis_point, is_admissible_polyline, Pt};
use crate::types::strength::{resolve_strength, StrengthContext};
use std::collections::HashSet;
use std::f64::consts::PI;

/// How one block surface was drawn: a point per object and the two angles (°).
#[derive(Debug, Clone, PartialEq)]
pub struct Gene {
    pub points: Vec<Pt>,
    pub active: f64,
    pub passive: f64,
}

/// Seed of the random draws: any fixed number makes the search repeatable.
const SEED: f64 = 1987.0;
/// Draws per surface before a window gives up on a point inside it.
const WINDOW_TRIES: usize = 64;
/// Refinement levels; the neighbourhood halves from level to level.
const LEVELS: usize = 6;
/// Neighbourhood of the first level, as a fraction of each object's size.
const FIRST_SCALE: f64 = 0.25;
/// Best surfaces refined at each level.
const PARENTS: usize = 5;
/// Block surfaces carried on to the non-circular optimisation.
pub const BLOCK_SEEDS: usize = 3;

/// Draw and evaluate the block surfaces of `slope`'s search objects.
/// Returns every evaluated surface (FOS None where invalid).
pub fn block_search(
    slope: &Slope,
    evaluate: impl FnMut(&Slope, &mut [SearchPlane]) -> Result<()>,
) -> Result<Vec<SearchPlane>> {
    let mut steps = block_search_steps(slope)?;
    run_steps_sync(&mut steps, slope, evaluate)
}

/// `blockSearchSteps(slope)`: the block search as steps (model/steps.rs):
/// the first draws, then each refinement level as one batch. The draws do
/// not depend on the factors of safety, only the choice of the parents at
/// the start of a level.
pub fn block_search_steps(slope: &Slope) -> Result<BoxedSteps<Vec<SearchPlane>>> {
    Ok(Box::new(BlockSearch::new(slope)?))
}

/// The bounding box of an object.
#[derive(Debug, Clone, Copy)]
struct BBox {
    x0: f64,
    x1: f64,
    y0: f64,
    h_y1: f64,
}

/// The block search's state: its draws so far and where it is.
pub struct BlockSearch {
    random: Rng,
    objects: Vec<Vec<Pt>>,
    boxes: Vec<BBox>,
    span: f64,
    /// No surface line: the search ends at once with no surfaces.
    no_ground: bool,
    fixed: bool,
    per_level: f64,
    level: usize,
    /// The evaluated surfaces and their genes.
    all: Vec<SearchPlane>,
    genes: Vec<Gene>,
    keys: HashSet<String>,
    /// The batch out and its genes.
    batch: Vec<SearchPlane>,
    batch_genes: Vec<Gene>,
    started: bool,
    done: bool,
}

impl BlockSearch {
    /// Checks the objects (TypeScript throws at the generator's first step,
    /// which follows at once in analyseSlopeSteps).
    pub fn new(slope: &Slope) -> Result<Self> {
        let objects = slope.block_search_objects().to_vec();
        if objects.is_empty() {
            return Err(EngineError::new(
                "Block search needs at least one search object: a point, a line or a window.",
            ));
        }
        let random = Rng::new(SEED);
        let (no_ground, span) = match slope.surface_line_xy() {
            Some(g) => (
                false,
                js::math::max(js::math::max_of(&g.x) - js::math::min_of(&g.x), 1e-9),
            ),
            None => (true, 0.0),
        };
        let boxes = objects
            .iter()
            .map(|o| {
                let xs: Vec<f64> = o.iter().map(|p| p[0]).collect();
                let ys: Vec<f64> = o.iter().map(|p| p[1]).collect();
                BBox {
                    x0: js::math::min_of(&xs),
                    x1: js::math::max_of(&xs),
                    y0: js::math::min_of(&ys),
                    h_y1: js::math::max_of(&ys),
                }
            })
            .collect();
        // A fixed-point object with fixed angles gives one surface only.
        let fixed = objects.iter().all(|o| o.len() == 1)
            && slope.block_active_angle().is_none()
            && slope.block_passive_angle().is_none();
        Ok(BlockSearch {
            random,
            objects,
            boxes,
            span,
            no_ground,
            fixed,
            per_level: (slope.refined_iterations() / LEVELS as f64).floor(),
            level: 0,
            all: Vec::new(),
            genes: Vec::new(),
            keys: HashSet::new(),
            batch: Vec::new(),
            batch_genes: Vec::new(),
            started: false,
            done: false,
        })
    }

    /// The genes of the evaluated surfaces, by position (the `WeakMap`).
    pub fn genes(&self) -> &[Gene] {
        &self.genes
    }

    fn in_window(&self, k: usize, x: f64, y: f64) -> bool {
        let o = &self.objects[k];
        let px: Vec<f64> = o.iter().map(|p| p[0]).collect();
        let py: Vec<f64> = o.iter().map(|p| p[1]).collect();
        is_point_in_polygon(x, y, &px, &py)
    }

    /// A point of object k: anywhere on it, or within `scale` of its size around `near`.
    fn draw_point(&mut self, k: usize, near: Option<Pt>, scale: f64) -> Option<Pt> {
        let o = &self.objects[k];
        if o.len() == 1 {
            return Some([o[0][0], o[0][1]]);
        }
        if o.len() == 2 {
            let (a, b) = (o[0], o[1]);
            let dx = b[0] - a[0];
            let dy = b[1] - a[1];
            let mut t = self.random.next();
            if let Some(near) = near {
                let t0 = ((near[0] - a[0]) * dx + (near[1] - a[1]) * dy) / (dx * dx + dy * dy);
                t = js::math::min(
                    1.0,
                    js::math::max(0.0, t0 + scale * (2.0 * self.random.next() - 1.0)),
                );
            }
            return Some([a[0] + t * dx, a[1] + t * dy]);
        }
        let bx = self.boxes[k];
        let w = bx.x1 - bx.x0;
        let h = bx.h_y1 - bx.y0;
        for _ in 0..WINDOW_TRIES {
            let x = match near {
                Some(n) => n[0] + scale * w * (2.0 * self.random.next() - 1.0),
                None => bx.x0 + w * self.random.next(),
            };
            let y = match near {
                Some(n) => n[1] + scale * h * (2.0 * self.random.next() - 1.0),
                None => bx.y0 + h * self.random.next(),
            };
            if self.in_window(k, x, y) {
                return Some([x, y]);
            }
        }
        near.map(|n| [n[0], n[1]])
    }

    /// Friction angle (°, design value) of the soil halfway between (x, y)
    /// and the ground above it: the soil the end segment mostly cuts.
    fn phi_above(slope: &Slope, x: f64, y: f64) -> Result<f64> {
        let g = slope.get_external_y_intersection(x)?;
        if !g.is_finite() || !(g > y) {
            return Ok(0.0);
        }
        let ym = (y + g) / 2.0;
        let Some(m) = slope
            .material_geometries()
            .iter()
            .find(|geom| is_point_in_polygon(x, ym, &geom.px, &geom.py))
        else {
            return Ok(0.0);
        };
        let model = &slope.material(m.material).model;
        let r = resolve_strength(
            model,
            &StrengthContext {
                y_bottom: ym,
                x,
                y_ground: g,
                alpha: 0.0,
                effective_vertical_stress: if model.kind() == "shansep" {
                    Some(effective_vertical_stress(slope, x, ym))
                } else {
                    None
                },
                ..Default::default()
            },
        )?;
        let tan_phi = js::math::tan((r.friction_angle * PI) / 180.0)
            / slope.partial_factors().map_or(1.0, |f| f.tan_phi);
        Ok((js::math::atan(tan_phi) * 180.0) / PI)
    }

    /// An angle from a range, or near `near` within `scale` of its width.
    fn draw_angle(&mut self, range: [f64; 2], near: Option<f64>, scale: f64) -> f64 {
        let [lo, hi] = range;
        match near {
            None => lo + (hi - lo) * self.random.next(),
            Some(near) => js::math::min(
                hi,
                js::math::max(
                    lo,
                    near + scale * (hi - lo) * (2.0 * self.random.next() - 1.0),
                ),
            ),
        }
    }

    /// The surface of a gene, or None when it is not admissible.
    fn surface_of(&self, slope: &Slope, gene: &Gene) -> Result<Option<Vec<Pt>>> {
        let ground = slope.surface_line_xy().expect("checked at the start");
        let [entry_l, entry_r, exit_l, exit_r] = slope.limits();
        let min_length = js::math::max(slope.min_failure_distance(), 0.0);
        let mut base = gene.points.clone();
        js::array::sort_by(&mut base, |p, q| p[0] - q[0]);
        for i in 1..base.len() {
            if base[i][0] - base[i - 1][0] < 1e-9 * self.span {
                return Ok(None);
            }
        }
        let first = base[0];
        let last = base[base.len() - 1];
        if !(first[1] < slope.get_external_y_intersection(first[0])?)
            || !(last[1] < slope.get_external_y_intersection(last[0])?)
        {
            return Ok(None);
        }
        let ta = js::math::tan((gene.active * PI) / 180.0);
        let tp = js::math::tan((gene.passive * PI) / 180.0);
        let entry = ray_to_ground(ground, first[0], first[1], -1.0, ta);
        let exit = ray_to_ground(ground, last[0], last[1], 1.0, tp);
        let (Some(entry), Some(exit)) = (entry, exit) else {
            return Ok(None);
        };
        if entry[0] < entry_l - 1e-9 || entry[0] > entry_r + 1e-9 {
            return Ok(None);
        }
        if exit[0] < exit_l - 1e-9 || exit[0] > exit_r + 1e-9 {
            return Ok(None);
        }
        if exit[0] - entry[0] <= min_length {
            return Ok(None);
        }
        let mut points: Vec<Pt> = Vec::with_capacity(base.len() + 2);
        points.push(entry);
        points.extend(base);
        points.push(exit);
        Ok(if is_admissible_polyline(slope, &points, 1.0) {
            Some(points)
        } else {
            None
        })
    }

    fn plane_of(&self, slope: &Slope, gene: &Gene) -> Result<Option<SearchPlane>> {
        let Some(points) = self.surface_of(slope, gene)? else {
            return Ok(None);
        };
        let [cx, cy] = default_axis_point(&points);
        Ok(Some(SearchPlane {
            lc: points[0],
            rc: points[points.len() - 1],
            cx,
            cy,
            radius: 0.0,
            points: Some(points),
            fos: None,
            slices: None,
            ..Default::default()
        }))
    }

    /// A gene with the given points and angles from the ranges or the soil.
    fn gene_of(
        &mut self,
        slope: &Slope,
        points: Vec<Pt>,
        near: Option<&Gene>,
        scale: f64,
    ) -> Result<Gene> {
        let mut sorted = points.clone();
        js::array::sort_by(&mut sorted, |p, q| p[0] - q[0]);
        let first = sorted[0];
        let last = sorted[sorted.len() - 1];
        let active = match slope.block_active_angle() {
            Some(r) => self.draw_angle(r, near.map(|g| g.active), scale),
            None => 45.0 + Self::phi_above(slope, first[0], first[1])? / 2.0,
        };
        let passive = match slope.block_passive_angle() {
            Some(r) => self.draw_angle(r, near.map(|g| g.passive), scale),
            None => 45.0 - Self::phi_above(slope, last[0], last[1])? / 2.0,
        };
        Ok(Gene {
            points,
            active,
            passive,
        })
    }

    fn key(g: &Gene) -> String {
        let pts: Vec<String> = g
            .points
            .iter()
            .map(|p| {
                format!(
                    "{},{}",
                    js::num::to_fixed(p[0], 6),
                    js::num::to_fixed(p[1], 6)
                )
            })
            .collect();
        format!(
            "{}|{}|{}",
            pts.join(";"),
            js::num::to_fixed(g.active, 4),
            js::num::to_fixed(g.passive, 4)
        )
    }

    /// A drawn gene: a point of every object (None when a window gives up),
    /// near the parent's when refining.
    fn make(&mut self, slope: &Slope, parent: Option<(&Gene, f64)>) -> Result<Option<Gene>> {
        let mut points: Vec<Pt> = Vec::with_capacity(self.objects.len());
        for k in 0..self.objects.len() {
            let p = match parent {
                Some((g, scale)) => self.draw_point(k, Some(g.points[k]), scale),
                None => self.draw_point(k, None, 1.0),
            };
            let Some(p) = p else {
                return Ok(None);
            };
            points.push(p);
        }
        Ok(Some(match parent {
            Some((g, scale)) => self.gene_of(slope, points, Some(g), scale)?,
            None => self.gene_of(slope, points, None, 1.0)?,
        }))
    }

    /// Draws `count` genes; appends the admissible new surfaces to the batch.
    fn run(&mut self, slope: &Slope, count: f64, parent: Option<(&Gene, f64)>) -> Result<()> {
        let mut added = 0usize;
        // Inadmissible draws count against the budget too, at most twice it,
        // so that objects outside the soil cannot loop for ever.
        let mut tries = 0usize;
        while (added as f64) < count && (tries as f64) < 2.0 * count {
            tries += 1;
            let Some(gene) = self.make(slope, parent)? else {
                continue;
            };
            let k = Self::key(&gene);
            if !self.keys.insert(k) {
                continue;
            }
            if let Some(plane) = self.plane_of(slope, &gene)? {
                self.batch.push(plane);
                self.batch_genes.push(gene);
                added += 1;
            }
        }
        Ok(())
    }

    /// The batch of the next refinement level, or None at the end.
    fn next_level(&mut self, slope: &Slope) -> Result<bool> {
        // Refinement: around the best distinct surfaces, in shrinking neighbourhoods.
        if !(self.level < LEVELS && self.per_level > 0.0) {
            return Ok(false);
        }
        let scale = FIRST_SCALE / js::math::pow(2.0, self.level as f64);
        let parents = best_distinct_indices(&self.all, PARENTS, self.span);
        if parents.is_empty() {
            return Ok(false);
        }
        let per_parent = js::math::max(1.0, (self.per_level / parents.len() as f64).floor());
        for i in parents {
            let gene = self.genes[i].clone();
            self.run(slope, per_parent, Some((&gene, scale)))?;
        }
        self.level += 1;
        Ok(true)
    }
}

impl PlaneSteps for BlockSearch {
    type Output = Vec<SearchPlane>;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        &mut self.batch
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<SearchPlane>>> {
        if self.done {
            return Err(EngineError::new("blockSearchSteps: resumed after the end"));
        }
        if !self.started {
            self.started = true;
            if self.no_ground {
                self.done = true;
                return Ok(Step::Done(Vec::new()));
            }
            let count = if self.fixed { 1.0 } else { slope.iterations() };
            self.run(slope, count, None)?;
            return Ok(Step::Batch(SearchPhase::Block));
        }
        // the evaluated batch joins `all` (TypeScript pushed it before the yield;
        // `all` is read only after it)
        self.all.append(&mut self.batch);
        self.genes.append(&mut self.batch_genes);
        if !self.fixed && self.next_level(slope)? {
            return Ok(Step::Batch(SearchPhase::Block));
        }
        self.done = true;
        Ok(Step::Done(std::mem::take(&mut self.all)))
    }
}

/// The indices of `bestDistinct`'s choice.
fn best_distinct_indices(planes: &[SearchPlane], count: usize, span: f64) -> Vec<usize> {
    let mut solved: Vec<usize> = (0..planes.len())
        .filter(|&i| planes[i].fos.is_some_and(f64::is_finite))
        .collect();
    js::array::sort_by(&mut solved, |&a, &b| {
        planes[a].fos.unwrap_or(0.0) - planes[b].fos.unwrap_or(0.0)
    });
    let mut chosen: Vec<usize> = Vec::new();
    for i in solved {
        if chosen.len() >= count {
            break;
        }
        let p = &planes[i];
        let distinct = chosen.iter().all(|&c| {
            let c = &planes[c];
            (c.lc[0] - p.lc[0]).abs() > 0.01 * span || (c.rc[0] - p.rc[0]).abs() > 0.01 * span
        });
        if distinct {
            chosen.push(i);
        }
    }
    chosen
}

/// The `count` best evaluated surfaces with clearly different entry or exit points.
pub fn best_distinct(planes: &[SearchPlane], count: usize, span: f64) -> Vec<SearchPlane> {
    best_distinct_indices(planes, count, span)
        .into_iter()
        .map(|i| planes[i].clone())
        .collect()
}
