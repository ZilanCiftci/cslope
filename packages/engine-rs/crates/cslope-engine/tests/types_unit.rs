//! Ported unit tests of packages/engine/src/types: types.test.ts,
//! slope-definition.test.ts, swedish-factors.test.ts,
//! strength-branches.test.ts, strength.test.ts, suction-strength.test.ts,
//! validation.test.ts, validation-rules.test.ts, and the cases of
//! anisotropy-undrained.test.ts, hoek-brown.test.ts and shansep.test.ts that
//! test these modules directly. The cases that build and analyse a slope
//! (buildSlope, analyseSlope, the finite elements) are ported with those
//! modules.
//!
//! Models are written as JSON, as in TypeScript; NaN and the infinities as
//! the strings "NaN", "Infinity" (`MaterialModel` reads them).

use cslope_engine::error::ErrorKind;
use cslope_engine::js::math::{exp, pow, tan};
use cslope_engine::math::{interpolate_idw, interpolate_nearest, SpatialDataPoint};
use cslope_engine::types::*;
use serde_json::{json, Value};
use std::f64::consts::PI;

#[track_caller]
fn close_to(a: f64, b: f64, digits: i32) {
    assert!(
        (a - b).abs() < pow(10.0, -digits as f64) / 2.0,
        "{a} is not close to {b} ({digits} digits)"
    );
}

fn m(v: Value) -> MaterialModel {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))
}

/// `{ ...base, ...extra }` of two JSON objects.
fn with(base: &Value, extra: Value) -> Value {
    let mut out = base.clone();
    for (k, v) in extra.as_object().unwrap() {
        out[k] = v.clone();
    }
    out
}

fn ctx(y_bottom: f64, x: f64, y_ground: f64, alpha: f64) -> StrengthContext {
    StrengthContext {
        y_bottom,
        x,
        y_ground,
        alpha,
        ..Default::default()
    }
}

fn rs(model: &MaterialModel, c: StrengthContext) -> ResolvedStrength {
    resolve_strength(model, &c).unwrap()
}

fn deg(d: f64) -> f64 {
    (d * PI) / 180.0
}

fn tand(d: f64) -> f64 {
    tan(deg(d))
}

// ── types.test.ts ──────────────────────────────────────────────

fn material(params: MaterialParams) -> Material {
    Material::new(params).unwrap()
}

#[test]
fn material_defaults_and_strength() {
    let mat = material(MaterialParams {
        name: Some("Clay".into()),
        ..Default::default()
    });
    assert_eq!(mat.name, "Clay");
    assert_eq!(mat.unit_weight(), 20.0);
    let MaterialModel::MohrCoulomb(mc) = &*mat.model else {
        panic!()
    };
    assert_eq!(
        (mc.base.unit_weight, mc.friction_angle, mc.cohesion),
        (20.0, 35.0, 2.0)
    );

    let sand = material(MaterialParams {
        name: Some("Sand".into()),
        cohesion: Some(5.0),
        ..Default::default()
    });
    assert_eq!(
        sand.get_strength(&ctx(10.0, 0.0, 0.0, 0.0))
            .unwrap()
            .cohesion,
        5.0
    );
    assert_eq!(
        sand.get_strength(&ctx(0.0, 0.0, 0.0, 0.0))
            .unwrap()
            .cohesion,
        5.0
    );

    let clay = material(MaterialParams {
        cohesion: Some(10.0),
        cohesion_ref_depth: Some(5.0),
        cohesion_rate_of_change: Some(2.0),
        ..Default::default()
    });
    assert_eq!(
        clay.get_strength(&ctx(5.0, 0.0, 0.0, 0.0))
            .unwrap()
            .cohesion,
        10.0
    );
    assert_eq!(
        clay.get_strength(&ctx(3.0, 0.0, 0.0, 0.0))
            .unwrap()
            .cohesion,
        14.0
    );
}

#[test]
fn material_rejects_invalid_parameters() {
    for params in [
        MaterialParams {
            unit_weight: Some(-1.0),
            ..Default::default()
        },
        MaterialParams {
            unit_weight: Some(501.0),
            ..Default::default()
        },
        MaterialParams {
            friction_angle: Some(-1.0),
            ..Default::default()
        },
        MaterialParams {
            friction_angle: Some(91.0),
            ..Default::default()
        },
    ] {
        assert_eq!(Material::new(params).unwrap_err().kind, ErrorKind::Range);
    }
}

#[test]
fn loads() {
    let u = Udl::new(UdlParams {
        magnitude: -5.0,
        x1: 2.0,
        x2: 8.0,
        ..Default::default()
    });
    assert_eq!((u.magnitude, u.x1, u.x2, u.length), (5.0, 2.0, 8.0, 6.0));
    let u = Udl::new(UdlParams {
        magnitude: 12.0,
        x1: 8.0,
        x2: 2.0,
        ..Default::default()
    });
    assert_eq!((u.x1, u.x2, u.length), (2.0, 8.0, 6.0));
    let l = LineLoad::new(LineLoadParams {
        magnitude: -10.0,
        x: 5.0,
        ..Default::default()
    });
    assert_eq!((l.magnitude, l.x), (10.0, 5.0));
}

#[test]
fn constants() {
    let d = default_analysis_options();
    assert_eq!(d.slices, 25.0);
    assert_eq!(d.iterations, 1000.0);
    assert_eq!(d.refined_iterations, 500.0);
    assert_eq!(d.tolerance, 0.001);
    assert_eq!(d.max_iterations, 15.0);
    assert_eq!(d.method, AnalysisMethod::Bishop);
    assert_eq!(
        d.interslice_function,
        Some(IntersliceFunctionType::HalfSine)
    );
    assert_eq!(MATERIAL_EPSILON, 1e-10);
    assert_eq!(WATER_UNIT_WEIGHT, 9.807);
    assert_eq!(FOS_TOLERANCE, 0.001);
}

// ── slope-definition.test.ts ───────────────────────────────────

#[test]
fn materials_of_a_definition() {
    let model = m(json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 30 }));
    assert_eq!(
        material_model_of(&SlopeMaterialDefinition::new("a", model.clone())).unwrap(),
        model
    );
    let old: SlopeMaterialDefinition = serde_json::from_value(
        json!({ "name": "b", "unitWeight": 19, "cohesion": 5, "frictionAngle": 28 }),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(material_model_of(&old).unwrap()).unwrap(),
        json!({ "kind": "mohr-coulomb", "unitWeight": 19.0, "cohesion": 5.0, "frictionAngle": 28.0 })
    );
    let none: SlopeMaterialDefinition = serde_json::from_value(json!({ "name": "c" })).unwrap();
    assert!(material_model_of(&none)
        .unwrap_err()
        .message
        .contains("no model"));
}

