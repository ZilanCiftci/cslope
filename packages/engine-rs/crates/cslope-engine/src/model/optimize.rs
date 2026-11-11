//! Port of packages/engine/src/model/optimize.ts
//!
//! Non-circular optimisation of critical slip surfaces.
//!
//! The best circles of the search, and the best block surfaces through the
//! buried material layers, are polylines whose vertices are moved by the
//! alternating-variable method of Celestino & Duncan (1981), as built in
//! the Corps of Engineers manual of Edris & Wright (1987, paras 87–89):
//!
//! - Each interior vertex is shifted a distance Δ in both directions
//!   normal to the surface (the bisector at a kink); the entry and exit
//!   slide along the ground. One vertex at a time, the others fixed.
//! - A parabola through the three factors of safety gives each vertex its
//!   best position, and the whole surface is then moved permanently.
//! - Δ starts at a tenth of the shortest segment and is halved twice;
//!   up to six rounds per step size.
//!
//! Once converged the polyline is refined (vertices doubled) and optimised
//! again. The best surface of all seeds is then optimised further while a
//! cycle still lowers its FOS by more than the analysis tolerance: refined
//! once more, then restarted from its result with the first shift (Greco
//! 1996 repeats the search from the last surface until it no longer
//! improves). Surfaces stay admissible: below the ground, inside the model,
//! concave, and with entry and exit within the search limits. A candidate
//! without a complete-equilibrium solution gets no factor of safety.
//!
//! The TypeScript generators are state machines (model/steps.rs
//! `PlaneSteps`): `OptimisePoints` (the alternating-variable search, with
//! the program counter of `optimisePoints` and of its inner generators
//! `runCycle`, `refine` and `fosOf`), `CircleSeed`, `LayerSeeds`, the
//! chain of the layer seeds and their searches, and `PolishBest`; the
//! seeds run in lockstep with `steps::InParallel` as in TypeScript, so the
//! batches are TypeScript's batches. Each plane a search yields is
//! evaluated in place and read back when it resumes.
//!
//! Object identity: TypeScript's `polished.plane !== best.plane` and its
//! caller's `optimised.filter((p) => !known.has(p))` compare planes by
//! identity. A search here records whether its best plane is still the
//! plane it started from (`Optimised::moved`), which is what both
//! comparisons ask.

use crate::api::ctx::SearchPhase;
use crate::error::Result;
use crate::js;
use crate::model::geometry_ops::Polyline;
use crate::model::reinforcement::effective_vertical_stress;
use crate::model::slope::{SearchPlane, Slope};
use crate::model::steps::{run_steps_sync, BoxedSteps, InParallel, PlaneSteps, Step};
use crate::model::surface::{circle_to_polyline, is_admissible_polyline, Pt};
use crate::types::geometry::GeometryWithMaterial;
use crate::types::strength::{resolve_strength, StrengthContext};
use std::f64::consts::PI;

const START_VERTICES: usize = 9;
/// Vertices of a seed's surface after its one refinement, at most.
const SEED_MAX_VERTICES: usize = 17;
/// Vertices of the best surface after its further refinement, at most.
const MAX_VERTICES: usize = 33;
/// Further cycles on the best surface, at most. Each halves its shift from
/// a tenth of the shortest segment, as the first.
const POLISH_CYCLES: usize = 4;
/// Best circles taken as seeds.
const SEEDS: usize = 3;
/// First shift as a fraction of the shortest segment (Celestino & Duncan).
const FIRST_SHIFT: f64 = 0.1;
/// The shift is halved when a round no longer helps (Celestino & Duncan:
/// Δ, ½Δ, ¼Δ on their 4–6 point surfaces), down to this fraction of the
/// first shift.
const LAST_SHIFT: f64 = 0.02;
/// Rounds per step size (Celestino & Duncan: 5–6).
const ROUNDS_PER_SHIFT: usize = 6;

/// Options of the optimisation (TypeScript's `OptimiseOptions`).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct OptimiseOptions {
    /// Maximum surface evaluations per seed; the further optimisation of the
    /// best surface gets twice this. Default 1500.
    pub budget_per_seed: Option<f64>,
}

/// Optimised non-circular surfaces grown from the best circles among
/// `evaluated` and from block surfaces through the buried layers. Returns
/// the final surface of each seed (evaluated). `evaluate` evaluates planes
/// in place (TypeScript's `Evaluate`).
pub fn optimise_non_circular(
    slope: &Slope,
    evaluated: &[SearchPlane],
    evaluate: impl FnMut(&Slope, &mut [SearchPlane]) -> Result<()>,
    options: OptimiseOptions,
) -> Result<Vec<SearchPlane>> {
    let mut steps = optimise_non_circular_steps_with(slope, evaluated, options)?;
    run_steps_sync(&mut steps, slope, evaluate)
}

/// `optimiseNonCircularSteps(slope, evaluated)`: optimiseNonCircular as
/// steps (model/steps.rs). The seeds are optimised independently of each
/// other, so their searches run in lockstep and each step evaluates their
/// candidates as one batch.
pub fn optimise_non_circular_steps(
    slope: &Slope,
    evaluated: &[SearchPlane],
) -> Result<BoxedSteps<Vec<SearchPlane>>> {
    optimise_non_circular_steps_with(slope, evaluated, OptimiseOptions::default())
}

/// `optimise_non_circular_steps` with options.
pub fn optimise_non_circular_steps_with(
    slope: &Slope,
    evaluated: &[SearchPlane],
    options: OptimiseOptions,
) -> Result<BoxedSteps<Vec<SearchPlane>>> {
    let budget_per_seed = options.budget_per_seed.unwrap_or(1500.0);
    let seeds = pick_seeds(slope, evaluated);
    let mut searches: Vec<BoxedSteps<Vec<Optimised>>> = seeds
        .into_iter()
        .map(|seed| Box::new(CircleSeed::new(seed, budget_per_seed)) as BoxedSteps<Vec<Optimised>>)
        .collect();
    searches.push(Box::new(LayerChain::new(budget_per_seed)));
    let main = InParallel::new(searches);
    Ok(Box::new(NonCircular {
        main,
        polish: None,
        budget_per_seed,
        done: false,
    }))
}

