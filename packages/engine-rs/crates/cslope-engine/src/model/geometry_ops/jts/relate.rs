//! `Geometry.intersects` of a polygon (one ring) and a line string, as jsts
//! computes it (`RelateOp.intersects`): envelopes, then `RectangleIntersects`
//! when the polygon is an axis-aligned rectangle, else the full relate
//! computation (`RelateComputer`: the two geometry graphs, their self and
//! mutual nodes, edge ends bundled into stars at every node, the labelling
//! of the stars and the intersection matrix).
//!
//! The relate computation is ported in full rather than replaced by a
//! segment test, because its result and its failures are what
//! `splitPolygonByPolylineDetailed` sees on degenerate input: a line of one
//! distinct point intersects only at the polygon's first vertex (the only
//! node of the polygon's graph), and a self-crossing outline makes the
//! labelling of a star throw "side location conflict" (outside the try in
//! TypeScript, so the split throws). Orders follow jsts: graph nodes and
//! relate nodes in coordinate order (`NodeMap`, a tree map), the bundles of
//! a star in direction order (`EdgeEndStar`, a tree map on
//! `EdgeEnd.compareTo`), edges in insertion order.

use super::algorithm::{
    assert_true, fmt_coord, is_ccw, locate_in_polygon_ring, orientation_index, quadrant_dxdy,
    remove_repeated_points, Coord, Envelope, JtsError, JtsResult, LineIntersector, Location,
};
use super::geomgraph::{sweep_intersections, Edge, SegmentIntersector};
use std::cmp::Ordering;

// `Location`
const NONE: i32 = -1;
const INTERIOR: i32 = 0;
const BOUNDARY: i32 = 1;
const EXTERIOR: i32 = 2;
// `Position`
const ON: usize = 0;
const LEFT: usize = 1;
const RIGHT: usize = 2;

fn loc_value(l: Location) -> i32 {
    match l {
        Location::Interior => INTERIOR,
        Location::Boundary => BOUNDARY,
        Location::Exterior => EXTERIOR,
    }
}

/// `TopologyLocation`: an "on" location, or on, left and right (an area).
#[derive(Debug, Clone, Copy, PartialEq)]
struct TopoLoc {
    location: [i32; 3],
    len: usize,
}

impl TopoLoc {
    fn line(on: i32) -> TopoLoc {
        TopoLoc {
            location: [on, NONE, NONE],
            len: 1,
        }
    }

    fn area(on: i32, left: i32, right: i32) -> TopoLoc {
        TopoLoc {
            location: [on, left, right],
            len: 3,
        }
    }

    fn get(&self, pos: usize) -> i32 {
        if pos < self.len {
            self.location[pos]
        } else {
            NONE
        }
    }

    fn set(&mut self, pos: usize, loc: i32) {
        // (JavaScript grows the array; never done on a line location here)
        if pos >= self.len {
            self.len = pos + 1;
        }
        self.location[pos] = loc;
    }

    fn set_all(&mut self, loc: i32) {
        for i in 0..self.len {
            self.location[i] = loc;
        }
    }

    fn set_all_if_null(&mut self, loc: i32) {
        for i in 0..self.len {
            if self.location[i] == NONE {
                self.location[i] = loc;
            }
        }
    }

    fn is_null(&self) -> bool {
        self.location[..self.len].iter().all(|&l| l == NONE)
    }

    fn is_any_null(&self) -> bool {
        self.location[..self.len].contains(&NONE)
    }

    fn is_area(&self) -> bool {
        self.len > 1
    }

    fn is_line(&self) -> bool {
        self.len == 1
    }

    fn flip(&mut self) {
        if self.len <= 1 {
            return;
        }
        self.location.swap(LEFT, RIGHT);
    }
}

/// `Label`: the topology locations with respect to both geometries.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Label {
    elt: [TopoLoc; 2],
}

