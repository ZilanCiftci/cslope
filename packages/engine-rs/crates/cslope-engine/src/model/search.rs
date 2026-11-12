//! Port of packages/engine/src/model/search.ts
//!
//! Search plane generation for slope stability analysis. (The evaluation of
//! the planes is solvers.ts's.)

use crate::error::Result;
use crate::js;
use crate::math::circle::{circle_centre, circle_radius_from_abcd};
use crate::math::helpers::{dist_points, mid_coord};
use crate::math::interpolation::get_y_at_x;
use crate::math::polygon::is_point_in_polygon;
use crate::model::composite::{circle_below_bare_base, floor_dip_tolerance, unique_numbers};
use crate::model::slope::{Pt, SearchPlane, Slope};
use crate::model::surface::circle_leaves_model;
use crate::types::material::MaterialId;
use std::collections::HashSet;

struct SearchGridSpec {
    num_circles: f64,
    num_points_top: f64,
    num_points_bot: f64,
}

fn round_to(value: f64, decimals: f64) -> f64 {
    let scale = js::math::pow(10.0, decimals);
    js::math::round(value * scale) / scale
}

/// The key that identifies a plane (rounded to 0.1 mm) for deduplication:
/// `cx|cy|radius`, or the points `x,y;x,y;…` of a non-circular surface.
/// Numbers print as JavaScript prints them (`-0` as `0`).
pub fn plane_key(plane: &SearchPlane) -> String {
    let s = |v: f64| js::num::to_string(round_to(v, 4.0));
    if let Some(points) = &plane.points {
        return points
            .iter()
            .map(|&[x, y]| format!("{},{}", s(x), s(y)))
            .collect::<Vec<_>>()
            .join(";");
    }
    format!("{}|{}|{}", s(plane.cx), s(plane.cy), s(plane.radius))
}

/// The sides of the search given as a point: the x of their points in the
/// first pass, None for a range. A side whose limits are one x has one
/// point. A point on a corner of the ground, which `Slope::search_limits`
/// widens by 1e-5 of the model's width, is still a point: its first-pass
/// points are the two ends of the widened limit, not a grid spread over
/// that width (issue #157).
struct PointSides {
    entry: Option<Vec<f64>>,
    exit: Option<Vec<f64>>,
}

fn point_sides(slope: &Slope) -> PointSides {
    let raw = slope.limits();
    let limits = slope.search_limits();
    let width = match slope.surface_line_xy() {
        Some(s) if s.x.len() >= 2 => js::math::max_of(&s.x) - js::math::min_of(&s.x),
        _ => {
            return PointSides {
                entry: None,
                exit: None,
            }
        }
    };
    let tol = 1e-9 * width;
    let side = |r0: f64, r1: f64, s0: f64, s1: f64| -> Option<Vec<f64>> {
        if (r1 - r0).abs() > tol {
            return None;
        }
        Some(if s1 - s0 > tol {
            vec![s0, s1]
        } else {
            vec![s0]
        })
    };
    PointSides {
        entry: side(raw[0], raw[1], limits[0], limits[1]),
        exit: side(raw[2], raw[3], limits[2], limits[3]),
    }
}

/// The grid of the first pass. A side given as a point gets its own points
/// only (`point_sides`), and the other side and the radii stay as for a
/// range: the budget of the coinciding points is not spent elsewhere
/// (issue #157, option C).
fn get_search_grid_spec(slope: &Slope) -> SearchGridSpec {
    let mut spec = range_grid_spec(slope);
    let points = point_sides(slope);
    if points.entry.is_some() {
        spec.num_points_top = 1.0;
    }
    if points.exit.is_some() {
        spec.num_points_bot = 0.0;
    }
    spec
}

/// The number of circles per entry-exit pair in the first pass (issue
/// #160): sagittas evenly spaced from 95 % to 5 % of the reference depth
/// (`generate_planes_with_scale`).
const FIRST_PASS_CIRCLES: f64 = 11.0;

/// A vertex of the ground where it turns by more than this (30°) is a
/// break point of a range: the first pass puts a point on it (issue #164).
/// Chosen by measurement: from 10° to 25° the toe of a 2:1 slope (26.6°)
/// counted and V026's Morgenstern-Price search fell 2.6 % (further below
/// Bishop); at 40° fewer imported models gained, and at 50° the toe of a
/// 1:1 slope (45°) was left out.
const BREAK_MIN_TURN: f64 = std::f64::consts::FRAC_PI_6;

/// At most this share of a range's first-pass points is moved onto break
/// points, the sharpest first: a surveyed ground with many vertices keeps
/// the rest of its points evenly spaced (issue #164).
const BREAK_MAX_SHARE: f64 = 0.5;

/// The grid of a search between two ranges. The first pass has 9 entry and
/// 11 exit points at 1 000 iterations, scaled with the square root of the
/// iterations (FIRST_PASS_CIRCLES circles per pair: 1 089 at 1 000). The
/// refinement and the local search step by this spacing; `num_circles` is
/// their number of circles per pair, as before issue #160 (at least 5, and
/// one per 800 iterations).
fn range_grid_spec(slope: &Slope) -> SearchGridSpec {
    let num_circles = js::math::max(5.0, (slope.iterations() / 800.0).floor());
    let k = (slope.iterations() / 1000.0).sqrt();
    // The entry points next to loads (setEntryExitPlanes) come on top of
    // this grid, so that at least two entry points are always left.
    let num_points_top = js::math::max(2.0, js::math::round(9.0 * k));
    let num_points_bot = js::math::max(1.0, js::math::round(11.0 * k) - 1.0);

    SearchGridSpec {
        num_circles,
        num_points_top,
        num_points_bot,
    }
}

/// The ground paths of the entry and the exit range, for the sides that
/// are ranges whose ground is not one straight line (issue #158).
fn ground_paths(
    slope: &Slope,
    grid: &SearchGridSpec,
) -> Result<(Option<GroundPath>, Option<GroundPath>)> {
    let points = point_sides(slope);
    let [entry_left_x, entry_right_x, exit_left_x, exit_right_x] = slope.search_limits();
    let entry = if points.entry.is_none() && grid.num_points_top > 1.0 {
        GroundPath::new(slope, entry_left_x, entry_right_x, false)?
    } else {
        None
    };
    let exit = if points.exit.is_none() && grid.num_points_bot > 0.0 {
        GroundPath::new(slope, exit_left_x, exit_right_x, true)?
    } else {
        None
    };
    Ok((entry, exit))
}

/// The ground between two x as a path, along which the search spaces its
/// entry or exit points evenly (issue #158): across slope breaks, and down
/// a vertical face inside the range. A face at an end of the range lies at
/// the limit's x and belongs to the range whole, except at an end of an
/// exit range on a face that descends in the sliding direction: that end
/// is the foot of the face, as a single exit there is
/// (`Slope::exit_face_foot`, issue #147). An exit range starting at such a
/// face starts at its foot; one ending at it runs down the face to its
/// foot. None when the ground there is one straight segment: equal steps
/// along it are equal steps in x, and the points are computed in x as
/// before.
struct GroundPath {
    pts: Vec<Pt>,
    /// Distance along the path to each point.
    cum: Vec<f64>,
}