/// Optimised non-circular surfaces grown from evaluated polylines (the best
/// block surfaces), each by the alternating-variable search as above. The
/// optimised surfaces are free to leave the block search objects. Returns
/// the final surface of each seed (evaluated), a seed itself where nothing
/// improved it (TypeScript's `optimisePolylines`).
pub fn optimise_polylines(
    slope: &Slope,
    seeds: Vec<SearchPlane>,
    evaluate: impl FnMut(&Slope, &mut [SearchPlane]) -> Result<()>,
    options: OptimiseOptions,
) -> Result<Vec<SearchPlane>> {
    let mut steps = polylines_steps(seeds, options);
    let out = run_steps_sync(&mut steps, slope, evaluate)?;
    Ok(out.into_iter().map(|(p, _)| p).collect())
}

/// `optimisePolylinesSteps(slope, seeds)`, the seeds in lockstep (see
/// `optimise_non_circular_steps`). Ends with the optimised planes that are
/// not seeds: TypeScript returns a seed that nothing improved among them
/// and its caller drops it by identity (`!known.has(p)`), which the port
/// does here.
pub fn optimise_polylines_steps(
    _slope: &Slope,
    seeds: Vec<SearchPlane>,
) -> Result<BoxedSteps<Vec<SearchPlane>>> {
    optimise_polylines_steps_with(seeds, OptimiseOptions::default())
}

/// `optimise_polylines_steps` with options.
pub fn optimise_polylines_steps_with(
    seeds: Vec<SearchPlane>,
    options: OptimiseOptions,
) -> Result<BoxedSteps<Vec<SearchPlane>>> {
    let steps = polylines_steps(seeds, options);
    Ok(Box::new(MapSteps::new(
        steps,
        |out: Vec<(SearchPlane, bool)>| {
            out.into_iter()
                .filter(|(_, seed)| !seed)
                .map(|(p, _)| p)
                .collect::<Vec<_>>()
        },
    )))
}

/// The polyline searches and the polish; each plane with whether it is a
/// seed (unchanged).
fn polylines_steps(seeds: Vec<SearchPlane>, options: OptimiseOptions) -> PolylinesSteps {
    let budget_per_seed = options.budget_per_seed.unwrap_or(1500.0);
    let searches: Vec<BoxedSteps<Optimised>> = seeds
        .into_iter()
        .filter(|seed| seed.points.is_some() && seed.fos.is_some())
        .map(|seed| {
            let points = seed.points.clone().expect("filtered");
            let axis = [seed.cx, seed.cy];
            Box::new(OptimisePoints::new(
                points,
                axis,
                budget_per_seed,
                seed,
                None,
                true,
            )) as BoxedSteps<Optimised>
        })
        .collect();
    PolylinesSteps {
        main: InParallel::new(searches),
        polish: None,
        budget_per_seed,
        done: false,
    }
}

/// An optimised surface, its points and axis, and what its last cycle
/// gained. `moved`: its plane is not the plane its search started from;
/// `seed`: that start plane was a seed given to `optimisePolylines` (both
/// stand for TypeScript's object identity).
pub(crate) struct Optimised {
    plane: SearchPlane,
    points: Vec<Pt>,
    axis: Pt,
    gain: f64,
    moved: bool,
    seed: bool,
}

impl Optimised {
    /// The plane is a seed given to `optimisePolylines`, unchanged.
    fn is_seed(&self) -> bool {
        self.seed && !self.moved
    }
}

/// `fos!` of an evaluated plane (always set where TypeScript asserts it;
/// `null` would read as 0 in its arithmetic).
fn fos_of(plane: &SearchPlane) -> f64 {
    plane.fos.unwrap_or(0.0)
}

/// `[...].sort((a, b) => a.plane.fos! - b.plane.fos!)[0]` over the solved
/// results: the index of the best.
fn best_index(results: &[Optimised]) -> Option<usize> {
    let mut order: Vec<usize> = (0..results.len())
        .filter(|&i| results[i].plane.fos.is_some())
        .collect();
    js::array::sort_by(&mut order, |&a, &b| {
        fos_of(&results[a].plane) - fos_of(&results[b].plane)
    });
    order.first().copied()
}

// ── The two entry points' outer steps ─────────────────────────────

/// optimiseNonCircularSteps after its seeds: the lockstep searches, then
/// the polish of the best.
struct NonCircular {
    main: InParallel<Vec<Optimised>>,
    polish: Option<PolishBest>,
    budget_per_seed: f64,
    done: bool,
}

impl PlaneSteps for NonCircular {
    type Output = Vec<SearchPlane>;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        match &mut self.polish {
            Some(p) => p.batch(),
            None => self.main.batch(),
        }
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<SearchPlane>>> {
        if self.done {
            return Err(crate::error::EngineError::new(
                "optimiseNonCircularSteps: resumed after the end",
            ));
        }
        if self.polish.is_none() {
            match self.main.resume(slope)? {
                Step::Batch(_) => return Ok(Step::Batch(SearchPhase::Optimise)),
                Step::Done(done) => {
                    // the circles' results (null where none), then the layers'
                    let results: Vec<Optimised> = done.into_iter().flatten().collect();
                    self.polish = Some(PolishBest::new(results, self.budget_per_seed));
                }
            }
        }
        let polish = self.polish.as_mut().expect("set above");
        match polish.resume(slope)? {
            Step::Batch(p) => Ok(Step::Batch(p)),
            Step::Done(results) => {
                self.done = true;
                Ok(Step::Done(results.into_iter().map(|r| r.plane).collect()))
            }
        }
    }
}

/// optimisePolylinesSteps: the lockstep searches, then the polish.
struct PolylinesSteps {
    main: InParallel<Optimised>,
    polish: Option<PolishBest>,
    budget_per_seed: f64,
    done: bool,
}

impl PlaneSteps for PolylinesSteps {
    type Output = Vec<(SearchPlane, bool)>;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        match &mut self.polish {
            Some(p) => p.batch(),
            None => self.main.batch(),
        }
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<(SearchPlane, bool)>>> {
        if self.done {
            return Err(crate::error::EngineError::new(
                "optimisePolylinesSteps: resumed after the end",
            ));
        }
        if self.polish.is_none() {
            match self.main.resume(slope)? {
                Step::Batch(_) => return Ok(Step::Batch(SearchPhase::Optimise)),
                Step::Done(results) => {
                    self.polish = Some(PolishBest::new(results, self.budget_per_seed));
                }
            }
        }
        let polish = self.polish.as_mut().expect("set above");
        match polish.resume(slope)? {
            Step::Batch(p) => Ok(Step::Batch(p)),
            Step::Done(results) => {
                self.done = true;
                Ok(Step::Done(
                    results
                        .into_iter()
                        .map(|r| {
                            let seed = r.is_seed();
                            (r.plane, seed)
                        })
                        .collect(),
                ))
            }
        }
    }
}