impl Label {
    /// `new Label(onLoc)` (and a node's `new Label(0, NONE)`).
    fn line(on: i32) -> Label {
        Label {
            elt: [TopoLoc::line(on), TopoLoc::line(on)],
        }
    }

    /// `new Label(geomIndex, onLoc)`.
    fn line_of(geom_index: usize, on: i32) -> Label {
        let mut l = Label::line(NONE);
        l.elt[geom_index].set(ON, on);
        l
    }

    /// `new Label(onLoc, leftLoc, rightLoc)`.
    fn area(on: i32, left: i32, right: i32) -> Label {
        Label {
            elt: [
                TopoLoc::area(on, left, right),
                TopoLoc::area(on, left, right),
            ],
        }
    }

    /// `new Label(geomIndex, onLoc, leftLoc, rightLoc)`.
    fn area_of(geom_index: usize, on: i32, left: i32, right: i32) -> Label {
        let mut l = Label::area(NONE, NONE, NONE);
        l.elt[geom_index] = TopoLoc::area(on, left, right);
        l
    }

    fn get(&self, geom_index: usize, pos: usize) -> i32 {
        self.elt[geom_index].get(pos)
    }

    fn set(&mut self, geom_index: usize, pos: usize, loc: i32) {
        self.elt[geom_index].set(pos, loc);
    }

    fn geometry_count(&self) -> usize {
        self.elt.iter().filter(|t| !t.is_null()).count()
    }

    fn is_area(&self) -> bool {
        self.elt[0].is_area() || self.elt[1].is_area()
    }

    fn flip(&mut self) {
        self.elt[0].flip();
        self.elt[1].flip();
    }
}

/// `IntersectionMatrix` (rows: locations in A, columns: in B; -1 FALSE).
struct Matrix([[i32; 3]; 3]);

impl Matrix {
    fn set_at_least(&mut self, row: i32, col: i32, dim: i32) {
        let cell = &mut self.0[row as usize][col as usize];
        if *cell < dim {
            *cell = dim;
        }
    }

    fn set_at_least_if_valid(&mut self, row: i32, col: i32, dim: i32) {
        if row >= 0 && col >= 0 {
            self.set_at_least(row, col, dim);
        }
    }

    /// `setAtLeast(String)` for patterns of 'F', '0', '1' and '2'.
    fn set_at_least_pattern(&mut self, pattern: &str) {
        for (i, c) in pattern.chars().enumerate() {
            let dim = match c {
                '0' => 0,
                '1' => 1,
                '2' => 2,
                _ => -1,
            };
            self.set_at_least((i / 3) as i32, (i % 3) as i32, dim);
        }
    }

    fn is_intersects(&self) -> bool {
        let m = &self.0;
        let (i, b) = (INTERIOR as usize, BOUNDARY as usize);
        !(m[i][i] == -1 && m[i][b] == -1 && m[b][i] == -1 && m[b][b] == -1)
    }

    /// `Edge.updateIM(label, im)` (also an `EdgeEndBundle`'s).
    fn update_from_label(&mut self, label: &Label) {
        self.set_at_least_if_valid(label.get(0, ON), label.get(1, ON), 1);
        if label.is_area() {
            self.set_at_least_if_valid(label.get(0, LEFT), label.get(1, LEFT), 2);
            self.set_at_least_if_valid(label.get(0, RIGHT), label.get(1, RIGHT), 2);
        }
    }
}

/// A tree map from coordinates (`Coordinate.compareTo`) as a sorted list.
struct NodeMap<T> {
    nodes: Vec<(Coord, T)>,
}

impl<T> NodeMap<T> {
    fn new() -> NodeMap<T> {
        NodeMap { nodes: Vec::new() }
    }

    fn search(&self, c: &Coord) -> Result<usize, usize> {
        self.nodes.binary_search_by(|(k, _)| k.compare(c))
    }

    fn find(&self, c: &Coord) -> Option<&T> {
        self.search(c).ok().map(|i| &self.nodes[i].1)
    }

