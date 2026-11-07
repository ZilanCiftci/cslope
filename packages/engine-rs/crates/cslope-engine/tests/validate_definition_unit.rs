//! Strict validation (types/validate_definition.rs, issue #55): the
//! verification definitions and the Python examples pass, and each case
//! the engine would analyse silently wrong is reported with its path and
//! code.
#![allow(clippy::disallowed_methods)]

use cslope_engine::model::geometry_ops::polygonize_regions;
use cslope_engine::types::validate_definition::{validate, Issue, Severity};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn golden() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../golden/verification.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("golden")).expect("json")
}

fn errors(issues: &[Issue]) -> Vec<&Issue> {
    issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect()
}

#[test]
fn verification_definitions_have_no_errors() {
    let g = golden();
    let cases = g["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 187);
    let mut warnings: BTreeMap<String, usize> = BTreeMap::new();
    let mut bad = Vec::new();
    for c in cases {
        let id = c["id"].as_str().unwrap();
        for check in c["checks"].as_array().unwrap() {
            let issues = validate(&c["definition"], check.get("options"));
            for i in errors(&issues) {
                bad.push(format!("{id}: {} {} {}", i.path, i.code, i.message));
            }
        }
        for i in validate(&c["definition"], None) {
            if i.severity == Severity::Warning {
                *warnings.entry(i.code.clone()).or_default() += 1;
            }
        }
    }
    bad.dedup();
    println!("warnings by code over the 187 definitions: {warnings:?}");
    assert!(bad.is_empty(), "{} errors:\n{}", bad.len(), bad.join("\n"));
}

/// A clay under a crust with a phreatic line and a strip load (as
/// cslope.examples.clay_crust_with_load, with water): valid as it is.
fn base() -> Value {
    json!({
        "coordinates": [[0.0, -12.0], [0.0, 0.0], [8.0, 0.0], [20.0, -4.0], [34.0, -4.0], [34.0, -12.0]],
        "materials": [
            {"name": "Crust", "model": {"kind": "mohr-coulomb", "unitWeight": 18.0, "cohesion": 5.0, "frictionAngle": 30.0}},
            {"name": "Clay", "model": {"kind": "undrained", "unitWeight": 16.5, "unitWeightSat": 17.0, "undrainedShearStrength": 18.0}}
        ],
        "materialBoundaries": [{"coordinates": [[-0.05, -1.5], [12.55, -1.5]]}],
        "regionAssignments": [
            {"point": [3.0, -0.5], "materialName": "Crust"},
            {"point": [15.0, -8.0], "materialName": "Clay"}
        ],
        "waterTable": {"mode": "custom", "value": [[0.0, -3.0], [34.0, -3.0]], "freeWater": false},
        "udls": [{"magnitude": 20.0, "x1": 4.0, "x2": 8.0}],
        "lineLoads": [{"magnitude": 10.0, "x": 2.0}],
        "analysisLimits": {"entryLeftX": 0.0, "entryRightX": 10.0, "exitLeftX": 15.0, "exitRightX": 30.0}
    })
}

fn has(issues: &[Issue], path: &str, code: &str) -> bool {
    issues.iter().any(|i| i.path == path && i.code == code)
}

fn show(issues: &[Issue]) -> String {
    issues
        .iter()
        .map(|i| format!("{:?} {} {} {}", i.severity, i.path, i.code, i.message))
        .collect::<Vec<_>>()
        .join("\n")
}

#[track_caller]
fn assert_issue(def: &Value, path: &str, code: &str, severity: Severity) {
    let issues = validate(def, None);
    let found = issues
        .iter()
        .find(|i| i.path == path && i.code == code)
        .unwrap_or_else(|| panic!("no {code} at {path}:\n{}", show(&issues)));
    assert_eq!(found.severity, severity, "{}", show(&issues));
}

#[test]
fn the_base_model_is_valid() {
    let issues = validate(&base(), None);
    assert!(issues.is_empty(), "{}", show(&issues));
    let issues = validate(&base(), Some(&json!({"method": "Bishop", "slices": 30})));
    assert!(issues.is_empty(), "{}", show(&issues));
}

/// The two definitions of issue #93: a boundary ending past or exactly on
/// the outline split the regions it should (each assignment in a region of
/// its own).
#[test]
fn boundaries_ending_past_or_exactly_on_the_outline_split_the_regions() {
    let undrained = |name: &str, su: f64| json!({"name": name, "model": {"kind": "undrained", "unitWeight": 17.0, "unitWeightSat": 17.0, "undrainedShearStrength": su}});
    // (a) a 5 cm layer between two boundaries 0.5 m past both edges
    let thin = json!({
        "orientation": "ltr",
        "coordinates": [[0.0, 0.0], [0.0, 20.0], [40.0, 20.0], [60.0, 10.0], [100.0, 10.0], [100.0, 0.0]],
        "materials": [undrained("Top", 30.0), undrained("Thin", 1.0), undrained("Bottom", 30.0)],
        "materialBoundaries": [
            {"coordinates": [[-0.5, 5.05], [100.5, 5.05]]},
            {"coordinates": [[-0.5, 5.0], [100.5, 5.0]]}
        ],
        "regionAssignments": [
            {"point": [5.0, 15.0], "materialName": "Top"},
            {"point": [5.0, 5.025], "materialName": "Thin"},
            {"point": [5.0, 2.0], "materialName": "Bottom"}
        ]
    });
    // (b) a level ending on the face 1:3.2, at x = 3.2 · (10 − 8.2)
    let face = json!({
        "orientation": "ltr",
        "coordinates": [[-6.0, 4.0], [-6.0, 10.0], [0.0, 10.0], [6.4, 8.0], [12.4, 8.0], [12.4, 4.0]],
        "materials": [undrained("Upper", 30.0), undrained("Lower", 10.0)],
        "materialBoundaries": [{"coordinates": [[-6.1, 8.2], [5.7600000000000025, 8.2]]}],
        "regionAssignments": [
            {"point": [-5.0, 9.0], "materialName": "Upper"},
            {"point": [-5.0, 6.0], "materialName": "Lower"}
        ]
    });
    for (def, regions) in [(thin, 3), (face, 2)] {
        let issues = validate(&def, None);
        assert!(errors(&issues).is_empty(), "{}", show(&issues));
        let pts: Vec<[f64; 2]> = serde_json::from_value(def["coordinates"].clone()).unwrap();
        let lines: Vec<Vec<[f64; 2]>> = def["materialBoundaries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| serde_json::from_value(b["coordinates"].clone()).unwrap())
            .collect();
        let px: Vec<f64> = pts.iter().map(|p| p[0]).collect();
        let py: Vec<f64> = pts.iter().map(|p| p[1]).collect();
        let faces = polygonize_regions(&px, &py, &lines).unwrap();
        assert_eq!(faces.len(), regions);
    }
}

#[test]
fn no_region_assignments() {
    let mut d = base();
    d.as_object_mut().unwrap().remove("regionAssignments");
    assert_issue(
        &d,
        "/regionAssignments",
        "missing-region-assignments",
        Severity::Error,
    );
}

#[test]
fn a_region_without_an_assignment_and_two_in_one() {
    let mut d = base();
    d["regionAssignments"] = json!([
        {"point": [3.0, -0.5], "materialName": "Crust"},
        {"point": [4.0, -0.5], "materialName": "Clay"}
    ]);
    assert_issue(
        &d,
        "/regionAssignments",
        "unassigned-region",
        Severity::Error,
    );
    assert_issue(
        &d,
        "/regionAssignments/1",
        "duplicate-region-assignment",
        Severity::Error,
    );
    d["regionAssignments"][1] = json!({"point": [15.0, -8.0], "materialName": "Sand"});
    assert_issue(
        &d,
        "/regionAssignments/1/materialName",
        "unknown-material",
        Severity::Error,
    );
    d["regionAssignments"][1] = json!({"point": [50.0, -8.0], "materialName": "Clay"});
    assert_issue(
        &d,
        "/regionAssignments/1/point",
        "assignment-outside-model",
        Severity::Error,
    );
}

#[test]
fn a_legacy_boundary_material_name() {
    let mut d = base();
    d.as_object_mut().unwrap().remove("regionAssignments");
    d["materialBoundaries"][0]["materialName"] = json!("Clay");
    assert_issue(
        &d,
        "/materialBoundaries/0/materialName",
        "legacy-region-assignment",
        Severity::Error,
    );
    // with assignments it is ignored: a warning
    let mut d = base();
    d["materialBoundaries"][0]["materialName"] = json!("Clay");
    assert_issue(
        &d,
        "/materialBoundaries/0/materialName",
        "deprecated",
        Severity::Warning,
    );
    // "" (what the app writes) is fine
    let mut d = base();
    d["materialBoundaries"][0]["materialName"] = json!("");
    assert!(validate(&d, None).is_empty());
}

#[test]
fn follow_boundary_true_means_no_free_water() {
    let mut d = base();
    d["waterTable"] =
        json!({"mode": "custom", "value": [[0.0, -3.0], [34.0, -3.0]], "followBoundary": true});
    assert_issue(
        &d,
        "/waterTable/followBoundary",
        "follow-boundary-inverted",
        Severity::Warning,
    );
    d["waterTable"]["freeWater"] = json!(true);
    assert_issue(
        &d,
        "/waterTable/freeWater",
        "conflicting-free-water",
        Severity::Error,
    );
    // what the app writes for free water: no issue
    d["waterTable"] =
        json!({"mode": "custom", "value": [[0.0, -3.0], [34.0, -3.0]], "followBoundary": false});
    assert!(
        validate(&d, None).is_empty(),
        "{}",
        show(&validate(&d, None))
    );
}

#[test]
fn no_saturated_unit_weight_below_the_water() {
    let mut d = base();
    d["materials"][1]["model"]
        .as_object_mut()
        .unwrap()
        .remove("unitWeightSat");
    assert_issue(
        &d,
        "/materials/1/model/unitWeightSat",
        "missing-unit-weight-sat",
        Severity::Warning,
    );
    // the crust is above the water: nothing for it
    assert!(!has(
        &validate(&d, None),
        "/materials/0/model/unitWeightSat",
        "missing-unit-weight-sat"
    ));
}

#[test]
fn an_interior_boundary_that_stops_short() {
    let mut d = base();
    d["materialBoundaries"][0]["coordinates"] = json!([[-0.05, -1.5], [10.0, -1.5]]);
    assert_issue(
        &d,
        "/materialBoundaries/0",
        "dangling-boundary",
        Severity::Error,
    );
}

#[test]
fn loads_limits_and_water_outside_the_model() {
    let mut d = base();
    d["udls"][0] = json!({"magnitude": 20.0, "x1": 40.0, "x2": 45.0});
    assert_issue(&d, "/udls/0", "outside-model", Severity::Error);
    d["udls"][0] = json!({"magnitude": 20.0, "x1": 30.0, "x2": 45.0});
    assert_issue(&d, "/udls/0/x2", "outside-model", Severity::Warning);
    d["lineLoads"][0]["x"] = json!(-5.0);
    assert_issue(&d, "/lineLoads/0/x", "outside-model", Severity::Error);
    d["analysisLimits"]["exitRightX"] = json!(60.0);
    assert_issue(
        &d,
        "/analysisLimits/exitRightX",
        "outside-model",
        Severity::Warning,
    );
    d["waterTable"]["value"] = json!([[-10.0, -3.0], [20.0, -3.0]]);
    assert_issue(
        &d,
        "/waterTable/value/0",
        "outside-model",
        Severity::Warning,
    );
    assert_issue(
        &d,
        "/waterTable/value",
        "water-line-short",
        Severity::Warning,
    );
}

#[test]
fn unknown_keys_and_types_have_their_paths() {
    let mut d = base();
    let m = d["materials"][1]["model"].as_object_mut().unwrap();
    m.remove("undrainedShearStrength");
    m.insert("su".into(), json!(18.0));
    let issues = validate(&d, None);
    assert!(
        has(&issues, "/materials/1/model/su", "unknown-key"),
        "{}",
        show(&issues)
    );
    assert!(
        has(
            &issues,
            "/materials/1/model/undrainedShearStrength",
            "missing-key"
        ),
        "{}",
        show(&issues)
    );

    let mut d = base();
    d["materials"][0]["model"]["cohesion"] = json!("5");
    d["regionAssignments"][0]["material"] = json!("Crust");
    d["materials"][1]["model"]["kind"] = json!("undrianed");
    let issues = validate(
        &d,
        Some(&json!({"slices": 25.5, "method": "bishop", "searchMethod": "grid"})),
    );
    for (path, code) in [
        ("/materials/0/model/cohesion", "type"),
        ("/regionAssignments/0/material", "unknown-key"),
        ("/materials/1/model/kind", "enum"),
        ("/options/slices", "type"),
        ("/options/method", "enum"),
        ("/options/searchMethod", "enum"),
    ] {
        assert!(
            has(&issues, path, code),
            "{code} at {path}:\n{}",
            show(&issues)
        );
    }
    // a top-level key the engine does not know
    let mut d = base();
    d["regionAssigments"] = json!([]);
    assert_issue(&d, "/regionAssigments", "unknown-key", Severity::Error);
    let msg = validate(&d, None)
        .into_iter()
        .find(|i| i.code == "unknown-key")
        .unwrap()
        .message;
    assert!(msg.contains("regionAssignments"), "{msg}");
}

#[test]
fn a_document_has_paths_under_definition_and_options() {
    let doc = json!({
        "format": "cslope-analysis",
        "formatVersion": 1,
        "definition": base(),
        "options": {"method": "Morgenstern-Price", "slices": 30}
    });
    assert!(
        validate(&doc, None).is_empty(),
        "{}",
        show(&validate(&doc, None))
    );
    let mut bad = doc.clone();
    bad["definition"]["materials"][0]["model"]["frictionAngel"] = json!(30);
    bad["options"]["slices"] = json!("30");
    bad["formatVersion"] = json!(2);
    let issues = validate(&bad, None);
    for (path, code) in [
        ("/definition/materials/0/model/frictionAngel", "unknown-key"),
        ("/options/slices", "type"),
        ("/formatVersion", "range"),
    ] {
        assert!(
            has(&issues, path, code),
            "{code} at {path}:\n{}",
            show(&issues)
        );
    }
    // options given apart replace the document's
    let issues = validate(&doc, Some(&json!({"slices": 1.5})));
    assert!(has(&issues, "/options/slices", "type"), "{}", show(&issues));
}

#[test]
fn engine_errors_are_reported() {
    let d = base();
    let issues = validate(&d, Some(&json!({"tolerance": 0})));
    assert!(
        issues.iter().any(|i| i.code == "engine-error"),
        "{}",
        show(&issues)
    );
    // a count outside its range, which the engine would clamp
    let issues = validate(&d, Some(&json!({"slices": 1, "iterations": 100})));
    assert!(
        has(&issues, "/options/slices", "range"),
        "{}",
        show(&issues)
    );
    assert!(
        has(&issues, "/options/iterations", "range"),
        "{}",
        show(&issues)
    );
    let mut d = base();
    d["materials"][1]["model"]["undrainedShearStrength"] = json!(-1.0);
    assert_issue(
        &d,
        "/materials/1/model",
        "invalid-material-model",
        Severity::Error,
    );
    let mut d = base();
    d["materials"][1]["name"] = json!("Crust");
    assert_issue(
        &d,
        "/materials/1/name",
        "duplicate-material-name",
        Severity::Error,
    );
}

#[test]
fn the_built_in_schema_is_the_generated_one() {
    // (tools/schema.ts writes the files; its --check in CI covers every
    // schema and the Python stubs)
    let generated = cslope_engine::types::schema::generate();
    assert_eq!(
        Some(cslope_engine::types::schema::document_schema()),
        generated
            .get("analysis-document")
            .map(cslope_engine::types::schema::without_descriptions)
            .as_ref(),
        "packages/engine/schema/analysis-document.json is stale: run `bun packages/engine-rs/tools/schema.ts`"
    );
}

#[test]
fn a_water_table_without_a_mode_is_reported() {
    let mut d = base();
    d["waterTable"] = json!({"value": [[0.0, 10.0], [34.0, 4.0]]});
    assert_issue(&d, "/waterTable/mode", "missing-key", Severity::Error);
    assert_issue(
        &d,
        "/waterTable/mode",
        "water-table-ignored",
        Severity::Error,
    );
    d["waterTable"]["mode"] = json!("phreatic");
    assert_issue(
        &d,
        "/waterTable/mode",
        "water-table-ignored",
        Severity::Error,
    );
    d["waterTable"] = json!({"mode": "custom"});
    assert_issue(&d, "/waterTable/value", "missing-key", Severity::Error);
}

#[test]
fn a_water_line_drawn_right_to_left_reads_as_left_to_right() {
    // the line rises to the left, above the crust's bottom at x = 0
    let mut forward = base();
    forward["waterTable"]["value"] = json!([[0.0, -1.0], [34.0, -3.0]]);
    let mut reversed = base();
    reversed["waterTable"]["value"] = json!([[34.0, -3.0], [0.0, -1.0]]);
    for d in [&forward, &reversed] {
        assert_issue(
            d,
            "/materials/0/model/unitWeightSat",
            "missing-unit-weight-sat",
            Severity::Warning,
        );
    }
    let codes = |d: &Value| {
        validate(d, None)
            .into_iter()
            .map(|i| (i.path, i.code))
            .collect::<Vec<_>>()
    };
    assert_eq!(codes(&forward), codes(&reversed));
}

#[test]
fn further_water_lines_take_the_main_lines_free_water() {
    use cslope_engine::types::{WaterTableDefinition, WaterTableEntry};
    let entry: WaterTableEntry =
        serde_json::from_value(json!({"id": "a", "coordinates": [[0, 1], [10, 1]]})).unwrap();
    assert!(entry.follows_boundary(None)); // clipped, as before
    assert!(!entry.follows_boundary(Some(true))); // free water, as the main line
    assert!(entry.follows_boundary(Some(false)));
    let own: WaterTableEntry = serde_json::from_value(
        json!({"id": "a", "coordinates": [[0, 1], [10, 1]], "followBoundary": true}),
    )
    .unwrap();
    assert!(own.follows_boundary(Some(true))); // its own setting wins (what the app writes)
    let main: WaterTableDefinition =
        serde_json::from_value(json!({"mode": "height", "value": 1, "freeWater": true})).unwrap();
    assert_eq!(main.follows_boundary(), Some(false));
}