impl GroundPath {
    fn new(slope: &Slope, a: f64, b: f64, exit: bool) -> Result<Option<GroundPath>> {
        let Some(surf) = slope.surface_line_xy() else {
            return Ok(None);
        };
        let (xs, ys) = (&surf.x, &surf.y);
        if xs.len() < 2 || ys.len() < xs.len() {
            return Ok(None);
        }
        let tol = 1e-9 * (js::math::max_of(xs) - js::math::min_of(xs));
        if !(b - a > tol) {
            return Ok(None);
        }
        let inner: Vec<Pt> = (0..xs.len())
            .filter(|&i| xs[i] >= a - tol && xs[i] <= b + tol)
            .map(|i| [xs[i], ys[i]])
            .collect();
        let mut pts: Vec<Pt> = Vec::new();
        if !inner.first().is_some_and(|p| (p[0] - a).abs() <= tol) {
            pts.push([a, slope.get_external_y_intersection(a)?]);
        }
        pts.extend(inner.iter().copied());
        if !inner.last().is_some_and(|p| (p[0] - b).abs() <= tol) {
            pts.push([b, slope.get_external_y_intersection(b)?]);
        }
        pts.dedup_by(|p, q| (p[0] - q[0]).abs() <= tol && (p[1] - q[1]).abs() <= tol);
        if exit {
            // An end on a face that descends towards the exit: its foot.
            if let Some(foot) = slope.exit_face_foot(a) {
                let k = pts
                    .iter()
                    .rposition(|p| (p[0] - a).abs() <= tol)
                    .unwrap_or(0);
                pts.drain(..k);
                pts.insert(0, foot);
            }
            if let Some(foot) = slope.exit_face_foot(b) {
                let last = pts.len() - 1;
                pts[last] = foot;
            }
        }
        if pts.len() <= 2 {
            return Ok(None);
        }
        // Collinear points only: one straight segment.
        let p0 = pts[0];
        let pn = pts[pts.len() - 1];
        let l = js::math::hypot(&[pn[0] - p0[0], pn[1] - p0[1]]);
        let straight = pts[1..pts.len() - 1].iter().all(|p| {
            ((p[0] - p0[0]) * (pn[1] - p0[1]) - (p[1] - p0[1]) * (pn[0] - p0[0])).abs() / l
                <= 1e-9 * js::math::max(1.0, l)
        });
        if straight {
            return Ok(None);
        }
        let mut cum = vec![0.0];
        for k in 1..pts.len() {
            let d = js::math::hypot(&[pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]]);
            cum.push(cum[k - 1] + d);
        }
        Ok(Some(GroundPath { pts, cum }))
    }

    /// The path's length.
    fn len(&self) -> f64 {
        self.cum[self.cum.len() - 1]
    }

    /// The point at distance s along the path (clamped to its ends).
    fn at(&self, s: f64) -> Pt {
        let s = js::math::min(js::math::max(s, 0.0), self.len());
        for k in 1..self.pts.len() {
            if s <= self.cum[k] || k == self.pts.len() - 1 {
                let seg = self.cum[k] - self.cum[k - 1];
                let t = if seg > 0.0 {
                    (s - self.cum[k - 1]) / seg
                } else {
                    0.0
                };
                let (p, q) = (self.pts[k - 1], self.pts[k]);
                return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
            }
        }
        self.pts[0]
    }

    /// The distance along the path of the path's point nearest to p.
    fn s_of(&self, p: Pt) -> f64 {
        let mut best = f64::INFINITY;
        let mut s_best = 0.0;
        for k in 1..self.pts.len() {
            let (a, b) = (self.pts[k - 1], self.pts[k]);
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let qa = dx * dx + dy * dy;
            let t = if qa > 0.0 {
                js::math::min(
                    1.0,
                    js::math::max(0.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / qa),
                )
            } else {
                0.0
            };
            let d = js::math::hypot(&[a[0] + t * dx - p[0], a[1] + t * dy - p[1]]);
            if d < best {
                best = d;
                s_best = self.cum[k - 1] + t * (self.cum[k] - self.cum[k - 1]);
            }
        }
        s_best
    }

    /// The break points of the ground inside the path (issue #164): the
    /// vertices strictly between its ends where the ground turns by more
    /// than BREAK_MIN_TURN, as distances along the path, the sharpest
    /// first (ties: in path order).
    fn break_points(&self) -> Vec<f64> {
        let l = self.len();
        let mut out: Vec<(f64, f64)> = Vec::new();
        for k in 1..self.pts.len() - 1 {
            let (p, q, r) = (self.pts[k - 1], self.pts[k], self.pts[k + 1]);
            let (ax, ay) = (q[0] - p[0], q[1] - p[1]);
            let (bx, by) = (r[0] - q[0], r[1] - q[1]);
            let turn = js::math::atan2(ax * by - ay * bx, ax * bx + ay * by).abs();
            let s = self.cum[k];
            if turn > BREAK_MIN_TURN && s > 1e-9 * l && s < l - 1e-9 * l {
                out.push((s, turn));
            }
        }
        out.sort_by(|a, b| b.1.total_cmp(&a.1));
        out.into_iter().map(|(s, _)| s).collect()
    }

    /// The n points of the first pass along the path (issue #164): n points
    /// at equal distances, both ends included, of which the inner ones
    /// nearest to the break points of the ground are moved onto them, the
    /// sharpest break first and each point at most once. At most
    /// BREAK_MAX_SHARE of the points (and never an end) are moved, so a
    /// surveyed ground with many vertices keeps its sharpest ones only.
    /// `corner_offset`: on an exit range a break point stands for the point
    /// that far up the ground from it, as the corner rule of
    /// `Slope::search_limits` puts the exit at the toe (a circle exactly
    /// through the corner can just touch it and run on in the soil); at the
    /// foot of a vertical face that is the point `Slope::exit_face_foot`
    /// gives.
    fn first_pass_points(&self, n: f64, corner_offset: f64) -> Vec<Pt> {
        if n < 3.0 {
            return self.points(n);
        }
        let count = n as usize;
        let l = self.len();
        let mut s: Vec<f64> = (0..count).map(|i| l * i as f64 / (n - 1.0)).collect();
        let mut moved = vec![false; count];
        let max_breaks = js::math::max(1.0, (BREAK_MAX_SHARE * n).floor()) as usize;
        for b in self.break_points().into_iter().take(max_breaks) {
            let mut nearest: Option<usize> = None;
            for i in 1..count - 1 {
                if !moved[i] && nearest.is_none_or(|j| (s[i] - b).abs() < (s[j] - b).abs()) {
                    nearest = Some(i);
                }
            }
            let Some(i) = nearest else {
                break;
            };
            s[i] = b;
            moved[i] = true;
        }
        s.iter()
            .zip(&moved)
            .map(|(&si, &m)| {
                if m {
                    self.at(si - corner_offset)
                } else {
                    self.at(si)
                }
            })
            .collect()
    }

    /// n points at equal distances along the path, both ends included.
    fn points(&self, n: f64) -> Vec<Pt> {
        if n <= 1.0 {
            return vec![self.pts[0]];
        }
        let mut out = Vec::new();
        let mut i = 0.0;
        while i < n {
            out.push(self.at(self.len() * i / (n - 1.0)));
            i += 1.0;
        }
        out
    }
}

