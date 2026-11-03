//! Differential tests of the math ports against fixtures exported from the
//! TypeScript engine under Node (tools/fixtures/math.fixture.ts).
//!
//! Tolerances: polygon, interpolation, loads and the λ extrapolation are
//! arithmetic only and must match bit for bit. Functions that call
//! `Math.sin/cos/pow/exp` (the circle points, half-sine, distances through
//! `**`, the spline's `** 3`) may differ in the last bit while `js::math`
//! wraps the platform libm (ARCHITECTURE.md §5): 1e-12 relative, or for
//! values rounded to 3 decimals a difference of at most one unit there.

mod common;

use common::{close, num};
use cslope_engine::math::*;
use cslope_engine::types::IntersliceFunctionType;
use serde_json::Value;

const LIBM: f64 = 1e-12;

fn nums(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(num).collect()
}

fn pts<const N: usize>(v: &Value) -> Vec<[f64; N]> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| {
            let p = nums(p);
            std::array::from_fn(|i| p[i])
        })
        .collect()
}

/// Bit-exact equality (NaN equals NaN).
#[track_caller]
fn same(a: f64, b: f64, what: &str) {
    assert!(
        a == b || (a.is_nan() && b.is_nan()),
        "{what}: {a:e} vs {b:e}"
    );
}

#[track_caller]
fn same_all(a: &[f64], b: &[f64], what: &str) {
    assert_eq!(a.len(), b.len(), "{what}: length");
    for (x, y) in a.iter().zip(b) {
        same(*x, *y, what);
    }
}

#[track_caller]
fn near(a: f64, b: f64, what: &str) {
    assert!(close(a, b, LIBM), "{what}: {a:e} vs {b:e}");
}

#[test]
fn polygon() {
    let cases: Value = common::load("math", "polygon");
    let mut n = 0;
    for c in cases.as_array().unwrap() {
        let (x, y) = (nums(&c["x"]), nums(&c["y"]));
        same(calculate_polygon_area(&x, &y), num(&c["area"]), "area");
        for t in c["inside"].as_array().unwrap() {
            let p = nums(&t["p"]);
            assert_eq!(
                is_point_in_polygon(p[0], p[1], &x, &y),
                t["inside"].as_bool().unwrap()
            );
            n += 1;
        }
        for t in c["vertical"].as_array().unwrap() {
            let s = nums(&t["strip"]);
            let (rx, ry) = if x.len() == 2 {
                clip_polygon_vertical(&[], &[], s[0], s[1])
            } else {
                clip_polygon_vertical(&x, &y, s[0], s[1])
            };
            same_all(&rx, &nums(&t["out"][0]), "vertical x");
            same_all(&ry, &nums(&t["out"][1]), "vertical y");
            n += 1;
        }
        for t in c["halfplane"].as_array().unwrap() {
            let p = nums(&t["abc"]);
            let (rx, ry) = clip_polygon_halfplane(&x, &y, p[0], p[1], p[2]);
            same_all(&rx, &nums(&t["out"][0]), "halfplane x");
            same_all(&ry, &nums(&t["out"][1]), "halfplane y");
            n += 1;
        }
    }
    assert!(n > 5000, "{n} cases");
}

#[test]
fn circle() {
    let f: Value = common::load("math", "circle");
    for c in f["intersections"].as_array().unwrap() {
        let (x, y) = (nums(&c["x"]), nums(&c["y"]));
        for t in c["circles"].as_array().unwrap() {
            let out =
                get_circle_line_intersections(num(&t["cx"]), num(&t["cy"]), num(&t["r"]), &x, &y);
            let want = pts::<2>(&t["out"]);
            assert_eq!(out.len(), want.len());
            for (a, b) in out.iter().zip(&want) {
                same(a[0], b[0], "intersection x");
                same(a[1], b[1], "intersection y");
            }
        }
    }
    for t in f["yAt"].as_array().unwrap() {
        let a = nums(&t["args"]);
        same(
            get_circle_y_coordinate_at_x(a[0], a[1], a[2], a[3]),
            num(&t["out"]),
            "y at x",
        );
    }
    for t in f["abcd"].as_array().unwrap() {
        let a = nums(&t["args"]);
        match circle_radius_from_abcd(a[0], a[1]) {
            Some(r) => same(r, num(&t["out"]), "radius"),
            None => assert!(t["out"].is_null()),
        }
    }
    for t in f["centre"].as_array().unwrap() {
        let a = &t["args"];
        let c = circle_centre(num(&a[0]), [num(&a[1][0]), num(&a[1][1])], num(&a[2]));
        let want = nums(&t["out"]);
        near(c[0], want[0], "centre x");
        near(c[1], want[1], "centre y");
    }
    for t in f["coords"].as_array().unwrap() {
        let a = nums(&t["args"]);
        let (x, y) = generate_circle_coordinates(a[0], a[1], a[2], a[3] as usize);
        // rounded to 3 decimals: a last-bit difference of cos/sin can move
        // a value across a rounding boundary by 0.001
        for (got, want) in x
            .iter()
            .chain(&y)
            .zip(nums(&t["out"][0]).iter().chain(&nums(&t["out"][1])))
        {
            assert!(
                (got - want).abs() <= 0.0010000001,
                "circle point {got} vs {want}"
            );
        }
        assert_eq!(x.len(), nums(&t["out"][0]).len());
    }
}

