//! The noding part of the JTS geometry graph (`geomgraph`), as the old
//! overlay (`OverlayOp`) and `IsValidOp` use it: edges with their sorted
//! intersection lists, the monotone-chain sweep-line intersector
//! (`SimpleMCSweepLineIntersector`) and `SegmentIntersector`.
//!
//! Where two intersections fall on the same key (segment index and edge
//! distance) the first one found is kept, so the order in which the sweep
//! visits chain pairs is reproduced exactly.

use super::algorithm::{cmp_num, env_intersects_seg, quadrant, Coord, JtsResult, LineIntersector};
use std::cmp::Ordering;

/// An `EdgeIntersection`: a node on an edge.
#[derive(Debug, Clone, Copy)]
pub struct EdgeIntersection {
    pub coord: Coord,
    pub segment_index: usize,
    pub dist: f64,
}

impl EdgeIntersection {
    fn compare(&self, segment_index: usize, dist: f64) -> Ordering {
        if self.segment_index < segment_index {
            return Ordering::Less;
        }
        if self.segment_index > segment_index {
            return Ordering::Greater;
        }
        if self.dist < dist {
            return Ordering::Less;
        }
        if self.dist > dist {
            return Ordering::Greater;
        }
        Ordering::Equal
    }
}

/// A `geomgraph.Edge`: its points (repeated points removed by the graph)
/// and its `EdgeIntersectionList` (a tree map keyed by segment index and
/// distance; an existing key keeps its first coordinate).
#[derive(Debug, Clone)]
pub struct Edge {
    pub pts: Vec<Coord>,
    pub ei_list: Vec<EdgeIntersection>,
    /// `MonotoneChainIndexer.getChainStartIndices`, computed on first use.
    start_index: Option<Vec<usize>>,
    /// `isIsolated()`: no intersection found by a `SegmentIntersector`
    /// that records them (the relate computation's).
    pub is_isolated: bool,
}

impl Edge {
    pub fn new(pts: Vec<Coord>) -> Edge {
        Edge {
            pts,
            ei_list: Vec::new(),
            start_index: None,
            is_isolated: true,
        }
    }

    pub fn is_closed(&self) -> bool {
        self.pts[0] == self.pts[self.pts.len() - 1]
    }

    /// `EdgeIntersectionList.add`.
    pub fn ei_add(&mut self, coord: Coord, segment_index: usize, dist: f64) {
        match self
            .ei_list
            .binary_search_by(|e| e.compare(segment_index, dist))
        {
            Ok(_) => {}
            Err(pos) => self.ei_list.insert(
                pos,
                EdgeIntersection {
                    coord,
                    segment_index,
                    dist,
                },
            ),
        }
    }

    /// `Edge.addIntersections(li, segmentIndex, geomIndex)`.
    pub fn add_intersections(
        &mut self,
        li: &LineIntersector,
        segment_index: usize,
        geom_index: usize,
    ) -> JtsResult<()> {
        for i in 0..li.intersection_num() {
            self.add_intersection(li, segment_index, geom_index, i)?;
        }
        Ok(())
    }

    fn add_intersection(
        &mut self,
        li: &LineIntersector,
        segment_index: usize,
        geom_index: usize,
        int_index: usize,
    ) -> JtsResult<()> {
        let int_pt = li.int_pt[int_index];
        let mut normalized = segment_index;
        let mut dist = li.edge_distance(geom_index, int_index)?;
        let next = normalized + 1;
        if next < self.pts.len() && int_pt == self.pts[next] {
            normalized = next;
            dist = 0.0;
        }
        self.ei_add(int_pt, normalized, dist);
        Ok(())
    }

    fn chain_start_indices(&mut self) -> JtsResult<&Vec<usize>> {
        if self.start_index.is_none() {
            self.start_index = Some(chain_start_indices(&self.pts)?);
        }
        Ok(self.start_index.as_ref().expect("computed above"))
    }

    /// `EdgeIntersectionList.addEndpoints`.
    pub fn ei_add_endpoints(&mut self) {
        let max_seg = self.pts.len() - 1;
        self.ei_add(self.pts[0], 0, 0.0);
        self.ei_add(self.pts[max_seg], max_seg, 0.0);
    }

