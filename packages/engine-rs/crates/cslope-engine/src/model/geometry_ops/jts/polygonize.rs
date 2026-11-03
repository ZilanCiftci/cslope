//! JTS's `Polygonizer` as jsts 2.12.1 implements it: a planar graph of the
//! noded lines (nodes in coordinate order, out-edges sorted by angle),
//! dangles and cut edges deleted, maximal edge rings found and split into
//! minimal ones, invalid rings dropped (`IsValidOp`), shells and holes
//! told apart by orientation, holes assigned to the smallest containing
//! shell found through an STR tree, and the shells sorted by their
//! envelopes (as geometries: `EdgeRing.EnvelopeComparator` compares
//! `getEnvelope()` polygons, i.e. by min x, min y, max y, max x).
//!
//! The order of the faces, the start vertex and the direction of every ring
//! are those of jsts: they follow from the order of the input lines, the
//! node order and the order of the directed edges, all reproduced here.

use super::algorithm::{
    assert_true, cmp_num, is_ccw, locate_point_in_ring, orientation_index, Coord, Envelope,
    JtsError, JtsResult, Location,
};
use super::geomgraph::is_valid_ring;
use std::cmp::Ordering;
use std::collections::BTreeMap;

/// A polygon of the polygonizer: shell and holes, closed rings.
#[derive(Debug, Clone, PartialEq)]
pub struct Polygon {
    pub shell: Vec<Coord>,
    pub holes: Vec<Vec<Coord>>,
}

/// A coordinate as a tree-map key (`Coordinate.compareTo`).
#[derive(Debug, Clone, Copy)]
struct Key(Coord);

impl PartialEq for Key {
    fn eq(&self, o: &Key) -> bool {
        self.0.compare(&o.0) == Ordering::Equal
    }
}
impl Eq for Key {}
impl PartialOrd for Key {
    fn partial_cmp(&self, o: &Key) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Key {
    fn cmp(&self, o: &Key) -> Ordering {
        self.0.compare(&o.0)
    }
}

struct Node {
    pt: Coord,
    out: Vec<usize>,
    sorted: bool,
}

struct DirEdge {
    from: usize,
    to: usize,
    p0: Coord,
    p1: Coord,
    quadrant: i32,
    edge_direction: bool,
    edge: usize,
    sym: usize,
    marked: bool,
    label: i64,
    next: Option<usize>,
    ring: Option<usize>,
}

struct GEdge {
    line: Vec<Coord>,
}

struct EdgeRing {
    ring_pts: Vec<Coord>,
    /// The `LinearRing`, or `None` when jsts could not create it.
    ring: Option<Vec<Coord>>,
    is_hole: bool,
    holes: Vec<usize>,
}

impl EdgeRing {
    fn env(&self) -> Option<Envelope> {
        self.ring.as_ref().and_then(|r| Envelope::of_coords(r))
    }
}

/// `PolygonizeGraph`.
struct Graph {
    nodes: Vec<Node>,
    node_map: BTreeMap<Key, usize>,
    edges: Vec<GEdge>,
    des: Vec<DirEdge>,
}

impl Graph {
    fn new() -> Graph {
        Graph {
            nodes: Vec::new(),
            node_map: BTreeMap::new(),
            edges: Vec::new(),
            des: Vec::new(),
        }
    }

    fn get_node(&mut self, pt: Coord) -> usize {
        if let Some(&n) = self.node_map.get(&Key(pt)) {
            return n;
        }
        let n = self.nodes.len();
        self.nodes.push(Node {
            pt,
            out: Vec::new(),
            sorted: false,
        });
        self.node_map.insert(Key(pt), n);
        n
    }

    /// Nodes in `NodeMap` (coordinate) order.
    fn node_order(&self) -> Vec<usize> {
        self.node_map.values().copied().collect()
    }