#[test]
fn no_flat_fields_next_to_the_model() {
    let d: SlopeMaterialDefinition = serde_json::from_value(json!({
        "name": "a", "unitWeight": 0, "cohesion": 0, "frictionAngle": 0,
        "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 10, "frictionAngle": 30 }, "color": "#fff"
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_value(with_material_model(&d).unwrap()).unwrap(),
        json!({ "name": "a", "color": "#fff", "model": { "kind": "mohr-coulomb", "unitWeight": 18.0, "cohesion": 10.0, "frictionAngle": 30.0 } })
    );
}

// ── swedish-factors.test.ts ────────────────────────────────────

fn basis(
    safety_class: u8,
    eta_cu: f64,
    eta_drained: f64,
    variable_load_base: f64,
) -> SwedishFactorBasis {
    SwedishFactorBasis {
        safety_class,
        eta_cu,
        eta_drained,
        variable_load_base,
    }
}

#[test]
fn swedish_factors() {
    let f = swedish_partial_factors(&basis(2, 1.1, 1.0, 1.4)).unwrap();
    assert_eq!(
        (f.cu, f.cohesion, f.tan_phi, f.variable_load),
        (1.364, 1.3, 1.3, 1.274)
    );
    assert_eq!(f.basis, Some(basis(2, 1.1, 1.0, 1.4)));
    let f = swedish_partial_factors(&basis(3, 1.0, 1.0, 1.3)).unwrap();
    assert_eq!(
        [f.cu, f.cohesion, f.tan_phi, f.variable_load],
        [1.5, 1.3, 1.3, 1.3]
    );
    assert_eq!(SAFETY_CLASS_GAMMA_D, [(1, 0.83), (2, 0.91), (3, 1.0)]);
    assert!(swedish_partial_factors(&basis(4, 1.0, 1.0, 1.3))
        .unwrap_err()
        .message
        .contains("Safety class"));
    assert!(swedish_partial_factors(&basis(1, 0.0, 1.0, 1.3))
        .unwrap_err()
        .message
        .contains("etaCu"));
    // a class read from text is not a class: it does not deserialize
    let text = json!({ "safetyClass": "2", "etaCu": 1, "etaDrained": 1, "variableLoadBase": 1.3 });
    assert!(serde_json::from_value::<SwedishFactorBasis>(text).is_err());
}

// ── strength-branches.test.ts ──────────────────────────────────

#[test]
fn strength_guards() {
    let c = ctx(0.0, 5.0, 10.0, 0.0);
    let e = resolve_strength(&m(json!({ "kind": "granite", "unitWeight": 20 })), &c).unwrap_err();
    assert!(e.message.contains("Unknown material model kind: granite"));
    let spatial = |interpolation: &str| {
        m(
            json!({ "kind": "spatial-mohr-coulomb", "unitWeight": 18, "interpolation": interpolation,
            "dataPoints": [[0, 0, 10, 20, 18], [10, 0, 30, 40, 18]] }),
        )
    };
    assert_eq!(rs(&spatial("cubic"), c), rs(&spatial("idw"), c));
    close_to(rs(&spatial("idw"), c).cohesion, 20.0, 12);

    assert_eq!(interpolate_function(&[], 3.0), 0.0);
    assert_eq!(interpolate_function(&[[1.0, 7.0]], 3.0), 7.0);
    close_to(
        interpolate_function(&[[10.0, 2.0], [0.0, 0.0]], 5.0),
        1.0,
        12,
    );
    assert_eq!(interpolate_function(&[[0.0, 0.0], [10.0, 2.0]], -5.0), 0.0);
    assert_eq!(interpolate_function(&[[0.0, 0.0], [10.0, 2.0]], 15.0), 2.0);
    let steps = [[0.0, 0.0], [5.0, 1.0], [5.0, 3.0], [10.0, 3.0]];
    assert_eq!(interpolate_function(&steps, 5.0), 1.0);
    close_to(interpolate_function(&steps, 5.0001), 3.0, 9);
    assert_eq!(
        interpolate_function(&[[0.0, 0.0], [10.0, 2.0]], f64::NAN),
        2.0
    );

    let aniso = |f: Value, phi: f64| {
        m(
            json!({ "kind": "anisotropic-function", "unitWeight": 18, "cohesion": 10, "frictionAngle": phi, "modifierFunction": f }),
        )
    };
    let r = rs(&aniso(json!([]), 30.0), c);
    assert_eq!((r.cohesion, r.friction_angle), (10.0, 30.0));
    assert_eq!(
        rs(&aniso(json!([[-90, 4], [90, 4]]), 40.0), c).friction_angle,
        89.9
    );
    let r = rs(&aniso(json!([[-90, -1], [90, -1]]), 30.0), c);
    assert_eq!((r.cohesion, r.friction_angle), (0.0, 0.0));
}

// ── strength.test.ts ───────────────────────────────────────────

fn sctx() -> StrengthContext {
    ctx(0.0, 0.0, 10.0, 0.0)
}

#[test]
fn mohr_coulomb() {
    let mc =
        json!({ "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 });
    let r = rs(&m(mc.clone()), sctx());
    assert_eq!(
        (r.cohesion, r.friction_angle, r.skip_surface, r.impenetrable),
        (10.0, 30.0, None, None)
    );
    let depth = m(with(
        &mc,
        json!({ "cohesionRefDepth": 5, "cohesionRateOfChange": 2 }),
    ));
    assert_eq!(
        rs(
            &depth,
            StrengthContext {
                y_bottom: 3.0,
                ..sctx()
            }
        )
        .cohesion,
        14.0
    );
    assert_eq!(
        rs(&m(with(&mc, json!({ "cFactor": 0.5 }))), sctx()).cohesion,
        5.0
    );
    // Material's own Mohr-Coulomb model
    let legacy = material(MaterialParams {
        cohesion: Some(10.0),
        friction_angle: Some(30.0),
        cohesion_ref_depth: Some(5.0),
        cohesion_rate_of_change: Some(2.0),
        cohesion_undrained: Some(20.0),
        ..Default::default()
    });
    for y in [3.0, 5.0] {
        let a = rs(
            &legacy.model,
            StrengthContext {
                y_bottom: y,
                ..sctx()
            },
        );
        let b = legacy.get_strength(&ctx(y, 0.0, 0.0, 0.0)).unwrap();
        assert_eq!(
            (a.cohesion, a.cohesion_undrained),
            (b.cohesion, b.cohesion_undrained)
        );
    }
}

#[test]
fn undrained() {
    let ud = json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 50 });
    let r = rs(&m(ud.clone()), sctx());
    assert_eq!(
        (r.cohesion, r.friction_angle, r.cohesion_undrained),
        (50.0, 0.0, 50.0)
    );
    assert_eq!((r.skip_surface, r.impenetrable), (None, None));
    let d = m(with(&ud, json!({ "suRefDepth": 5, "suRateOfChange": 3 })));
    assert_eq!(
        rs(
            &d,
            StrengthContext {
                y_bottom: 2.0,
                ..sctx()
            }
        )
        .cohesion,
        59.0
    );
    let d = m(with(&ud, json!({ "suRefDepth": 0, "suRateOfChange": 2 })));
    assert_eq!(
        rs(
            &d,
            StrengthContext {
                y_bottom: 5.0,
                ..sctx()
            }
        )
        .cohesion,
        40.0
    );
}

#[test]
fn high_strength_and_impenetrable() {
    let hs = m(json!({ "kind": "high-strength", "unitWeight": 24 }));
    let r = rs(&hs, sctx());
    assert_eq!(
        (r.cohesion, r.friction_angle, r.skip_surface, r.impenetrable),
        (f64::INFINITY, 90.0, Some(true), None)
    );
    let r1 = rs(
        &hs,
        StrengthContext {
            y_bottom: -100.0,
            ..sctx()
        },
    );
    let r2 = rs(
        &hs,
        StrengthContext {
            y_bottom: 100.0,
            alpha: PI,
            ..sctx()
        },
    );
    assert_eq!(r1, r2);
    let r = rs(
        &m(json!({ "kind": "impenetrable", "unitWeight": 25 })),
        sctx(),
    );
    assert_eq!((r.impenetrable, r.skip_surface), (Some(true), None));
    assert_eq!(
        (r.cohesion, r.friction_angle, r.cohesion_undrained),
        (0.0, 0.0, 0.0)
    );
}

#[test]
fn anisotropic_function() {
    let a = json!({ "kind": "anisotropic-function", "unitWeight": 19, "cohesion": 20, "frictionAngle": 25,
        "modifierFunction": [[0, 1.0], [45, 0.8], [90, 0.5]] });
    let am = m(a.clone());
    let at = |d: f64| {
        rs(
            &am,
            StrengthContext {
                alpha: deg(d),
                ..sctx()
            },
        )
    };
    close_to(at(0.0).cohesion, 20.0, 2);
    close_to(at(0.0).friction_angle, 25.0, 2);
    close_to(at(45.0).cohesion, 16.0, 2);
    close_to(at(45.0).friction_angle, 20.0, 2);
    close_to(at(22.5).cohesion, 18.0, 2);
    close_to(at(120.0).cohesion, 10.0, 2);
    close_to(at(120.0).friction_angle, 12.5, 2);
    close_to(at(-10.0).cohesion, 20.0, 2);
    close_to(at(45.0).cohesion_undrained, at(45.0).cohesion, 2);
    let empty = m(with(&a, json!({ "modifierFunction": [] })));
    close_to(
        rs(
            &empty,
            StrengthContext {
                alpha: 0.5,
                ..sctx()
            },
        )
        .cohesion,
        20.0,
        2,
    );
    let zero = m(with(&a, json!({ "frictionAngle": 0 })));
    assert_eq!(
        rs(
            &zero,
            StrengthContext {
                alpha: deg(45.0),
                ..sctx()
            }
        )
        .friction_angle,
        0.0
    );
}

#[test]
fn strength_from_depth() {
    let sfd =
        m(json!({ "kind": "s-f-depth", "unitWeight": 18, "suRef": 20, "depthRef": 0, "rate": 4 }));
    let at = |g: f64, b: f64| {
        rs(
            &sfd,
            StrengthContext {
                y_ground: g,
                y_bottom: b,
                ..sctx()
            },
        )
    };
    close_to(at(10.0, 5.0).cohesion, 40.0, 2);
    assert_eq!(at(10.0, 5.0).friction_angle, 0.0);
    close_to(at(10.0, 10.0).cohesion, 20.0, 2);
    close_to(at(12.0, 0.0).cohesion, 68.0, 2);
    close_to(at(10.0, 7.5).cohesion, 30.0, 2);
    close_to(at(10.0, 5.0).cohesion_undrained, at(10.0, 5.0).cohesion, 2);
    let sfd2 =
        m(json!({ "kind": "s-f-depth", "unitWeight": 18, "suRef": 20, "depthRef": 5, "rate": 4 }));
    close_to(
        rs(
            &sfd2,
            StrengthContext {
                y_ground: 10.0,
                y_bottom: 0.0,
                ..sctx()
            },
        )
        .cohesion,
        40.0,
        2,
    );
}

#[test]
fn strength_from_datum() {
    let s = m(json!({ "kind": "s-f-datum", "unitWeight": 18, "suRef": 40, "yRef": 10, "rate": 4 }));
    let at = |y: f64| {
        rs(
            &s,
            StrengthContext {
                y_bottom: y,
                ..sctx()
            },
        )
    };
    for (y, su) in [
        (5.0, 60.0),
        (10.0, 40.0),
        (-5.0, 100.0),
        (15.0, 20.0),
        (7.5, 50.0),
    ] {
        close_to(at(y).cohesion, su, 2);
        assert_eq!(at(y).friction_angle, 0.0);
    }
}

#[test]
fn spatial_mohr_coulomb() {
    let at = |pts: Value, interp: Option<&str>, x: f64, y: f64| {
        let mut v = json!({ "kind": "spatial-mohr-coulomb", "unitWeight": 20, "dataPoints": pts });
        if let Some(i) = interp {
            v["interpolation"] = i.into();
        }
        rs(
            &m(v),
            StrengthContext {
                x,
                y_bottom: y,
                ..sctx()
            },
        )
    };
    let r = at(json!([]), None, 0.0, 0.0);
    assert_eq!((r.cohesion, r.friction_angle), (0.0, 0.0));
    let r = at(json!([[5, 3, 15, 28, 20]]), None, 5.0, 3.0);
    assert_eq!((r.cohesion, r.friction_angle), (15.0, 28.0));
    let two = json!([[0, 0, 10, 20, 18], [10, 0, 30, 40, 22]]);
    let r = at(two.clone(), None, 0.0, 0.0);
    assert_eq!((r.cohesion, r.friction_angle), (10.0, 20.0));
    let r = at(two.clone(), None, 5.0, 0.0);
    close_to(r.cohesion, 20.0, 2);
    close_to(r.friction_angle, 30.0, 2);
    let r = at(two.clone(), None, 2.0, 0.0);
    assert!(r.cohesion > 10.0 && r.cohesion < 15.0);
    let r = at(
        json!([[0, 0, 10, 20, 18], [10, 0, 30, 40, 22], [5, 10, 50, 60, 20]]),
        None,
        5.0,
        0.0,
    );
    assert!(r.cohesion > 10.0 && r.cohesion < 50.0);
    let r = at(two.clone(), Some("nearest"), 3.0, 0.0);
    assert_eq!((r.cohesion, r.friction_angle), (10.0, 20.0));
    let r = at(two.clone(), Some("nearest"), 7.0, 0.0);
    assert_eq!((r.cohesion, r.friction_angle), (30.0, 40.0));
    close_to(at(two, Some("linear"), 2.0, 0.0).cohesion, 14.0, 2);
    let r = at(json!([[0, 0, 15, 28, 20]]), None, 0.0, 0.0);
    assert_eq!(r.cohesion_undrained, r.cohesion);
}

#[test]
fn interpolate_function_cases() {
    assert_eq!(interpolate_function(&[], 5.0), 0.0);
    assert_eq!(interpolate_function(&[[3.0, 42.0]], 999.0), 42.0);
    assert_eq!(
        interpolate_function(&[[0.0, 10.0], [10.0, 20.0]], -5.0),
        10.0
    );
    assert_eq!(
        interpolate_function(&[[0.0, 10.0], [10.0, 20.0]], 15.0),
        20.0
    );
    close_to(
        interpolate_function(&[[0.0, 10.0], [10.0, 20.0]], 5.0),
        15.0,
        2,
    );
    close_to(
        interpolate_function(&[[10.0, 20.0], [0.0, 10.0]], 5.0),
        15.0,
        2,
    );
}

#[test]
fn material_model_field() {
    let mat = material(MaterialParams {
        cohesion: Some(10.0),
        friction_angle: Some(30.0),
        unit_weight: Some(19.0),
        name: Some("Test".into()),
        ..Default::default()
    });
    assert_eq!(mat.model.kind(), "mohr-coulomb");
    let MaterialModel::MohrCoulomb(mc) = &*mat.model else {
        panic!()
    };
    assert_eq!(
        (mc.cohesion, mc.friction_angle, mc.base.unit_weight),
        (10.0, 30.0, 19.0)
    );
    let model = m(json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 50 }));
    let mat = material(MaterialParams {
        model: Some(model.clone()),
        ..Default::default()
    });
    assert_eq!(*mat.model, model);
    let mat = material(MaterialParams {
        cohesion: Some(10.0),
        friction_angle: Some(30.0),
        ..Default::default()
    });
    let r = mat.get_strength(&sctx()).unwrap();
    assert_eq!((r.cohesion, r.friction_angle), (10.0, 30.0));
}