    /// `addNode(coord)`: the node at c, created by `make` if missing.
    fn add_node(&mut self, c: Coord, make: impl FnOnce() -> T) -> &mut T {
        let i = match self.search(&c) {
            Ok(i) => i,
            Err(i) => {
                self.nodes.insert(i, (c, make()));
                i
            }
        };
        &mut self.nodes[i].1
    }
}

/// A `GeometryGraph` node's label (its edges are not needed here).
type GraphNodes = NodeMap<Label>;

/// The parent geometry of a graph.
enum Parent<'a> {
    Polygon(&'a [Coord]),
    Line(&'a [Coord]),
}

/// A `GeometryGraph`: its edges (indices into the shared list, with their
/// labels) and nodes.
struct GeometryGraph<'a> {
    arg_index: usize,
    parent: Parent<'a>,
    edges: Vec<usize>,
    nodes: GraphNodes,
}

impl<'a> GeometryGraph<'a> {
    fn new(
        arg_index: usize,
        parent: Parent<'a>,
        edges: &mut Vec<Edge>,
        labels: &mut Vec<Label>,
    ) -> JtsResult<GeometryGraph<'a>> {
        let mut g = GeometryGraph {
            arg_index,
            parent,
            edges: Vec::new(),
            nodes: NodeMap::new(),
        };
        match g.parent {
            Parent::Polygon(ring) => {
                // addPolygonRing(shell, EXTERIOR, INTERIOR)
                if !ring.is_empty() {
                    let coord = remove_repeated_points(ring);
                    if coord.len() >= 4 {
                        let (mut left, mut right) = (EXTERIOR, INTERIOR);
                        if is_ccw(&coord)? {
                            left = INTERIOR;
                            right = EXTERIOR;
                        }
                        let first = coord[0];
                        g.insert_edge(
                            edges,
                            labels,
                            coord,
                            Label::area_of(arg_index, BOUNDARY, left, right),
                        );
                        g.insert_point(first, BOUNDARY);
                    }
                }
            }
            Parent::Line(line) => {
                // addLineString
                let coord = remove_repeated_points(line);
                if coord.len() >= 2 {
                    let (first, last) = (coord[0], coord[coord.len() - 1]);
                    g.insert_edge(edges, labels, coord, Label::line_of(arg_index, INTERIOR));
                    g.insert_boundary_point(first);
                    g.insert_boundary_point(last);
                }
            }
        }
        Ok(g)
    }

    fn insert_edge(
        &mut self,
        edges: &mut Vec<Edge>,
        labels: &mut Vec<Label>,
        pts: Vec<Coord>,
        label: Label,
    ) {
        self.edges.push(edges.len());
        edges.push(Edge::new(pts));
        labels.push(label);
    }

    fn is_rings(&self) -> bool {
        matches!(self.parent, Parent::Polygon(_))
    }

    /// `insertPoint(argIndex, coord, onLocation)`.
    fn insert_point(&mut self, c: Coord, on: i32) {
        let arg = self.arg_index;
        self.nodes
            .add_node(c, || Label::line(NONE))
            .set(arg, ON, on);
    }

    /// `insertBoundaryPoint(argIndex, coord)` (the Mod-2 boundary rule).
    fn insert_boundary_point(&mut self, c: Coord) {
        let arg = self.arg_index;
        let lbl = self.nodes.add_node(c, || Label::line(NONE));
        let mut boundary_count = 1;
        if lbl.get(arg, ON) == BOUNDARY {
            boundary_count += 1;
        }
        lbl.set(arg, ON, determine_boundary(boundary_count));
    }

    /// `isBoundaryNode(argIndex, coord)`.
    fn is_boundary_node(&self, c: &Coord) -> bool {
        self.nodes
            .find(c)
            .is_some_and(|l| l.get(self.arg_index, ON) == BOUNDARY)
    }

    /// `getBoundaryNodes()`: coordinates of the nodes on the boundary.
    fn boundary_nodes(&self) -> Vec<Coord> {
        self.nodes
            .nodes
            .iter()
            .filter(|(_, l)| l.get(self.arg_index, ON) == BOUNDARY)
            .map(|(c, _)| *c)
            .collect()
    }

    /// `computeSelfNodes(li, false)`.
    fn compute_self_nodes(&mut self, edges: &mut [Edge], labels: &[Label]) -> JtsResult<()> {
        let mut si = SegmentIntersector::new(LineIntersector::new(None), true);
        let compute_all_segments = !self.is_rings();
        let members: Vec<(usize, Option<usize>)> = self
            .edges
            .iter()
            .map(|&e| (e, if compute_all_segments { None } else { Some(e) }))
            .collect();
        sweep_intersections(edges, &members, &mut si)?;
        // addSelfIntersectionNodes
        for e in self.edges.clone() {
            let e_loc = labels[e].get(self.arg_index, ON);
            for ei in &edges[e].ei_list {
                if self.is_boundary_node(&ei.coord) {
                    continue;
                }
                // (useBoundaryDeterminationRule is true)
                if e_loc == BOUNDARY {
                    self.insert_boundary_point(ei.coord);
                } else {
                    self.insert_point(ei.coord, e_loc);
                }
            }
        }
        Ok(())
    }

    /// `PointLocator.locate(p, parentGeometry)`.
    fn locate(&self, p: &Coord) -> i32 {
        match self.parent {
            Parent::Polygon(ring) => loc_value(locate_in_polygon_ring(p, ring)),
            Parent::Line(line) => locate_on_line_string(p, line),
        }
    }

    /// `SimplePointInAreaLocator.locate(p, parentGeometry)`: a line has
    /// no area, so every point is exterior to it.
    fn locate_in_area(&self, p: &Coord) -> i32 {
        match self.parent {
            Parent::Polygon(ring) => loc_value(locate_in_polygon_ring(p, ring)),
            Parent::Line(_) => EXTERIOR,
        }
    }
}