/// Steps whose result is mapped by a function (the seam's adaptor).
struct MapSteps<S: PlaneSteps, F> {
    inner: S,
    map: Option<F>,
}

impl<S: PlaneSteps, F> MapSteps<S, F> {
    fn new(inner: S, map: F) -> Self {
        MapSteps {
            inner,
            map: Some(map),
        }
    }
}

impl<S: PlaneSteps, T, F: FnOnce(S::Output) -> T> PlaneSteps for MapSteps<S, F> {
    type Output = T;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        self.inner.batch()
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<T>> {
        match self.inner.resume(slope)? {
            Step::Batch(p) => Ok(Step::Batch(p)),
            Step::Done(v) => {
                let map = self.map.take().ok_or_else(|| {
                    crate::error::EngineError::new("optimisation steps: resumed after the end")
                })?;
                Ok(Step::Done(map(v)))
            }
        }
    }
}

/// `polishBest`: the optimised surfaces, the best one optimised further.
struct PolishBest {
    results: Vec<Optimised>,
    budget_per_seed: f64,
    /// The further optimisation of the best (index in `results`).
    sub: Option<OptimisePoints>,
    started: bool,
    empty: Vec<SearchPlane>,
}

impl PolishBest {
    fn new(results: Vec<Optimised>, budget_per_seed: f64) -> Self {
        PolishBest {
            results,
            budget_per_seed,
            sub: None,
            started: false,
            empty: Vec::new(),
        }
    }

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        match &mut self.sub {
            Some(s) => s.batch(),
            None => &mut self.empty,
        }
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<Optimised>>> {
        if !self.started {
            self.started = true;
            // The best surface, while its last cycle still lowered the FOS by more
            // than the tolerance: the halved shifts of one cycle (or its budget)
            // stop before the minimum of a surface whose shape is still changing.
            // Restarting V050b and V051 from their result lowered them 0.3 %.
            if let Some(i) = best_index(&self.results) {
                let best = &self.results[i];
                if best.gain > slope.tolerance() {
                    self.sub = Some(OptimisePoints::new(
                        best.points.clone(),
                        best.axis,
                        2.0 * self.budget_per_seed,
                        best.plane.clone(),
                        Some(best.gain),
                        best.is_seed(),
                    ));
                }
            }
        }
        if let Some(sub) = self.sub.as_mut() {
            match sub.resume(slope)? {
                Step::Batch(p) => return Ok(Step::Batch(p)),
                Step::Done(polished) => {
                    self.sub = None;
                    // (polished.plane !== best.plane)
                    if polished.moved {
                        self.results.push(polished);
                    }
                }
            }
        }
        Ok(Step::Done(std::mem::take(&mut self.results)))
    }
}

// ── Seeds ─────────────────────────────────────────────────────────

/// A seed circle (the fields of its plane the search reads).
#[derive(Debug, Clone, Copy)]
struct SeedCircle {
    cx: f64,
    cy: f64,
    radius: f64,
    lc: Pt,
    rc: Pt,
}

/// Best circles with clearly different entry and exit points.
fn pick_seeds(slope: &Slope, evaluated: &[SearchPlane]) -> Vec<SeedCircle> {
    // (not composite circles: their circle leaves the soil, its polyline would too)
    let mut circles: Vec<&SearchPlane> = evaluated
        .iter()
        .filter(|p| {
            p.points.is_none()
                && p.composite.is_none()
                && p.fos.is_some_and(f64::is_finite)
                && p.radius > 0.0
        })
        .collect();
    js::array::sort_by(&mut circles, |a, b| fos_of(a) - fos_of(b));
    let [e_l, e_r, x_l, x_r] = slope.limits();
    let span = js::math::max(js::math::max((x_r - e_l).abs(), (e_r - x_l).abs()), 1.0);
    let mut seeds: Vec<SeedCircle> = Vec::new();
    for c in circles {
        if seeds.len() >= SEEDS {
            break;
        }
        let distinct = seeds.iter().all(|s| {
            (s.lc[0] - c.lc[0]).abs() > 0.05 * span || (s.rc[0] - c.rc[0]).abs() > 0.05 * span
        });
        if distinct {
            seeds.push(SeedCircle {
                cx: c.cx,
                cy: c.cy,
                radius: c.radius,
                lc: c.lc,
                rc: c.rc,
            });
        }
    }
    seeds
}

/// `makePlane(points, axis)`: a candidate of the optimisation.
fn make_plane(points: Vec<Pt>, axis: Pt) -> SearchPlane {
    SearchPlane {
        lc: points[0],
        rc: points[points.len() - 1],
        cx: axis[0],
        cy: axis[1],
        radius: 0.0,
        points: Some(points),
        fos: None,
        slices: None,
        optimised: Some(true),
        ..Default::default()
    }
}

/// `optimiseCircleSeed`: the circle as a polyline, finer when the coarse
/// chords cut the air.
struct CircleSeed {
    seed: SeedCircle,
    budget: f64,
    /// Index into the vertex counts.
    next: usize,
    batch: Vec<SearchPlane>,
    sub: Option<OptimisePoints>,
    done: bool,
}

const CIRCLE_VERTICES: [usize; 3] = [START_VERTICES, SEED_MAX_VERTICES, 2 * SEED_MAX_VERTICES - 1];

impl CircleSeed {
    fn new(seed: SeedCircle, budget: f64) -> Self {
        CircleSeed {
            seed,
            budget,
            next: 0,
            batch: Vec::new(),
            sub: None,
            done: false,
        }
    }

    /// Yields the polyline of the next vertex count, or ends with null.
    fn next_polyline(&mut self) -> Step<Vec<Optimised>> {
        if self.next >= CIRCLE_VERTICES.len() {
            self.done = true;
            return Step::Done(Vec::new());
        }
        let s = self.seed;
        let points =
            circle_to_polyline(s.cx, s.cy, s.radius, s.lc, s.rc, CIRCLE_VERTICES[self.next]);
        self.next += 1;
        self.batch = vec![make_plane(points, [s.cx, s.cy])];
        Step::Batch(SearchPhase::Optimise)
    }
}

