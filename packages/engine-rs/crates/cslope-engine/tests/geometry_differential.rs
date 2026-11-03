//! Differential tests of model/geometry_ops against the TypeScript engine
//! (jsts): fixtures from tools/fixtures/geometry.fixture.ts (verification
//! problems, unit-test inputs, randomized stress cases) and
//! the importer fuzz corpus (tools/fixtures/geometry-corpus.fixture.ts).
//!
//! Every number is compared bit for bit (NaN equal to NaN, -0 equal to +0
//! as JSON cannot tell them apart): faces in the same order, rings with the
//! same start vertex and direction, the same holes.

mod common;

use common::{load, num};
use cslope_engine::model::geometry_ops::*;
use serde_json::Value;

fn nums(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(num).collect()
}

fn pts(v: &Value) -> Vec<Pt> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| [num(&p[0]), num(&p[1])])
        .collect()
}

fn same(a: f64, b: f64) -> bool {
    (a.is_nan() && b.is_nan()) || a == b
}

fn same_vec(a: &[f64], b: &[f64]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same(*x, *y))
}

fn same_pts(a: &[Pt], b: &[Pt]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(p, q)| same(p[0], q[0]) && same(p[1], q[1]))
}

fn opt_num(v: &Value) -> Option<f64> {
    if v.is_null() {
        None
    } else {
        Some(num(v))
    }
}

#[test]
fn segment_intersection() {
    let cases: Vec<Value> = load("geometry", "segment_intersection");
    for (i, c) in cases.iter().enumerate() {
        let a = nums(&c["input"]);
        let got = line_segment_intersection(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]);
        let want = if c["output"].is_null() {
            None
        } else {
            Some([num(&c["output"][0]), num(&c["output"][1])])
        };
        assert!(
            match (got, want) {
                (None, None) => true,
                (Some(g), Some(w)) => same(g[0], w[0]) && same(g[1], w[1]),
                _ => false,
            },
            "case {i}: {got:?} vs {want:?}"
        );
    }
    assert!(cases.len() > 600);
}

#[test]
fn polyline_y() {
    let cases: Vec<Value> = load("geometry", "polyline_y");
    for (i, c) in cases.iter().enumerate() {
        let (x, y, at) = (nums(&c["x"]), nums(&c["y"]), num(&c["at"]));
        let at_x = polyline_y_at_x(&x, &y, at);
        assert!(
            match (at_x, opt_num(&c["atX"])) {
                (None, None) => true,
                (Some(a), Some(b)) => same(a, b),
                _ => false,
            },
            "case {i} atX"
        );
        assert!(
            same(polyline_y_at_side(&x, &y, at, Side::Left), num(&c["left"])),
            "case {i} left"
        );
        assert!(
            same(
                polyline_y_at_side(&x, &y, at, Side::Right),
                num(&c["right"])
            ),
            "case {i} right"
        );
        assert!(
            same(polyline_y_from(&x, &y, at, Side::Left), num(&c["fromLeft"])),
            "case {i} fromLeft"
        );
        assert!(
            same(
                polyline_y_from(&x, &y, at, Side::Right),
                num(&c["fromRight"])
            ),
            "case {i} fromRight"
        );
    }
}

#[test]
fn surface_line() {
    let cases: Vec<Value> = load("geometry", "surface_line");
    for (i, c) in cases.iter().enumerate() {
        let got = get_surface_line(&nums(&c["px"]), &nums(&c["py"]));
        match (&got, c.get("error")) {
            (Err(e), Some(msg)) => assert_eq!(e.message, msg.as_str().unwrap(), "case {i}"),
            (Ok(s), None) => {
                assert!(same_vec(&s.x, &nums(&c["output"]["x"])), "case {i} x");
                assert!(same_vec(&s.y, &nums(&c["output"]["y"])), "case {i} y");
            }
            _ => panic!("case {i}: {got:?} vs {c}"),
        }
    }
}

#[test]
fn clip_line() {
    let cases: Vec<Value> = load("geometry", "clip_line");
    for (i, c) in cases.iter().enumerate() {
        let got = clip_line_to_surface(
            &nums(&c["wx"]),
            &nums(&c["wy"]),
            &nums(&c["sx"]),
            &nums(&c["sy"]),
        );
        match (&got, c["output"].is_null()) {
            (None, true) => {}
            (Some(l), false) => {
                assert!(
                    same_vec(&l.x, &nums(&c["output"]["x"])),
                    "case {i} x: {:?} vs {}",
                    l.x,
                    c["output"]["x"]
                );
                assert!(same_vec(&l.y, &nums(&c["output"]["y"])), "case {i} y");
            }
            _ => panic!("case {i}: {got:?} vs {}", c["output"]),
        }
    }
}