/// `GeometryGraph.determineBoundary` with the Mod-2 rule.
fn determine_boundary(boundary_count: usize) -> i32 {
    if boundary_count % 2 == 1 {
        BOUNDARY
    } else {
        INTERIOR
    }
}

/// `PointLocator.locateOnLineString(p, line)`.
fn locate_on_line_string(p: &Coord, line: &[Coord]) -> i32 {
    let Some(env) = Envelope::of_coords(line) else {
        return EXTERIOR;
    };
    if !env.intersects_point(p) {
        return EXTERIOR;
    }
    let first = line[0];
    let last = line[line.len() - 1];
    // !isClosed(): the end points are the boundary
    if first != last && (*p == first || *p == last) {
        return BOUNDARY;
    }
    // PointLocation.isOnLine
    for i in 1..line.len() {
        if point_on_segment(p, &line[i - 1], &line[i]) {
            return INTERIOR;
        }
    }
    EXTERIOR
}

/// `RobustLineIntersector.computeIntersection(p, p1, p2)`, has an
/// intersection.
fn point_on_segment(p: &Coord, p1: &Coord, p2: &Coord) -> bool {
    super::algorithm::env_intersects_pt(p1, p2, p)
        && orientation_index(p1, p2, p) == 0
        && orientation_index(p2, p1, p) == 0
}

/// An `EdgeEnd`: a direction out of a node along an edge, with its label.
#[derive(Debug, Clone, Copy)]
struct EdgeEnd {
    p0: Coord,
    p1: Coord,
    dx: f64,
    dy: f64,
    quadrant: i32,
    label: Label,
}

impl EdgeEnd {
    fn new(p0: Coord, p1: Coord, label: Label) -> JtsResult<EdgeEnd> {
        let dx = p1.x - p0.x;
        let dy = p1.y - p0.y;
        let quadrant = quadrant_dxdy(dx, dy)?;
        assert_true(
            !(dx == 0.0 && dy == 0.0),
            "EdgeEnd with identical endpoints found",
        )?;
        Ok(EdgeEnd {
            p0,
            p1,
            dx,
            dy,
            quadrant,
            label,
        })
    }