#[test]
fn interpolation() {
    let f: Value = common::load("math", "interpolation");
    for c in f["lines"].as_array().unwrap() {
        let (x, y) = (nums(&c["x"]), nums(&c["y"]));
        let at = c["at"].as_array().unwrap();
        let xs: Vec<f64> = at.iter().map(|t| num(&t["x"])).collect();
        let many = get_y_at_x_many(&x, &y, &xs);
        for (i, t) in at.iter().enumerate() {
            same(many[i], num(&t["y"]), "getYAtXMany");
            same(get_y_at_x(&x, &y, xs[i]), num(&t["single"]), "getYAtX");
        }
        for t in c["strict"].as_array().unwrap() {
            let r = get_y_at_x_strict((&x, &y), num(&t["x"]));
            check_result(r.map(|v| vec![v]), &t["out"], |v| vec![num(v)]);
        }
        for t in c["between"].as_array().unwrap() {
            let r = get_line_between_points((&x, &y), num(&t["x1"]), num(&t["x2"]));
            check_result(r.map(|(a, b)| [a, b].concat()), &t["out"], |v| {
                [nums(&v[0]), nums(&v[1])].concat()
            });
        }
    }
    for c in f["spatial"].as_array().unwrap() {
        let points: Vec<SpatialDataPoint> = c["points"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| SpatialDataPoint {
                x: num(&p["x"]),
                y: num(&p["y"]),
                values: nums(&p["values"]),
            })
            .collect();
        for q in c["queries"].as_array().unwrap() {
            let [qx, qy] = [num(&q["q"][0]), num(&q["q"][1])];
            for (power, key) in [(1.0, "idw1"), (2.0, "idw2"), (3.0, "idw3")] {
                let got = interpolate_idw(&points, qx, qy, power, 1e-10);
                let want = nums(&q[key]);
                assert_eq!(got.len(), want.len());
                for (a, b) in got.iter().zip(&want) {
                    near(*a, *b, key);
                }
            }
            same_all(
                &interpolate_nearest(&points, qx, qy),
                &nums(&q["nearest"]),
                "nearest",
            );
        }
    }
}

/// `{ ok }` or `{ error, range }` of a function that can throw.
#[track_caller]
fn check_result(
    r: cslope_engine::error::Result<Vec<f64>>,
    want: &Value,
    ok: impl Fn(&Value) -> Vec<f64>,
) {
    match (r, want.get("ok")) {
        (Ok(v), Some(w)) => same_all(&v, &ok(w), "ok value"),
        (Err(e), None) => {
            assert_eq!(e.message, want["error"].as_str().unwrap());
            assert_eq!(
                e.kind == cslope_engine::error::ErrorKind::Range,
                want["range"].as_bool().unwrap()
            );
        }
        (r, _) => panic!("{r:?} vs {want}"),
    }
}

#[test]
fn loads() {
    let cases: Value = common::load("math", "loads");
    for c in cases.as_array().unwrap() {
        let (u, l) = calculate_all_loads(
            &nums(&c["widths"]),
            &nums(&c["centres"]),
            &pts::<3>(&c["udls"]),
            &pts::<2>(&c["lineLoads"]),
        );
        same_all(&u, &nums(&c["out"][0]), "udl forces");
        same_all(&l, &nums(&c["out"][1]), "line load forces");
    }
}

#[test]
fn helpers() {
    let f: Value = common::load("math", "helpers");
    for t in f["interslice"].as_array().unwrap() {
        let kind: Option<IntersliceFunctionType> =
            serde_json::from_value(t["kind"].clone()).unwrap();
        let p = pts::<2>(&t["pts"]);
        let (x, xs, xe) = (num(&t["x"]), num(&t["xs"]), num(&t["xe"]));
        near(
            get_interslice_function_value(kind, x, xs, xe, &p),
            num(&t["out"]),
            "interslice",
        );
        near(
            data_point_specified(x, xs, xe, &p),
            num(&t["dps"]),
            "data point specified",
        );
    }
    for t in f["points"].as_array().unwrap() {
        let a = [num(&t["a"][0]), num(&t["a"][1])];
        let b = [num(&t["b"][0]), num(&t["b"][1])];
        same_all(&mid_coord(a, b), &nums(&t["mid"]), "midCoord");
        near(dist_points(a, b), num(&t["dist"]), "distPoints");
    }
    for t in f["lambda"].as_array().unwrap() {
        let rows = pts::<3>(&t["rows"]);
        check_result(
            extrapolate_lambda(&rows).map(|v| v.to_vec()),
            &t["out"],
            nums,
        );
    }
    for t in f["precision"].as_array().unwrap() {
        assert_eq!(
            get_precision(num(&t["n"])) as u64,
            t["out"].as_u64().unwrap(),
            "getPrecision({})",
            t["n"]
        );
    }
}

#[test]
fn spline() {
    let cases: Value = common::load("math", "spline");
    for c in cases.as_array().unwrap() {
        let p = pts::<2>(&c["pts"]);
        let slopes = [c["slopes"][0].as_f64(), c["slopes"][1].as_f64()];
        let s = cubic_spline(&p, slopes);
        // the second derivatives: arithmetic only
        same_all(&s.m, &nums(&c["m"]), "second derivatives");
        for e in c["evals"].as_array().unwrap() {
            let v = eval_spline(&s, num(&e["t"]));
            near(v.value, num(&e["value"]), "spline value");
            same(v.slope, num(&e["slope"]), "spline slope");
        }
    }
}
