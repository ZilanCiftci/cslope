//! The analyses PORTING.md deferred to the solver phase from
//! layer-top-depth.test.ts (S = f(depth) from the top of the layer, the
//! cutoff; its pile case is the model core's) and staged-water.test.ts
//! (staged strength and pore pressure; its waternet cases are waternet.rs').
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::reinforcement::{
    effective_vertical_stress, effective_vertical_stress_with_loads,
};
use cslope_engine::model::slope::Slope;
use cslope_engine::types::{MaterialModel, Slice};
use model_core_support::{close, def, layered, mc, model};
use serde_json::{json, Value};
use solvers_support::run_verification;

fn with(m: Value, extra: Value) -> Value {
    let mut m = m;
    for (k, v) in extra.as_object().unwrap() {
        m[k] = v.clone();
    }
    m
}

// ── layer-top-depth.test.ts ───────────────────────────────────────

// A fill (φ 32°) on soft clay whose top is at y = 0: 1 m of fill at the
// toe, 7 m at the crest (6 m embankment). Su = 10 + 1.5·z below the clay top.
const GROUND: [[f64; 2]; 4] = [[0.0, 1.0], [20.0, 1.0], [32.0, 7.0], [60.0, 7.0]];

fn sf_depth(extra: Value) -> Value {
    with(
        json!({ "kind": "s-f-depth", "unitWeight": 16, "suRef": 10, "depthRef": 0, "rate": 1.5 }),
        extra,
    )
}

fn sf_datum(extra: Value) -> Value {
    with(
        json!({ "kind": "s-f-datum", "unitWeight": 16, "suRef": 10, "yRef": 0, "rate": 1.5 }),
        extra,
    )
}

fn embankment(clay: Value) -> Value {
    layered(
        &GROUND,
        -15.0,
        &[
            ("Fill", None, mc(0.0, 32.0, 19.0)),
            ("Clay", Some(0.0), clay),
        ],
        json!({}),
    )
}

/// The tolerance the pinned value below was computed with.
fn fos(d: Value) -> f64 {
    run_verification(
        d,
        "Bishop",
        json!({ "slices": 30, "iterations": 400, "refinedIterations": 200, "tolerance": 0.005 }),
    )
    .0
    .unwrap()
}

/// Mirror a definition about x = 30 (a right-to-left model).
fn mirrored(d: Value) -> Value {
    let m = |p: &Value| json!([60.0 - p[0].as_f64().unwrap(), p[1]]);
    let mut out = d.clone();
    out["coordinates"] = Value::Array(d["coordinates"].as_array().unwrap().iter().map(m).collect());
    out["materialBoundaries"] = Value::Array(
        d["materialBoundaries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| {
                let mut b = b.clone();
                b["coordinates"] =
                    Value::Array(b["coordinates"].as_array().unwrap().iter().map(m).collect());
                b
            })
            .collect(),
    );
    out["regionAssignments"] = Value::Array(
        d["regionAssignments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                let mut r = r.clone();
                r["point"] = m(&r["point"]);
                r
            })
            .collect(),
    );
    out
}

#[test]
fn layer_top_depth_equals_s_f_datum_at_the_clay_top_and_is_lower_than_from_the_ground() {
    let layer_top = fos(embankment(sf_depth(
        json!({ "depthReference": "layer-top" }),
    )));
    let datum = fos(embankment(sf_datum(json!({}))));
    let from_ground = fos(embankment(sf_depth(json!({}))));
    assert!(layer_top.is_finite());
    close(layer_top, datum, 6);
    // From the ground, the 1–7 m of fill count as depth in the clay.
    assert!(from_ground > layer_top * 1.1);
    // the ground reference unchanged (and the default)
    assert_eq!(
        fos(embankment(sf_depth(json!({ "depthReference": "ground" })))),
        from_ground
    );
    // Value before the layer-top option was added (TypeScript's pinned value
    // 1.0896195608), with the chord base of a circle since 2026-11-10
    // (1.0874542963), without the cut steep ends since 2026-11-11.
    close(from_ground, 1.0884182069, 8);
}

#[test]
fn layer_top_depth_works_on_a_right_to_left_model() {
    let layer_top = fos(embankment(sf_depth(
        json!({ "depthReference": "layer-top" }),
    )));
    let rtl = fos(mirrored(embankment(sf_depth(
        json!({ "depthReference": "layer-top" }),
    ))));
    close(rtl, layer_top, 6);
}