    /// `compareDirection(e)`.
    fn compare_direction(&self, e: &EdgeEnd) -> Ordering {
        if self.dx == e.dx && self.dy == e.dy {
            return Ordering::Equal;
        }
        if self.quadrant > e.quadrant {
            return Ordering::Greater;
        }
        if self.quadrant < e.quadrant {
            return Ordering::Less;
        }
        orientation_index(&e.p0, &e.p1, &self.p1).cmp(&0)
    }
}

/// An `EdgeEndBundle`: the edge ends of one direction at a node.
struct Bundle {
    /// The first edge end (the tree-map key and the bundle's direction).
    key: EdgeEnd,
    ends: Vec<EdgeEnd>,
    label: Label,
}

impl Bundle {
    /// `computeLabel(boundaryNodeRule)`.
    fn compute_label(&mut self) {
        let is_area = self.ends.iter().any(|e| e.label.is_area());
        self.label = if is_area {
            Label::area(NONE, NONE, NONE)
        } else {
            Label::line(NONE)
        };
        for i in 0..2 {
            self.compute_label_on(i);
            if is_area {
                self.compute_label_side(i, LEFT);
                self.compute_label_side(i, RIGHT);
            }
        }
    }

    fn compute_label_on(&mut self, geom_index: usize) {
        let mut boundary_count = 0;
        let mut found_interior = false;
        for e in &self.ends {
            let loc = e.label.get(geom_index, ON);
            if loc == BOUNDARY {
                boundary_count += 1;
            }
            if loc == INTERIOR {
                found_interior = true;
            }
        }
        let mut loc = NONE;
        if found_interior {
            loc = INTERIOR;
        }
        if boundary_count > 0 {
            loc = determine_boundary(boundary_count);
        }
        self.label.set(geom_index, ON, loc);
    }

    fn compute_label_side(&mut self, geom_index: usize, side: usize) {
        for e in &self.ends {
            if e.label.is_area() {
                let loc = e.label.get(geom_index, side);
                if loc == INTERIOR {
                    self.label.set(geom_index, side, INTERIOR);
                    return;
                } else if loc == EXTERIOR {
                    self.label.set(geom_index, side, EXTERIOR);
                }
            }
        }
    }
}

/// A `RelateNode`: its label and its star of bundles (an
/// `EdgeEndBundleStar`, in direction order).
struct RelateNode {
    label: Label,
    star: Vec<Bundle>,
}

impl RelateNode {
    fn new() -> RelateNode {
        RelateNode {
            label: Label::line(NONE),
            star: Vec::new(),
        }
    }

    /// `setLabel(argIndex, onLocation)`.
    fn set_label(&mut self, arg: usize, on: i32) {
        self.label.set(arg, ON, on);
    }

    /// `setLabelBoundary(argIndex)`.
    fn set_label_boundary(&mut self, arg: usize) {
        let new_loc = match self.label.get(arg, ON) {
            BOUNDARY => INTERIOR,
            INTERIOR => BOUNDARY,
            _ => BOUNDARY,
        };
        self.label.set(arg, ON, new_loc);
    }

    /// `EdgeEndBundleStar.insert(e)`.
    fn insert(&mut self, e: EdgeEnd) {
        match self.star.binary_search_by(|b| b.key.compare_direction(&e)) {
            Ok(i) => self.star[i].ends.push(e),
            Err(i) => self.star.insert(
                i,
                Bundle {
                    key: e,
                    ends: vec![e],
                    label: e.label,
                },
            ),
        }
    }