fn sp(x: f64, y: f64, values: &[f64]) -> SpatialDataPoint {
    SpatialDataPoint {
        x,
        y,
        values: values.to_vec(),
    }
}

#[test]
fn idw_and_nearest() {
    let pts = [sp(0.0, 0.0, &[10.0, 20.0]), sp(10.0, 0.0, &[30.0, 40.0])];
    assert!(interpolate_idw(&[], 5.0, 5.0, 2.0, 1e-10).is_empty());
    assert_eq!(
        interpolate_idw(&[sp(3.0, 4.0, &[42.0, 99.0])], 0.0, 0.0, 2.0, 1e-10),
        vec![42.0, 99.0]
    );
    assert_eq!(
        interpolate_idw(&pts, 0.0, 0.0, 2.0, 1e-10),
        vec![10.0, 20.0]
    );
    let r = interpolate_idw(&pts, 5.0, 0.0, 2.0, 1e-10);
    close_to(r[0], 20.0, 2);
    close_to(r[1], 30.0, 2);
    let r = interpolate_idw(&pts, 1.0, 0.0, 2.0, 1e-10);
    assert!(r[0] > 10.0 && r[0] < 15.0);
    assert!(
        interpolate_idw(&pts, 1.0, 0.0, 4.0, 1e-10)[0]
            < interpolate_idw(&pts, 1.0, 0.0, 1.0, 1e-10)[0]
    );
    let r = interpolate_idw(
        &[sp(0.0, 0.0, &[100.0]), sp(10.0, 10.0, &[200.0])],
        5.0,
        5.0,
        2.0,
        1e-10,
    );
    close_to(r[0], 150.0, 2);

    let pts = [
        sp(0.0, 0.0, &[10.0, 20.0]),
        sp(10.0, 0.0, &[30.0, 40.0]),
        sp(5.0, 8.0, &[50.0, 60.0]),
    ];
    assert!(interpolate_nearest(&[], 5.0, 5.0).is_empty());
    assert_eq!(interpolate_nearest(&pts, 1.0, 0.0), vec![10.0, 20.0]);
    assert_eq!(interpolate_nearest(&pts, 9.0, 0.0), vec![30.0, 40.0]);
    assert_eq!(interpolate_nearest(&pts, 5.0, 7.0), vec![50.0, 60.0]);
    let mut r = interpolate_nearest(&pts, 0.0, 0.0);
    r[0] = 999.0;
    assert_eq!(pts[0].values[0], 10.0);
}

#[test]
fn linear_variation_never_negative() {
    let c = ctx(-20.0, 0.0, 0.0, 0.0);
    let r = rs(
        &m(json!({ "kind": "s-f-datum", "unitWeight": 18, "suRef": 30, "yRef": 0, "rate": -5 })),
        c,
    );
    assert_eq!((r.cohesion, r.cohesion_undrained), (0.0, 0.0));
    let r = rs(
        &m(
            json!({ "kind": "s-f-depth", "unitWeight": 18, "suRef": 10, "depthRef": 0, "rate": -2 }),
        ),
        c,
    );
    assert_eq!(r.cohesion, 0.0);
    let r = rs(
        &m(
            json!({ "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30,
            "cohesionRefDepth": -30, "cohesionRateOfChange": 1 }),
        ),
        c,
    );
    assert_eq!((r.cohesion, r.friction_angle), (0.0, 30.0));
}

