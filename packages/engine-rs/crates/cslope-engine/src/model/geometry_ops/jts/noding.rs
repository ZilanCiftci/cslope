//! Snap-rounding noding as jsts 2.12.1 does it: `GeometryNoder` with an
//! `MCIndexSnapRounder` (Hobby's snap rounding, JTS's older version).
//!
//! 1. Interior intersections of all segments are found with a line
//!    intersector carrying the fixed precision model, so a proper crossing
//!    is rounded to the grid; they are added as nodes.
//! 2. Every intersection point is a hot pixel (the grid cell around the
//!    rounded point, in scaled coordinates); every segment passing through
//!    it gets a node at the (rounded) intersection point.
//! 3. Every vertex is a hot pixel too; a segment of another string, or a
//!    non-adjacent one of its own, passing through it gets a node at the
//!    vertex (not rounded), and the vertex itself becomes a node.
//!
//! Input vertices are not moved: only intersection points are rounded.
//! Nodes are kept per string in a sorted set, so the result does not depend
//! on the order in which jsts's spatial index visits the segments; the set
//! of segments a hot pixel is tested against does (a monotone chain is
//! descended only where its sub-envelope meets the pixel's safe envelope),
//! and that is reproduced with the same chains and recursion.

use super::algorithm::{
    env_intersects_seg, js_max, js_min, js_round, octant, Coord, Envelope, JtsError, JtsResult,
    LineIntersector, PrecisionModel,
};
use std::cmp::Ordering;

/// A `SegmentNode`.
#[derive(Debug, Clone, Copy)]
struct SegmentNode {
    coord: Coord,
    segment_index: usize,
    segment_octant: i32,
    is_interior: bool,
}

/// `SegmentPointComparator.compare`.
fn segment_point_compare(octant: i32, p0: &Coord, p1: &Coord) -> Ordering {
    if p0 == p1 {
        return Ordering::Equal;
    }
    let rel = |a: f64, b: f64| -> i32 {
        if a < b {
            -1
        } else if a > b {
            1
        } else {
            0
        }
    };
    let x = rel(p0.x, p1.x);
    let y = rel(p0.y, p1.y);
    let cmp = |s0: i32, s1: i32| -> Ordering {
        if s0 < 0 {
            return Ordering::Less;
        }
        if s0 > 0 {
            return Ordering::Greater;
        }
        if s1 < 0 {
            return Ordering::Less;
        }
        if s1 > 0 {
            return Ordering::Greater;
        }
        Ordering::Equal
    };
    match octant {
        0 => cmp(x, y),
        1 => cmp(y, x),
        2 => cmp(y, -x),
        3 => cmp(-x, y),
        4 => cmp(-x, -y),
        5 => cmp(-y, -x),
        6 => cmp(-y, x),
        7 => cmp(x, -y),
        _ => Ordering::Equal,
    }
}

impl SegmentNode {
    /// `SegmentNode.compareTo`.
    fn compare(&self, other: &SegmentNode) -> Ordering {
        if self.segment_index < other.segment_index {
            return Ordering::Less;
        }
        if self.segment_index > other.segment_index {
            return Ordering::Greater;
        }
        if self.coord == other.coord {
            return Ordering::Equal;
        }
        if !self.is_interior {
            return Ordering::Less;
        }
        if !other.is_interior {
            return Ordering::Greater;
        }
        segment_point_compare(self.segment_octant, &self.coord, &other.coord)
    }
}

/// A `NodedSegmentString`: points and node list.
struct NodedString {
    pts: Vec<Coord>,
    nodes: Vec<SegmentNode>,
}

impl NodedString {
    fn new(pts: Vec<Coord>) -> NodedString {
        NodedString {
            pts,
            nodes: Vec::new(),
        }
    }

    fn segment_octant(&self, index: usize) -> i32 {
        if index == self.pts.len() - 1 {
            return -1;
        }
        let (p0, p1) = (self.pts[index], self.pts[index + 1]);
        if p0 == p1 {
            0
        } else {
            octant(&p0, &p1)
        }
    }

    /// `SegmentNodeList.add`.
    fn node_add(&mut self, coord: Coord, segment_index: usize) {
        let node = SegmentNode {
            coord,
            segment_index,
            segment_octant: self.segment_octant(segment_index),
            is_interior: coord != self.pts[segment_index],
        };
        if let Err(pos) = self.nodes.binary_search_by(|n| n.compare(&node)) {
            self.nodes.insert(pos, node);
        }
    }

    /// `NodedSegmentString.addIntersection(intPt, segmentIndex)`.
    fn add_intersection(&mut self, int_pt: Coord, segment_index: usize) {
        let mut normalized = segment_index;
        let next = normalized + 1;
        if next < self.pts.len() && int_pt == self.pts[next] {
            normalized = next;
        }
        self.node_add(int_pt, normalized);
    }

