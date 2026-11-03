//! The union of linework as jsts computes it: `UnaryUnionOp` and
//! `Geometry.union` of lines both run `SnapIfNeededOverlayOp`, i.e. the old
//! `OverlayOp` (geometry graph noding in floating point, split edges,
//! duplicate edges merged, `EdgeNodingValidator`), and when that throws, the
//! same overlay on copies with their common bits removed and snapped to
//! each other (`SnapOverlayOp`).
//!
//! For linework the union result is every distinct split edge, in the order
//! of the overlay's edge list and with the orientation of its first
//! occurrence (`LineBuilder` collects the line edges in that order; no edge
//! of a line-only overlay is covered by an area).

use super::algorithm::{
    env_intersects_seg, js_max, js_min, point_to_segment, Coord, Envelope, JtsError, JtsResult,
    LineIntersector,
};
use super::geomgraph::{sweep_intersections, Edge, SegmentIntersector};
use std::collections::HashMap;

/// A linear geometry as the overlay sees it.
#[derive(Debug, Clone, PartialEq)]
pub enum Linear {
    /// A `LineString` or a `MultiLineString` (or an empty collection).
    Lines(Vec<Vec<Coord>>),
    /// A `LinearRing` (its graph does not self-node the ring).
    Ring(Vec<Coord>),
    /// The empty point `UnaryUnionOp` unions with.
    Empty,
}

impl Linear {
    fn components(&self) -> Vec<&Vec<Coord>> {
        match self {
            Linear::Lines(ls) => ls.iter().collect(),
            Linear::Ring(r) => vec![r],
            Linear::Empty => vec![],
        }
    }

    fn coords(&self) -> Vec<Coord> {
        self.components()
            .into_iter()
            .flat_map(|c| c.iter().copied())
            .collect()
    }

    fn is_ring(&self) -> bool {
        matches!(self, Linear::Ring(_))
    }

    fn translated(&self, dx: f64, dy: f64) -> Linear {
        let t = |c: &Vec<Coord>| {
            c.iter()
                .map(|p| Coord::new(p.x + dx, p.y + dy))
                .collect::<Vec<_>>()
        };
        match self {
            Linear::Lines(ls) => Linear::Lines(ls.iter().map(t).collect()),
            Linear::Ring(r) => Linear::Ring(t(r)),
            Linear::Empty => Linear::Empty,
        }
    }
}

/// `UnaryUnionOp.union` of line strings: their noded, merged linework.
pub fn unary_union_lines(lines: &[Vec<Coord>]) -> JtsResult<Vec<Vec<Coord>>> {
    if lines.iter().all(|l| l.is_empty()) {
        return Ok(Vec::new());
    }
    snap_if_needed_union(&Linear::Lines(lines.to_vec()), &Linear::Empty)
}

/// `ring.union(line)` (`UnionOp.union`) for a `LinearRing` and a line.
pub fn union_ring_line(ring: &[Coord], line: &[Coord]) -> JtsResult<Vec<Vec<Coord>>> {
    snap_if_needed_union(
        &Linear::Ring(ring.to_vec()),
        &Linear::Lines(vec![line.to_vec()]),
    )
}

/// `SnapIfNeededOverlayOp.overlayOp(g0, g1, UNION)`.
fn snap_if_needed_union(g0: &Linear, g1: &Linear) -> JtsResult<Vec<Vec<Coord>>> {
    match overlay_union(g0, g1) {
        Ok(r) => Ok(r),
        Err(JtsError::Runtime(saved)) => match snap_overlay_union(g0, g1) {
            Ok(r) => Ok(r),
            Err(JtsError::Runtime(_)) => Err(JtsError::Runtime(saved)),
            Err(other) => Err(other),
        },
        Err(other) => Err(other),
    }
}