impl PlaneSteps for CircleSeed {
    type Output = Vec<Optimised>;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        match &mut self.sub {
            Some(s) => s.batch(),
            None => &mut self.batch,
        }
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<Optimised>>> {
        if self.done {
            return Err(crate::error::EngineError::new(
                "optimiseCircleSeed: resumed after the end",
            ));
        }
        if let Some(sub) = self.sub.as_mut() {
            return Ok(match sub.resume(slope)? {
                Step::Batch(p) => Step::Batch(p),
                Step::Done(r) => {
                    self.done = true;
                    Step::Done(vec![r])
                }
            });
        }
        if self.next == 0 {
            return Ok(self.next_polyline());
        }
        // after `yield [plane]`
        let plane = self.batch.pop().expect("the evaluated polyline");
        self.budget -= 1.0;
        if plane.fos.is_some() {
            let points = plane.points.clone().expect("a polyline");
            let axis = [self.seed.cx, self.seed.cy];
            self.sub = Some(OptimisePoints::new(
                points,
                axis,
                self.budget,
                plane,
                None,
                false,
            ));
            return self.resume(slope);
        }
        if self.budget <= 0.0 {
            self.done = true;
            return Ok(Step::Done(Vec::new()));
        }
        Ok(self.next_polyline())
    }
}

// ── Seeds through buried layers ───────────────────────────────────

/// Vertical extent [yMin, yMax] of a polygon at x, or None outside it.
fn polygon_y_extent_at(px: &[f64], py: &[f64], x: f64) -> Option<[f64; 2]> {
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    let n = px.len();
    if n == 0 {
        return None;
    }
    let mut j = n - 1;
    for i in 0..n {
        let xi = px[i];
        let xj = px[j];
        if (xi <= x && x < xj) || (xj <= x && x < xi) {
            let y = py[i] + ((x - xi) * (py[j] - py[i])) / (xj - xi);
            if y < lo {
                lo = y;
            }
            if y > hi {
                hi = y;
            }
        }
        j = i;
    }
    if hi > lo {
        Some([lo, hi])
    } else {
        None
    }
}

/// Grid positions along a layer for the start and the end of the run.
const RUN_GRID: usize = 7;
/// Block surfaces per layer carried on to the alternating-variable search.
const LAYER_SEEDS: usize = 3;

/// First point where the ray from (x0, y0) in direction (dx, dy) meets the ground.
pub fn ray_to_ground(ground: &Polyline, x0: f64, y0: f64, dx: f64, dy: f64) -> Option<Pt> {
    let mut best = f64::INFINITY;
    let mut hit: Option<Pt> = None;
    let mut i = 0;
    while i + 1 < ground.x.len() {
        let ax = ground.x[i];
        let ay = ground.y[i];
        let ex = ground.x[i + 1] - ax;
        let ey = ground.y[i + 1] - ay;
        let den = dx * ey - dy * ex;
        if den.abs() < 1e-12 {
            i += 1;
            continue;
        }
        let t = ((ax - x0) * ey - (ay - y0) * ex) / den;
        let u = ((ax - x0) * dy - (ay - y0) * dx) / den;
        if t > 1e-9 && u >= -1e-9 && u <= 1.0 + 1e-9 && t < best {
            best = t;
            hit = Some([x0 + t * dx, y0 + t * dy]);
        }
        i += 1;
    }
    hit
}

/// A candidate block surface through a layer: its points and moment axis.
type Candidate = (Vec<Pt>, Pt);

/// A block surface through a buried layer, carried on as a seed.
struct LayerSeed {
    points: Vec<Pt>,
    axis: Pt,
    plane: SearchPlane,
}

/// c and φ (rad) of a material at the point (x, y), as the slices see them.
fn layer_params(
    slope: &Slope,
    m: &GeometryWithMaterial,
    x: f64,
    y: f64,
    g: f64,
) -> Result<(f64, f64)> {
    let model = &slope.material(m.material).model;
    let r = resolve_strength(
        model,
        &StrengthContext {
            y_bottom: y,
            x,
            y_ground: g,
            alpha: 0.0,
            effective_vertical_stress: if model.kind() == "shansep" {
                Some(effective_vertical_stress(slope, x, y))
            } else {
                None
            },
            ..Default::default()
        },
    )?;
    Ok((r.cohesion, (r.friction_angle * PI) / 180.0))
}

