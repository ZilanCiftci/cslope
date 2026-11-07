//! The conversion and the reading of a model against the app's own
//! (golden/project-corpus.json, made with
//! packages/desktop/scripts/project-corpus.ts by the app's code): every
//! model and definition field for field, every saved model as the app
//! opens and writes it back, and its input hash. A change to the app's
//! conversion or load without its counterpart here, or the reverse, fails
//! this test; make both and regenerate the corpus.
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
    app_default_options, definition_to_model, input_hash, model_to_definition, normalize_for_run,
    read_model, DefinitionModelInfo, ModelEntry, ReadOptions,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

/// The date the corpus gives a title block the raw model lacked.
const NO_DATE: &str = "1970-01-01";

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

/// A model from a definition as the corpus holds it: without the project
/// block (today's date) and the sheet, which the app makes up.
fn comparable_model(model: &ModelEntry) -> Value {
    let mut v = model.to_json();
    let o = v.as_object_mut().unwrap();
    o.remove("projectInfo");
    o.remove("resultViewSettings");
    v
}

/// A raw model of the corpus read as the app reads it (the title block it
/// lacks dated as the corpus dates it).
fn read_raw(raw: &Value, strict: bool) -> Result<ModelEntry, String> {
    read_model(
        raw,
        &ReadOptions {
            strict,
            today: NO_DATE,
        },
    )
    .map_err(|e| e.0)
}

/// The corpus's raw models with the app's reading of them: the examples
/// and synthetic models, and the saved (sparse, older, hand-made) ones.
fn raw_models() -> Vec<(String, &'static Value, &'static Value, &'static str)> {
    let c = corpus();
    let mut out = Vec::new();
    for m in c["models"].as_array().unwrap() {
        out.push((
            m["name"].as_str().unwrap().to_owned(),
            &m["model"],
            &m["parsed"],
            m["inputHash"].as_str().unwrap(),
        ));
    }
    for s in c["saved"].as_array().unwrap() {
        out.push((
            s["name"].as_str().unwrap().to_owned(),
            &s["raw"],
            &s["parsed"],
            s["inputHash"].as_str().unwrap(),
        ));
    }
    assert!(out.len() >= 15);
    out
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
            coordinate_expressions: None,
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
        let model = normalize_for_run(&m["model"]).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_same(
            &format!("{name}: the definition"),
            &to_json(&model_to_definition(&model)),
            &m["definition"],
        );
    }
}

#[test]
fn saved_models_are_read_as_the_app_opens_and_writes_them() {
    // The app's load (parseProjectData) fills, clamps and drops members of
    // a saved model and writes the result back to model.json; the Rust
    // reader gives the same model, member for member, and its input hash.
    for (name, raw, parsed, hash) in raw_models() {
        let model = read_raw(raw, false).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_same(
            &format!("{name}: the model as read"),
            &model.to_json(),
            parsed,
        );
        assert_eq!(input_hash(&model).unwrap(), hash, "{name}: the input hash");
        assert_same(
            &format!("{name}: the definition"),
            &to_json(&model_to_definition(&model)),
            &to_json(&model_to_definition(
                &ModelEntry::from_json(parsed.clone()).unwrap(),
            )),
        );
    }
}

#[test]
fn what_the_app_wrote_reads_strictly_and_unchanged() {
    // The strict reader (the .cslp reader) takes every model the app writes
    // and gives it back as it is: the app's normalization is idempotent on
    // its own output, and the typed model loses no known member.
    for (name, _, parsed, hash) in raw_models() {
        let model = read_raw(parsed, true).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_same(&format!("{name}: read strictly"), &model.to_json(), parsed);
        let typed = ModelEntry::from_json(parsed.clone()).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_same(&format!("{name}: typed"), &typed.to_json(), parsed);
        assert_eq!(input_hash(&typed).unwrap(), hash, "{name}");
    }
}

#[test]
fn unknown_members_are_refused_with_their_path() {
    let (_, _, parsed, _) = raw_models().into_iter().nth(6).unwrap();
    let with = |edit: &dyn Fn(&mut Value)| {
        let mut v = parsed.clone();
        edit(&mut v);
        v
    };
    for (edit, path) in [
        (
            &(|v: &mut Value| v["extra"] = json!(1)) as &dyn Fn(&mut Value),
            "unknown member extra",
        ),
        (
            &|v: &mut Value| v["materials"][0]["foo"] = json!(1),
            "unknown member materials[0].foo",
        ),
        (
            &|v: &mut Value| v["materials"][1]["model"]["bar"] = json!(1),
            "unknown member materials[1].model.bar",
        ),
        (
            &|v: &mut Value| v["options"]["spencer"] = json!(true),
            "unknown member options.spencer",
        ),
        (
            &|v: &mut Value| v["resultViewSettings"]["annotations"][0]["glow"] = json!(true),
            "unknown member resultViewSettings.annotations[0].glow",
        ),
        (
            &|v: &mut Value| v["piezometricLine"]["lines"][0]["dash"] = json!("x"),
            "unknown member piezometricLine.lines[0].dash",
        ),
        (
            &|v: &mut Value| v["runState"] = json!("done"),
            "unknown member runState (the outcome of a run belongs to result.json",
        ),
    ] {
        let err = read_raw(&with(edit), true).expect_err(path);
        assert!(err.contains(path), "{err}");
        // the app's own way of reading drops it
        read_raw(&with(edit), false).unwrap_or_else(|e| panic!("{path}: {e}"));
    }
    // several at once: the first with a count
    let err = read_raw(
        &with(&|v| {
            v["a"] = json!(1);
            v["udls"][0]["b"] = json!(2);
        }),
        true,
    )
    .unwrap_err();
    assert_eq!(err, "unknown member a (and 1 more)");
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
        let model_json = comparable_model(&model);
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
        assert_eq!(
            input_hash(&model).unwrap(),
            e["inputHash"].as_str().unwrap(),
            "{id}: the input hash"
        );
    }
}

#[test]
fn definitions_give_the_apps_model() {
    for d in corpus()["definitions"].as_array().unwrap() {
        let name = d["name"].as_str().unwrap();
        let model = definition_to_model(&definition(&d["definition"]), &info(&d["info"]))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_same(
            &format!("{name}: the model"),
            &comparable_model(&model),
            &d["model"],
        );
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
            &Value::Object(model.options.to_map()),
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
        let model = normalize_for_run(&m["model"]).unwrap();
        let def = model_to_definition(&model);
        let back = definition_to_model(
            &def,
            &DefinitionModelInfo {
                id: model.id.clone(),
                name: model.name.clone(),
                options: Some(model.options.to_map()),
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
                    options: Some(model.options.to_map()),
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