/// `OverlayOp.overlayOp(g0, g1, UNION)` for linear geometries.
pub fn overlay_union(g0: &Linear, g1: &Linear) -> JtsResult<Vec<Vec<Coord>>> {
    let mut edges: Vec<Edge> = Vec::new();
    let mut graph_edges: [Vec<usize>; 2] = [Vec::new(), Vec::new()];
    for (gi, g) in [g0, g1].into_iter().enumerate() {
        // GeometryGraph.addLineString: repeated points removed, a line of
        // fewer than two points left out.
        for c in g.components() {
            let pts = super::algorithm::remove_repeated_points(c);
            if pts.len() < 2 {
                continue;
            }
            graph_edges[gi].push(edges.len());
            edges.push(Edge::new(pts));
        }
    }
    // computeSelfNodes(li, false) of each argument: a ring's own segments
    // are not tested against each other, other linework is.
    for (gi, g) in [g0, g1].into_iter().enumerate() {
        let compute_all = !g.is_ring();
        let members: Vec<(usize, Option<usize>)> = graph_edges[gi]
            .iter()
            .map(|&e| (e, if compute_all { None } else { Some(e) }))
            .collect();
        let mut si = SegmentIntersector::new(LineIntersector::new(None), true);
        sweep_intersections(&mut edges, &members, &mut si)?;
    }
    // computeEdgeIntersections(arg1, li, true)
    {
        let mut members: Vec<(usize, Option<usize>)> = Vec::new();
        for (gi, ids) in graph_edges.iter().enumerate() {
            members.extend(ids.iter().map(|&e| (e, Some(gi))));
        }
        let mut si = SegmentIntersector::new(LineIntersector::new(None), true);
        sweep_intersections(&mut edges, &members, &mut si)?;
    }
    let mut split: Vec<Vec<Coord>> = Vec::new();
    for ids in &graph_edges {
        for &e in ids {
            edges[e].split_edges(&mut split);
        }
    }
    // insertUniqueEdges: an edge equal to an earlier one (in either
    // direction) only merges its label.
    let mut unique: Vec<Vec<Coord>> = Vec::new();
    let mut seen: HashMap<Vec<(u64, u64)>, usize> = HashMap::new();
    for e in split {
        let key = oriented_key(&e);
        if let std::collections::hash_map::Entry::Vacant(v) = seen.entry(key) {
            v.insert(unique.len());
            unique.push(e);
        }
    }
    check_noding_valid(&unique)?;
    Ok(unique)
}

/// A key equal for two coordinate arrays exactly when
/// `OrientedCoordinateArray` compares them equal: the same points forward
/// or reversed (−0 and +0 equal).
fn oriented_key(pts: &[Coord]) -> Vec<(u64, u64)> {
    let bits = |c: &Coord| ((c.x + 0.0).to_bits(), (c.y + 0.0).to_bits());
    let fwd: Vec<(u64, u64)> = pts.iter().map(bits).collect();
    let rev: Vec<(u64, u64)> = pts.iter().rev().map(bits).collect();
    let less = {
        let mut r = std::cmp::Ordering::Equal;
        for (a, b) in pts.iter().zip(pts.iter().rev()) {
            let c = a.compare(b);
            if c != std::cmp::Ordering::Equal {
                r = c;
                break;
            }
        }
        r != std::cmp::Ordering::Greater
    };
    if less {
        fwd
    } else {
        rev
    }
}