/// Entry and exit of the slip surface on a circle: the first crossing of
/// the lower arc with the ground where the arc goes from air into soil,
/// and the next crossing where it comes out again.
///
/// Taking simply the first two crossings by x is wrong when
///  - a crossing lies on the upper half of the circle (e.g. on the crest
///    behind a vertical face): the slices would hang from the lower arc
///    metres below the ground, i.e. a free vertical crack, or
///  - the arc only touches the ground at a vertex (typically the toe) and
///    stays in the soil: the mass beyond it, and its resistance, was cut
///    off.
///
/// Returns None when the circle has no such entry/exit pair.
pub fn select_entry_exit(slope: &Slope, cx: f64, cy: f64, radius: f64) -> Result<Option<(Pt, Pt)>> {
    let tol = 1e-9 * js::math::max(1.0, radius);
    let mut crossings = slope.get_circle_external_intersection(cx, cy, radius)?;
    crossings.retain(|p| p[1] <= cy + tol);
    if crossings.len() < 2 {
        return Ok(None);
    }

    let eps = 1e-6 * js::math::max(1.0, radius);
    let arc_in_soil = |x: f64| -> bool {
        let term = js::math::pow(radius, 2.0) - js::math::pow(x - cx, 2.0);
        if term < 0.0 {
            return false;
        }
        slope.is_inside_external_boundary(x, cy - term.sqrt())
    };

    for i in 0..crossings.len() - 1 {
        let ex = crossings[i][0];
        if arc_in_soil(ex - eps) || !arc_in_soil(ex + eps) {
            continue;
        }
        for c in &crossings[i + 1..] {
            if !arc_in_soil(c[0] + eps) {
                return Ok(Some((crossings[i], *c)));
            }
        }
        return Ok(None);
    }
    Ok(None)
}

/// True when a circular plane from its entry to its exit stays inside the
/// model (a prescribed circle that leaves it, e.g. through its base, is not
/// analysed). `as_circle`: whether the circle itself stays inside, also with
/// composite surfaces (TypeScript's default: false).
pub fn is_plane_within_external_boundary(
    slope: &Slope,
    plane: &SearchPlane,
    as_circle: bool,
) -> bool {
    // A composite circle follows the floor where it would leave the model
    // (model/composite.rs): the top of rock on the base, and the base itself
    // with compositeBase; between its entry and exit on the ground it cannot
    // leave the model otherwise, except through the bare base (not followed).
    let floor = if !as_circle && slope.composite_surfaces() {
        slope.composite_floor()
    } else {
        None
    };
    if let Some(floor) = floor {
        let a = js::math::min(plane.lc[0], plane.rc[0]);
        let b = js::math::max(plane.lc[0], plane.rc[0]);
        return floor.bare.is_empty()
            || !circle_below_bare_base(
                floor,
                plane.cx,
                plane.cy,
                plane.radius,
                a,
                b,
                floor_dip_tolerance(slope.model_height()),
            );
    }
    let x_span = (plane.rc[0] - plane.lc[0]).abs();
    let sample_count = js::math::min(64.0, js::math::max(12.0, (x_span / 8.0).ceil()));

    let mut i = 1.0;
    while i < sample_count {
        let t = i / sample_count;
        i += 1.0;
        let x = plane.lc[0] + (plane.rc[0] - plane.lc[0]) * t;
        let radius_term = js::math::pow(plane.radius, 2.0) - js::math::pow(x - plane.cx, 2.0);

        if radius_term < 0.0 {
            return false;
        }

        let y = plane.cy - js::math::max(0.0, radius_term).sqrt();

        if !slope.is_inside_external_boundary(x, y + 1e-6) {
            return false;
        }
    }

    // The lowest point, where a circle tangent to the base touches it.
    let x0 = js::math::min(plane.lc[0], plane.rc[0]);
    let x1 = js::math::max(plane.lc[0], plane.rc[0]);
    if plane.cx > x0
        && plane.cx < x1
        && !slope.is_inside_external_boundary(plane.cx, plane.cy - plane.radius + 1e-6)
    {
        return false;
    }
    // Between the samples the arc can pass below a re-entrant corner of the
    // base, or a little below a sloping base (V053: 751 of 3015 first-pass
    // circles more than 0.1 mm below it, up to 8.7 cm).
    !circle_leaves_model(slope, plane.cx, plane.cy, plane.radius, x0, x1)
}

/// The search limits and the minimum failure distance, read once per
/// generation (`slope.searchLimits` is computed on each read).
struct SearchWindow {
    limits: [f64; 4],
    min_failure_distance: f64,
}

impl SearchWindow {
    fn of(slope: &Slope) -> Self {
        SearchWindow {
            limits: slope.search_limits(),
            min_failure_distance: slope.min_failure_distance(),
        }
    }
}

/// How far (in x) an end of a surface may lie outside the search limits.
const LIMIT_TOL: f64 = 1e-9;

/// True when a plane's actual entry/exit points lie within the search
/// limits and it is longer (horizontally) than the minimum failure
/// distance. Circles generated through grid points can intersect the
/// ground elsewhere, so this must be checked on the plane itself.
fn is_plane_within_search_limits(window: &SearchWindow, plane: &SearchPlane) -> bool {
    let [entry_left_x, entry_right_x, exit_left_x, exit_right_x] = window.limits;
    let tol = LIMIT_TOL;
    plane.lc[0] >= entry_left_x - tol
        && plane.lc[0] <= entry_right_x + tol
        && plane.rc[0] >= exit_left_x - tol
        && plane.rc[0] <= exit_right_x + tol
        && plane.rc[0] - plane.lc[0] > js::math::max(window.min_failure_distance, 0.0)
}

// ── Material interfaces and tangent circles ───────────────────────

/// The boundary between two materials, as straight segments (flat
/// x0, y0, x1, y1, …). One per pair of materials that touch inside the
/// model; the top of impenetrable or high-strength material is one of them.
#[derive(Debug, Clone, PartialEq)]
pub struct MaterialInterface {
    pub segs: Vec<f64>,
}

/// Edges of the material regions that have a different material on either
/// side, grouped by the pair of materials. Edges on the external boundary
/// (nothing on one side) and between regions of one material (no contrast;
/// also the bridge edges of a region with holes) are left out. Cached on
/// the slope (`Slope::material_interfaces`; a WeakMap in TypeScript).
pub fn material_interfaces(slope: &Slope) -> &[MaterialInterface] {
    slope.material_interfaces.get_or_init(|| {
        let geoms = slope.material_geometries();
        let region_at = |x: f64, y: f64| -> Option<usize> {
            geoms
                .iter()
                .position(|g| is_point_in_polygon(x, y, &g.px, &g.py))
        };
        let mut material_ids: Vec<MaterialId> = Vec::new();
        let mut id_of = |m: MaterialId| -> usize {
            match material_ids.iter().position(|&v| v == m) {
                Some(i) => i,
                None => {
                    material_ids.push(m);
                    material_ids.len() - 1
                }
            }
        };
        let offset = 1e-6 * js::math::max(1.0, slope.model_height());
        let mut by_pair: Vec<(String, Vec<f64>)> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let key_of = |x: f64, y: f64| {
            format!(
                "{},{}",
                js::num::to_string(round_to(x, 6.0)),
                js::num::to_string(round_to(y, 6.0))
            )
        };
        if geoms.len() > 1 {
            for g in geoms {
                let n = g.px.len();
                for i in 0..n {
                    let j = (i + 1) % n;
                    let x0 = g.px[i];
                    let y0 = g.py[i];
                    let x1 = g.px[j];
                    let y1 = g.py[j];
                    let len = js::math::hypot(&[x1 - x0, y1 - y0]);
                    if len < 1e-9 {
                        continue;
                    }
                    let a = key_of(x0, y0);
                    let b = key_of(x1, y1);
                    // (JavaScript compares the strings by UTF-16 code units;
                    // these are ASCII)
                    let key = if a < b {
                        format!("{a};{b}")
                    } else {
                        format!("{b};{a}")
                    };
                    if !seen.insert(key) {
                        continue;
                    }
                    let mx = (x0 + x1) / 2.0;
                    let my = (y0 + y1) / 2.0;
                    let nx = -(y1 - y0) / len;
                    let ny = (x1 - x0) / len;
                    let (Some(ra), Some(rb)) = (
                        region_at(mx + offset * nx, my + offset * ny),
                        region_at(mx - offset * nx, my - offset * ny),
                    ) else {
                        continue;
                    };
                    let ma = geoms[ra].material;
                    let mb = geoms[rb].material;
                    if ma == mb {
                        continue;
                    }
                    let ia = id_of(ma);
                    let ib = id_of(mb);
                    let pair = if ia < ib {
                        format!("{ia}|{ib}")
                    } else {
                        format!("{ib}|{ia}")
                    };
                    let segs = match by_pair.iter().position(|(k, _)| *k == pair) {
                        Some(p) => &mut by_pair[p].1,
                        None => {
                            by_pair.push((pair, Vec::new()));
                            &mut by_pair.last_mut().expect("just pushed").1
                        }
                    };
                    segs.extend_from_slice(&[x0, y0, x1, y1]);
                }
            }
        }
        by_pair
            .into_iter()
            .map(|(_, segs)| MaterialInterface { segs })
            .collect()
    })
}