/// True when every material above the layer at x is stronger than it at
/// the layer's own effective stress (Mohr-Coulomb: c + σ′ tan φ, each
/// material with its own parameters, σ′ from the overburden). Comparing
/// at one stress keeps a shallow layer from looking weaker just because
/// the stress is lower there.
fn weakest(slope: &Slope, mi: usize, x: f64) -> Result<bool> {
    let geometries = slope.material_geometries();
    let m = &geometries[mi];
    let ext = polygon_y_extent_at(&m.px, &m.py, x);
    let g = slope.get_external_y_intersection(x)?;
    let Some(ext) = ext.filter(|_| g.is_finite()) else {
        return Ok(false);
    };
    let mid = (ext[0] + ext[1]) / 2.0;
    let uw = slope.material(m.material).unit_weight();
    let gamma = if uw > 0.0 { uw } else { 18.0 };
    let sigma = gamma * (g - mid);
    let (c, phi) = layer_params(slope, m, x, mid, g)?;
    let own_strength = c + sigma * js::math::tan(phi);
    for (oi, o) in geometries.iter().enumerate() {
        if oi == mi {
            continue;
        }
        let Some(e) = polygon_y_extent_at(&o.px, &o.py, x) else {
            continue;
        };
        if e[0] < mid {
            continue; // not above the layer's middle
        }
        let (pc, pphi) = layer_params(slope, o, x, (e[0] + e[1]) / 2.0, g)?;
        if pc + sigma * js::math::tan(pphi) <= own_strength {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Friction angle (rad) of the material directly above the layer at x.
fn phi_above(slope: &Slope, mi: usize, x: f64, top: f64) -> Result<f64> {
    let geometries = slope.material_geometries();
    let g = slope.get_external_y_intersection(x)?;
    let mut above: Option<(usize, [f64; 2])> = None;
    for (oi, o) in geometries.iter().enumerate() {
        if oi == mi {
            continue;
        }
        let e = polygon_y_extent_at(&o.px, &o.py, x);
        if let Some(e) = e {
            if e[0] >= top - 1e-6 && above.is_none_or(|(_, a)| e[0] < a[0]) {
                above = Some((oi, e));
            }
        }
    }
    Ok(match above {
        Some((oi, e)) => layer_params(slope, &geometries[oi], x, (e[0] + e[1]) / 2.0, g)?.1,
        None => layer_params(slope, &geometries[mi], x, top, g)?.1,
    })
}

/// `layerSeeds`: block surfaces along the middle of each buried layer, in
/// the manner of a block search: a grid of positions along the layer for
/// the start and the end of the run; from the start the active wedge rises
/// at 45° + φ/2 to the entry, from the end the passive wedge at 45° − φ/2
/// to the exit (Coulomb; Wright 1988, fig. 6), φ of the material the wedge
/// cuts. Every grid combination within the search limits is evaluated
/// once, and the best few go on to the alternating-variable search. Edris &
/// Wright (1987, para. 86): the initial surface "should be input so that it
/// passes through the weaker material".
struct LayerSeeds {
    /// The next geometry to look at.
    next: usize,
    /// The candidates of the geometry whose batch is out (their planes are
    /// the batch).
    pending: Vec<Candidate>,
    batch: Vec<SearchPlane>,
    out: Vec<LayerSeed>,
    started: bool,
}

impl LayerSeeds {
    fn new() -> Self {
        LayerSeeds {
            next: 0,
            pending: Vec::new(),
            batch: Vec::new(),
            out: Vec::new(),
            started: false,
        }
    }

    /// The candidates of geometry `mi`, or None when it is no buried weak layer.
    fn candidates(slope: &Slope, ground: &Polyline, mi: usize) -> Result<Option<Vec<Candidate>>> {
        let [entry_l, entry_r, exit_l, exit_r] = slope.limits();
        let span = js::math::max(exit_r - entry_l, 1.0);
        let m = &slope.material_geometries()[mi];
        let x_min = js::math::max(js::math::min_of(&m.px), entry_l);
        let x_max = js::math::min(js::math::max_of(&m.px), exit_r);
        if !(x_max - x_min > 0.1 * span) {
            return Ok(None);
        }
        let mid = |x: f64| match polygon_y_extent_at(&m.px, &m.py, x) {
            Some(e) => (e[0] + e[1]) / 2.0,
            None => f64::NAN,
        };
        // A buried layer: its top below the ground (a layer at the surface is
        // covered by the circle seeds).
        let buried = |x: f64| -> Result<bool> {
            let ext = polygon_y_extent_at(&m.px, &m.py, x);
            Ok(match ext {
                Some(e) => e[1] < slope.get_external_y_intersection(x)? - 1e-6,
                None => false,
            })
        };
        // Grid positions along the layer, inside it and buried.
        struct GridPoint {
            x: f64,
            y: f64,
            top: f64,
        }
        let mut grid: Vec<GridPoint> = Vec::new();
        for i in 0..RUN_GRID {
            let x = x_min + ((x_max - x_min) * (i as f64 + 0.5)) / RUN_GRID as f64;
            let ext = polygon_y_extent_at(&m.px, &m.py, x);
            let Some(ext) = ext else { continue };
            if !buried(x)? {
                continue;
            }
            grid.push(GridPoint {
                x,
                y: (ext[0] + ext[1]) / 2.0,
                top: ext[1],
            });
        }
        if grid.len() < 2 || !weakest(slope, mi, grid[grid.len() / 2].x)? {
            return Ok(None);
        }

        let mut candidates: Vec<Candidate> = Vec::new();
        for a in &grid {
            let phi_a = phi_above(slope, mi, a.x, a.top)?;
            let entry = ray_to_ground(
                ground,
                a.x,
                a.y,
                -1.0,
                js::math::tan(PI / 4.0 + phi_a / 2.0),
            );
            let Some(entry) = entry else { continue };
            if entry[0] < entry_l - 1e-9 || entry[0] > entry_r + 1e-9 {
                continue;
            }
            for b in &grid {
                if !(b.x - a.x > 0.1 * span) {
                    continue;
                }
                let phi_b = phi_above(slope, mi, b.x, b.top)?;
                let exit =
                    ray_to_ground(ground, b.x, b.y, 1.0, js::math::tan(PI / 4.0 - phi_b / 2.0));
                let Some(exit) = exit else { continue };
                if exit[0] < exit_l - 1e-9 || exit[0] > exit_r + 1e-9 {
                    continue;
                }
                let mut points: Vec<Pt> = vec![entry, [a.x, a.y]];
                let runs = START_VERTICES - 4;
                for i in 1..runs {
                    let x = a.x + ((b.x - a.x) * i as f64) / runs as f64;
                    let y = mid(x);
                    if !y.is_finite() {
                        break;
                    }
                    points.push([x, y]);
                }
                points.push([b.x, b.y]);
                points.push(exit);
                if !is_admissible_polyline(slope, &points, 1.0) {
                    continue;
                }
                // Moment axis above the middle of the surface, as a circle centre would be.
                let axis: Pt = [
                    (entry[0] + exit[0]) / 2.0,
                    js::math::max(entry[1], exit[1]) + (exit[0] - entry[0]) / 2.0,
                ];
                candidates.push((points, axis));
            }
        }
        Ok(Some(candidates))
    }

    /// Runs to the next buried layer's batch, or ends.
    fn advance(&mut self, slope: &Slope) -> Result<Step<Vec<LayerSeed>>> {
        let Some(ground) = slope.surface_line_xy() else {
            return Ok(Step::Done(std::mem::take(&mut self.out)));
        };
        while self.next < slope.material_geometries().len() {
            let mi = self.next;
            self.next += 1;
            if let Some(candidates) = Self::candidates(slope, ground, mi)? {
                self.batch = candidates
                    .iter()
                    .map(|(points, axis)| make_plane(points.clone(), *axis))
                    .collect();
                self.pending = candidates;
                return Ok(Step::Batch(SearchPhase::Optimise));
            }
        }
        Ok(Step::Done(std::mem::take(&mut self.out)))
    }

    /// The best distinct candidates of the evaluated batch.
    fn choose(&mut self, slope: &Slope) {
        let [entry_l, _, _, exit_r] = slope.limits();
        let span = js::math::max(exit_r - entry_l, 1.0);
        let distinct = |a: &[Pt], b: &[Pt]| {
            (a[0][0] - b[0][0]).abs() > 0.05 * span
                || (a[a.len() - 1][0] - b[b.len() - 1][0]).abs() > 0.05 * span
        };
        let planes = std::mem::take(&mut self.batch);
        let candidates = std::mem::take(&mut self.pending);
        let mut solved: Vec<LayerSeed> = candidates
            .into_iter()
            .zip(planes)
            .filter(|(_, p)| p.fos.is_some_and(f64::is_finite))
            .map(|((points, axis), plane)| LayerSeed {
                points,
                axis,
                plane,
            })
            .collect();
        js::array::sort_by(&mut solved, |a, b| fos_of(&a.plane) - fos_of(&b.plane));
        let mut chosen: Vec<LayerSeed> = Vec::new();
        for c in solved {
            if chosen.len() >= LAYER_SEEDS {
                break;
            }
            if chosen.iter().all(|s| distinct(&s.points, &c.points)) {
                chosen.push(c);
            }
        }
        self.out.extend(chosen);
    }
}

impl PlaneSteps for LayerSeeds {
    type Output = Vec<LayerSeed>;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        &mut self.batch
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<LayerSeed>>> {
        if self.started {
            self.choose(slope);
        }
        self.started = true;
        self.advance(slope)
    }
}

/// The layer seeds, then their searches in lockstep (the generator in
/// optimiseNonCircularSteps).
struct LayerChain {
    budget_per_seed: f64,
    seeds: Option<LayerSeeds>,
    searches: Option<InParallel<Optimised>>,
}

impl LayerChain {
    fn new(budget_per_seed: f64) -> Self {
        LayerChain {
            budget_per_seed,
            seeds: Some(LayerSeeds::new()),
            searches: None,
        }
    }
}

impl PlaneSteps for LayerChain {
    type Output = Vec<Optimised>;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        match (&mut self.seeds, &mut self.searches) {
            (Some(s), _) => s.batch(),
            (None, Some(p)) => p.batch(),
            (None, None) => unreachable!("layer chain without a stage"),
        }
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<Optimised>>> {
        if let Some(seeds) = self.seeds.as_mut() {
            match seeds.resume(slope)? {
                Step::Batch(p) => return Ok(Step::Batch(p)),
                Step::Done(found) => {
                    self.seeds = None;
                    let budget = self.budget_per_seed;
                    self.searches = Some(InParallel::new(
                        found
                            .into_iter()
                            .map(|s| {
                                Box::new(OptimisePoints::new(
                                    s.points, s.axis, budget, s.plane, None, false,
                                )) as BoxedSteps<Optimised>
                            })
                            .collect(),
                    ));
                }
            }
        }
        let searches = self.searches.as_mut().expect("set above");
        searches.resume(slope)
    }
}

// ── The alternating-variable search ───────────────────────────────

/// Where `OptimisePoints` is (the program counter of `optimisePoints`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pc {
    Start,
    SeedCycle1,
    SeedRefine,
    SeedCycle2,
    PolishCheck,
    PolishRefine,
    PolishCycle,
    Finish,
    Done,
}

/// Where `runCycle` is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CycleAt {
    Init,
    DeltaCheck,
    RoundCheck,
    /// The round's batch is out.
    AfterRound,
    /// The permanent move's candidate is out.
    AfterMoved,
}

/// Where `refine` is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefineAt {
    Init,
    AfterYield,
}

