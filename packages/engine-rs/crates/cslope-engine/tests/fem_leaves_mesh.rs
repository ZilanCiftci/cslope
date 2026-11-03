//! fem/mesh.rs: differential tests against fixtures/fem-leaves/mesh-*.json
//! (every meshDomain call made while building the finite element models of
//! verification problems), and the TypeScript unit test (fem/model.test.ts,
//! "meshDomain").
#![allow(clippy::needless_range_loop)]

mod common;

use cslope_engine::js::math as jsm;

use common::{load, num};
use cslope_engine::fem::mesh::{mesh_domain, point_in_polygon, MeshInput};
use serde_json::Value;
use std::cell::Cell;
use std::collections::HashMap;

fn points(v: &Value) -> Vec<[f64; 2]> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| [num(&p[0]), num(&p[1])])
        .collect()
}

fn f64s(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(num).collect()
}

fn check_case(name: &str) {
    let calls: Vec<Value> = load("fem-leaves", &format!("mesh-{name}"));
    assert!(!calls.is_empty());
    for (ci, call) in calls.iter().enumerate() {
        let input = &call["input"];
        let (sx, sy, sv) = (
            f64s(&call["size"]["x"]),
            f64s(&call["size"]["y"]),
            f64s(&call["size"]["v"]),
        );
        let table: HashMap<(u64, u64), f64> = (0..sx.len())
            .map(|i| ((sx[i].to_bits(), sy[i].to_bits()), sv[i]))
            .collect();
        let span = {
            let b = points(&input["boundary"]);
            let (xs, ys): (Vec<f64>, Vec<f64>) = b.iter().map(|p| (p[0], p[1])).unzip();
            jsm::max(
                jsm::max_of(&xs) - jsm::min_of(&xs),
                jsm::max_of(&ys) - jsm::min_of(&ys),
            )
        };
        let calls_made = Cell::new(0usize);
        let size = |x: f64, y: f64| {
            calls_made.set(calls_made.get() + 1);
            // (exact point, else the nearest asked point within 1e-9 of the span:
            // the policy allows 1e-9 in coordinates)
            if let Some(v) = table.get(&(x.to_bits(), y.to_bits())) {
                return *v;
            }
            let near = (0..sx.len())
                .find(|&i| (sx[i] - x).abs() <= 1e-9 * span && (sy[i] - y).abs() <= 1e-9 * span);
            sv[near.unwrap_or_else(|| {
                panic!("mesh-{name} call {ci}: the size field is asked at ({x}, {y}), where TypeScript never asked: the meshes differ")
            })]
        };
        let opt = |k: &str| input.get(k).map(num);
        let mesh_input = MeshInput {
            boundary: points(&input["boundary"]),
            segments: input["segments"]
                .as_array()
                .unwrap()
                .iter()
                .map(points)
                .collect(),
            size: &size,
            min_angle: opt("minAngle"),
            min_size: opt("minSize"),
            size_min: opt("sizeMin"),
            max_vertices: input.get("maxVertices").map(|v| num(v) as usize),
        };
        let m = mesh_domain(&mesh_input).unwrap();
        let out = &call["output"];
        let (ex, ey) = (f64s(&out["x"]), f64s(&out["y"]));
        let etri: Vec<usize> = out["tri"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as usize)
            .collect();
        assert_eq!(m.x.len(), ex.len(), "mesh-{name} call {ci}: vertex count");
        for i in 0..ex.len() {
            assert!(
                (m.x[i] - ex[i]).abs() <= 1e-9 * span && (m.y[i] - ey[i]).abs() <= 1e-9 * span,
                "mesh-{name} call {ci}: vertex {i}: ({}, {}) vs ({}, {})",
                m.x[i],
                m.y[i],
                ex[i],
                ey[i]
            );
        }
        // (connectivity and node order exactly: later logic depends on them)
        assert_eq!(m.tri, etri, "mesh-{name} call {ci}: triangles");
        assert_eq!(m.count, out["count"].as_u64().unwrap() as usize);
        assert_eq!(
            m.capped,
            out["capped"].as_bool().unwrap(),
            "mesh-{name} call {ci}: capped"
        );
        assert_eq!(
            m.missing_segments,
            out["missingSegments"].as_u64().unwrap() as usize
        );
        assert_eq!(
            calls_made.get(),
            sx.len(),
            "mesh-{name} call {ci}: number of size field calls"
        );
    }
}

#[test]
fn meshes_of_unit_domains() {
    check_case("unit");
}

macro_rules! problem_meshes {
    ($($test:ident: $id:literal,)*) => {$(
        #[test]
        fn $test() {
            check_case($id);
        }
    )*};
}

problem_meshes! {
    mesh_v001: "V001",
    mesh_v012: "V012",
    mesh_v026: "V026",
    mesh_v046a: "V046a",
    mesh_v055: "V055",
    mesh_v056: "V056",
    mesh_v063: "V063",
    mesh_v067: "V067",
    mesh_v068: "V068",
    mesh_v077: "V077",
    mesh_v094: "V094",
    mesh_v099: "V099",
}

// fem/model.test.ts: "covers the domain with counter-clockwise triangles of bounded angle"
#[test]
fn covers_the_domain_with_counter_clockwise_triangles_of_bounded_angle() {
    let boundary = vec![
        [0.0, 0.0],
        [60.0, 0.0],
        [60.0, 20.0],
        [40.0, 20.0],
        [20.0, 10.0],
        [0.0, 10.0],
    ];
    let size = |_: f64, _: f64| 2.0;
    let m = mesh_domain(&MeshInput {
        boundary,
        segments: vec![
            vec![[0.0, 5.0], [60.0, 5.0]],
            vec![[20.0, 10.0], [60.0, 12.0]],
        ],
        size: &size,
        min_angle: None,
        min_size: None,
        size_min: None,
        max_vertices: None,
    })
    .unwrap();
    let mut area = 0.0;
    let mut min_angle = 180.0f64;
    for t in 0..m.count {
        let (a, b, c) = (m.tri[3 * t], m.tri[3 * t + 1], m.tri[3 * t + 2]);
        let ar =
            ((m.x[b] - m.x[a]) * (m.y[c] - m.y[a]) - (m.y[b] - m.y[a]) * (m.x[c] - m.x[a])) / 2.0;
        assert!(ar > 0.0);
        area += ar;
        let pts = [a, b, c];
        for k in 0..3 {
            let (p, q, r) = (pts[k], pts[(k + 1) % 3], pts[(k + 2) % 3]);
            let (ux, uy, vx, vy) = (
                m.x[q] - m.x[p],
                m.y[q] - m.y[p],
                m.x[r] - m.x[p],
                m.y[r] - m.y[p],
            );
            let ang =
                jsm::acos((ux * vx + uy * vy) / jsm::hypot(&[ux, uy]) / jsm::hypot(&[vx, vy]))
                    * 180.0
                    / std::f64::consts::PI;
            min_angle = jsm::min(min_angle, ang);
        }
    }
    assert!((area - 900.0).abs() < 5e-7, "area {area}");
    assert!(min_angle > 20.0, "smallest angle {min_angle}");
    assert!(!m.capped);
}

#[test]
fn point_in_polygon_even_odd() {
    let sq = [[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]];
    assert!(point_in_polygon(1.0, 1.0, &sq));
    assert!(!point_in_polygon(3.0, 1.0, &sq));
    assert!(!point_in_polygon(1.0, -0.5, &sq));
    assert!(!point_in_polygon(1.0, 1.0, &[]));
}