/// The circle through lc and rc whose arc lies chordToEdge below the chord
/// (cx, cy, radius).
fn circle_through(lc: Pt, rc: Pt, chord_to_edge: f64) -> Option<(f64, f64, f64)> {
    let c = js::math::pow(dist_points(lc, rc) / 2.0, 2.0);
    let radius = circle_radius_from_abcd(chord_to_edge, c)?;
    if !(radius > 0.0) {
        return None;
    }
    let beta = js::math::atan((lc[1] - rc[1]) / (rc[0] - lc[0]));
    let [cx, cy] = circle_centre(beta, mid_coord(lc, rc), radius - chord_to_edge);
    Some((cx, cy, radius))
}

/// True when the region between the chord lc–rc and the arc chordToEdge
/// below it (a circular segment) contains part of the interface. The arcs
/// through two fixed points are nested, so this is monotonic in
/// chordToEdge: false above the depth where the arc first touches the
/// interface, true below it.
fn arc_reaches_interface(lc: Pt, rc: Pt, chord_to_edge: f64, iface: &MaterialInterface) -> bool {
    let Some((cx, cy, radius)) = circle_through(lc, rc, chord_to_edge) else {
        return false;
    };
    // Unit normal of the chord pointing up, away from the arc, which is the
    // lower one also for a pair given right to left (rc left of lc: the
    // first pass pairs every entry with every exit, and the ranges overlap
    // when no limits are set). Before, such a pair took the normal pointing
    // down, looked for the interface above the chord and had no tangent
    // circle.
    let len = dist_points(lc, rc);
    let up = if rc[0] < lc[0] { -1.0 } else { 1.0 };
    let nx = -up * (rc[1] - lc[1]) / len;
    let ny = up * (rc[0] - lc[0]) / len;
    let [mx, my] = mid_coord(lc, rc);
    let min_length = 1e-9 * js::math::max(1.0, len);
    let s = &iface.segs;
    let mut k = 0;
    while k < s.len() {
        let ax = s[k];
        let ay = s[k + 1];
        let dx = s[k + 2] - ax;
        let dy = s[k + 3] - ay;
        k += 4;
        // Part of the segment inside the circle: |A + t·d − C|² < R².
        let fx = ax - cx;
        let fy = ay - cy;
        let qa = dx * dx + dy * dy;
        let qb = 2.0 * (fx * dx + fy * dy);
        let qc = fx * fx + fy * fy - radius * radius;
        let disc = qb * qb - 4.0 * qa * qc;
        if disc <= 0.0 {
            continue;
        }
        let sq = disc.sqrt();
        let mut t0 = js::math::max(0.0, (-qb - sq) / (2.0 * qa));
        let mut t1 = js::math::min(1.0, (-qb + sq) / (2.0 * qa));
        if t0 >= t1 {
            continue;
        }
        // ... and on the arc's side of the chord: s0 + t·ds < 0.
        let s0 = (ax - mx) * nx + (ay - my) * ny;
        let ds = dx * nx + dy * ny;
        if ds.abs() < 1e-15 {
            if s0 >= 0.0 {
                continue;
            }
        } else if ds > 0.0 {
            t1 = js::math::min(t1, -s0 / ds);
        } else {
            t0 = js::math::max(t0, -s0 / ds);
        }
        if (t1 - t0) * qa.sqrt() > min_length {
            return true;
        }
    }
    false
}

/// Chord-to-arc distance of the circle through lc and rc that touches the
/// interface from above, found by bisection between a shallow arc and
/// maxChordToEdge; None when no arc in that range touches it, or when the
/// interface crosses the chord itself (every arc then cuts it).
fn tangent_chord_to_edge(
    lc: Pt,
    rc: Pt,
    iface: &MaterialInterface,
    max_chord_to_edge: f64,
) -> Option<f64> {
    if !(max_chord_to_edge > 0.0) {
        return None;
    }
    let mut above = max_chord_to_edge * 1e-4;
    if arc_reaches_interface(lc, rc, above, iface) {
        return None;
    }
    let mut below = max_chord_to_edge;
    if !arc_reaches_interface(lc, rc, below, iface) {
        return None;
    }
    for _ in 0..30 {
        let mid = (above + below) / 2.0;
        if arc_reaches_interface(lc, rc, mid, iface) {
            below = mid;
        } else {
            above = mid;
        }
    }
    Some(above)
}

/// True when a circle touches the interface where the interface meets the
/// ground, between the circle's ends: the arc then grazes the ground
/// surface (at a bench edge, say) and the sliding mass falls apart into two
/// at that point. The real exit is the grazing point, so such a circle
/// could also slip past the search limits. Not a tangent circle.
fn touches_ground_between_ends(
    slope: &Slope,
    plane: &SearchPlane,
    iface: &MaterialInterface,
) -> bool {
    let Some(ground) = slope.surface_line_xy() else {
        return false;
    };
    // The touching point: the point of the interface closest to the centre.
    let mut best = f64::INFINITY;
    let mut tx = 0.0;
    let mut ty = 0.0;
    let seg = &iface.segs;
    let mut k = 0;
    while k < seg.len() {
        let ax = seg[k];
        let ay = seg[k + 1];
        let dx = seg[k + 2] - ax;
        let dy = seg[k + 3] - ay;
        k += 4;
        let qa = dx * dx + dy * dy;
        let t = if qa > 0.0 {
            js::math::min(
                1.0,
                js::math::max(0.0, ((plane.cx - ax) * dx + (plane.cy - ay) * dy) / qa),
            )
        } else {
            0.0
        };
        let px = ax + t * dx;
        let py = ay + t * dy;
        let d = js::math::hypot(&[px - plane.cx, py - plane.cy]);
        if d < best {
            best = d;
            tx = px;
            ty = py;
        }
    }
    let tol = 1e-6 * js::math::max(1.0, plane.radius);
    tx > plane.lc[0] + tol
        && tx < plane.rc[0] - tol
        && (get_y_at_x(&ground.x, &ground.y, tx) - ty).abs() < tol
}