    fn new_dir_edge(
        &mut self,
        from: usize,
        to: usize,
        direction_pt: Coord,
        edge_direction: bool,
    ) -> JtsResult<usize> {
        let p0 = self.nodes[from].pt;
        let p1 = direction_pt;
        let quadrant = super::algorithm::quadrant_dxdy(p1.x - p0.x, p1.y - p0.y)?;
        self.des.push(DirEdge {
            from,
            to,
            p0,
            p1,
            quadrant,
            edge_direction,
            edge: usize::MAX,
            sym: usize::MAX,
            marked: false,
            label: -1,
            next: None,
            ring: None,
        });
        Ok(self.des.len() - 1)
    }

    /// `PolygonizeGraph.addEdge(line)`.
    fn add_edge(&mut self, line: &[Coord]) -> JtsResult<()> {
        if line.is_empty() {
            return Ok(());
        }
        let line_pts = super::algorithm::remove_repeated_points(line);
        if line_pts.len() < 2 {
            return Ok(());
        }
        let start = line_pts[0];
        let end = line_pts[line_pts.len() - 1];
        let n_start = self.get_node(start);
        let n_end = self.get_node(end);
        let de0 = self.new_dir_edge(n_start, n_end, line_pts[1], true)?;
        let de1 = self.new_dir_edge(n_end, n_start, line_pts[line_pts.len() - 2], false)?;
        let e = self.edges.len();
        self.edges.push(GEdge {
            line: line.to_vec(),
        });
        // setDirectedEdges
        self.des[de0].edge = e;
        self.des[de1].edge = e;
        self.des[de0].sym = de1;
        self.des[de1].sym = de0;
        self.nodes[n_start].out.push(de0);
        self.nodes[n_start].sorted = false;
        self.nodes[n_end].out.push(de1);
        self.nodes[n_end].sorted = false;
        Ok(())
    }

    /// `DirectedEdgeStar.getEdges()`: sorted by `DirectedEdge.compareTo`
    /// (quadrant, then orientation), once.
    fn out_edges(&mut self, n: usize) -> Vec<usize> {
        if !self.nodes[n].sorted {
            let mut out = std::mem::take(&mut self.nodes[n].out);
            let des = &self.des;
            crate::js::array::sort_by(&mut out, |&a, &b| {
                let (ea, eb) = (&des[a], &des[b]);
                if ea.quadrant > eb.quadrant {
                    return 1.0;
                }
                if ea.quadrant < eb.quadrant {
                    return -1.0;
                }
                orientation_index(&eb.p0, &eb.p1, &ea.p1) as f64
            });
            self.nodes[n].out = out;
            self.nodes[n].sorted = true;
        }
        self.nodes[n].out.clone()
    }

    fn degree_non_deleted(&mut self, n: usize) -> usize {
        self.out_edges(n)
            .iter()
            .filter(|&&d| !self.des[d].marked)
            .count()
    }

    fn degree_with_label(&mut self, n: usize, label: i64) -> usize {
        self.out_edges(n)
            .iter()
            .filter(|&&d| self.des[d].label == label)
            .count()
    }

    /// `deleteDangles`: the number of dangling lines.
    fn delete_dangles(&mut self) -> usize {
        let mut stack: Vec<usize> = self
            .node_order()
            .into_iter()
            .filter(|&n| self.nodes[n].out.len() == 1)
            .collect();
        let mut dangle_lines: Vec<usize> = Vec::new();
        while let Some(node) = stack.pop() {
            let outs = self.out_edges(node);
            for &de in &outs {
                self.des[de].marked = true;
                let sym = self.des[de].sym;
                self.des[sym].marked = true;
            }
            for &de in &outs {
                self.des[de].marked = true;
                let sym = self.des[de].sym;
                self.des[sym].marked = true;
                let e = self.des[de].edge;
                if !dangle_lines.contains(&e) {
                    dangle_lines.push(e);
                }
                let to = self.des[de].to;
                if self.degree_non_deleted(to) == 1 {
                    stack.push(to);
                }
            }
        }
        dangle_lines.len()
    }