/// `optimisePoints`: moves the vertices of `points` by the
/// alternating-variable method until no shift helps. `start_plane` is the
/// evaluated plane of `points`.
///
/// A seed (no `last_gain`): one cycle of shifts, the vertices doubled (up
/// to SEED_MAX_VERTICES), a second cycle. Continuing a surface whose last
/// cycle gained `last_gain`: while a cycle gains more than the analysis
/// tolerance, the vertices are doubled (up to MAX_VERTICES), or else the
/// cycle restarts from the best surface, and another cycle runs.
struct OptimisePoints {
    points: Vec<Pt>,
    axis: Pt,
    budget: f64,
    used: f64,
    best: SearchPlane,
    /// `best !== startPlane`.
    moved: bool,
    /// The start plane is a seed of optimisePolylines.
    seed: bool,
    last_gain: Option<f64>,
    gain: f64,
    polish_cycle: usize,
    pc: Pc,
    batch: Vec<SearchPlane>,
    // runCycle's locals
    cycle_at: CycleAt,
    cycle_start: f64,
    first_shift: f64,
    delta: f64,
    round: usize,
    f0: f64,
    /// The batch index of each vertex's (+Δ, −Δ) candidate.
    sides: Vec<[Option<usize>; 2]>,
    /// The best single shift of the round, kept while the move is out.
    best_single: Option<SearchPlane>,
    // refine's locals
    refine_at: RefineAt,
}

const TOL: f64 = 1e-9;

impl OptimisePoints {
    fn new(
        start: Vec<Pt>,
        axis: Pt,
        budget: f64,
        start_plane: SearchPlane,
        last_gain: Option<f64>,
        seed: bool,
    ) -> Self {
        OptimisePoints {
            points: start,
            axis,
            budget,
            used: 0.0,
            best: start_plane,
            moved: false,
            seed,
            last_gain,
            gain: 0.0,
            polish_cycle: 0,
            pc: Pc::Start,
            batch: Vec::new(),
            cycle_at: CycleAt::Init,
            cycle_start: 0.0,
            first_shift: 0.0,
            delta: 0.0,
            round: 0,
            f0: 0.0,
            sides: Vec::new(),
            best_single: None,
            refine_at: RefineAt::Init,
        }
    }

    /// The plane of a candidate, or None when it is inadmissible (not evaluated).
    fn candidate_plane(&self, slope: &Slope, candidate: Vec<Pt>) -> Result<Option<SearchPlane>> {
        let min_length = js::math::max(slope.min_failure_distance(), 0.0);
        if candidate[candidate.len() - 1][0] - candidate[0][0] <= min_length {
            return Ok(None);
        }
        if slope.min_slip_depth() > 0.0 {
            let mut d = 0.0;
            for &[x, y] in &candidate {
                d = js::math::max(d, slope.get_external_y_intersection(x)? - y);
            }
            if d < slope.min_slip_depth() {
                return Ok(None);
            }
        }
        if !is_admissible_polyline(slope, &candidate, 1.0) {
            return Ok(None);
        }
        Ok(Some(make_plane(candidate, self.axis)))
    }