    /// `SegmentNodeList.addSplitEdges`.
    fn split(&mut self, out: &mut Vec<Vec<Coord>>) {
        let max_seg = self.pts.len() - 1;
        self.node_add(self.pts[0], 0);
        self.node_add(self.pts[max_seg], max_seg);
        // addCollapsedNodes
        let mut collapsed: Vec<usize> = Vec::new();
        for k in 1..self.nodes.len() {
            let (ei0, ei1) = (self.nodes[k - 1], self.nodes[k]);
            if ei0.coord != ei1.coord {
                continue;
            }
            let mut between = ei1.segment_index as isize - ei0.segment_index as isize;
            if !ei1.is_interior {
                between -= 1;
            }
            if between == 1 {
                collapsed.push(ei0.segment_index + 1);
            }
        }
        for i in 0..self.pts.len().saturating_sub(2) {
            if self.pts[i] == self.pts[i + 2] {
                collapsed.push(i + 1);
            }
        }
        for v in collapsed {
            self.node_add(self.pts[v], v);
        }
        for k in 1..self.nodes.len() {
            let (ei0, ei1) = (self.nodes[k - 1], self.nodes[k]);
            out.push(self.split_edge_pts(&ei0, &ei1));
        }
    }

    /// `SegmentNodeList.createSplitEdgePts`.
    fn split_edge_pts(&self, ei0: &SegmentNode, ei1: &SegmentNode) -> Vec<Coord> {
        let npts = ei1.segment_index - ei0.segment_index + 2;
        if npts == 2 {
            return vec![ei0.coord, ei1.coord];
        }
        let last_seg_start = self.pts[ei1.segment_index];
        let use_int_pt1 = ei1.is_interior || ei1.coord != last_seg_start;
        let mut pts = Vec::with_capacity(npts);
        pts.push(ei0.coord);
        for i in (ei0.segment_index + 1)..=ei1.segment_index {
            pts.push(self.pts[i]);
        }
        if use_int_pt1 {
            pts.push(ei1.coord);
        }
        pts
    }
}

/// An index `MonotoneChain` (`MonotoneChainBuilder`, repeated points allowed).
#[derive(Debug, Clone, Copy)]
struct Chain {
    string: usize,
    start: usize,
    end: usize,
}

fn quadrant_unchecked(p0: &Coord, p1: &Coord) -> i32 {
    match (p1.x >= p0.x, p1.y >= p0.y) {
        (true, true) => 0,
        (false, true) => 1,
        (false, false) => 2,
        (true, false) => 3,
    }
}

fn find_chain_end(pts: &[Coord], start: usize) -> usize {
    let mut safe_start = start;
    while safe_start < pts.len() - 1 && pts[safe_start] == pts[safe_start + 1] {
        safe_start += 1;
    }
    if safe_start >= pts.len() - 1 {
        return pts.len() - 1;
    }
    let chain_quad = quadrant_unchecked(&pts[safe_start], &pts[safe_start + 1]);
    let mut last = start + 1;
    while last < pts.len() {
        if pts[last - 1] != pts[last] {
            let quad = quadrant_unchecked(&pts[last - 1], &pts[last]);
            if quad != chain_quad {
                break;
            }
        }
        last += 1;
    }
    last - 1
}

fn build_chains(strings: &[NodedString]) -> Vec<Chain> {
    let mut chains = Vec::new();
    for (si, s) in strings.iter().enumerate() {
        let pts = &s.pts;
        let mut chain_start = 0usize;
        loop {
            let chain_end = find_chain_end(pts, chain_start);
            chains.push(Chain {
                string: si,
                start: chain_start,
                end: chain_end,
            });
            chain_start = chain_end;
            if chain_start >= pts.len() - 1 {
                break;
            }
        }
    }
    chains
}

/// A `HotPixel`.
struct HotPixel {
    original: Coord,
    pt: Coord,
    scale: f64,
    minx: f64,
    maxx: f64,
    miny: f64,
    maxy: f64,
    corner: [Coord; 4],
}

const SAFE_ENV_EXPANSION_FACTOR: f64 = 0.75;

impl HotPixel {
    fn new(pt: Coord, scale: f64) -> HotPixel {
        let scaled = if scale != 1.0 {
            Coord::new(js_round(pt.x * scale), js_round(pt.y * scale))
        } else {
            pt
        };
        let tolerance = 0.5;
        let (minx, maxx) = (scaled.x - tolerance, scaled.x + tolerance);
        let (miny, maxy) = (scaled.y - tolerance, scaled.y + tolerance);
        HotPixel {
            original: pt,
            pt: scaled,
            scale,
            minx,
            maxx,
            miny,
            maxy,
            corner: [
                Coord::new(maxx, maxy),
                Coord::new(minx, maxy),
                Coord::new(minx, miny),
                Coord::new(maxx, miny),
            ],
        }
    }