    /// `EdgeEndStar.computeLabelling(geomGraph)`.
    fn compute_labelling(&mut self, args: &[GeometryGraph; 2]) -> JtsResult<()> {
        for b in &mut self.star {
            b.compute_label();
        }
        self.propagate_side_labels(0)?;
        self.propagate_side_labels(1)?;
        let mut has_dimensional_collapse_edge = [false, false];
        for b in &self.star {
            for (geomi, collapse) in has_dimensional_collapse_edge.iter_mut().enumerate() {
                if b.label.elt[geomi].is_line() && b.label.get(geomi, ON) == BOUNDARY {
                    *collapse = true;
                }
            }
        }
        let mut pt_in_area_location = [NONE, NONE];
        for b in &mut self.star {
            for geomi in 0..2 {
                if b.label.elt[geomi].is_any_null() {
                    let loc = if has_dimensional_collapse_edge[geomi] {
                        EXTERIOR
                    } else {
                        // getLocation: cached per star and geometry
                        if pt_in_area_location[geomi] == NONE {
                            pt_in_area_location[geomi] = args[geomi].locate_in_area(&b.key.p0);
                        }
                        pt_in_area_location[geomi]
                    };
                    b.label.elt[geomi].set_all_if_null(loc);
                }
            }
        }
        Ok(())
    }

    /// `EdgeEndStar.propagateSideLabels(geomIndex)`.
    fn propagate_side_labels(&mut self, geom_index: usize) -> JtsResult<()> {
        let mut start_loc = NONE;
        for b in &self.star {
            let label = &b.label;
            if label.elt[geom_index].is_area() && label.get(geom_index, LEFT) != NONE {
                start_loc = label.get(geom_index, LEFT);
            }
        }
        if start_loc == NONE {
            return Ok(());
        }
        let mut curr_loc = start_loc;
        for b in &mut self.star {
            let coord = b.key.p0;
            let label = &mut b.label;
            if label.get(geom_index, ON) == NONE {
                label.set(geom_index, ON, curr_loc);
            }
            if label.elt[geom_index].is_area() {
                let left_loc = label.get(geom_index, LEFT);
                let right_loc = label.get(geom_index, RIGHT);
                if right_loc != NONE {
                    if right_loc != curr_loc {
                        return Err(JtsError::Runtime(format!(
                            "side location conflict [ {} ]",
                            fmt_coord(&coord)
                        )));
                    }
                    if left_loc == NONE {
                        return Err(JtsError::Runtime(format!(
                            "Should never reach here: found single null side (at {})",
                            fmt_coord(&coord)
                        )));
                    }
                    curr_loc = left_loc;
                } else {
                    assert_true(
                        label.get(geom_index, LEFT) == NONE,
                        "found single null side",
                    )?;
                    label.set(geom_index, RIGHT, curr_loc);
                    label.set(geom_index, LEFT, curr_loc);
                }
            }
        }
        Ok(())
    }
}

/// `EdgeEndBuilder.computeEdgeEnds(edge, list)`.
fn compute_edge_ends(edge: &mut Edge, label: &Label, out: &mut Vec<EdgeEnd>) -> JtsResult<()> {
    edge.ei_add_endpoints();
    let list = &edge.ei_list;
    let pts = &edge.pts;
    for k in 0..list.len() {
        let ei_curr = list[k];
        let ei_prev = if k > 0 { Some(list[k - 1]) } else { None };
        let ei_next = list.get(k + 1).copied();
        // createEdgeEndForPrev
        'prev: {
            let mut i_prev = ei_curr.segment_index;
            if ei_curr.dist == 0.0 {
                if i_prev == 0 {
                    break 'prev;
                }
                i_prev -= 1;
            }
            let mut p_prev = pts[i_prev];
            if let Some(ei_prev) = ei_prev {
                if ei_prev.segment_index >= i_prev {
                    p_prev = ei_prev.coord;
                }
            }
            let mut l = *label;
            l.flip();
            out.push(EdgeEnd::new(ei_curr.coord, p_prev, l)?);
        }
        // createEdgeEndForNext
        let i_next = ei_curr.segment_index + 1;
        if i_next >= pts.len() && ei_next.is_none() {
            continue;
        }
        let mut p_next = match pts.get(i_next) {
            Some(p) => *p,
            // (JavaScript reads undefined.x: a TypeError)
            None => {
                return Err(JtsError::Other(
                    "Cannot read properties of undefined (reading 'x')".into(),
                ))
            }
        };
        if let Some(ei_next) = ei_next {
            if ei_next.segment_index == ei_curr.segment_index {
                p_next = ei_next.coord;
            }
        }
        out.push(EdgeEnd::new(ei_curr.coord, p_next, *label)?);
    }
    Ok(())
}