/// `EdgeNodingValidator.checkValid` (`FastNodingValidator` with a
/// `NodingIntersectionFinder`): an interior intersection, or a vertex of
/// one edge on an interior vertex of another, between any two segments not
/// adjacent in the same edge. The monotone-chain index of jsts tests every
/// pair of segments whose envelopes overlap, except pairs within one
/// monotone chain, which cannot have either kind; testing all pairs whose
/// envelopes overlap gives the same verdict.
///
/// The pairs are found by a sweep over the segments sorted by their least
/// x (a pair can only fail when the x ranges overlap), so the cost is that
/// of the overlapping pairs, not of all pairs (40 lines of 1000 vertices:
/// 1.6 million pairs instead of 800 million). A segment with a NaN x has no
/// x range and is tested against every other segment, as the envelope test
/// lets every pair with a NaN through. The error names the first failing
/// pair in the order of an all-pairs scan (segments in edge order), so the
/// message does not depend on the sweep.
fn check_noding_valid(edges: &[Vec<Coord>]) -> JtsResult<()> {
    let segs: Vec<(usize, usize)> = edges
        .iter()
        .enumerate()
        .flat_map(|(e, pts)| (0..pts.len() - 1).map(move |s| (e, s)))
        .collect();
    let mut li = LineIntersector::new(None);
    // Whether the segments a < b (indices into segs) fail the validator.
    let mut fails = |a: usize, b: usize| -> bool {
        let (e0, s0) = segs[a];
        let (e1, s1) = segs[b];
        let p00 = edges[e0][s0];
        let p01 = edges[e0][s0 + 1];
        let p10 = edges[e1][s1];
        let p11 = edges[e1][s1 + 1];
        if !env_intersects_seg(&p00, &p01, &p10, &p11) {
            return false;
        }
        let same = e0 == e1;
        li.compute_intersection(&p00, &p01, &p10, &p11);
        let is_interior_int = li.has_intersection() && li.is_interior_intersection();
        let is_adjacent = same && s0.abs_diff(s1) <= 1;
        let is_end00 = s0 == 0;
        let is_end01 = s0 + 2 == edges[e0].len();
        let is_end10 = s1 == 0;
        let is_end11 = s1 + 2 == edges[e1].len();
        let vertex = |p: &Coord, q: &Coord, end_p: bool, end_q: bool| !(end_p && end_q) && p == q;
        let is_interior_vertex_int = !is_adjacent
            && (vertex(&p00, &p10, is_end00, is_end10)
                || vertex(&p00, &p11, is_end00, is_end11)
                || vertex(&p01, &p10, is_end01, is_end10)
                || vertex(&p01, &p11, is_end01, is_end11));
        is_interior_int || is_interior_vertex_int
    };
    let x_range = |&(e, s): &(usize, usize)| {
        let (p, q) = (edges[e][s], edges[e][s + 1]);
        (js_min(p.x, q.x), js_max(p.x, q.x))
    };
    let ranges: Vec<(f64, f64)> = segs.iter().map(x_range).collect();
    let (mut swept, nan): (Vec<usize>, Vec<usize>) =
        (0..segs.len()).partition(|&k| !ranges[k].0.is_nan());
    // (any order of equal keys: every overlapping pair is tested)
    swept.sort_by(|&a, &b| ranges[a].0.total_cmp(&ranges[b].0));
    let mut first: Option<(usize, usize)> = None;
    let mut consider = |a: usize, b: usize, first: &mut Option<(usize, usize)>| {
        let pair = (a.min(b), a.max(b));
        if first.is_none_or(|f| pair < f) && fails(pair.0, pair.1) {
            *first = Some(pair);
        }
    };
    for (k, &a) in swept.iter().enumerate() {
        let max_x = ranges[a].1;
        for &b in &swept[k + 1..] {
            if ranges[b].0 > max_x {
                break;
            }
            consider(a, b, &mut first);
        }
    }
    for (k, &a) in nan.iter().enumerate() {
        for &b in swept.iter().chain(&nan[k + 1..]) {
            consider(a, b, &mut first);
        }
    }
    if let Some((a, b)) = first {
        let (e0, s0) = segs[a];
        let (e1, s1) = segs[b];
        let n = |v: f64| crate::js::num::to_string(v);
        let (p00, p01, p10, p11) = (
            edges[e0][s0],
            edges[e0][s0 + 1],
            edges[e1][s1],
            edges[e1][s1 + 1],
        );
        return Err(JtsError::Runtime(format!(
            "found non-noded intersection between LINESTRING ( {} {}, {} {} ) and LINESTRING ( {} {}, {} {} )",
            n(p00.x), n(p00.y), n(p01.x), n(p01.y), n(p10.x), n(p10.y), n(p11.x), n(p11.y)
        )));
    }
    Ok(())
}

// ── SnapOverlayOp ─────────────────────────────────────────────────

