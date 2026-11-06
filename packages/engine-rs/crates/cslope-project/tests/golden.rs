//! The conversion against the app's own (golden/project-corpus.json, made
//! with packages/desktop/scripts/project-corpus.ts by the app's code): every
//! model and definition field for field. A change to the app's conversion
//! without its counterpart here, or the reverse, fails this test; make both
//! and regenerate the corpus.
//!
//! The verification entries are digests (src/digest.rs). To see where one
//! differs, write the corpus in full and point this test at it:
//!
//!   bun packages/desktop/scripts/project-corpus.ts --full /tmp/corpus.json
//!   CSLOPE_PROJECT_CORPUS=/tmp/corpus.json cargo test -p cslope-project --release

use cslope_engine::types::SlopeDefinition;
use cslope_project::convert::engine_boundary_order;
use cslope_project::digest::digest;
use cslope_project::model::{MaterialBoundaryRow, MATERIAL_COLORS, PIEZO_COLORS};
use cslope_project::{
    app_default_options, definition_to_model, model_to_definition, normalize_for_run,
    DefinitionModelInfo, ModelEntry,
};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../golden")
}

fn corpus() -> &'static Value {
    static CORPUS: OnceLock<Value> = OnceLock::new();
    CORPUS.get_or_init(|| {
        let path = std::env::var_os("CSLOPE_PROJECT_CORPUS")
            .map(PathBuf::from)
            .unwrap_or_else(|| golden_dir().join("project-corpus.json"));
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        serde_json::from_str(&text).expect("the corpus is JSON")
    })
}

/// The verification problems' definitions by id (golden/verification.json).
fn verification_definitions() -> HashMap<String, Value> {
    let text = std::fs::read_to_string(golden_dir().join("verification.json"))
        .expect("golden/verification.json");
    let v: Value = serde_json::from_str(&text).expect("JSON");
    v["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .map(|c| {
            (
                c["id"].as_str().unwrap().to_owned(),
                c["definition"].clone(),
            )
        })
        .collect()
}

/// The first place where two JSON values differ (numbers as f64, -0 = 0),
/// or None.
fn diff(path: &str, a: &Value, b: &Value) -> Option<String> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            (x != y).then(|| format!("{path}: {x} (Rust) != {y} (app)"))
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!(
                    "{path}: {} items (Rust) != {} (app)",
                    x.len(),
                    y.len()
                ));
            }
            x.iter()
                .zip(y)
                .enumerate()
                .find_map(|(i, (p, q))| diff(&format!("{path}[{i}]"), p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys() {
                if !y.contains_key(k) {
                    return Some(format!("{path}.{k}: only in Rust ({})", x[k]));
                }
            }
            for k in y.keys() {
                if !x.contains_key(k) {
                    return Some(format!("{path}.{k}: only in the app ({})", y[k]));
                }
            }
            x.keys()
                .find_map(|k| diff(&format!("{path}.{k}"), &x[k], &y[k]))
        }
        _ => (a != b).then(|| format!("{path}: {a} (Rust) != {b} (app)")),
    }
}

fn assert_same(what: &str, rust: &Value, app: &Value) {
    if let Some(d) = diff("", rust, app) {
        panic!("{what}: {d}");
    }
}

fn definition(v: &Value) -> SlopeDefinition {
    serde_json::from_value(v.clone()).expect("a definition")
}

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

fn info(v: &Value) -> DefinitionModelInfo {
    DefinitionModelInfo {
        id: v["id"].as_str().unwrap().to_owned(),
        name: v["name"].as_str().unwrap().to_owned(),
        options: v.get("options").and_then(Value::as_object).cloned(),
    }
}

#[test]
fn constants_are_the_apps() {
    let c = corpus();
    assert_same(
        "APP_DEFAULT_ANALYSIS_OPTIONS",
        &Value::Object(app_default_options()),
        &c["appDefaultOptions"],
    );
    assert_eq!(
        to_json(&MATERIAL_COLORS),
        c["materialColors"],
        "MATERIAL_COLORS"
    );
    assert_eq!(to_json(&PIEZO_COLORS), c["piezoColors"], "PIEZO_COLORS");
}

#[test]
fn boundaries_sort_as_the_app_sorts_its_ids() {
    // The app sorts with localeCompare, this crate by bytes: the same order
    // for the forms of id the app writes.
    let app: Vec<String> = serde_json::from_value(corpus()["boundaryOrder"].clone()).unwrap();
    let mut rows: Vec<MaterialBoundaryRow> = app
        .iter()
        .rev()
        .map(|id| MaterialBoundaryRow {
            id: id.clone(),
            coordinates: vec![[0.0, 0.0], [1.0, 1.0]],
            extra: Map::new(),
        })
        .collect();
    rows.rotate_left(3);
    let ours: Vec<&str> = engine_boundary_order(&rows)
        .iter()
        .map(|b| b.id.as_str())
        .collect();
    assert_eq!(ours, app);
}