    fn safe_envelope(&self) -> Envelope {
        let t = SAFE_ENV_EXPANSION_FACTOR / self.scale;
        Envelope {
            minx: self.original.x - t,
            maxx: self.original.x + t,
            miny: self.original.y - t,
            maxy: self.original.y + t,
        }
    }

    fn intersects(&self, li: &mut LineIntersector, p0: &Coord, p1: &Coord) -> bool {
        if self.scale == 1.0 {
            return self.intersects_scaled(li, p0, p1);
        }
        let s0 = Coord::new(js_round(p0.x * self.scale), js_round(p0.y * self.scale));
        let s1 = Coord::new(js_round(p1.x * self.scale), js_round(p1.y * self.scale));
        self.intersects_scaled(li, &s0, &s1)
    }

    fn intersects_scaled(&self, li: &mut LineIntersector, p0: &Coord, p1: &Coord) -> bool {
        let seg_minx = js_min(p0.x, p1.x);
        let seg_maxx = js_max(p0.x, p1.x);
        let seg_miny = js_min(p0.y, p1.y);
        let seg_maxy = js_max(p0.y, p1.y);
        let outside = self.maxx < seg_minx
            || self.minx > seg_maxx
            || self.maxy < seg_miny
            || self.miny > seg_maxy;
        if outside {
            return false;
        }
        self.intersects_tolerance_square(li, p0, p1)
    }

    fn intersects_tolerance_square(
        &self,
        li: &mut LineIntersector,
        p0: &Coord,
        p1: &Coord,
    ) -> bool {
        let mut intersects_left = false;
        let mut intersects_bottom = false;
        li.compute_intersection(p0, p1, &self.corner[0], &self.corner[1]);
        if li.is_proper() {
            return true;
        }
        li.compute_intersection(p0, p1, &self.corner[1], &self.corner[2]);
        if li.is_proper() {
            return true;
        }
        if li.has_intersection() {
            intersects_left = true;
        }
        li.compute_intersection(p0, p1, &self.corner[2], &self.corner[3]);
        if li.is_proper() {
            return true;
        }
        if li.has_intersection() {
            intersects_bottom = true;
        }
        li.compute_intersection(p0, p1, &self.corner[3], &self.corner[0]);
        if li.is_proper() {
            return true;
        }
        if intersects_left && intersects_bottom {
            return true;
        }
        if *p0 == self.pt {
            return true;
        }
        if *p1 == self.pt {
            return true;
        }
        false
    }
}

/// `MCIndexPointSnapper.snap(hotPixel, parentEdge, vertexIndex)`: adds a
/// node at the pixel's point to every selected segment through the pixel.
fn snap_hot_pixel(
    hp: &HotPixel,
    parent: Option<(usize, usize)>,
    chains: &[Chain],
    strings: &mut [NodedString],
    li: &mut LineIntersector,
) -> bool {
    let env = hp.safe_envelope();
    let mut is_node_added = false;
    for ch in chains {
        let pts_env = {
            let pts = &strings[ch.string].pts;
            Envelope::of_points(&pts[ch.start], &pts[ch.end])
        };
        if !pts_env.intersects(&env) {
            continue;
        }
        let mut selected: Vec<usize> = Vec::new();
        compute_select(
            &strings[ch.string].pts,
            &env,
            ch.start,
            ch.end,
            &mut selected,
        );
        for start_index in selected {
            if let Some((ps, vi)) = parent {
                if ps == ch.string && (start_index == vi || start_index + 1 == vi) {
                    continue;
                }
            }
            // HotPixel.addSnappedNode
            let s = &strings[ch.string];
            let (p0, p1) = (s.pts[start_index], s.pts[start_index + 1]);
            if hp.intersects(li, &p0, &p1) {
                strings[ch.string].add_intersection(hp.original, start_index);
                is_node_added = true;
            }
        }
    }
    is_node_added
}

/// `MonotoneChain.computeSelect`: a leaf segment is selected without its
/// own envelope test.
fn compute_select(pts: &[Coord], env: &Envelope, start0: usize, end0: usize, out: &mut Vec<usize>) {
    if end0 - start0 == 1 {
        out.push(start0);
        return;
    }
    if !env.intersects_segment(&pts[start0], &pts[end0]) {
        return;
    }
    let mid = (start0 + end0) / 2;
    if start0 < mid {
        compute_select(pts, env, start0, mid, out);
    }
    if mid < end0 {
        compute_select(pts, env, mid, end0, out);
    }
}