    /// `EdgeIntersectionList.addSplitEdges`: the edge cut at its nodes.
    pub fn split_edges(&mut self, out: &mut Vec<Vec<Coord>>) {
        self.ei_add_endpoints();
        for k in 1..self.ei_list.len() {
            let ei0 = self.ei_list[k - 1];
            let ei1 = self.ei_list[k];
            out.push(self.create_split_edge(&ei0, &ei1));
        }
    }

    fn create_split_edge(&self, ei0: &EdgeIntersection, ei1: &EdgeIntersection) -> Vec<Coord> {
        let last_seg_start = self.pts[ei1.segment_index];
        let use_int_pt1 = ei1.dist > 0.0 || ei1.coord != last_seg_start;
        let mut pts = Vec::with_capacity(ei1.segment_index - ei0.segment_index + 2);
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

/// `MonotoneChainIndexer.getChainStartIndices` (geomgraph's version, for
/// points without repeats).
fn chain_start_indices(pts: &[Coord]) -> JtsResult<Vec<usize>> {
    let mut start = 0usize;
    let mut list = vec![start];
    loop {
        let last = find_chain_end(pts, start)?;
        list.push(last);
        start = last;
        if start >= pts.len() - 1 {
            break;
        }
    }
    Ok(list)
}

fn find_chain_end(pts: &[Coord], start: usize) -> JtsResult<usize> {
    let chain_quad = quadrant(&pts[start], &pts[start + 1])?;
    let mut last = start + 1;
    while last < pts.len() {
        let quad = quadrant(&pts[last - 1], &pts[last])?;
        if quad != chain_quad {
            break;
        }
        last += 1;
    }
    Ok(last - 1)
}

/// geomgraph's `SegmentIntersector`.
pub struct SegmentIntersector {
    pub li: LineIntersector,
    include_proper: bool,
    record_isolated: bool,
    is_done_when_proper_int: bool,
    pub is_done: bool,
    pub has_intersection: bool,
    pub has_proper: bool,
    /// A proper intersection not at a boundary node of either geometry.
    pub has_proper_interior: bool,
    /// `setBoundaryNodes`: the boundary node coordinates of both graphs.
    bdy_nodes: Option<[Vec<Coord>; 2]>,
}

impl SegmentIntersector {
    /// `new SegmentIntersector(li, includeProper, false)`.
    pub fn new(li: LineIntersector, include_proper: bool) -> SegmentIntersector {
        SegmentIntersector {
            li,
            include_proper,
            record_isolated: false,
            is_done_when_proper_int: false,
            is_done: false,
            has_intersection: false,
            has_proper: false,
            has_proper_interior: false,
            bdy_nodes: None,
        }
    }

    /// `new SegmentIntersector(li, includeProper, true)`: edges with an
    /// intersection are marked as not isolated.
    pub fn recording_isolated(li: LineIntersector, include_proper: bool) -> SegmentIntersector {
        SegmentIntersector {
            record_isolated: true,
            ..SegmentIntersector::new(li, include_proper)
        }
    }

    pub fn set_boundary_nodes(&mut self, bdy_nodes0: Vec<Coord>, bdy_nodes1: Vec<Coord>) {
        self.bdy_nodes = Some([bdy_nodes0, bdy_nodes1]);
    }

    /// `isBoundaryPoint(li, bdyNodes)`.
    fn is_boundary_point(&self) -> bool {
        match &self.bdy_nodes {
            None => false,
            Some(nodes) => nodes
                .iter()
                .any(|list| list.iter().any(|pt| self.li.is_intersection(pt))),
        }
    }

    pub fn set_is_done_if_proper_int(&mut self, v: bool) {
        self.is_done_when_proper_int = v;
    }

    /// `isTrivialIntersection`. (The closing pair of a closed edge is
    /// tested against `getNumPoints() - 1`, the last point index, as in
    /// JTS, so it never matches a segment index.)
    fn is_trivial_intersection(
        &self,
        edges: &[Edge],
        e0: usize,
        s0: usize,
        e1: usize,
        s1: usize,
    ) -> bool {
        if e0 == e1 && self.li.intersection_num() == 1 {
            if s0.abs_diff(s1) == 1 {
                return true;
            }
            if edges[e0].is_closed() {
                let max_seg_index = edges[e0].pts.len() - 1;
                if (s0 == 0 && s1 == max_seg_index) || (s1 == 0 && s0 == max_seg_index) {
                    return true;
                }
            }
        }
        false
    }

    /// `addIntersections(e0, segIndex0, e1, segIndex1)`.
    pub fn add_intersections(
        &mut self,
        edges: &mut [Edge],
        e0: usize,
        s0: usize,
        e1: usize,
        s1: usize,
    ) -> JtsResult<()> {
        if e0 == e1 && s0 == s1 {
            return Ok(());
        }
        let p00 = edges[e0].pts[s0];
        let p01 = edges[e0].pts[s0 + 1];
        let p10 = edges[e1].pts[s1];
        let p11 = edges[e1].pts[s1 + 1];
        self.li.compute_intersection(&p00, &p01, &p10, &p11);
        if !self.li.has_intersection() {
            return Ok(());
        }
        if self.record_isolated {
            edges[e0].is_isolated = false;
            edges[e1].is_isolated = false;
        }
        if !self.is_trivial_intersection(edges, e0, s0, e1, s1) {
            self.has_intersection = true;
            if self.include_proper || !self.li.is_proper() {
                edges[e0].add_intersections(&self.li, s0, 0)?;
                edges[e1].add_intersections(&self.li, s1, 1)?;
            }
            if self.li.is_proper() {
                self.has_proper = true;
                if self.is_done_when_proper_int {
                    self.is_done = true;
                }
                if !self.is_boundary_point() {
                    self.has_proper_interior = true;
                }
            }
        }
        Ok(())
    }
}

/// A sweep-line event of `SimpleMCSweepLineIntersector`.
struct SweepEvent {
    x: f64,
    /// INSERT 1, DELETE 2.
    kind: u8,
    /// The edge set (`null` in jsts: every chain pair is tested).
    label: Option<usize>,
    edge: usize,
    chain_index: usize,
    insert_event: usize,
    delete_event_index: usize,
}

/// `SimpleMCSweepLineIntersector.computeIntersections` over the given
/// edges, each with its set label (`None`: test against all chains,
/// including its own; equal labels are not tested against each other).
pub fn sweep_intersections(
    edges: &mut [Edge],
    members: &[(usize, Option<usize>)],
    si: &mut SegmentIntersector,
) -> JtsResult<()> {
    let mut events: Vec<SweepEvent> = Vec::new();
    for &(e, label) in members {
        let starts = edges[e].chain_start_indices()?.clone();
        let pts = &edges[e].pts;
        for i in 0..starts.len() - 1 {
            let x1 = pts[starts[i]].x;
            let x2 = pts[starts[i + 1]].x;
            let min_x = if x1 < x2 { x1 } else { x2 };
            let max_x = if x1 > x2 { x1 } else { x2 };
            let insert = events.len();
            events.push(SweepEvent {
                x: min_x,
                kind: 1,
                label,
                edge: e,
                chain_index: i,
                insert_event: usize::MAX,
                delete_event_index: 0,
            });
            events.push(SweepEvent {
                x: max_x,
                kind: 2,
                label: None,
                edge: e,
                chain_index: i,
                insert_event: insert,
                delete_event_index: 0,
            });
        }
    }
    // prepareEvents: a stable sort by x, inserts before deletes. The insert
    // event of a delete is tracked through the permutation.
    let mut order: Vec<usize> = (0..events.len()).collect();
    crate::js::array::sort_by(&mut order, |&a, &b| {
        let (ea, eb) = (&events[a], &events[b]);
        if ea.x < eb.x {
            return -1.0;
        }
        if ea.x > eb.x {
            return 1.0;
        }
        cmp_num(ea.kind.cmp(&eb.kind))
    });
    for (pos, &ev) in order.iter().enumerate() {
        if events[ev].kind == 2 {
            let ins = events[ev].insert_event;
            events[ins].delete_event_index = pos;
        }
    }
    for i in 0..order.len() {
        let ev0 = order[i];
        if events[ev0].kind == 1 {
            let end = events[ev0].delete_event_index;
            // processOverlaps(i, end, ev0, si)
            for &ev1 in order.iter().take(end).skip(i) {
                if events[ev1].kind != 1 {
                    continue;
                }
                let same_label = match events[ev0].label {
                    None => false,
                    Some(l) => events[ev1].label == Some(l),
                };
                if !same_label {
                    let (e0, c0) = (events[ev0].edge, events[ev0].chain_index);
                    let (e1, c1) = (events[ev1].edge, events[ev1].chain_index);
                    compute_intersects_for_chain(edges, e0, c0, e1, c1, si)?;
                }
            }
        }
        if si.is_done {
            break;
        }
    }
    Ok(())
}

/// `MonotoneChainEdge.computeIntersectsForChain(chainIndex0, mce, chainIndex1, si)`.
fn compute_intersects_for_chain(
    edges: &mut [Edge],
    e0: usize,
    c0: usize,
    e1: usize,
    c1: usize,
    si: &mut SegmentIntersector,
) -> JtsResult<()> {
    let (s0, t0) = {
        let st = edges[e0].start_index.as_ref().expect("chains built");
        (st[c0], st[c0 + 1])
    };
    let (s1, t1) = {
        let st = edges[e1].start_index.as_ref().expect("chains built");
        (st[c1], st[c1 + 1])
    };
    chain_overlaps(edges, e0, s0, t0, e1, s1, t1, si)
}

#[allow(clippy::too_many_arguments)]
fn chain_overlaps(
    edges: &mut [Edge],
    e0: usize,
    start0: usize,
    end0: usize,
    e1: usize,
    start1: usize,
    end1: usize,
    si: &mut SegmentIntersector,
) -> JtsResult<()> {
    if end0 - start0 == 1 && end1 - start1 == 1 {
        return si.add_intersections(edges, e0, start0, e1, start1);
    }
    let overlaps = {
        let p = &edges[e0].pts;
        let q = &edges[e1].pts;
        env_intersects_seg(&p[start0], &p[end0], &q[start1], &q[end1])
    };
    if !overlaps {
        return Ok(());
    }
    let mid0 = (start0 + end0) / 2;
    let mid1 = (start1 + end1) / 2;
    if start0 < mid0 {
        if start1 < mid1 {
            chain_overlaps(edges, e0, start0, mid0, e1, start1, mid1, si)?;
        }
        if mid1 < end1 {
            chain_overlaps(edges, e0, start0, mid0, e1, mid1, end1, si)?;
        }
    }
    if mid0 < end0 {
        if start1 < mid1 {
            chain_overlaps(edges, e0, mid0, end0, e1, start1, mid1, si)?;
        }
        if mid1 < end1 {
            chain_overlaps(edges, e0, mid0, end0, e1, mid1, end1, si)?;
        }
    }
    Ok(())
}

/// `IsValidOp.checkNoSelfIntersectingRing`: a repeated node coordinate in
/// the intersection list, after skipping the first entry as JTS does.
pub fn has_self_intersecting_ring(edge: &Edge) -> bool {
    let mut seen: Vec<Coord> = Vec::new();
    for ei in edge.ei_list.iter().skip(1) {
        if seen.iter().any(|c| c.compare(&ei.coord) == Ordering::Equal) {
            return true;
        }
        seen.push(ei.coord);
    }
    false
}

/// `IsValidOp.isValid(LinearRing)`: finite coordinates, closed, at least
/// two distinct points, and no self-intersection found by the graph's self
/// noding (which stops at the first proper intersection).
pub fn is_valid_ring(coords: &[Coord]) -> JtsResult<bool> {
    if coords.iter().any(|c| !c.x.is_finite() || !c.y.is_finite()) {
        return Ok(false);
    }
    if coords.is_empty() {
        return Ok(true);
    }
    if coords[0] != coords[coords.len() - 1] {
        return Ok(false);
    }
    let pts = super::algorithm::remove_repeated_points(coords);
    if pts.len() < 2 {
        return Ok(false);
    }
    let mut edges = vec![Edge::new(pts)];
    let mut si = SegmentIntersector::new(LineIntersector::new(None), true);
    si.set_is_done_if_proper_int(true);
    sweep_intersections(&mut edges, &[(0, None)], &mut si)?;
    Ok(!has_self_intersecting_ring(&edges[0]))
}