/// `SnapOverlayOp.overlayOp(g0, g1, UNION)`: remove the common bits of
/// all coordinates, snap each geometry to the other within the overlay
/// snap tolerance, overlay, and add the common bits back.
fn snap_overlay_union(g0: &Linear, g1: &Linear) -> JtsResult<Vec<Vec<Coord>>> {
    let tol = js_min(overlay_snap_tolerance(g0), overlay_snap_tolerance(g1));
    let mut cx = CommonBits::default();
    let mut cy = CommonBits::default();
    for c in g0.coords().iter().chain(g1.coords().iter()) {
        cx.add(c.x);
        cy.add(c.y);
    }
    let common = Coord::new(cx.common(), cy.common());
    let remove = |g: &Linear| {
        if common.x == 0.0 && common.y == 0.0 {
            g.clone()
        } else {
            g.translated(-common.x, -common.y)
        }
    };
    let rem0 = remove(g0);
    let rem1 = remove(g1);
    let snapped0 = snap_to(&rem0, &rem1, tol)?;
    let snapped1 = snap_to(&rem1, &snapped0, tol)?;
    let result = overlay_union(&snapped0, &snapped1)?;
    Ok(result
        .into_iter()
        .map(|l| {
            l.into_iter()
                .map(|p| Coord::new(p.x + common.x, p.y + common.y))
                .collect()
        })
        .collect())
}

/// `GeometrySnapper.computeOverlaySnapTolerance(g)` (floating precision):
/// 1e-9 of the smaller side of the envelope, 0 for an empty geometry.
fn overlay_snap_tolerance(g: &Linear) -> f64 {
    match Envelope::of_coords(&g.coords()) {
        None => 0.0,
        Some(env) => js_min(env.height(), env.width()) * 1e-9,
    }
}

/// `CommonBits`: the leading bits shared by all numbers added.
struct CommonBits {
    is_first: bool,
    bits: u64,
    sign_exp: u64,
}

impl Default for CommonBits {
    fn default() -> Self {
        CommonBits {
            is_first: true,
            bits: 0,
            sign_exp: 0,
        }
    }
}

impl CommonBits {
    fn add(&mut self, num: f64) {
        let num_bits = if num.is_nan() {
            0x7ff8_0000_0000_0000
        } else {
            num.to_bits()
        };
        if self.is_first {
            self.bits = num_bits;
            self.sign_exp = num_bits >> 52;
            self.is_first = false;
            return;
        }
        if num_bits >> 52 != self.sign_exp {
            self.bits = 0;
            return;
        }
        let count = num_common_most_sig_mantissa_bits(self.bits, num_bits);
        let n_bits = 64 - (12 + count);
        if n_bits > 0 {
            self.bits &= !((1u64 << n_bits) - 1);
        }
    }

    fn common(&self) -> f64 {
        f64::from_bits(self.bits)
    }
}

fn num_common_most_sig_mantissa_bits(a: u64, b: u64) -> u32 {
    for (count, i) in (0..=52u32).rev().enumerate() {
        if (a >> i) & 1 != (b >> i) & 1 {
            return count as u32;
        }
    }
    52
}

/// `GeometrySnapper(src).snapTo(target, tolerance)`: src's vertices and
/// segments snapped to the distinct coordinates of target.
fn snap_to(src: &Linear, target: &Linear, tol: f64) -> JtsResult<Linear> {
    let mut snap_pts = target.coords();
    crate::js::array::sort_by(&mut snap_pts, |a, b| {
        super::algorithm::cmp_num(a.compare(b))
    });
    snap_pts.dedup_by(|a, b| a.compare(b) == std::cmp::Ordering::Equal);
    match src {
        Linear::Empty => Ok(Linear::Empty),
        Linear::Ring(r) => {
            let seq = snap_line(r, &snap_pts, tol);
            if !seq.is_empty() && seq.len() < 4 {
                return create_line_string(seq).map(|l| Linear::Lines(vec![l]));
            }
            if !seq.is_empty() && seq[0] != seq[seq.len() - 1] {
                return Err(JtsError::Other(
                    "Points of LinearRing do not form a closed linestring".into(),
                ));
            }
            Ok(Linear::Ring(seq))
        }
        Linear::Lines(ls) => {
            let mut out = Vec::new();
            for l in ls {
                let seq = create_line_string(snap_line(l, &snap_pts, tol))?;
                if !seq.is_empty() {
                    out.push(seq);
                }
            }
            Ok(Linear::Lines(out))
        }
    }
}