/// Basin of a circle for choosing the seeds of the refinement and the local
/// search: the material region at its lowest point (-1: none). Circles that
/// bottom out in one layer, or on one interface from above, form one family
/// with its own local minimum (toe, face and deep circles; Duncan & Wright
/// 2014, ch. 14; USACE EM 1110-2-1902, 2003, para. E-3a). (TypeScript
/// memoises it per plane object; it is a pure function of the plane.)
fn basin_of(slope: &Slope, plane: &SearchPlane) -> i64 {
    let x = js::math::min(js::math::max(plane.cx, plane.lc[0]), plane.rc[0]);
    let y = plane.cy
        - js::math::max(
            0.0,
            js::math::pow(plane.radius, 2.0) - js::math::pow(x - plane.cx, 2.0),
        )
        .sqrt()
        + 1e-6 * js::math::max(1.0, plane.radius);
    slope
        .material_geometries()
        .iter()
        .position(|g| is_point_in_polygon(x, y, &g.px, &g.py))
        .map_or(-1, |g| g as i64)
}

/// Most extra seeds, one per further basin, beyond the global best ones.
const MAX_BASIN_SEEDS: usize = 4;

/// Local search: a further basin gets a seed when its best FOS is within
/// this factor of the global best. A level of the local search moves a
/// surface by a fraction of the grid step and lowers its FOS by a fraction
/// of a percent; a basin further off cannot overtake, and its seed would
/// only take budget from the levels that converge on the minimum.
const LOCAL_BASIN_MARGIN: f64 = 1.02;

/// Seeds for the refinement and the local search: the numBest circles of
/// lowest FOS, then the best circle of each basin not among them (at most
/// MAX_BASIN_SEEDS, lowest FOS first, within `margin` of the best FOS).
/// Seeds only from the global best all go to one basin when two compete,
/// and the other basin's minimum, which may be lower once refined, is
/// never approached (Duncan & Wright 2014, ch. 14: search from several
/// starting points for the local minima of toe, face and deep circles).
fn choose_seeds<'a>(
    slope: &Slope,
    planes: &[&'a SearchPlane],
    num_best: usize,
    margin: f64,
) -> Vec<&'a SearchPlane> {
    let fos = |p: &SearchPlane| p.fos.expect("seeds have a factor of safety");
    let mut best: Vec<&'a SearchPlane> = Vec::new();
    let mut best_of_basin: Vec<(i64, &'a SearchPlane)> = Vec::new();
    for &plane in planes {
        let Some(f) = plane.fos else { continue };
        if !f.is_finite() || plane.points.is_some() {
            continue;
        }
        // (TypeScript reads `best[-1]` with num_best 0 and throws; no caller does)
        if best.len() < num_best || (!best.is_empty() && f < fos(best[best.len() - 1])) {
            let mut i = best.len();
            while i > 0 && fos(best[i - 1]) > f {
                i -= 1;
            }
            best.insert(i, plane);
            if best.len() > num_best {
                best.pop();
            }
        }
        let basin = basin_of(slope, plane);
        match best_of_basin.iter_mut().find(|(b, _)| *b == basin) {
            Some(entry) => {
                if f < fos(entry.1) {
                    entry.1 = plane;
                }
            }
            None => best_of_basin.push((basin, plane)),
        }
    }
    if best.is_empty() {
        return best;
    }
    let covered: Vec<i64> = best.iter().map(|p| basin_of(slope, p)).collect();
    let limit = fos(best[0]) * margin;
    let mut extra: Vec<&'a SearchPlane> = best_of_basin
        .iter()
        .filter(|(basin, plane)| !covered.contains(basin) && fos(plane) <= limit)
        .map(|(_, plane)| *plane)
        .collect();
    js::array::sort_by(&mut extra, |a, b| fos(a) - fos(b));
    extra.truncate(MAX_BASIN_SEEDS);
    best.extend(extra);
    best
}

// ── generatePlanes ────────────────────────────────────────────────

/// Generate circular failure planes through entry and exit points
/// (TypeScript's default `numCircles` is 5).
pub fn generate_planes(
    slope: &Slope,
    lc: Pt,
    rc: Pt,
    num_circles: f64,
) -> Result<Vec<SearchPlane>> {
    generate_planes_with_scale(slope, lc, rc, num_circles, 1.1, false)
}

/// The circle at one chord-to-arc distance (`planeAt` in TypeScript).
enum PlaneAt {
    None,
    /// The circle leaves the model (through its base).
    Outside(SearchPlane),
    Inside(SearchPlane),
}

fn new_plane(ends: (Pt, Pt), cx: f64, cy: f64, radius: f64) -> SearchPlane {
    SearchPlane {
        lc: ends.0,
        rc: ends.1,
        cx,
        cy,
        radius,
        fos: Some(100.0),
        slices: None,
        ..Default::default()
    }
}

/// The circles through lc and rc, from the deepest to the shallowest. The
/// start circle has the radius `start_radius_scale` × half-chord / cos β
/// (β the chord's inclination); the circles' sagittas are k/numCircles of
/// its sagitta, k = numCircles … 1. With `first_pass` (issue #160) the
/// sagittas are instead evenly spaced from 95 % to 5 % of the reference
/// depth D, the sagitta of the circle through both ends whose centre is at
/// the elevation of the higher end (radius half-chord / cos β); the
/// circles tangent to the base and to material interfaces are found as for
/// the start circle either way.
fn generate_planes_with_scale(
    slope: &Slope,
    lc: Pt,
    rc: Pt,
    num_circles: f64,
    start_radius_scale: f64,
    first_pass: bool,
) -> Result<Vec<SearchPlane>> {
    let mut planes: Vec<SearchPlane> = Vec::new();

    let beta = js::math::atan((lc[1] - rc[1]) / (rc[0] - lc[0]));
    let half_coord_dist = js::math::hypot(&[lc[1] - rc[1], rc[0] - lc[0]]) / 2.0;

    let start_radius = (half_coord_dist / js::math::cos(beta)) * start_radius_scale;
    let start_chord_to_centre = js::math::max(
        0.0,
        js::math::pow(start_radius, 2.0) - js::math::pow(half_coord_dist, 2.0),
    )
    .sqrt();
    let start_chord_to_edge = start_radius - start_chord_to_centre;
    let c = js::math::pow(half_coord_dist, 2.0);

    // "outside": the circle leaves the model (through its base); with
    // composite surfaces it is analysed all the same (along the base), and
    // the circle just touching the base is still added between the depths.
    let composite = slope.composite_surfaces() && slope.composite_floor().is_some();
    let plane_at = |chord_to_edge: f64| -> Result<PlaneAt> {
        let Some(radius) = circle_radius_from_abcd(chord_to_edge, c) else {
            return Ok(PlaneAt::None);
        };
        let [c_x, c_y] = circle_centre(beta, mid_coord(lc, rc), radius - chord_to_edge);
        let Some(ends) = select_entry_exit(slope, c_x, c_y, radius)? else {
            return Ok(PlaneAt::None);
        };
        let plane = new_plane(ends, c_x, c_y, radius);
        if is_plane_within_external_boundary(slope, &plane, true) {
            return Ok(PlaneAt::Inside(plane));
        }
        Ok(PlaneAt::Outside(plane))
    };

    // From the deepest circle to the shallowest.
    let mut deepest_outside: Option<f64> = None;
    let mut tangent_added = false;
    let reference = first_pass && num_circles > 1.0;
    let reference_radius = half_coord_dist / js::math::cos(beta);
    let reference_depth = reference_radius
        - js::math::max(
            0.0,
            reference_radius * reference_radius - half_coord_dist * half_coord_dist,
        )
        .sqrt();
    let mut i = 0.0;
    while i < num_circles {
        let chord_to_edge = if reference {
            reference_depth * (0.05 + 0.9 * (num_circles - 1.0 - i) / (num_circles - 1.0))
        } else {
            (start_chord_to_edge * (num_circles - i)) / num_circles
        };
        i += 1.0;
        let plane = match plane_at(chord_to_edge)? {
            PlaneAt::Outside(outside) => {
                deepest_outside = Some(chord_to_edge);
                // (one through the bare base, not followed, is no composite surface)
                if composite && is_plane_within_external_boundary(slope, &outside, false) {
                    planes.push(outside);
                }
                continue;
            }
            PlaneAt::None => continue,
            PlaneAt::Inside(plane) => plane,
        };
        // A deeper circle left the model (typically through its base): the
        // critical circle is often the one just touching the base, between
        // the two depths. Find the deepest circle that still fits.
        if let (Some(deepest), false) = (deepest_outside, tangent_added) {
            let mut inside = chord_to_edge;
            let mut outside = deepest;
            let mut best: Option<SearchPlane> = None;
            for _ in 0..24 {
                let mid = (inside + outside) / 2.0;
                match plane_at(mid)? {
                    PlaneAt::Inside(p) => {
                        inside = mid;
                        best = Some(p);
                    }
                    _ => outside = mid,
                }
            }
            if let Some(best) = best {
                planes.push(best);
            }
            tangent_added = true;
        }
        planes.push(plane);
    }

    // Circles tangent to each material interface from above (the top of a
    // stronger or impenetrable layer, the base of a weaker one), found with
    // the same bisection as against the model base. The critical circle is
    // often one of them, and the fixed sagittas above rarely come close:
    // circles are searched per tangent line (USACE EM 1110-2-1902, 2003,
    // para. C-2g(1) and E-3a(2); Duncan & Wright 2014, ch. 14).
    let interfaces = material_interfaces(slope);
    for (k, iface) in interfaces.iter().enumerate() {
        let Some(chord_to_edge) = tangent_chord_to_edge(lc, rc, iface, start_chord_to_edge) else {
            continue;
        };
        let PlaneAt::Inside(mut plane) = plane_at(chord_to_edge)? else {
            continue;
        };
        if touches_ground_between_ends(slope, &plane, iface) {
            continue;
        }
        plane.tangent_to = Some(k);
        planes.push(plane);
    }

    Ok(planes)
}