    /// `computeNextCWEdges()` over all nodes.
    fn compute_next_cw_edges(&mut self) {
        for n in self.node_order() {
            let outs = self.out_edges(n);
            let mut start_de: Option<usize> = None;
            let mut prev_de: Option<usize> = None;
            for out_de in outs {
                if self.des[out_de].marked {
                    continue;
                }
                if start_de.is_none() {
                    start_de = Some(out_de);
                }
                if let Some(p) = prev_de {
                    let sym = self.des[p].sym;
                    self.des[sym].next = Some(out_de);
                }
                prev_de = Some(out_de);
            }
            if let Some(p) = prev_de {
                let sym = self.des[p].sym;
                self.des[sym].next = start_de;
            }
        }
    }

    fn find_dir_edges_in_ring(&self, start: usize) -> JtsResult<Vec<usize>> {
        let mut de = start;
        let mut edges = Vec::new();
        loop {
            edges.push(de);
            let next = self.des[de].next;
            assert_true(next.is_some(), "found null DE in ring")?;
            de = next.expect("checked");
            assert_true(
                de == start || self.des[de].ring.is_none(),
                "found DE already in ring",
            )?;
            if de == start {
                break;
            }
            if edges.len() > self.des.len() {
                return Err(JtsError::Runtime("edge ring does not close".into()));
            }
        }
        Ok(edges)
    }

    /// `findLabeledEdgeRings`.
    fn find_labeled_edge_rings(&mut self) -> JtsResult<Vec<usize>> {
        let mut starts = Vec::new();
        let mut curr_label = 1i64;
        for de in 0..self.des.len() {
            if self.des[de].marked {
                continue;
            }
            if self.des[de].label >= 0 {
                continue;
            }
            starts.push(de);
            for e in self.find_dir_edges_in_ring(de)? {
                self.des[e].label = curr_label;
            }
            curr_label += 1;
        }
        Ok(starts)
    }

    /// `deleteCutEdges`.
    fn delete_cut_edges(&mut self) -> JtsResult<()> {
        self.compute_next_cw_edges();
        self.find_labeled_edge_rings()?;
        for de in 0..self.des.len() {
            if self.des[de].marked {
                continue;
            }
            let sym = self.des[de].sym;
            if self.des[de].label == self.des[sym].label {
                self.des[de].marked = true;
                self.des[sym].marked = true;
            }
        }
        Ok(())
    }

    fn find_intersection_nodes(&mut self, start: usize, label: i64) -> JtsResult<Vec<usize>> {
        let mut de = start;
        let mut int_nodes = Vec::new();
        let mut steps = 0usize;
        loop {
            let node = self.des[de].from;
            if self.degree_with_label(node, label) > 1 {
                int_nodes.push(node);
            }
            let next = self.des[de].next;
            assert_true(next.is_some(), "found null DE in ring")?;
            de = next.expect("checked");
            assert_true(
                de == start || self.des[de].ring.is_none(),
                "found DE already in ring",
            )?;
            if de == start {
                break;
            }
            steps += 1;
            if steps > self.des.len() {
                return Err(JtsError::Runtime("edge ring does not close".into()));
            }
        }
        Ok(int_nodes)
    }

    fn compute_next_ccw_edges(&mut self, node: usize, label: i64) -> JtsResult<()> {
        let edges = self.out_edges(node);
        let mut first_out_de: Option<usize> = None;
        let mut prev_in_de: Option<usize> = None;
        for &de in edges.iter().rev() {
            let sym = self.des[de].sym;
            let out_de = if self.des[de].label == label {
                Some(de)
            } else {
                None
            };
            let in_de = if self.des[sym].label == label {
                Some(sym)
            } else {
                None
            };
            if out_de.is_none() && in_de.is_none() {
                continue;
            }
            if in_de.is_some() {
                prev_in_de = in_de;
            }
            if let Some(o) = out_de {
                if let Some(p) = prev_in_de {
                    self.des[p].next = Some(o);
                    prev_in_de = None;
                }
                if first_out_de.is_none() {
                    first_out_de = Some(o);
                }
            }
        }
        if let Some(p) = prev_in_de {
            assert_true(first_out_de.is_some(), "Assertion failed")?;
            self.des[p].next = first_out_de;
        }
        Ok(())
    }