#[test]
fn depth_from_the_layer_top() {
    let base =
        json!({ "kind": "s-f-depth", "unitWeight": 16, "suRef": 10, "depthRef": 0, "rate": 1.5 });
    let top = m(with(&base, json!({ "depthReference": "layer-top" })));
    let c = StrengthContext {
        y_ground: 8.0,
        y_layer_top: Some(2.0),
        y_bottom: -4.0,
        ..sctx()
    };
    let r = rs(&top, c);
    close_to(r.cohesion, 19.0, 12);
    close_to(r.cohesion_undrained, 19.0, 12);
    close_to(rs(&m(base.clone()), c).cohesion, 28.0, 12);
    close_to(
        rs(&m(with(&base, json!({ "depthReference": "ground" }))), c).cohesion,
        28.0,
        12,
    );
    close_to(
        rs(
            &top,
            StrengthContext {
                y_ground: 8.0,
                y_bottom: -4.0,
                ..sctx()
            },
        )
        .cohesion,
        28.0,
        12,
    );
    assert!(needs_layer_top(&top));
    assert!(!needs_layer_top(&m(base.clone())));
    assert!(!needs_layer_top(&m(with(
        &base,
        json!({ "depthReference": "ground" })
    ))));
    assert!(!needs_layer_top(&m(
        json!({ "kind": "s-f-datum", "unitWeight": 16, "suRef": 10, "yRef": 0, "rate": 1 })
    )));
}

#[test]
fn strength_cutoff() {
    let gb = |model: &MaterialModel, g: f64, b: f64| {
        rs(
            model,
            StrengthContext {
                y_ground: g,
                y_bottom: b,
                ..sctx()
            },
        )
    };
    let up = m(
        json!({ "kind": "s-f-depth", "unitWeight": 16, "suRef": 10, "depthRef": 0, "rate": 2, "suMax": 25 }),
    );
    close_to(gb(&up, 10.0, 5.0).cohesion, 20.0, 12);
    assert_eq!(gb(&up, 10.0, 0.0).cohesion, 25.0);
    assert_eq!(gb(&up, 10.0, 0.0).cohesion_undrained, 25.0);
    let down = m(
        json!({ "kind": "s-f-depth", "unitWeight": 16, "suRef": 30, "depthRef": 0, "rate": -2, "suMax": 18 }),
    );
    close_to(gb(&down, 10.0, 5.0).cohesion, 20.0, 12);
    assert_eq!(gb(&down, 10.0, 0.0).cohesion, 18.0);
    assert_eq!(gb(&down, 10.0, -50.0).cohesion, 18.0);
    let flat = m(
        json!({ "kind": "s-f-depth", "unitWeight": 16, "suRef": 30, "depthRef": 0, "rate": 0, "suMax": 20 }),
    );
    assert_eq!(gb(&flat, 10.0, 5.0).cohesion, 20.0);

    let y = |model: &MaterialModel, y: f64| {
        rs(
            model,
            StrengthContext {
                y_bottom: y,
                ..sctx()
            },
        )
        .cohesion
    };
    let d = m(
        json!({ "kind": "s-f-datum", "unitWeight": 18, "suRef": 40, "yRef": 10, "rate": 4, "suMax": 50 }),
    );
    close_to(y(&d, 15.0), 20.0, 12);
    assert_eq!(y(&d, 5.0), 50.0);
    let d = m(
        json!({ "kind": "s-f-datum", "unitWeight": 18, "suRef": 40, "yRef": 10, "rate": -4, "suMax": 30 }),
    );
    close_to(y(&d, 15.0), 60.0, 12);
    assert_eq!(y(&d, 5.0), 30.0);

    let upj = json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 20, "suRefDepth": 0, "suRateOfChange": 3, "suMax": 35 });
    close_to(y(&m(upj.clone()), -3.0), 29.0, 12);
    assert_eq!(y(&m(upj.clone()), -10.0), 35.0);
    let downj = with(
        &upj,
        json!({ "undrainedShearStrength": 50, "suRateOfChange": -3, "suMax": 30 }),
    );
    close_to(y(&m(downj.clone()), -3.0), 41.0, 12);
    assert_eq!(y(&m(downj), -10.0), 30.0);
    let mut norate = with(&upj, json!({ "suMax": 15 }));
    norate.as_object_mut().unwrap().remove("suRateOfChange");
    assert_eq!(y(&m(norate), -10.0), 15.0);

    let lcc = m(
        json!({ "kind": "lime-cement-columns", "unitWeight": 16, "soilSu": 10, "suRefDepth": 0, "suRateOfChange": 2,
        "columnSu": 100, "areaRatio": 0.25, "suMax": 15 }),
    );
    close_to(y(&lcc, -10.0), 36.25, 12);
    close_to(y(&lcc, -1.0), 34.0, 12);
    let none =
        m(json!({ "kind": "s-f-datum", "unitWeight": 18, "suRef": 40, "yRef": 10, "rate": 4 }));
    close_to(y(&none, -100.0), 480.0, 9);
}