#[test]
fn split_polygon() {
    let cases: Vec<Value> = load("geometry", "split_polygon");
    let mut mismatches = Vec::new();
    for c in &cases {
        let name = c["name"].as_str().unwrap();
        let got = split_polygon_by_polyline_detailed(
            &nums(&c["px"]),
            &nums(&c["py"]),
            &nums(&c["lx"]),
            &nums(&c["ly"]),
        );
        let ok = match (&got, c.get("error")) {
            (Err(e), Some(msg)) => e.message == msg.as_str().unwrap(),
            (Ok(r), None) => {
                let out = &c["output"];
                let pieces = out["pieces"].as_array().unwrap();
                r.split_failed == out["splitFailed"].as_bool().unwrap()
                    && r.pieces.len() == pieces.len()
                    && r.pieces.iter().zip(pieces).all(|(p, w)| {
                        same_vec(&p.px, &nums(&w["px"])) && same_vec(&p.py, &nums(&w["py"]))
                    })
            }
            _ => false,
        };
        if !ok {
            mismatches.push(name.to_string());
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} of {} differ: {mismatches:?}",
        mismatches.len(),
        cases.len()
    );
}

#[test]
fn keyhole() {
    let cases: Vec<Value> = load("geometry", "keyhole");
    for (i, c) in cases.iter().enumerate() {
        let holes: Vec<Vec<Pt>> = c["holes"].as_array().unwrap().iter().map(pts).collect();
        let got = keyhole_ring(&pts(&c["outer"]), &holes);
        assert!(same_pts(&got, &pts(&c["output"])), "case {i}");
    }
}

fn check_polygonize(cases: &[Value]) -> Vec<String> {
    let mut mismatches = Vec::new();
    for c in cases {
        let name = c["name"].as_str().unwrap_or("?").to_string();
        let lines: Vec<Vec<Pt>> = c["lines"].as_array().unwrap().iter().map(pts).collect();
        let got = polygonize_regions_detailed(&nums(&c["px"]), &nums(&c["py"]), &lines).unwrap();
        let out = &c["output"];
        let faces = out["faces"].as_array().unwrap();
        let dangling: Vec<usize> = out["danglingBoundaries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as usize)
            .collect();
        let ok = got.failed == out["failed"].as_bool().unwrap()
            && got.dangling_boundaries == dangling
            && got.faces.len() == faces.len()
            && got.faces.iter().zip(faces).all(|(f, w)| {
                let holes = w["holes"].as_array().unwrap();
                same_pts(&f.outer, &pts(&w["outer"]))
                    && f.holes.len() == holes.len()
                    && f.holes
                        .iter()
                        .zip(holes)
                        .all(|(h, wh)| same_pts(h, &pts(wh)))
            });
        if !ok {
            mismatches.push(name);
        }
    }
    mismatches
}

#[test]
fn polygonize() {
    let cases: Vec<Value> = load("geometry", "polygonize");
    let mismatches = check_polygonize(&cases);
    assert!(
        mismatches.is_empty(),
        "{} of {} differ: {mismatches:?}",
        mismatches.len(),
        cases.len()
    );
}

#[test]
fn polygonize_import_corpus() {
    // Exported by tools/fixtures/geometry-corpus.fixture.ts, which runs the
    // importer fuzz tests of the app.
    let cases: Vec<Value> = load("geometry", "import_corpus");
    assert!(cases.len() > 20);
    let mismatches = check_polygonize(&cases);
    assert!(
        mismatches.is_empty(),
        "{} of {} differ: {mismatches:?}",
        mismatches.len(),
        cases.len()
    );
}

#[test]
fn geometry_with_material() {
    let cases: Vec<Value> = load("geometry", "geometry_with_material");
    for (i, c) in cases.iter().enumerate() {
        let g = create_geometry_with_material(
            &nums(&c["px"]),
            &nums(&c["py"]),
            MaterialId(0),
            c["calculateBounds"].as_bool().unwrap(),
        );
        let o = &c["output"];
        assert!(
            same_vec(&g.px, &nums(&o["px"])) && same_vec(&g.py, &nums(&o["py"])),
            "case {i}"
        );
        assert_eq!(g.x_min, o.get("xMin").map(num), "case {i}");
        assert_eq!(g.x_max, o.get("xMax").map(num), "case {i}");
        assert_eq!(g.y_max, o.get("yMax").map(num), "case {i}");
    }
}

#[test]
fn layer_top() {
    let cases: Vec<Value> = load("geometry", "layer_top");
    let mut n = 0;
    for c in &cases {
        let geos: Vec<GeometryWithMaterial> = c["geometries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| GeometryWithMaterial {
                px: nums(&g["px"]),
                py: nums(&g["py"]),
                material: MaterialId(g["material"].as_u64().unwrap() as u32),
                x_min: g.get("xMin").map(num),
                x_max: g.get("xMax").map(num),
                y_max: g.get("yMax").map(num),
            })
            .collect();
        for q in c["queries"].as_array().unwrap() {
            let m = MaterialId(q["material"].as_u64().unwrap() as u32);
            let got = material_layer_top_at(&geos, m, num(&q["x"]), num(&q["y"]));
            let want = opt_num(&q["output"]);
            assert!(
                match (got, want) {
                    (None, None) => true,
                    (Some(a), Some(b)) => same(a, b),
                    _ => false,
                },
                "{}: {q} gave {got:?}",
                c["name"]
            );
            n += 1;
        }
    }
    assert!(n > 1000);
}