    /// `getEdgeRings`.
    fn get_edge_rings(&mut self) -> JtsResult<Vec<EdgeRing>> {
        self.compute_next_cw_edges();
        for de in self.des.iter_mut() {
            de.label = -1;
        }
        let maximal = self.find_labeled_edge_rings()?;
        // convertMaximalToMinimalEdgeRings
        for de in maximal {
            let label = self.des[de].label;
            let int_nodes = self.find_intersection_nodes(de, label)?;
            for node in int_nodes {
                self.compute_next_ccw_edges(node, label)?;
            }
        }
        let mut rings: Vec<EdgeRing> = Vec::new();
        for de in 0..self.des.len() {
            if self.des[de].marked {
                continue;
            }
            if self.des[de].ring.is_some() {
                continue;
            }
            // findEdgeRing → EdgeRing.build(startDE)
            let id = rings.len();
            let mut de_list = Vec::new();
            let mut d = de;
            loop {
                de_list.push(d);
                self.des[d].ring = Some(id);
                let next = self.des[d].next;
                assert_true(next.is_some(), "found null DE in ring")?;
                d = next.expect("checked");
                assert_true(
                    d == de || self.des[d].ring.is_none(),
                    "found DE already in ring",
                )?;
                if d == de {
                    break;
                }
            }
            // getCoordinates: the edges' lines, without consecutive repeats
            let mut ring_pts: Vec<Coord> = Vec::new();
            for &d in &de_list {
                let line = &self.edges[self.des[d].edge].line;
                let mut push = |c: &Coord| {
                    if ring_pts.last() != Some(c) {
                        ring_pts.push(*c);
                    }
                };
                if self.des[d].edge_direction {
                    line.iter().for_each(&mut push);
                } else {
                    line.iter().rev().for_each(&mut push);
                }
            }
            // getRing: createLinearRing throws (caught) unless closed with
            // at least 4 points.
            let ring = if ring_pts.len() >= 4 && ring_pts[0] == ring_pts[ring_pts.len() - 1] {
                Some(ring_pts.clone())
            } else {
                None
            };
            rings.push(EdgeRing {
                ring_pts,
                ring,
                is_hole: false,
                holes: Vec::new(),
            });
        }
        Ok(rings)
    }
}

// ── STRtree (the order in which a query returns the shells) ───────

enum StrNode {
    Item(Envelope, usize),
    Node(Envelope, Vec<StrNode>),
}

impl StrNode {
    fn bounds(&self) -> Envelope {
        match self {
            StrNode::Item(e, _) | StrNode::Node(e, _) => *e,
        }
    }
}

const NODE_CAPACITY: usize = 10;

fn compare_doubles(a: f64, b: f64) -> f64 {
    if a > b {
        1.0
    } else if a < b {
        -1.0
    } else {
        0.0
    }
}

fn centre_x(e: &Envelope) -> f64 {
    (e.minx + e.maxx) / 2.0
}

fn centre_y(e: &Envelope) -> f64 {
    (e.miny + e.maxy) / 2.0
}

fn make_node(children: Vec<StrNode>) -> StrNode {
    let mut env = children[0].bounds();
    for c in &children[1..] {
        env.expand_to_include_env(&c.bounds());
    }
    StrNode::Node(env, children)
}

/// `AbstractSTRtree.createParentBoundables` (sorted by centre y).
fn parents_of_slice(mut children: Vec<StrNode>) -> Vec<StrNode> {
    crate::js::array::sort_by(&mut children, |a, b| {
        compare_doubles(centre_y(&a.bounds()), centre_y(&b.bounds()))
    });
    let mut parents: Vec<Vec<StrNode>> = vec![Vec::new()];
    for c in children {
        if parents.last().expect("non-empty").len() == NODE_CAPACITY {
            parents.push(Vec::new());
        }
        parents.last_mut().expect("non-empty").push(c);
    }
    parents.into_iter().map(make_node).collect()
}

/// `STRtree.createParentBoundables`: vertical slices by centre x.
fn create_parent_boundables(mut children: Vec<StrNode>) -> JtsResult<Vec<StrNode>> {
    let n = children.len();
    let min_leaf_count = n.div_ceil(NODE_CAPACITY);
    crate::js::array::sort_by(&mut children, |a, b| {
        compare_doubles(centre_x(&a.bounds()), centre_x(&b.bounds()))
    });
    let slice_count = (min_leaf_count as f64).sqrt().ceil() as usize;
    let slice_capacity = n.div_ceil(slice_count);
    let mut parents = Vec::new();
    let mut it = children.into_iter().peekable();
    for _ in 0..slice_count {
        let mut slice = Vec::new();
        while it.peek().is_some() && slice.len() < slice_capacity {
            slice.push(it.next().expect("peeked"));
        }
        // AbstractSTRtree.createParentBoundables asserts a non-empty slice
        assert_true(!slice.is_empty(), "Assertion failed")?;
        parents.extend(parents_of_slice(slice));
    }
    Ok(parents)
}

fn build_str_tree(items: Vec<(Envelope, usize)>) -> JtsResult<Option<StrNode>> {
    if items.is_empty() {
        return Ok(None);
    }
    let mut level: Vec<StrNode> = items
        .into_iter()
        .map(|(e, i)| StrNode::Item(e, i))
        .collect();
    loop {
        let parents = create_parent_boundables(level)?;
        if parents.len() == 1 {
            return Ok(parents.into_iter().next());
        }
        level = parents;
    }
}

fn str_query(node: &StrNode, search: &Envelope, out: &mut Vec<usize>) {
    if let StrNode::Node(_, children) = node {
        for c in children {
            if !c.bounds().intersects(search) {
                continue;
            }
            match c {
                StrNode::Item(_, i) => out.push(*i),
                StrNode::Node(..) => str_query(c, search, out),
            }
        }
    }
}

/// The key of `EdgeRing.EnvelopeComparator`: `getEnvelope()` as a
/// geometry compared with `Geometry.compareTo` (type code, then the
/// coordinates in order).
fn envelope_geometry(e: &Option<Envelope>) -> (i32, Vec<Coord>) {
    match e {
        None => (0, Vec::new()),
        Some(e) => {
            if e.minx == e.maxx && e.miny == e.maxy {
                (0, vec![Coord::new(e.minx, e.miny)])
            } else if e.minx == e.maxx || e.miny == e.maxy {
                (
                    2,
                    vec![Coord::new(e.minx, e.miny), Coord::new(e.maxx, e.maxy)],
                )
            } else {
                (
                    5,
                    vec![
                        Coord::new(e.minx, e.miny),
                        Coord::new(e.minx, e.maxy),
                        Coord::new(e.maxx, e.maxy),
                        Coord::new(e.maxx, e.miny),
                        Coord::new(e.minx, e.miny),
                    ],
                )
            }
        }
    }
}

fn compare_envelope_geometries(a: &(i32, Vec<Coord>), b: &(i32, Vec<Coord>)) -> f64 {
    if a.0 != b.0 {
        return (a.0 - b.0) as f64;
    }
    match (a.1.is_empty(), b.1.is_empty()) {
        (true, true) => return 0.0,
        (true, false) => return -1.0,
        (false, true) => return 1.0,
        _ => {}
    }
    for (p, q) in a.1.iter().zip(b.1.iter()) {
        let c = p.compare(q);
        if c != Ordering::Equal {
            return cmp_num(c);
        }
    }
    cmp_num(a.1.len().cmp(&b.1.len()))
}

/// `new Polygonizer(); add(lines); getPolygons()` and the number of
/// dangles (`getDangles().size()`).
pub fn polygonize(lines: &[Vec<Coord>]) -> JtsResult<(Vec<Polygon>, usize)> {
    let mut g = Graph::new();
    for l in lines {
        g.add_edge(l)?;
    }
    let dangles = g.delete_dangles();
    g.delete_cut_edges()?;
    let mut rings = g.get_edge_rings()?;
    // findValidRings
    let mut valid: Vec<usize> = Vec::new();
    for (i, er) in rings.iter().enumerate() {
        if er.ring_pts.len() <= 3 {
            continue;
        }
        match &er.ring {
            None => return Err(JtsError::Other("Cannot read properties of null".into())),
            Some(r) => {
                if is_valid_ring(r)? {
                    valid.push(i);
                }
            }
        }
    }
    // findShellsAndHoles
    let mut holes: Vec<usize> = Vec::new();
    let mut shells: Vec<usize> = Vec::new();
    for &i in &valid {
        let ccw = is_ccw(rings[i].ring.as_ref().expect("valid ring"))?;
        rings[i].is_hole = ccw;
        if ccw {
            holes.push(i);
        } else {
            shells.push(i);
        }
    }
    // HoleAssigner.assignHolesToShells
    let tree = build_str_tree(
        shells
            .iter()
            .filter_map(|&s| rings[s].env().map(|e| (e, s)))
            .collect(),
    )?;
    for &h in &holes {
        let test_env = rings[h].env().expect("valid ring");
        let mut candidates = Vec::new();
        if let Some(root) = &tree {
            if root.bounds().intersects(&test_env) {
                str_query(root, &test_env, &mut candidates);
            }
        }
        if let Some(shell) = find_edge_ring_containing(&rings, h, &candidates)? {
            rings[shell].holes.push(h);
        }
    }
    // Collections.sort(shellList, EnvelopeComparator)
    let keys: Vec<(i32, Vec<Coord>)> = rings.iter().map(|r| envelope_geometry(&r.env())).collect();
    crate::js::array::sort_by(&mut shells, |&a, &b| {
        compare_envelope_geometries(&keys[a], &keys[b])
    });
    let polys = shells
        .iter()
        .map(|&s| Polygon {
            shell: rings[s].ring.clone().expect("valid ring"),
            holes: rings[s]
                .holes
                .iter()
                .map(|&h| rings[h].ring.clone().expect("valid ring"))
                .collect(),
        })
        .collect();
    Ok((polys, dangles))
}

/// `EdgeRing.findEdgeRingContaining(testEr, candidates)`.
fn find_edge_ring_containing(
    rings: &[EdgeRing],
    test: usize,
    candidates: &[usize],
) -> JtsResult<Option<usize>> {
    let test_ring = rings[test].ring.as_ref().expect("valid ring");
    let test_env = rings[test].env().expect("valid ring");
    let mut min_ring: Option<usize> = None;
    let mut min_ring_env: Option<Envelope> = None;
    for &c in candidates {
        let try_env = rings[c].env().expect("valid ring");
        if try_env == test_env {
            continue;
        }
        if !try_env.contains(&test_env) {
            continue;
        }
        // CoordinateArrays.ptNotInList(testRing, tryRing)
        let test_pt = test_ring
            .iter()
            .find(|p| !rings[c].ring_pts.iter().any(|q| q == *p));
        let test_pt = match test_pt {
            Some(p) => *p,
            None => {
                return Err(JtsError::Other(
                    "Cannot read properties of null (reading 'y')".into(),
                ))
            }
        };
        let is_contained = locate_point_in_ring(&test_pt, &rings[c].ring_pts) != Location::Exterior;
        if is_contained
            && (min_ring.is_none() || min_ring_env.expect("set with min_ring").contains(&try_env))
        {
            min_ring = Some(c);
            min_ring_env = Some(try_env);
        }
    }
    Ok(min_ring)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(x: f64, y: f64) -> Coord {
        Coord::new(x, y)
    }

    #[test]
    fn a_square_cut_in_two() {
        let lines = vec![
            vec![c(0., 0.), c(1., 0.)],
            vec![c(1., 0.), c(2., 0.), c(2., 1.), c(1., 1.)],
            vec![c(1., 1.), c(0., 1.), c(0., 0.)],
            vec![c(1., 0.), c(1., 1.)],
        ];
        let (polys, dangles) = polygonize(&lines).unwrap();
        assert_eq!(dangles, 0);
        assert_eq!(polys.len(), 2);
        assert!(polys[0].holes.is_empty());
    }

    #[test]
    fn a_dangle_is_counted() {
        let lines = vec![
            vec![c(0., 0.), c(1., 0.), c(1., 1.), c(0., 0.)],
            vec![c(1., 1.), c(2., 2.)],
        ];
        let (polys, dangles) = polygonize(&lines).unwrap();
        assert_eq!(dangles, 1);
        assert_eq!(polys.len(), 1);
    }
}