/// Planes around the best ones of a first pass (`ranked_planes`, evaluated):
/// larger and smaller circles through the same ends, and circles through
/// ends half a grid step away, at most `refined_iterations` of them.
pub fn generate_refined_planes(
    slope: &Slope,
    ranked_planes: &[SearchPlane],
    refined_iterations: f64,
) -> Result<Vec<SearchPlane>> {
    if refined_iterations <= 0.0 || ranked_planes.is_empty() {
        return Ok(Vec::new());
    }

    let valid_ranked: Vec<&SearchPlane> = ranked_planes
        .iter()
        .filter(|p| p.fos.is_some_and(|f| f.is_finite()))
        .collect();
    if valid_ranked.is_empty() {
        return Ok(Vec::new());
    }

    let window = SearchWindow::of(slope);
    let existing_keys: HashSet<String> = valid_ranked.iter().map(|p| plane_key(p)).collect();
    let mut generated: Vec<SearchPlane> = Vec::new();
    let mut generated_keys: HashSet<String> = HashSet::new();
    let full = |generated: &Vec<SearchPlane>| generated.len() as f64 >= refined_iterations;

    let mut add_planes = |generated: &mut Vec<SearchPlane>, planes: Vec<SearchPlane>| {
        for plane in planes {
            // addPlane
            if !(generated.len() as f64 >= refined_iterations)
                && is_plane_within_search_limits(&window, &plane)
            {
                let key = plane_key(&plane);
                if !existing_keys.contains(&key) && !generated_keys.contains(&key) {
                    generated_keys.insert(key);
                    generated.push(plane);
                }
            }
            if generated.len() as f64 >= refined_iterations {
                break;
            }
        }
    };

    // Refinement varies circles; non-circular surfaces are not seeds. The
    // ten best, then the best of each further basin.
    let seeds = choose_seeds(slope, &valid_ranked, 10, f64::INFINITY);

    let grid = get_search_grid_spec(slope);
    let [entry_left_x, entry_right_x, exit_left_x, exit_right_x] = slope.search_limits();
    let entry_step = if grid.num_points_top > 1.0 {
        (entry_right_x - entry_left_x).abs() / (grid.num_points_top - 1.0)
    } else {
        0.0
    };
    let exit_step = if grid.num_points_bot > 0.0 {
        (exit_right_x - exit_left_x).abs() / grid.num_points_bot
    } else {
        0.0
    };

    // `step || 0.25`: 0 and NaN fall back
    let or_default = |v: f64| if v == 0.0 || v.is_nan() { 0.25 } else { v };
    let radius_group_tol = js::math::max(
        0.25,
        js::math::min(or_default(entry_step), or_default(exit_step)),
    );
    let (entry_path, exit_path) = ground_paths(slope, &grid)?;

    for seed in seeds {
        if full(&generated) {
            break;
        }

        let siblings: Vec<&&SearchPlane> = valid_ranked
            .iter()
            .filter(|p| {
                p.points.is_none() // a custom polyline has no radius
                    && (p.lc[0] - seed.lc[0]).abs() <= radius_group_tol
                    && (p.rc[0] - seed.rc[0]).abs() <= radius_group_tol
            })
            .collect();

        if !siblings.is_empty() {
            let radii: Vec<f64> = siblings.iter().map(|p| p.radius).collect();
            let min_radius = js::math::min_of(&radii);
            let max_radius = js::math::max_of(&radii);

            if seed.radius >= max_radius - 1e-6 {
                let larger: Vec<SearchPlane> = generate_planes_with_scale(
                    slope,
                    seed.lc,
                    seed.rc,
                    js::math::max(grid.num_circles + 4.0, 8.0),
                    1.45,
                    false,
                )?
                .into_iter()
                .filter(|p| p.radius > max_radius + 1e-6)
                .collect();
                add_planes(&mut generated, larger);
            }

            if seed.radius <= min_radius + 1e-6 {
                let smaller: Vec<SearchPlane> = generate_planes_with_scale(
                    slope,
                    seed.lc,
                    seed.rc,
                    js::math::max(grid.num_circles + 4.0, 8.0),
                    1.02,
                    false,
                )?
                .into_iter()
                .filter(|p| p.radius < min_radius - 1e-6)
                .collect();
                add_planes(&mut generated, smaller);
            }
        }

        if full(&generated) {
            break;
        }

        let entry_offsets: Vec<f64> = if entry_step > 0.0 {
            vec![-0.5 * entry_step, 0.5 * entry_step]
        } else {
            vec![]
        };
        let exit_offsets: Vec<f64> = if exit_step > 0.0 {
            vec![-0.5 * exit_step, 0.5 * exit_step]
        } else {
            vec![]
        };

        let mut entry_candidates = vec![seed.lc[0]];
        let mut exit_candidates = vec![seed.rc[0]];

        for delta in entry_offsets {
            let x = seed.lc[0] + delta;
            if entry_left_x <= x && x <= entry_right_x {
                entry_candidates.push(x);
            }
        }
        for delta in exit_offsets {
            let x = seed.rc[0] + delta;
            if exit_left_x <= x && x <= exit_right_x {
                exit_candidates.push(x);
            }
        }
        let entry_candidates = unique_numbers(entry_candidates);
        let exit_candidates = unique_numbers(exit_candidates);

        // The ends half a grid step from the seed's (true: the seed's own).
        // Where a range's ground is not one straight line, the step is
        // taken along the ground (issue #158).
        let mut entry_pts: Vec<(Pt, bool)> = Vec::new();
        if let Some(path) = &entry_path {
            let s0 = path.s_of(seed.lc);
            let step = path.len() / (grid.num_points_top - 1.0);
            entry_pts.push((seed.lc, true));
            for d in [-0.5 * step, 0.5 * step] {
                let s = s0 + d;
                if s >= 0.0 && s <= path.len() {
                    entry_pts.push((path.at(s), false));
                }
            }
        } else {
            for &ex in &entry_candidates {
                entry_pts.push((
                    [ex, slope.get_external_y_intersection(ex)?],
                    (ex - seed.lc[0]).abs() < 1e-9,
                ));
            }
        }
        let mut exit_pts: Vec<(Pt, bool)> = Vec::new();
        if let Some(path) = &exit_path {
            let s0 = path.s_of(seed.rc);
            let step = path.len() / grid.num_points_bot;
            exit_pts.push((seed.rc, true));
            for d in [-0.5 * step, 0.5 * step] {
                let s = s0 + d;
                if s >= 0.0 && s <= path.len() {
                    exit_pts.push((path.at(s), false));
                }
            }
        } else {
            for &xx in &exit_candidates {
                exit_pts.push((slope.exit_ground_point(xx)?, (xx - seed.rc[0]).abs() < 1e-9));
            }
        }

        'entries: for &(lc, entry_is_seed) in &entry_pts {
            for &(rc, exit_is_seed) in &exit_pts {
                if entry_is_seed && exit_is_seed {
                    continue;
                }
                if dist_points(lc, rc) <= slope.min_failure_distance() {
                    continue;
                }
                let local = generate_planes_with_scale(
                    slope,
                    lc,
                    rc,
                    js::math::max(4.0, (grid.num_circles / 2.0).ceil()),
                    1.1,
                    false,
                )?;
                add_planes(&mut generated, local);
                if full(&generated) {
                    break 'entries;
                }
            }
        }
    }

    Ok(generated)
}