fn create_line_string(seq: Vec<Coord>) -> JtsResult<Vec<Coord>> {
    if seq.len() == 1 {
        return Err(JtsError::Other(
            "Invalid number of points in LineString (found 1 - must be 0 or >= 2)".into(),
        ));
    }
    Ok(seq)
}

/// `LineStringSnapper.snapTo` (no snapping to the source's own vertices).
fn snap_line(src: &[Coord], snap_pts: &[Coord], tol: f64) -> Vec<Coord> {
    let is_closed = src.len() > 1 && src[0] == src[src.len() - 1];
    let mut list: Vec<Coord> = src.to_vec();
    // snapVertices
    let end = if is_closed {
        list.len() - 1
    } else {
        list.len()
    };
    for i in 0..end {
        let src_pt = list[i];
        if let Some(v) = find_snap_for_vertex(&src_pt, snap_pts, tol) {
            list[i] = v;
            if i == 0 && is_closed {
                let n = list.len();
                list[n - 1] = v;
            }
        }
    }
    // snapSegments
    if snap_pts.is_empty() {
        return list;
    }
    let mut distinct = snap_pts.len();
    if snap_pts[0] == snap_pts[snap_pts.len() - 1] {
        distinct = snap_pts.len() - 1;
    }
    for snap_pt in snap_pts.iter().take(distinct) {
        if let Some(index) = find_segment_index_to_snap(snap_pt, &list, tol) {
            // CoordinateList.add(index + 1, pt, false)
            let i = index + 1;
            let size = list.len();
            if size > 0 && ((i > 0 && list[i - 1] == *snap_pt) || (i < size && list[i] == *snap_pt))
            {
                continue;
            }
            list.insert(i, *snap_pt);
        }
    }
    list
}

fn find_snap_for_vertex(pt: &Coord, snap_pts: &[Coord], tol: f64) -> Option<Coord> {
    for s in snap_pts {
        if pt == s {
            return None;
        }
        if pt.distance(s) < tol {
            return Some(*s);
        }
    }
    None
}