#[test]
fn the_cutoff_limits_su_like_s_f_datum_with_the_same_cutoff() {
    let layer_top = fos(embankment(sf_depth(
        json!({ "depthReference": "layer-top" }),
    )));
    let capped = fos(embankment(sf_depth(
        json!({ "depthReference": "layer-top", "suMax": 14 }),
    )));
    close(capped, fos(embankment(sf_datum(json!({ "suMax": 14 })))), 6);
    assert!(capped < layer_top);
    // A cutoff above any strength reached changes nothing.
    assert_eq!(
        fos(embankment(sf_depth(
            json!({ "depthReference": "layer-top", "suMax": 1000 })
        ))),
        layer_top
    );
}

// ── staged-water.test.ts: staged strength and pore pressure ───────

const STAGED_GROUND: [[f64; 2]; 4] = [[0.0, 10.0], [10.0, 10.0], [25.0, 0.0], [45.0, 0.0]];

fn water() -> Value {
    json!({ "waterTable": { "mode": "custom", "value": [[0, 4], [45, 4]] } })
}

fn staged_run(layers: &[(&str, Option<f64>, Value)], extra: Value) -> (Option<f64>, Slope) {
    let mut d = layered(&STAGED_GROUND, -10.0, layers, extra);
    d["customSearchPlanes"] = json!([{ "cx": 20, "cy": 20, "radius": 21 }]);
    d["customPlanesOnly"] = json!(true);
    run_verification(d, "Morgenstern-Price", json!({ "slices": 30 }))
}

fn slices(s: &Slope) -> Vec<Slice> {
    s.search()[0].slices.clone().unwrap()
}

fn normalized(m: &Value) -> Value {
    serde_json::to_value(model(m.clone())).unwrap()
}

#[test]
fn a_materials_strength_above_its_water_line_applies_above_it_and_everywhere_without_water() {
    let below = mc(5.0, 30.0, 19.0);
    let above = mc(20.0, 35.0, 19.0);
    let split_model = with(below, json!({ "aboveWater": above }));
    let (_, s) = staged_run(&[("S", None, split_model.clone())], water());
    for q in slices(&s) {
        let m: &MaterialModel = match &q.strength_model {
            Some(m) => m,
            None => &s.material(q.base_material.unwrap()).model,
        };
        let want = if q.y_bottom > 4.0 {
            &above
        } else {
            &split_model
        };
        assert_eq!(serde_json::to_value(m).unwrap(), normalized(want));
    }
    let dry = staged_run(&[("S", None, split_model)], json!({}))
        .0
        .unwrap();
    close(
        dry,
        staged_run(&[("S", None, above)], json!({})).0.unwrap(),
        9,
    );
}

fn sv(s: &Slice) -> f64 {
    (s.weight + s.udl) / s.width - s.u
}

#[test]
fn shansep_with_a_pop_and_with_a_yield_stress() {
    let base = json!({ "kind": "shansep", "unitWeight": 18, "ratio": 0.25, "exponent": 0.8 });
    let (_, s) = staged_run(
        &[("C", None, with(base.clone(), json!({ "pop": 20 })))],
        water(),
    );
    for q in slices(&s) {
        let v = sv(&q);
        close(
            q.cohesion_undrained,
            0.25 * v * ((v + 20.0) / v).powf(0.8),
            6,
        );
    }
    let (_, s) = staged_run(
        &[("C", None, with(base, json!({ "yieldStress": 60 })))],
        water(),
    );
    for q in slices(&s) {
        let v = sv(&q);
        close(
            q.cohesion_undrained,
            0.25 * v * (60.0 / v).max(1.0).powf(0.8),
            6,
        );
    }
}

#[test]
fn an_earlier_stage_with_a_higher_water_level_sets_the_yield_stress() {
    let clay = json!({ "kind": "shansep", "unitWeight": 18, "ratio": 0.25, "exponent": 0.8, "pop": 5, "yieldFromEarlierStage": true });
    let earlier = layered(
        &STAGED_GROUND,
        -10.0,
        &[("C", None, clay.clone())],
        json!({}),
    );
    // the earlier stage was drier (lower water: higher effective stress)
    let (now_f, now) = staged_run(
        &[("C", None, clay.clone())],
        with(water(), json!({ "earlierStage": earlier })),
    );
    let mut fresh_clay = clay;
    fresh_clay
        .as_object_mut()
        .unwrap()
        .remove("yieldFromEarlierStage");
    let fresh_f = staged_run(&[("C", None, fresh_clay)], water()).0.unwrap();
    assert!(now_f.unwrap() > fresh_f);
    for q in slices(&now) {
        let v = sv(&q);
        // the earlier stage had no pore pressure: σ′v0 ≈ W/b (at the slice's centre line)
        let sy = (q.weight + q.udl) / q.width + 5.0;
        close(
            q.cohesion_undrained / (0.25 * v * (sy / v).max(1.0).powf(0.8)),
            1.0,
            1,
        );
    }
}