/// One level of the local pattern search that follows the grid search and
/// generate_refined_planes. Entry, exit and sagitta (chord-to-arc distance)
/// of the best surfaces so far are moved by steps that halve with each
/// level, so repeated levels converge on the minimum between grid points
/// instead of stopping at the grid resolution.
///
/// `existing_keys`: the keys of all planes so far, to which new planes are
/// added (TypeScript's default: the keys of `evaluated_planes`, see
/// `plane_keys`). TypeScript's default `num_seeds` is 4.
pub fn generate_local_planes(
    slope: &Slope,
    evaluated_planes: &[SearchPlane],
    budget: f64,
    level: f64,
    existing_keys: &mut HashSet<String>,
    num_seeds: usize,
) -> Result<Vec<SearchPlane>> {
    if budget <= 0.0 {
        return Ok(Vec::new());
    }
    // The numSeeds best planes, then the best of each further basin that
    // is close to the best.
    let all: Vec<&SearchPlane> = evaluated_planes.iter().collect();
    let seeds = choose_seeds(slope, &all, num_seeds, LOCAL_BASIN_MARGIN);
    if seeds.is_empty() {
        return Ok(Vec::new());
    }
    let interfaces = material_interfaces(slope);

    let mut generated: Vec<SearchPlane> = Vec::new();

    let grid = get_search_grid_spec(slope);
    let window = SearchWindow::of(slope);
    let [entry_left_x, entry_right_x, exit_left_x, exit_right_x] = window.limits;
    let scale = js::math::pow(0.5, level + 1.0);
    let entry_step = if grid.num_points_top > 1.0 {
        ((entry_right_x - entry_left_x).abs() / (grid.num_points_top - 1.0)) * scale
    } else {
        0.0
    };
    let exit_step = if grid.num_points_bot > 0.0 {
        ((exit_right_x - exit_left_x).abs() / grid.num_points_bot) * scale
    } else {
        0.0
    };
    // The grid spaces sagittas by 1/numCircles of the largest one.
    let sagitta_step = (2.0 * scale) / js::math::max(grid.num_circles, 1.0);
    let (entry_path, exit_path) = ground_paths(slope, &grid)?;

    /// Adds the circle with this chord-to-arc distance; true when the budget is spent.
    #[allow(clippy::too_many_arguments)]
    fn add(
        slope: &Slope,
        window: &SearchWindow,
        interfaces: &[MaterialInterface],
        lc: Pt,
        rc: Pt,
        chord_to_edge: f64,
        tangent_to: Option<usize>,
        existing_keys: &mut HashSet<String>,
        generated: &mut Vec<SearchPlane>,
        budget: f64,
    ) -> Result<bool> {
        let Some((c_x, c_y, radius)) = circle_through(lc, rc, chord_to_edge) else {
            return Ok(false);
        };
        let Some(ends) = select_entry_exit(slope, c_x, c_y, radius)? else {
            return Ok(false);
        };
        let mut plane = new_plane(ends, c_x, c_y, radius);
        if let Some(t) = tangent_to {
            if touches_ground_between_ends(slope, &plane, &interfaces[t]) {
                return Ok(false);
            }
            plane.tangent_to = Some(t);
        }
        if !is_plane_within_external_boundary(slope, &plane, false) {
            return Ok(false);
        }
        if !is_plane_within_search_limits(window, &plane) {
            return Ok(false);
        }
        let key = plane_key(&plane);
        if existing_keys.contains(&key) {
            return Ok(false);
        }
        existing_keys.insert(key);
        generated.push(plane);
        Ok(generated.len() as f64 >= budget)
    }

    for seed in seeds {
        let vx = seed.rc[0] - seed.lc[0];
        let vy = seed.rc[1] - seed.lc[1];
        let half_chord = js::math::hypot(&[vx, vy]) / 2.0;
        let centre_to_chord = js::math::max(
            0.0,
            js::math::pow(seed.radius, 2.0) - js::math::pow(half_chord, 2.0),
        )
        .sqrt();
        let centre_above = vx * (seed.cy - seed.lc[1]) - vy * (seed.cx - seed.lc[0]) > 0.0;
        let sagitta = if centre_above {
            seed.radius - centre_to_chord
        } else {
            seed.radius + centre_to_chord
        };

        // The ends are checked against the limits with the tolerance of
        // is_plane_within_search_limits: a seed ending at a limit has its
        // end computed as a crossing with the ground, which can lie a few
        // ulps outside it, and without the tolerance its unmoved end was
        // dropped. A seed at a corner-widened limit (e.g. the toe) then
        // kept only the moved ends, whose circles all left the limits, and
        // the empty level ended the local search early (issue #160). Where a
        // range's ground is not one straight line, the ends step along the
        // ground, by the same fraction of the grid's spacing along it (issue
        // #158; the step's sign stands in for its size: 0 is the seed's end).
        let mut entry_pts: Vec<(f64, Pt)> = Vec::new();
        if let Some(path) = &entry_path {
            let s0 = path.s_of(seed.lc);
            let step = path.len() / (grid.num_points_top - 1.0) * scale;
            for k in [-1.0, 0.0, 1.0] {
                let s = s0 + k * step;
                if s < 0.0 || s > path.len() {
                    continue;
                }
                entry_pts.push((k, if k == 0.0 { seed.lc } else { path.at(s) }));
            }
        } else {
            for de in [-entry_step, 0.0, entry_step] {
                let ex = seed.lc[0] + de;
                if ex < entry_left_x - LIMIT_TOL || ex > entry_right_x + LIMIT_TOL {
                    continue;
                }
                entry_pts.push((de, [ex, slope.get_external_y_intersection(ex)?]));
            }
        }
        let mut exit_pts: Vec<(f64, Pt)> = Vec::new();
        if let Some(path) = &exit_path {
            let s0 = path.s_of(seed.rc);
            let step = path.len() / grid.num_points_bot * scale;
            for k in [-1.0, 0.0, 1.0] {
                let s = s0 + k * step;
                if s < 0.0 || s > path.len() {
                    continue;
                }
                exit_pts.push((k, if k == 0.0 { seed.rc } else { path.at(s) }));
            }
        } else {
            for dx in [-exit_step, 0.0, exit_step] {
                let xx = seed.rc[0] + dx;
                if xx < exit_left_x - LIMIT_TOL || xx > exit_right_x + LIMIT_TOL {
                    continue;
                }
                exit_pts.push((dx, slope.exit_ground_point(xx)?));
            }
        }

        for &(de, lc) in &entry_pts {
            for &(dx, rc) in &exit_pts {
                if dist_points(lc, rc) <= slope.min_failure_distance() {
                    continue;
                }
                for ds in [-sagitta_step, 0.0, sagitta_step] {
                    if de == 0.0 && dx == 0.0 && ds == 0.0 {
                        continue;
                    }
                    if add(
                        slope,
                        &window,
                        interfaces,
                        lc,
                        rc,
                        sagitta * (1.0 + ds),
                        None,
                        existing_keys,
                        &mut generated,
                        budget,
                    )? {
                        return Ok(generated);
                    }
                }
                // A seed tangent to an interface stays tangent to it as its ends
                // move: the search follows the tangent line (USACE EM 1110-2-1902,
                // 2003, fig. C-6; Edris & Wright 1987).
                let iface = seed
                    .tangent_to
                    .and_then(|t| interfaces.get(t).map(|i| (t, i)));
                if let Some((t, iface)) = iface {
                    if de != 0.0 || dx != 0.0 {
                        if let Some(chord_to_edge) =
                            tangent_chord_to_edge(lc, rc, iface, 2.0 * sagitta)
                        {
                            if add(
                                slope,
                                &window,
                                interfaces,
                                lc,
                                rc,
                                chord_to_edge,
                                Some(t),
                                existing_keys,
                                &mut generated,
                                budget,
                            )? {
                                return Ok(generated);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(generated)
}

/// The keys of the planes (`new Set(planes.map(planeKey))`).
pub fn plane_keys(planes: &[SearchPlane]) -> HashSet<String> {
    planes.iter().map(plane_key).collect()
}

// ── setEntryExitPlanes ────────────────────────────────────────────

/// Generate search planes based on predetermined entry/exit points.
pub fn set_entry_exit_planes(slope: &mut Slope) -> Result<()> {
    let planes = entry_exit_planes(slope)?;
    slope.set_search_planes(planes);
    Ok(())
}

/// The planes `set_entry_exit_planes` sets, on a shared slope.
pub fn entry_exit_planes(slope: &Slope) -> Result<Vec<SearchPlane>> {
    let grid = get_search_grid_spec(slope);
    let (num_points_top, num_points_bot) = (grid.num_points_top, grid.num_points_bot);
    let points = point_sides(slope);
    let (entry_path, exit_path) = ground_paths(slope, &grid)?;

    let window = SearchWindow::of(slope);
    let [entry_left_x, entry_right_x, exit_left_x, exit_right_x] = window.limits;

    // The corner rule's offset (`Slope::search_limits`): 1e-5 of the
    // model's width.
    let corner_offset = slope.surface_line_xy().map_or(0.0, |s| {
        1e-5 * (js::math::max_of(&s.x) - js::math::min_of(&s.x))
    });

    // Generate entry (left) coordinates: evenly spaced along the ground
    // between the limits (issue #158), which is evenly in x where the
    // ground there is one straight line, with points on its break points
    // (issue #164).
    let mut left_coords: Vec<Pt> = Vec::new();
    if let Some(xs) = &points.entry {
        for &x in xs {
            left_coords.push([x, slope.get_external_y_intersection(x)?]);
        }
    } else if let Some(path) = &entry_path {
        left_coords = path.first_pass_points(num_points_top, 0.0);
    } else {
        let mut n = 0.0;
        while n < num_points_top {
            let x = entry_left_x + (n / (num_points_top - 1.0)) * (entry_right_x - entry_left_x);
            left_coords.push([x, slope.get_external_y_intersection(x)?]);
            n += 1.0;
        }
    }

    // Generate exit (right) coordinates
    let mut right_coords: Vec<Pt> = Vec::new();
    if let Some(xs) = &points.exit {
        for &x in xs {
            right_coords.push(slope.exit_ground_point(x)?);
        }
    } else if let Some(path) = &exit_path {
        right_coords = path.first_pass_points(num_points_bot + 1.0, corner_offset);
    } else {
        let mut n = 0.0;
        while n <= num_points_bot {
            let x = exit_left_x + (n / num_points_bot) * (exit_right_x - exit_left_x);
            right_coords.push(slope.exit_ground_point(x)?);
            n += 1.0;
        }
    }

    // Entry points just behind each load, on top of the grid (within the
    // entry limits: outside them a point gives no admissible entry).
    let load_edges: Vec<f64> = slope
        .line_loads()
        .iter()
        .map(|ll| ll.x)
        .chain(slope.udls().iter().map(|udl| js::math::min(udl.x1, udl.x2)))
        .collect();
    for edge in load_edges {
        let x = edge - 0.001;
        if x < entry_left_x || x > entry_right_x {
            continue;
        }
        left_coords.push([x, slope.get_external_y_intersection(x)?]);
    }

    // Generate search planes
    let mut all_planes: Vec<SearchPlane> = Vec::new();
    for &l_co in &left_coords {
        for &r_co in &right_coords {
            if dist_points(l_co, r_co) > slope.min_failure_distance() {
                all_planes.extend(generate_planes_with_scale(
                    slope,
                    l_co,
                    r_co,
                    FIRST_PASS_CIRCLES,
                    1.1,
                    true,
                )?);
            }
        }
    }

    // Filter valid planes
    Ok(all_planes
        .into_iter()
        .filter(|p| is_plane_within_search_limits(&window, p))
        .collect())
}

// ── addSingleEntryExitPlane ───────────────────────────────────────

/// Add potential failure surfaces defined by entry and exit x-coordinates
/// (TypeScript's default `numCircles` is 5).
pub fn add_single_entry_exit_plane(
    slope: &mut Slope,
    lc_x: f64,
    rc_x: f64,
    num_circles: f64,
) -> Result<()> {
    let planes = generate_planes(
        slope,
        [lc_x, slope.get_external_y_intersection(lc_x)?],
        [rc_x, slope.get_external_y_intersection(rc_x)?],
        num_circles,
    )?;
    slope.add_individual_planes(planes);
    Ok(())
}

// ── addSingleCircularPlane ────────────────────────────────────────

/// Add a specific circular failure surface to the analysis. A circle that
/// leaves the model is added all the same: whether it is analysed (along
/// the floor, as a composite surface) depends on the options at analysis
/// time, and evaluatePlanes rejects it otherwise.
pub fn add_single_circular_plane(slope: &mut Slope, cx: f64, cy: f64, radius: f64) -> Result<()> {
    if let Some(ends) = select_entry_exit(slope, cx, cy, radius)? {
        let plane = SearchPlane {
            unchecked: Some(true),
            ..new_plane(ends, cx, cy, radius)
        };
        slope.add_individual_planes(vec![plane]);
    }
    Ok(())
}