/// `RelateComputer.computeIM()` for a polygon (argument 0) and a line
/// string (argument 1), reduced to `isIntersects()`.
fn relate_intersects(ring: &[Coord], line: &[Coord]) -> JtsResult<bool> {
    let mut edges: Vec<Edge> = Vec::new();
    let mut labels: Vec<Label> = Vec::new();
    let mut args = [
        GeometryGraph::new(0, Parent::Polygon(ring), &mut edges, &mut labels)?,
        GeometryGraph::new(1, Parent::Line(line), &mut edges, &mut labels)?,
    ];
    let mut im = Matrix([[-1; 3]; 3]);
    im.0[EXTERIOR as usize][EXTERIOR as usize] = 2;
    // (the envelopes intersect: checked by the caller)
    for arg in &mut args {
        arg.compute_self_nodes(&mut edges, &labels)?;
    }
    // computeEdgeIntersections(arg[1], li, false)
    let mut si = SegmentIntersector::recording_isolated(LineIntersector::new(None), false);
    si.set_boundary_nodes(args[0].boundary_nodes(), args[1].boundary_nodes());
    let mut members: Vec<(usize, Option<usize>)> = Vec::new();
    for (gi, arg) in args.iter().enumerate() {
        members.extend(arg.edges.iter().map(|&e| (e, Some(gi))));
    }
    sweep_intersections(&mut edges, &members, &mut si)?;

    let mut nodes: NodeMap<RelateNode> = NodeMap::new();
    // computeIntersectionNodes(0), (1)
    for (gi, arg) in args.iter().enumerate() {
        for &e in &arg.edges {
            let e_loc = labels[e].get(gi, ON);
            for ei in &edges[e].ei_list {
                let n = nodes.add_node(ei.coord, RelateNode::new);
                if e_loc == BOUNDARY {
                    n.set_label_boundary(gi);
                } else if n.label.elt[gi].is_null() {
                    n.set_label(gi, INTERIOR);
                }
            }
        }
    }
    // copyNodesAndLabels(0), (1)
    for (gi, arg) in args.iter().enumerate() {
        for (c, l) in &arg.nodes.nodes {
            nodes
                .add_node(*c, RelateNode::new)
                .set_label(gi, l.get(gi, ON));
        }
    }
    // labelIsolatedNodes
    for (c, n) in &mut nodes.nodes {
        assert_true(n.label.geometry_count() > 0, "node with empty label found")?;
        if n.label.geometry_count() == 1 {
            let target = if n.label.elt[0].is_null() { 0 } else { 1 };
            let loc = args[target].locate(c);
            n.label.elt[target].set_all(loc);
        }
    }
    // computeProperIntersectionIM (dimensions 2 and 1)
    if si.has_proper {
        im.set_at_least_pattern("FFF0FFFF2");
    }
    if si.has_proper_interior {
        im.set_at_least_pattern("1FFFFF1FF");
    }
    // the edge ends of both graphs, inserted into the node stars
    let mut ends: Vec<EdgeEnd> = Vec::new();
    for arg in &args {
        for &e in &arg.edges {
            compute_edge_ends(&mut edges[e], &labels[e], &mut ends)?;
        }
    }
    for e in ends {
        nodes.add_node(e.p0, RelateNode::new).insert(e);
    }
    // labelNodeEdges
    for (_, n) in &mut nodes.nodes {
        n.compute_labelling(&args)?;
    }
    // labelIsolatedEdges(0, 1), (1, 0)
    let mut isolated: Vec<usize> = Vec::new();
    for (this_index, target_index) in [(0, 1), (1, 0)] {
        for &e in &args[this_index].edges {
            if edges[e].is_isolated {
                // (the target has dimension > 0)
                let loc = args[target_index].locate(&edges[e].pts[0]);
                labels[e].elt[target_index].set_all(loc);
                isolated.push(e);
            }
        }
    }
    // updateIM
    for &e in &isolated {
        assert_true(labels[e].geometry_count() >= 2, "found partial label")?;
        im.update_from_label(&labels[e]);
    }
    for (_, n) in &nodes.nodes {
        assert_true(n.label.geometry_count() >= 2, "found partial label")?;
        im.set_at_least_if_valid(n.label.get(0, ON), n.label.get(1, ON), 0);
        for b in &n.star {
            im.update_from_label(&b.label);
        }
    }
    Ok(im.is_intersects())
}