#[test]
fn design_strength_per_part() {
    let f = PartialFactors {
        cu: 1.4,
        cohesion: 1.25,
        tan_phi: 1.25,
        variable_load: 1.0,
        basis: None,
    };
    let lccj = json!({ "kind": "lime-cement-columns", "unitWeight": 16, "soilSu": 20, "columnSu": 150, "areaRatio": 0.2,
        "columnCohesion": 30, "columnFrictionAngle": 30 });
    let lcc = m(lccj.clone());
    let st = rs(&lcc, sctx());
    close_to(st.cohesion, 22.0, 12);
    let d = design_strength(Some(lcc.kind()), &st, Some(&f));
    close_to(d.cohesion, (0.8 * 20.0) / 1.4 + (0.2 * 30.0) / 1.25, 12);
    close_to(d.cohesion, 16.23, 2);
    close_to(d.tan_phi, (0.2 * tan(PI / 6.0)) / 1.25, 12);
    close_to(d.cohesion_undrained, (0.2 * 150.0 + 0.8 * 20.0) / 1.4, 12);
    assert!(!d.undrained);
    let mut undrained = lccj;
    undrained.as_object_mut().unwrap().remove("columnCohesion");
    let u = design_strength(
        Some("lime-cement-columns"),
        &rs(&m(undrained), sctx()),
        Some(&f),
    );
    close_to(u.cohesion, (0.2 * 150.0 + 0.8 * 20.0) / 1.4, 12);
    assert!(u.undrained);

    let su = m(json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 28 }));
    assert_eq!(
        design_strength(Some(su.kind()), &rs(&su, sctx()), Some(&f)),
        DesignStrength {
            cohesion: 20.0,
            tan_phi: 0.0,
            cohesion_undrained: 20.0,
            undrained: true
        }
    );
    let mc = m(
        json!({ "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 10, "frictionAngle": 30, "cFactor": 1, "cohesionUndrained": 28 }),
    );
    let d = design_strength(Some(mc.kind()), &rs(&mc, sctx()), Some(&f));
    close_to(d.cohesion, 8.0, 12);
    close_to(d.tan_phi, tan(PI / 6.0) / 1.25, 12);
    close_to(d.cohesion_undrained, 20.0, 12);
    assert_eq!(
        design_strength(Some(mc.kind()), &rs(&mc, sctx()), None).cohesion,
        10.0
    );
}

// model/combined-depth.test.ts: "takes the drained partial factors on c′ and
// tan φ′ and γcu on Su" (moved here from the TypeScript tests)
#[test]
fn design_strength_of_a_combined_s_f_depth() {
    let model = m(
        json!({ "kind": "s-f-depth", "unitWeight": 16, "suRef": 10, "depthRef": 0, "rate": 1.5,
        "depthReference": "layer-top", "drainedCohesion": 1, "drainedCohesionRate": 0.15, "drainedFrictionAngle": 30 }),
    );
    let c = StrengthContext {
        y_layer_top: Some(0.0),
        ..ctx(-4.0, 10.0, 1.0, 0.0)
    };
    let f = PartialFactors {
        cu: 1.5,
        cohesion: 1.3,
        tan_phi: 1.3,
        variable_load: 1.0,
        basis: None,
    };
    let d = design_strength(Some("s-f-depth"), &rs(&model, c), Some(&f));
    assert!(!d.undrained);
    close_to(d.cohesion, 1.6 / 1.3, 12);
    close_to(d.tan_phi, tan(PI / 6.0) / 1.3, 12);
    close_to(d.cohesion_undrained, 16.0 / 1.5, 12);
}

// ── suction-strength.test.ts ───────────────────────────────────

fn sctx_suction(suction: Option<f64>) -> StrengthContext {
    StrengthContext {
        suction,
        ..ctx(0.0, 0.0, 5.0, 0.0)
    }
}

fn mcs(extra: Value) -> MaterialModel {
    m(with(
        &json!({ "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 10, "frictionAngle": 30 }),
        extra,
    ))
}

#[test]
fn suction_strength_resolution() {
    let r = rs(&mcs(json!({ "phiB": 15 })), sctx_suction(Some(20.0)));
    close_to(r.cohesion, 10.0 + 20.0 * tand(15.0), 12);
    close_to(r.suction_strength.unwrap(), 20.0 * tand(15.0), 12);
    assert_eq!(r.friction_angle, 30.0);

    let plain = rs(&mcs(json!({})), sctx_suction(None));
    assert_eq!(
        rs(&mcs(json!({ "phiB": 15 })), sctx_suction(Some(0.0))),
        plain
    );
    assert_eq!(rs(&mcs(json!({ "phiB": 15 })), sctx_suction(None)), plain);
    assert_eq!(
        rs(&mcs(json!({ "phiB": 0 })), sctx_suction(Some(50.0))),
        plain
    );
    assert_eq!(rs(&mcs(json!({})), sctx_suction(Some(50.0))), plain);

    let capped = rs(
        &mcs(json!({ "phiB": 15, "maxSuction": 8 })),
        sctx_suction(Some(20.0)),
    );
    close_to(capped.suction_strength.unwrap(), 8.0 * tand(15.0), 12);
    let uncapped = rs(
        &mcs(json!({ "phiB": 15, "maxSuction": 80 })),
        sctx_suction(Some(20.0)),
    );
    close_to(uncapped.suction_strength.unwrap(), 20.0 * tand(15.0), 12);
    close_to(
        suction_strength(&mcs(json!({ "phiB": 20, "maxSuction": 5 })), 100.0),
        5.0 * tand(20.0),
        12,
    );
}

#[test]
fn suction_only_on_the_drained_branch() {
    let comb = rs(
        &mcs(json!({ "phiB": 10, "cFactor": 0.1, "cohesionUndrained": 40 })),
        sctx_suction(Some(30.0)),
    );
    assert_eq!(comb.is_combined, Some(true));
    close_to(comb.cohesion, 1.0 + 30.0 * tand(10.0), 12);
    assert_eq!(comb.cohesion_undrained, 40.0);

    let depthj = json!({ "kind": "s-f-depth", "unitWeight": 18, "suRef": 30, "depthRef": 0, "rate": 0, "phiB": 10 });
    let depth = m(depthj.clone());
    assert_eq!(suction_angle(&depth), 0.0);
    assert_eq!(
        rs(&depth, sctx_suction(Some(30.0))),
        rs(&depth, sctx_suction(None))
    );
    let combined = m(with(
        &depthj,
        json!({ "drainedCohesion": 3, "drainedFrictionAngle": 30 }),
    ));
    let r = rs(&combined, sctx_suction(Some(30.0)));
    close_to(r.cohesion, 3.0 + 30.0 * tand(10.0), 12);
    assert_eq!(r.cohesion_undrained, 30.0);

    let aniso = m(
        json!({ "kind": "anisotropic-function", "unitWeight": 18, "cohesion": 10, "frictionAngle": 30,
        "modifierFunction": [[-90, 0.5], [90, 0.5]], "phiB": 20 }),
    );
    close_to(
        rs(&aniso, sctx_suction(Some(10.0))).cohesion,
        5.0 + 10.0 * tand(20.0),
        12,
    );

    let u = m(
        json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 25, "phiB": 20 }),
    );
    assert_eq!(suction_angle(&u), 0.0);
    assert_eq!(rs(&u, sctx_suction(Some(40.0))).cohesion, 25.0);
}

#[test]
fn suction_design_value() {
    let f = PartialFactors {
        cu: 1.5,
        cohesion: 1.3,
        tan_phi: 1.3,
        variable_load: 1.3,
        basis: None,
    };
    let st = rs(&mcs(json!({ "phiB": 15 })), sctx_suction(Some(20.0)));
    close_to(
        design_strength(Some("mohr-coulomb"), &st, Some(&f)).cohesion,
        (10.0 + 20.0 * tand(15.0)) / 1.3,
        12,
    );
    let st0 = rs(
        &mcs(json!({ "frictionAngle": 0, "cohesion": 30, "phiB": 15 })),
        sctx_suction(Some(20.0)),
    );
    let d0 = design_strength(Some("mohr-coulomb"), &st0, Some(&f));
    assert!(d0.undrained);
    close_to(d0.cohesion, 30.0 / 1.5 + (20.0 * tand(15.0)) / 1.3, 12);
}

#[test]
fn suction_validation() {
    assert!(validate_material_model(&mcs(json!({ "phiB": 15, "maxSuction": 50 }))).is_empty());
    assert!(validate_material_model(&mcs(json!({ "phiB": 0 }))).is_empty());
    for extra in [
        json!({ "phiB": 90 }),
        json!({ "phiB": -1 }),
        json!({ "phiB": "NaN" }),
    ] {
        assert!(validate_material_model(&mcs(extra))
            .join(",")
            .contains("φb"));
    }
    assert!(
        validate_material_model(&mcs(json!({ "phiB": 10, "maxSuction": 0 })))
            .join(",")
            .contains("maximum suction")
    );
    let u = m(
        json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 25, "phiB": 20 }),
    );
    assert!(validate_material_model(&u)
        .join(",")
        .contains("only taken by"));
    let depthj = json!({ "kind": "s-f-depth", "unitWeight": 18, "suRef": 30, "depthRef": 0, "rate": 0, "phiB": 10 });
    assert!(validate_material_model(&m(depthj.clone()))
        .join(",")
        .contains("combined"));
    assert!(validate_material_model(&m(with(
        &depthj,
        json!({ "drainedCohesion": 2, "drainedFrictionAngle": 30 })
    )))
    .is_empty());
}

// ── validation.test.ts ─────────────────────────────────────────

fn errs(v: Value) -> Vec<String> {
    validate_material_model(&m(v))
}

#[track_caller]
fn contains(errors: &[String], fragment: &str) {
    assert!(
        errors.iter().any(|e| e.contains(fragment)),
        "{fragment:?} not in {errors:?}"
    );
}