#[test]
fn models_give_the_apps_definition() {
    let models = corpus()["models"].as_array().unwrap();
    assert!(models.len() >= 10);
    for m in models {
        let name = m["name"].as_str().unwrap();
        let model =
            ModelEntry::from_json(m["model"].clone()).unwrap_or_else(|e| panic!("{name}: {e}"));
        // Read and written again, the model loses nothing.
        assert_same(
            &format!("{name}: the model read and written"),
            &model.to_json(),
            &m["model"],
        );
        assert_same(
            &format!("{name}: the definition"),
            &to_json(&model_to_definition(&model)),
            &m["definition"],
        );
    }
}

#[test]
fn verification_problems_open_as_in_the_app() {
    let defs = verification_definitions();
    let entries = corpus()["verification"].as_array().unwrap();
    assert_eq!(
        entries.len(),
        defs.len(),
        "the corpus and golden/verification.json have other problems: regenerate the corpus"
    );
    for e in entries {
        let id = e["case"].as_str().unwrap();
        let input = &defs[id];
        assert_eq!(
            digest(input),
            e["inputDigest"].as_str().unwrap(),
            "{id}: the problem in golden/verification.json is not the one the corpus was made from: regenerate the corpus (packages/desktop/scripts/project-corpus.ts)"
        );
        let model = definition_to_model(&definition(input), &info(&e["info"]))
            .unwrap_or_else(|err| panic!("{id}: {err}"));
        let model_json = model.to_json();
        let def_json = to_json(&model_to_definition(&model));
        if let Some(expected) = e.get("model") {
            assert_same(&format!("{id}: the model"), &model_json, expected);
            assert_same(
                &format!("{id}: its definition"),
                &def_json,
                &e["definition"],
            );
        } else {
            let full = "differs from the app's; run the test on the full corpus (see the top of this file) to see where";
            assert_eq!(
                digest(&model_json),
                e["modelDigest"].as_str().unwrap(),
                "{id}: the model {full}"
            );
            assert_eq!(
                digest(&def_json),
                e["definitionDigest"].as_str().unwrap(),
                "{id}: the definition {full}"
            );
        }
    }
}

#[test]
fn definitions_give_the_apps_model() {
    for d in corpus()["definitions"].as_array().unwrap() {
        let name = d["name"].as_str().unwrap();
        let model = definition_to_model(&definition(&d["definition"]), &info(&d["info"]))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_same(&format!("{name}: the model"), &model.to_json(), &d["model"]);
        assert_same(
            &format!("{name}: its definition"),
            &to_json(&model_to_definition(&model)),
            &d["roundTrip"],
        );
    }
}

#[test]
fn saved_models_run_as_the_app_opens_them() {
    // The app's load (parseProjectData) fills, clamps and drops fields of a
    // saved model; normalize_for_run does the same for what the analysis
    // takes: the definition and the options.
    let saved = corpus()["saved"].as_array().unwrap();
    assert!(saved.len() >= 5);
    for s in saved {
        let name = s["name"].as_str().unwrap();
        let model = normalize_for_run(&s["raw"]).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_same(
            &format!("{name}: the definition"),
            &to_json(&model_to_definition(&model)),
            &s["definition"],
        );
        assert_same(
            &format!("{name}: the options"),
            &Value::Object(model.options.clone().unwrap()),
            &s["options"],
        );
    }
}

/// The codes of the region rules the export's assignments must satisfy.
const REGION_CODES: [&str; 3] = [
    "unassigned-region",
    "missing-region-assignments",
    "duplicate-region-assignment",
];

fn region_errors(def: &SlopeDefinition) -> Vec<String> {
    let issues = cslope_engine::types::validate_definition::validate(&to_json(def), None);
    to_json(&issues)
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| {
            i["severity"] == "error" && REGION_CODES.contains(&i["code"].as_str().unwrap_or(""))
        })
        .map(|i| i["message"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn every_region_gets_an_explicit_assignment_for_export() {
    // the corpus's models (examples, synthetic, saved) and the verification
    // problems as the app opens them
    let c = corpus();
    let mut defs: Vec<(String, SlopeDefinition)> = Vec::new();
    for m in c["models"].as_array().unwrap() {
        defs.push((
            m["name"].as_str().unwrap().into(),
            definition(&m["definition"]),
        ));
    }
    for s in c["saved"].as_array().unwrap() {
        defs.push((
            s["name"].as_str().unwrap().into(),
            definition(&s["definition"]),
        ));
    }
    let vd = verification_definitions();
    for e in c["verification"].as_array().unwrap() {
        let id = e["case"].as_str().unwrap();
        let model = definition_to_model(&definition(&vd[id]), &info(&e["info"])).unwrap();
        defs.push((id.into(), model_to_definition(&model)));
    }
    let mut changed = 0;
    for (name, def) in defs {
        let before = region_errors(&def);
        let mut out = def.clone();
        let n = cslope_project::assign_unassigned_regions(&mut out);
        changed += usize::from(n > 0);
        assert_eq!(
            region_errors(&out),
            Vec::<String>::new(),
            "{name} (before: {before:?})"
        );
        if before.is_empty() {
            assert_eq!(
                n, 0,
                "{name}: assignments added to a definition without region errors"
            );
        }
        // the assignments of the model stay first, unchanged
        let had = def.region_assignments.clone().unwrap_or_default();
        assert_eq!(
            out.region_assignments.unwrap_or_default()[..had.len()],
            had[..],
            "{name}"
        );
    }
    assert!(
        changed >= 2,
        "the corpus has models with regions left to the first material ({changed})"
    );
}

#[test]
fn a_hand_written_definition_with_an_unassigned_region_stays_an_error() {
    let def: SlopeDefinition = serde_json::from_value(serde_json::json!({
        "coordinates": [[0, 0], [0, 10], [20, 10], [40, 0]],
        "materials": [{ "name": "A", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30 } },
                      { "name": "B", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30 } }],
        "materialBoundaries": [{ "coordinates": [[0, 5], [30, 5]] }],
        "regionAssignments": [{ "point": [5, 7], "materialName": "B" }]
    }))
    .unwrap();
    assert_eq!(region_errors(&def).len(), 1);
}