// ── The jsts primitives directly ──────────────────────────────────

use cslope_engine::model::geometry_ops::jts::{
    algorithm::Coord, noding, overlay, polygonize as pz,
};

fn lines_of(v: &Value) -> Vec<Vec<Coord>> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|l| pts(l).iter().map(|p| Coord::new(p[0], p[1])).collect())
        .collect()
}

fn same_lines(a: &[Vec<Coord>], b: &[Vec<Coord>]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(x, y)| {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|(p, q)| same(p.x, q.x) && same(p.y, q.y))
        })
}

/// Compares a Result with a fixture `{output}` / `{error}` (errors by kind
/// only: jsts and the port word some messages differently).
fn check<T, E: std::fmt::Debug>(
    what: &str,
    got: &Result<T, E>,
    want: &Value,
    eq: impl Fn(&T, &Value) -> bool,
) -> Option<String> {
    match (got, want.get("output")) {
        (Ok(g), Some(w)) if eq(g, w) => None,
        (Err(_), None) if want.get("error").is_some() => None,
        (g, _) => Some(format!("{what}: {:?} vs {want}", g.as_ref().err())),
    }
}

#[test]
fn jts_primitives() {
    let cases: Vec<Value> = load("geometry", "jts_primitives");
    let mut mismatches = Vec::new();
    let mut tested = 0;
    for c in &cases {
        if c.get("union").is_none() {
            continue;
        }
        tested += 1;
        let name = c["name"].as_str().unwrap();
        let lines = lines_of(&c["lines"]);
        let u = overlay::unary_union_lines(&lines);
        mismatches.extend(
            check("union", &u, &c["union"], |g, w| same_lines(g, &lines_of(w)))
                .map(|m| format!("{name} {m}")),
        );
        let n = noding::snap_round_node(&lines_of(&c["local"]), num(&c["scale"]));
        mismatches.extend(
            check("noded", &n, &c["noded"], |g, w| same_lines(g, &lines_of(w)))
                .map(|m| format!("{name} {m}")),
        );
        if let (Ok(n), Some(w)) = (&n, c.get("nodedUnion")) {
            let nu = overlay::unary_union_lines(n);
            mismatches.extend(
                check("nodedUnion", &nu, w, |g, w| same_lines(g, &lines_of(w)))
                    .map(|m| format!("{name} {m}")),
            );
        }
        if let (Ok(u), Some(w)) = (&u, c.get("polygonize")) {
            let p = pz::polygonize(u);
            mismatches.extend(
                check("polygonize", &p, w, |(polys, dangles), w| {
                    let wp = w["polygons"].as_array().unwrap();
                    (*dangles > 0) == (w["dangles"].as_u64().unwrap() > 0)
                        && polys.len() == wp.len()
                        && polys.iter().zip(wp).all(|(p, q)| {
                            same_lines(
                                std::slice::from_ref(&p.shell),
                                &lines_of(&Value::Array(vec![q["shell"].clone()])),
                            ) && same_lines(&p.holes, &lines_of(&q["holes"]))
                        })
                })
                .map(|m| format!("{name} {m}")),
            );
        }
    }
    assert!(tested > 250);
    assert!(
        mismatches.is_empty(),
        "{} differ:\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
}