fn find_segment_index_to_snap(snap_pt: &Coord, list: &[Coord], tol: f64) -> Option<usize> {
    let mut min_dist = f64::MAX;
    let mut snap_index = None;
    for i in 0..list.len().saturating_sub(1) {
        let p0 = list[i];
        let p1 = list[i + 1];
        if p0 == *snap_pt || p1 == *snap_pt {
            return None;
        }
        let dist = point_to_segment(snap_pt, &p0, &p1);
        if dist < tol && dist < min_dist {
            min_dist = dist;
            snap_index = Some(i);
        }
    }
    snap_index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(x: f64, y: f64) -> Coord {
        Coord::new(x, y)
    }

    #[test]
    fn crossing_lines_are_split_at_their_intersection() {
        let lines = vec![vec![c(0., 0.), c(2., 2.)], vec![c(0., 2.), c(2., 0.)]];
        let u = unary_union_lines(&lines).unwrap();
        assert_eq!(
            u,
            vec![
                vec![c(0., 0.), c(1., 1.)],
                vec![c(1., 1.), c(2., 2.)],
                vec![c(0., 2.), c(1., 1.)],
                vec![c(1., 1.), c(2., 0.)],
            ]
        );
    }

    #[test]
    fn duplicate_and_reversed_edges_are_merged() {
        let lines = vec![
            vec![c(0., 0.), c(1., 0.)],
            vec![c(1., 0.), c(0., 0.)],
            vec![c(0., 0.), c(1., 0.)],
        ];
        assert_eq!(
            unary_union_lines(&lines).unwrap(),
            vec![vec![c(0., 0.), c(1., 0.)]]
        );
    }

    /// The validator as it was: every pair of segments, in order.
    fn check_noding_valid_all_pairs(edges: &[Vec<Coord>]) -> JtsResult<()> {
        let segs: Vec<(usize, usize)> = edges
            .iter()
            .enumerate()
            .flat_map(|(e, pts)| (0..pts.len() - 1).map(move |s| (e, s)))
            .collect();
        let mut li = LineIntersector::new(None);
        for (a, &(e0, s0)) in segs.iter().enumerate() {
            let p00 = edges[e0][s0];
            let p01 = edges[e0][s0 + 1];
            for &(e1, s1) in &segs[a + 1..] {
                let p10 = edges[e1][s1];
                let p11 = edges[e1][s1 + 1];
                if !env_intersects_seg(&p00, &p01, &p10, &p11) {
                    continue;
                }
                li.compute_intersection(&p00, &p01, &p10, &p11);
                let is_interior_int = li.has_intersection() && li.is_interior_intersection();
                let is_adjacent = e0 == e1 && s0.abs_diff(s1) <= 1;
                let (end00, end01) = (s0 == 0, s0 + 2 == edges[e0].len());
                let (end10, end11) = (s1 == 0, s1 + 2 == edges[e1].len());
                let v = |p: &Coord, q: &Coord, ep: bool, eq: bool| !(ep && eq) && p == q;
                let is_interior_vertex_int = !is_adjacent
                    && (v(&p00, &p10, end00, end10)
                        || v(&p00, &p11, end00, end11)
                        || v(&p01, &p10, end01, end10)
                        || v(&p01, &p11, end01, end11));
                if is_interior_int || is_interior_vertex_int {
                    let n = crate::js::num::to_string;
                    return Err(JtsError::Runtime(format!(
                        "found non-noded intersection between LINESTRING ( {} {}, {} {} ) and LINESTRING ( {} {}, {} {} )",
                        n(p00.x), n(p00.y), n(p01.x), n(p01.y), n(p10.x), n(p10.y), n(p11.x), n(p11.y)
                    )));
                }
            }
        }
        Ok(())
    }

    #[test]
    fn noding_validator_sweep_gives_the_all_pairs_verdict_and_message() {
        let mut s: u64 = 99;
        let mut rnd = |n: u64| {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (s >> 33) % n
        };
        let (mut failing, mut nan) = (0, 0);
        for trial in 0..3000 {
            let n_edges = 1 + rnd(5) as usize;
            let grid = [3, 5, 9][trial % 3];
            let edges: Vec<Vec<Coord>> = (0..n_edges)
                .map(|_| {
                    let n = 2 + rnd(5) as usize;
                    (0..n)
                        .map(|_| {
                            let x = if rnd(60) == 0 {
                                f64::NAN
                            } else {
                                rnd(grid) as f64
                            };
                            c(x, rnd(grid) as f64)
                        })
                        .collect()
                })
                .collect();
            let want = check_noding_valid_all_pairs(&edges);
            let got = check_noding_valid(&edges);
            assert_eq!(got, want, "trial {trial}: {edges:?}");
            failing += want.is_err() as usize;
            nan += edges.iter().flatten().any(|p| p.x.is_nan()) as usize;
        }
        assert!(failing > 500 && failing < 2900, "{failing} failing");
        assert!(nan > 100, "{nan} with NaN");
    }

    #[test]
    fn noding_validator_scales_with_the_overlapping_pairs() {
        // 40 non-crossing lines of 1000 vertices (40 000 segments): the
        // all-pairs validator took 2.7 s (release) on this; the sweep
        // tests only the pairs overlapping in x.
        let edges: Vec<Vec<Coord>> = (0..40)
            .map(|k| {
                (0..1000)
                    .map(|i| {
                        let x = i as f64;
                        c(x, -2.0 * k as f64 + if i % 2 == 0 { 0.4 } else { -0.4 })
                    })
                    .collect()
            })
            .collect();
        let t = std::time::Instant::now();
        assert_eq!(check_noding_valid(&edges), Ok(()));
        let elapsed = t.elapsed();
        // generous: well under a second in release, a few in debug
        assert!(elapsed.as_secs_f64() < 20.0, "{elapsed:?}");
    }

    #[test]
    fn common_bits_keep_the_shared_leading_bits() {
        let mut cb = CommonBits::default();
        cb.add(-220.0);
        cb.add(-164.0);
        // both in [-256, -128): sign, exponent and the leading mantissa bit
        assert_eq!(cb.common(), -128.0 - 64.0);
        let mut cb = CommonBits::default();
        cb.add(-1.0);
        cb.add(1.0);
        assert_eq!(cb.common(), 0.0);
    }
}