#[test]
fn definitions_the_app_refuses_are_refused() {
    for r in corpus()["refused"].as_array().unwrap() {
        let name = r["name"].as_str().unwrap();
        let got = definition_to_model(
            &definition(&r["definition"]),
            &DefinitionModelInfo {
                id: "x".into(),
                name: "x".into(),
                options: None,
            },
        );
        assert_eq!(
            got.err().map(|e| e.0).as_deref(),
            r["error"].as_str(),
            "{name}"
        );
    }
}

/// A definition with each material's water as its line's points (the ids
/// of the lines are the model's, which the way back renames), without the
/// materials' colors (display only; one without gets a default), and without
/// the piles' `location`, which the app's way back does not keep.
fn comparable(def: &SlopeDefinition) -> Value {
    let mut v = to_json(def);
    let main = v.pointer("/waterTable/value").cloned();
    let lines: HashMap<String, Value> = v["waterTables"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|w| {
            (
                w["id"].as_str().unwrap().to_owned(),
                w["coordinates"].clone(),
            )
        })
        .collect();
    for m in v["materials"].as_array_mut().unwrap() {
        // a material without a color gets one on the way back (display only)
        m.as_object_mut().unwrap().remove("color");
        let id = m.as_object_mut().unwrap().remove("waterTableId");
        let water = id
            .and_then(|i| i.as_str().map(|i| lines[i].clone()))
            .or(main.clone());
        m["water"] = water.unwrap_or(Value::Null);
    }
    let o = v.as_object_mut().unwrap();
    o.remove("waterTables");
    // false is the default (written whenever the model has custom planes,
    // also when all are incomplete and left out)
    if o.get("customPlanesOnly") == Some(&Value::Bool(false)) {
        o.remove("customPlanesOnly");
    }
    for p in o
        .get_mut("piles")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        p.as_object_mut().unwrap().remove("location");
    }
    v
}

#[test]
fn a_model_keeps_its_engineering_fields_through_the_definition() {
    for m in corpus()["models"].as_array().unwrap() {
        let name = m["name"].as_str().unwrap();
        let model = ModelEntry::from_json(m["model"].clone()).unwrap();
        let def = model_to_definition(&model);
        let back = definition_to_model(
            &def,
            &DefinitionModelInfo {
                id: model.id.clone(),
                name: model.name.clone(),
                options: model.options.clone(),
            },
        )
        .unwrap_or_else(|e| panic!("{name}: {e}"));
        let again = model_to_definition(&back);
        assert_same(
            &format!("{name}: through the definition and back"),
            &comparable(&again),
            &comparable(&def),
        );
        // and again (the lines' ids grow each time, as in the app)
        let third = model_to_definition(
            &definition_to_model(
                &again,
                &DefinitionModelInfo {
                    id: model.id.clone(),
                    name: model.name.clone(),
                    options: model.options.clone(),
                },
            )
            .unwrap(),
        );
        assert_same(
            &format!("{name}: a second time"),
            &comparable(&third),
            &comparable(&def),
        );
    }
}

#[test]
fn the_digest_is_the_scripts() {
    let sample = &corpus()["digestSample"];
    assert_eq!(digest(&sample["value"]), sample["digest"].as_str().unwrap());
    // numbers by their bits, keys in byte order, -0 as 0
    let a: Value =
        serde_json::from_str(r#"{"b":[1,2.5,null,true],"a":"x","c":{"z":-0.0,"y":false}}"#)
            .unwrap();
    let b: Value =
        serde_json::from_str(r#"{"c":{"y":false,"z":0},"a":"x","b":[1.0,2.5,null,true]}"#).unwrap();
    assert_eq!(digest(&a), digest(&b));
    assert_ne!(digest(&a), digest(&serde_json::json!({"a": "x"})));
}