/// `MonotoneChain.computeOverlaps` with the `InteriorIntersectionFinderAdder`.
#[allow(clippy::too_many_arguments)]
fn compute_overlaps(
    strings: &mut [NodedString],
    a: usize,
    start0: usize,
    end0: usize,
    b: usize,
    start1: usize,
    end1: usize,
    li: &mut LineIntersector,
    found: &mut Vec<Coord>,
) {
    if end0 - start0 == 1 && end1 - start1 == 1 {
        if a == b && start0 == start1 {
            return;
        }
        let p00 = strings[a].pts[start0];
        let p01 = strings[a].pts[start0 + 1];
        let p10 = strings[b].pts[start1];
        let p11 = strings[b].pts[start1 + 1];
        li.compute_intersection(&p00, &p01, &p10, &p11);
        if li.has_intersection() && li.is_interior_intersection() {
            for i in 0..li.intersection_num() {
                found.push(li.int_pt[i]);
            }
            for i in 0..li.intersection_num() {
                let p = li.int_pt[i];
                strings[a].add_intersection(p, start0);
            }
            for i in 0..li.intersection_num() {
                let p = li.int_pt[i];
                strings[b].add_intersection(p, start1);
            }
        }
        return;
    }
    let overlaps = env_intersects_seg(
        &strings[a].pts[start0],
        &strings[a].pts[end0],
        &strings[b].pts[start1],
        &strings[b].pts[end1],
    );
    if !overlaps {
        return;
    }
    let mid0 = (start0 + end0) / 2;
    let mid1 = (start1 + end1) / 2;
    if start0 < mid0 {
        if start1 < mid1 {
            compute_overlaps(strings, a, start0, mid0, b, start1, mid1, li, found);
        }
        if mid1 < end1 {
            compute_overlaps(strings, a, start0, mid0, b, mid1, end1, li, found);
        }
    }
    if mid0 < end0 {
        if start1 < mid1 {
            compute_overlaps(strings, a, mid0, end0, b, start1, mid1, li, found);
        }
        if mid1 < end1 {
            compute_overlaps(strings, a, mid0, end0, b, mid1, end1, li, found);
        }
    }
}

/// `new GeometryNoder(new PrecisionModel(scale)).node(lines)`: the lines
/// noded by snap rounding, as line strings of at least two points.
pub fn snap_round_node(lines: &[Vec<Coord>], scale: f64) -> JtsResult<Vec<Vec<Coord>>> {
    let pm = PrecisionModel::fixed(scale);
    let scale = pm.scale;
    if scale <= 0.0 {
        return Err(JtsError::Other("Scale factor must be non-zero".into()));
    }
    let mut li = LineIntersector::new(Some(pm));
    let mut strings: Vec<NodedString> = lines.iter().map(|l| NodedString::new(l.clone())).collect();
    if strings.iter().any(|s| s.pts.is_empty()) {
        return Err(JtsError::Other("empty line string".into()));
    }
    let chains = build_chains(&strings);
    // findInteriorIntersections: each pair of chains with overlapping
    // envelopes, once (MCIndexNoder: test chain id > query chain id).
    let mut found: Vec<Coord> = Vec::new();
    for (qi, q) in chains.iter().enumerate() {
        let q_env = Envelope::of_points(
            &strings[q.string].pts[q.start],
            &strings[q.string].pts[q.end],
        );
        for t in chains.iter().skip(qi + 1) {
            let t_env = Envelope::of_points(
                &strings[t.string].pts[t.start],
                &strings[t.string].pts[t.end],
            );
            if !q_env.intersects(&t_env) {
                continue;
            }
            compute_overlaps(
                &mut strings,
                q.string,
                q.start,
                q.end,
                t.string,
                t.start,
                t.end,
                &mut li,
                &mut found,
            );
        }
    }
    // computeIntersectionSnaps
    for p in &found {
        let hp = HotPixel::new(*p, scale);
        snap_hot_pixel(&hp, None, &chains, &mut strings, &mut li);
    }
    // computeVertexSnaps
    for si in 0..strings.len() {
        for i in 0..strings[si].pts.len() {
            let p = strings[si].pts[i];
            let hp = HotPixel::new(p, scale);
            if snap_hot_pixel(&hp, Some((si, i)), &chains, &mut strings, &mut li) {
                strings[si].add_intersection(p, i);
            }
        }
    }
    let mut out: Vec<Vec<Coord>> = Vec::new();
    for s in strings.iter_mut() {
        s.split(&mut out);
    }
    Ok(out.into_iter().filter(|l| l.len() >= 2).collect())
}
