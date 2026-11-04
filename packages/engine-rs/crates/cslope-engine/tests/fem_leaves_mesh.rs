//! fem/mesh.rs: the TypeScript unit test (fem/model.test.ts, "meshDomain"),
//! ported. (The differential tests against the TypeScript engine's fixtures were removed with it at the cutover, PORTING.md.)
#![allow(clippy::needless_range_loop)]

mod common;

use cslope_engine::js::math as jsm;

use cslope_engine::fem::mesh::{mesh_domain, point_in_polygon, MeshInput};

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