/// `Polygon.isRectangle()` of a polygon of one ring.
fn is_rectangle(ring: &[Coord], env: &Envelope) -> bool {
    if ring.len() != 5 {
        return false;
    }
    for c in ring {
        if !(c.x == env.minx || c.x == env.maxx) {
            return false;
        }
        if !(c.y == env.miny || c.y == env.maxy) {
            return false;
        }
    }
    let mut prev = ring[0];
    for c in &ring[1..] {
        let x_changed = c.x != prev.x;
        let y_changed = c.y != prev.y;
        if x_changed == y_changed {
            return false;
        }
        prev = *c;
    }
    true
}

/// `RectangleIntersects.intersects(rectangle, line)` (the envelopes
/// intersect).
fn rectangle_intersects_line(rect: &Envelope, line: &[Coord], line_env: &Envelope) -> bool {
    // EnvelopeIntersectsVisitor
    if rect.contains(line_env) {
        return true;
    }
    if line_env.minx >= rect.minx && line_env.maxx <= rect.maxx {
        return true;
    }
    if line_env.miny >= rect.miny && line_env.maxy <= rect.maxy {
        return true;
    }
    // (GeometryContainsPointVisitor looks at polygons only)
    // RectangleIntersectsSegmentVisitor with a RectangleLineIntersector
    let diag_up0 = Coord::new(rect.minx, rect.miny);
    let diag_up1 = Coord::new(rect.maxx, rect.maxy);
    let diag_down0 = Coord::new(rect.minx, rect.maxy);
    let diag_down1 = Coord::new(rect.maxx, rect.miny);
    let mut li = LineIntersector::new(None);
    for j in 1..line.len() {
        let (mut p0, mut p1) = (line[j - 1], line[j]);
        if !rect.intersects(&Envelope::of_points(&p0, &p1)) {
            continue;
        }
        if rect.intersects_point(&p0) || rect.intersects_point(&p1) {
            return true;
        }
        if p0.compare(&p1) == Ordering::Greater {
            std::mem::swap(&mut p0, &mut p1);
        }
        if p1.y > p0.y {
            li.compute_intersection(&p0, &p1, &diag_down0, &diag_down1);
        } else {
            li.compute_intersection(&p0, &p1, &diag_up0, &diag_up1);
        }
        if li.has_intersection() {
            return true;
        }
    }
    false
}

/// `polygon.intersects(line)` (`RelateOp.intersects`) for a polygon of one
/// ring. Errors are those jsts throws (a side location conflict at a node
/// of a self-crossing outline, failed assertions).
pub fn polygon_intersects_line(ring: &[Coord], line: &[Coord]) -> JtsResult<bool> {
    let (Some(pe), Some(le)) = (Envelope::of_coords(ring), Envelope::of_coords(line)) else {
        return Ok(false);
    };
    if !pe.intersects(&le) {
        return Ok(false);
    }
    if is_rectangle(ring, &pe) {
        return Ok(rectangle_intersects_line(&pe, line, &le));
    }
    relate_intersects(ring, line)
}