    /// The vertex k shifted by t along its direction; None when it cannot move.
    fn shifted(slope: &Slope, pts: &[Pt], k: usize, t: f64) -> Result<Option<Pt>> {
        let n = pts.len();
        if k == 0 || k == n - 1 {
            // Entry and exit slide along the ground within the search limits.
            let [entry_l, entry_r, exit_l, exit_r] = slope.limits();
            let mut x = pts[k][0] + t;
            let (lo, hi) = if k == 0 {
                (entry_l, entry_r)
            } else {
                (exit_l, exit_r)
            };
            if x < lo - TOL || x > hi + TOL {
                return Ok(None);
            }
            x = js::math::min(hi, js::math::max(lo, x));
            let neighbour = pts[if k == 0 { 1 } else { k - 1 }][0];
            if if k == 0 {
                x >= neighbour
            } else {
                x <= neighbour
            } {
                return Ok(None);
            }
            // (an exit given as a single x on a vertical face stays at its foot)
            let [x, g] = if k == 0 {
                [x, slope.get_external_y_intersection(x)?]
            } else {
                slope.exit_ground_point(x)?
            };
            return Ok(if g.is_finite() { Some([x, g]) } else { None });
        }
        // Normal to the surface at the vertex: the bisector of the normals of
        // the two segments, pointing up.
        let [ax, ay] = pts[k - 1];
        let [bx, by] = pts[k];
        let [cx, cy] = pts[k + 1];
        let l1 = js::math::hypot(&[bx - ax, by - ay]);
        let l2 = js::math::hypot(&[cx - bx, cy - by]);
        let mut nx = -(by - ay) / l1 - (cy - by) / l2;
        let mut ny = (bx - ax) / l1 + (cx - bx) / l2;
        let ln = js::math::hypot(&[nx, ny]);
        if !(ln > 0.0) {
            return Ok(None);
        }
        nx /= ln;
        ny /= ln;
        Ok(Some([bx + t * nx, by + t * ny]))
    }

    fn with_vertex(pts: &[Pt], k: usize, p: Pt) -> Vec<Pt> {
        let mut c = pts.to_vec();
        c[k] = p;
        c
    }

    /// `runCycle`: one cycle, Δ from a tenth of the shortest segment, halved
    /// down to LAST_SHIFT of it. Some(how much it lowered the FOS) at its
    /// end, None when it yields a batch.
    fn run_cycle(&mut self, slope: &Slope) -> Result<Option<f64>> {
        loop {
            match self.cycle_at {
                CycleAt::Init => {
                    self.cycle_start = fos_of(&self.best);
                    let mut min_segment = f64::INFINITY;
                    for i in 1..self.points.len() {
                        let (p, q) = (self.points[i], self.points[i - 1]);
                        min_segment = js::math::min(
                            min_segment,
                            js::math::hypot(&[p[0] - q[0], p[1] - q[1]]),
                        );
                    }
                    self.first_shift = FIRST_SHIFT * min_segment;
                    if !(self.first_shift > 0.0) {
                        return Ok(Some(0.0));
                    }
                    self.delta = self.first_shift;
                    self.cycle_at = CycleAt::DeltaCheck;
                }
                CycleAt::DeltaCheck => {
                    if !(self.delta >= LAST_SHIFT * self.first_shift && self.used < self.budget) {
                        return Ok(Some(self.cycle_start - fos_of(&self.best)));
                    }
                    self.round = 0;
                    self.cycle_at = CycleAt::RoundCheck;
                }
                CycleAt::RoundCheck => {
                    if !(self.round < ROUNDS_PER_SHIFT && self.used < self.budget) {
                        self.delta /= 2.0;
                        self.cycle_at = CycleAt::DeltaCheck;
                        continue;
                    }
                    self.f0 = fos_of(&self.best);
                    // Every vertex shifted alone, both ways, from the same surface: the
                    // candidates of a round are independent and evaluated as one batch,
                    // in the order (vertex, +Δ, −Δ), as far as the budget goes.
                    let mut sides: Vec<[Option<usize>; 2]> = Vec::new();
                    let mut batch: Vec<SearchPlane> = Vec::new();
                    let mut k = 0;
                    while k < self.points.len() && self.used + (batch.len() as f64) < self.budget {
                        let mut pair: [Option<usize>; 2] = [None, None];
                        for (j, t) in [self.delta, -self.delta].into_iter().enumerate() {
                            let p = Self::shifted(slope, &self.points, k, t)?;
                            let candidate = match p {
                                Some(p) if self.used + (batch.len() as f64) < self.budget => {
                                    Some(Self::with_vertex(&self.points, k, p))
                                }
                                _ => None,
                            };
                            let plane = match candidate {
                                Some(c) => self.candidate_plane(slope, c)?,
                                None => None,
                            };
                            if let Some(plane) = plane {
                                pair[j] = Some(batch.len());
                                batch.push(plane);
                            }
                        }
                        sides.push(pair);
                        k += 1;
                    }
                    self.sides = sides;
                    self.batch = batch;
                    self.cycle_at = CycleAt::AfterRound;
                    return Ok(None);
                }
                CycleAt::AfterRound => {
                    self.used += self.batch.len() as f64;
                    let f0 = self.f0;
                    let delta = self.delta;
                    let mut shifts = vec![0.0; self.points.len()];
                    let mut best_single: Option<usize> = None;
                    for (k, pair) in self.sides.iter().enumerate() {
                        let batch = &self.batch;
                        let mut side = |s: Option<usize>| -> Option<f64> {
                            let i = s?;
                            let f = batch[i].fos.filter(|f| f.is_finite())?;
                            if best_single.is_none_or(|b| f < fos_of(&batch[b])) {
                                best_single = Some(i);
                            }
                            Some(f)
                        };
                        let f_plus = side(pair[0]);
                        let f_minus = side(pair[1]);
                        // The parabola through (−Δ, F−), (0, F0), (+Δ, F+), or the better
                        // side when it has no minimum.
                        let mut t = 0.0;
                        match (f_plus, f_minus) {
                            (Some(fp), Some(fm)) => {
                                let curvature = fp + fm - 2.0 * f0;
                                if curvature > 0.0 {
                                    t = (delta * (fm - fp)) / (2.0 * curvature);
                                    t = js::math::max(-delta, js::math::min(delta, t));
                                } else if fp < f0 || fm < f0 {
                                    t = if fp < fm { delta } else { -delta };
                                }
                            }
                            (Some(fp), None) if fp < f0 => t = delta,
                            (_, Some(fm)) if fm < f0 => t = -delta,
                            _ => {}
                        }
                        shifts[k] = t;
                    }
                    self.best_single = best_single.map(|i| std::mem::take(&mut self.batch[i]));
                    self.batch.clear();

                    // The permanent move: every vertex to its parabola minimum at once.
                    if shifts.iter().any(|&t| t != 0.0) {
                        let mut candidate: Vec<Pt> = Vec::with_capacity(self.points.len());
                        for (k, &t) in shifts.iter().enumerate() {
                            let p = if t != 0.0 {
                                Self::shifted(slope, &self.points, k, t)?
                            } else {
                                Some(self.points[k])
                            };
                            let Some(p) = p else {
                                candidate.clear();
                                break;
                            };
                            candidate.push(p);
                        }
                        if candidate.len() == self.points.len() {
                            // fosOf(candidate)
                            if self.used < self.budget {
                                if let Some(plane) = self.candidate_plane(slope, candidate)? {
                                    self.batch = vec![plane];
                                    self.cycle_at = CycleAt::AfterMoved;
                                    return Ok(None);
                                }
                            }
                        }
                    }
                    self.decide(None);
                }
                CycleAt::AfterMoved => {
                    self.used += 1.0;
                    let plane = self.batch.pop().expect("the evaluated move");
                    let moved = if plane.fos.is_some_and(f64::is_finite) {
                        Some(plane)
                    } else {
                        None
                    };
                    self.decide(moved);
                }
            }
        }
    }

