//! js::array::sort_by against V8's Array.prototype.sort (fixtures from
//! tools/fixtures/js-sort.fixture.ts, run under Node): the same order of the
//! indices for every array, also for inconsistent comparators (NaN keys,
//! infinities, a comparator that is no order).

mod common;

use common::{load, num};
use cslope_engine::js::array::sort_by;
use serde_json::Value;

fn comparator(name: &str) -> fn(f64, f64) -> f64 {
    match name {
        "sub" => |a, b| a - b,
        "desc" => |a, b| b - a,
        "mod10" => |a, b| (a % 10.0) - (b % 10.0),
        "hash" => |a, b| ((a * 7.0 + b * 13.0) % 5.0) - 2.0,
        "lessOnly" => |a, b| if a < b { -1.0 } else { 0.0 },
        other => panic!("unknown comparator {other}"),
    }
}

#[test]
fn sort_matches_v8_order() {
    let cases: Vec<Value> = load("js-sort", "orders");
    assert!(cases.len() > 1000);
    let mut inconsistent = 0;
    for (k, c) in cases.iter().enumerate() {
        let values: Vec<f64> = c["values"].as_array().unwrap().iter().map(num).collect();
        let expected: Vec<usize> = c["order"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as usize)
            .collect();
        let name = c["comparator"].as_str().unwrap();
        let cmp = comparator(name);
        if name == "hash" || values.iter().any(|v| !v.is_finite()) {
            inconsistent += 1;
        }
        let mut order: Vec<usize> = (0..values.len()).collect();
        sort_by(&mut order, |&i, &j| cmp(values[i], values[j]));
        assert_eq!(
            order,
            expected,
            "case {k}: comparator {name}, {} values",
            values.len()
        );
    }
    assert!(inconsistent > 500, "{inconsistent} inconsistent cases");
}