#[test]
fn validation_by_kind() {
    let mc =
        json!({ "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 10, "frictionAngle": 30 });
    for uw in [json!(0), json!(-5), json!("NaN"), json!("Infinity")] {
        contains(&errs(with(&mc, json!({ "unitWeight": uw }))), "Unit weight");
    }
    assert!(errs(mc.clone()).is_empty());
    contains(&errs(with(&mc, json!({ "cohesion": -1 }))), "Cohesion");
    contains(
        &errs(with(&mc, json!({ "frictionAngle": -1 }))),
        "Friction angle",
    );
    contains(
        &errs(with(&mc, json!({ "cohesion": 0, "frictionAngle": 0 }))),
        "no strength",
    );
    assert!(errs(with(&mc, json!({ "cohesion": 0, "frictionAngle": 30 }))).is_empty());
    assert!(errs(with(&mc, json!({ "cohesion": 10, "frictionAngle": 0 }))).is_empty());

    let ud = json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 25 });
    assert!(errs(ud.clone()).is_empty());
    contains(
        &errs(with(&ud, json!({ "undrainedShearStrength": -1 }))),
        "Undrained",
    );
    assert!(errs(with(&ud, json!({ "undrainedShearStrength": 0 }))).is_empty());
    assert!(errs(json!({ "kind": "high-strength", "unitWeight": 24 })).is_empty());
    assert!(errs(json!({ "kind": "impenetrable", "unitWeight": 26 })).is_empty());

    let sp = json!({ "kind": "spatial-mohr-coulomb", "unitWeight": 18,
        "dataPoints": [[0, 0, 10, 30, 18], [5, 0, 12, 28, 19], [10, 0, 8, 32, 17]] });
    assert!(errs(sp.clone()).is_empty());
    contains(&errs(with(&sp, json!({ "dataPoints": [] }))), "at least 1");
    contains(
        &errs(with(&sp, json!({ "dataPoints": [[0, 0, "NaN", 30, 18]] }))),
        "finite numbers",
    );
    contains(
        &errs(with(&sp, json!({ "dataPoints": [[0, 0, -5, 30, 18]] }))),
        "cohesion",
    );
    contains(
        &errs(with(&sp, json!({ "dataPoints": [[0, 0, 10, -5, 18]] }))),
        "friction angle",
    );
    contains(
        &errs(with(&sp, json!({ "dataPoints": [[0, 0, 10, 30, 0]] }))),
        "unit weight",
    );
    assert!(errs(with(&sp, json!({ "dataPoints": [[0, 0, 10, 30, 18]] }))).is_empty());
    // a point with the wrong number of values: TypeScript's message
    contains(
        &errs(with(&sp, json!({ "dataPoints": [[0, 0, 10]] }))),
        "5 values",
    );

    let an = json!({ "kind": "anisotropic-function", "unitWeight": 18, "cohesion": 10, "frictionAngle": 30,
        "modifierFunction": [[0, 1.0], [90, 0.5]] });
    assert!(errs(an.clone()).is_empty());
    contains(&errs(with(&an, json!({ "cohesion": -1 }))), "cohesion");
    contains(
        &errs(with(&an, json!({ "frictionAngle": -1 }))),
        "friction angle",
    );
    contains(
        &errs(with(&an, json!({ "modifierFunction": [[0, 1.0]] }))),
        "at least 2",
    );
    contains(
        &errs(with(&an, json!({ "modifierFunction": [] }))),
        "at least 2",
    );
    contains(
        &errs(with(
            &an,
            json!({ "modifierFunction": [[0, 1.0], [90, -0.5]] }),
        )),
        "factor",
    );
    contains(
        &errs(with(
            &an,
            json!({ "modifierFunction": [[0, "NaN"], [90, 0.5]] }),
        )),
        "finite numbers",
    );

    let sfd =
        json!({ "kind": "s-f-depth", "unitWeight": 18, "suRef": 20, "depthRef": 0, "rate": 2 });
    assert!(errs(sfd.clone()).is_empty());
    contains(&errs(with(&sfd, json!({ "suRef": -1 }))), "reference Su");
    contains(&errs(with(&sfd, json!({ "suRef": "NaN" }))), "reference Su");
    contains(
        &errs(with(&sfd, json!({ "depthRef": "NaN" }))),
        "reference depth",
    );
    contains(&errs(with(&sfd, json!({ "rate": "NaN" }))), "Rate");
    assert!(errs(with(&sfd, json!({ "suRef": 0 }))).is_empty());
    assert!(errs(with(&sfd, json!({ "rate": -1 }))).is_empty());

    let sdt = json!({ "kind": "s-f-datum", "unitWeight": 18, "suRef": 30, "yRef": 0, "rate": 2 });
    assert!(errs(sdt.clone()).is_empty());
    contains(&errs(with(&sdt, json!({ "suRef": -1 }))), "reference Su");
    contains(
        &errs(with(&sdt, json!({ "yRef": "NaN" }))),
        "reference elevation",
    );
    contains(&errs(with(&sdt, json!({ "rate": "NaN" }))), "Rate");
    assert!(errs(with(&sdt, json!({ "yRef": -10 }))).is_empty());

    assert!(errs(json!({ "kind": "mohr-coulomb", "unitWeight": -1, "cohesion": -5, "frictionAngle": -10 })).len() >= 3);

    // depth reference and strength cutoff
    assert!(errs(with(&sfd, json!({ "depthReference": "layer-top" }))).is_empty());
    assert!(errs(with(&sfd, json!({ "depthReference": "ground" }))).is_empty());
    contains(
        &errs(with(&sfd, json!({ "depthReference": "surface" }))),
        "Depth reference",
    );
    assert!(errs(with(&sfd, json!({ "suMax": 50 }))).is_empty());
    assert!(errs(with(&sdt, json!({ "suMax": 50 }))).is_empty());
    assert!(errs(with(&ud, json!({ "suMax": 50 }))).is_empty());
    assert!(errs(json!({ "kind": "lime-cement-columns", "unitWeight": 16, "soilSu": 10, "columnSu": 100, "areaRatio": 0.2, "suMax": 30 })).is_empty());
    for su_max in [json!(0), json!(-5), json!("NaN"), json!("Infinity")] {
        contains(
            &errs(with(&sfd, json!({ "suMax": su_max }))),
            "strength cutoff",
        );
        contains(
            &errs(with(&ud, json!({ "suMax": su_max }))),
            "strength cutoff",
        );
    }
    assert!(errs(with(
        &sfd,
        json!({ "depthRef": 3, "rate": -5, "suMax": 25 })
    ))
    .is_empty());
    assert!(errs(with(&sfd, json!({ "rate": -2, "suMax": 10 }))).is_empty());
    assert!(errs(with(&sdt, json!({ "rate": -1, "suMax": 40 }))).is_empty());
    assert!(errs(with(&sfd, json!({ "suMax": 10 }))).is_empty());
}

// ── validation-rules.test.ts ───────────────────────────────────

fn kind(k: &str) -> Value {
    match k {
        "mc" => {
            json!({ "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30 })
        }
        "su" => json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 30 }),
        "sfd" => {
            json!({ "kind": "s-f-depth", "unitWeight": 18, "suRef": 20, "depthRef": 0, "rate": 2 })
        }
        "sfy" => {
            json!({ "kind": "s-f-datum", "unitWeight": 18, "suRef": 20, "yRef": 0, "rate": 2 })
        }
        "lcc" => {
            json!({ "kind": "lime-cement-columns", "unitWeight": 18, "soilSu": 15, "columnSu": 100, "areaRatio": 0.2 })
        }
        "aniso" => {
            json!({ "kind": "anisotropic-function", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30,
            "modifierFunction": [[-90, 1], [90, 1]] })
        }
        _ => unreachable!(),
    }
}

fn spatial(points: Value) -> Value {
    json!({ "kind": "spatial-mohr-coulomb", "unitWeight": 18, "dataPoints": points })
}