    /// The end of a round: the better of the move and the best single
    /// shift becomes the surface if it lowers the FOS; else the shift is
    /// halved (TypeScript's `break` out of the rounds).
    fn decide(&mut self, mut moved: Option<SearchPlane>) {
        if let Some(bs) = self.best_single.take() {
            if moved.as_ref().is_none_or(|m| fos_of(&bs) < fos_of(m)) {
                moved = Some(bs);
            }
        }
        match moved {
            Some(m) if !(fos_of(&m) >= self.f0 - 1e-6) => {
                self.points = m.points.clone().expect("a polyline");
                self.best = m;
                self.moved = true;
                self.round += 1;
                self.cycle_at = CycleAt::RoundCheck;
            }
            _ => {
                self.delta /= 2.0;
                self.cycle_at = CycleAt::DeltaCheck;
            }
        }
    }

    /// `refine`: doubles the vertices for a finer shape (keeping the best
    /// surface found: the extra slice boundaries change the FOS slightly),
    /// or, past `max_vertices`, restarts from the best surface. Some(false)
    /// when it cannot; None when it yields.
    fn refine(&mut self, max_vertices: usize, restart: bool) -> Option<bool> {
        match self.refine_at {
            RefineAt::Init => {
                if self.used >= self.budget {
                    return Some(false);
                }
                if 2 * self.points.len() - 1 > max_vertices {
                    if !restart {
                        return Some(false);
                    }
                    if let Some(p) = &self.best.points {
                        self.points = p.clone();
                    }
                    return Some(true);
                }
                let mut refined: Vec<Pt> = vec![self.points[0]];
                for i in 1..self.points.len() {
                    let [ax, ay] = self.points[i - 1];
                    let [bx, by] = self.points[i];
                    refined.push([(ax + bx) / 2.0, (ay + by) / 2.0]);
                    refined.push([bx, by]);
                }
                self.batch = vec![make_plane(refined, self.axis)];
                self.refine_at = RefineAt::AfterYield;
                None
            }
            RefineAt::AfterYield => {
                self.refine_at = RefineAt::Init;
                self.used += 1.0;
                let plane = self.batch.pop().expect("the evaluated refinement");
                let Some(f) = plane.fos else {
                    return Some(false);
                };
                self.points = plane.points.clone().expect("a polyline");
                if f < fos_of(&self.best) {
                    self.best = plane;
                    self.moved = true;
                }
                Some(true)
            }
        }
    }
}

impl PlaneSteps for OptimisePoints {
    type Output = Optimised;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        &mut self.batch
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Optimised>> {
        loop {
            match self.pc {
                Pc::Start => match self.last_gain {
                    None => {
                        self.cycle_at = CycleAt::Init;
                        self.pc = Pc::SeedCycle1;
                    }
                    Some(g) => {
                        self.gain = g;
                        self.polish_cycle = 0;
                        self.pc = Pc::PolishCheck;
                    }
                },
                Pc::SeedCycle1 => match self.run_cycle(slope)? {
                    None => return Ok(Step::Batch(SearchPhase::Optimise)),
                    Some(g) => {
                        self.gain = g;
                        self.refine_at = RefineAt::Init;
                        self.pc = Pc::SeedRefine;
                    }
                },
                Pc::SeedRefine => match self.refine(SEED_MAX_VERTICES, false) {
                    None => return Ok(Step::Batch(SearchPhase::Optimise)),
                    Some(true) => {
                        self.cycle_at = CycleAt::Init;
                        self.pc = Pc::SeedCycle2;
                    }
                    Some(false) => self.pc = Pc::Finish,
                },
                Pc::SeedCycle2 => match self.run_cycle(slope)? {
                    None => return Ok(Step::Batch(SearchPhase::Optimise)),
                    Some(g) => {
                        self.gain = g;
                        self.pc = Pc::Finish;
                    }
                },
                Pc::PolishCheck => {
                    if self.polish_cycle < POLISH_CYCLES && self.gain > slope.tolerance() {
                        self.refine_at = RefineAt::Init;
                        self.pc = Pc::PolishRefine;
                    } else {
                        self.pc = Pc::Finish;
                    }
                }
                Pc::PolishRefine => match self.refine(MAX_VERTICES, true) {
                    None => return Ok(Step::Batch(SearchPhase::Optimise)),
                    Some(true) => {
                        self.cycle_at = CycleAt::Init;
                        self.pc = Pc::PolishCycle;
                    }
                    Some(false) => self.pc = Pc::Finish,
                },
                Pc::PolishCycle => match self.run_cycle(slope)? {
                    None => return Ok(Step::Batch(SearchPhase::Optimise)),
                    Some(g) => {
                        self.gain = g;
                        self.polish_cycle += 1;
                        self.pc = Pc::PolishCheck;
                    }
                },
                Pc::Finish => {
                    self.pc = Pc::Done;
                    let best = std::mem::take(&mut self.best);
                    let points = match &best.points {
                        Some(p) => p.clone(),
                        None => std::mem::take(&mut self.points),
                    };
                    return Ok(Step::Done(Optimised {
                        plane: best,
                        points,
                        axis: self.axis,
                        gain: self.gain,
                        moved: self.moved,
                        seed: self.seed,
                    }));
                }
                Pc::Done => {
                    return Err(crate::error::EngineError::new(
                        "optimisePoints: resumed after the end",
                    ));
                }
            }
        }
    }
}