#[test]
fn an_earlier_stages_preload_raises_the_yield_stress_as_a_strip_load_straight_down() {
    let clay = json!({ "kind": "shansep", "unitWeight": 18, "ratio": 0.25, "exponent": 0.8, "yieldFromEarlierStage": true });
    let stage = |q: f64| {
        let extra = if q > 0.0 {
            with(
                water(),
                json!({ "udls": [{ "magnitude": q, "x1": 0, "x2": 45 }] }),
            )
        } else {
            water()
        };
        layered(&STAGED_GROUND, -10.0, &[("C", None, clay.clone())], extra)
    };
    let (none_f, none) = staged_run(
        &[("C", None, clay.clone())],
        with(water(), json!({ "earlierStage": stage(0.0) })),
    );
    let (pre_f, pre) = staged_run(
        &[("C", None, clay.clone())],
        with(water(), json!({ "earlierStage": stage(200.0) })),
    );
    let earlier = pre.earlier_stage().unwrap();
    let base = slices(&none);
    for (i, q) in slices(&pre).iter().enumerate() {
        assert!(q.cohesion_undrained > base[i].cohesion_undrained);
        let v = sv(q);
        let sy = effective_vertical_stress(earlier, q.x, q.y_bottom) + 200.0;
        close(
            q.cohesion_undrained,
            0.25 * v * (sy / v).max(1.0).powf(0.8),
            9,
        );
    }
    assert!(pre_f.unwrap() > none_f.unwrap());
    // the stress for reinforcement pullout does not take the loads
    let s0 = &base[10];
    assert_eq!(
        effective_vertical_stress(earlier, s0.x, s0.y_bottom),
        effective_vertical_stress(none.earlier_stage().unwrap(), s0.x, s0.y_bottom)
    );
    // the part carried by excess pore pressure below the water does not count
    let mut d = stage(0.0);
    d["udls"] = json!([{ "magnitude": 200, "x1": 0, "x2": 45, "excessPorePressure": [{ "material": "C", "ratio": 0.75 }] }]);
    let excess = build_slope(&def(d)).unwrap();
    close(
        effective_vertical_stress_with_loads(&excess, 30.0, -5.0),
        effective_vertical_stress(earlier, 30.0, -5.0) + 50.0,
        9,
    );
}

#[test]
fn a_load_not_yet_consolidated_adds_ratio_times_q_of_pore_pressure_under_it_below_the_water_only() {
    let clay = json!({ "kind": "shansep", "unitWeight": 18, "ratio": 0.25, "exponent": 0.8 });
    let load = |excess: Option<Value>| {
        let mut u = json!({ "magnitude": 20, "x1": 0, "x2": 10 });
        if let Some(e) = excess {
            u["excessPorePressure"] = e;
        }
        with(water(), json!({ "udls": [u] }))
    };
    let (drained_f, drained) = staged_run(&[("C", None, clay.clone())], load(None));
    let drained = slices(&drained);
    let (loaded_f, loaded) = staged_run(
        &[("C", None, clay.clone())],
        load(Some(json!([{ "material": "C", "ratio": 0.9 }]))),
    );
    for (i, q) in slices(&loaded).iter().enumerate() {
        let under = (10.0f64.min(q.x_right) - 0.0f64.max(q.x_left)).max(0.0) / q.width;
        let expected = if drained[i].u > 0.0 {
            0.9 * 20.0 * under
        } else {
            0.0
        };
        close(q.u - drained[i].u, expected, 9);
    }
    assert!(loaded_f.unwrap() < drained_f.unwrap());
    // another material's excess does not apply
    let other = staged_run(
        &[("C", None, clay)],
        load(Some(json!([{ "material": "X", "ratio": 0.9 }]))),
    )
    .0;
    close(other.unwrap(), drained_f.unwrap(), 12);
}