#[test]
fn every_rule_rejects_with_its_message() {
    let rejected: Vec<(Value, &str)> = vec![
        (
            with(&kind("mc"), json!({ "unitWeight": 0 })),
            "Unit weight (γ) must be a positive",
        ),
        (
            with(&kind("mc"), json!({ "unitWeight": -1 })),
            "Unit weight (γ) must be a positive",
        ),
        (
            with(&kind("mc"), json!({ "unitWeight": "NaN" })),
            "Unit weight (γ) must be a positive",
        ),
        (
            with(&kind("mc"), json!({ "unitWeight": 500.1 })),
            "at most 500",
        ),
        (
            with(&kind("mc"), json!({ "unitWeightSat": 0 })),
            "Saturated",
        ),
        (
            with(&kind("mc"), json!({ "unitWeightSat": 501 })),
            "Saturated",
        ),
        (
            with(&kind("mc"), json!({ "unitWeightSat": "Infinity" })),
            "Saturated",
        ),
        (
            with(&kind("mc"), json!({ "cohesionRefDepth": "NaN" })),
            "reference elevation of the cohesion must be a finite",
        ),
        (
            with(&kind("mc"), json!({ "cohesionUndrained": "Infinity" })),
            "undrained shear strength (Su) must be a finite",
        ),
        (
            with(&kind("mc"), json!({ "cFactor": "NaN" })),
            "c-factor must be a finite",
        ),
        (
            with(&kind("su"), json!({ "suRefDepth": "NaN" })),
            "reference elevation of Su must be a finite",
        ),
        (
            with(&kind("su"), json!({ "suRateOfChange": "NaN" })),
            "rate of change of Su must be a finite",
        ),
        (
            with(&kind("mc"), json!({ "cohesion": -0.1 })),
            "Cohesion (c) must be ≥ 0",
        ),
        (
            with(&kind("mc"), json!({ "cohesion": "NaN" })),
            "Cohesion (c) must be ≥ 0",
        ),
        (
            with(&kind("mc"), json!({ "frictionAngle": -1 })),
            "Friction angle (φ) must be ≥ 0",
        ),
        (
            with(&kind("mc"), json!({ "frictionAngle": 90 })),
            "less than 90",
        ),
        (
            with(&kind("mc"), json!({ "cFactor": -1 })),
            "c-factor must be ≥ 0",
        ),
        (
            with(&kind("mc"), json!({ "cohesion": 0, "frictionAngle": 0 })),
            "no strength",
        ),
        (
            with(
                &kind("mc"),
                json!({ "cohesion": 0, "frictionAngle": 0, "cohesionRateOfChange": 0 }),
            ),
            "no strength",
        ),
        (
            with(
                &kind("mc"),
                json!({ "cohesionUndrained": -1, "cFactor": 1 }),
            ),
            "Su) must be ≥ 0 for combined",
        ),
        (
            with(&kind("su"), json!({ "undrainedShearStrength": -1 })),
            "Undrained shear strength",
        ),
        (
            with(&kind("su"), json!({ "undrainedShearStrength": "NaN" })),
            "Undrained shear strength",
        ),
        (
            with(&kind("su"), json!({ "suMax": 0 })),
            "strength cutoff must be a positive",
        ),
        (
            with(&kind("su"), json!({ "suMax": "NaN" })),
            "strength cutoff must be a positive",
        ),
        (spatial(json!([])), "at least 1 data point"),
        (spatial(json!(null)), "at least 1 data point"),
        (spatial(json!([[0, "NaN", 1, 30, 18]])), "finite numbers"),
        (
            spatial(json!([[0, 0, -1, 30, 18]])),
            "cohesion (c) must be ≥ 0",
        ),
        (
            spatial(json!([[0, 0, 1, -30, 18]])),
            "friction angle (φ) must be ≥ 0",
        ),
        (
            spatial(json!([[0, 0, 1, 30, 0]])),
            "unit weight (γ) must be > 0",
        ),
        (
            with(&kind("aniso"), json!({ "cohesion": -1 })),
            "Base cohesion",
        ),
        (
            with(&kind("aniso"), json!({ "frictionAngle": "NaN" })),
            "Base friction angle (φ) must be ≥ 0",
        ),
        (
            with(&kind("aniso"), json!({ "frictionAngle": 90 })),
            "less than 90",
        ),
        (
            with(&kind("aniso"), json!({ "modifierFunction": [[0, 1]] })),
            "at least 2 data points",
        ),
        (
            with(&kind("aniso"), json!({ "modifierFunction": null })),
            "at least 2 data points",
        ),
        (
            with(
                &kind("aniso"),
                json!({ "modifierFunction": [[0, "NaN"], [10, 1]] }),
            ),
            "finite numbers",
        ),
        (
            with(
                &kind("aniso"),
                json!({ "modifierFunction": [[0, -0.5], [10, 1]] }),
            ),
            "factor must be ≥ 0",
        ),
        (with(&kind("sfd"), json!({ "suRef": -1 })), "reference Su"),
        (
            with(&kind("sfd"), json!({ "depthRef": "NaN" })),
            "reference depth",
        ),
        (
            with(&kind("sfd"), json!({ "rate": "Infinity" })),
            "Rate of change",
        ),
        (
            with(&kind("sfd"), json!({ "depthReference": "surface" })),
            "Depth reference",
        ),
        (
            with(&kind("sfd"), json!({ "suMax": -5 })),
            "strength cutoff must be a positive",
        ),
        (
            with(&kind("sfy"), json!({ "suRef": "NaN" })),
            "reference Su",
        ),
        (
            with(&kind("sfy"), json!({ "yRef": "NaN" })),
            "reference elevation must",
        ),
        (
            with(&kind("sfy"), json!({ "rate": "NaN" })),
            "Rate of change",
        ),
        (with(&kind("lcc"), json!({ "soilSu": -1 })), "Soil Su"),
        (
            with(&kind("lcc"), json!({ "columnSu": "NaN" })),
            "Column Su",
        ),
        (
            with(&kind("lcc"), json!({ "areaRatio": 1.01 })),
            "Area ratio",
        ),
        (
            with(&kind("lcc"), json!({ "areaRatio": -0.01 })),
            "Area ratio",
        ),
        (
            with(&kind("lcc"), json!({ "suRefDepth": "Infinity" })),
            "Reference level",
        ),
        (
            with(&kind("lcc"), json!({ "suRateOfChange": "Infinity" })),
            "Rate of change",
        ),
        (
            with(&kind("lcc"), json!({ "columnCohesion": 10 })),
            "both the drained column",
        ),
        (
            with(&kind("lcc"), json!({ "columnFrictionAngle": 30 })),
            "both the drained column",
        ),
        (
            with(
                &kind("lcc"),
                json!({ "columnCohesion": -1, "columnFrictionAngle": 30 }),
            ),
            "Drained column cohesion",
        ),
        (
            with(
                &kind("lcc"),
                json!({ "columnCohesion": 10, "columnFrictionAngle": 90 }),
            ),
            "friction angle must be 0–90",
        ),
        (
            with(
                &kind("lcc"),
                json!({ "columnCohesion": 10, "columnFrictionAngle": -1 }),
            ),
            "friction angle must be 0–90",
        ),
        (
            json!({ "kind": "shansep", "unitWeight": 18, "ratio": 0.25, "pop": 10, "yieldStress": 80 }),
            "either POP or the yield stress",
        ),
        (
            json!({ "kind": "granite", "unitWeight": 18 }),
            "Unknown material model kind \"granite\"",
        ),
    ];
    for (model, fragment) in rejected {
        contains(&errs(model), fragment);
    }
    // exact messages
    assert!(errs(with(&kind("mc"), json!({ "ru": 1 })))
        .contains(&"The pore pressure ratio rᵤ must be at least 0 and below 1.".to_string()));
    assert!(errs(with(&kind("mc"), json!({ "bBar": 1.6 })))
        .contains(&"B̄ must be between 0 and 1.5.".to_string()));
    // shapes TypeScript checks (a string number, a point with the wrong
    // number of values): its messages, read from the JSON
    for (bad, fragment) in [
        (
            with(&kind("mc"), json!({ "cohesionRateOfChange": "1" })),
            "rate of change of the cohesion must be a finite",
        ),
        (spatial(json!([[0, 0, 1, 30]])), "must have 5 values"),
        (
            with(
                &kind("aniso"),
                json!({ "modifierFunction": [[0, 1, 2], [10, 1]] }),
            ),
            "must have 2 values",
        ),
    ] {
        contains(&errs(bad), fragment);
    }
    // a malformed spatial data point skips the value checks of that point
    assert_eq!(
        errs(spatial(json!([[0, 0, -1], [0, 0, 1, 30, 18]]))),
        vec!["Data point 1: must have 5 values [x, y, c, φ, γ].".to_string()]
    );
}

#[test]
fn boundary_values_are_accepted() {
    let accepted = vec![
        with(&kind("su"), json!({ "suMax": 30, "suRateOfChange": -1 })),
        with(&kind("sfd"), json!({ "rate": -1, "suMax": 25 })),
        with(&kind("sfy"), json!({ "rate": -1, "suMax": 20 })),
        with(&kind("lcc"), json!({ "suRateOfChange": -1, "suMax": 15 })),
        with(&kind("mc"), json!({ "unitWeight": 500 })),
        with(&kind("mc"), json!({ "unitWeight": 1e-6 })),
        with(&kind("mc"), json!({ "unitWeightSat": 500 })),
        with(&kind("mc"), json!({ "cohesion": 0 })),
        with(&kind("mc"), json!({ "frictionAngle": 0 })),
        with(&kind("mc"), json!({ "frictionAngle": 89.99 })),
        with(&kind("mc"), json!({ "cFactor": 0 })),
        with(
            &kind("mc"),
            json!({ "cohesion": 0, "frictionAngle": 0, "cohesionRateOfChange": 1 }),
        ),
        with(&kind("mc"), json!({ "cohesionUndrained": 0, "cFactor": 1 })),
        with(&kind("mc"), json!({ "cohesionUndrained": 10 })),
        with(&kind("su"), json!({ "undrainedShearStrength": 0 })),
        with(&kind("su"), json!({ "suMax": 1e-9 })),
        with(&kind("su"), json!({ "suMax": 29.99, "suRateOfChange": -1 })),
        with(&kind("su"), json!({ "suMax": 100, "suRateOfChange": 1 })),
        with(&kind("su"), json!({ "suMax": 100 })),
        json!({ "kind": "high-strength", "unitWeight": 18 }),
        json!({ "kind": "impenetrable", "unitWeight": 18 }),
        spatial(json!([[0, 0, 0, 0, 18]])),
        with(
            &kind("aniso"),
            json!({ "modifierFunction": [[0, 0], [10, 1]] }),
        ),
        with(&kind("aniso"), json!({ "cohesion": 0, "frictionAngle": 0 })),
        with(&kind("sfd"), json!({ "rate": -1, "suMax": 19 })),
        with(&kind("sfd"), json!({ "depthReference": "layer-top" })),
        with(&kind("sfd"), json!({ "depthReference": "ground" })),
        with(&kind("sfd"), json!({ "suRef": 0 })),
        with(&kind("sfy"), json!({ "yRef": -50, "rate": -0.5 })),
        with(&kind("lcc"), json!({ "areaRatio": 0 })),
        with(&kind("lcc"), json!({ "areaRatio": 1 })),
        with(
            &kind("lcc"),
            json!({ "columnCohesion": 0, "columnFrictionAngle": 0 }),
        ),
        with(
            &kind("lcc"),
            json!({ "columnCohesion": 5, "columnFrictionAngle": 89.9 }),
        ),
        with(&kind("lcc"), json!({ "suRateOfChange": -1, "suMax": 14 })),
    ];
    for model in accepted {
        assert_eq!(errs(model.clone()), Vec::<String>::new(), "{model}");
    }
}

#[test]
fn every_error_reported_and_cutoff_alone() {
    assert_eq!(
        errs(with(
            &kind("mc"),
            json!({ "unitWeight": -1, "cohesion": -1, "frictionAngle": 95, "cFactor": -2 })
        ))
        .len(),
        4
    );
    assert_eq!(
        errs(with(
            &kind("su"),
            json!({ "suMax": -40, "suRateOfChange": -1 })
        )),
        vec!["The strength cutoff must be a positive number.".to_string()]
    );
}

// ── anisotropy-undrained.test.ts (the strength and validation cases) ──

fn actx(alpha_deg: f64) -> StrengthContext {
    ctx(-2.0, 0.0, 0.0, deg(alpha_deg))
}

const FN: &str = "[[-45, 0.82], [0, 1], [60, 1.5]]";

fn fnv() -> Value {
    serde_json::from_str(FN).unwrap()
}

#[test]
fn anisotropy_multiplies_su() {
    let u = m(
        json!({ "kind": "undrained", "unitWeight": 17, "undrainedShearStrength": 20, "anisotropy": fnv() }),
    );
    close_to(rs(&u, actx(0.0)).cohesion, 20.0, 10);
    close_to(rs(&u, actx(60.0)).cohesion, 30.0, 10);
    close_to(rs(&u, actx(80.0)).cohesion, 30.0, 10);
    close_to(rs(&u, actx(30.0)).cohesion, 25.0, 10);
    close_to(rs(&u, actx(-45.0)).cohesion, 16.4, 10);
    let r = rs(&u, actx(-90.0));
    close_to(r.cohesion_undrained, 16.4, 10);
    assert_eq!(r.friction_angle, 0.0);

    let datum = m(
        json!({ "kind": "s-f-datum", "unitWeight": 17, "suRef": 10, "yRef": 0, "rate": 2, "suMax": 13, "anisotropy": fnv() }),
    );
    close_to(rs(&datum, actx(60.0)).cohesion, 19.5, 10);
    let depth = m(
        json!({ "kind": "s-f-depth", "unitWeight": 17, "suRef": 10, "depthRef": 0, "rate": 2, "anisotropy": fnv() }),
    );
    close_to(rs(&depth, actx(-45.0)).cohesion, 14.0 * 0.82, 10);

    let plain = json!({ "kind": "s-f-datum", "unitWeight": 17, "suRef": 10, "yRef": 0, "rate": 2 });
    close_to(rs(&m(plain.clone()), actx(60.0)).cohesion, 14.0, 10);
    close_to(
        rs(&m(with(&plain, json!({ "anisotropy": [] }))), actx(60.0)).cohesion,
        14.0,
        10,
    );
    assert!(errs(with(&plain, json!({ "anisotropy": [] }))).is_empty());
    assert_eq!(
        rs(
            &m(with(&plain, json!({ "anisotropy": [[0, 1], [60, -1]] }))),
            actx(60.0)
        )
        .cohesion,
        0.0
    );

    let base = json!({ "kind": "undrained", "unitWeight": 17, "undrainedShearStrength": 20 });
    assert!(errs(with(&base, json!({ "anisotropy": fnv() }))).is_empty());
    assert!(errs(with(&base, json!({ "anisotropy": [[0, 1]] })))
        .join(",")
        .contains("at least 2"));
    assert!(
        errs(with(&base, json!({ "anisotropy": [[0, 1], [45, -1]] })))
            .join(",")
            .contains("factor must be ≥ 0")
    );
    assert!(
        errs(with(&base, json!({ "anisotropy": [[0, 1], ["NaN", 1]] })))
            .join(",")
            .contains("finite")
    );
}

// ── hoek-brown.test.ts (the criterion and validation cases) ────

#[test]
fn hoek_brown_parameters_of_hoek_2002() {
    let p = hoek_brown_parameters(50000.0, 100.0, 12.0, 0.0);
    close_to(p.mb, 12.0, 12);
    close_to(p.s, 1.0, 12);
    close_to(p.a, 0.5, 12);
    let q = hoek_brown_parameters(50000.0, 25.0, 12.0, 0.5);
    close_to(q.mb, 12.0 * exp(-75.0 / 21.0), 12);
    close_to(q.s, exp(-75.0 / 7.5), 12);
    close_to(q.a, 0.5 + (exp(-25.0 / 15.0) - exp(-20.0 / 3.0)) / 6.0, 12);
}

#[test]
fn hoek_brown_tangent_to_the_mohr_circle() {
    let p = hoek_brown_parameters(20000.0, 40.0, 15.0, 0.3);
    for s3 in [0.0, 50.0, 300.0, 2000.0] {
        let base = (p.mb * s3) / p.ucs + p.s;
        let s1 = s3 + p.ucs * pow(base, p.a);
        let CohesionFriction {
            cohesion: c,
            friction_angle,
        } = instantaneous_at_sigma3(&p, s3);
        let phi = deg(friction_angle);
        let (centre, radius) = ((s1 + s3) / 2.0, (s1 - s3) / 2.0);
        close_to(
            (c + centre * tan(phi)) * cslope_engine::js::math::cos(phi),
            radius,
            6,
        );
        let sn = centre - radius * cslope_engine::js::math::sin(phi);
        let back = instantaneous_at_normal_stress(&p, sn);
        close_to(back.friction_angle, friction_angle, 6);
        close_to(back.cohesion, c, 4);
    }
    assert!(
        instantaneous_at_normal_stress(&p, 50.0).friction_angle
            > instantaneous_at_normal_stress(&p, 1000.0).friction_angle
    );
}

#[test]
fn hoek_brown_parameters_given_directly() {
    let hb = |extra: Value| {
        let MaterialModel::HoekBrown(m) = m(with(
            &json!({ "kind": "hoek-brown", "unitWeight": 20, "ucs": 20000, "gsi": 20, "mi": 10, "disturbance": 1 }),
            extra,
        )) else {
            panic!()
        };
        m
    };
    assert_eq!(
        hoek_brown_of(&hb(json!({}))),
        hoek_brown_parameters(20000.0, 20.0, 10.0, 1.0)
    );
    assert_eq!(
        hoek_brown_of(&hb(json!({ "mb": 0.045, "s": 1e-6 }))),
        HoekBrownParameters {
            ucs: 20000.0,
            mb: 0.045,
            s: 1e-6,
            a: 0.5
        }
    );
    let i = instantaneous_at_normal_stress(
        &hoek_brown_of(&hb(json!({ "mb": 0.045, "s": 1e-6, "a": 0.5 }))),
        44.6,
    );
    close_to(i.cohesion + 44.6 * tand(i.friction_angle), 52.28, 1);

    let mj = json!({ "kind": "hoek-brown", "unitWeight": 20, "ucs": 20000, "gsi": 100, "mi": 1 });
    assert!(errs(with(&mj, json!({ "mb": 0.045, "s": 1e-6 }))).is_empty());
    let e = errs(with(&mj, json!({ "mb": -1, "s": 2 }))).join(" ");
    assert!(
        e.contains("mb must be > 0")
            && e.contains("s must be between 0 and 1")
            && e.find("mb") < e.find("s must")
    );
}

// ── shansep.test.ts (SHANSEP Su and the shear-normal function) ──

#[test]
fn shansep_strength() {
    let sh = |extra: Value| {
        let MaterialModel::Shansep(s) = m(with(
            &json!({ "kind": "shansep", "unitWeight": 18, "ratio": 0.25 }),
            extra,
        )) else {
            panic!()
        };
        s
    };
    let at = |s: &ShansepModel, sv: f64, y: f64| shansep_su(s, y, 10.0, Some(sv));
    close_to(
        at(&sh(json!({ "ocr": 4, "exponent": 0.8 })), 100.0, 0.0),
        100.0 * 0.25 * pow(4.0, 0.8),
        12,
    );
    close_to(at(&sh(json!({})), 100.0, 0.0), 25.0, 12);
    let by_y = sh(json!({ "exponent": 1, "ocrByElevation": [[0, 1], [10, 3]] }));
    close_to(at(&by_y, 100.0, 5.0), 100.0 * 0.25 * 2.0, 12);
    close_to(at(&by_y, 100.0, -5.0), 25.0, 12);
    close_to(
        at(
            &sh(json!({ "suByStress": [[0, 10], [100, 30]] })),
            50.0,
            0.0,
        ),
        20.0,
        12,
    );
    assert_eq!(at(&sh(json!({ "suMin": 8 })), 10.0, 0.0), 8.0);
    close_to(
        shansep_su(&sh(json!({})), 6.0, 10.0, None),
        4.0 * 18.0 * 0.25,
        12,
    );
}

#[test]
fn shear_normal_tangent() {
    let pts = [[0.0, 0.0], [10.0, 10.0], [30.0, 25.0], [100.0, 45.0]];
    let a = shear_normal_at(&pts, None, 20.0);
    close_to(tand(a.friction_angle), 0.75, 12);
    close_to(a.cohesion, 2.5, 12);
    let b = shear_normal_at(&pts, None, 200.0);
    close_to(
        b.cohesion + 200.0 * tand(b.friction_angle),
        45.0 + 100.0 * (20.0 / 70.0),
        9,
    );
    let s = shear_normal_at(&pts, Some(&TableSpline::default()), 30.0);
    close_to(s.cohesion + 30.0 * tand(s.friction_angle), 25.0, 9);

    let tau = |pts: &[[f64; 2]], sn: f64, spline: bool| {
        let t = shear_normal_at(pts, spline.then_some(&TableSpline::default()), sn);
        t.cohesion + sn * tand(t.friction_angle)
    };
    let convex = [[0.0, 0.0], [50.0, 10.0], [100.0, 60.0]];
    close_to(tau(&convex, 100.0, false), 60.0, 9);
    close_to(tau(&convex, 75.0, false), 35.0, 9);
    let falling = [[0.0, 0.0], [100.0, 60.0], [200.0, 50.0]];
    close_to(tau(&falling, 150.0, false), 55.0, 9);
}
